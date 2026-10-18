# 📋 KẾ HOẠCH TRIỂN KHAI: QUẢN LÝ HẠN SỬ DỤNG (EXPIRY DATE) & LÔ HÀNG (BATCH/LOT)
**Hệ thống:** ERP ULINK (`storage.thanhtungvo.id.vn`)  
**Mục tiêu:** Quản lý Date cho các đợt container thực phẩm/gia vị/hàng xá nhập về kho Dallas, hỗ trợ kế thừa Date khi đóng gói (Repack) và xuất kho tự động theo chuẩn FEFO.

---

## 🎯 1. Bài Toán Nghiệp Vụ Thực Tế
1. **Tránh "ảo date" khi cont mới về:**
   - Không lưu hạn sử dụng (Expiry Date) trực tiếp trên bảng `products`.
   - Một sản phẩm (vd: Chuối Cau Sấy hoặc Nước Mắm) có nhiều lô nhập khác nhau (Cont tháng 8: Date 15/08/2027; Cont tháng 10: Date 20/12/2027).
   - Quản lý theo cấu trúc: `Product` 1 ── N `Batches / Lots`.

2. **Kế thừa Date khi đóng gói (Repack Flow):**
   - Hàng xá (Bulk/Raw) nhập về bao 50kg (Date D).
   - Khi chia ra đóng hũ 200g, **Date in trên tem hũ tự động lấy bằng Date D của bao gốc**.
   - Truy vết nguồn gốc (Traceability): Mã lô thành phẩm `PKG-xxxx` liên kết ngược lại bao hàng xá gốc.

3. **Xuất kho tự động FEFO (First Expired, First Out):**
   - Khi tạo đơn bán (Invoice / Sale Order), hệ thống tự động trừ vào Lô có Date gần nhất trước.
   - Phiếu xuất kho chỉ rõ lấy hàng từ Lô nào, kệ nào để nhân viên bốc đúng hàng.

4. **Cảnh báo cận Date (Near-Expiry Alert):**
   - Tự động cảnh báo các lô còn <= 30 ngày (Đỏ), <= 60 ngày (Vàng).
   - Zen bot có thể tra cứu nhanh: `Zen ơi check hàng cận date`.

---

## 🗄️ 2. Thiết Kế Cơ Sở Dữ Liệu (`storage.db`)

### Bảng: `inventory_batches`
- `batch_code`: Mã lô (vd: `LOT-202610-FOD01`, `PKG-261007-01`)
- `product_id`: Liên kết bảng `products`
- `expiration_date`: Hạn sử dụng
- `manufacture_date`: Ngày sản xuất (tùy chọn)
- `initial_quantity`: Số lượng ban đầu nhập/đóng gói
- `quantity_on_hand`: Số lượng tồn thực tế còn lại
- `inbound_reference`: Số Cont, Phiếu Nhập, hoặc Mã Lệnh Repack
- `storage_location`: Vị trí: Kệ A1, Pallet 04...
- `status`: ACTIVE, DEPLETED, EXPIRED

---

## 🛠️ 3. Lộ Trình Triển Khai (Kế Hoạch Thực Hiện)
- [ ] **Giai đoạn 1 (Core DB & Migration):** DDL bảng `inventory_batches`, Model SQLAlchemy, Logic trừ kho FEFO.
- [ ] **Giai đoạn 2 (Repack Flow Integration):** Kế thừa tự động Date từ hàng xá sang thành phẩm.
- [ ] **Giai đoạn 3 (UI & Zen Bot Alert):** Màn hình quản lý Lô trên ERP, công cụ cảnh báo cận date cho Zen Bot trên Telegram.
