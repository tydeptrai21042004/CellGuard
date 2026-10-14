# CrowdCell Testnet evidence: reviewer-ready protocol

This procedure is read-only. It does not broadcast, send capacity, replay historical VM execution, or independently prove finality. The synthetic example does **not** establish that Rick's old finalize exploit occurred on-chain.

## What you can demonstrate immediately

Run `npm run check && npm run test:policies`. The policy regression report is generated at `evidence/ci-policy-report.json` and explicitly says `realTestnetEvidence: false`. Its simulated unauthorized 474 CKB transfer triggers **both** `CAPACITY_LEAK_DETECTED` and `POLICY_UNAUTHORIZED_NET_GAIN`, while the legitimate version does not. This is a unit-level regression, not the real CrowdCell transaction.

## Minimal public information to request from the application author

Only public data are required. Never ask for private keys, seeds, privileged RPC credentials or wallet exports.

1. The **Testnet transaction hash** of a committed pledge/finalize/refund transaction and (if available) the historical finalize bug transaction. If the bad transaction was never broadcast, request a sanitized unsigned fixture of the bad outputs with the corresponding **parent output lock/capacity metadata**, explicitly marked as *unverified*.
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
| Unauthorized 474 CKB diversion | `policy-failed`, explicit role-level value delta, `CAPACITY_LEAK_DETECTED` and/or `POLICY_UNAUTHORIZED_NET_GAIN` | Historical bad Testnet tx, **or clearly labeled unverified reproduction** |
| Refund without required dependency | `POLICY_REQUIRED_CELL_DEP` | Synthetic regression or a historical transaction evaluated under the intended deployment policy |
| Refund with wrong `since` | `POLICY_SINCE_MISMATCH` | Synthetic regression; real chain maturity requires separate chain verification |
| Already-committed pledge | No false `INPUT_NOT_LIVE` verdict during historical audit | Committed Testnet lookup with profile |

**Do not claim a real exploit was caught** unless a verifiable public transaction or adequately corroborated historical artifact is present. When the old bug was fixed before broadcast, report *synthetic reproduction of an independently described historical bug*, not *on-chain exploit detection*.

## Short request to Rick

> Thanks for testing CellGuard against CrowdCell. I added strict capacity-flow, `cell_dep` and `since` policies, committed-history auditing, and CI regressions. Would you be willing to share the public Testnet hash of the old finalize transaction (if it was broadcast), or a sanitized bad transaction/output fixture if it wasn't, plus the expected beneficiary/finalizer capacity split and required campaign dependency? I want to publish a reproducible test that catches the 474 CKB leak without falsely flagging legitimate change. No wallet secrets needed.
