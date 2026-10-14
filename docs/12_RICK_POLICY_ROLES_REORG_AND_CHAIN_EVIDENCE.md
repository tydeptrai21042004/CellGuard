# CellGuard policy hardening for CrowdCell-style transactions

## What this patch adds

- **Fail-closed v3 role requirements** (`roleRequirements`): require campaign, beneficiary or contributor lock roles on **real inputs and outputs**, with minimum/maximum counts and aggregate capacity bounds. Roles match **complete lock script fingerprints**, not merely a code hash. Required input checks never pass without resolved input Cells.
- **Historical audit reorg guards**: require the target to remain committed in the same block across the initial lookup and raw-transaction retrieval; recheck the block's canonical hash and the latest tip **after** parent-Cell resolution. If the chain changes, return `inconclusive` and suppress claimed policy success.
- **Explicit preflight vs history messaging**: `INPUT_NOT_LIVE` means the input cannot be reused in a new transaction; it is not evidence that a **previously committed** transaction was invalid. For an already committed transaction, use `--lookup` with an application policy, rather than the preflight interface.
- **Stricter evidence**: 13 deterministic synthetic policy scenarios must match their **exact expected error codes**. The report explicitly records `realTestnetEvidence: false`, counts and fixture SHA-256. A separate manual GitHub workflow supports real historical transaction audits with an explicitly supplied versioned policy.
- **CI fail-closed policy audit**: `--ci --lookup HASH` **without a profile** exits 3 (inconclusive for application-policy compliance), even if the chain lookup confirms commitment. The regular lookup command without `--ci` keeps its original meaning.

## New `roleRequirements` policy field

Use with a version-3 policy containing matching `roles` entries. Fields are optional unless configured, and amounts are decimal strings in **CKB** (at most 8 fractional digits).

```json
{
  "roleRequirements": [
    { "role": "campaign", "minInputCount": 1, "minInputCapacityCKB": "1" },
    { "role": "beneficiary", "minOutputCount": 1, "minOutputCapacityCKB": "1" },
    { "role": "finalizer", "maxOutputCount": 1, "maxOutputCapacityCKB": "100" }
  ]
}
```

For any role you may set `minInputCount`, `maxInputCount`, `minOutputCount`, `maxOutputCount`, `minInputCapacityCKB`, `maxInputCapacityCKB`, `minOutputCapacityCKB`, and `maxOutputCapacityCKB`. The rule rejects duplicate roles and unknown properties. Output obligations are checked even without input evidence; input obligations cannot be verified without resolved input locks/capacity. The per-role output cap in this example is **illustrative**; derive real limits from the application.

The sample profiles at `examples/profiles/{pledge,finalize,refund}.example.json` now include basic role presence checks in addition to capacity-flow and dependency rules. **They contain placeholder lock hashes and dep outpoints and must never be used to assert real dApp safety.**

## Locally reproduce Rick's reported issue (synthetic fixture)

```bash
npm run check
npm run test:policies
node cli/cellguard.mjs \
  --transaction examples/crowdcell-synthetic/finalize-leak-474.json \
  --profile examples/profiles/finalize.example.json \
  --input-cells examples/crowdcell-synthetic/finalize-inputs.unverified.json \
  --format json --ci
```

For the last command **exit code 1 is expected**. It reports `CAPACITY_LEAK_DETECTED` and `POLICY_UNAUTHORIZED_NET_GAIN`; it is a synthetic recreation, **not Rick's confirmed chain transaction**. Local input metadata is explicitly unverified, so even a passing fixture returns CLI exit 3 in CI mode. The deterministic policy gate produces `evidence/ci-policy-report.json` (ignored by Git).

## How to run a real CrowdCell Testnet audit

1. Get a **public Testnet transaction hash** and the actual lock identities, required dependency outpoints and intended beneficiary accounting **from the dApp owner**. Never request a signing key or seed phrase.
2. Copy the corresponding example to a **real, versioned profile** in your repository (e.g. `configs/crowdcell-finalize-testnet-v1.json`), replacing all placeholders, and review the CKB fee allowance and intended recipients. Keep this policy next to the audited Git revision.
3. Use the terminal to perform a read-only historical audit:

```bash
node cli/cellguard.mjs --online testnet --lookup 0xREAL_TRANSACTION_HASH \
  --profile configs/crowdcell-finalize-testnet-v1.json \
  --ci --format json --output evidence/finalize-testnet.json
```

4. For GitHub Actions, go to **Actions → CellGuard manually triggered chain audit → Run workflow**. Enter `tx_hash`, tracked `profile_path`, `expected_status` (`pass` or `policy-failed`) and `network=testnet`. The job runs tests, queries the configured read-only RPC and uploads a policy-hash / report-hash / commit-SHA provenance manifest. `policy-failed` is a successful **expected detection** only when the recorded CLI exit and finding codes agree.
5. Preserve the full RPC report, block number/hash, transaction hash, policy SHA-256, Git commit, and CI artifact. Repeat the audit later to check canonical state stability. A committed status is not an independent finality guarantee.

The real-chain workflow refuses `.example.json` policies and obvious placeholder scripts, and will **not** label pending, missing-parent, reorged, or inconclusive results as passing audit evidence. It never submits or signs transactions. Network access and correctly configured real policy files are prerequisites that cannot be replaced by tests.

## Limitations

The `sinceRules` validate encoded policy thresholds, not chain maturity. `requiredCellDeps` ensures specified dependency **outpoints and types** are present; it does not prove the contract uses them correctly. Capacity-flow rules compare **net aggregate lock-role balances**, not provenance of particular fungible CKB units. A read-only RPC result is an observation of a particular node, and `verify_transaction_proof` is verified by the same RPC node. No independent SPV verification, historical VM replay, audit of custom script semantics, or finality guarantee is provided.
