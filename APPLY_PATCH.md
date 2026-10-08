# Apply CellGuard v0.2 changed files

This patch contains only added or changed files relative to the original CellGuard-main.zip.

1. Back up the current project.
2. Extract this ZIP inside the existing project root (containing package.json and vercel.json).
3. Preserve file paths and overwrite matching existing files.
4. Run npm run check and npm run dev (Node 20+, no npm install needed).
5. Push the changes and redeploy Vercel (static outputDirectory: site).

This is a web terminal UI, not a native OS CLI. No RPC, CKB-VM or wallet integration is claimed.
