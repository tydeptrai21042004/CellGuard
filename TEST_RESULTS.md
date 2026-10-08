# CellGuard v0.2 — Verification Record

Date: 2026-10-08. Engine: Node.js v22.16.0.

## Verified in this code delivery

- `npm run check`: **45/45 tests passed**, including original 19 tests plus strict-policy and terminal-command regressions.
- Static deployment configuration (`vercel.json`), JavaScript syntax checks, assets and CSP: **PASS**.
- Local dev server `GET /`: **HTTP 200**.
- Playwright Chromium isolated in-browser UI smoke tests: **PASS**, with modules loaded from local file-backed data URLs to accommodate this environment's blocked browser localhost navigation.
  - Initial synthetic safe fixture: policy passed, 2 outputs.
  - Risk fixture: policy failed and findings rendered.
  - JSON workbench expands and strict-policy malformed input is rejected.
  - `inspect 0x...` explicitly refuses RPC-based hash lookup.
  - Type script fixture displays a type script without claiming execution.
  - Mobile viewport 390px: no document-level horizontal overflow.
  - No JavaScript console/page errors during observed interactions.
- No npm packages required by the project; no wallet, external RPC, API key or backend.

## Remaining verification before production use

- End-to-end tests on a deployed Vercel URL in real browsers and across screen readers.
- Independent comparison with real CKB transactions and SDK/CCC behavior.
- Input/witness/fee/CKB-VM/script-cycle consensus verification is **not implemented**.
- Third-party source review, security audit, and funding approval not performed.

See `docs/07_TERMINAL_UI_AND_VALIDATION.md` for UI behaviors and manual QA cases.
