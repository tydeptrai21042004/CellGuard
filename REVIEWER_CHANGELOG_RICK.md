# Focused reviewer patch: prevent CrowdCell campaign capacity shrinkage

This patch was produced from the user-supplied `CellGuard-main(5).zip`. It preserves the older v3 beneficiary-transfer profile and adds a **separate opt-in policy** for Rick's newly clarified invariant; it does not redesign other CellGuard workflows.

## Changes

1. `site/assets/lib/policy.mjs` — Adds strict `preserve-typed-cell` v3 policy validation requiring an exact type script.
2. `site/assets/lib/invariants.mjs` — Enforces exactly one typed campaign input and successor output and full original capacity retention; rejects missing type evidence; exports indexed capacity preservation evidence.
3. `site/assets/lib/analyzer.mjs` — Exports `capacityFlow.protectedCells` and flags its findings in intent checks.
4. `server/verification.mjs` — Carries type-script metadata through the live RPC and committed-historical RPC parent-cell resolution and records types in historical accounting.
5. `examples/profiles/crowdcell-preserve.example.json` — Illustrative campaign-preservation policy, one-to-one typed Cell rule, fee funded by finalizer, bounded fees, strict deps and role requirements. **Contains placeholder hashes.**
6. `examples/crowdcell-synthetic/preserve-{inputs.unverified,valid,leak-474}.json` — Exact synthetic 600→126 CKB shrinkage plus 474 CKB payout to signer; valid preservation fixture.
7. `tests/crowdcell-preservation.test.mjs` — Live/historical mocked RPC, fee-siphoning, impersonated lock, duplicate outputs, missing metadata, and valid finalizer-owned change.
8. `scripts/policy-regression.mjs` — Adds 8 strict policy cases to the older 13; synthetic evidence exported as `evidence/ci-policy-report.json` by test run.
9. `docs/14_RICK_CAMPAIGN_CAPACITY_PRESERVATION.md`, `README.md`, `docs/13_CROWDCELL_REVIEW_EVIDENCE.md` — Reproducible acceptance protocol and clear limitations.

## Quick verification

```bash
npm run check
npm run test:policies
node cli/cellguard.mjs \
  --transaction examples/crowdcell-synthetic/preserve-leak-474.json \
  --profile examples/profiles/crowdcell-preserve.example.json \
  --input-cells examples/crowdcell-synthetic/preserve-inputs.unverified.json \
  --format json
```

Expected: `PROTECTED_CELL_CAPACITY_SHRINK`, `POLICY_UNAUTHORIZED_NET_GAIN`, `shortfallCKB: "474"`. Tests use **mock RPC and illustrative fixtures** only; no real Testnet transaction was fetched or contract VM executed. The dApp author's statement that newer scripts use `error 17` is not independently proven by this patch. Use actual deployed scripts/outpoints and obtain a *current* legitimate finalize transaction for verified Testnet acceptance evidence.
