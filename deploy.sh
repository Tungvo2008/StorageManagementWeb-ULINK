#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
WEB_ROOT="${WEB_ROOT:-/var/www/storage}"
BACKEND_SERVICE="${BACKEND_SERVICE:-storage-backend}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"
VITE_API_BASE_URL_VALUE="${VITE_API_BASE_URL_VALUE:-}"
APP_VERSION="${APP_VERSION:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"

echo "==> Pull latest code"
git -C "$ROOT_DIR" pull --rebase

echo "==> Backend deploy"
cd "$BACKEND_DIR"
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart "$BACKEND_SERVICE"

echo "==> Frontend deploy"
cd "$FRONTEND_DIR"
if [[ -n "$VITE_API_BASE_URL_VALUE" ]]; then
  printf "VITE_API_BASE_URL=%s\n" "$VITE_API_BASE_URL_VALUE" > .env.production
else
  printf "VITE_API_BASE_URL=\n" > .env.production
fi
printf "VITE_APP_VERSION=%s\n" "$APP_VERSION" >> .env.production
npm ci
npm run build

sudo mkdir -p "$WEB_ROOT"
sudo find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
sudo cp -R dist/. "$WEB_ROOT/"
sudo systemctl reload "$NGINX_SERVICE"

echo "==> Done"
