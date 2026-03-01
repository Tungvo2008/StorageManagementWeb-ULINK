# Storage Management Web (Backend)

Backend API viết bằng FastAPI (Python) cho phần mềm quản lý kho, bán hàng và xuất hoá đơn.

## Yêu cầu

- Python 3.11+ (khuyến nghị 3.13)

## Cài đặt (dev)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Mặc định API chạy tại `http://localhost:8000` và tài liệu Swagger ở `http://localhost:8000/docs`.

> Lưu ý: nếu bạn đã có `storage.db` cũ (schema khác), hãy xoá file `backend/storage.db` hoặc chạy import với `--reset-db`.

## Cấu hình

Sửa file `.env` (tham khảo `.env.example`).

## Export invoice theo mẫu Excel (.xlsm)

1. Set trong `.env`:

```
INVOICE_TEMPLATE_XLSM_PATH=/Users/thanhtungvo/ULINK INVOICE/Mau_Invoice.xlsm
INVOICE_PREFIX=UL
INVOICE_NUMBER_DIGITS=4
```

2. Tải invoice:

- XLSM: `GET /api/v1/invoices/{id}/xlsm`

## Import dữ liệu từ `Storage Management.xlsm`

```bash
cd backend
source .venv/bin/activate
python scripts/import_storage_management.py --file "/Users/thanhtungvo/Storage Management.xlsm" --reset-db
```
