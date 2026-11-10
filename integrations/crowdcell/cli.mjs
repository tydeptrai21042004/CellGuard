#!/usr/bin/env node
/** Explicit CrowdCell finalize read-only gate, focused on one verified campaign deployment. */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { parseStrictJSON } from '../../site/assets/lib/strict-json.mjs';
import { previewCrowdCellFinalize, preflightCrowdCellFinalize } from './bridge.mjs';
const HELP = `Usage: node integrations/crowdcell/cli.mjs --mode preview|live --tx transaction.json --policy reviewed-policy.json --campaign-type exact-type.json [--input-cells synthetic-inputs.json] [--output report.json]

Preview is ALWAYS unverified and exits 3 if no policy errors (1 if errors).
Live requires a complete already-SIGNED transaction, resolves live CKB Testnet inputs, runs VM and txpool preflight without broadcast; PASS exits 0, FAIL exits 1, INCONCLUSIVE exits 3. Network is hard-pinned to Testnet.
A policy MUST be reviewed with the CrowdCell maintainer against the current contract deployment. Existing examples are not reviewed live profiles.
`;
const options = {};
const allowed = new Set(['--mode','--tx','--policy','--campaign-type','--input-cells','--output']);
for (let i=0; i<process.argv.slice(2).length; i++) {
  const arg = process.argv.slice(2)[i];
  if (arg === '--help') { process.stdout.write(HELP); process.exit(0); }
  if (!allowed.has(arg) || Object.hasOwn(options,arg)) {process.stderr.write(`Invalid/duplicate option: ${arg}\n`);process.exit(2);}
  options[arg] = process.argv.slice(2)[++i];
  if (!options[arg] || options[arg].startsWith('--')) {process.stderr.write(`Missing value for ${arg}\n`);process.exit(2);}
}
async function readJSON(path) {
  if (!path) throw new Error('Missing required JSON file');
  if ((await stat(path)).size > 1024 * 1024) throw new Error('JSON exceeds 1 MiB limit');
  return parseStrictJSON(await readFile(path,'utf8'),path);
}
try {
  if (!['preview','live'].includes(options['--mode'])) throw new Error('Required --mode preview|live');
  if (options['--mode'] === 'live' && options['--input-cells']) throw new Error('Unverified input-cell fixtures cannot be used in live mode');
  const [transaction,policy,expectedCampaignType] = await Promise.all([
    readJSON(options['--tx']),readJSON(options['--policy']),readJSON(options['--campaign-type'])]);
  const result = options['--mode'] === 'live'
    ? await preflightCrowdCellFinalize({transaction,policy,expectedCampaignType,network:'testnet'})
    : previewCrowdCellFinalize({transaction,policy,expectedCampaignType,
      resolvedInputs: options['--input-cells'] ? await readJSON(options['--input-cells']) : undefined});
  const report = JSON.stringify(result, null, 2) + '\n';
  if (options['--output']) await writeFile(options['--output'],report,{mode:0o600});
  process.stdout.write(report);
  process.exitCode = result.allowed ? 0 : result.status === 'POLICY_FAILED' ? 1 : 3;
} catch(error) {
  process.stderr.write(`CrowdCell guard error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
