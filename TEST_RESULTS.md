# CellGuard v0.4 verification (2026-10-08)

## Automated local checks

- `npm run check` — **PASS**, 85/85 Node tests. Tests cover legacy policy behavior, strict JSON, exact integer capacity, input/fee processing, chain/network mismatch, VM success/rejection/unavailability, non-broadcast `test_tx_pool_accept` success/rejection, RPC method allowlisting, transaction inclusion status, RPC proof assertions, fee mismatch and fallback methods.
- `npm run test:e2e` — **PASS**, real Chromium DOM and event interactions, real Node backend, read-only JSON RPC routed to a deterministic local mock node, Node CLI online mode. Tests cover successful and failed VM execution, txpool acceptance, fee and cycle display, committed lookup + node proof, editor invalidation and network switching.
- Local runtime: Node.js 22, Python Playwright installed and system Chromium available.

**Environment limitation:** This execution environment blocks Chromium's navigation to loopback ports with `ERR_BLOCKED_BY_ADMINISTRATOR`. The E2E suite detected this and executed the unchanged CellGuard browser logic in real Chromium DOM, using a Python-to-Node-API bridge to the actual local server and mock upstream RPC. This is genuine browser event testing, but **not** a full direct-Chromium HTTP navigation test here. GitHub Actions includes a job that executes standard direct navigation on a normal runner.

**Not tested:** No real mainnet/testnet signed transaction was queried or submitted; public CKB RPC provider support, Vercel cloud deployment, external production rate limiting, and independent signature/consensus validation are not proven by these local tests. `test_tx_pool_accept` preflights current-node acceptance, not real on-chain inclusion or future acceptance. The product does not sign or broadcast transactions.
