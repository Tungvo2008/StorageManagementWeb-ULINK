#!/usr/bin/env python3
"""
Enterprise Full Google Drive Cloud Backup for ALL Running Applications
Gathers, snapshots, and uploads SQLite databases, metadata, and configs from:
1. ULINK Storage ERP & The Towels Haven (storage.db)
2. Recorder App (recordings.db)
3. Meet Bot & Meet Control (meeting metadata, active profiles, passwords, meet-backups)
4. Amazon Shipping (pnl.db, shipping.db, alerts.db, app.db, brand_analytics.db)
5. PirateShip Agent Service (pirateship-agent.sqlite3)
6. Zen Assistant & Tín Thành (app.db, storage.db, assistant.db, semantic_memory.db)
7. Minimal Habit Tracker (habits.db)
8. Audiobookshelf (absdatabase.sqlite)
9. Speakr (transcriptions.db)
Uploads compressed archive directly to Google Drive folder 'ULINK_SYSTEM_BACKUPS'
Uses Google OAuth account 'ulink' (ULINK LLC).
"""
import os
import sys
import time
import json
import sqlite3
import tempfile
import tarfile
import logging
from datetime import datetime, timezone
from pathlib import Path

# Add paths to load GoogleWorkspaceManager
sys.path.insert(0, "/app")
sys.path.insert(0, "/home/thanhtung/assistant")

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")
logger = logging.getLogger(__name__)

PRIMARY_HOME = Path("/home/thanhtung")
FOLDER_NAME = "ULINK_SYSTEM_BACKUPS"

# Complete database catalog of all running services
DATABASE_TARGETS = [
    ("ulink_erp", PRIMARY_HOME / "StorageManagementWeb-ULINK/backend/storage.db"),
    ("recorder_app", PRIMARY_HOME / "recorder-app/data/recordings.db"),
    ("amazon_shipping_pnl", PRIMARY_HOME / "amazon-shipping/data/pnl.db"),
    ("amazon_shipping_shipping", PRIMARY_HOME / "amazon-shipping/data/shipping.db"),
    ("amazon_shipping_alerts", PRIMARY_HOME / "amazon-shipping/data/alerts.db"),
    ("amazon_shipping_app", PRIMARY_HOME / "amazon-shipping/data/app.db"),
    ("amazon_shipping_brand_analytics", PRIMARY_HOME / "amazon-shipping/data/brand_analytics.db"),
    ("pirateship_agent", PRIMARY_HOME / "pirateship-agent-service/data/pirateship-agent.sqlite3"),
    ("habit_tracker", PRIMARY_HOME / "MinimalHabitTracker/data/habits.db"),
    ("assistant_app", PRIMARY_HOME / "assistant/data/app.db"),
    ("assistant_storage", PRIMARY_HOME / "assistant/data/storage.db"),
    ("assistant_main", PRIMARY_HOME / "assistant/data/assistant.db"),
    ("assistant_semantic_memory", PRIMARY_HOME / "assistant/data/semantic_memory.db"),
    ("assistant_tinthanh_memory", PRIMARY_HOME / "assistant-tinthanh/data/semantic_memory.db"),
    ("audiobookshelf", PRIMARY_HOME / "audiobookshelf/config/absdatabase.sqlite"),
    ("speakr", PRIMARY_HOME / "speakr/instance/transcriptions.db"),
]

def get_drive_service():
    from bot.google_service import GoogleWorkspaceManager
    from googleapiclient.discovery import build
    
    mgr = GoogleWorkspaceManager.get_instance()
    if not mgr.is_authorized("ulink"):
        raise PermissionError("Tài khoản Google 'ulink' chưa được xác thực OAuth!")
    creds = mgr.creds_map["ulink"]
    return build("drive", "v3", credentials=creds)

def get_or_create_backup_folder(service) -> tuple[str, str]:
    q = f"name = '{FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    res = service.files().list(q=q, fields="files(id, name, webViewLink)").execute()
    folders = res.get("files", [])
    if folders:
        return folders[0]["id"], folders[0]["webViewLink"]
    
    body = {
        "name": FOLDER_NAME,
        "mimeType": "application/vnd.google-apps.folder"
    }
    folder = service.files().create(body=body, fields="id, name, webViewLink").execute()
    return folder.get("id"), folder.get("webViewLink")

def safe_sqlite_snapshot(src_path: Path, dest_path: Path) -> bool:
    if not src_path.exists():
        return False
    try:
        conn = sqlite3.connect(str(src_path), timeout=10.0)
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        conn.close()
    except Exception:
        pass

    try:
        src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dst = sqlite3.connect(str(dest_path))
        src.backup(dst)
        src.close()
        res = dst.execute("PRAGMA integrity_check").fetchone()
        dst.close()
        if not res or res[0] != "ok":
            logger.warning(f"Integrity check failed on {src_path.name}: {res}")
            return False
        return True
    except Exception as e:
        logger.warning(f"Failed to snapshot {src_path}: {e}")
        return False

def clean_old_drive_backups(service, folder_id: str, keep_count: int = 14):
    try:
        q = f"'{folder_id}' in parents and trashed = false"
        res = service.files().list(
            q=q,
            orderBy="createdTime desc",
            fields="files(id, name, createdTime)"
        ).execute()
        files = res.get("files", [])
        if len(files) > keep_count:
            for old_file in files[keep_count:]:
                logger.info(f"Removing old cloud backup: {old_file['name']} ({old_file['id']})")
                service.files().delete(fileId=old_file["id"]).execute()
    except Exception as e:
        logger.warning(f"Error during Drive backup rotation: {e}")

def run_backup():
    logger.info("==================================================")
    logger.info("=== STARTING FULL APPS GOOGLE DRIVE CLOUD BACKUP ===")
    logger.info("==================================================")
    from googleapiclient.http import MediaFileUpload
    
    service = get_drive_service()
    folder_id, folder_url = get_or_create_backup_folder(service)
    logger.info(f"Target Google Drive Folder: {FOLDER_NAME} (ID: {folder_id})")

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%d_%H%M%SZ")
    archive_name = f"ALL_APPS_SYSTEM_BACKUP_{stamp}.tar.gz"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_base = Path(tmpdir)
        dbs_dir = tmp_base / "databases"
        meet_dir = tmp_base / "meet_control"
        dbs_dir.mkdir(parents=True, exist_ok=True)
        meet_dir.mkdir(parents=True, exist_ok=True)

        manifest = {
            "created_at": now.isoformat(),
            "databases_backed_up": [],
            "meet_control_files": []
        }

        # 1. Snapshot all database targets
        for app_label, db_path in DATABASE_TARGETS:
            if db_path.exists():
                dest_file = dbs_dir / f"{app_label}_{db_path.name}"
                if safe_sqlite_snapshot(db_path, dest_file):
                    logger.info(f"✓ Snapshotted [{app_label}]: {db_path.name}")
                    manifest["databases_backed_up"].append({
                        "app": app_label,
                        "original_path": str(db_path),
                        "size_bytes": os.path.getsize(dest_file)
                    })

        # 2. Gather Meet Bot metadata and configs
        meet_data = PRIMARY_HOME / "meet-bot/data"
        if meet_data.exists():
            for f in meet_data.iterdir():
                if f.is_file() and not f.name.endswith(".log"):
                    dest = meet_dir / f.name
                    dest.write_bytes(f.read_bytes())
                    manifest["meet_control_files"].append(f.name)
            logger.info("✓ Gathered Meet Bot control metadata & active profile states.")

        # Also include meet-backups config archive if present
        meet_backups = PRIMARY_HOME / "meet-backups"
        if meet_backups.exists():
            for archive in meet_backups.glob("meet-config-*.tar.gz"):
                dest = meet_dir / archive.name
                dest.write_bytes(archive.read_bytes())
                logger.info(f"✓ Included meet configuration bundle: {archive.name}")

        # 3. Write manifest
        (tmp_base / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        # 4. Create compressed tarball
        archive_path = tmp_base / archive_name
        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(dbs_dir, arcname="databases")
            tar.add(meet_dir, arcname="meet_control")
            tar.add(tmp_base / "manifest.json", arcname="manifest.json")

        size_mb = round(os.path.getsize(archive_path) / (1024 * 1024), 2)
        logger.info(f"Compressed archive created: {archive_name} ({size_mb} MB)")

        # 5. Upload to Google Drive
        media = MediaFileUpload(str(archive_path), mimetype="application/gzip", resumable=True)
        body = {
            "name": archive_name,
            "parents": [folder_id],
            "description": f"Comprehensive multi-app backup containing {len(manifest['databases_backed_up'])} databases and Meet Control configs at {stamp}."
        }
        file = service.files().create(body=body, media_body=media, fields="id, name, size, webViewLink").execute()
        
        file_id = file.get("id")
        file_link = file.get("webViewLink")
        logger.info(f"✓ Uploaded successfully to Google Drive!")
        logger.info(f"File: {archive_name}")
        logger.info(f"Link: {file_link}")

        # 6. Retention rotation
        clean_old_drive_backups(service, folder_id, keep_count=14)

        return {
            "status": "success",
            "file_name": archive_name,
            "file_id": file_id,
            "file_link": file_link,
            "folder_link": folder_url,
            "databases_count": len(manifest["databases_backed_up"]),
            "timestamp": now.isoformat()
        }

if __name__ == "__main__":
    res = run_backup()
    print(json.dumps(res, indent=2))
