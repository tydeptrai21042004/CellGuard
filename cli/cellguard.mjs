#!/usr/bin/env node
/** Offline policy CLI + optional read-only CKB RPC verification (no keys or broadcast). */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { compareTransactions } from '../site/assets/lib/diff.mjs';
import { parseStrictJSON, MAX_JSON_BYTES } from '../site/assets/lib/strict-json.mjs';
import { createRpc } from '../server/rpc.mjs';
import { auditCommittedTransactionOnline, lookupTransactionOnline, verifyTransactionOnline } from '../server/verification.mjs';

const help = `CellGuard v0.5 · policy invariants + read-only CKB RPC verification
Usage: node cli/cellguard.mjs --transaction tx.json --profile profile.json [--format json|text] [--ci]
       node cli/cellguard.mjs --transaction tx.json --policy policy.json --online testnet|mainnet [--ci]
       node cli/cellguard.mjs --online testnet|mainnet --lookup 0x<hash> --profile profile.json [--ci]
       node cli/cellguard.mjs --online testnet|mainnet --lookup 0x<hash>
       node cli/cellguard.mjs --transaction tx.json --profile profile.json --input-cells fixture.json
       node cli/cellguard.mjs --transaction tx.json --compare old.json
--profile and --policy are aliases for JSON policy file path. No embedded CrowdCell keys are assumed.
--input-cells accepts externally supplied UNVERIFIED input metadata for deterministic tests only.
--ci fails closed for missing/untrusted input evidence; --output saves JSON evidence to a file.
Online verification sends signed witnesses to your configured CKB RPC, but does NOT broadcast.
Exit: 0 all required checks passed; 1 policy failure; 2 invalid input/transport; 3 inconclusive/untrusted verification.
`;
const args = process.argv.slice(2);
async function readJSON(path, label) {
  if (!path || path.startsWith('-')) throw new Error(`Missing path for ${label}`);
  if ((await stat(path)).size > MAX_JSON_BYTES) throw new Error(`${label}: file exceeds 1 MiB`);
  return parseStrictJSON(await readFile(path, 'utf8'), label);
}
function parseArgs() {
  const allowed = new Set(['--transaction','--policy','--compare','--online','--lookup','--format','--fail-on-warning','--profile','--input-cells','--ci','--output']);
  const config = {};
  for (let i=0; i<args.length; i++) {
    const name = args[i];
    if (!allowed.has(name) || Object.hasOwn(config,name)) throw new Error(`Unexpected/duplicate argument: ${name}`);
    if (name === '--fail-on-warning' || name === '--ci') { config[name] = true; continue; }
    config[name] = args[++i];
    if (!config[name] || config[name].startsWith('--')) throw new Error(`Missing value for ${name}`);
  }
  if (!['json','text'].includes(config['--format'] ?? 'text')) throw new Error('--format must be text or json');
  if (config['--online'] && !['mainnet','testnet'].includes(config['--online'])) throw new Error('--online must be mainnet or testnet');
  if (config['--profile'] && config['--policy']) throw new Error('Choose --profile or --policy, not both');
  const hasPolicy = !!(config['--profile'] || config['--policy']);
  if (config['--lookup']) {
    if (!config['--online'] || config['--compare'] || config['--transaction'] || config['--input-cells'])
      throw new Error('--lookup requires --online and cannot include a transaction or fixture');
  } else {
    if (!config['--transaction']) throw new Error('Missing --transaction; run --help');
    if (hasPolicy === !!config['--compare']) throw new Error('Provide exactly one of --profile/--policy or --compare');
    if (config['--compare'] && (config['--online'] || config['--fail-on-warning'] || config['--ci'])) throw new Error('Comparison is offline only');
    if (config['--input-cells'] && config['--online']) throw new Error('Unverified fixture inputs cannot be used with --online');
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
  } else if (report.mode === 'committed-audit') {
    process.stdout.write(`CKB historical audit ${report.network} ${report.hash}: ${report.status} | chain ${report.chainStatus} | confirmations ${report.confirmations ?? '?'}\n`);
    for (const f of report.findings) process.stdout.write(`  ${f.severity.toUpperCase()} ${f.code}: ${f.detail}\n`);
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
    const policyFile = config['--profile'] || config['--policy'];
    report = policyFile
      ? await auditCommittedTransactionOnline({ network: config['--online'], hash: config['--lookup'], policy: await readJSON(policyFile, 'Profile JSON') }, createRpc(config['--online']))
      : await lookupTransactionOnline({ network: config['--online'], hash: config['--lookup'] }, createRpc(config['--online']));
  } else {
    const tx = await readJSON(config['--transaction'], 'Transaction JSON');
    if (config['--compare']) report = compareTransactions(await readJSON(config['--compare'], 'Previous transaction JSON'), tx);
    else {
      const policy = await readJSON(config['--profile'] || config['--policy'], 'Policy JSON');
      let context = {};
      if (config['--input-cells']) {
        const cells = await readJSON(config['--input-cells'], 'Input Cells fixture');
        if (!Array.isArray(cells)) throw new Error('Input Cells fixture must be a JSON array');
        context = { resolvedInputs: cells, inputEvidence: 'provided-unverified' };
      }
      report = config['--online'] ? await verifyTransactionOnline({ network: config['--online'], transaction: tx, policy }, createRpc(config['--online'])) : analyzeTransaction(tx, policy, context);
    }
  }
  output(report, config);
  if (config['--output']) await writeFile(config['--output'], JSON.stringify(report, null, 2) + '\n', { flag: 'w', mode: 0o600 });
  if (report.mode === 'online-preflight' || report.mode === 'committed-audit') {
    if (['inconclusive'].includes(report.status)) return 3;
    if (report.status !== 'pass' || (config['--fail-on-warning'] && report.findings.some(x => x.severity === 'warning'))) return 1;
    return 0;
  }
  if (report.mode === 'chain-lookup') return report.status === 'committed' ? 0 : 1;
  if (report.mode === 'indexed-output-diff') return 0;
  if (report.errorCount && !report.findings.every(f => f.code === 'INPUT_EVIDENCE_REQUIRED')) return 1;
  if (report.capacityFlow?.inputEvidence === 'provided-unverified') return 3;
  if (report.findings?.some(f => f.code === 'INPUT_EVIDENCE_REQUIRED')) return 3;
  return report.errorCount || (config['--fail-on-warning'] && report.warningCount) ? 1 : 0;
}
main().then(code => { process.exitCode = code; }, error => {
  process.stderr.write(`CellGuard error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
