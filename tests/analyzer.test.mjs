import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { formatCkb, parseCkbDecimal, parseTransaction, parseU64Hex, MAX_U64 } from '../site/assets/lib/ckb.mjs';
import { parsePolicy, DEFAULT_POLICY } from '../site/assets/lib/policy.mjs';
import { SAFE_TRANSACTION, RISK_TRANSACTION, DEMO_POLICY } from '../site/assets/lib/fixtures.mjs';
const clone = value => structuredClone(value);
const codes = report => report.findings.map(f => f.code);

test('safe fixture passes configured offline checks', () => {
  const r = analyzeTransaction(SAFE_TRANSACTION, DEMO_POLICY);
  assert.equal(r.result, 'checks-passed');
  assert.equal(r.errorCount, 0);
  assert.equal(r.warningCount, 0);
  assert.equal(r.outputCount, 2);
  assert.equal(r.outputs[0].occupiedCKB, '61');
  assert.equal(r.outputs[1].occupiedCKB, '63');
});
test('risk fixture detects capacity, data and lock failures', () => {
  const r = analyzeTransaction(RISK_TRANSACTION, DEMO_POLICY);
  assert.equal(r.result, 'policy-failed');
  for (const code of ['CAPACITY_INSUFFICIENT', 'POLICY_DATA_TOO_LARGE', 'POLICY_LOCK_NOT_ALLOWED']) {
    assert.ok(codes(r).includes(code), code);
  }
});
test('61-byte minimum and 53-byte lock arithmetic', () => {
  const r = parseTransaction({outputs:[{capacity:'0x16b969d00',lock:{code_hash:'0x'+'01'.repeat(32),hash_type:'type',args:'0x'+'02'.repeat(20)},type:null}],outputs_data:['0x']});
  assert.equal(r.outputs[0].occupiedBytes, 61);
  assert.equal(r.outputs[0].occupied, 6100000000n);
});
test('optional type script and output data add to occupied capacity', () => {
  const r = parseTransaction({outputs:[{capacity:'0x2540be400',lock:{code_hash:'0x'+'01'.repeat(32),hash_type:'type',args:'0x'+'02'.repeat(20)},type:{code_hash:'0x'+'03'.repeat(32),hash_type:'data2',args:'0x'}}],outputs_data:['0x'+'ff'.repeat(8)]});
  assert.equal(r.outputs[0].occupiedBytes, 102);
});
test('decimal shannon math is exact', () => {
  assert.equal(parseCkbDecimal('123.00000001'), 12300000001n);
  assert.equal(formatCkb(12300000001n), '123.00000001');
  assert.equal(formatCkb(-100000001n), '-1.00000001');
  assert.throws(() => parseCkbDecimal('0.000000001'), /8/);
  assert.throws(() => parseCkbDecimal('1e5'), /CKB/);
  assert.throws(() => parseCkbDecimal('-1'), /CKB/);
});
test('reject capacity bigger than uint64 and malformed hex', () => {
  assert.equal(parseU64Hex('0xffffffffffffffff'), MAX_U64);
  assert.throws(() => parseU64Hex('0x10000000000000000'), /u64/);
  assert.throws(() => parseU64Hex('1234'), /u64/);
  const tx = clone(SAFE_TRANSACTION);
  tx.outputs_data[0] = '0xabc';
  assert.throws(() => parseTransaction(tx), /even number of digits/);
});
test('reject missing outputs data and array length mismatch', () => {
  const tx = clone(SAFE_TRANSACTION);
  tx.outputs_data.pop();
  assert.throws(() => parseTransaction(tx), /equal lengths/);
});
test('reject malformed code hash and unsupported hash type', () => {
  const tx = clone(SAFE_TRANSACTION);
  tx.outputs[0].lock.code_hash = '0x1234';
  assert.throws(() => parseTransaction(tx), /32 byte/);
  tx.outputs[0].lock.code_hash = '0x'+'ab'.repeat(32);
  tx.outputs[0].lock.hash_type = 'unknown';
  assert.throws(() => parseTransaction(tx), /hash_type/);
});
test('max output count enforced even when transaction shape is otherwise valid', () => {
  const tx = clone(SAFE_TRANSACTION);
  assert.ok(codes(analyzeTransaction(tx, {...DEFAULT_POLICY, maxOutputs: 1})).includes('POLICY_MAX_OUTPUTS'));
});
test('max total data and output capacity constraints work', () => {
  const r = analyzeTransaction(SAFE_TRANSACTION, {...DEFAULT_POLICY, maxTotalDataBytes: 1, maxTotalOutputCapacityCKB: '100'});
  assert.ok(codes(r).includes('POLICY_TOTAL_DATA_TOO_LARGE'));
  assert.ok(codes(r).includes('POLICY_TOTAL_CAPACITY'));
});
test('excessive free capacity is a warning, not a consensus error', () => {
  const r = analyzeTransaction(SAFE_TRANSACTION, {...DEFAULT_POLICY, maxFreeCapacityCKBPerOutput: '0'});
  assert.equal(r.result, 'review-needed');
  assert.equal(r.errorCount, 0);
  assert.ok(codes(r).includes('POLICY_EXCESS_CAPACITY'));
});
test('denied type script and type allowlist', () => {
  const tx = clone(SAFE_TRANSACTION);
  tx.outputs[0].type = {code_hash:'0x'+'aa'.repeat(32),hash_type:'data',args:'0x'};
  tx.outputs[0].capacity = '0x' + (200n * 100000000n).toString(16);
  const r = analyzeTransaction(tx, {...DEFAULT_POLICY, denyTypeScripts:true, allowedTypeCodeHashes:['0x'+'bb'.repeat(32)]});
  assert.ok(codes(r).includes('POLICY_TYPE_FORBIDDEN'));
  assert.ok(codes(r).includes('POLICY_TYPE_NOT_ALLOWED'));
});
test('empty allowlist means no restriction', () => {
  const r = analyzeTransaction(SAFE_TRANSACTION, DEFAULT_POLICY);
  assert.equal(r.errorCount, 0);
});
test('policy validates malformed values', () => {
  assert.throws(() => parsePolicy({...DEFAULT_POLICY, maxOutputs: 0.2}), /expected integer/);
  assert.throws(() => parsePolicy({...DEFAULT_POLICY, maxOutputs: -1}), /expected integer/);
  assert.throws(() => parsePolicy({...DEFAULT_POLICY, allowedLockCodeHashes:['oops']}), /code_hash/);
  assert.throws(() => parsePolicy({...DEFAULT_POLICY, denyTypeScripts:'true'}), /boolean/);
  assert.throws(() => parsePolicy({...DEFAULT_POLICY, version:4}), /version must be 1, 2 or 3/);
});
test('analyzer is deterministic and does not mutate inputs', () => {
  const tx = clone(RISK_TRANSACTION);
  const policy = clone(DEMO_POLICY);
  const oldTx = JSON.stringify(tx);
  const oldPolicy = JSON.stringify(policy);
  assert.deepEqual(analyzeTransaction(tx, policy), analyzeTransaction(tx, policy));
  assert.equal(JSON.stringify(tx), oldTx);
  assert.equal(JSON.stringify(policy), oldPolicy);
});
test('report accurately disclaims absent chain verification', () => {
  const result = analyzeTransaction(SAFE_TRANSACTION, DEMO_POLICY);
  assert.match(result.disclaimer, /No script execution/);
  assert.match(result.disclaimer, /not consensus validation/);
});
