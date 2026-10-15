# CrowdCell finalize: preserving the campaign Cell's entire capacity

**Status:** synthetic, deterministic reconstruction of the dApp author's description. The old April 2026 v1.1 Testnet transaction hash was not retained. This report is **not** a recovered on-chain exploit and does not verify the CrowdCell type script's error-code numbering.

## Exact business rule supplied by the reviewer

A finalize transaction consumes a campaign Cell with capacity **C** and must produce a successor campaign Cell with **capacity at least C**. It must not replace the original with the occupied-capacity minimum **M**, then transfer `C - M` to the signing finalizer (reported example ≈474 CKB). The finalizer must cover the miner fee with its **own input capacity**. This is claimed by the dApp author to be enforced by the newer CrowdCell type script (`error 17`); CellGuard does not independently assert the deployed script implements that error code.

For *this specific finalize action* (one unique typed campaign Cell), the preflight policy is:

- Exactly **one input** and **one output** carrying the **same complete campaign type script** (`code_hash`, `hash_type`, `args`); in the supplied synthetic profile, the campaign lock is also required to stay within its permitted role.
- `successor_campaign_capacity >= original_campaign_capacity`, with **zero fee allowance**, even for a one-shannon deficit. The minimum occupied capacity is NOT the conservation threshold.
- Finalizer net gain `finalizer_outputs - finalizer_inputs <= 0`; an actual fee should appear as a loss in its input/output balance. Output/input role allowlists, role count requirements, and exact cell dependencies are checked separately.

**Limit:** CKB capacity is fungible. Aggregate role accounting is an application-level invariant, not tracing individual shannons from a specific input to a specific output. The typed-Cell check does directly compare one uniquely identified input and output; it does not independently execute or prove the contract code.

## New strict policy rule

Add a v3 rule to `capacityFlow`:

```json
{
  "id": "campaign-type-capacity-preservation",
  "kind": "preserve-typed-cell",
  "type": {
    "code_hash": "0x4444444444444444444444444444444444444444444444444444444444444444",
    "hash_type": "type",
    "args": "0x5555555555555555555555555555555555555555555555555555555555555555"
  }
}
```

The hashes are **placeholders**. A real profile must use the exact campaign type script for the relevant network, contract deployment and campaign identity. If one real type script represents *multiple* campaign Cells per transaction, this one-to-one profile does **not** apply without a contract-specific extension. The rule never authorizes a value transfer; it only enforces no shrinking of that typed Cell.

The full ready-to-edit policy is `examples/profiles/crowdcell-preserve.example.json`. Its old `finalize.example.json` counterpart remains for backward-compatible beneficiary-transfer demos, but **does not model Rick's clarified campaign-preservation rule**.

## Deterministic synthetic reproduction

Fixtures:

- `examples/crowdcell-synthetic/preserve-inputs.unverified.json`: 600 CKB campaign input and 100 CKB finalizer input; the campaign input has the matching type script.
- `examples/crowdcell-synthetic/preserve-valid.json`: 600 CKB successor campaign Cell, 99.9 CKB finalizer change, 0.1 CKB fee; expected **no policy errors**.
- `examples/crowdcell-synthetic/preserve-leak-474.json`: 126 CKB campaign output (the occupied minimum for an empty-data Cell with the example scripts), **474 CKB unauthorized payout** to the finalizer plus 99.9 CKB legitimate finalizer change. The fee remains 0.1 CKB. Expected `PROTECTED_CELL_CAPACITY_SHRINK` and `POLICY_UNAUTHORIZED_NET_GAIN`.

Run offline (no node, no funds):

```bash
npm run check
npm run test:policies
node cli/cellguard.mjs \
  --transaction examples/crowdcell-synthetic/preserve-leak-474.json \
  --profile examples/profiles/crowdcell-preserve.example.json \
  --input-cells examples/crowdcell-synthetic/preserve-inputs.unverified.json \
  --format json
```

The report's `capacityFlow.protectedCells` lists type fingerprint, input OutPoint, input/output indices, capacity and shortfall. For the bad synthetic case it reports `shortfallCKB: "474"`, `status: "shrunk"`; the application policy fails. Offline metadata is **unverified** even when this check passes. CLI `--ci` returns exit **3** for an unverified policy pass and exit **1** for an observed policy violation; this is not a CKB VM result.

## Important negative cases covered by tests

| Scenario | Expected outcome |
| --- | --- |
| Legitimate finalizer-funded fee | Pass: campaign capacity unchanged |
| Finalizer gets 474 CKB from campaign | `PROTECTED_CELL_CAPACITY_SHRINK`; also finalizer net-gain violation |
| Campaign-funded transaction fee (even one shannon) | `PROTECTED_CELL_CAPACITY_SHRINK` |
| Unauthorized outsider receives campaign's missing capacity | Protected-cell violation, even if finalizer has no net gain |
| Another untyped output uses the campaign lock to disguise loss | Protected-cell violation despite lock-role balance of zero |
| Campaign successor type removed or duplicated | `PROTECTED_CELL_COUNT_MISMATCH` |
| Missing type script on any resolved RPC input | `INPUT_TYPE_EVIDENCE_REQUIRED` (fail closed) |
| Larger finalizer input and correctly returned change | Pass; avoids false positives |

The `tests/crowdcell-preservation.test.mjs` suite also exercises both mock read-only live-RPC and historical-parent-RPC paths. `scripts/policy-regression.mjs` includes exact-code gates for the synthetic cases. No real CrowdCell chain calls or actual contract VM execution occur in these tests.

## Evidence needed for an actual CrowdCell acceptance test

The April v1.1 bug transaction cannot be replayed from a missing hash alone. **Do not ask Rick for the lost hash again.** Instead request the public **current** CrowdCell Testnet deployment type script, campaign lock, exact contract `cell_dep` and one known legitimate finalize transaction hash (or a documented finalized test case). Validate the exact one-to-one invariant applies to that deployment and then run read-only historical `--lookup HASH --profile POLICY` against an appropriate Testnet RPC. Attach the policy hash, repository revision, RPC findings and chain identity. To show real execution of `error 17`, CrowdCell maintainers must independently run a controlled negative VM/contract test using the actual deployed script binary and publish its fixture/trace. CellGuard's policy finding is distinct from VM script rejection.

Only after verified evidence can the project claim live Testnet campaign preservation; a synthetic case must remain explicitly labeled synthetic.
