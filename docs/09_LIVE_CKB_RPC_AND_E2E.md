# CellGuard v0.4 — Live CKB RPC + Browser E2E

## What is truly online

CellGuard v0.4 retains all existing offline policy checks and adds a **read-only Node backend** (the same `/api/verify` interface runs in local development and in a Vercel Node Function).

* `get_blockchain_info` confirms the node-reported chain and rejects initial synchronization.
* `get_tip_header` captures a tip observation; a second observation catches a same-height hash change / backwards movement.
* `get_live_cell` checks each input OutPoint, including the txpool view when available; capacity sums and transaction fee use exact integers.
* `estimate_cycles` asks the CKB VM to execute lock/type scripts for the supplied witnesses. A `-32601` method-not-found response falls back to the deprecated `dry_run_transaction`.
* `test_tx_pool_accept(tx, "passthrough")` tests whether the node **would accept** the signed transaction into its current txpool **without broadcasting or inserting it**. The pass may change as the node state changes. It provides stronger validation than `estimate_cycles` alone.
* `get_transaction`, `get_header`, and `get_block_hash` look up an existing transaction and verify that the node currently reports its block as canonical. When supported, `get_transaction_proof` and `verify_transaction_proof` ask the same node to validate inclusion evidence. This is **node-side** proof verification, not a separate local SPV or consensus check. Confirmations are node-reported.

**Signature semantics:** CKB lock scripts determine how authorization is checked. Successful node execution proves that the executed lock scripts accepted the provided witnesses. Standard signature-checking lock scripts can reject invalid signatures. CellGuard does not independently identify every custom contract's cryptographic validation behavior or independently verify all signature schemes.

**Not provided:** no key entry, signing, transaction submission, independent SPV/light-client verification, guaranteed future txpool acceptance, or finality proof. RPC results are third-party observations and should not be treated as independent proof of the chain. When a node rejects a transaction, its reason is shown; RPC timeouts/missing capabilities become `inconclusive` instead of false success.

## Deploy on Vercel (zero new runtime dependencies)

1. Copy the patch files into the repository root (`CellGuard-main`). Keep `api/verify.mjs` and `server/` in the repository root, **outside** `site/`.
2. Import the repository in Vercel; choose **Other** framework, root directory `./`. The existing `vercel.json` serves static files from `site/` and discovers the `/api/verify` Vercel Node Function. There is no custom build command.
3. Optionally configure environment variables **on Vercel server side**:
   - `CKB_RPC_TESTNET=https://YOUR_TRUSTED_TESTNET_PROVIDER/`
   - `CKB_RPC_MAINNET=https://YOUR_TRUSTED_MAINNET_PROVIDER/`
   Both must be HTTPS. Do **not** put provider keys in `site/` or expose them to browser JavaScript. No provider configuration is needed for the built-in public defaults (`https://testnet.ckb.dev/`, `https://mainnet.ckb.dev/`), which should be considered community/testing endpoints, not guaranteed production SLAs.
4. Deploy and open the app. Select testnet/mainnet, paste a complete CKB raw signed transaction including inputs, cell deps, witnesses, etc., then select **verify signed JSON**. Synthetic output-only examples cannot be verified online.
5. For a transaction **already submitted**, paste its 0x hash and select **lookup hash**. `committed` with confirmations is node-reported chain state; `pending` does not imply inclusion.
6. Set edge/WAF rate limits and monitor RPC quotas and function invocations before making the API publicly accessible at scale. The demo backend is unauthenticated but heavily constrained; it is not a full multi-tenant production gateway.

The backend disallows arbitrary user-selected node addresses, arbitrary JSON-RPC method invocation and RPC submissions. It checks Origin, rejects duplicate JSON properties, limits requests to ~256 KiB online, at most 16 inputs/64 deps, a 25-second verification time budget, upstream response size limits, and HTTPS-only provider configuration. Localhost HTTP is supported **only** when `CKB_ALLOW_LOCAL_RPC=1` is set by the server operator.

## CLI

```bash
npm run dev
npm run check
node cli/cellguard.mjs --transaction signed.json --policy examples/strict-policy.json --online testnet --format json
node cli/cellguard.mjs --online mainnet --lookup 0x<64 hexadecimal characters>
```

For developer testing with a **local** trusted node:

```bash
CKB_ALLOW_LOCAL_RPC=1 CKB_RPC_TESTNET=http://127.0.0.1:8114 npm run dev
```

## Real browser tests

The Python Playwright/Chromium test script launches the actual frontend and local Node backend plus a local deterministic CKB RPC stub. It tests policy UI, complete signed JSON preflight, input-capacity fee calculation, VM cycle responses, successful txpool checks, script failures, lookup confirmations, cancellation/invalidation on edits and network changes.

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
npm run test:e2e
```

In restricted browser environments that block loopback page navigation, the script falls back to **real Chromium DOM and app JS execution** with a Python-to-local-backend RPC bridge; it prints a notice. The browser tests do not claim to have queried the public live mainnet/testnet or verified a real signed transaction. Unit tests use mock RPC responses. To test a real deployed provider, use a genuine signed fixture and check actual RPC responses.

## Error classification

| Condition | Classification |
|---|---|
| Policy violation, missing/spent input, negative fee | `fail` |
| VM -302 script failure / -301 unresolved dependency | `fail` |
| Node txpool rejects for fee, outputs, or verification | `fail` |
| Unknown RPC error, inaccessible txpool method, pool contention | `inconclusive` |
| VM and txpool both pass, input/fee/policy pass, stable tip | `pass` (node preflight only) |
| Hash lookup returns canonical committed transaction | `committed` (node observation) |

## Known limitations

The current full-transaction validator supports common raw JSON fields; app-specific CKB extensions are rejected in strict live mode. DAOs and advanced `since`/economic-state cases rely on the node's txpool validation and cannot always use a simple sum-of-inputs fee accounting. The RPC's answer is time-sensitive and could change with reorgs or concurrent transactions. For DAO-specific flows, prefer specialized CCC/CKB libraries and audited application logic.
