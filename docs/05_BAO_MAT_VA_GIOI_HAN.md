# 05 — Bảo mật, edge cases và giới hạn hiện tại

## 1. Threat model

- Người dùng nhập transaction hoặc policy JSON có thể không đáng tin.
- Ứng dụng không truy cập keys và không ký hay phát transaction.
- Không backend, không lưu server-side, không kết nối mạng khi chạy website theo phiên bản MVP.
- Local JSON có thể có dữ liệu nhạy cảm (như script args, addresses, metadata); người dùng phải tự cân nhắc trước khi chia sẻ báo cáo đã export.
- Đầu ra chỉ kiểm tra điều kiện local; không xác nhận chain state, quyền sở hữu hay contract logic.

## 2. Bảo vệ hiện có

- Mỗi JSON input giới hạn 1 MiB tại UI (không nên dùng để xem dữ liệu rất lớn).
- Transaction tối đa 512 outputs; schema kiểm tra outputs + outputs_data match.
- Hex input yêu cầu `0x`, số byte chẵn, valid characters.
- Output capacity u64 được parse bằng BigInt, reject overflow và invalid format.
- Script code_hash đúng 32 byte, hash_type chỉ chấp nhận các kiểu được hỗ trợ.
- Policy số nguyên có bound, amounts là string CKB decimal có tối đa 8 chữ số lẻ.
- Browser render user-controlled text bằng `textContent`, không dùng innerHTML.
- CSP Vercel không cho remote connect, không cho inline script, không cho iframe nhúng.
- No cookies, no API, no localStorage, no private-key integration.

## 3. Các giới hạn rõ ràng

| Hạn chế | Ảnh hưởng | Cách mở rộng |
|---|---|---|
| Không kiểm tra inputs | Không tính fee, không biết source capacity/spending authority | Resolve input Cells qua trusted RPC và đối chiếu state |
| Không CKB-VM | Không biết scripts thực thi có pass hay không | Tích hợp testtool/CKB-VM ở backend hoặc worker đáng tin |
| Không witnesses/signature | Không thể khẳng định transaction được ủy quyền | Integrate signing-aware validation, nhưng không lưu secrets |
| Không cell deps | Không biết code blobs có tồn tại hay đúng version | Verify dependencies / code hashes qua RPC |
| Không historical chain data | Không biết outpoint có live hay spent | RPC query và reorg-aware result |
| No RPC | Không có testnet live verification | Optional read-only RPC giai đoạn sau |
| Allowlist chỉ code_hash | Không kiểm tra `args` hoặc script identity đầy đủ | `hash_type + code_hash + args` matching rules, version mới |
| Policy bỏ qua extra keys | Chính sách có typo có thể không được áp dụng | Strict schema trước production integration |
| `policy` có thể do chính user sửa | Không có nguồn policy authority | Signed/pinned policy manifests trong CI |
| Không xử lý transaction submission | Không thay thế CellFlow/wallet | Không mở tính năng này nếu không cần |

## 4. Định nghĩa trạng thái report

- `checks-passed`: tất cả *các rule được triển khai* có kết quả đạt, không có warning.
- `review-needed`: không có hard error nhưng ít nhất 1 warning.
- `policy-failed`: có ít nhất 1 hard error.
- Input/JSON parse error: không sinh report mới.

Không dùng nhãn “secure”, “consensus valid”, “signed”, “approved by Nervos”.

## 5. Security engineering trước khi triển khai RPC

Nếu thêm endpoint của người dùng vào UI hoặc server:

1. Tránh SSRF (không fetch arbitrary URL server-side); dùng allowlist và bảo vệ private IP.
2. Giới hạn timeout, body size, rate-limit, max concurrency.
3. Kết quả phụ thuộc block number/hash phải có metadata về độ mới và trạng thái reorg.
4. Normalize dữ liệu chain trước khi tính policy; mọi missing data đều là `unknown`, không tự động pass.
5. Server không thu thập seed phrase, secret keys hay raw unsigned tx trừ khi user đã đồng ý.
6. Audit thư viện, lock dependencies và CI test trước deployment.
7. Định nghĩa lại CSP chỉ theo tài nguyên thực sự cần và gắn monitoring CSP violations.

## 6. Claim discipline để không gây hiểu nhầm reviewer

**Được nói:** “Browser-based application-policy preflight checks for CKB output Cells”.

**Không được nói:** “Cryptographically proves a CKB transaction is safe”, “full consensus validation”, “all CKB attack classes handled”, “zero vulnerabilities”, hoặc “production-ready audited validator”.
