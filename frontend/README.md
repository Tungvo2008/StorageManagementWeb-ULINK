# Storage Management Web (Frontend)

React (Vite) UI tối giản để thao tác:

- Products
- Customers
- Sales (tạo đơn bán và trừ tồn kho)
- Invoices (xem HTML / tải PDF)

## Chạy dev

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

- Dev: nếu chưa set `VITE_API_BASE_URL`, UI mặc định gọi `http://localhost:8000`.
- Production: nếu chưa set `VITE_API_BASE_URL`, UI gọi same-origin (`/api/...`) để tránh mixed-content.
- Nếu chạy trang bằng `https://...` mà `VITE_API_BASE_URL` là `http://...`, UI sẽ tự fallback về same-origin.
