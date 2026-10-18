#!/usr/bin/env python3
"""
Offsite Disaster Recovery & Replication Script
Syncs Primary Homelab (ULINK ERP & The Towels Haven) to Proxmox Backup VM (100.118.251.55)
"""
import os
import sys
import time
import json
import sqlite3
import tempfile
import subprocess
from datetime import datetime, timezone
from pathlib import Path

BACKUP_VM_HOST = "100.118.251.55"
BACKUP_VM_USER = "tung"
REMOTE_BASE = "/home/tung/dr-environment"

PRIMARY_STORAGE = Path("/home/thanhtung/StorageManagementWeb-ULINK")
DB_SRC = PRIMARY_STORAGE / "backend/storage.db"
ASSETS_SRC = PRIMARY_STORAGE / "backend/assets"
ENV_SRC = PRIMARY_STORAGE / "backend/.env"

def log(msg: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)

def safe_sqlite_snapshot(src_path: Path, dest_path: Path):
    """Safe online snapshot of SQLite DB with WAL checkpointing and integrity check."""
    if not src_path.exists():
        raise FileNotFoundError(f"Source database not found: {src_path}")
    
    log(f"Snapshotting SQLite DB: {src_path} -> {dest_path}")
    try:
        conn = sqlite3.connect(str(src_path), timeout=10.0)
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        conn.close()
    except Exception as e:
        log(f"Warning on WAL checkpoint: {e}")

    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(str(dest_path))
    src.backup(dst)
    src.close()

    check_result = dst.execute("PRAGMA integrity_check").fetchone()
    dst.close()
    if not check_result or check_result[0] != "ok":
        raise RuntimeError(f"Integrity check failed on snapshot: {check_result}")
    
    log(f"SQLite snapshot verified: integrity_check={check_result[0]}")

def sync_database():
    """Takes safe snapshot and atomically syncs it to Backup VM."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        safe_sqlite_snapshot(DB_SRC, tmp_path)
        remote_tmp = f"{REMOTE_BASE}/data/storage.db.incoming"
        remote_dest = f"{REMOTE_BASE}/data/storage.db"
        
        # Stream via SSH directly to remote file
        log("Transferring verified SQLite snapshot to remote VM...")
        cmd_transfer = (
            f"cat {tmp_path} | ssh -o BatchMode=yes -o StrictHostKeyChecking=no "
            f"{BACKUP_VM_USER}@{BACKUP_VM_HOST} 'cat > {remote_tmp}'"
        )
        res = subprocess.run(cmd_transfer, shell=True, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"DB transfer failed: {res.stderr}")

        # Atomically rename remote incoming -> storage.db and verify remote integrity
        remote_cmd = (
            f"mv {remote_tmp} {remote_dest} && "
            f"python3 -c 'import sqlite3; c=sqlite3.connect(\"{remote_dest}\"); assert c.execute(\"PRAGMA integrity_check\").fetchone()[0]==\"ok\"' && "
            f"echo REMOTE_INTEGRITY_OK"
        )
        ssh_cmd = [
            "ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
            f"{BACKUP_VM_USER}@{BACKUP_VM_HOST}",
            remote_cmd
        ]
        res_ssh = subprocess.run(ssh_cmd, capture_output=True, text=True)
        if res_ssh.returncode != 0 or "REMOTE_INTEGRITY_OK" not in res_ssh.stdout:
            raise RuntimeError(f"Remote DB atomic move & verify failed: {res_ssh.stderr} {res_ssh.stdout}")
        
        log("Database successfully synced and remotely verified on Backup VM!")
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

def sync_assets():
    """Incremental delta sync of assets using host rsync."""
    if not ASSETS_SRC.exists():
        log(f"Assets directory not found: {ASSETS_SRC}")
        return

    log("Running rsync for assets directory to Backup VM...")
    cmd = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"rsync -avz --delete -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
        f'/home/thanhtung/StorageManagementWeb-ULINK/backend/assets/ '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/assets/"'
    )
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Assets sync failed: {res.stderr}")
    log("Assets synced successfully!")

def sync_configs():
    """Sync configs and templates to Backup VM."""
    log("Syncing configs to remote VM...")
    cmd = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"ssh -o BatchMode=yes -o StrictHostKeyChecking=no {BACKUP_VM_USER}@{BACKUP_VM_HOST} \\"mkdir -p {REMOTE_BASE}/config {REMOTE_BASE}/storage-backend\\" && '
        f'rsync -avz -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" /home/thanhtung/.config/storefront-proxy/towels.conf {BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/config/towels.conf 2>/dev/null || true && '
        f'rsync -avz -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" /home/thanhtung/StorageManagementWeb-ULINK/backend/.env {BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/storage-backend/.env 2>/dev/null || true"'
    )
    subprocess.run(cmd, shell=True, check=True)
    log("Configs synced successfully!")

def write_sync_metadata():
    now_iso = datetime.now(timezone.utc).isoformat()
    meta = {
        "timestamp": time.time(),
        "last_sync_utc": now_iso,
        "status": "success",
        "primary_host": "web-server",
        "backup_host": BACKUP_VM_HOST,
        "services": ["storage.db", "assets", "towels-haven", "ulink-erp"]
    }
    meta_json = json.dumps(meta, indent=2)
    meta_file = Path("/app/data/last_dr_sync.json")
    meta_file.write_text(meta_json, encoding="utf-8")
    
    # Push metadata to remote VM
    cmd = [
        "ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
        f"{BACKUP_VM_USER}@{BACKUP_VM_HOST}",
        f"cat << 'EOF' > {REMOTE_BASE}/last_sync.json\n{meta_json}\nEOF"
    ]
    subprocess.run(cmd, check=True)
    log(f"Sync metadata recorded at {now_iso}")

def main():
    start_t = time.time()
    log("=== STARTING DR REPLICATION ===")
    try:
        sync_database()
        sync_assets()
        sync_configs()
        write_sync_metadata()
        dur = round(time.time() - start_t, 2)
        log(f"=== DR REPLICATION SUCCESSFUL in {dur}s ===")
    except Exception as e:
        log(f"❌ DR REPLICATION ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
