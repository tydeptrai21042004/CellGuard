> **Version note (v0.4):** This document describes the earlier offline functionality. Live read-only CKB RPC preflight, transaction lookup and browser testing were added in v0.4; see [09_LIVE_CKB_RPC_AND_E2E.md](09_LIVE_CKB_RPC_AND_E2E.md). The offline tools remain supported.

# CellGuard v0.2 — terminal UI and safety notes

## What the interface does

- This is a **web app that resembles a terminal**, not a native shell.
- The command parser recognizes a fixed allowlist: inspect/load/examples/help/clear/policy/status/report.
- Enter runs the command; the example links insert/run known synthetic fixtures; JSON workbench supports pasted or locally uploaded raw CKB output transaction JSON.
- `inspect json` uses the current editor values. `Ctrl+Enter` / `⌘+Enter` runs from inside JSON editors.
- Reports are downloadable or copyable. Values are computed on the client, never uploaded by the app.

## Deliberate omissions

- `inspect <tx-hash>` produces an offline-mode explanation rather than a fake RPC result.
- The UI does not display invented block numbers, confirmed transactions, executed script groups, or cycles. Only output script metadata is available from the supplied JSON.
- Transaction signature, input, fee, witness, chain status, CKB-VM execution, and cycles remain **NOT VERIFIED**.

## Security/consistency changes

- Unknown policy keys are rejected; v1 required keys remain backward-compatible.
- `allowedLockScripts` and `allowedTypeScripts` require exact code_hash + hash_type + args matches.
- Legacy hash-only lists still work; combine restrictions if both lists are configured.
- JSON size guard is 1 MiB per input; parser enforces max 512 outputs and strictly parses script/capacity fields.
- Script metadata is rendered using `textContent` rather than `innerHTML`.
- Browser app does not make network calls, use `eval`, request wallets, or execute arbitrary commands.
- Unchanged Vercel CSP disallows remote connections and inline scripts.

## Manual UI QA before publishing

1. Run `npm run dev` and open http://localhost:3000.
2. Click passing transfer; report should show pass, 2 outputs, and on-chain NOT VERIFIED.
3. Click policy failures; capacity, output data and disallowed lock findings should appear.
4. Click type script; output table should identify type script but never claim it executed.
5. Open editor, modify `policy.json` to contain `maxOutputz`; `inspect json` must return an unknown-policy-field error.
6. Restore policy, change lock `hash_type` or `args`; exact script allowlist must fail.
7. Run `inspect 0x` followed by 64 hex characters; the UI must reject unsupported hash lookup.
8. Upload valid `.json`, then malformed JSON; check errors and no stale exported report.
9. Test keyboard navigation, mobile width, Copy JSON and Export report in an actual browser.
10. Run `npm run check` and deploy GitHub repo to Vercel with output directory `site`.

## Test boundaries

The automated tests cover the pure engine and command grammar, not wallet/RPC integration. Browser appearance and interaction must also be checked manually in a browser (or later by adding an E2E runner). Passing tests do not constitute production certification.
