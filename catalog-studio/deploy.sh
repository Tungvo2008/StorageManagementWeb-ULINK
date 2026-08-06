#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
APP_USER="${APP_USER:-$(id -un)}"
PUBLIC_URL="${PUBLIC_URL:-https://catalog.thanhtungvo.id.vn}"
WEB_ROOT="${WEB_ROOT:-/var/www/catalog-studio}"

echo "==> Deploying Catalog Studio from ${APP_ROOT}"

cd "${APP_ROOT}/backend"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -r requirements.txt
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

cd "${APP_ROOT}/frontend"
npm install
VITE_API_BASE_URL="${PUBLIC_URL}" npm run build
sudo mkdir -p "${WEB_ROOT}"
sudo cp -R dist/. "${WEB_ROOT}/"

sed \
  -e "s|__APP_ROOT__|${APP_ROOT}|g" \
  -e "s|__APP_USER__|${APP_USER}|g" \
  "${APP_ROOT}/deploy/catalog-studio.service.template" \
  | sudo tee /etc/systemd/system/catalog-studio.service >/dev/null

sudo cp "${APP_ROOT}/deploy/nginx-catalog-studio.conf" /etc/nginx/sites-available/catalog-studio
sudo ln -sfn /etc/nginx/sites-available/catalog-studio /etc/nginx/sites-enabled/catalog-studio

sudo systemctl daemon-reload
sudo systemctl enable --now catalog-studio
sudo nginx -t
sudo systemctl reload nginx

echo "==> Catalog Studio deployed"
echo "    Local origin: http://127.0.0.1:8081"
echo "    Public URL:   ${PUBLIC_URL}"
echo "    Add the Cloudflare published application route to http://localhost:8081 if it is not configured yet."
