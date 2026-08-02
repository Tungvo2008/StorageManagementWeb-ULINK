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

Trong development, Vite proxy các request `/api` sang backend tại `http://127.0.0.1:8000` để tránh CORS. `VITE_API_BASE_URL` chỉ được dùng cho production build.
