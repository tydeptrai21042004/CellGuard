# CellGuard v0.5 changed and new files

Relative to the uploaded `CellGuard-main(3).zip` archive.

- **Added:** 14 files
- **Modified:** 20 files (including this manifest)

## Added
- `.github/workflows/ci.yml`
- `.gitignore`
- `docs/10_V05_CAPACITY_FLOW.md`
- `examples/crowdcell-synthetic/finalize-inputs.unverified.json`
- `examples/crowdcell-synthetic/finalize-leak-474.json`
- `examples/crowdcell-synthetic/finalize-valid.json`
- `examples/crowdcell-synthetic/refund-inputs.unverified.json`
- `examples/crowdcell-synthetic/refund-valid.json`
- `examples/profiles/finalize.example.json`
- `examples/profiles/pledge.example.json`
- `examples/profiles/refund.example.json`
- `site/assets/lib/invariants.mjs`
- `tests/v3-capacity-flow.test.mjs`
- `tests/v3-online-audit.test.mjs`

## Modified
- `APPLY_PATCH.md`
- `CHANGED_FILES.md`
- `README.md`
- `README_PATCH.md`
- `TEST_RESULTS.md`
- `cli/cellguard.mjs`
- `examples/strict-policy.json`
- `package.json`
- `scripts/check-build.mjs`
- `server/http.mjs`
- `server/verification.mjs`
- `site/assets/lib/analyzer.mjs`
- `site/assets/lib/ckb.mjs`
- `site/assets/lib/policy.mjs`
- `site/assets/main.mjs`
- `site/index.html`
- `tests/analyzer.test.mjs`
- `tests/browser-e2e.py`
- `tests/rick-feedback.test.mjs`
- `tests/security-regression.test.mjs`

The FULL ZIP also includes unchanged project files so it can run independently.
The CHANGED-FILES ZIP overlays onto the user-uploaded baseline with the same `CellGuard-main/` directory layout.

Tests: `npm run check` — 108 passed; `npm run test:e2e` — passed (Chromium DOM with local API bridge in this environment).
Examples are synthetic, not the original CrowdCell transaction.
