# CellGuard v0.3 changed-files patch

This archive contains **only changed or new files** relative to the user-supplied `CellGuard-main (1).zip`. It is not a full standalone source snapshot.

1. Back up your CellGuard repository or commit outstanding changes first.
2. Extract the ZIP **into the repository parent folder**, preserving `CellGuard-main/` paths, or copy the contents of `CellGuard-main/` into your existing project root. Replace matching files.
3. Run `npm run check`, then `npm run dev` (Node.js 20+). **No npm install, API keys, DB, service or RPC setup** needed.
4. Deploy to Vercel as a static site with the existing `vercel.json`; outputDirectory remains `site`.
5. Read `docs/08_CELLGUARD_V03_USAGE.md` for the new strict policy v2, real Node CLI, CI exit codes, transaction diff and explicit limitations.

`examples/*.json` are synthetic, **not live-chain verified**. The browser terminal is a safe UI command parser, while `cli/cellguard.mjs` is a separate, actual Node CLI usable in GitHub Actions.

This patch intentionally preserves policy v1 compatibility. Policy v2 checks raw shape and configured recipient constraints, **not consensus-validity**, actual input balances, fee correctness, signatures, CKB-VM execution or script cycles.
