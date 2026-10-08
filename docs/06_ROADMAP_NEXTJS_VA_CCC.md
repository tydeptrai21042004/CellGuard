# 06 — Roadmap: từ web static sang SDK/Next.js nếu cần

## 1. Tại sao MVP dùng website static?

- Deploy Vercel chỉ cần Git import, output directory `site`, không build.
- Không bắt reviewer cài Node, Docker hay RPC.
- Không phát sinh backend ops, môi trường production dễ kiểm tra hơn.
- Pure JS ES modules đã đủ cho parse dữ liệu và đánh giá policy.

Nếu duy trì dưới 5 màn hình và không có server-side feature, không cần Next.js.

## 2. Giai đoạn 0 — hiện có

- UI transaction/policy JSON.
- Static sample pass/fail.
- Capacity math BigInt.
- Deterministic rules và export report.
- Test tự động bằng Node built-in.
- Vercel configuration static.

## 3. Giai đoạn 1 — grant-quality evidence

- Compatibility fixtures với transaction được CCC tạo ra.
- Kiểm chứng occupied capacity bằng chính CCC SDK với golden fixtures.
- Mở rộng policy của **script identity** thành hash_type + code_hash + args/prefix; cần quản lý schema migration cẩn thận.
- Thêm sample file thật từ testnet (không chứa private data), block references rõ ràng, báo cáo provenance.
- Document chính xác false positives/false negatives và nơi policy kiểm tra khác CCC/ckb-viz.
- Ít nhất 1 application integration bên ngoài, review công khai.

## 4. Giai đoạn 2 — Optional CCC adapter, không thay thế core

Tạo adapter `packages/ccc-adapter/` (về sau):

```text
Input from CCC Transaction / RPC
            |
            v
   normalize fields to CKB raw JSON
            |
            v
    parseTransaction() + parsePolicy()
            |
            v
      analyzeTransaction()
```

Không nên cài CCC vào MVP nếu chưa cần, vì sẽ tăng bề mặt dependency và khó cô lập lỗi. Khi thêm phải khóa phiên bản, so sánh byte-size với official occupied-capacity helper và có integration test.

## 5. Giai đoạn 3 — Khi thực sự cần Next.js

Đề xuất cấu trúc **TƯƠNG LAI** (chưa có trong ZIP và chưa test):

```text
cellguard-next/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/                       # only if RPC proxy absolutely necessary
├── components/
│   ├── TransactionEditor.tsx
│   ├── PolicyEditor.tsx
│   └── FindingsReport.tsx
├── packages/
│   └── core/                      # pure policy engine reused from static MVP
├── lib/
│   ├── cccAdapter.ts
│   └── reportVersion.ts
├── tests/
├── next.config.ts
└── package.json
```

Chỉ chuyển sang Next.js nếu có lý do: authentication, organization-wide policy sharing, server-side RPC proxy, persisted reports hoặc Vercel background integration. Lúc đó cần quản lý secret/SSRF/throttle và version dependencies. **Không bắt buộc để deploy website hiện tại.**

## 6. Các ý tưởng mở rộng nên xin phản hồi trước

- User-defined declarative policy schema và policy versioning.
- CLI `cellguard check --transaction ... --policy ...` dùng trong CI.
- JSON report canonical format + signed manifest of official reference policies.
- Independent ecosystem integrations với CellFlow/EventMesh (tùy chọn).
- Diff analysis cho hai phiên bản transaction hoặc hai policy manifests.
- Browser WebAssembly CKB-VM simulation: scope lớn hơn đáng kể, chỉ nên làm nếu hệ sinh thái chứng minh nhu cầu và có maintainer feedback.

## 7. Nếu người dùng yêu cầu chỉ deploy dễ dàng

Không nên ưu tiên migration Next.js. Tiếp tục giữ repo static + no dependencies đến khi xuất hiện nhu cầu thực tế không giải quyết được bằng client-side code.
