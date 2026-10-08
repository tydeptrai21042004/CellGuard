# 01 — Hướng dẫn triển khai Vercel chi tiết

> Mục tiêu: người không chuyên DevOps có thể triển khai trang web này từ GitHub trong vài bước, không cần Docker, database, tài khoản RPC hoặc API key.

## A. Kiến trúc triển khai thực tế

- Toàn bộ file web nằm trong `site/`.
- `vercel.json`: `framework: null` (Other), `buildCommand: null` (không build), `installCommand: ""` (không chạy install) và `outputDirectory: "site"`.
- Không dùng npm package bên ngoài. Tệp `.mjs` được trình duyệt tải trực tiếp dưới dạng ES modules.
- `docs/`, `tests/`, `scripts/` không được publish vì output directory chỉ là `site/`.
- Toàn bộ phân tích chạy trong trình duyệt; trang web vẫn có thể hoạt động mà không có blockchain node.

## B. Cách 1 — GitHub → Vercel (KHUYẾN NGHỊ)

1. Giải nén ZIP để có thư mục `cellguard-web/`. **Không chỉ upload ZIP như một file trong GitHub repository.**
2. Tạo GitHub repository mới, ví dụ `cellguard-web`, và upload **nội dung bên trong** `cellguard-web/` (trong root repository phải thấy `vercel.json`, `package.json`, `site/`, `docs/`).
3. Mở [vercel.com/new](https://vercel.com/new), đăng nhập và chọn **Import Git Repository**.
4. Cho phép Vercel truy cập repository, chọn `cellguard-web`.
5. Trong phần Project Settings lúc import, kiểm tra:

   | Setting | Giá trị |
   |---|---|
   | Framework Preset | **Other** |
   | Root Directory | `.` (gốc repository) |
   | Build Command | **trống / disabled** |
   | Install Command | **trống / disabled** |
   | Output Directory | `site` |
   | Environment Variables | **Không cần** |

6. Nhấn **Deploy**. Vercel sẽ xuất bản các file trong `site/`. Tên miền preview/production do Vercel cung cấp, không có URL cố định trong ZIP.
7. Truy cập website, bấm **Ví dụ đạt** → **Phân tích giao dịch**; kết quả dự kiến `Configured checks passed`. Bấm **Ví dụ lỗi** → kết quả `Policy checks failed` với các lỗi `CAPACITY_INSUFFICIENT`, `POLICY_DATA_TOO_LARGE`, `POLICY_LOCK_NOT_ALLOWED`.
8. Khi chỉnh sửa GitHub và push lại, Vercel tự deploy phiên bản mới nếu Git integration vẫn bật.

**Lưu ý:** Nếu UI Vercel đã tự đọc `vercel.json`, giá trị Framework/Output có thể được tự điền. Kiểm tra chúng trước khi Deploy. Nếu có lỗi build script, vào Project → Settings → Build and Deployment và đảm bảo framework **Other**, build command trống, output directory `site`; Redeploy.

## C. Cách 2 — Vercel Drop (không cần Git)

1. Mở [vercel.com/drop](https://vercel.com/drop).
2. Sau khi giải nén ZIP, kéo **thư mục `site/`** (không phải thư mục chứa toàn bộ repository) vào giao diện.
3. Chọn tên project và Deploy. Trang sẽ được host như một website static.
4. Cách này dễ để demo nhanh, nhưng header bảo mật trong `vercel.json` nằm ngoài thư mục `site/` sẽ không được áp dụng đầy đủ. Muốn kiểm soát cấu hình nghiêm túc, dùng Cách 1.

## D. Chạy tại máy cá nhân

Có Node.js 20+:

```bash
cd cellguard-web
npm run dev
# Local URL: http://localhost:3000
```

**Không cần `npm install`.** Khi chạy file `.html` trực tiếp bằng `file://`, trình duyệt có thể chặn ES modules, nên phải chạy local HTTP server.

Kiểm thử:

```bash
npm run check
# includes static layout/syntax checks and Node built-in unit tests
```

## E. Debug Vercel

| Hiện tượng | Nguyên nhân thường gặp | Cách sửa |
|---|---|---|
| Trang 404 | Output Directory nhầm, ví dụ `public` hoặc `.` | Chỉnh output directory thành `site` và redeploy |
| Deploy báo không tìm thấy build command | Project Settings ghi build command cũ | Chọn framework Other, override build command rỗng |
| CSS/JS 404 | Đặt `site/` vào thư mục lồng không đúng | Root phải chứa `site/index.html` và `site/assets/` |
| File JS tải thành text hoặc lỗi module | Sai MIME type / server tự viết | Trên Vercel dùng static hosting; local dùng `npm run dev` |
| Import JSON không phân tích | JSON sai hoặc outputs_data không khớp outputs | Kiểm tra trường JSON, chạy mẫu có sẵn |
| Kết quả “pass” nhưng transaction chưa gửi được | App **không** chạy consensus / chữ ký | Dùng script simulator và RPC chính thống cho validation khác |
| Không thấy cập nhật từ GitHub | Sai branch / thiếu quyền Git Integration | Kiểm tra Deployments và commit hash |
| CSP chặn thư viện CDN mới thêm | Chính sách `connect-src 'none'`, `script-src 'self'` | Không thêm CDN vào MVP; đánh giá rủi ro và CSP trước khi mở rộng |

## F. Quy tắc production

- Không nhập private key, seed phrase hoặc unsigned transaction chứa dữ liệu bí mật.
- Không gắn nhãn report như chứng nhận bảo mật hay xác thực chain.
- Không thêm module remote analytics làm lộ transaction/policy mà chưa có thông báo rõ ràng.
- Tất cả fixtures trong repo hiện là ví dụ giả lập, **không phải giao dịch testnet thực**.
- Sau khi thêm tính năng RPC, phải xử lý response lỗi, reorg, rate limiting, timeout, host allowlist và trạng thái dữ liệu cũ; xem tài liệu `05_BAO_MAT_VA_GIOI_HAN.md`.

## Nguồn chính thức

- https://vercel.com/docs/builds/configure-a-build
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/i/deploy-to-vercel-without-git
