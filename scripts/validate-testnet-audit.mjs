#!/usr/bin/env node
/** Validate an explicitly requested public RPC historical audit, never claim independent finality. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = process.env.AUDIT_TX_HASH?.toLowerCase();
const policyPath = process.env.AUDIT_PROFILE_PATH;
const expected = process.env.AUDIT_EXPECTED_STATUS;
const network = process.env.AUDIT_NETWORK;
const exitCode = Number(process.env.AUDIT_CLI_EXIT_CODE);
const digest = data => createHash('sha256').update(data).digest('hex');
if(!/^0x[0-9a-f]{64}$/.test(hash ?? '') || !['testnet','mainnet'].includes(network) ||
  !['pass','policy-failed'].includes(expected) || !policyPath || ![0,1,2,3].includes(exitCode)) {
  throw Error('Missing or malformed audit configuration');
}
const rawPolicy = await readFile(policyPath,'utf8');
const profile=JSON.parse(rawPolicy);
if (profile.version !== 3 || !profile.strictTransactionShape ||
    !Array.isArray(profile.capacityFlow) || profile.capacityFlow.length===0 ||
    !Array.isArray(profile.roleRequirements) || profile.roleRequirements.length===0) {
  throw Error('Real historical audit requires strict v3 application flow and role requirements');
}
const placeholder = /0x(?:1{64}|e{64}|a{40}|b{40}|c{40}|d{40})/i;
if (placeholder.test(rawPolicy) || policyPath.includes('.example.')) {
  throw Error('Refusing to label placeholder/example lock identities as real Testnet evidence');
}
let rawEvidence;
try {rawEvidence=await readFile('evidence/real-chain-report.json','utf8');}
catch {throw Error('CLI did not write real-chain-report.json');}
const audit=JSON.parse(rawEvidence);
const valid=audit.mode==='committed-audit' && audit.network===network && audit.hash===hash &&
  audit.status===expected && audit.chainStatus==='committed' && audit.independentProof===false &&
  audit.capacityFlow?.inputEvidence==='rpc-historical' &&
  (audit.checks?.historicalInputs==='resolved-from-canonical-parent-transactions') &&
  (expected==='pass'?exitCode===0:exitCode===1) &&
  (expected==='pass'?!audit.findings.some(f=>f.severity==='error'):audit.findings.some(f=>f.severity==='error'));
const manifest={kind:'rpc-committed-transaction-policy-audit',realTestnetEvidence:network==='testnet',
  independentProof:false,txHash:hash,network,expectedStatus:expected,observedStatus:audit.status,
  cliExitCode:exitCode,passed:valid,profilePath:policyPath,
  profileSha256:digest(rawPolicy),rpcReportSha256:digest(rawEvidence),
  gitCommit:process.env.GITHUB_SHA||null,generatedAt:new Date().toISOString(),
  limitations:'Configured RPC attestations; no independent SPV proof, historical VM replay, broadcast, or finality guarantee.'};
await writeFile('evidence/real-chain-manifest.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
console.log(`RPC historical ${network} audit ${expected}: ${valid?'MATCH':'REJECT'}; commitment ${manifest.gitCommit??'local'}; report sha256 ${manifest.rpcReportSha256}`);
if(!valid)process.exitCode=1;
