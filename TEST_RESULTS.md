# CellGuard v0.3 verification (2026-10-08)

The **patch overlay created from** `CellGuard-main (1).zip` was checked in the working container with Node.js 22.

- `npm run check`: **PASS** (syntax, Vercel static configuration, required files and tests)
- `npm test`: **65/65 PASS** (45 retained/updated earlier tests + 20 new v2, strict JSON, input shape, comparison, CLI and simulated DOM wiring tests)
- `node cli/cellguard.mjs --transaction examples/safe-tx.json --policy examples/strict-policy.json`: **configured checks passed**; not a chain-validity result
- `node --check` for modified browser modules and CLI: **PASS**

Areas covered include bounded JSON parsing and duplicate keys, v1 backward compatibility, v2 strict raw-shape checks, duplicate input outpoints, required recipient amount/count rules, strict type-script requirements, total free-capacity rules, indexed output comparison, CLI exit codes, and static-site security headers.

**Limitations:** No live CKB RPC, execution, inputs/fees, signature verification, script-cycle measurement or wallet signing checks. A dependency-free simulated-DOM integration smoke test covers initial UI rendering, policy preset, undo, comparison and editing. **Actual Chromium/browser end-to-end testing was not completed** in this environment; layout and real browser event behavior remain unverified. The synthetic JSON fixtures have not been confirmed on-chain. Do not interpret test passes as production or consensus verification.
