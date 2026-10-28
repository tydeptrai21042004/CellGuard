#!/usr/bin/env node
/** Derive an explicitly transaction-scoped strict-v3 consolidation policy from public Testnet RPC.
 *  Read-only; requires no wallet, testnet CKB, or private key.
 *  The policy is NOT evidence for any CrowdCell deployment or unrelated contract.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRpc } from '../server/rpc.mjs';
import { lookupTransactionOnline, auditCommittedTransactionOnline } from '../server/verification.mjs';
import { parsePolicy } from '../site/assets/lib/policy.mjs';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';

export const PUBLIC_TESTNET_TX = '0x6fb7350b37463df3e31fcfd5558651193fb8ff5dd3c824e0b1afe31892b90448';
export const OUTPUT_POLICY_PATH = 'configs/public-testnet-consolidation-v3.json';
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function check(condition, message) { if (!condition) throw Error(message); }
function exactScript(value) {
  check(value && HASH_RE.test(value.code_hash) && ['type','data','data1','data2'].includes(value.hash_type) &&
    typeof value.args === 'string' && /^0x([0-9a-fA-F]{2})*$/.test(value.args), 'RPC script is malformed');
  return { code_hash: value.code_hash.toLowerCase(), hash_type: value.hash_type, args: value.args.toLowerCase() };
}
function scriptMatches(a, b) { return JSON.stringify(exactScript(a)) === JSON.stringify(exactScript(b)); }
function readTx(record, hash) {
  check(record?.tx_status?.status === 'committed' && HASH_RE.test(record.tx_status.block_hash), `Expected committed transaction ${hash}`);
  const tx = record.transaction?.inner ?? record.transaction;
  check(tx && (!tx.hash || tx.hash.toLowerCase() === hash.toLowerCase()), `Transaction body/hash mismatch for ${hash}`);
  // CKB RPC TransactionView can include a derived `hash` field. CellGuard's
  // strict transaction parser correctly expects the raw transaction *without* it.
  const clean = { ...tx };
  delete clean.hash;
  return clean;
}
function amount(ckb) { return BigInt(ckb); }

export function buildConsolidationPolicy(tx, resolvedInputs) {
  check(Array.isArray(tx.inputs) && tx.inputs.length === 3, 'Target must have exactly 3 ordinary inputs');
  check(Array.isArray(tx.outputs) && tx.outputs.length === 1, 'Target must have exactly 1 output');
  check(Array.isArray(tx.outputs_data) && tx.outputs_data.length === 1 && tx.outputs_data[0] === '0x', 'Target output data must be empty');
  check(tx.outputs[0].type === null || tx.outputs[0].type === undefined, 'Target output must be untyped');
  check(tx.inputs.every(input=>input.since === '0x0'), 'Target must have since=0x0 for every input');
  check(Array.isArray(resolvedInputs) && resolvedInputs.length === tx.inputs.length, 'Missing historical input data');
  const lock = exactScript(tx.outputs[0].lock);
  check(resolvedInputs.every(x=>scriptMatches(x.lock, lock)), 'All historical inputs must share the output lock script');
  check(resolvedInputs.every(x=>x.type === null || x.type === undefined), 'Target inputs must be untyped');
  const inShannons = resolvedInputs.reduce((s,c)=>s + amount(c.capacity),0n);
  const outShannons = amount(tx.outputs[0].capacity);
  const feeShannons = inShannons - outShannons;
  check(feeShannons === 1510n, `Unexpected historical fee ${feeShannons} shannons; expected 1510`);
  check(outShannons === 26899996812n, 'Target output capacity differs from independently observed explorer value');
  const depList = Array.isArray(tx.cell_deps) ? tx.cell_deps.map(x=>({dep_type:x.dep_type,out_point:x.out_point})) : [];
  check(depList.length > 0, 'Target is missing code dependencies');
  const policy = {
    version: 3,
    profile: 'public-testnet-consolidation-v3',
    strictTransactionShape: true,
    minOutputs: 1,
    maxOutputs: 1,
    requireOutputDataEmpty: true,
    maxDataBytesPerOutput: 0,
    maxTotalDataBytes: 0,
    denyTypeScripts: true,
    maxTypeScriptOutputs: 0,
    requireAllowedLock: true,
    allowedLockScripts: [lock],
    allowedLockCodeHashes: [lock.code_hash],
    roles: { consolidator: lock },
    allowedInputRoles: ['consolidator'],
    allowedOutputRoles: ['consolidator'],
    requiredOutputs: [{ lock, type:null, minCapacityCKB:'268',maxCapacityCKB:'269',minCount:1,maxCount:1 }],
    requiredCellDeps: depList,
    roleRequirements: [{role:'consolidator',minInputCount:3,maxInputCount:3,minOutputCount:1,maxOutputCount:1,
      minInputCapacityCKB:'268',maxInputCapacityCKB:'269',minOutputCapacityCKB:'268',maxOutputCapacityCKB:'269'}],
    capacityFlow: [{ id:'consolidator-no-net-gain', kind:'max-net-gain',role:'consolidator',maxGainCKB:'0'}],
    sinceRules: [{id:'consolidation-no-since-lock',role:'consolidator',operator:'exact',value:'0x0',requireMatch:true}],
    maxFeeCKB: '0.00010000'
  };
  parsePolicy(policy);
  const local = analyzeTransaction(tx,policy,{resolvedInputs,inputEvidence:'provided-unverified'});
  check(local.errorCount === 0,`Generated policy violates its source transaction: ${JSON.stringify(local.findings)}`);
  return policy;
}
async function generate() {
  const rpc = createRpc('testnet');
  const info = await lookupTransactionOnline({network:'testnet',hash:PUBLIC_TESTNET_TX},rpc);
  check(info.status === 'committed' && BigInt(info.confirmations ?? '0') >= 6n,
    'Public target transaction is not canonical/confirmed according to this RPC');
  const raw = readTx(await rpc('get_transaction',[PUBLIC_TESTNET_TX]),PUBLIC_TESTNET_TX);
  check(raw.inputs.length === 3 && raw.outputs.length === 1, 'Unexpected transaction shape');
  const resolvedInputs = await Promise.all(raw.inputs.map(async (input,index)=>{
    const point = input.previous_output;
    check(point && HASH_RE.test(point.tx_hash),`Missing input ${index} outpoint`);
    const parent = readTx(await rpc('get_transaction',[point.tx_hash]),point.tx_hash);
    const out = parent.outputs?.[Number(BigInt(point.index))];
    check(out,`Parent output ${index} not found`);
    return {index,outPoint:point,capacity:out.capacity,lock:out.lock,type:out.type??null};
  }));
  const policy = buildConsolidationPolicy(raw,resolvedInputs);
  // Audit with a fresh RPC deadline: the write happens only after the actual
  // historical RPC-backed CellGuard auditor returns a passing result.
  const audit = await auditCommittedTransactionOnline({network:'testnet',hash:PUBLIC_TESTNET_TX,policy},createRpc('testnet'));
  check(audit.status === 'pass' && audit.chainStatus === 'committed' && audit.capacityFlow?.inputEvidence === 'rpc-historical',
    `Real historical audit did not pass: ${JSON.stringify(audit.findings ?? [])}`);
  check(BigInt(audit.confirmations ?? '0') >= 6n, 'Audit confirmed fewer than six blocks');
  const dest = resolve(OUTPUT_POLICY_PATH);
  await mkdir(dirname(dest), {recursive:true});
  await writeFile(dest, JSON.stringify(policy,null,2)+'\n', {flag:'w'});
  console.log(`Created ${OUTPUT_POLICY_PATH}`);
  console.log(`Real public transaction: ${PUBLIC_TESTNET_TX}`);
  console.log(`RPC-reported chain status: ${audit.chainStatus}; confirmations: ${audit.confirmations}`);
  console.log('Git commit the generated JSON file, then dispatch the existing real-testnet-audit.yml.');
  console.log('This is a transaction-specific consolidation demonstration, NOT CrowdCell contract evidence.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generate().catch(error=>{ console.error(`No policy written: ${error instanceof Error?error.message:String(error)}`); process.exitCode=1; });
}
