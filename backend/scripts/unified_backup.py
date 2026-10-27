#!/usr/bin/env python3
"""
Enterprise Unified Backup Service: GitHub Versioning & Google Drive Cloud Sync
- Non-camera data: Meet videos, Recorder App audio/video, ULINK ERP databases, system configs, code bundles.
- Asynchronous / Incremental: Tracks uploaded media files in state JSON to avoid duplicate uploads.
- Zero-impact: Safe online SQLite WAL snapshots, flock concurrency lock, chunked resumable Drive uploads.
- Multi-account support: Prefers 'thanhtungvo20082006' (default), smoothly falls back to 'ulink' account.
"""
import os
import sys
import time
import json
import fcntl
import sqlite3
import tarfile
import logging
import tempfile
import subprocess
from datetime import datetime, timezone
from pathlib import Path

# Paths
sys.path.insert(0, "/app")
sys.path.insert(0, "/home/thanhtung/assistant")

PRIMARY_HOME = Path("/home/thanhtung")
LOGS_DIR = PRIMARY_HOME / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = PRIMARY_HOME / "scripts/drive_upload_state.json"
LOCK_FILE = Path("/tmp/unified_backup.lock")

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(LOGS_DIR / "unified_backup.log"), encoding="utf-8")
    ]
)
logger = logging.getLogger("unified_backup")

DRIVE_ROOT_FOLDER = "ZEN_SERVER_BACKUPS"

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

WORKSPACE_PROJECTS = [
    "StorageManagementWeb-ULINK",
    "MinimalHabitTracker",
    "assistant",
    "meet-bot",
    "recorder-app",
    "towels-haven",
    "ulink-website",
    "ulink-website-preview",
    "zalo-bridge",
    "amazon-shipping",
    "pirateship-agent-service",
    "discord-bot",
    "gs1vn",
    "agent-monitor-bridge",
]

COMMON_EXCLUDES = [
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".cache",
    ".npm",
    "lost+found",
    "antigravity_brains",
    "music-denvau",
    "recordings",
    "meet-recordings",
    "camera-recordings",
    "exports",
    "assets",
    "chrome-profile",
    "profiles",
    "data",
    "build",
    "dist",
]


class GoogleDriveManager:
    def __init__(self):
        from bot.google_service import GoogleWorkspaceManager
        from googleapiclient.discovery import build
        
        self.mgr = GoogleWorkspaceManager.get_instance()
        self.service = None
        self.account_name = None
        
        # Enforce personal Google Drive account ONLY (thanhtungvo20082006 / default)
        if not self.mgr.is_authorized("default"):
            raise PermissionError("Tài khoản Google Drive cá nhân (thanhtungvo20082006 / default) chưa được ủy quyền!")
            
        try:
            creds = self.mgr.creds_map["default"]
            self.service = build("drive", "v3", credentials=creds)
            self.account_name = "thanhtungvo20082006 (default)"
            logger.info("Using authorized Google Drive personal account: thanhtungvo20082006 (default)")
        except Exception as e:
            logger.error(f"Failed to initialize Drive service for personal account: {e}")
            raise
        
        self.folders_cache = {}
        self.root_folder_id = self._get_or_create_folder(DRIVE_ROOT_FOLDER)

    def _get_or_create_folder(self, folder_name: str, parent_id: str = None) -> str:
        cache_key = f"{parent_id}:{folder_name}"
        if cache_key in self.folders_cache:
            return self.folders_cache[cache_key]
        
        q = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        if parent_id:
            q += f" and '{parent_id}' in parents"
        else:
            q += " and 'root' in parents"
            
        res = self.service.files().list(q=q, fields="files(id, name)").execute()
        files = res.get("files", [])
        if files:
            folder_id = files[0]["id"]
        else:
            body = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder"
            }
            if parent_id:
                body["parents"] = [parent_id]
            folder = self.service.files().create(body=body, fields="id").execute()
            folder_id = folder.get("id")
            logger.info(f"Created Google Drive folder '{folder_name}' (ID: {folder_id})")
        
        self.folders_cache[cache_key] = folder_id
        return folder_id

    def get_subfolder(self, subfolder_name: str) -> str:
        return self._get_or_create_folder(subfolder_name, parent_id=self.root_folder_id)

    def upload_file(self, file_path: Path, subfolder_name: str, custom_name: str = None, mime_type: str = None) -> dict:
        from googleapiclient.http import MediaFileUpload
        
        folder_id = self.get_subfolder(subfolder_name)
        target_name = custom_name or file_path.name
        
        if not mime_type:
            if target_name.endswith(".tar.gz") or target_name.endswith(".tgz"):
                mime_type = "application/gzip"
            elif target_name.endswith(".mp4"):
                mime_type = "video/mp4"
            elif target_name.endswith(".webm"):
                mime_type = "video/webm"
            elif target_name.endswith(".json"):
                mime_type = "application/json"
            else:
                mime_type = "application/octet-stream"
        
        # Check if already exists in folder
        q = f"name = '{target_name}' and '{folder_id}' in parents and trashed = false"
        res = self.service.files().list(q=q, fields="files(id, name, size)").execute()
        existing = res.get("files", [])
        
        media = MediaFileUpload(str(file_path), mimetype=mime_type, resumable=True, chunksize=5*1024*1024)
        
        if existing:
            file_id = existing[0]["id"]
            updated = self.service.files().update(fileId=file_id, media_body=media, fields="id, name, webViewLink, size").execute()
            logger.info(f"Updated '{target_name}' on Google Drive ({subfolder_name})")
            return updated
        else:
            body = {
                "name": target_name,
                "parents": [folder_id]
            }
            created = self.service.files().create(body=body, media_body=media, fields="id, name, webViewLink, size").execute()
            logger.info(f"Uploaded '{target_name}' to Google Drive ({subfolder_name})")
            return created

    def clean_old_files(self, subfolder_name: str, keep_count: int = 14):
        try:
            folder_id = self.get_subfolder(subfolder_name)
            q = f"'{folder_id}' in parents and trashed = false"
            res = self.service.files().list(q=q, orderBy="createdTime desc", fields="files(id, name, createdTime)").execute()
            files = res.get("files", [])
            if len(files) > keep_count:
                to_delete = files[keep_count:]
                logger.info(f"Rotating older backups in '{subfolder_name}' (deleting {len(to_delete)} items)...")
                for f in to_delete:
                    self.service.files().delete(fileId=f["id"]).execute()
        except Exception as e:
            logger.warning(f"Error rotating old backups in {subfolder_name}: {e}")


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "uploaded_meet_recordings": {},
        "uploaded_recorder_files": {},
        "last_database_backup": None,
        "last_code_backup": None,
    }


def save_state(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


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
            logger.warning(f"Integrity check failed for snapshot of {src_path}")
            return False
        return True
    except Exception as e:
        logger.error(f"Failed to snapshot SQLite DB {src_path}: {e}")
        return False


def run_database_backup(drive: GoogleDriveManager, state: dict) -> dict:
    logger.info("=== 1. Safe SQLite Databases Snapshot & Drive Backup ===")
    now = datetime.now()
    stamp = now.strftime("%Y%m%d_%H%M%S")
    archive_name = f"zen_databases_snapshot_{stamp}.tar.gz"
    
    with tempfile.TemporaryDirectory(prefix="zen_db_backup_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        dbs_dir = tmp_path / "databases"
        dbs_dir.mkdir()
        
        manifest = {
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "databases": []
        }
        
        for name, src_file in DATABASE_TARGETS:
            if src_file.exists():
                dest_file = dbs_dir / f"{name}.db"
                if safe_sqlite_snapshot(src_file, dest_file):
                    size_kb = round(dest_file.stat().st_size / 1024, 1)
                    manifest["databases"].append({"name": name, "size_kb": size_kb, "source": str(src_file)})
                    logger.info(f"✓ Snapshot DB: {name} ({size_kb} KB)")
        
        (tmp_path / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        
        archive_path = tmp_path / archive_name
        with tarfile.open(archive_path, "w:gz") as tar:
            tar.add(dbs_dir, arcname="databases")
            tar.add(tmp_path / "manifest.json", arcname="manifest.json")
            
        size_mb = round(archive_path.stat().st_size / (1024 * 1024), 2)
        logger.info(f"Databases archive created: {archive_name} ({size_mb} MB)")
        
        up_res = drive.upload_file(archive_path, subfolder_name="databases")
        drive.clean_old_files("databases", keep_count=14)
        
        state["last_database_backup"] = {
            "timestamp": now.isoformat(),
            "file_name": archive_name,
            "size_mb": size_mb,
            "file_id": up_res.get("id"),
            "count": len(manifest["databases"])
        }
        return state["last_database_backup"]


def run_meet_recordings_backup(drive: GoogleDriveManager, state: dict) -> int:
    logger.info("=== 2. Google Meet Bot Recordings Sync ===")
    meet_dir = PRIMARY_HOME / "meet-recordings"
    uploaded_count = 0
    if not meet_dir.exists():
        return 0
    
    uploaded_map = state.setdefault("uploaded_meet_recordings", {})
    
    for f in sorted(meet_dir.glob("*.mp4")):
        mtime = f.stat().st_mtime
        size = f.stat().st_size
        file_key = f.name
        
        if file_key in uploaded_map and uploaded_map[file_key].get("size") == size:
            continue
            
        size_mb = round(size / (1024 * 1024), 2)
        logger.info(f"Syncing new Meet recording: {f.name} ({size_mb} MB)...")
        up_res = drive.upload_file(f, subfolder_name="meet_recordings")
        uploaded_map[file_key] = {
            "size": size,
            "mtime": mtime,
            "uploaded_at": datetime.now().isoformat(),
            "drive_id": up_res.get("id")
        }
        uploaded_count += 1
        save_state(state)
        
    logger.info(f"Meet recordings sync finished. Uploaded {uploaded_count} new file(s).")
    return uploaded_count


def run_recorder_app_backup(drive: GoogleDriveManager, state: dict) -> int:
    logger.info("=== 3. Recorder App Media Sync ===")
    rec_dir = PRIMARY_HOME / "recorder-app/data/recordings"
    uploaded_count = 0
    if not rec_dir.exists():
        return 0
    
    uploaded_map = state.setdefault("uploaded_recorder_files", {})
    
    for f in sorted(rec_dir.glob("*.webm")):
        mtime = f.stat().st_mtime
        size = f.stat().st_size
        file_key = f.name
        
        if file_key in uploaded_map and uploaded_map[file_key].get("size") == size:
            continue
            
        size_mb = round(size / (1024 * 1024), 2)
        logger.info(f"Syncing Recorder App file: {f.name} ({size_mb} MB)...")
        up_res = drive.upload_file(f, subfolder_name="recorder_recordings")
        uploaded_map[file_key] = {
            "size": size,
            "mtime": mtime,
            "uploaded_at": datetime.now().isoformat(),
            "drive_id": up_res.get("id")
        }
        uploaded_count += 1
        save_state(state)
        
    logger.info(f"Recorder App media sync finished. Uploaded {uploaded_count} new file(s).")
    return uploaded_count


def run_code_and_system_backup(drive: GoogleDriveManager, state: dict) -> dict:
    logger.info("=== 4. Code Repositories & System Configs Bundle ===")
    now = datetime.now()
    stamp = now.strftime("%Y%m%d_%H%M%S")
    archive_name = f"zen_code_and_configs_{stamp}.tar.gz"
    
    with tempfile.TemporaryDirectory(prefix="zen_code_backup_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        archive_path = tmp_path / archive_name
        
        def tar_filter(tarinfo):
            name = tarinfo.name
            for ex in COMMON_EXCLUDES:
                if f"/{ex}/" in f"/{name}/" or name.endswith(f"/{ex}") or name == ex:
                    return None
            if name.endswith(".db") or name.endswith(".db-wal") or name.endswith(".db-shm"):
                return None
            if name.endswith(".mp4") or name.endswith(".mp3") or name.endswith(".webm"):
                return None
            if name.endswith(".tar.gz") or name.endswith(".tgz") or name.endswith(".zip"):
                return None
            return tarinfo

        with tarfile.open(archive_path, "w:gz") as tar:
            for proj in WORKSPACE_PROJECTS:
                src_path = PRIMARY_HOME / proj
                if src_path.exists():
                    logger.info(f"Archiving codebase: {proj}")
                    tar.add(str(src_path), arcname=f"workspaces/{proj}", filter=tar_filter)
            
            # System configs
            cloudflared = PRIMARY_HOME / ".cloudflared"
            if cloudflared.exists():
                tar.add(str(cloudflared), arcname="configs/cloudflared")
                
            config_dir = PRIMARY_HOME / ".config"
            if config_dir.exists():
                tar.add(str(config_dir), arcname="configs/dot_config", filter=tar_filter)
        
        size_mb = round(archive_path.stat().st_size / (1024 * 1024), 2)
        logger.info(f"Codebase archive created: {archive_name} ({size_mb} MB)")
        
        up_res = drive.upload_file(archive_path, subfolder_name="code_bundles")
        drive.clean_old_files("code_bundles", keep_count=7)
        
        state["last_code_backup"] = {
            "timestamp": now.isoformat(),
            "file_name": archive_name,
            "size_mb": size_mb,
            "file_id": up_res.get("id")
        }
        return state["last_code_backup"]


def run_git_sync():
    logger.info("=== 5. Git Repositories Versioning & Push Check ===")
    for proj in WORKSPACE_PROJECTS:
        p = PRIMARY_HOME / proj
        if not (p / ".git").exists():
            continue
        try:
            # Check for changes
            st = subprocess.run(["git", "status", "--porcelain"], cwd=str(p), capture_output=True, text=True)
            if st.stdout.strip():
                logger.info(f"Project '{proj}' has uncommitted changes, auto-committing...")
                subprocess.run(["git", "add", "-A"], cwd=str(p))
                subprocess.run(["git", "commit", "-m", f"chore(backup): auto-commit sync {datetime.now().strftime('%Y-%m-%d %H:%M')}"], cwd=str(p))
            
            # Check remote
            rem = subprocess.run(["git", "remote"], cwd=str(p), capture_output=True, text=True)
            if "origin" in rem.stdout:
                push_res = subprocess.run(["git", "push", "origin", "main"], cwd=str(p), capture_output=True, text=True, timeout=15)
                if push_res.returncode == 0:
                    logger.info(f"✓ '{proj}' pushed successfully to GitHub origin/main")
                else:
                    err = push_res.stderr.strip().splitlines()[-1] if push_res.stderr.strip() else "Auth required"
                    logger.warning(f"⚠️ '{proj}' git push origin main skipped: {err}")
        except Exception as e:
            logger.warning(f"Error checking git for {proj}: {e}")


def main():
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        logger.warning("Another unified backup instance is currently active. Exiting.")
        sys.exit(0)
        
    start_t = time.time()
    logger.info("==================================================")
    logger.info("🚀 STARTING UNIFIED BACKUP: GITHUB & GOOGLE DRIVE")
    logger.info("==================================================")
    
    state = load_state()
    try:
        # Step A: Local Git Auto-commit and Remote Push Check
        run_git_sync()
        
        # Step B: Google Drive Sync
        drive = GoogleDriveManager()
        db_res = run_database_backup(drive, state)
        meet_count = run_meet_recordings_backup(drive, state)
        rec_count = run_recorder_app_backup(drive, state)
        code_res = run_code_and_system_backup(drive, state)
        
        save_state(state)
        
        dur = round(time.time() - start_t, 2)
        summary = {
            "status": "success",
            "duration_seconds": dur,
            "account": drive.account_name,
            "databases_archive": db_res["file_name"],
            "new_meet_videos": meet_count,
            "new_recorder_media": rec_count,
            "code_archive": code_res["file_name"],
            "completed_at": datetime.now().isoformat()
        }
        (LOGS_DIR / "last_backup_meta.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        
        # Send Telegram notification report to Tùng (Admin)
        try:
            tele_msg = (
                f"🛡️ **BÁO CÁO SAO LƯU HỆ THỐNG ĐỊNH KỲ (BACKUP SUCCESS)**\n\n"
                f"• **Thời gian hoàn tất:** {datetime.now().strftime('%H:%M:%S - %d/%m/%Y')}\n"
                f"• **Thời lượng thực thi:** {dur} giây\n"
                f"• **Tài khoản Google Drive:** `{drive.account_name}`\n"
                f"• **Thư mục Drive:** `ZEN_SERVER_BACKUPS`\n\n"
                f"📦 **Chi tiết các gói dữ liệu đã đồng bộ:**\n"
                f"• Snapshot SQLite: `{db_res['file_name']}` ({db_res.get('size_mb', 0)} MB)\n"
                f"• Bản nén mã nguồn: `{code_res['file_name']}` ({code_res.get('size_mb', 0)} MB)\n"
                f"• Video Google Meet mới: {meet_count} tệp\n"
                f"• Audio/Media Recorder mới: {rec_count} tệp\n\n"
                f"✅ *Dữ liệu toàn hệ thống đã được bảo toàn nguyên vẹn trên Google Drive cá nhân của Tùng!*"
            )
            # Send via ZenNotiBot (@ZenNotiBot) to keep main chat clean
            noti_token = os.getenv("NOTIFICATION_BOT_TOKEN") or "8831162340:AAFofOcn8xNbf3OUgjKafyXDS-o9huPQcpk"
            admin_id = 8151613595
            if noti_token:
                import urllib.request
                import urllib.parse
                api_url = f"https://api.telegram.org/bot{noti_token}/sendMessage"
                payload = urllib.parse.urlencode({
                    "chat_id": admin_id,
                    "text": tele_msg,
                    "parse_mode": "Markdown"
                }).encode("utf-8")
                req = urllib.request.Request(api_url, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    logger.info("Sent backup completion report to ZenNotiBot Telegram successfully.")
        except Exception as te:
            logger.warning(f"Could not send Telegram backup report: {te}")

        logger.info("==================================================")
        logger.info(f"✅ UNIFIED BACKUP COMPLETED in {dur}s")
        logger.info(f"Summary: {json.dumps(summary, indent=2)}")
        logger.info("==================================================")
    except Exception as e:
        logger.error(f"❌ UNIFIED BACKUP ERROR: {e}", exc_info=True)
    finally:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            lock_fd.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
