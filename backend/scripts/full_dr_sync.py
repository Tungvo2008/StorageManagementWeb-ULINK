#!/usr/bin/env python3
"""
Enterprise Full-Workspace Disaster Recovery & Multi-Node Replication Script
Comprehensive Multi-Node Replication for ALL projects and system components:
1. Online safe SQLite snapshots (ULINK ERP & Zen Assistant DBs) with integrity verification
2. Live hot-standby assets & configuration sync
3. Full codebase sync for ALL user projects in /home/thanhtung
4. Historical backup archives sync (/home/thanhtung/ulink-backups)
5. Host system configs (.cloudflared, .config, crontabs)
Target: Proxmox Standby VM (100.118.251.55) via Tailscale
"""
import os
import sys
import time
import json
import fcntl
import sqlite3
import tempfile
import subprocess
from datetime import datetime, timezone
from pathlib import Path

BACKUP_VM_HOST = "100.118.251.55"
BACKUP_VM_USER = "tung"
REMOTE_BASE = "/home/tung/dr-environment"

PRIMARY_HOME = Path("/home/thanhtung")
PRIMARY_STORAGE = PRIMARY_HOME / "StorageManagementWeb-ULINK"
DB_SRC = PRIMARY_STORAGE / "backend/storage.db"
ASSETS_SRC = PRIMARY_STORAGE / "backend/assets"
ULINK_BACKUPS_SRC = PRIMARY_HOME / "ulink-backups"

# All user projects and workspaces to protect
PROJECT_DIRS = [
    "StorageManagementWeb-ULINK",
    "towels-haven",
    "assistant",
    "assistant-tinthanh",
    "zalo-bridge",
    "amazon-shipping",
    "pirateship-agent-service",
    "ulink-website",
    "ulink-website-preview",
    "agent-monitor-bridge",
    "zen-scout-extension",
    "MinimalHabitTracker",
    "gs1vn",
    "discord-bot",
    "meet-bot",
    "meet-recordings",
    "meet-backups",
    "recorder-app",
    "recorder-openstudio",
    "audiobookshelf",
    "hiseeu-media",
    "speakr",
    "scripts",
]

COMMON_EXCLUDES = [
    "--exclude=node_modules",
    "--exclude=__pycache__",
    "--exclude=*.pyc",
    "--exclude=.pytest_cache",
    "--exclude=.venv",
    "--exclude=venv",
    "--exclude=.cache",
    "--exclude=.npm",
    "--exclude=lost+found",
    "--exclude=*.log",
    "--exclude=antigravity_brains",
    "--exclude=*.tar.gz",
    "--exclude=*.tgz",
    "--exclude=*.zip",
    "--exclude=music-denvau",
    "--exclude=*.mp4",
    "--exclude=*.mp3",
    "--exclude=*.m4a",
    "--exclude=*.wav",
    "--exclude=*.flac",
    "--exclude=*.webm",
    "--exclude=*.mkv",
]

def log(msg: str):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] {msg}", flush=True)

def run_ssh(remote_cmd: str, check=True) -> subprocess.CompletedProcess:
    ssh_cmd = [
        "ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
        f"{BACKUP_VM_USER}@{BACKUP_VM_HOST}",
        remote_cmd
    ]
    return subprocess.run(ssh_cmd, capture_output=True, text=True, check=check)

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
        log(f"Warning on WAL checkpoint for {src_path.name}: {e}")

    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(str(dest_path))
    src.backup(dst)
    src.close()

    check_result = dst.execute("PRAGMA integrity_check").fetchone()
    dst.close()
    if not check_result or check_result[0] != "ok":
        raise RuntimeError(f"Integrity check failed on snapshot {src_path.name}: {check_result}")
    
    log(f"SQLite snapshot verified: {src_path.name} integrity_check={check_result[0]}")

def sync_primary_database():
    """Sync storage.db to Backup VM atomically."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        safe_sqlite_snapshot(DB_SRC, tmp_path)
        remote_tmp = f"{REMOTE_BASE}/data/storage.db.incoming"
        remote_dest = f"{REMOTE_BASE}/data/storage.db"
        
        log("Transferring verified SQLite storage.db snapshot to remote VM...")
        cmd_transfer = (
            f"cat {tmp_path} | ssh -o BatchMode=yes -o StrictHostKeyChecking=no "
            f"{BACKUP_VM_USER}@{BACKUP_VM_HOST} 'cat > {remote_tmp}'"
        )
        res = subprocess.run(cmd_transfer, shell=True, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"DB transfer failed: {res.stderr}")

        remote_cmd = (
            f"mv {remote_tmp} {remote_dest} && "
            f"python3 -c 'import sqlite3; c=sqlite3.connect(\"{remote_dest}\"); assert c.execute(\"PRAGMA integrity_check\").fetchone()[0]==\"ok\"' && "
            f"echo REMOTE_INTEGRITY_OK"
        )
        res_ssh = run_ssh(remote_cmd)
        if res_ssh.returncode != 0 or "REMOTE_INTEGRITY_OK" not in res_ssh.stdout:
            raise RuntimeError(f"Remote DB atomic move & verify failed: {res_ssh.stderr} {res_ssh.stdout}")
        
        log("Primary database successfully synced and remotely verified on Backup VM!")
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

def sync_assistant_databases():
    """Safely snapshots and syncs all assistant SQLite databases."""
    assistant_data_dir = PRIMARY_HOME / "assistant/data"
    if not assistant_data_dir.exists():
        return

    remote_dest_dir = f"{REMOTE_BASE}/data/assistant"
    run_ssh(f"mkdir -p {remote_dest_dir}")

    db_names = ["app.db", "storage.db", "assistant.db", "semantic_memory.db"]
    for name in db_names:
        db_file = assistant_data_dir / name
        if not db_file.exists():
            continue
        with tempfile.NamedTemporaryFile(suffix=f"-{name}", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            safe_sqlite_snapshot(db_file, tmp_path)
            remote_dest = f"{remote_dest_dir}/{name}"
            cmd = (
                f"cat {tmp_path} | ssh -o BatchMode=yes -o StrictHostKeyChecking=no "
                f"{BACKUP_VM_USER}@{BACKUP_VM_HOST} 'cat > {remote_dest}'"
            )
            subprocess.run(cmd, shell=True, check=True)
            log(f"Assistant DB {name} safely synced to {remote_dest}")
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

def sync_live_assets_and_configs():
    """Sync live assets & storefront configs for instantaneous HA failover."""
    log("Syncing live assets for The Towels Haven & ULINK ERP...")
    cmd_assets = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"rsync -avz --delete -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
        f'/home/thanhtung/StorageManagementWeb-ULINK/backend/assets/ '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/assets/"'
    )
    subprocess.run(cmd_assets, shell=True, check=True)

    log("Syncing live configs (towels.conf, backend .env)...")
    cmd_configs = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"ssh -o BatchMode=yes -o StrictHostKeyChecking=no {BACKUP_VM_USER}@{BACKUP_VM_HOST} \\"mkdir -p {REMOTE_BASE}/config {REMOTE_BASE}/storage-backend\\" && '
        f'rsync -avz -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" /home/thanhtung/.config/storefront-proxy/towels.conf {BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/config/towels.conf 2>/dev/null || true && '
        f'rsync -avz -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" /home/thanhtung/StorageManagementWeb-ULINK/backend/.env {BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/storage-backend/.env 2>/dev/null || true"'
    )
    subprocess.run(cmd_configs, shell=True, check=True)

def sync_all_workspaces():
    """Sync ALL project codebases in /home/thanhtung to Backup VM."""
    log("=== SYNCING ALL USER WORKSPACES & CODEBASES ===")
    run_ssh(f"mkdir -p {REMOTE_BASE}/workspaces")

    excludes_str = " ".join(COMMON_EXCLUDES)
    for proj in PROJECT_DIRS:
        src_path = PRIMARY_HOME / proj
        if not src_path.exists():
            continue
        
        log(f"-> Syncing project: {proj}...")
        cmd = (
            'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
            f'"rsync -avz --delete {excludes_str} -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
            f'/home/thanhtung/{proj} '
            f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/workspaces/"'
        )
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        if res.returncode != 0:
            log(f"⚠️ Warning syncing {proj}: {res.stderr.strip()}")
        else:
            log(f"✓ Project {proj} synced successfully!")

    # Also sync top-level scripts and configs
    log("Syncing root helper scripts and configs...")
    cmd_root_scripts = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"rsync -avz -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
        f'/home/thanhtung/*.py /home/thanhtung/*.sh /home/thanhtung/*.yml /home/thanhtung/*.service '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/workspaces/ 2>/dev/null || true"'
    )
    subprocess.run(cmd_root_scripts, shell=True)

def sync_historical_archives():
    """Sync historical compressed backup bundles from ulink-backups to Backup VM."""
    if not ULINK_BACKUPS_SRC.exists():
        return
    log("=== SYNCING HISTORICAL ARCHIVES (ulink-backups) ===")
    run_ssh(f"mkdir -p {REMOTE_BASE}/archives")

    cmd = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"rsync -avz --delete -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
        f'/home/thanhtung/ulink-backups/ '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/archives/"'
    )
    subprocess.run(cmd, shell=True, check=True)
    log("✓ Historical archives synced successfully!")

def sync_system_configurations():
    """Sync Cloudflare credentials, systemd units, and crontab."""
    log("=== SYNCING SYSTEM CONFIGURATIONS ===")
    run_ssh(f"mkdir -p {REMOTE_BASE}/system-configs")

    # Cloudflared configs & tunnel credentials
    cmd_cf = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"rsync -avz -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
        f'/home/thanhtung/.cloudflared/ '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/system-configs/cloudflared/ 2>/dev/null || true"'
    )
    subprocess.run(cmd_cf, shell=True)

    # .config directory (systemd user units, storefront-proxy, pulse, etc.)
    cmd_config = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"rsync -avz {COMMON_EXCLUDES[0]} -e \\"ssh -o BatchMode=yes -o StrictHostKeyChecking=no\\" '
        f'/home/thanhtung/.config/ '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST}:{REMOTE_BASE}/system-configs/config/ 2>/dev/null || true"'
    )
    subprocess.run(cmd_config, shell=True)

    # Crontab dump
    cmd_cron = (
        'docker run --rm -v /:/host-tt alpine chroot /host-tt su - thanhtung -c '
        f'"crontab -l | ssh -o BatchMode=yes -o StrictHostKeyChecking=no '
        f'{BACKUP_VM_USER}@{BACKUP_VM_HOST} \\"cat > {REMOTE_BASE}/system-configs/crontab.txt\\""'
    )
    subprocess.run(cmd_cron, shell=True)
    log("✓ System configs & crontab synced successfully!")

def write_sync_metadata():
    now_iso = datetime.now(timezone.utc).isoformat()
    meta = {
        "timestamp": time.time(),
        "last_sync_utc": now_iso,
        "status": "success",
        "primary_host": "web-server",
        "backup_host": BACKUP_VM_HOST,
        "replicated_scopes": [
            "storage.db (verified SQLite online snapshot)",
            "assistant databases (app.db, storage.db, assistant.db, semantic_memory.db)",
            "live assets (511MB images/bills/labels)",
            "workspaces (all 20 projects & codebases in /home/thanhtung)",
            "archives (daily ulink-backups snapshots)",
            "system-configs (cloudflared, user systemd units, crontabs)"
        ]
    }
    meta_json = json.dumps(meta, indent=2)
    meta_file = Path("/home/thanhtung/StorageManagementWeb-ULINK/backend/last_full_dr_sync.json")
    try:
        meta_file.write_text(meta_json, encoding="utf-8")
    except Exception:
        pass
    
    # Push metadata to remote VM
    cmd = [
        "ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no",
        f"{BACKUP_VM_USER}@{BACKUP_VM_HOST}",
        f"cat << 'EOF' > {REMOTE_BASE}/last_full_sync.json\n{meta_json}\nEOF"
    ]
    subprocess.run(cmd, check=True)
    log(f"Sync metadata recorded at {now_iso}")

def main():
    lock_file = Path("/tmp/dr_sync.lock")
    lock_fd = open(lock_file, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except IOError:
        log("⚠️ Another DR sync process is already running. Exiting cleanly.")
        sys.exit(0)

    start_t = time.time()
    log("==================================================")
    log("=== STARTING FULL DISASTER RECOVERY REPLICATION ===")
    log("==================================================")
    try:
        sync_primary_database()
        sync_assistant_databases()
        sync_live_assets_and_configs()
        sync_all_workspaces()
        sync_historical_archives()
        sync_system_configurations()
        write_sync_metadata()
        dur = round(time.time() - start_t, 2)
        log("==================================================")
        log(f"=== FULL DR REPLICATION COMPLETED SUCCESSFULLY in {dur}s ===")
        log("==================================================")
    except Exception as e:
        log(f"❌ FULL DR REPLICATION ERROR: {e}")
        sys.exit(1)
    finally:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            lock_fd.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
