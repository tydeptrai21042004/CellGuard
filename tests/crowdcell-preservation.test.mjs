import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { parsePolicy } from '../site/assets/lib/policy.mjs';
import { verifyTransactionOnline, auditCommittedTransactionOnline } from '../server/verification.mjs';

const load = path => JSON.parse(readFileSync(new URL(`../examples/${path}`, import.meta.url), 'utf8'));
const policy = load('profiles/crowdcell-preserve.example.json');
const good = load('crowdcell-synthetic/preserve-valid.json');
const leak = load('crowdcell-synthetic/preserve-leak-474.json');
const cells = load('crowdcell-synthetic/preserve-inputs.unverified.json');
const hash = n => '0x' + n.repeat(64);
const asHex = n => `0x${n.toString(16)}`;
const ckb = n => n * 100_000_000n;
const errors = result => result.findings.filter(f => f.severity === 'error').map(f => f.code);
const inspect = (tx, inputs = cells, profile = policy) => analyzeTransaction(tx, profile,
  inputs === null ? {} : { resolvedInputs: inputs, inputEvidence: 'provided-unverified' });

test('legitimate finalization retains the exact typed campaign Cell, and finalizer pays the fee', () => {
  const report = inspect(good);
  assert.deepEqual(errors(report), []);
  assert.equal(report.capacityFlow.roles.campaign.inputCKB, '600');
  assert.equal(report.capacityFlow.roles.campaign.outputCKB, '600');
  assert.equal(report.capacityFlow.roles.finalizer.netCKB, '-0.1');
  assert.equal(report.capacityFlow.feeCKB, '0.1');
});

test('reviewer-described 474 CKB finalizer diversion is rejected regardless of total fee', () => {
  const report = inspect(leak);
  assert.ok(errors(report).includes('PROTECTED_CELL_CAPACITY_SHRINK'));
  assert.ok(errors(report).includes('POLICY_UNAUTHORIZED_NET_GAIN'));
  assert.match(report.findings.find(f=>f.code==='PROTECTED_CELL_CAPACITY_SHRINK').detail, /600 CKB to 126 CKB \(shortfall 474 CKB\)/);
  assert.equal(report.capacityFlow.feeCKB, '0.1');
  assert.equal(leak.outputs[1].capacity, asHex(ckb(474n)));
});

test('capacity siphoned to an outsider is still blocked even without finalizer profit', () => {
  const tx = structuredClone(good);
  tx.outputs[0].capacity = asHex(ckb(126n));
  tx.outputs.push({capacity:asHex(ckb(474n)), lock:{...tx.outputs[1].lock,args:'0x'+'e'.repeat(40)},type:null});
  tx.outputs_data.push('0x');
  const report = inspect(tx);
  assert.ok(errors(report).includes('PROTECTED_CELL_CAPACITY_SHRINK'));
  assert.ok(errors(report).includes('POLICY_OUTPUT_ROLE_FORBIDDEN'));
  assert.ok(!errors(report).includes('POLICY_UNAUTHORIZED_NET_GAIN'));
});

test('campaign-funded fee of just one shannon is forbidden even under maxFee', () => {
  const tx = structuredClone(good);
  tx.outputs[0].capacity = asHex(ckb(600n)-1n);
  tx.outputs[1].capacity = asHex(ckb(100n));
  const report = inspect(tx);
  assert.equal(report.capacityFlow.feeCKB,'0.00000001');
  assert.ok(errors(report).includes('PROTECTED_CELL_CAPACITY_SHRINK'));
  assert.ok(!errors(report).includes('POLICY_FEE_EXCEEDED'));
});

test('an unrelated Cell with the same lock cannot conceal reduced typed-campaign capacity', () => {
  const tx = structuredClone(good);
  tx.outputs[0].capacity = asHex(ckb(400n));
  tx.outputs.push({capacity:asHex(ckb(200n)),lock:structuredClone(tx.outputs[0].lock),type:null});
  tx.outputs_data.push('0x');
  assert.equal(inspect(tx).capacityFlow.roles.campaign.netCKB, '0'); // lock-only accounting would miss the leak
  assert.ok(errors(inspect(tx)).includes('PROTECTED_CELL_CAPACITY_SHRINK'));
});

test('missing successor output cannot pass when the campaign lock is recreated untyped', () => {
  const tx = structuredClone(good); tx.outputs[0].type = null;
  assert.ok(errors(inspect(tx)).includes('PROTECTED_CELL_COUNT_MISMATCH'));
});

test('splitting a campaign Cell into two with the same type is rejected even when total capacity is retained', () => {
  const tx = structuredClone(good);
  tx.outputs[0].capacity = asHex(ckb(300n));
  tx.outputs.push({...structuredClone(tx.outputs[0]),capacity:asHex(ckb(300n))});
  tx.outputs_data.push('0x');
  assert.ok(errors(inspect(tx)).includes('PROTECTED_CELL_COUNT_MISMATCH'));
});

test('wrong campaign type in resolved inputs does not silently match the same campaign lock', () => {
  const tampered = structuredClone(cells);
  tampered[0].type = {...tampered[0].type, args: '0x' + 'f'.repeat(64)};
  assert.ok(errors(inspect(good,tampered)).includes('PROTECTED_CELL_COUNT_MISMATCH'));
});

test('omitting input type evidence fails closed, including a missing type on another input', () => {
  const missing = structuredClone(cells); delete missing[0].type;
  assert.ok(errors(inspect(good,missing)).includes('INPUT_TYPE_EVIDENCE_REQUIRED'));
  const other = structuredClone(cells); delete other[1].type;
  assert.ok(errors(inspect(good,other)).includes('INPUT_TYPE_EVIDENCE_REQUIRED'));
  assert.ok(errors(inspect(good,null)).includes('INPUT_EVIDENCE_REQUIRED'));
});

test('new preservation policy fields strictly validate type identity and disallow unknown fields', () => {
  const invalid = structuredClone(policy);
  invalid.capacityFlow[0].type.code_hash='0xaaaa';
  assert.throws(()=>parsePolicy(invalid), /code_hash/);
  const unknown = structuredClone(policy); unknown.capacityFlow[0].feeAllowanceCKB='0.1';
  assert.throws(()=>parsePolicy(unknown), /unknown field/);
});

function mockRpc(target=good,{omitType=false}={}) {
  const txHash=hash('d'),blockHash=hash('b'), tip={hash:blockHash,number:'0x90'};
  const rpc = async (method,params=[]) => {
    if (method==='get_blockchain_info') return {chain:'ckb_testnet',is_initial_block_download:false};
    if (method==='get_tip_header') return tip;
    if (method==='get_header') return {number:'0x80'};
    if (method==='get_block_hash') return blockHash;
    if (method==='get_transaction_proof') return {block_hash:blockHash};
    if (method==='verify_transaction_proof') return [txHash];
    if (method==='estimate_cycles') return {cycles:'0x1234'};
    if (method==='test_tx_pool_accept') return {cycles:'0x1234',fee:asHex(ckb(1n)/10n)};
    if (method==='get_live_cell') {
      const cell=cells.find(c=>c.outPoint.tx_hash.toLowerCase()===params[0].tx_hash.toLowerCase());
      return cell ? {status:'live',cell:{output:{capacity:cell.capacity,lock:cell.lock,
        ...(!omitType?{type:cell.type}:{})}}} : {status:'unknown',cell:null};
    }
    if (method==='get_transaction') {
      if (params[0]===txHash) return {tx_status:{status:'committed',block_hash:blockHash},transaction:{hash:txHash,...target}};
      const cell=cells.find(c=>c.outPoint.tx_hash.toLowerCase()===params[0].toLowerCase());
      if (cell) return {tx_status:{status:'committed',block_hash:blockHash},transaction:{outputs:[{capacity:cell.capacity,lock:cell.lock,
        ...(!omitType?{type:cell.type}:{})}]}};
      return null;
    }
    throw Error(`Unexpected RPC ${method}`);
  };
  return {rpc,txHash};
}

test('live RPC preserves type-script metadata so it catches the 474 CKB diversion', async () => {
  const goodRpc=mockRpc();
  const passed=await verifyTransactionOnline({network:'testnet',transaction:good,policy},goodRpc.rpc);
  assert.equal(passed.status,'pass',JSON.stringify(passed.findings));
  const bad=await verifyTransactionOnline({network:'testnet',transaction:leak,policy},mockRpc(leak).rpc);
  assert.equal(bad.status,'fail');
  assert.ok(errors(bad).includes('PROTECTED_CELL_CAPACITY_SHRINK'));
  assert.equal(bad.capacityFlow.inputEvidence, 'rpc-live');
});

test('live RPC omitting type metadata fails closed rather than incorrectly passing', async()=>{
  const report=await verifyTransactionOnline({network:'testnet',transaction:good,policy},mockRpc(good,{omitType:true}).rpc);
  assert.equal(report.status,'fail');
  assert.ok(errors(report).includes('INPUT_TYPE_EVIDENCE_REQUIRED'));
});

test('historical committed audit preserves parent type metadata and rejects shrinking campaign Cell',async()=>{
  const goodRpc=mockRpc();
  const passed=await auditCommittedTransactionOnline({network:'testnet',hash:goodRpc.txHash,policy},goodRpc.rpc);
  assert.equal(passed.status,'pass',JSON.stringify(passed.findings));
  const badRpc=mockRpc(leak);
  const result=await auditCommittedTransactionOnline({network:'testnet',hash:badRpc.txHash,policy},badRpc.rpc);
  assert.equal(result.status,'policy-failed');
  assert.ok(errors(result).includes('PROTECTED_CELL_CAPACITY_SHRINK'));
  assert.equal(result.capacityFlow.inputEvidence, 'rpc-historical');
});
