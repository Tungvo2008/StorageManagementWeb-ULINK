# StorageManagementWeb

MVP phần mềm **quản lý kho**, **bán hàng** và **xuất hoá đơn (invoice)**.

## Kiến trúc

- `backend/`: FastAPI + SQLAlchemy (SQLite mặc định)
- `frontend/`: React (Vite) gọi API và tải invoice (HTML/PDF)

## Chạy local (dev)

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API: `http://localhost:8000` (Swagger: `http://localhost:8000/docs`)

> Nếu đã có `backend/storage.db` cũ, hãy xoá hoặc chạy import với `--reset-db`.

### 2) Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Web: `http://localhost:5173`

## Luồng thao tác (MVP)

1. Tạo `Products`
2. (Tuỳ chọn) Tạo `Customers`
3. Tạo `Sales` (CONFIRMED sẽ tự trừ tồn kho)
4. Issue `Invoice` từ Sale
5. Xuất invoice:
   - HTML: mở và Print/Save PDF trên trình duyệt
   - PDF: tải trực tiếp từ API
   - XLSM: xuất theo mẫu Excel (cần cấu hình `INVOICE_TEMPLATE_XLSM_PATH` trong `backend/.env`)

## Import từ Excel (tuỳ chọn)

Nếu trước đây bạn quản lý bằng file `Storage Management.xlsm`, có thể import vào SQLite:

```bash
cd backend
source .venv/bin/activate
python scripts/import_storage_management.py --file "/Users/thanhtungvo/Storage Management.xlsm" --reset-db
```

## Deploy chuẩn lên server

Trên server, sau khi `git pull`, chỉ cần chạy:

```bash
cd ~/StorageManagementWeb-ULINK
bash deploy.sh
```

Mặc định script sẽ:

1. `git pull --rebase`
2. cài backend dependencies và restart `storage-backend`
3. build frontend bằng `npm ci && npm run build`
4. copy `dist/` vào `/var/www/storage`
5. reload `nginx`

Nếu muốn build frontend trỏ sang API khác, truyền thêm biến:

```bash
VITE_API_BASE_URL_VALUE=https://storage.thanhtungvo.id.vn bash deploy.sh
```

# StorageManagementWeb-ULINK
