# 02 — Kiến trúc, cấu trúc code và cách mở rộng

## 1. Nguyên tắc thiết kế

- **Browser-first**: phân tích pure JS trong client, không cần backend.
- **Fail closed**: dữ liệu sai format / thiếu input cần thiết sẽ hiện lỗi, không trả về “safe”.
- **Exact math**: capacity là số shannons u64, dùng `BigInt`, không dùng float.
- **Deterministic**: cùng transaction + policy cho ra cùng kết quả (trừ metadata `generatedAt` thêm ở tầng UI).
- **Separation of concerns**: parsing, policy, rule engine, UI, server chạy local tách nhau.
- **Transparent limitations**: “checks passed” ≠ consensus-valid, fee-valid, authorized, signable, hoặc giao dịch đã được ghi on-chain.

## 2. Hướng dữ liệu

```text
Transaction JSON (user/fixture)        Policy JSON (user/default)
                 |                           |
                 v                           v
     lib/ckb.mjs: parseTransaction      lib/policy.mjs: parsePolicy
                 |                           |
                 +------------+--------------+
                              |
                              v
                   lib/analyzer.mjs
                policy findings, output breakdown
                              |
                              v
                assets/main.mjs (browser UI)
                     |                 |
              visible report     JSON download
```

Không có wallet signing, RPC fetch, mutation on-chain hay private-key handling ở bất kỳ bước nào.

## 3. Mục đích từng file

| File | Nội dung | Khi nào chỉnh sửa |
|---|---|---|
| `site/index.html` | Semantic markup; textarea, buttons, panels, status và bảng | Thêm phần giao diện |
| `site/assets/styles.css` | Design tokens, responsive layouts, trạng thái warnings/errors | Thay UI/style |
| `site/assets/main.mjs` | DOM events, local file read, rendering, report export | Thêm thao tác người dùng |
| `site/assets/lib/ckb.mjs` | Kiểm tra code hash/hash type/args, hex, occupied capacity, formatting | Mở rộng input parser, không viết DOM ở đây |
| `site/assets/lib/policy.mjs` | Schema policy version 1, giới hạn dữ liệu và chi phí | Thêm tùy chọn policy |
| `site/assets/lib/analyzer.mjs` | Rule engine thuần; tách warning và error | Thêm rule kiểm tra mới |
| `site/assets/lib/fixtures.mjs` | 2 transaction synthetic và policy demo | Thêm regression case |
| `scripts/serve.mjs` | HTTP server local dùng thư viện Node built-in | Chỉ cần chỉnh khi đổi local dev server |
| `scripts/check-build.mjs` | Kiểm tra cấu hình và cú pháp tài sản deploy | Thêm static validation |
| `tests/*.test.mjs` | Node test runner, không library ngoài | Thêm regression + boundary tests |
| `vercel.json` | Static hosting, chỉ publish `site/`, CSP, security headers | Đổi Vercel deploy settings có chủ đích |

## 4. Công thức occupied capacity

Một output có:

- `capacity` field: 8 bytes.
- `lock script`: 32-byte code_hash + 1-byte hash_type + length(args).
- `type script` nếu có: 32 + 1 + length(args).
- `output_data`: length(bytes).

```text
occupiedBytes = 8 + (33 + lockArgsBytes)
                  + (type ? 33 + typeArgsBytes : 0)
                  + dataBytes
minimumShannons = BigInt(occupiedBytes) * 100_000_000n
freeShannons = outputCapacityShannons - minimumShannons
```

Ví dụ lock mặc định có args 20 bytes, không type, không data: 8 + 33 + 20 = **61 bytes**, tức **61 CKB** occupied. Đây là giá trị cho script lock có 20-byte args, **không** phải min chung của mọi custom Cell.

Các chuẩn hash_type được hỗ trợ: `data`, `data1`, `data2`, `type`.

**Không tính transaction fee bằng cách lấy tổng output vì không biết input capacities. Không chứng minh tính hợp lệ của mọi rule trong CKB consensus.**

## 5. Policy schema version 1

Các trường cần có:

```json
{
  "version": 1,
  "maxOutputs": 20,
  "maxDataBytesPerOutput": 256,
  "maxTotalDataBytes": 2048,
  "maxTotalOutputCapacityCKB": "1000",
  "maxFreeCapacityCKBPerOutput": "25",
  "allowedLockCodeHashes": [],
  "allowedTypeCodeHashes": [],
  "denyTypeScripts": false
}
```

**Các rule hiện có:**

| Rule code | Kết quả | Ý nghĩa |
|---|---|---|
| `CAPACITY_INSUFFICIENT` | Error | Output không đủ occupied capacity |
| `POLICY_MAX_OUTPUTS` | Error | Output count vượt maxOutputs |
| `POLICY_DATA_TOO_LARGE` | Error | Output data vượt giới hạn riêng |
| `POLICY_TOTAL_DATA_TOO_LARGE` | Error | Tổng data vượt giới hạn |
| `POLICY_TOTAL_CAPACITY` | Error | Tổng capacity vượt ngân sách policy |
| `POLICY_LOCK_NOT_ALLOWED` | Error | Lock code_hash không thuộc allowlist |
| `POLICY_TYPE_FORBIDDEN` | Error | Type script xuất hiện dù policy cấm |
| `POLICY_TYPE_NOT_ALLOWED` | Error | Type code_hash không thuộc allowlist |
| `POLICY_EXCESS_CAPACITY` | Warning | Free capacity lớn hơn policy threshold (không sai consensus) |

Để thêm rule: (1) cập nhật `DEFAULT_POLICY`, (2) kiểm tra schema `parsePolicy`, (3) điều kiện trong `analyzeTransaction`, (4) unit test pass/fail, (5) cập nhật bảng rules/documentation, (6) kiểm tra UX.

## 6. Những mục **cố ý chưa triển khai**

- CCC integration, RPC, transaction hash, fee accounting, input Cell resolution.
- Script execution CKB-VM, signature / witness / dependency checks.
- Full consensus validation, transaction submission, status tracking, wallet connect.
- Signed policy manifests, provenance, verified third-party attestations.
- Chain reorg and network data freshness handling.

Các mục này cần yêu cầu thiết kế riêng (và thực nghiệm), không thể suy ra từ output JSON hiện tại.

## 7. Vì sao chưa cần Next.js?

Static HTML + ES modules đáp ứng trọn vẹn yêu cầu phân tích offline và deploy Vercel. Next.js có giá trị khi cần API routes, auth, SSR, server-side RPC proxies hoặc scale team, nhưng ở MVP sẽ làm tăng số dependency và build steps mà chưa tạo giá trị bảo mật. Roadmap xem `06_ROADMAP_NEXTJS_VA_CCC.md`.


## Cập nhật v0.2 — Terminal UI

`site/assets/lib/terminal.mjs` parses a small allowlist of browser-only UI commands; it does not execute shell commands. `site/index.html`, `site/assets/styles.css`, and `site/assets/main.mjs` implement the responsive terminal look and interactive report. Policy now rejects unknown keys and offers optional full lock/type script allowlists (`code_hash`, `hash_type`, `args`). These checks remain offline and do not establish on-chain validity. See `docs/07_TERMINAL_UI_AND_VALIDATION.md`.
