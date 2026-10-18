#!/usr/bin/env bash
# Enterprise Unified Backup Orchestrator
# Runs Git code versioning & push check + Google Drive cloud sync
set -e

TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
LOG_FILE="/home/thanhtung/logs/unified_backup_service.log"
mkdir -p /home/thanhtung/logs

echo "==================================================" >> "$LOG_FILE"
echo "[$TIMESTAMP] 🚀 Launching Scheduled Enterprise Backup" >> "$LOG_FILE"
echo "==================================================" >> "$LOG_FILE"

# Step 1: Git auto-commit and push check for all projects on host
if [ -f "/home/thanhtung/scripts/git_backup_worker.py" ]; then
    echo "[$TIMESTAMP] Running Git backup worker on host..." >> "$LOG_FILE"
    /usr/bin/python3 /home/thanhtung/scripts/git_backup_worker.py >> "$LOG_FILE" 2>&1 || true
fi

# Step 2: Google Drive cloud sync (Databases, Meet videos, Recorder App media, Code archives)
if [ -f "/home/thanhtung/scripts/unified_backup.py" ]; then
    echo "[$TIMESTAMP] Running Google Drive sync via assistant container..." >> "$LOG_FILE"
    docker run --rm \
      -v /home/thanhtung:/home/thanhtung \
      -v /home/thanhtung/assistant/data:/app/data \
      -v /home/thanhtung/assistant/bot:/app/bot \
      -v /home/thanhtung/assistant/utils:/app/utils \
      assistant-assistant:latest python3 /home/thanhtung/scripts/unified_backup.py >> "$LOG_FILE" 2>&1 || true
fi

FINISH_TIME=$(date +"%Y-%m-%d %H:%M:%S")
echo "[$FINISH_TIME] ✅ Scheduled Backup Pipeline Finished." >> "$LOG_FILE"
