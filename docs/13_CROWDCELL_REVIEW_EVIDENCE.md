# CrowdCell Testnet evidence: reviewer-ready protocol

For the **confirmed campaign-preservation rule**, see [the dedicated updated protocol](14_RICK_CAMPAIGN_CAPACITY_PRESERVATION.md). The older beneficiary-transfer sample below models a DIFFERENT application assumption. Rick has confirmed the old April v1.1 hash is unavailable; do not request it again.

This procedure is read-only. It does not broadcast, send capacity, replay historical VM execution, or independently prove finality. The synthetic example does **not** establish that Rick's old finalize exploit occurred on-chain.

## What you can demonstrate immediately

Run `npm run check && npm run test:policies`. The policy regression report is generated at `evidence/ci-policy-report.json` and explicitly says `realTestnetEvidence: false`. The older beneficiary-transfer fixture triggers **both** `CAPACITY_LEAK_DETECTED` and `POLICY_UNAUTHORIZED_NET_GAIN`; the NEW typed-campaign reconstruction triggers `PROTECTED_CELL_CAPACITY_SHRINK` and `POLICY_UNAUTHORIZED_NET_GAIN`, and the corresponding legitimate finalize passes. This is a unit-level regression, not the real CrowdCell transaction.

## Minimal public information to request from the application author

Only public data are required. Never ask for private keys, seeds, privileged RPC credentials or wallet exports.

1. A **current** committed legitimate Testnet finalize/pledge/refund transaction hash and the exact current campaign type script. The lost historical April 2026 bug hash cannot be recovered from Rick’s description. A reproducible negative VM fixture would be useful but must be independently supplied and explicitly labeled if unverified.
2. The exact deployed **campaign, beneficiary, finalizer and contributor lock scripts** (`code_hash`, `hash_type`, `args`) for the chosen transaction. Include the expected output beneficiary locks and relevant **contract cell dependency outpoints and dep types**.
3. The finalize business rule, including who is entitled to change, permissible fees, protocol allowances and whether campaign capacity can remain under campaign control. No rule can be safely guessed from lock scripts alone.
4. Any refund `since` policy, including whether it is absolute or relative, and the expected encoded u64 value.

## Configure the strict application profile

Copy `examples/profiles/finalize.example.json` to e.g. `configs/crowdcell-finalize-testnet-v1.json` and replace **all illustrative hashes** with the real deployment values; adapt `capacityFlow` to the intended accounting (not simply the synthetic default). Do not commit the placeholder profile as real evidence. One profile should be scoped to **one transaction type**. Do likewise for pledge/refund, and review all assumptions with the dApp author.

**Important:** Capacity is fungible; the role accounting proves inequalities between aggregate input/output lock balances, **not which particular shannons moved from one Cell to another**. A beneficiary receiving sufficient value does not by itself establish permission for every other output: configure `allowedOutputRoles`, `max-net-gain`, role count/capacity caps, `requiredCellDeps`, and `sinceRules` as appropriate.

## Run the command locally

```bash
mkdir -p evidence
node cli/cellguard.mjs \
  --online testnet \
  --lookup 0xREPLACE_WITH_REAL_64_HEX_TX_HASH \
  --profile configs/crowdcell-finalize-testnet-v1.json \
  --format json --ci \
  --output evidence/finalize-testnet.json
```

Exit code `0` means policy pass under RPC-backed historical inputs, `1` means policy errors detected, `2` means operational or input error, `3` means inconclusive. A policy-failed transaction should **exit 1**, not 0. Preserve the report and inspect `accounting.inputs`, `accounting.outputs`, `accounting.roles`, `capacityFlow.roleBalances`, `findings`, block hash, confirmations and RPC limitations.

## GitHub Actions: independently reproducible execution

In **Actions → CellGuard manually triggered chain audit → Run workflow**, set:

- `tx_hash`: the real Testnet hash;
- `profile_path`: the tracked reviewed profile JSON (not an `.example.json`);
- `expected_status`: `policy-failed` to demonstrate a bug or `pass` to demonstrate a valid transaction;
- `required_codes`: for the 474 CKB example, `CAPACITY_LEAK_DETECTED,POLICY_UNAUTHORIZED_NET_GAIN` (for successful transactions leave blank);
- `min_confirmations`: normally `6` or more (only an RPC-observed threshold, **not** a finality proof);
- `network`: `testnet`.

The workflow refuses pending transactions, uncertain historical inputs, changing canonical blocks, example hashes, missing required findings, insufficient confirmations and missing accounting. It uploads `real-chain-report.json` plus a SHA-256 provenance manifest tied to the GitHub commit and policy. Only call it **real Testnet evidence** if the actual transaction and policy identities were verified with the dApp author.

## What reviewers should see

| Case | Required result | Source |
|---|---|---|
| 200,000 CKB legitimate pledge | No blanket `POLICY_EXCESS_CAPACITY` | Synthetic CI plus real pledge audit |
| Valid finalize | `pass`, intended beneficiary accounting and legitimate finalizer change | Actual committed Testnet transaction |
| Unauthorized typed-campaign 474 CKB diversion | `policy-failed`, `PROTECTED_CELL_CAPACITY_SHRINK`, campaign input/output delta and finalizer net gain | Synthetic reproduction now; a current deployed-script negative VM test is required for real contract evidence |
| Refund without required dependency | `POLICY_REQUIRED_CELL_DEP` | Synthetic regression or a historical transaction evaluated under the intended deployment policy |
| Refund with wrong `since` | `POLICY_SINCE_MISMATCH` | Synthetic regression; real chain maturity requires separate chain verification |
| Already-committed pledge | No false `INPUT_NOT_LIVE` verdict during historical audit | Committed Testnet lookup with profile |

**Do not claim a real exploit was caught** unless a verifiable public transaction or adequately corroborated historical artifact is present. When the old bug was fixed before broadcast, report *synthetic reproduction of an independently described historical bug*, not *on-chain exploit detection*.

## Suggested next message to Rick

> Thanks, that clarifies the invariant exactly. I’ll enforce that the **same typed campaign Cell** is recreated with at least its full original capacity, while any fee is covered by the finalizer’s own inputs. I’ve reproduced the 474 CKB shrinkage and several bypass cases in synthetic policy tests. I understand the April transaction hash is no longer available; if convenient, could you share a public hash for a **current valid finalize** plus the campaign **type-script identity and cell dependency**? I’ll distinguish the synthetic policy result from a real VM verification of the contract’s error 17.
