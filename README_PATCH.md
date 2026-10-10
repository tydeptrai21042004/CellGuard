# CellGuard v0.5 — Rick feedback patch

This release implements:

- Version 3 profiles with exact input/output lock roles, transaction-type allowlists, BigInt capacity accounting, max role net-gain limits, and minimum recipient net-gain ratios.
- Real-input-capacity resolution through read-only CKB RPC for pre-broadcast transactions, plus historical input resolution for committed transactions; missing evidence is **inconclusive** rather than success.
- Detection of the synthetic 474 CKB finalizer leak, even with simulated VM/txpool pass. A legitimate finalizer's own change is not classified as stolen proceeds.
- Exact required cell dependencies (previously implemented in V2), with policy files for synthetic pledge, finalize and refund examples.
- `since` flag/format checks and epoch-fraction comparisons (not full on-chain maturity assertions).
- No default universal output-capacity ceiling and no free-capacity warning unless explicitly configured.
- CLI `--profile`, `--lookup HASH --profile POLICY`, `--input-cells` test fixture support, `--ci` mode, JSON `--output`, plus web historical-audit button.
- Consistent English CKB parser, policy and finding messages.
- 108 passing Node.js tests and reproducible CI workflow.

**What remains unproven:** A real CrowdCell Testnet replay, production dApp contract correctness, independent cryptographic/SPV verification, and actual Vercel integration under a public RPC provider. Sample transaction IDs, scripts, and Cell inputs are deliberately synthetic.

Read `docs/10_V05_CAPACITY_FLOW.md` and `APPLY_PATCH.md` before deployment.
