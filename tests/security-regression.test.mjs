import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { parsePolicy, DEFAULT_POLICY } from '../site/assets/lib/policy.mjs';
import { SAFE_TRANSACTION, TYPE_TRANSACTION, DEMO_POLICY } from '../site/assets/lib/fixtures.mjs';

const clone = value => structuredClone(value);
const codes = report => report.findings.map(item => item.code);

test('policy schema fails closed on misspelled keys', () => {
  assert.throws(() => parsePolicy({ ...DEFAULT_POLICY, maxOutputz: 1 }), /unknown field: maxOutputz/);
  assert.throws(() => parsePolicy(JSON.parse(JSON.stringify(DEFAULT_POLICY).replace('"maxOutputs"', '"maxOutputz"'))), /thiếu trường maxOutputs/);
});
test('backward compatible v1 policies may omit new exact-script fields', () => {
  const policy = clone(DEFAULT_POLICY);
  delete policy.allowedLockScripts;
  delete policy.allowedTypeScripts;
  assert.deepEqual(parsePolicy(policy).allowedLockScripts, []);
});
test('same code hash with different lock hash_type is blocked by exact allowlist', () => {
  const tx = clone(SAFE_TRANSACTION);
  tx.outputs[0].lock.hash_type = 'data2';
  assert.ok(codes(analyzeTransaction(tx, DEMO_POLICY)).includes('POLICY_LOCK_SCRIPT_NOT_ALLOWED'));
});
test('same code hash with different lock args is blocked by exact allowlist', () => {
  const tx = clone(SAFE_TRANSACTION);
  tx.outputs[1].lock.args = '0x' + '99'.repeat(20);
  assert.ok(codes(analyzeTransaction(tx, DEMO_POLICY)).includes('POLICY_LOCK_SCRIPT_NOT_ALLOWED'));
});
test('full type-script allowlist enforces args and hash type', () => {
  const full = TYPE_TRANSACTION.outputs[0].type;
  const policy = { ...DEMO_POLICY, allowedTypeScripts: [full] };
  assert.equal(analyzeTransaction(TYPE_TRANSACTION, policy).errorCount, 0);
  const tx = clone(TYPE_TRANSACTION);
  tx.outputs[0].type.hash_type = 'data';
  assert.ok(codes(analyzeTransaction(tx, policy)).includes('POLICY_TYPE_SCRIPT_NOT_ALLOWED'));
});
test('exact-script matching is case-insensitive for hash and args hex', () => {
  const upper = clone(DEMO_POLICY);
  upper.allowedLockScripts[0].code_hash = upper.allowedLockScripts[0].code_hash.toUpperCase().replace('0X','0x');
  upper.allowedLockScripts[0].args = upper.allowedLockScripts[0].args.toUpperCase().replace('0X','0x');
  assert.equal(analyzeTransaction(SAFE_TRANSACTION, upper).errorCount, 0);
});
test('strict allowlist entries reject implicit args wildcards and unknown keys', () => {
  const base = { ...DEFAULT_POLICY };
  assert.throws(() => parsePolicy({ ...base, allowedLockScripts: [{ code_hash: '0x' + '11'.repeat(32), hash_type: 'type' }] }), /args/);
  assert.throws(() => parsePolicy({ ...base, allowedLockScripts: [{ code_hash: '0x' + '11'.repeat(32), hash_type: 'type', args: '0x', wildcard: true }] }), /unknown field/);
});
test('report preserves explicitly unverified execution and chain evidence', () => {
  const report = analyzeTransaction(SAFE_TRANSACTION, DEMO_POLICY);
  assert.equal(report.verification.onChain, 'not-verified');
  assert.equal(report.verification.cycleCounts, 'not-available');
  assert.equal(report.verification.scriptExecution, 'not-verified');
  assert.ok(report.outputs[0].lockHashType);
  assert.ok(report.outputs[0].lockArgs);
  assert.equal(typeof report.checks.capacity, 'boolean');
});
