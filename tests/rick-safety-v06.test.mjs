import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { parsePolicy } from '../site/assets/lib/policy.mjs';
import { auditCommittedTransactionOnline, verifyTransactionOnline } from '../server/verification.mjs';

const load = name => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
const finalized = load('crowdcell-synthetic/finalize-valid.json');
const finalizeInputs = load('crowdcell-synthetic/finalize-inputs.unverified.json');
const finalizeProfile = load('profiles/finalize.example.json');
const codes = report => report.findings.filter(x => x.severity === 'error').map(x => x.code);
const check = (tx, policy=finalizeProfile, cells=finalizeInputs) => analyzeTransaction(tx, policy, {
  resolvedInputs: cells, inputEvidence: 'provided-unverified'
});
const blockHash = '0x' + 'a'.repeat(64);
const txHash = '0x' + 'd'.repeat(64);
const testTip = { hash: blockHash, number: '0x100' };
function historyRpc() {
  let targetLooksCommitted = true;
  let canonical = blockHash;
  let parentQueries = 0;
  const rpc = async (method, params=[]) => {
    switch(method) {
      case 'get_blockchain_info': return { chain:'ckb_testnet', is_initial_block_download:false };
      case 'get_tip_header': return testTip;
      case 'get_header': return { number:'0x80' };
      case 'get_block_hash': return canonical;
      case 'get_transaction_proof': return { block_hash:blockHash };
      case 'verify_transaction_proof': return [txHash];
      case 'get_transaction': {
        if (params[0] === txHash) return { tx_status: { status:targetLooksCommitted?'committed':'pending', block_hash:blockHash }, transaction:{ hash:txHash, ...finalized }};
        const input = finalizeInputs.find(x => x.outPoint.tx_hash.toLowerCase() === params[0].toLowerCase());
        if (!input) return null;
        parentQueries++;
        if (parentQueries === 1) canonical='0x'+'f'.repeat(64);
        return { tx_status:{status:'committed',block_hash:blockHash}, transaction:{outputs:[{capacity:input.capacity,lock:input.lock,type:null}]}};
      }
      default: throw new Error(`unhandled RPC ${method}`);
    }
  };
  return { rpc, mutateTarget: () => {targetLooksCommitted=false;}, resetCanonical: () => {canonical=blockHash;} };
}

test('role requirements validate names, ranges and reject duplicate definitions', () => {
  for (const property of ['notARealField','__proto__']) {
    const policy=structuredClone(finalizeProfile);
    Object.defineProperty(policy.roleRequirements[0],property,{value:1,enumerable:true,configurable:true});
    assert.throws(() => parsePolicy(policy), /unknown field/);
  }
  const duplicate=structuredClone(finalizeProfile);duplicate.roleRequirements.push({role:'campaign'});
  assert.throws(()=>parsePolicy(duplicate),/duplicate role/);
  const max=structuredClone(finalizeProfile); max.roleRequirements[0].minInputCount=3;max.roleRequirements[0].maxInputCount=2;
  assert.throws(()=>parsePolicy(max),/minimum count exceeds maximum/);
  const negative=structuredClone(finalizeProfile);negative.roleRequirements[0].minInputCapacityCKB='-1';
  assert.throws(()=>parsePolicy(negative),/expected nonnegative decimal/);
  const notInRoles=structuredClone(finalizeProfile);notInRoles.roleRequirements=[{role:'attacker'}];
  assert.throws(()=>parsePolicy(notInRoles),/undefined role/);
});

test('required campaign input fails even when a distinct input role remains fully funded', () => {
  const manipulated=structuredClone(finalizeInputs);
  manipulated[0].lock=manipulated[1].lock;
  assert.ok(codes(check(finalized,finalizeProfile,manipulated)).includes('POLICY_ROLE_INPUT_COUNT'));
});

test('beneficiary must be present even if the finalize transaction has other outputs', () => {
  const changed=structuredClone(finalized);
  changed.outputs[0].lock = changed.outputs[1].lock;
  const result=check(changed);
  assert.ok(codes(result).includes('POLICY_ROLE_OUTPUT_COUNT'));
  assert.ok(codes(result).includes('CAPACITY_LEAK_DETECTED'));
});

test('role limits distinguish volume, value and ordinary self-funded change', () => {
  const strict=structuredClone(finalizeProfile);
  strict.roleRequirements = [
    {role:'campaign',minInputCount:1,minInputCapacityCKB:'10000'},
    {role:'beneficiary',minOutputCount:1,minOutputCapacityCKB:'9999'},
    {role:'finalizer',maxOutputCount:1,maxOutputCapacityCKB:'100'}
  ];
  assert.equal(check(finalized,strict).errorCount,0);
  const over=structuredClone(finalized);over.outputs[1].capacity='0x'+(101n*100000000n).toString(16);
  assert.ok(codes(check(over,strict)).includes('POLICY_ROLE_OUTPUT_CAPACITY'));
  const another=structuredClone(finalized);another.outputs.push(structuredClone(another.outputs[1]));another.outputs_data.push('0x');
  assert.ok(codes(check(another,strict)).includes('POLICY_ROLE_OUTPUT_COUNT'));
});

test('input requirements never silently pass without trusted input metadata',()=>{
  const report=analyzeTransaction(finalized,finalizeProfile);
  assert.ok(codes(report).includes('INPUT_EVIDENCE_REQUIRED'));
  assert.equal(report.capacityFlow.inputEvidence,'missing');
});

test('historical audit becomes inconclusive when canonical parent evidence changes', async()=>{
  const m=historyRpc();
  const report=await auditCommittedTransactionOnline({network:'testnet',hash:txHash,policy:finalizeProfile},m.rpc);
  assert.equal(report.status,'inconclusive');
  assert.ok(report.findings.some(x=>x.code==='HISTORICAL_INPUT_UNAVAILABLE'));
  assert.equal(report.capacityFlow,undefined);
});

test('historical audit rejects a target that becomes uncommitted during acquisition', async()=>{
  const m=historyRpc(); let reads=0;
  const rpc=async(method,params)=>{
    if(method==='get_transaction' && params[0]===txHash && ++reads===2) m.mutateTarget();
    return m.rpc(method,params);
  };
  const report=await auditCommittedTransactionOnline({network:'testnet',hash:txHash,policy:finalizeProfile},rpc);
  assert.equal(report.status,'inconclusive');
  assert.ok(report.findings.some(x=>x.code==='AUDIT_TARGET_CHANGED'));
});

test('preflight spent inputs explain why historical lookup is a separate operation', async()=>{
  const tx=structuredClone(finalized);
  const rpc=async method=>{
    if(method==='get_blockchain_info') return {chain:'ckb_testnet',is_initial_block_download:false};
    if(method==='get_tip_header') return testTip;
    if(method==='get_live_cell') return {status:'dead'};
    throw Error(`Unexpected RPC ${method}`);
  };
  const report=await verifyTransactionOnline({network:'testnet',transaction:tx,policy:finalizeProfile},rpc);
  assert.equal(report.status,'fail');
  const warning=report.findings.find(f=>f.code==='INPUT_NOT_LIVE');
  assert.match(warning.detail,/already committed transaction use --online/);
  assert.equal(report.checks.finality,'not-verified');
});

test('CLI CI mode requires a profile for historical policy compliance',()=>{
  // A no-profile chain lookup must not silently stand in for a policy audit in CI.
  const source=readFileSync(new URL('../cli/cellguard.mjs',import.meta.url),'utf8');
  assert.match(source,/report\.mode === 'chain-lookup'.*?config\['--ci'\]/);
});


test('historical audit detects a reorg AFTER resolving all parent cells', async()=>{
  const m=historyRpc();
  let blockLookups=0;
  const rpc=async(method,params)=>{
    if(method==='get_block_hash') {
      blockLookups++;
      // target lookup + one cached parent canonicality check + end-of-audit check
      if(blockLookups>=3) return '0x'+'f'.repeat(64);
      return blockHash;
    }
    return m.rpc(method,params);
  };
  const report=await auditCommittedTransactionOnline({network:'testnet',hash:txHash,policy:finalizeProfile},rpc);
  assert.equal(report.status,'inconclusive');
  assert.equal(report.chainStatus,'reorg-risk');
  assert.ok(report.findings.some(x=>x.code==='AUDIT_CHAIN_CHANGED'));
  assert.equal(report.capacityFlow,null);
});

test('chain evidence validator refuses placeholder policies and unaudited chain results', async()=>{
  const {mkdtempSync, mkdirSync,writeFileSync,rmSync} = await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'cellguard-audit-test-'));
  try {
    mkdirSync(join(dir,'evidence'));
    writeFileSync(join(dir,'profile.json'),JSON.stringify(finalizeProfile));
    const payload={mode:'committed-audit',network:'testnet',chain:'ckb_testnet',hash:txHash,status:'pass',chainStatus:'committed',
      blockHash,blockNumber:'0x55',proof:{status:'verified-by-node'},
      independentProof:false,confirmations:'12',accounting:{provenance:'role-level-accounting-not-coin-tracing',inputs:[{index:0}],outputs:[{index:0}],roles:[]},capacityFlow:{inputEvidence:'rpc-historical'},
      checks:{policy:'pass',historicalInputs:'resolved-from-canonical-parent-transactions'},findings:[]};
    writeFileSync(join(dir,'evidence/real-chain-report.json'),JSON.stringify(payload));
    const env={...process.env,AUDIT_TX_HASH:txHash,AUDIT_NETWORK:'testnet',AUDIT_PROFILE_PATH:'profile.json',
      AUDIT_EXPECTED_STATUS:'pass',AUDIT_CLI_EXIT_CODE:'0'};
    const script=new URL('../scripts/validate-testnet-audit.mjs',import.meta.url).pathname;
    const placeholder=spawnSync(process.execPath,[script],{cwd:dir,env,encoding:'utf8'});
    assert.equal(placeholder.status,1);
    assert.match(placeholder.stderr,/placeholder\/example/);
    const clean=structuredClone(finalizeProfile);
    for(const [i,k] of Object.keys(clean.roles).entries()){
      clean.roles[k].code_hash='0x'+'9'.repeat(64);
      clean.roles[k].args='0x'+String(i+2).repeat(40);
    }
    clean.requiredCellDeps[0].out_point.tx_hash='0x'+'8'.repeat(64);
    writeFileSync(join(dir,'profile.json'),JSON.stringify(clean));
    const valid=spawnSync(process.execPath,[script],{cwd:dir,env,encoding:'utf8'});
    assert.equal(valid.status,0,valid.stderr);
    const manifest=JSON.parse(readFileSync(join(dir,'evidence/real-chain-manifest.json'),'utf8'));
    assert.equal(manifest.passed,true);
    assert.equal(manifest.independentProof,false);
    payload.status='inconclusive';
    writeFileSync(join(dir,'evidence/real-chain-report.json'),JSON.stringify(payload));
    const blocked=spawnSync(process.execPath,[script],{cwd:dir,env,encoding:'utf8'});
    assert.equal(blocked.status,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('real-chain evidence validator requires exact detection codes and enough confirmations', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'cellguard-evidence-gate-'));
  try {
    mkdirSync(join(dir,'evidence'));
    const policy=structuredClone(finalizeProfile);
    for(const [i,role] of Object.entries(Object.keys(policy.roles))) {
      policy.roles[role].code_hash='0x'+'9'.repeat(64);
      policy.roles[role].args='0x'+String(i+2).repeat(40);
    }
    policy.requiredCellDeps[0].out_point.tx_hash='0x'+'8'.repeat(64);
    writeFileSync(join(dir,'policy.json'),JSON.stringify(policy));
    const evidence={ mode:'committed-audit',network:'testnet',chain:'ckb_testnet',hash:txHash,
      blockHash,blockNumber:'0x55',proof:{status:'verified-by-node'},
      status:'policy-failed',chainStatus:'committed',confirmations:'9',independentProof:false,
      capacityFlow:{inputEvidence:'rpc-historical'},
      checks:{policy:'fail',historicalInputs:'resolved-from-canonical-parent-transactions'},
      accounting:{provenance:'role-level-accounting-not-coin-tracing',inputs:[{index:0}],outputs:[{index:0}],roles:[]},
      findings:[{severity:'error',code:'CAPACITY_LEAK_DETECTED'}] };
    const write=()=>writeFileSync(join(dir,'evidence/real-chain-report.json'),JSON.stringify(evidence));
    const env={...process.env,AUDIT_TX_HASH:txHash,AUDIT_NETWORK:'testnet',AUDIT_PROFILE_PATH:'policy.json',
      AUDIT_EXPECTED_STATUS:'policy-failed',AUDIT_CLI_EXIT_CODE:'1',
      AUDIT_REQUIRED_CODES:'CAPACITY_LEAK_DETECTED',AUDIT_MIN_CONFIRMATIONS:'6'};
    const script=new URL('../scripts/validate-testnet-audit.mjs',import.meta.url).pathname;
    const run=()=>spawnSync(process.execPath,[script],{cwd:dir,env,encoding:'utf8'});
    write();assert.equal(run().status,0);
    env.AUDIT_REQUIRED_CODES='';assert.equal(run().status,1,'missing exact negative code must fail');
    env.AUDIT_REQUIRED_CODES='CAPACITY_LEAK_DETECTED';
    evidence.proof.status='invalid';write();assert.equal(run().status,1,'invalid proof must fail');
    evidence.proof.status='verified-by-node';
    evidence.chain='ckb';write();assert.equal(run().status,1,'wrong chain identity must fail');
    evidence.chain='ckb_testnet';
    evidence.checks.policy='pass';write();assert.equal(run().status,1,'wrong policy result must fail');
    evidence.checks.policy='fail';write();assert.equal(run().status,0);
    env.AUDIT_REQUIRED_CODES='POLICY_REQUIRED_CELL_DEP';assert.equal(run().status,1);
    env.AUDIT_REQUIRED_CODES='CAPACITY_LEAK_DETECTED';evidence.confirmations='2';write();assert.equal(run().status,1);
    evidence.confirmations='9';evidence.accounting=undefined;write();assert.equal(run().status,1);
    env.AUDIT_REQUIRED_CODES='CAPACITY_LEAK_DETECTED,not_valid';assert.equal(run().status,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
