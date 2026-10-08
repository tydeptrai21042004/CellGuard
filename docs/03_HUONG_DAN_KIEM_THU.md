# 03 — Kiểm thử MVP / QA và acceptance

## 1. Lệnh QA

Từ root:

```bash
npm run check
# kiểm tra cấu trúc static, vercel.json, syntax JS, các node:test
```

Có thể chạy riêng:

```bash
npm test
node --check site/assets/lib/ckb.mjs
npm run dev
```

## 2. Acceptance test qua trình duyệt

1. Truy cập web (local hoặc Vercel).
2. Nhấn **Ví dụ đạt**, nhấn **Phân tích giao dịch**. Kết quả: `Configured checks passed` với 0 error, 0 warning. Output 0 occupied 61 CKB; output 1 occupied 63 CKB.
3. Nhấn **Ví dụ lỗi**, nhấn **Phân tích giao dịch**. Kết quả: `Policy checks failed`, thấy ít nhất `CAPACITY_INSUFFICIENT`, `POLICY_DATA_TOO_LARGE`, `POLICY_LOCK_NOT_ALLOWED`.
4. Nhấn **Tải JSON report**. Kiểm tra file có `schemaVersion`, `result`, `findings`, `outputs`, `disclaimer`.
5. Sửa policy `maxOutputs` xuống `1`. Nếu transaction có 2+ outputs, phải có `POLICY_MAX_OUTPUTS`.
6. Nhập `outputs_data` ít hơn `outputs`: UI phải báo invalid input, không hiển thị report cũ như đã hợp lệ.
7. Nhập dữ liệu script sai `code_hash` hoặc `args` lẻ hex; UI phải báo format error.
8. Kiểm tra mobile 360px: 2 panels stack, không bị cắt vùng nút phân tích; kết quả table có horizontal scroll.
9. Dùng DevTools Network: ngoài tải các file site, không có RPC, analytics, POST hay network calls do ứng dụng khởi tạo.
10. Sau khi thay input, nút download phải disabled cho đến khi phân tích lại.

## 3. Ma trận kiểm thử mở rộng đề nghị

| Test | Input | Expected |
|---|---|---|
| Empty outputs | `[]` | invalid input (demo rule) |
| Mismatched arrays | outputs ≠ outputs_data length | invalid input |
| Bad capacity hex | capacity không bắt đầu `0x` | invalid input |
| u64 overflow | 17 hex digits > 64-bit | invalid input |
| Odd hex byte count | `outputs_data = "0xabc"` | invalid input |
| Missing code_hash | lock thiếu hash | invalid input |
| Unknown hash_type | `"hash_type":"legacy"` | invalid input |
| No type | `type:null` | không cộng type-script bytes |
| With type | type script args empty | cộng thêm 33 bytes |
| Fractional limit | `"0.00000001"` | đúng 1 shannon |
| Non-decimal limit | `"1e3"` | invalid policy |
| Lock allowlist mismatch | hash khác allowlist | hard policy finding |
| Excess unoccupied | 200 CKB, occupied 61 CKB | warning nếu > configured threshold |
| Too many outputs | > 512 | invalid demo input |
| Oversized JSON | > 1 MiB | error ngay tại UI |
| Cross-site scripting | JSON string chứa markup | UI hiển thị text chứ không thực thi markup |

## 4. Mục tiêu release công khai trước khi grant

- GitHub Action `Code checks` xanh.
- Link deployment có HTTPS, chạy được với không đăng nhập.
- Có video hiển thị một fixture pass và một fixture fail.
- Document minh bạch rằng fixtures là synthetic; sau đó bổ sung 1–2 testnet transactions thật có xuất xứ rõ ràng.
- Nộp code analysis, ví dụ policy JSON, và kết quả trước/sau vào issue review.
- Test từ máy khác (không dùng cache trình duyệt/extension của người phát triển).

## 5. Phân biệt unit test và chain-validity testing

Node `node:test` trong repo **chỉ** kiểm tra toán học, validation và kết quả policy engine. Nó không thay thế `ckb-testtool`, CKB-VM hoặc CKB node. Nếu ứng dụng tiến tới production, thêm một tầng integration tests dùng live/sandbox node riêng, kiểm tra exact transaction layout và script validation bằng tooling chính thức.
