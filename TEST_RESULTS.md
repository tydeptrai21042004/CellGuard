# CellGuard v0.5 automated test report

Source baseline: user-uploaded `CellGuard-main(3).zip`. Local runtime: Node.js 22.x, Python 3.13, Playwright Chromium.

## Verified

- `npm run check`: **PASS** — static deploy checks plus 108/108 Node.js tests.
- `npm run test:e2e`: **PASS** — Chromium UI interactions, CLI invocation and the Node API connected to a deterministic mock CKB RPC.
- This runtime blocked Chromium HTTP navigation to loopback (`ERR_BLOCKED_BY_ADMINISTRATOR`), so the E2E harness exercised the actual Chromium DOM/JavaScript while bridging requests to the running local Node API. It is not a direct-Chromium HTTP-navigation test in this environment.
- V1/V2 compatibility: PASS.
- V3 capacity invariants, authorized roles, required dependencies, `since` format, unverified-input CI exit codes: PASS.
- 474 CKB unauthorized finalizer gain (synthetic scenario): PASS, detected by two independent profile rules.
- Live RPC verification and historical audit with injected **mock RPC**: PASS.
- The repository's missing CI workflow and `.gitignore` were added and the build checker now passes.

## Not verified

- Actual public CKB Testnet transaction or Rick's original CrowdCell bug transaction.
- Public RPC provider compatibility, Vercel cloud deployment and production application integration.
- Independent consensus/SPV verification, historical VM replay, and security/contract audit.

The code does not sign or broadcast transactions. Online signed transaction preflight shares witness data with the configured RPC node.
