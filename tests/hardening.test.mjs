import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJSON } from '../site/assets/lib/strict-json.mjs';
import { parseTransaction } from '../site/assets/lib/ckb.mjs';
import { parsePolicy, DEFAULT_POLICY, V2_POLICY } from '../site/assets/lib/policy.mjs';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { compareTransactions } from '../site/assets/lib/diff.mjs';
import { SAFE_TRANSACTION, DEMO_POLICY, TYPE_TRANSACTION } from '../site/assets/lib/fixtures.mjs';
const clone = structuredClone;
const codes = report => report.findings.map(f => f.code);
const strict = { ...V2_POLICY, ...DEMO_POLICY, version: 2, strictTransactionShape: true };
const baseTx = () => clone(SAFE_TRANSACTION);
const lock = clone(SAFE_TRANSACTION.outputs[0].lock);

for (const source of [
  '{"a":1,"a":2}', '{"a":{"x":1,"x":2}}', '{"arr":[{"k":1,"k":2}]}',
  '{"ab":1,"a\\u0062":2}', '{"nested":{},"nested":1}'
]) test(`strict JSON rejects duplicate keys: ${source.slice(0,35)}`, () => {
  assert.throws(() => parseStrictJSON(source), /duplicate key/);
});
test('strict JSON normal round-trip and escape handling', () => {
  assert.deepEqual(parseStrictJSON('{"ok":[true,null,1.23e+3,"\\u2764"]}'), { ok: [true, null, 1230, '❤'] });
  assert.throws(() => parseStrictJSON('{"a":1,}'), /object key/);
  assert.throws(() => parseStrictJSON('{"a":01}'), /JSON|expected/);
  assert.throws(() => parseStrictJSON('{"a":"\\q"}'), /escape/);
});
test('strict JSON bounded depth and bytes', () => {
  assert.throws(() => parseStrictJSON('['.repeat(66) + '0' + ']'.repeat(66)), /nesting/);
  assert.throws(() => parseStrictJSON('"🌴🌴"', 'Input', { maxBytes: 8 }), /byte limit/);
});
test('legacy v1 policy remains parseable and v2 accepts specific defaults', () => {
  assert.equal(parsePolicy(DEFAULT_POLICY).version, 1);
  assert.equal(parsePolicy(V2_POLICY).version, 2);
  assert.throws(() => parsePolicy({ ...V2_POLICY, maxOutputs: 0, minOutputs: 1 }), /minOutputs/);
});
test('strict v2 rejects missing and unknown transaction fields', () => {
  const tx = baseTx();
  tx.suspicious = true;
  assert.throws(() => analyzeTransaction(tx, strict), /unsupported field/);
  delete tx.suspicious;
  delete tx.witnesses;
  assert.throws(() => analyzeTransaction(tx, strict), /witnesses.*required/);
});
test('v1 issues visible warning rather than silently ignoring unknown fields', () => {
  const tx = baseTx();
  tx.outputs[0].extraUnchecked = 'value';
  tx.outputs[0].lock.unexpected = 'x';
  const report = analyzeTransaction(tx, DEMO_POLICY);
  assert.ok(codes(report).includes('TRANSACTION_UNCHECKED_FIELDS'));
  assert.equal(report.result, 'review-needed');
});
test('v2 strict validates transaction input and rejects duplicate OutPoints', () => {
  const tx = baseTx();
  const input = { since:'0x0', previous_output:{ tx_hash:'0x'+'ab'.repeat(32), index:'0x0' }};
  tx.inputs = [input, structuredClone(input)];
  assert.throws(() => analyzeTransaction(tx, strict), /duplicate previous_output/);
  tx.inputs = [input];
  assert.equal(analyzeTransaction(tx, strict).errorCount, 0);
  tx.inputs[0].since = 'no';
  assert.throws(() => analyzeTransaction(tx, strict), /since/);
});
test('v2 strict rejects extra script/output properties', () => {
  const tx = baseTx();
  tx.outputs[1].lock.other = 1;
  assert.throws(() => analyzeTransaction(tx, strict), /unsupported field/);
  delete tx.outputs[1].lock.other;
  tx.outputs[0].extra = 'oops';
  assert.throws(() => analyzeTransaction(tx, strict), /unsupported field/);
});
test('requireTypeScript rejects absent type script and maxTypeScriptOutputs limits present', () => {
  assert.ok(codes(analyzeTransaction(SAFE_TRANSACTION, { ...strict, requireTypeScript: true })).includes('POLICY_TYPE_REQUIRED'));
  const p = { ...strict, maxTypeScriptOutputs: 0 };
  assert.ok(codes(analyzeTransaction(TYPE_TRANSACTION, p)).includes('POLICY_MAX_TYPE_SCRIPTS'));
  assert.throws(() => parsePolicy({ ...strict, denyTypeScripts: true, requireTypeScript: true }), /conflicts/);
});
test('required recipient rules enforce exact lock, amount range, count', () => {
  const policy = { ...strict, requiredOutputs: [{ lock, minCapacityCKB:'61', maxCapacityCKB:'100', minCount:2, maxCount:2 }] };
  assert.equal(analyzeTransaction(SAFE_TRANSACTION, policy).errorCount, 0);
  const modified = baseTx();
  modified.outputs[1].lock.args = '0x' + 'ff'.repeat(20);
  assert.ok(codes(analyzeTransaction(modified, policy)).includes('POLICY_REQUIRED_OUTPUT_COUNT'));
  const wrongAmount = baseTx();
  wrongAmount.outputs[1].capacity = '0x' + (101n*100_000_000n).toString(16);
  assert.ok(codes(analyzeTransaction(wrongAmount, policy)).includes('POLICY_REQUIRED_OUTPUT_CAPACITY'));
});
test('required recipient count with explicit type:null rejects typed cell', () => {
  const p = { ...strict, requiredOutputs:[{ lock, type: null, minCount:1, maxCount:2 }] };
  const tx = baseTx();
  tx.outputs[0].type = clone(TYPE_TRANSACTION.outputs[0].type);
  tx.outputs[0].capacity = '0x' + (120n*100_000_000n).toString(16);
  assert.equal(analyzeTransaction(tx, p).errorCount, 0); // output 1 is still allowed and matches
  const p2 = { ...strict, requiredOutputs:[{ lock, type: null, minCount:2, maxCount:2 }] };
  assert.ok(codes(analyzeTransaction(tx,p2)).includes('POLICY_REQUIRED_OUTPUT_COUNT'));
});
test('v2 policy limits free capacity and data', () => {
  assert.ok(codes(analyzeTransaction(SAFE_TRANSACTION, { ...strict, maxTotalFreeCapacityCKB: '0' })).includes('POLICY_TOTAL_FREE_CAPACITY'));
  assert.ok(codes(analyzeTransaction(TYPE_TRANSACTION, { ...strict, requireOutputDataEmpty: true })).includes('POLICY_OUTPUT_DATA_FORBIDDEN'));
  assert.ok(codes(analyzeTransaction(SAFE_TRANSACTION, { ...strict, minOutputs:3 })).includes('POLICY_MIN_OUTPUTS'));
});
test('reject invalid v2 fields and conflicting constraints', () => {
  for (const p of [
    { ...strict, requiredOutputs: [{lock, minCount:3,maxCount:2}] },
    { ...strict, requiredOutputs: [{lock, minCapacityCKB:'5',maxCapacityCKB:'4'}] },
    { ...strict, maxOutputs: 1, minOutputs: 2 },
    { ...strict, requireAllowedLock:true, allowedLockScripts:[],allowedLockCodeHashes:[] },
    { ...strict, requiredOutputs: [{lock, extraneous:true}] },
  ]) assert.throws(() => parsePolicy(p));
});
test('indexed transaction diff detects same-size output data changes', () => {
  const changed = baseTx();
  changed.outputs_data[1] = '0xbbcc';
  const r = compareTransactions(SAFE_TRANSACTION, changed);
  assert.ok(r.changes.some(c => c.path === 'outputs[1].data'));
  assert.equal(r.changes.some(c => c.path === 'outputs[1].dataBytes'), false);
  assert.equal(compareTransactions(SAFE_TRANSACTION, SAFE_TRANSACTION).changeCount, 0);
});
test('CLI returns stable exit codes and strict parsing', () => {
  const directory = mkdtempSync(join(tmpdir(),'cellguard-test-'));
  const cli = fileURLToPath(new URL('../cli/cellguard.mjs', import.meta.url));
  try {
    const tx = join(directory, 'tx.json'), policy = join(directory, 'policy.json');
    writeFileSync(tx, JSON.stringify(SAFE_TRANSACTION));
    writeFileSync(policy, JSON.stringify(strict));
    const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding:'utf8' });
    const passing = run('--transaction', tx, '--policy', policy, '--format', 'json');
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(JSON.parse(passing.stdout).result, 'checks-passed');
    writeFileSync(policy, JSON.stringify({...strict, maxOutputs:1}));
    assert.equal(run('--transaction', tx, '--policy', policy).status, 1);
    writeFileSync(policy, '{"version":1,"version":2}');
    assert.equal(run('--transaction', tx, '--policy', policy).status, 2);
    assert.equal(run('--transaction', tx, '--compare', tx).status, 0);
    assert.equal(run('--transaction', tx).status, 2);
  } finally { rmSync(directory, { recursive:true, force:true }); }
});
