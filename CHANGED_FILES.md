# CellGuard v0.4 — Changed/new files only

This patch is **incremental on v0.3**. Overlay the ZIP over your CellGuard repository **after** applying the previously shared v0.3 patch. All paths have the `CellGuard-main/` prefix. This archive intentionally does not include unchanged files, `node_modules`, built caches, secrets or dependencies.

The new backend is at `api/verify.mjs` and `server/*.mjs`, deployed with the static `site/` frontend. The API is read-only: no wallet signing or transaction broadcasting. For live RPC verification and test commands see `docs/09_LIVE_CKB_RPC_AND_E2E.md`.

## Included paths
- `.github/workflows/ci.yml` (updated)
- `APPLY_PATCH.md` (updated)
- `README.md` (updated)
- `TEST_RESULTS.md` (updated)
- `api/verify.mjs` (new)
- `cli/cellguard.mjs` (updated)
- `docs/05_BAO_MAT_VA_GIOI_HAN.md` (updated)
- `docs/07_TERMINAL_UI_AND_VALIDATION.md` (updated)
- `docs/08_CELLGUARD_V03_USAGE.md` (updated)
- `docs/09_LIVE_CKB_RPC_AND_E2E.md` (new)
- `package.json` (updated)
- `scripts/check-build.mjs` (updated)
- `scripts/serve.mjs` (updated)
- `server/http.mjs` (new)
- `server/rpc.mjs` (new)
- `server/verification.mjs` (new)
- `site/assets/lib/terminal.mjs` (updated)
- `site/assets/main.mjs` (updated)
- `site/assets/styles.css` (updated)
- `site/index.html` (updated)
- `tests/browser-e2e.py` (new)
- `tests/deploy.test.mjs` (updated)
- `tests/online.test.mjs` (new)
- `tests/terminal.test.mjs` (updated)
- `vercel.json` (updated)
