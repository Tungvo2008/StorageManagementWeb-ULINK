#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
APP_USER="${APP_USER:-$(id -un)}"
PUBLIC_URL="${PUBLIC_URL:-https://catalog.thanhtungvo.id.vn}"
WEB_ROOT="${WEB_ROOT:-/var/www/catalog-studio}"
DATA_ROOT="${DATA_ROOT:-/var/lib/catalog-studio}"

echo "==> Deploying Catalog Studio from ${APP_ROOT}"

cd "${APP_ROOT}/backend"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -r requirements.txt
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

sudo mkdir -p "${DATA_ROOT}/uploads"
sudo chown -R "${APP_USER}:${APP_USER}" "${DATA_ROOT}"

if [[ -f "${APP_ROOT}/backend/catalog.db" && ! -f "${DATA_ROOT}/catalog.db" ]]; then
  cp "${APP_ROOT}/backend/catalog.db" "${DATA_ROOT}/catalog.db"
fi
if [[ -d "${APP_ROOT}/backend/assets/uploads" && -z "$(find "${DATA_ROOT}/uploads" -mindepth 1 -print -quit)" ]]; then
  cp -R "${APP_ROOT}/backend/assets/uploads/." "${DATA_ROOT}/uploads/"
fi

set_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -q "^${key}=" "${file}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

set_env "DATABASE_URL" "sqlite:////${DATA_ROOT#/}/catalog.db" .env
set_env "UPLOAD_DIR" "${DATA_ROOT}/uploads" .env

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
echo "    Data folder:  ${DATA_ROOT}"
echo "    Add the Cloudflare published application route to http://localhost:8081 if it is not configured yet."
