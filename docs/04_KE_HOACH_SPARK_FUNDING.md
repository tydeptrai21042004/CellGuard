# 04 — Kế hoạch biến web prototype thành hồ sơ Spark funding

> **Quan trọng:** đây là kế hoạch tham khảo, **không bảo đảm được tài trợ**. Trước khi nộp phải kiểm tra lại hướng dẫn, hạn mức, quy trình và trạng thái chương trình tại [Nervos Talk](https://talk.nervos.org/).

## 1. Vấn đề đề xuất

CKB là mô hình Cell. Một transaction có thể được xây dựng với cấu trúc JSON đúng và đáp ứng tính toán occupied capacity nhưng vẫn vi phạm chính sách của ứng dụng (ví dụ dữ liệu người dùng quá dài, nhiều capacity được cấp phát ngoài ngân sách, script hash không nằm trong allowlist). Công cụ hiện tại cung cấp các cơ chế quan trọng để xây dựng, mô phỏng hoặc hiển thị giao dịch, nhưng ứng dụng thường phải tự viết các quy tắc nghiệp vụ bổ sung.

**Định vị dự án:** một rule engine nhỏ, minh bạch, chạy trước chữ ký, có thể chạy từ browser và tái sử dụng qua ES module. Không tuyên bố thay thế CCC, ckb-viz, CKB Firewall, ckb-testtool hoặc kiểm tra consensus.

## 2. Evidence và giả thuyết cần kiểm chứng

Một thảo luận Rosen Bridge vào tháng 7/2026 đề cập việc metadata do người dùng điều khiển có thể làm phát sinh cấp phát Cell capacity không mong muốn. Luồng liên quan đã được thay đổi ở giai đoạn phát triển sau đó; đây là **vấn đề lịch sử dùng để định hướng regression test**, không phải lời cáo buộc rằng bridge hiện còn lỗ hổng.

Trước khi nộp funding cần có:

1. Reproduction có dữ liệu fixture cụ thể và chính sách pass/fail được công bố.
2. So sánh minh bạch với CCC capacity calculations và ckb-viz simulation: cái gì đã giải quyết; cái gì **chỉ** được CellGuard Web giải quyết.
3. Xác nhận từ ít nhất 1 nhà phát triển CKB độc lập rằng pattern có ích và interface dễ tích hợp.
4. Một bản chạy online trên Vercel mà reviewer có thể tự kiểm chứng.

## 3. Bản grant scope đề xuất

**Title:** CellGuard Web: application-policy preflight for CKB Cell transactions

**Category:** CKB developer tooling

**Deployment:** Static website with browser-only deterministic engine

**Suggested budget:** USD 1,000 (**đề xuất**, không phải phê duyệt)

**Timeline:** 6 tuần (**đề xuất**)

| Giai đoạn | Sản phẩm nghiệm thu | Ngân sách tham khảo |
|---|---|---:|
| 1 — Core | CKB occupied-capacity parser, BigInt, rule schema và JSON report | $350 |
| 2 — Web | UI responsive, input/file import, findings, report download, Vercel | $250 |
| 3 — Validation | Negative + boundary cases; bộ regression; testnet-compatible fixtures | $250 |
| 4 — Adoption | Tài liệu, độc lập xác minh, integration example, public demo | $150 |
| **Tổng** | | **$1,000** |

Repository này đã triển khai **một phần** các deliverables trên ở mức prototype. **Không** được mô tả nội dung sẵn có trong repo như công việc chưa thực hiện để xin funding. Nếu định xin tài trợ cho giai đoạn sau, phải định nghĩa phần làm mới và minh bạch công việc hiện có; ví dụ real-testnet integration, SDK adapter, independent adoption và regression dataset có nguồn gốc.

## 4. Acceptance criteria khách quan

- Source MIT, có README và tests, xem được diff từng milestone.
- `npm run check` thành công trên CI.
- Public HTTPS web demo: tải fixture pass và fail, kết quả giải thích từng rule.
- JSON report deterministic (ngoại trừ thời điểm tạo report do UI thêm).
- Capacity calculation đối chiếu với CCC / tài liệu CKB trên 2+ loại Cell và 1+ type script case.
- Ít nhất 1 case policy violation không bị gắn nhãn policy violation bởi CCC transaction completion mặc định.
- 1 independent CKB developer có thể tự chạy fixtures, không cần ví hay secret.
- Không được quảng cáo ứng dụng là audit, formal verification hoặc consensus validator.

## 5. Công việc nên làm tiếp theo để tăng tính khác biệt

1. Bổ sung JSON schema có version và strict validation, test thay đổi policy migration.
2. Hoàn thiện import từ CCC constructed transaction (các field đã chuẩn hóa), bảo đảm input không bị mất nghĩa.
3. Đối chiếu occupied-capacity với CCC trên dataset thật.
4. Thêm policy hash và report provenance để có thể kiểm tra reproducibility giữa các máy (không tự nhận là attestation cryptographic cho security audit).
5. Tạo SDK adapter CLI/Node cho dự án khác tái sử dụng policy engine.
6. Thử nghiệm với 1 ứng dụng bên ngoài qua pull request công khai.

## 6. Điều nên tránh trong proposal

- Không viết “CKB chưa có capacity calculator”; CCC đã có tool liên quan.
- Không viết “CKB chưa có transaction simulation”; ckb-viz đã có.
- Không viết “Rosen Bridge hiện đang có bug” nếu chưa xác minh; chỉ đề cập lịch sử thảo luận với ngày cụ thể.
- Không dùng ảnh mockup làm bằng chứng đã triển khai sản phẩm.
- Không nói testnet được tích hợp khi repo chỉ chứa fixtures giả lập.
- Không dùng tỷ lệ chấp nhận funding do tự đoán.

## 7. Links đối chiếu

- Spark guide: https://talk.nervos.org/t/spark-program-mini-grant-initiative/8752
- Rosen issue/discussion: https://talk.nervos.org/ (tra cứu Rosen capacity metadata thread)
- CCC: https://github.com/ckb-devrel/ccc
- CKB docs: https://docs.nervos.org/
- ckb-viz: https://talk.nervos.org/t/ckb-viz-read-any-ckb-transaction-as-a-flow-of-cells/10482
- Vercel: https://vercel.com/docs/builds/configure-a-build

## 8. Draft mô tả ngắn cho hồ sơ

> CellGuard Web is a browser-first, open-source application-policy preflight tool for CKB Cell transactions. It complements transaction builders and visualizers by evaluating developer-configurable constraints such as occupied-capacity requirements, bounded user-controlled data, allowed script identities, and capacity budgets. The initial demonstrator runs entirely client-side without wallets, API keys, or RPC configuration and produces reproducible JSON findings. It does not replace CKB-VM execution or consensus validation. The proposed next milestone is to validate the policy engine against real CKB testnet transaction structures, publish adversarial regression cases, and obtain independent developer adoption.
