# Apply CellGuard v0.4 live-RPC patch

This is a **changed/new files only** patch compared with the previously supplied CellGuard v0.3 archive. **First apply v0.3** to your original repository, then overlay these v0.4 files at the same relative paths (replace existing files). Do not rename `api/` or `server/`: Vercel discovers the API function at `api/verify.mjs` automatically.

```bash
npm run check
npm run dev
```

Open http://localhost:3000, select Testnet/Mainnet under **Live CKB verification**, then use a complete signed CKB raw transaction or an existing transaction hash. See `docs/09_LIVE_CKB_RPC_AND_E2E.md` for production details and limits. No extra runtime npm dependencies, wallet, database, or signing keys are required.

**Important:** Existing examples are synthetic and intentionally cannot pass live verification. Live checks contact RPC endpoints and send transaction data, including witnesses, to the configured node. No `send_transaction` call exists in the server.
