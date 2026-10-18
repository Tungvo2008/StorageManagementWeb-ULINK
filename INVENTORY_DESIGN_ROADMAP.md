# TÀI LIỆU THIẾT KẾ & ĐỊNH HƯỚNG PHÁT TRIỂN HỆ THỐNG KHO (INVENTORY ROADMAP)

> **LƯU Ý:** Đây là tài liệu nguồn chuẩn (Source of Truth) ghi lại toàn bộ yêu cầu, định hướng kiến trúc và lộ trình tính năng do chủ hệ thống đặt ra. Mọi lần phát triển tiếp theo hoặc khi hỏi lại AI bot, hãy tham chiếu trực tiếp nội dung trong file này.

---

## 1. TỔNG QUAN KIẾN TRÚC & NGUYÊN TẮC CỐT LÕI

Hệ thống quản lý kho được phân định rõ ràng thành các phân hệ độc lập về mặt chức năng nhưng đồng bộ chặt chẽ về dữ liệu:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        KIẾN TRÚC HỆ THỐNG KHO                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [1. TỒN KHO (/inventory)]          [2. NHẬP KHO (/receipts)]          │
│  - Chuyên kiểm tra tồn tức thời     - Hub chuyên tạo & quản lý         │
│  - Tra cứu siêu nhanh, trực quan      các quy trình nhập kho           │
│  - Báo động hết hàng/âm kho         - Handle nhiều loại hàng           │
│                                                                        │
│  [3. LỊCH SỬ KHO (/stock-history)]  [4. HÓA ĐƠN & BÁN HÀNG]            │
│  - Sổ cái chung 1 bảng duy nhất     - Đồng bộ kho tự động (/invoices) │
│  - Trình tự thời gian In/Out        - Hàng sang tay (Free): KO trừ kho │
│  - Nguồn: Receipt, Issue, Invoice   - Hàng kho (Product): Trừ chuẩn    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Nguyên tắc bất biến (System Invariants)
1. **Phân loại Hóa đơn & Bán hàng:**
   - **Hàng kho (`line_type = "PRODUCT"`):** Hàng có trong kho vật lý (khăn, khô bò, kẹo atiso...). Khi hóa đơn `ISSUED` hoặc `PAID`, **bắt buộc tự động trừ tồn kho** theo đơn vị quy đổi (`uom_multiplier`), sinh `StockMovement OUT` và tạo phiếu xuất kho `InventoryIssue`. Sửa số lượng tự bù trừ delta, hủy/xóa hóa đơn tự hoàn trả lại kho 100%.
   - **Hàng sang tay / Drop-ship (`line_type = "FREE"`):** Bán thẳng từ container ngoài cảng hoặc sang tay cho chợ (như nước ngọt cont, máy làm bánh...). **Tuyệt đối không trừ tồn kho vật lý**.
2. **Sổ cái chuyển động kho đơn nhất (`StockMovement`):**
   - Mọi biến động tăng/giảm tồn kho (Nhập hàng, Xuất hàng, Bán hàng, Điều chỉnh kiểm kê) đều ghi vào bảng `stock_movements`.
   - Mỗi bản ghi liên kết rõ nguồn gốc: `receipt_id`, `issue_id`, `invoice_id`, hoặc `sale_order_id`.

---

## 2. LỘ TRÌNH PHÂN HỆ NHẬP KHO (`/receipts`)

**Mục tiêu:** Tách riêng thành một Tab chuyên biệt để dần dần thiết kế luồng hoàn chỉnh xử lý tất cả các quy trình nhập hàng thực tế:

### Các quy trình nhập cần chuẩn hóa trong tương lai:
1. **Quy trình Nhập Container Tiêu Chuẩn (Standard Container / FCL):**
   - Nhập theo Packing List nhà cung cấp (Khăn, Dép, Hộp xốp, Bao bì nylon...).
   - Kiểm đếm số kiện (Cartons/Bales), quy đổi ra đơn vị cơ sở (`base_uom`).
   - Ghi nhận chi phí container, phân bổ giá vốn nhập kho (`cost_price`).

2. **Quy trình Nhập Hàng Bách Hóa / Đồ Ăn Vặt (Snacks & Grocery):**
   - Quản lý theo Hạn sử dụng (Expiry Date) và Số lô sản xuất (Batch/Lot Number).
   - Quản lý cảnh báo date cận hạn để ưu tiên xuất trước (FEFO / FIFO).
   - Hỗ trợ nhập lẻ từng thùng, lốc, gói hoặc nhập theo kiện lớn.

3. **Quy trình Nhập Hàng Xá (Bulk Goods):**
   - Hàng nhập dạng rời, bao tải lớn (nguyên liệu, hàng kg, hàng chưa đóng gói bao bì bán lẻ).
   - Quản lý hao hụt vận chuyển/bốc dỡ khi nhập kho.

4. **Quy trình Đóng Gói / San Chiết / Combo (Repacking & Assembly):**
   - **Từ Hàng xá $\rightarrow$ Đóng gói thành phẩm:** Xuất kho hàng xá $\rightarrow$ đóng vào túi/hộp có nhãn mác $\rightarrow$ Nhập kho thành phẩm SKU bán lẻ.
   - **Tạo Combo / Giỏ quà / Set:** Xuất nhiều mặt hàng thành phần $\rightarrow$ Nhập kho 1 SKU Combo hoàn chỉnh.

---

## 3. LỘ TRÌNH THIẾT KẾ PHÂN HỆ TỒN KHO (`/inventory`)

**Mục tiêu:** Chỉ chuyên biệt phục vụ việc **tra cứu và kiểm soát tồn kho tức thời** sao cho người dùng tìm thấy thông tin nhanh nhất và trực quan nhất:

### Các yêu cầu thiết kế giao diện:
1. **Tìm kiếm tức thì & Bộ lọc linh hoạt:**
   - Gõ tìm kiếm ngay theo SKU, Tên sản phẩm, Tên danh mục, Barcode.
   - Lọc nhanh: Tất cả / Còn hàng / Sắp hết hàng (Low stock) / Hết hàng / Âm kho.
2. **Hiển thị trực quan:**
   - Xem tồn kho theo cả 2 đơn vị: Đơn vị cơ sở (`base_uom` như Cái, Gói) và Đơn vị bán lẻ (`uom` như Thùng, Dozen, Lốc).
   - Hiển thị ảnh đại diện sản phẩm để nhận diện mặt hàng trong tích tắc.
3. **Thao tác nhanh tại chỗ:**
   - Xem nhanh lịch sử xuất nhập gần nhất của sản phẩm ngay tại dòng đó.
   - Nút kiểm kê/điều chỉnh tồn kho nhanh (Quick Stock Adjustment) có ghi chú lý do.

---

## 4. PHÂN HỆ LỊCH SỬ KHO (`/stock-history`)

**Mục tiêu:** Toàn bộ lịch sử Nhập (IN) - Xuất (OUT) - Điều chỉnh (ADJUST) nằm chung trên **1 bảng duy nhất**, sắp xếp giảm dần theo thời gian thực để đối soát chuẩn xác:

### Tính năng cốt lõi:
1. **Hiển thị đồng nhất:**
   - Cột Thời gian (`created_at`) hiển thị rõ ngày giờ chính xác.
   - Cột Loại giao dịch (`Type`): Huy hiệu màu phân biệt trực quan:
     - 📥 **Nhập (IN)**: Màu xanh lá cây.
     - 📤 **Xuất (OUT)**: Màu đỏ hồng.
     - ⚙️ **Điều chỉnh (ADJUST)**: Màu cam vàng.
   - Cột Chênh lệch (`Delta`):
     - Số dương `+X` màu xanh (tăng tồn).
     - Số âm `-X` màu đỏ (giảm tồn).
   - Cột Nguồn gốc (`Source`): Nêu rõ và gắn link tới chứng từ gốc:
     - Phiếu nhập `#ID` (`receipt_id`)
     - Phiếu xuất `#ID` (`issue_id`)
     - Hóa đơn `#ID` (`invoice_id`)
     - Đơn bán `#ID` (`sale_order_id`)
2. **Bộ lọc nhanh trên thanh công cụ:**
   - Nút bấm chuyển nhanh: `Tất cả` | `📥 Nhập (IN)` | `📤 Xuất (OUT)` | `⚙️ Điều chỉnh (ADJUST)`.
   - Ô tìm kiếm linh hoạt theo SKU, tên sản phẩm, số chứng từ, hoặc ghi chú.
