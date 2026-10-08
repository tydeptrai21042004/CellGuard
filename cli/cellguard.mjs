#!/usr/bin/env node
/** Offline, deterministic Node CLI for CI. No RPC, wallet access or signing. */
import { readFile, stat } from 'node:fs/promises';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { compareTransactions } from '../site/assets/lib/diff.mjs';
import { parseStrictJSON, MAX_JSON_BYTES } from '../site/assets/lib/strict-json.mjs';

const help = `CellGuard v0.3 · offline CKB output-policy preflight
Usage: node cli/cellguard.mjs --transaction tx.json --policy policy.json [--format text|json] [--fail-on-warning]
       node cli/cellguard.mjs --transaction tx.json --compare previous-tx.json [--format text|json]
Exit codes: 0 = configured policy checks passed (or comparison finished); 1 = policy failed / warning with --fail-on-warning; 2 = bad input or configuration
No RPC, wallet, signatures, inputs or CKB-VM are validated.\n`;
const args = process.argv.slice(2);
async function readJSON(path, label) {
  if (!path || path.startsWith('-')) throw new Error(`Missing path for ${label}`);
  if ((await stat(path)).size > MAX_JSON_BYTES) throw new Error(`${label}: file exceeds 1 MiB`);
  return parseStrictJSON(await readFile(path, 'utf8'), label);
}
async function main() {
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(help); return 0; }
  const allowed = new Set(['--transaction', '--policy', '--compare', '--format', '--fail-on-warning']);
  const config = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!allowed.has(arg) || Object.hasOwn(config, arg)) throw new Error(`Unexpected/duplicate argument: ${arg}`);
    if (arg === '--fail-on-warning') { config[arg] = true; continue; }
    config[arg] = args[++i];
    if (!config[arg] || config[arg].startsWith('--')) throw new Error(`Missing value for ${arg}`);
  }
  if (!config['--transaction']) throw new Error('Missing --transaction; run --help');
  if (!!config['--policy'] === !!config['--compare']) throw new Error('Provide exactly one of --policy or --compare');
  const format = config['--format'] ?? 'text';
  if (!['json', 'text'].includes(format)) throw new Error('--format must be text or json');
  const tx = await readJSON(config['--transaction'], 'Transaction JSON');
  if (config['--compare']) {
    if (config['--fail-on-warning']) throw new Error('--fail-on-warning only applies to policy evaluation');
    const report = compareTransactions(await readJSON(config['--compare'], 'Previous transaction JSON'), tx);
    if (format === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`Indexed output differences: ${report.changeCount}\n`);
      for (const change of report.changes) process.stdout.write(`  ${change.path}: ${change.description}\n`);
      process.stdout.write(`${report.disclaimer}\n`);
    }
    return 0;
  }
  const policy = await readJSON(config['--policy'], 'Policy JSON');
  const report = analyzeTransaction(tx, policy);
  if (format === 'json') process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`CellGuard: ${report.result} | ${report.errorCount} errors | ${report.warningCount} warnings | ${report.outputCount} outputs\n`);
    for (const item of report.findings) process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.detail}\n`);
    process.stdout.write(`LIMITATION: ${report.disclaimer}\n`);
  }
  return report.errorCount || (config['--fail-on-warning'] && report.warningCount) ? 1 : 0;
}
main().then(code => { process.exitCode = code; }, error => {
  process.stderr.write(`CellGuard input error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
