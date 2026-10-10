import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { parsePolicy, V3_POLICY } from '../site/assets/lib/policy.mjs';
import { decodeSince } from '../site/assets/lib/invariants.mjs';

const file = path => JSON.parse(readFileSync(new URL(`../examples/${path}`, import.meta.url), 'utf8'));
const policy = file('profiles/finalize.example.json');
const good = file('crowdcell-synthetic/finalize-valid.json');
const leak = file('crowdcell-synthetic/finalize-leak-474.json');
const inputs = file('crowdcell-synthetic/finalize-inputs.unverified.json');
const codes = report => report.findings.map(f => f.code);
const inspect = (tx, p = policy, evidence = inputs, origin = 'provided-unverified') => analyzeTransaction(tx, p,
  evidence ? { resolvedInputs: evidence, inputEvidence: origin } : {});

test('v3 large value is ordinary capacity, not an implicit spending ceiling', () => {
  const tx = structuredClone(good); tx.outputs[0].capacity = '0x' + (200000n * 100000000n).toString(16);
  const p = { ...V3_POLICY, version:3 };
  assert.ok(!codes(analyzeTransaction(tx, p)).includes('POLICY_TOTAL_CAPACITY'));
  assert.ok(!codes(analyzeTransaction(tx, p)).includes('POLICY_EXCESS_CAPACITY'));
});
test('valid finalize preserves source capacity and finalizer own change', () => {
  const r = inspect(good);
  assert.equal(r.errorCount, 0, JSON.stringify(r.findings));
  assert.equal(r.capacityFlow.roles.finalizer.netCKB, '0');
  assert.equal(r.capacityFlow.feeCKB, '0.1');
  assert.equal(r.capacityFlow.inputEvidence, 'provided-unverified');
  assert.ok(codes(r).includes('INPUT_EVIDENCE_UNVERIFIED'));
});
test('reported 474 CKB synthetic leak is caught by TWO independent invariants', () => {
  const r = inspect(leak);
  assert.deepEqual(codes(r).filter(c => ['CAPACITY_LEAK_DETECTED','POLICY_UNAUTHORIZED_NET_GAIN'].includes(c)).sort(),
    ['CAPACITY_LEAK_DETECTED','POLICY_UNAUTHORIZED_NET_GAIN']);
  assert.equal(r.capacityFlow.roles.finalizer.netCKB, '474');
});
test('legitimate change originating in finalizer own input is not flagged as leaked funds', () => {
  const tx = structuredClone(good);
  const own = structuredClone(inputs);
  own[1].capacity = '0x' + (1000n * 100000000n).toString(16);
  tx.outputs[1].capacity = own[1].capacity;
  const r = inspect(tx, policy, own);
  assert.equal(r.errorCount, 0, JSON.stringify(r.findings));
});
test('output to unlisted attacker role fails regardless of capacity sum', () => {
  const tx = structuredClone(good);
  tx.outputs[0].lock = { ...tx.outputs[0].lock, args: '0x' + 'f1'.repeat(20) };
  assert.ok(codes(inspect(tx)).includes('POLICY_OUTPUT_ROLE_FORBIDDEN'));
});
test('required exact cell_dep and dep_type fail closed', () => {
  const missing = structuredClone(good); missing.cell_deps = [];
  assert.ok(codes(inspect(missing)).includes('POLICY_REQUIRED_CELL_DEP'));
  const wrong = structuredClone(good); wrong.cell_deps[0].dep_type = 'dep_group';
  assert.ok(codes(inspect(wrong)).includes('POLICY_REQUIRED_CELL_DEP'));
});
test('required inputs cannot be assumed offline', () => {
  const r = inspect(good, policy, null);
  assert.ok(codes(r).includes('INPUT_EVIDENCE_REQUIRED'));
  assert.equal(r.result,'policy-failed');
});
test('input metadata outpoint mismatch and malformed scripts are rejected', () => {
  const wrong = structuredClone(inputs); wrong[0].outPoint.tx_hash = '0x' + '0'.repeat(64);
  assert.throws(() => inspect(good, policy, wrong), /OutPoint mismatch/);
  const malformed = structuredClone(inputs); malformed[0].lock.hash_type = 'bogus';
  assert.throws(() => inspect(good, policy, malformed), /invalid hash type/);
});
test('invalid or overlapping role scripts and unsafe flow definitions are rejected', () => {
  const p = structuredClone(policy); p.roles.attacker = p.roles.finalizer;
  assert.throws(() => parsePolicy(p), /multiple roles/);
  const invalid = structuredClone(policy); invalid.capacityFlow[0].minRatio = '1.0001';
  assert.throws(() => parsePolicy(invalid), /between 0 and 1/);
  const invalidRole = structuredClone(policy); invalidRole.capacityFlow[1].role = '__proto__';
  assert.throws(() => parsePolicy(invalidRole), /invalid role name/);
});
test('since comparable epochs use rational fractions, reject malformed and flags', () => {
  const v = decodeSince('0x200300010200000a');
  assert.equal(v.metric,1); assert.equal(v.epoch,10n);
  assert.throws(() => decodeSince('0x6000000000000001'), /Invalid CKB since flags/);
  assert.throws(() => decodeSince('0x200000000100000a'), /Invalid CKB since epoch fraction/);
});
test('refund since rule and role flow pass, too-young since fails', () => {
  const p = file('profiles/refund.example.json');
  const tx = file('crowdcell-synthetic/refund-valid.json');
  const ins = file('crowdcell-synthetic/refund-inputs.unverified.json');
  assert.equal(inspect(tx,p,ins).errorCount,0);
  tx.inputs[0].since = '0x2000000000000008';
  assert.ok(codes(inspect(tx,p,ins)).includes('POLICY_SINCE_MISMATCH'));
});
test('CLI uses input evidence only as untrusted fixture and fails closed for CI', () => {
  const cwd = new URL('..', import.meta.url).pathname;
  const args = ['cli/cellguard.mjs','--transaction','examples/crowdcell-synthetic/finalize-valid.json',
    '--profile','examples/profiles/finalize.example.json','--input-cells','examples/crowdcell-synthetic/finalize-inputs.unverified.json',
    '--ci','--format','json'];
  const r = spawnSync(process.execPath, args, {cwd,encoding:'utf8'});
  assert.equal(r.status,3,r.stderr);
  const report = JSON.parse(r.stdout);assert.equal(report.capacityFlow.inputEvidence,'provided-unverified');
  const fail = spawnSync(process.execPath, args.map(a=>a==='examples/crowdcell-synthetic/finalize-valid.json' ? 'examples/crowdcell-synthetic/finalize-leak-474.json':a),{cwd,encoding:'utf8'});
  assert.equal(fail.status,1); // explicit policy violation takes precedence over untrusted evidence
  assert.ok(JSON.parse(fail.stdout).findings.some(x=>x.code==='CAPACITY_LEAK_DETECTED'));
});
