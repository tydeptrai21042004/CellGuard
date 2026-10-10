# Apply CellGuard v0.5

Two release archives are provided:

1. `CellGuard-v0.5-FULL.zip`: complete ready-to-run source tree based on the user's uploaded `CellGuard-main(3).zip`. Extract the `CellGuard-main/` folder as a standalone project.
2. `CellGuard-v0.5-CHANGED-FILES.zip`: only modified/new source files relative to the uploaded `CellGuard-main(3).zip`. Extract at your repo root, keeping directory structure and replacing matching files.

To apply the changed-files ZIP to a local Git repository:

```bash
# Extract the ZIP and copy its CellGuard-main/ content to your repository root,
# preserving paths (e.g. site/assets/lib/invariants.mjs).
npm run check
npm run dev
```

For the new V3 policy format, read [docs/10_V05_CAPACITY_FLOW.md](docs/10_V05_CAPACITY_FLOW.md).

**Do not use the synthetic CrowdCell example scripts/dependencies as real project identifiers.** Real Testnet evaluation requires your own exact CKB lock scripts, contract dependencies, committed transaction hashes and application-specific invariants.

This release never broadcasts transactions. The online path contacts the configured RPC, and a preflight of a *spent* transaction is not a historical audit. To audit an already-committed transaction, use `--lookup HASH --profile POLICY --online testnet` or the web UI's **audit with policy** button.
