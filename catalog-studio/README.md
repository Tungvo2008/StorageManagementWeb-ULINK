# Ulink Catalog Studio

Ứng dụng độc lập để quản lý dữ liệu catalog, ảnh sản phẩm và xuất PDF wholesale theo layout US Letter 4 x 3. App dùng database SQLite riêng, không đọc hoặc sửa database của Storage Management.

## Tính năng

- Quản lý product và category độc lập.
- Upload ảnh JPG, PNG hoặc WEBP tối đa 10 MB.
- Tải template Excel và import hàng loạt.
- SKU đã tồn tại được cập nhật; SKU trống được tạo tự động từ tên.
- Chọn sản phẩm trực quan theo search, category và tồn kho.
- Preview layout ngay trên web và mở PDF preview ở tab mới.
- PDF Letter 12 sản phẩm/trang, tự chia trang/category và nén ảnh để file nhẹ.

## Chạy backend

```bash
cd catalog-studio/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

API docs: `http://localhost:8001/docs`.

## Chạy frontend

```bash
cd catalog-studio/frontend
npm install
cp .env.example .env
npm run dev
```

Mở `http://localhost:5174`.

## Quy trình sử dụng

1. Vào **Products**, tải **Excel template**.
2. Điền sản phẩm rồi bấm **Import Excel**. Nếu SKU đã có, dữ liệu sản phẩm đó sẽ được cập nhật.
3. Upload/replace ảnh trực tiếp trên từng product card.
4. Vào **Build catalog**, search/filter và chọn sản phẩm muốn xuất.
5. Chọn các trường cần hiện, bấm **Preview PDF** hoặc **Download PDF**.

## Dữ liệu và backup

- Database mặc định: `catalog-studio/backend/catalog.db`.
- Ảnh gốc: `catalog-studio/backend/assets/uploads/`.
- Cần backup cả database và thư mục ảnh.
- Các file trên đã được `.gitignore`; không nên đẩy dữ liệu thật lên GitHub.

## Deploy

App có bộ deploy riêng cho cấu hình sau:

- Public URL: `https://catalog.thanhtungvo.id.vn`
- FastAPI: `127.0.0.1:8001`
- Nginx origin: `127.0.0.1:8081`
- Frontend: `/var/www/catalog-studio`

Sau khi push code và pull trên server:

```bash
cd ~/StorageManagementWeb-ULINK/catalog-studio
chmod +x deploy.sh
./deploy.sh
```

Nếu dùng subdomain khác:

```bash
PUBLIC_URL=https://catalog.example.com ./deploy.sh
```

Trong Cloudflare Zero Trust, mở tunnel đang chạy cho `sale-web`, chọn **Published application routes** và thêm:

- Subdomain: `catalog`
- Domain: `thanhtungvo.id.vn`
- Type: `HTTP`
- URL/origin: `localhost:8081`

Không cài thêm `cloudflared service`; một tunnel đang chạy có thể phục vụ nhiều hostname.

Kiểm tra trên server:

```bash
sudo systemctl status catalog-studio --no-pager
sudo systemctl status nginx --no-pager
curl http://127.0.0.1:8001/api/health
curl -I http://127.0.0.1:8081
```

Database và ảnh không nằm trong Git. Khi deploy lại, script giữ nguyên `backend/catalog.db`, `backend/.env` và `backend/assets/uploads/`.
