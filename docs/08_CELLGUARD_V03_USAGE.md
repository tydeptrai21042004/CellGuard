> **Version note (v0.4):** This document describes the earlier offline functionality. Live read-only CKB RPC preflight, transaction lookup and browser testing were added in v0.4; see [09_LIVE_CKB_RPC_AND_E2E.md](09_LIVE_CKB_RPC_AND_E2E.md). The offline tools remain supported.

# CellGuard v0.3: hardened offline analysis and CI (EN / VI)

## Scope / Giới hạn

CellGuard v0.3 is **an offline output-policy and transaction-shape inspector**, NOT an on-chain validator. It does not resolve live inputs, validate fees or witnesses, execute script groups, estimate cycles, or confirm signatures. It does not make RPC connections or transmit the editor contents. UI commands are a restricted parser, not a shell.

- Policy `version: 1` still accepts legacy policies. Unrecognized transaction, output, and script properties produce a `TRANSACTION_UNCHECKED_FIELDS` warning rather than being silently ignored. The actual policy schema remains strict and rejects typos.
- Policy `version: 2` adds `strictTransactionShape`, `minOutputs`, `requireTypeScript`, `maxTypeScriptOutputs`, `requireOutputDataEmpty`, `requireAllowedLock`, `maxTotalFreeCapacityCKB`, and `requiredOutputs`.
- `strictTransactionShape: true` requires the seven raw transaction fields, validates the *shape* of inputs/deps/witnesses and rejects unexpected fields. It does **not** check input liveness, fee correctness, CKB-VM behavior, witness signatures, or network identity.
- JSON is limited to 1 MiB/document, 64 nested levels and 200k grammar tokens, rejects duplicate keys (including escaped equivalent spellings), and forbids invalid JSON.

## Start / Khởi chạy

```bash
npm run check
npm run dev
# open http://localhost:3000
```

No `npm install`, API key, database or blockchain node is required. Vercel deploys the static `site/` folder with `vercel.json`; the CSP blocks outgoing browser network connections.

## Native Node CLI for CI / CLI thực

```bash
node cli/cellguard.mjs --transaction examples/safe-tx.json --policy examples/strict-policy.json
node cli/cellguard.mjs --transaction examples/safe-tx.json --policy examples/strict-policy.json --format json
node cli/cellguard.mjs --transaction examples/safe-tx.json --policy examples/strict-policy.json --fail-on-warning
node cli/cellguard.mjs --transaction examples/risk-tx.json --compare examples/safe-tx.json
```

Exit 0: configured offline checks pass or comparison completes. Exit 1: policy failure (or warning with `--fail-on-warning`). Exit 2: invalid input, JSON or policy. **Never interpret exit 0 as CKB transaction validity.**

The raw comparison is index-based. Added/removed/reordered outputs can generate many differences. Output data bytes are compared exactly and long values are abbreviated in reports. Inputs, witnesses and other transaction components are not diffed.

## v2 policy fields

| Field | Meaning |
| --- | --- |
| `strictTransactionShape` | Reject missing/extra raw-transaction fields and malformed input/dependency shape |
| `minOutputs` | Require a minimum number of output cells |
| `requireTypeScript` | Require a type script on **every** output |
| `maxTypeScriptOutputs` | Limit number of type-bearing outputs |
| `requireOutputDataEmpty` | Disallow nonempty `outputs_data` |
| `requireAllowedLock` | Reject configuration if both lock allowlists are empty |
| `maxTotalFreeCapacityCKB` | Optional max sum of positive capacity minus occupied capacity; `null` disables |
| `requiredOutputs` | Up to 32 exact recipient rules, matching lock, optionally type, and amount/count ranges |

A `requiredOutputs` entry uses:

```json
{
  "lock": { "code_hash": "0x1111111111111111111111111111111111111111111111111111111111111111", "hash_type": "type", "args": "0x2222222222222222222222222222222222222222" },
  "type": null,
  "minCapacityCKB": "61",
  "maxCapacityCKB": "100",
  "minCount": 2,
  "maxCount": 2
}
```

`type: null` means **the matched output must not have a type script**. Omitting `type` means the recipient rule ignores the type-script dimension. All amounts are decimal CKB strings with at most eight fractional digits. Recipient requirements count matching outputs **independently for each rule**: overlapping rules may count the same output; define disjoint requirements if distinct outputs matter. This is an application policy and no transaction-intent signature or on-chain identity is verified.

## Web UI features

`load strict` / **strict v2 preset** loads a v2 policy while retaining the active transaction. `diff` compares the current transaction with JSON pasted into the optional comparison editor. `undo` restores the editor before a fixture, policy preset, reset or upload replacement. A confirmation dialog protects custom edits from fixture replacement. The browser discards late upload results if the editor has changed. Findings are searchable and export/copy remains local.

## Remaining gaps / chưa hỗ trợ

No full on-chain transaction preflight, RPC, CKB VM, input-capacity/fee calculation, token/balance decoding, transaction hash lookup, signature verification, real wallet integration, persistent storage, or guaranteed production safety. Additional real-chain fixtures, protocol conformance tests and third-party security review are advisable before relying on CellGuard in a signing pipeline.
