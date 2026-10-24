#!/usr/bin/env node
/** Validate an explicitly requested public RPC historical audit, never claim independent finality. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseStrictJSON } from '../site/assets/lib/strict-json.mjs';
const hash = process.env.AUDIT_TX_HASH?.toLowerCase();
const policyPath = process.env.AUDIT_PROFILE_PATH;
const expected = process.env.AUDIT_EXPECTED_STATUS;
const network = process.env.AUDIT_NETWORK;
const exitCode = Number(process.env.AUDIT_CLI_EXIT_CODE);
const requiredCodes = (process.env.AUDIT_REQUIRED_CODES ?? '').split(',').map(x=>x.trim()).filter(Boolean);
const minConfirmations = process.env.AUDIT_MIN_CONFIRMATIONS ?? '1';
if (!/^(0|[1-9][0-9]{0,8})$/.test(minConfirmations) ||
    requiredCodes.length > 32 || requiredCodes.some(x=> !/^[A-Z][A-Z0-9_]{1,79}$/.test(x)) ||
    new Set(requiredCodes).size !== requiredCodes.length) {
  throw Error('Invalid audit required codes or minimum confirmations');
}

const digest = data => createHash('sha256').update(data).digest('hex');
if(!/^0x[0-9a-f]{64}$/.test(hash ?? '') || !['testnet','mainnet'].includes(network) ||
  !['pass','policy-failed'].includes(expected) || !policyPath || ![0,1,2,3].includes(exitCode)) {
  throw Error('Missing or malformed audit configuration');
}
const rawPolicy = await readFile(policyPath,'utf8');
const profile=parseStrictJSON(rawPolicy, 'Real deployment profile');
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
const audit=parseStrictJSON(rawEvidence, 'RPC evidence report');
const observedCodes = Array.isArray(audit.findings)
  ? [...new Set(audit.findings.filter(x=>x?.severity==='error' && typeof x.code==='string').map(x=>x.code))].sort() : [];
const hasExpectedCodes=requiredCodes.every(code=>observedCodes.includes(code));
// A generic policy failure is not sufficient evidence of the specific bug being tested.
// The workflow already exposes required_codes, so no YAML change is needed.
const codesConfigured=expected==='policy-failed' ? requiredCodes.length>0 : requiredCodes.length===0;
const confirmed=typeof audit.confirmations==='string' && /^\d{1,32}$/.test(audit.confirmations) &&
  BigInt(audit.confirmations)>=BigInt(minConfirmations);
const accounted=!!audit.accounting && audit.accounting.provenance==='role-level-accounting-not-coin-tracing' &&
  Array.isArray(audit.accounting.inputs) && audit.accounting.inputs.length>0 &&
  Array.isArray(audit.accounting.outputs) && audit.accounting.outputs.length>0 &&
  Array.isArray(audit.accounting.roles);
const valid=audit.mode==='committed-audit' && audit.network===network && audit.hash===hash &&
  audit.chain===(network==='testnet'?'ckb_testnet':'ckb') &&
  /^0x[0-9a-f]{64}$/.test(audit.blockHash??'') &&
  typeof audit.blockNumber==='string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(audit.blockNumber) &&
  ['verified-by-node','unavailable'].includes(audit.proof?.status) &&
  (audit.checks?.policy===(expected==='pass'?'pass':'fail')) &&
  codesConfigured && Array.isArray(audit.findings) &&
  audit.status===expected && audit.chainStatus==='committed' && audit.independentProof===false &&
  audit.capacityFlow?.inputEvidence==='rpc-historical' && accounted && confirmed && hasExpectedCodes &&
  (audit.checks?.historicalInputs==='resolved-from-canonical-parent-transactions') &&
  (expected==='pass'?exitCode===0:exitCode===1) &&
  (expected==='pass'?!audit.findings.some(f=>f.severity==='error'):audit.findings.some(f=>f.severity==='error'));
const manifest={kind:'rpc-committed-transaction-policy-audit',evidenceLevel:'configured-rpc-observation',
  realTestnetEvidence:network==='testnet' && valid,
  independentProof:false,txHash:hash,network,expectedStatus:expected,observedStatus:audit.status,
  cliExitCode:exitCode,passed:valid,profilePath:policyPath,requiredCodes,observedErrorCodes:observedCodes,
  minConfirmations,observedConfirmations:audit.confirmations??null,accountingIncluded:accounted,
  exactNegativeCodesRequired:codesConfigured,
  reportedBlockHash:audit.blockHash??null,reportedBlockNumber:audit.blockNumber??null,
  reportedProofStatus:audit.proof?.status??null,
  profileSha256:digest(rawPolicy),rpcReportSha256:digest(rawEvidence),
  gitCommit:process.env.GITHUB_SHA||null,generatedAt:new Date().toISOString(),
  limitations:'Configured RPC attestations; no independent SPV proof, historical VM replay, broadcast, or finality guarantee.'};
await writeFile('evidence/real-chain-manifest.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
console.log(`RPC historical ${network} audit ${expected}: ${valid?'MATCH':'REJECT'}; commitment ${manifest.gitCommit??'local'}; report sha256 ${manifest.rpcReportSha256}`);
if(!valid)process.exitCode=1;
