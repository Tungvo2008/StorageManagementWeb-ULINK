# Ulink Catalog Studio

Ứng dụng độc lập để quản lý dữ liệu catalog, ảnh sản phẩm và xuất PDF wholesale theo layout US Letter 4 x 3. App dùng database SQLite riêng, không đọc hoặc sửa database của Storage Management.

## Tính năng

- Quản lý product và category độc lập.
- Tab Images riêng để upload ảnh JPG, PNG hoặc WEBP tối đa 10 MB.
- Bulk upload nhiều ảnh bằng cách đặt tên file trùng SKU, ví dụ `UL10001.jpg`.
- Mỗi sản phẩm lưu tối đa 8 ảnh; có thể chọn Primary image dùng trên catalog/PDF.
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
3. Vào **Images** để thêm tối đa 8 ảnh mỗi sản phẩm, chọn ảnh Primary, hoặc dùng **Bulk upload by SKU**. Ảnh bổ sung dùng tên `SKU__2.jpg`, `SKU__3.jpg`.
4. Vào **Build catalog**, search/filter và chọn sản phẩm muốn xuất.
5. Chọn các trường cần hiện, bấm **Preview PDF** hoặc **Download PDF**.

## Dữ liệu và backup

- Local development: database ở `catalog-studio/backend/catalog.db`, ảnh ở `catalog-studio/backend/assets/uploads/`.
- Production: database ở `/var/lib/catalog-studio/catalog.db`, ảnh ở `/var/lib/catalog-studio/uploads/`.
- Cần backup cả database và thư mục ảnh.
- Các file trên đã được `.gitignore`; không nên đẩy dữ liệu thật lên GitHub.

Tạo một archive an toàn gồm SQLite database và toàn bộ ảnh:

```bash
cd ~/StorageManagementWeb-ULINK/catalog-studio
./backup.sh
```

Backup được lưu mặc định tại `~/catalog-studio-backups/`.

Khôi phục một backup:

```bash
sudo systemctl stop catalog-studio
mkdir -p /tmp/catalog-restore
tar -xzf ~/catalog-studio-backups/catalog-studio-YYYYMMDD-HHMMSS.tar.gz -C /tmp/catalog-restore
sudo cp /tmp/catalog-restore/catalog.db /var/lib/catalog-studio/catalog.db
sudo cp -R /tmp/catalog-restore/uploads/. /var/lib/catalog-studio/uploads/
sudo chown -R "$USER:$USER" /var/lib/catalog-studio
sudo systemctl start catalog-studio
```

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

Database và ảnh không nằm trong Git. Khi deploy lại, script giữ nguyên toàn bộ `/var/lib/catalog-studio/`. Vì vậy `git pull`, build frontend và restart service không xóa ảnh.
