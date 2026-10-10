# CellGuard v0.5 — Capacity invariants and committed-history audit

## Motivation

A CKB transaction may pass protocol validation and still violate application-specific economic invariants. In particular, the amount not occupied by cell structure is not "excess" capacity by itself: capacity is the value carried by the Cell. V3 policies do not apply a generic output-capacity ceiling unless the developer explicitly requests one.

The role-flow evaluator accounts for exact lock scripts, not addresses or loose code-hash matches. It computes aggregated `inputCKB`, `outputCKB`, and `netCKB` by configured role. It never claims to identify the physical provenance of fungible CKB between individual inputs and outputs.

## Policy V3 schema

Start with `examples/profiles/finalize.example.json` (synthetic keys only). New keys:

- `version: 3`, `profile: string`
- `roles: {alias: {code_hash,hash_type,args}}` — exact CKB lock scripts; no overlapping aliases
- `allowedInputRoles` and `allowedOutputRoles` — optional exact-role allowlists
- `capacityFlow` with `max-net-gain` and `min-recipient-net-gain` rules
- `sinceRules` with `operator: exact | at-least` and `value: 0x...`
- `maxFeeCKB` — optional exact bound; defaults to `null`
- V1/V2 `requiredCellDeps`, `requiredOutputs`, script allowlists, and resource limits remain supported

For a max-net-gain rule, `net(role) = output(role) - input(role)`. A zero finalizer net-gain cap allows return of its independently contributed input capacity while rejecting an unauthorized increase.

For a min-recipient-net-gain rule, `sourceDebit = max(0, input(source) - output(source))`. The minimum required recipient net gain is `max(0, ceil(minRatio × sourceDebit) - feeAllowanceCKB)`. Ratios and capacities use exact `BigInt` arithmetic in shannons. A group of destinations can be named. `minSourceInputCKB` prevents rules from passing vacuously when the intended source is absent.

**Design condition:** Choose role scopes carefully. Aggregated net balances cannot by themselves prove causal transfer between individual inputs and outputs. Include output recipient allowlists, exact required outputs, minimum source amounts, and contract-specific rules where appropriate. Inputs from external third parties can alter global net accounting. This is application-policy checking, not CKB consensus validation.

## Demonstration (synthetic, no chain transaction)

```sh
# The synthetic 474-CKB leak is detected (policy failure exit 1).
node cli/cellguard.mjs \
  --transaction examples/crowdcell-synthetic/finalize-leak-474.json \
  --profile examples/profiles/finalize.example.json \
  --input-cells examples/crowdcell-synthetic/finalize-inputs.unverified.json \
  --ci --format json

# The valid synthetic finalize has no policy violations but exit 3,
# because input cells were supplied from a file, NOT trusted RPC data.
node cli/cellguard.mjs \
  --transaction examples/crowdcell-synthetic/finalize-valid.json \
  --profile examples/profiles/finalize.example.json \
  --input-cells examples/crowdcell-synthetic/finalize-inputs.unverified.json \
  --ci --format json
```

These fixtures model the reported issue but are not Rick's original CrowdCell transaction. Replace all role scripts and required dep OutPoints with real application values before using a policy on Testnet. Do not use example scripts for production enforcement.

## Verify a real pre-broadcast transaction (read-only)

```sh
node cli/cellguard.mjs --transaction signed-tx.json \
  --profile profiles/my-finalize.json --online testnet \
  --format json --ci --output evidence.json
```

RPC-resolved live input locks/capacities are used for role accounting; scripts and node transaction-pool acceptance are checked independently. No transaction is sent to the network. CLI output distinguishes a policy failure (exit 1) from inconclusive verification (exit 3).

## Audit a committed transaction

```sh
node cli/cellguard.mjs --lookup 0xYOUR_REAL_64_HEX_TX_HASH \
  --profile profiles/my-finalize.json --online testnet --ci \
  --format json --output historical-evidence.json
```

The historical auditor resolves every input from the originating committed transaction's output, checks canonical block status according to the selected RPC, and evaluates the policy. It does **not** call `get_live_cell` to test those spent inputs. If a parent output, canonical inclusion, or script is unavailable, the audit is inconclusive and **not** marked as a policy pass.

The web UI includes **audit with policy ↗**, which uses the hash field and policy JSON editor. The HTTP API also accepts `{"action":"audit","network":"testnet","hash":"0x...","policy":{...}}`.

## Since checks and limitations

The `sinceRules` comparison checks syntactic flags and *like-for-like encoded values*. For epoch values it uses rational `(epoch, index/length)` comparisons rather than comparing packed hexadecimal integers. It distinguishes the absolute/relative and metric flags.

This is **not** chain-maturity validation. Correct absolute/relative maturity requires block and epoch/timestamp context for the target and parent commitment blocks, including CKB's consensus-specific handling. VM/txpool RPC checks may indicate current acceptability but cannot guarantee later inclusion or finality. Historical VM replay and independent SPV proof validation are not implemented.

## Exit codes

- `0`: configured checks passed with no required evidence missing
- `1`: policy violation or known verification rejection
- `2`: malformed input, invalid policy, or RPC/transport error
- `3`: inconclusive state, missing verified inputs or externally provided fixture evidence

The compatibility V1/V2 evaluator remains available. The default arbitrary 1,000 CKB total-capacity ceiling is now disabled for all policy versions. An **explicit** `maxTotalOutputCapacityCKB` setting in existing V1/V2 policies is still enforced; remove it or set it to `null` for unrestricted normal large-value payments. `maxFreeCapacityCKBPerOutput` remains opt-in.

## What this does not yet prove

No actual CrowdCell fixture was supplied with the reported 474 CKB example. The new tests use deterministic synthetic transactions and injected/mocked CKB RPC methods. A reproducible public-Testnet CrowdCell replay, contract-specific data validation, rigorous historical VM execution, multi-node consistency and end-to-end browser testing are still needed before claiming production readiness.

References: [CKB RFC17 (since)](https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0017-tx-valid-since/0017-tx-valid-since.md); [CKB RPC reference](https://docs.rs/crate/ckb-rpc/1.2.1/source/README.md).
