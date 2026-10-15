#!/usr/bin/env node
/** Strict, deterministic CrowdCell-inspired scenarios. These are NEVER on-chain evidence. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
const load = async name => JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const shannons = ckb => BigInt(ckb) * 100000000n;
const hex = value => `0x${value.toString(16)}`;
const codes = report => report.findings.filter(x => x.severity === 'error').map(x => x.code).sort();
const scenario = (name, profile, tx, cells, expected, options={}) => ({ name, profile, tx, cells, expected, ...options });
const base = {
  finalize: {
    profile:await load('profiles/finalize.example.json'),
    tx:await load('crowdcell-synthetic/finalize-valid.json'),
    cells:await load('crowdcell-synthetic/finalize-inputs.unverified.json')
  },
  preserve: {
    profile:await load('profiles/crowdcell-preserve.example.json'),
    tx:await load('crowdcell-synthetic/preserve-valid.json'),
    cells:await load('crowdcell-synthetic/preserve-inputs.unverified.json')
  },
  refund: {
    profile:await load('profiles/refund.example.json'),
    tx:await load('crowdcell-synthetic/refund-valid.json'),
    cells:await load('crowdcell-synthetic/refund-inputs.unverified.json')
  }
};
const cases=[];
function add(name, kind, expected, mutate = ()=>{}, opts={}) {
  const payload=structuredClone(base[kind]);
  mutate(payload);
  cases.push(scenario(name,payload.profile,payload.tx,payload.cells,expected,opts));
}
add('finalize-valid','finalize',[]);
add('finalize-474-ckb-diversion','finalize',['CAPACITY_LEAK_DETECTED','POLICY_UNAUTHORIZED_NET_GAIN'],
  x => { x.tx.outputs[0].capacity=hex(BigInt(x.tx.outputs[0].capacity)-shannons(474));x.tx.outputs[1].capacity=hex(BigInt(x.tx.outputs[1].capacity)+shannons(474)); });
add('finalize-missing-dependency','finalize',['POLICY_REQUIRED_CELL_DEP'],x => {x.tx.cell_deps=[];});
add('finalize-wrong-dependency-type','finalize',['POLICY_REQUIRED_CELL_DEP'],x => {x.tx.cell_deps[0].dep_type='dep_group';});
add('finalize-unauthorized-recipient-role','finalize',['CAPACITY_LEAK_DETECTED','POLICY_OUTPUT_ROLE_FORBIDDEN','POLICY_ROLE_OUTPUT_COUNT'],x => {
  // Preserve the fee and finalizer balance: the missing beneficiary is the important violation.
  x.tx.outputs[0].lock.args='0x'+'f1'.repeat(20);
});
add('finalize-campaign-input-missing','finalize',['POLICY_ROLE_INPUT_COUNT','POLICY_SOURCE_CAPACITY_MISSING'],x => {
  x.cells[0].lock=x.cells[1].lock;
});
add('finalizer-self-funded-change-allowed','finalize',[],x => {
  x.cells[1].capacity=hex(shannons(1000));x.tx.outputs[1].capacity=hex(shannons(1000));
});
// Rick's clarified contract rule: campaign type-group output must retain the FULL
// campaign input capacity. Unlike the legacy beneficiary-transfer example, the fee
// is funded by the finalizer. These remain synthetic, not recovered April transactions.
add('typed-campaign-preservation-valid','preserve',[]);
add('typed-campaign-474-ckb-diversion','preserve',
  ['PROTECTED_CELL_CAPACITY_SHRINK','POLICY_UNAUTHORIZED_NET_GAIN'],x => {
    x.tx=structuredClone(base.preserve.tx);
    x.tx.outputs[0].capacity=hex(shannons(126));
    x.tx.outputs[1].capacity=hex(shannons(474));
    x.tx.outputs.push({...structuredClone(x.tx.outputs[1]),capacity:hex(shannons(100)-shannons(1)/10n)});
    x.tx.outputs_data.push('0x');
  });
add('typed-campaign-capacity-charged-as-fee','preserve',['PROTECTED_CELL_CAPACITY_SHRINK'],x => {
  x.tx.outputs[0].capacity=hex(shannons(600)-1n);
  x.tx.outputs[1].capacity=hex(shannons(100));
});
add('typed-campaign-unrelated-output-same-lock','preserve',['POLICY_ROLE_OUTPUT_COUNT','PROTECTED_CELL_CAPACITY_SHRINK'],x => {
  x.tx.outputs[0].capacity=hex(shannons(400));
  x.tx.outputs.push({capacity:hex(shannons(200)),lock:structuredClone(x.tx.outputs[0].lock),type:null});
  x.tx.outputs_data.push('0x');
});
add('typed-campaign-missing-successor-type','preserve',['PROTECTED_CELL_COUNT_MISMATCH'],x => {
  x.tx.outputs[0].type=null;
});
add('typed-campaign-duplicate-successor-type','preserve',['POLICY_ROLE_OUTPUT_COUNT','PROTECTED_CELL_COUNT_MISMATCH'],x => {
  x.tx.outputs[0].capacity=hex(shannons(300));
  x.tx.outputs.push(structuredClone(x.tx.outputs[0]));
  x.tx.outputs_data.push('0x');
});
add('typed-campaign-missing-input-type-evidence','preserve',['INPUT_TYPE_EVIDENCE_REQUIRED'],x => {
  delete x.cells[0].type;
});
add('typed-campaign-finalizer-owns-larger-change','preserve',[],x => {
  x.cells[1].capacity=hex(shannons(1000));
  x.tx.outputs[1].capacity=hex(shannons(1000)-shannons(1)/10n);
});
add('refund-valid','refund',[]);
add('refund-missing-dependency','refund',['POLICY_REQUIRED_CELL_DEP'],x => {x.tx.cell_deps=[];});
add('refund-since-too-early','refund',['POLICY_SINCE_MISMATCH'],x => {x.tx.inputs[0].since='0x2000000000000008';});
add('refund-contributor-missing','refund',['CAPACITY_LEAK_DETECTED','POLICY_OUTPUT_ROLE_FORBIDDEN','POLICY_ROLE_OUTPUT_COUNT'],x => {
  x.tx.outputs[0].lock.args='0x'+'e1'.repeat(20);
});
add('finalize-missing-input-evidence','finalize',['INPUT_EVIDENCE_REQUIRED'],x => {x.cells=undefined;},{evidence:'missing'});
const results=[];
for (const test of cases) {
  let observed=[];let thrown=null;let report=null;
  try {
    report=analyzeTransaction(test.tx,test.profile,test.cells === undefined ? {} : {
      resolvedInputs:test.cells,inputEvidence:'provided-unverified'
    });
    observed=codes(report);
  } catch (error) { thrown=error instanceof Error ? error.message : String(error); }
  const expected=[...test.expected].sort();
  const passed=!thrown && JSON.stringify(observed)===JSON.stringify(expected) &&
    (test.cells===undefined ? report.capacityFlow?.inputEvidence==='missing' :
      report.capacityFlow?.inputEvidence==='provided-unverified');
  results.push({scenario:test.name,passed,expectedErrors:expected,observedErrors:observed,
    inputEvidence:test.cells===undefined?'missing':'provided-unverified',error:thrown});
}
// The large-pledge check evaluates the opt-in heuristic separately from business-policy math.
const large=structuredClone(base.finalize.tx);
large.outputs[0].capacity=hex(shannons(200000));
const generic=analyzeTransaction(large,{version:3});
const unexpected=codes(generic);
const largePassed=unexpected.length===0 && !generic.findings.some(f=>f.code==='POLICY_EXCESS_CAPACITY'||f.code==='POLICY_TOTAL_CAPACITY');
results.push({scenario:'large-capacity-not-implicitly-forbidden',passed:largePassed,expectedErrors:[],observedErrors:unexpected,inputEvidence:'not-required',error:null});
const sourceDigest=createHash('sha256').update(JSON.stringify(base)).digest('hex');
const summary={schemaVersion:2,kind:'synthetic-fixture-regression',realTestnetEvidence:false,
  evidenceSource:'local illustrative CrowdCell-shaped fixtures (unverified)',
  sourceSha256:sourceDigest,createdAt:new Date().toISOString(),
  scenariosPassed:results.filter(r=>r.passed).length,scenariosTotal:results.length,
  passed:results.every(r=>r.passed),scenarios:results};
await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});
await writeFile(new URL('../evidence/ci-policy-report.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
for(const r of results)console.log(`${r.passed?'PASS':'FAIL'} ${r.scenario}: ${r.observedErrors.join(', ')||'no policy errors'}${r.error?` (${r.error})`:''}`);
console.log(`Synthetic only: ${summary.scenariosPassed}/${summary.scenariosTotal} exact expected-result assertions; NO CrowdCell Testnet RPC used.`);
if(!summary.passed)process.exitCode=1;
