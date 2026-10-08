#!/usr/bin/env node
/** Offline policy CLI + optional read-only CKB RPC verification (no keys or broadcast). */
import { readFile, stat } from 'node:fs/promises';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { compareTransactions } from '../site/assets/lib/diff.mjs';
import { parseStrictJSON, MAX_JSON_BYTES } from '../site/assets/lib/strict-json.mjs';
import { createRpc } from '../server/rpc.mjs';
import { lookupTransactionOnline, verifyTransactionOnline } from '../server/verification.mjs';

const help = `CellGuard v0.4 · offline policy + read-only online CKB verification
Usage: node cli/cellguard.mjs --transaction tx.json --policy policy.json [--format text|json] [--fail-on-warning]
       node cli/cellguard.mjs --transaction tx.json --policy policy.json --online testnet|mainnet [--format text|json]
       node cli/cellguard.mjs --online testnet|mainnet --lookup 0x<64 hex> [--format text|json]
       node cli/cellguard.mjs --transaction tx.json --compare previous-tx.json [--format text|json]
Online mode makes read-only requests to CKB RPC and sends the signed transaction JSON (with witnesses) to the node.
A successful CKB VM script execution does NOT prove full consensus validity, and arbitrary scripts may not verify cryptographic signatures.
Exit: 0 = checks passed/committed/compare success; 1 = failure or inconclusive online result; 2 = input or transport error.
`;
const args = process.argv.slice(2);
async function readJSON(path, label) {
  if (!path || path.startsWith('-')) throw new Error(`Missing path for ${label}`);
  if ((await stat(path)).size > MAX_JSON_BYTES) throw new Error(`${label}: file exceeds 1 MiB`);
  return parseStrictJSON(await readFile(path, 'utf8'), label);
}
function parseArgs() {
  const allowed = new Set(['--transaction','--policy','--compare','--online','--lookup','--format','--fail-on-warning']);
  const config = {};
  for (let i=0; i<args.length; i++) {
    const name = args[i];
    if (!allowed.has(name) || Object.hasOwn(config,name)) throw new Error(`Unexpected/duplicate argument: ${name}`);
    if (name === '--fail-on-warning') { config[name] = true; continue; }
    config[name] = args[++i];
    if (!config[name] || config[name].startsWith('--')) throw new Error(`Missing value for ${name}`);
  }
  if (!['json','text'].includes(config['--format'] ?? 'text')) throw new Error('--format must be text or json');
  if (config['--online'] && !['mainnet','testnet'].includes(config['--online'])) throw new Error('--online must be mainnet or testnet');
  if (config['--lookup']) {
    if (!config['--online'] || config['--policy'] || config['--compare'] || config['--transaction']) throw new Error('--lookup requires --online and must not include transaction/policy/compare');
  } else {
    if (!config['--transaction']) throw new Error('Missing --transaction; run --help');
    if (!!config['--policy'] === !!config['--compare']) throw new Error('Provide exactly one of --policy or --compare');
    if (config['--compare'] && (config['--online'] || config['--fail-on-warning'])) throw new Error('Comparison is offline only');
  }
  return config;
}
function output(report, config) {
  if (config['--format'] === 'json') { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); return; }
  if (report.mode === 'indexed-output-diff') {
    process.stdout.write(`Indexed output differences: ${report.changeCount}\n`);
    for (const change of report.changes) process.stdout.write(`  ${change.path}: ${change.description}\n`);
    process.stdout.write(`${report.disclaimer}\n`);
  } else if (report.mode === 'online-preflight') {
    process.stdout.write(`CellGuard ONLINE ${report.network}: ${report.status} | live ${report.liveInputCount}/${report.inputCount} | fee ${report.feeCKB ?? '?'} CKB | VM ${report.scripts.status} | pool ${report.txPool.status} | cycles ${report.scripts.cycles ?? '?'}\n`);
    for (const item of report.findings) process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code}: ${item.detail}\n`);
    process.stdout.write(`${report.limitations}\n`);
  } else if (report.mode === 'chain-lookup') {
    process.stdout.write(`CKB ${report.network} hash ${report.hash}: ${report.status} | confirmations ${report.confirmations ?? '?'}\n${report.limitations}\n`);
  } else {
    process.stdout.write(`CellGuard: ${report.result} | ${report.errorCount} errors | ${report.warningCount} warnings | ${report.outputCount} outputs\n`);
    for (const item of report.findings) process.stdout.write(`  ${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.detail}\n`);
    process.stdout.write(`LIMITATION: ${report.disclaimer}\n`);
  }
}
async function main() {
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(help); return 0; }
  const config = parseArgs();
  let report;
  if (config['--lookup']) {
    report = await lookupTransactionOnline({ network: config['--online'], hash: config['--lookup'] }, createRpc(config['--online']));
  } else {
    const tx = await readJSON(config['--transaction'], 'Transaction JSON');
    if (config['--compare']) report = compareTransactions(await readJSON(config['--compare'], 'Previous transaction JSON'), tx);
    else {
      const policy = await readJSON(config['--policy'], 'Policy JSON');
      report = config['--online'] ? await verifyTransactionOnline({ network: config['--online'], transaction: tx, policy }, createRpc(config['--online'])) : analyzeTransaction(tx, policy);
    }
  }
  output(report, config);
  if (report.mode === 'online-preflight') return report.status === 'pass' && !(config['--fail-on-warning'] && report.findings.some(x => x.severity === 'warning')) ? 0 : 1;
  if (report.mode === 'chain-lookup') return report.status === 'committed' ? 0 : 1;
  if (report.mode === 'indexed-output-diff') return 0;
  return report.errorCount || (config['--fail-on-warning'] && report.warningCount) ? 1 : 0;
}
main().then(code => { process.exitCode = code; }, error => {
  process.stderr.write(`CellGuard error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
