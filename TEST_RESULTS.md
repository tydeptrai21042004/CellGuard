# CellGuard Web — Verification Record

Date: 2026-10-08

## Locally verified

- `npm run check`: **PASS — 19/19 tests** (Node.js v22.16.0).
- Static layout, `vercel.json`, JavaScript syntax: **PASS**.
- Local HTTP smoke test: **200** for `/`, `/assets/styles.css`, `/assets/main.mjs`, `/assets/lib/analyzer.mjs`, `/assets/lib/fixtures.mjs`.
- Local HTTP smoke test: **404** for `/docs/01_TRIEN_KHAI_VERCEL.md` (outside public `site/`).
- No npm packages installed; no dependencies declared in `package.json`.

## Not yet verified

- A live deployment on a real Vercel account (requires user Git/Vercel account access).
- Browser automation on every device/browser.
- CKB testnet inputs/RPC, CKB-VM or consensus validity (deliberately out of scope for this MVP).
- Third-party review or ecosystem funding approval.

See `docs/03_HUONG_DAN_KIEM_THU.md` for manual browser acceptance testing and future integration requirements.
