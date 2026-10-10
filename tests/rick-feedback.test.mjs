import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { DEFAULT_POLICY, V2_POLICY } from '../site/assets/lib/policy.mjs';
import { SAFE_TRANSACTION } from '../site/assets/lib/fixtures.mjs';
const H = '0x' + 'c'.repeat(64);
const large = () => { const tx = structuredClone(SAFE_TRANSACTION); tx.outputs[0].capacity = '0x' + (200000n * 100000000n).toString(16); return tx; };
test('legitimate high capacity does not trigger free-capacity heuristic without opt-in', () => {
 const policy = {...DEFAULT_POLICY, maxTotalOutputCapacityCKB:'300000'};
 assert.ok(!analyzeTransaction(large(),policy).findings.some(x=>x.code==='POLICY_EXCESS_CAPACITY'));
});
test('explicit free-capacity limit remains available as an opt-in review rule', () => {
 const policy = {...DEFAULT_POLICY, maxTotalOutputCapacityCKB:'300000',maxFreeCapacityCKBPerOutput:'25'};
 assert.ok(analyzeTransaction(large(),policy).findings.some(x=>x.code==='POLICY_EXCESS_CAPACITY'));
});
test('refund policy requires exact cell dep and type', () => {
 const tx=structuredClone(SAFE_TRANSACTION); delete tx.cell_deps;
 const policy={...V2_POLICY, strictTransactionShape:false,maxTotalOutputCapacityCKB:'300000',requiredCellDeps:[{out_point:{tx_hash:H,index:'0x0'},dep_type:'code'}]};
 assert.ok(analyzeTransaction(tx,policy).findings.some(x=>x.code==='POLICY_CELL_DEPS_UNAVAILABLE'));
 tx.cell_deps=[{out_point:{tx_hash:H,index:'0x0'},dep_type:'dep_group'}];
 assert.ok(analyzeTransaction(tx,policy).findings.some(x=>x.code==='POLICY_REQUIRED_CELL_DEP'));
 tx.cell_deps[0].dep_type='code';
 assert.ok(!analyzeTransaction(tx,policy).findings.some(x=>x.code.startsWith('POLICY_') && x.code.includes('CELL_DEP')));
});
