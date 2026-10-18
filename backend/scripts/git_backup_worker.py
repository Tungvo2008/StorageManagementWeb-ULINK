#!/usr/bin/env python3
"""
Host Git Backup Worker
Automatically inspects all projects in /home/thanhtung, stages changes,
creates commits if code changed, and attempts git push to origin/main.
"""
import os
import sys
import subprocess
from datetime import datetime
from pathlib import Path

PRIMARY_HOME = Path("/home/thanhtung")
LOG_FILE = PRIMARY_HOME / "logs/git_backup.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

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

def log(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass

def main():
    log("==================================================")
    log("🚀 Starting Host Git Repositories Versioning & Push Check")
    log("==================================================")
    
    success_count = 0
    pending_auth_count = 0
    clean_count = 0
    
    for proj in WORKSPACE_PROJECTS:
        p = PRIMARY_HOME / proj
        git_dir = p / ".git"
        if not git_dir.exists():
            continue
            
        try:
            # 1. Check for uncommitted changes
            st = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(p),
                capture_output=True,
                text=True
            )
            
            if st.stdout.strip():
                log(f"Project '{proj}' has modifications. Auto-committing...")
                subprocess.run(["git", "add", "-A"], cwd=str(p), check=True)
                commit_msg = f"chore(backup): auto-commit sync {datetime.now().strftime('%Y-%m-%d %H:%M')}"
                subprocess.run(
                    ["git", "-c", "user.name=tungvo2008", "-c", "user.email=thanhtungvo20082006@gmail.com", "commit", "-m", commit_msg],
                    cwd=str(p),
                    check=True
                )
                log(f"✓ Committed changes in '{proj}'.")
            else:
                clean_count += 1
            
            # 2. Check remote and attempt push
            rem = subprocess.run(["git", "remote", "-v"], cwd=str(p), capture_output=True, text=True)
            if "origin" in rem.stdout:
                if "https://github.com/Tungvo2008/" in rem.stdout:
                    subprocess.run(["git", "remote", "set-url", "origin", f"git@github.com:Tungvo2008/{proj}.git"], cwd=str(p))
                push_res = subprocess.run(
                    ["git", "push", "origin", "main"],
                    cwd=str(p),
                    capture_output=True,
                    text=True,
                    env=dict(os.environ, GIT_TERMINAL_PROMPT="0")
                )
                if push_res.returncode == 0:
                    log(f"✓ '{proj}' pushed successfully to GitHub origin/main")
                    success_count += 1
                else:
                    err = push_res.stderr.strip().splitlines()[-1] if push_res.stderr.strip() else "Auth required"
                    log(f"⚠️ '{proj}' git push skipped ({err})")
                    pending_auth_count += 1
            else:
                log(f"ℹ️ '{proj}' is tracked locally on main (no remote 'origin' configured yet).")
        except Exception as e:
            log(f"❌ Error processing repository '{proj}': {e}")
            
    log(f"Git check complete: {clean_count} repos clean, {success_count} pushed, {pending_auth_count} pending GitHub authentication.")

if __name__ == "__main__":
    main()
