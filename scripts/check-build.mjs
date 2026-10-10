import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const required = [
  'vercel.json', 'site/index.html', 'site/assets/main.mjs',
  'site/assets/styles.css', 'site/assets/lib/ckb.mjs',
  'site/assets/lib/policy.mjs', 'site/assets/lib/analyzer.mjs', 'site/assets/lib/invariants.mjs',
  'site/assets/lib/fixtures.mjs', 'site/assets/lib/terminal.mjs',
  'site/assets/lib/diff.mjs', 'site/assets/lib/strict-json.mjs',
  'cli/cellguard.mjs', 'api/verify.mjs', 'server/http.mjs', 'server/rpc.mjs', 'server/verification.mjs', '.github/workflows/ci.yml', '.gitignore',
  'examples/safe-tx.json', 'examples/strict-policy.json', 'docs/01_TRIEN_KHAI_VERCEL.md'
];
for (const path of required) {
  if (!existsSync(join(root, path))) throw new Error(`Missing deployment file: ${path}`);
}
const v = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
if (v.framework !== null || v.outputDirectory !== 'site' || v.buildCommand !== null) {
  throw new Error('Static Vercel settings changed unexpectedly');
}
for (const file of required.filter((p) => p.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file}: ${result.stderr}`);
}
console.log('PASS: static deployment layout, Vercel config and JavaScript syntax');
