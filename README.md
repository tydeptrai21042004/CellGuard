# CellGuard Web — CKB Transaction Policy Preflight

**MVP web chạy ngay trên trình duyệt, triển khai Vercel không cần build, không cần wallet, RPC, database hoặc API key.**

> **Phạm vi:** Phân tích cấu trúc `outputs`, `outputs_data`, occupied capacity và application policy. Đây **không phải** contract audit, CKB-VM simulator, full transaction validator hay sản phẩm production-certified. Ví dụ đi kèm là **synthetic fixtures**, không phải transaction đã xác nhận trên testnet.

## 1. Khởi chạy nhanh

**Điều kiện:** Node.js 20+ chỉ để chạy thử và kiểm tra tự động ở máy cá nhân. Triển khai static trên Vercel không cần Node runtime.

```bash
# Giải nén file ZIP, mở terminal trong thư mục cellguard-web
npm run dev
# mở http://localhost:3000
```

Không cần `npm install` vì không có package bên ngoài. Chạy test:

```bash
npm run check
```

**Đưa lên Vercel (cách khuyến nghị):** upload toàn bộ repo lên GitHub → Vercel **Add New → Project → Import** → Root Directory `.` → Framework `Other` → Build Command bỏ trống → Output Directory `site` → Deploy. `vercel.json` đã đặt sẵn các cấu hình này. **Không khai báo environment variables.**

**Cách nhanh hơn, không cần Git:** sử dụng [Vercel Drop](https://vercel.com/drop) và chỉ kéo thư mục `site/` lên, vì `site/` là web tĩnh hoàn chỉnh. Khi dùng Drop riêng, cấu hình header an toàn ở `vercel.json` không nhất thiết được áp dụng; Git import là phương án ưu tiên.

Chi tiết: [`docs/01_TRIEN_KHAI_VERCEL.md`](docs/01_TRIEN_KHAI_VERCEL.md).

## 2. Cấu trúc repository

```text
cellguard-web/
├── README.md                          # Điểm bắt đầu, lệnh chạy và phạm vi
├── LICENSE                            # MIT license
├── package.json                       # Lệnh dev/test/check; không dependency
├── vercel.json                         # Deploy static từ site/, CSP và headers
├── .gitignore                          # Bỏ tệp cục bộ/sensitive
├── .github/workflows/ci.yml           # CI kiểm tra Node 22, không npm install
├── scripts/
│   ├── serve.mjs                       # Local static server, node built-in
│   └── check-build.mjs                 # Kiểm tra cấu trúc và cú pháp JS
├── site/                               # CHỈ thư mục này được deploy
│   ├── index.html                      # Màn hình chính, semantic HTML
│   └── assets/
│       ├── styles.css                  # UI responsive
│       ├── main.mjs                    # Browser events, render, export report
│       └── lib/
│           ├── ckb.mjs                 # CKB hex, uint64, BigInt, occupied capacity
│           ├── policy.mjs              # Schema + kiểm tra policy
│           ├── analyzer.mjs            # Pure deterministic rule engine
│           └── fixtures.mjs            # Bộ giao dịch mẫu synthetic
├── tests/
│   ├── analyzer.test.mjs               # Unit + negative + boundary cases
│   └── deploy.test.mjs                 # Vercel config, assets và CSP tests
└── docs/
    ├── 01_TRIEN_KHAI_VERCEL.md        # Hướng dẫn deploy từng bước
    ├── 02_KIEN_TRUC_VA_CAU_TRUC_CODE.md
    ├── 03_HUONG_DAN_KIEM_THU.md
    ├── 04_KE_HOACH_SPARK_FUNDING.md
    ├── 05_BAO_MAT_VA_GIOI_HAN.md
    └── 06_ROADMAP_NEXTJS_VA_CCC.md
```

## 3. Chức năng MVP hoạt động

1. Load 2 fixture synthetic (`Ví dụ đạt`, `Ví dụ lỗi`), hoặc dán/upload JSON local (≤1 MiB).
2. Parse và kiểm tra script structure `code_hash`, `hash_type`, `args`.
3. Tính occupied capacity đúng theo `8 + lock script bytes + optional type script bytes + output data bytes`, đổi chính xác ra shannons bằng `BigInt` (1 CKB = 100,000,000 shannons).
4. Phát hiện output capacity thấp hơn mức occupied; giới hạn output data; ngân sách capacity; allowed lock/type code hashes; policy cấm type script; cảnh báo free capacity quá lớn.
5. Hiển thị breakdown theo output và export `cellguard-report.json`.
6. Phân tích 100% client-side. Không kết nối ví, không tạo transaction, không gọi RPC.

## 4. JSON đầu vào

Sử dụng phần phù hợp của CKB raw transaction:

```json
{
  "outputs": [
    {
      "capacity": "0x16b969d00",
      "lock": {
        "code_hash": "0x1111111111111111111111111111111111111111111111111111111111111111",
        "hash_type": "type",
        "args": "0x2222222222222222222222222222222222222222"
      },
      "type": null
    }
  ],
  "outputs_data": ["0x"]
}
```

Script hashes trong ví dụ là **giá trị giả lập để kiểm tra format**, không phải code hash chuẩn của hệ thống CKB. Phân tích không diễn giải `inputs`, `cell_deps`, witnesses hoặc signature. Cấu trúc JSON cho CKB v0; `capacity` input là số shannons hex, không phải số CKB.

## 5. Policy mẫu

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

- `maxTotalOutputCapacityCKB` / `maxFreeCapacityCKBPerOutput`: dùng chuỗi số thập phân CKB (tối đa 8 chữ số thập phân) để tránh sai số float.
- `allowed*CodeHashes = []`: mặc định không giới hạn. Khi thêm hash, chỉ hash được liệt kê mới hợp lệ với loại script tương ứng.
- `POLICY_EXCESS_CAPACITY`: **warning**, không phải lỗi consensus. Việc có free capacity lớn có thể hoàn toàn có chủ ý.
- Số lượng key bắt buộc được kiểm tra. Key lạ hiện được bỏ qua để hỗ trợ thử nghiệm; nếu định dùng policy để ký/xác nhận quyền cần nâng cấp strict-schema.

## 6. Điểm cần làm trước khi xin grant

- Bổ sung một regression test dựa trên vấn đề *công khai và đã được giải quyết* của Rosen Bridge (không nhận định hệ thống hiện tại còn lỗi).
- Kiểm thử với dữ liệu thực từ CKB testnet (đã ẩn/loại bỏ thông tin nhạy cảm).
- Chứng minh rule engine bắt được application-policy violation mà CCC completion hoặc ckb-viz không tự gắn nhãn.
- Xin phản hồi của ít nhất một nhà phát triển CKB độc lập, dẫn link issue hoặc comment công khai.
- Tạo video ngắn cho reviewer xem hành vi thực tế; ghi rõ giới hạn về consensus.

Chi tiết: [`docs/04_KE_HOACH_SPARK_FUNDING.md`](docs/04_KE_HOACH_SPARK_FUNDING.md).

## 7. Tài liệu chính thức

- [Vercel static deployment](https://vercel.com/docs/builds/configure-a-build)
- [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [CKB Cell capacity](https://pocket-node-learn-ckb.vercel.app/lessons/03-capacity-calculator)
- [CKB Script basics](https://pocket-node-learn-ckb.vercel.app/lessons/07-script-basics)
- [Nervos Docs](https://docs.nervos.org/)
- [CCC SDK](https://github.com/ckb-devrel/ccc)

## 8. License and development status

MIT-licensed technical prototype, version 0.1.0. No published web URL is claimed and no third-party installation is required for browser deployment. All grant figures in the docs are **illustrative proposals**, not funding approvals.
