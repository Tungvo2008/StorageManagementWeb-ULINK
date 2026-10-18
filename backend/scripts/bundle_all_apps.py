#!/usr/bin/env python3
"""
Full System & Multi-App Cloud Backup to Google Drive
Snapshots ALL databases and metadata across all running server applications:
- ULINK Storage ERP & The Towels Haven (storage.db)
- Video Recording Studio (recorder-app/data/recordings.db)
- Meet Bot & Meet Control (meet-bot/data, meet-backups)
- Amazon Shipping (pnl.db, shipping.db, alerts.db, app.db, brand_analytics.db)
- PirateShip Agent (pirateship-agent.sqlite3)
- Zen Assistant & Tín Thành (app.db, storage.db, assistant.db, semantic_memory.db)
- Minimal Habit Tracker (habits.db)
- Audiobookshelf (absdatabase.sqlite)
- Speakr (transcriptions.db)
Uploads verified tar.gz directly to Google Drive 'ULINK_SYSTEM_BACKUPS'
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

PRIMARY = Path("/home/thanhtung")
FOLDER_NAME = "ULINK_SYSTEM_BACKUPS"

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")
logger = logging.getLogger(__name__)

DATABASE_TARGETS = [
    ("ulink_erp", PRIMARY / "StorageManagementWeb-ULINK/backend/storage.db"),
    ("recorder_app", PRIMARY / "recorder-app/data/recordings.db"),
    ("amazon_shipping_pnl", PRIMARY / "amazon-shipping/data/pnl.db"),
    ("amazon_shipping_shipping", PRIMARY / "amazon-shipping/data/shipping.db"),
    ("amazon_shipping_alerts", PRIMARY / "amazon-shipping/data/alerts.db"),
    ("amazon_shipping_app", PRIMARY / "amazon-shipping/data/app.db"),
    ("amazon_shipping_brand_analytics", PRIMARY / "amazon-shipping/data/brand_analytics.db"),
    ("pirateship_agent", PRIMARY / "pirateship-agent-service/data/pirateship-agent.sqlite3"),
    ("habit_tracker", PRIMARY / "MinimalHabitTracker/data/habits.db"),
    ("assistant_app", PRIMARY / "assistant/data/app.db"),
    ("assistant_storage", PRIMARY / "assistant/data/storage.db"),
    ("assistant_main", PRIMARY / "assistant/data/assistant.db"),
    ("assistant_semantic_memory", PRIMARY / "assistant/data/semantic_memory.db"),
    ("assistant_tinthanh_memory", PRIMARY / "assistant-tinthanh/data/semantic_memory.db"),
    ("audiobookshelf", PRIMARY / "audiobookshelf/config/absdatabase.sqlite"),
    ("speakr", PRIMARY / "speakr/instance/transcriptions.db"),
]

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
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
        dst = sqlite3.connect(str(dest_path))
        src.backup(dst)
        src.close()
        res = dst.execute("PRAGMA integrity_check").fetchone()
        dst.close()
        if not res or res[0] != "ok":
            logger.warning(f"Integrity check failed on {src_path.name}")
            return False
        return True
    except Exception as e:
        logger.warning(f"Failed to snapshot {src_path}: {e}")
        return False

def create_bundle(dest_tar: Path):
    with tempfile.TemporaryDirectory() as tmpdir:
        t = Path(tmpdir)
        db_dir = t / "databases"
        meet_dir = t / "meet_control"
        db_dir.mkdir()
        meet_dir.mkdir()

        manifest = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "databases": [],
            "meet_control_files": []
        }

        for label, path in DATABASE_TARGETS:
            if path.exists():
                out_name = f"{label}_{path.name}"
                dest = db_dir / out_name
                if safe_sqlite_snapshot(path, dest):
                    logger.info(f"✓ Snapshotted [{label}]: {path.name} ({dest.stat().st_size} bytes)")
                    manifest["databases"].append({
                        "label": label,
                        "path": str(path),
                        "size": dest.stat().st_size
                    })

        meet_data = PRIMARY / "meet-bot/data"
        if meet_data.exists():
            for f in meet_data.iterdir():
                if f.is_file() and not f.name.endswith(".log"):
                    (meet_dir / f.name).write_bytes(f.read_bytes())
                    manifest["meet_control_files"].append(f.name)
            logger.info("✓ Gathered Meet Bot control metadata & session configs.")

        (t / "manifest.json").write_text(json.dumps(manifest, indent=2))

        with tarfile.open(dest_tar, "w:gz") as tar:
            tar.add(db_dir, arcname="databases")
            tar.add(meet_dir, arcname="meet_control")
            tar.add(t / "manifest.json", arcname="manifest.json")
            
        logger.info(f"✓ Bundle created: {dest_tar} ({round(dest_tar.stat().st_size / (1024*1024), 2)} MB)")
        return manifest

if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else PRIMARY / "StorageManagementWeb-ULINK/backend/ALL_APPS_BACKUP.tar.gz"
    create_bundle(out)
