# IT GOT TALENT – Nốt nhạc Tri ân · Web bình chọn Chung Kết 15/11/2026

Một trang tổng (`/`): khán giả nhập mã để bình chọn; ban tổ chức đăng nhập để vào quản trị; màn hình LED mở link riêng có khóa.

## Chạy
- **Windows (1 nút):** giải nén gói zip → `CHAY-DEMO.bat` (thử) hoặc `CHAY.bat` (thật). Tự tạo link HTTPS công khai bằng Cloudflare tunnel.
- **Máy bất kỳ có Node ≥ 22.13:** `npm install` → `npm run demo` (thử) / `npm start`.
- `npm test` (21 test), `npm run check`.

## Triển khai miễn phí lên Render
1. Đưa mã lên GitHub → Render → New → Blueprint (dùng `render.yaml`).
2. Điền `ADMIN_PASSWORD`, `OPERATOR_PASSWORD`, và `PUBLIC_URL` (https://tên.onrender.com).
3. Dữ liệu được sao lên Postgres sau mỗi thay đổi (phiếu/thao tác chỉ báo thành công khi đã lưu), nên mất ổ đĩa vẫn khôi phục được. Khi có `DATABASE_URL` bắt buộc đặt cố định `CODE_PEPPER`, `SESSION_SECRET`.
4. **Hạn chế gói miễn phí:** tự ngủ sau 15 phút không có truy cập (đánh thức trước giờ diễn, khởi động lại ~1 phút); có thể bị restart bất kỳ lúc nào; Postgres miễn phí hết hạn sau 30 ngày; không dành cho production. Chính sách có thể thay đổi.

## Chưa kiểm chứng thực tế
Điện thoại/GPS thật, màn hình LED và âm thanh thật, bản chạy .exe trên Windows, deploy Render thật, Docker build.
