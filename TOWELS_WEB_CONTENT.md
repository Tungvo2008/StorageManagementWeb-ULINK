# The Towels Haven: nội dung web riêng, liên kết ERP

ERP trên `webserver` đặt tại `/home/thanhtung/StorageManagementWeb-ULINK`. Mã tích hợp trực tiếp trong backend FastAPI và frontend quản trị của ERP. Website khăn nằm tại `/home/thanhtung/towels-haven`.

## Ranh giới dữ liệu

- `products` tiếp tục là nguồn chuẩn cho SKU, ngành hàng, giá, trạng thái hoạt động và tồn kho.
- `towel_web_content` chứa trạng thái đăng web, tên, mô tả ngắn, mô tả chi tiết, SEO title và SEO description riêng theo `product_id`.
- `towel_web_media` chứa nhiều ảnh riêng theo `product_id`: URL, alt text, thứ tự và cờ ảnh chính. Tệp ảnh nằm trong `backend/assets/product-images/` với tên riêng `towels-*`; không ghi đè ảnh kho dùng ở POS và hóa đơn.
- Lần đầu đã sao chép 25 ảnh SKU màu từ thư viện kho, đồng thời chuyển 3 ảnh khăn trắng tách nền vào thư viện web. 28 SKU có ảnh đã đăng; 2 SKU tổng hợp chưa có ảnh là bản nháp. Đây là lần nhập dữ liệu ban đầu, không có đồng bộ ảnh tự động sau đó.

## Quản trị

Đăng nhập ERP và mở `https://storage.thanhtungvo.id.vn/towel-web` (menu Hệ thống → Nội dung web khăn). Chọn SKU để upload nhiều ảnh PNG/JPEG/WebP tối đa 10 MB mỗi ảnh, chỉnh alt text, chọn ảnh chính, đổi thứ tự hoặc xóa. Bên dưới có ô tên, mô tả và metadata, cùng công tắc đăng/ẩn SKU. Upload ảnh web không đổi `products.image_url`.

Admin API (yêu cầu đăng nhập ERP):

- `GET /api/v1/towel-web/products`
- `GET /api/v1/towel-web/products/{product_id}`
- `PUT /api/v1/towel-web/products/{product_id}/content`
- `POST /api/v1/towel-web/products/{product_id}/media` (multipart)
- `PATCH /api/v1/towel-web/products/{product_id}/media/{media_id}`
- `DELETE /api/v1/towel-web/products/{product_id}/media/{media_id}`

Ảnh upload có alpha trong suốt được đặt tên `*-cutout-*`; ảnh không trong suốt được đặt tên `*-photo-*` để giao diện áp dụng kiểu nền phù hợp.

## API cho website

The Towels Haven gọi `/api/store/products?business_unit=TOWEL&site=towels&category_id=...`. Tham số `site=towels` chỉ trả các SKU đã đăng, với tên, mô tả, metadata và ảnh do thư viện web khăn chọn. SKU/giá/tình trạng hàng vẫn từ ERP. Khi SKU chưa có ảnh web, API trả `image_url: null`; ảnh kho không tự rơi vào web. Nếu không có `site=towels`, Storefront API giữ dữ liệu kho phục vụ Ulink.

Trang sản phẩm dùng danh sách `images` theo thứ tự quản trị, mở đầu tại ảnh đánh dấu chính. Trình duyệt cập nhật title và meta description theo dữ liệu riêng từng SKU. Nếu muốn SEO cho từng URL SKU được đọc đầy đủ bởi mọi bot mạng xã hội, cần tiếp tục tạo HTML theo SKU ở tầng server; hiện bản HTML tĩnh production vẫn theo ba dòng khăn.

## Triển khai

Backend dùng bind mount `backend/app`; sau khi sửa Python, chạy `docker compose restart storage-backend` trong repo ERP. Frontend quản trị build bằng `npm run build` trong `frontend/`; `dist/` được mount vào Nginx. Web khăn preview build bằng `docker compose -f compose.yaml -f compose.tunnel.yaml up -d --build towels-web`; production build bằng `docker compose -f compose.production.yaml up -d --build towels-web-production`.

Sao lưu trước và sau khi tích hợp ở `/home/thanhtung/migration-backups/towels-web-content-20261007/`, gồm bản DB, tar mã nguồn cũ và tar ảnh web sau triển khai. Khi sao lưu về sau cần giữ cả `backend/storage.db` lẫn `backend/assets/product-images/` vì DB chỉ giữ đường dẫn ảnh.
