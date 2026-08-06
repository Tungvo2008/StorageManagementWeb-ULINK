#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
DATA_ROOT="${DATA_ROOT:-/var/lib/catalog-studio}"
BACKUP_ROOT="${BACKUP_ROOT:-${HOME}/catalog-studio-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d)"
ARCHIVE="${BACKUP_ROOT}/catalog-studio-${TIMESTAMP}.tar.gz"

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

mkdir -p "${BACKUP_ROOT}"
mkdir -p "${WORK_DIR}/uploads"

if [[ ! -f "${DATA_ROOT}/catalog.db" ]]; then
  echo "Database not found: ${DATA_ROOT}/catalog.db" >&2
  exit 1
fi

PYTHON_BIN="${APP_ROOT}/backend/.venv/bin/python"
if [[ ! -x "${PYTHON_BIN}" ]]; then
  PYTHON_BIN="python3"
fi

"${PYTHON_BIN}" -c \
  'import sqlite3, sys; source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()' \
  "${DATA_ROOT}/catalog.db" "${WORK_DIR}/catalog.db"

if [[ -d "${DATA_ROOT}/uploads" ]]; then
  cp -R "${DATA_ROOT}/uploads/." "${WORK_DIR}/uploads/"
fi

printf 'Created: %s\nDatabase: %s\nUploads: %s\n' \
  "$(date -Iseconds)" "${DATA_ROOT}/catalog.db" "${DATA_ROOT}/uploads" \
  > "${WORK_DIR}/BACKUP_INFO.txt"

tar -czf "${ARCHIVE}" -C "${WORK_DIR}" .
echo "Backup created: ${ARCHIVE}"
