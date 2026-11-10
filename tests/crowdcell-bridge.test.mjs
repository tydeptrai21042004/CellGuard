import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toCkbRpcTransaction, validateCrowdCellFinalizePolicy, previewCrowdCellFinalize,
  preflightCrowdCellFinalize, assertCrowdCellFinalizePreflight, CellGuardPolicyError, signGuardAndSendCrowdCellFinalize } from '../integrations/crowdcell/bridge.mjs';
const j = path => JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const policy = j('examples/profiles/crowdcell-preserve.example.json');
const inputs = j('examples/crowdcell-synthetic/preserve-inputs.unverified.json');
const good = j('examples/crowdcell-synthetic/preserve-valid.json');
const leak = j('examples/crowdcell-synthetic/preserve-leak-474.json');
const exact = policy.capacityFlow[0].type;
const hex64 = x => '0x' + x.repeat(64);
function cccLike(raw) {
  const s = x => x && ({codeHash:x.code_hash, hashType:x.hash_type, args:x.args});
  return {
    version:BigInt(raw.version),
    cellDeps:raw.cell_deps.map(x => ({outPoint:{txHash:x.out_point.tx_hash,index:BigInt(x.out_point.index)},depType:x.dep_type})),
    headerDeps:raw.header_deps,
    inputs:raw.inputs.map(x => ({since:BigInt(x.since),previousOutput:{txHash:x.previous_output.tx_hash,index:BigInt(x.previous_output.index)}})),
    outputs:raw.outputs.map(x => ({capacity:BigInt(x.capacity),lock:s(x.lock),type:s(x.type)})),
    outputsData:raw.outputs_data, witnesses:raw.witnesses
  };
}
function mockRpc(target = good,{noPool=false,suppliedInputs=inputs}={}) {
  const txHash=hex64('d'); const blockHash=hex64('b');
  return async (method, params=[]) => {
    if (method==='get_blockchain_info') return {chain:'ckb_testnet',is_initial_block_download:false};
    if (method==='get_tip_header') return {hash:blockHash,number:'0x90'};
    if (method==='get_live_cell') {
      const cell=suppliedInputs.find(c=>c.outPoint.tx_hash.toLowerCase()===params[0].tx_hash.toLowerCase());
      return cell ? {status:'live',cell:{output:{capacity:cell.capacity,lock:cell.lock,type:cell.type}}} : {status:'unknown',cell:null};
    }
    if (method==='estimate_cycles') return {cycles:'0x1234'};
    if (method==='test_tx_pool_accept') {
      if (noPool) {const e=new Error('Unsupported');e.rpcCode=-32601;throw e;}
      const fee=suppliedInputs.reduce((a,c)=>a+BigInt(c.capacity),0n)-target.outputs.reduce((a,c)=>a+BigInt(c.capacity),0n);
      return {cycles:'0x1234',fee:'0x'+fee.toString(16)};
    }
    throw new Error(`Unexpected RPC method ${method}`);
  };
}
test('CCC camelCase, BigInt -> CKB-RPC JSON is lossless for supplied reference tx',()=> {
  assert.deepEqual(toCkbRpcTransaction(cccLike(good)),good);
  assert.deepEqual(toCkbRpcTransaction(good),good);
});
test('campaign identity pin and strict role/count/dependency checks are mandatory',()=> {
  assert.equal(validateCrowdCellFinalizePolicy(policy,{expectedCampaignType:exact}).version,3);
  assert.throws(()=>validateCrowdCellFinalizePolicy(policy),/Pin the externally/);
  assert.throws(()=>validateCrowdCellFinalizePolicy(policy,{expectedCampaignType:{...exact,args:'0x1234'}}),/pinned deployed campaign/);
  assert.throws(()=>validateCrowdCellFinalizePolicy({...policy,requiredCellDeps:[]},{expectedCampaignType:exact}),/dependencies/);
  assert.throws(()=>validateCrowdCellFinalizePolicy({...policy,capacityFlow:[]},{expectedCampaignType:exact}),/preserve-typed-cell/);
  assert.throws(()=>validateCrowdCellFinalizePolicy({...policy,roleRequirements:[]},{expectedCampaignType:exact}),/campaign role/);
  assert.throws(()=>validateCrowdCellFinalizePolicy({...policy,capacityFlow:policy.capacityFlow.slice(0,1)},{expectedCampaignType:exact}),/finalizer net profit/);
});
test('synthetic offline valid never authorizes broadcast, even with provided input metadata',()=> {
  const r=previewCrowdCellFinalize({transaction:cccLike(good),policy,expectedCampaignType:exact,resolvedInputs:inputs});
  assert.equal(r.status,'PREVIEW_ONLY');assert.equal(r.allowed,false);
  assert.equal(r.report.errorCount,0);
  assert.equal(r.report.capacityFlow.inputEvidence,'provided-unverified');
});
test('synthetic diverted capacity is detected offline',()=> {
  const r=previewCrowdCellFinalize({transaction:leak,policy,expectedCampaignType:exact,resolvedInputs:inputs});
  assert.equal(r.status,'POLICY_FAILED');
  assert.ok(r.report.findings.some(f=>f.code==='PROTECTED_CELL_CAPACITY_SHRINK'));
});
test('mock RPC: correctly signed-like valid fixture can clear all read-only checks',async()=> {
  const r=await preflightCrowdCellFinalize({transaction:cccLike(good),policy,expectedCampaignType:exact,rpc:mockRpc(good)});
  assert.equal(r.status,'PASS',JSON.stringify(r.report.findings));assert.equal(r.allowed,true);
  assert.equal(r.report.checks.vmScripts,'pass');assert.equal(r.report.checks.txPoolAcceptance,'pass');
});
test('mock RPC: modified campaign capacity refuses broadcast',async()=> {
  const r=await preflightCrowdCellFinalize({transaction:leak,policy,expectedCampaignType:exact,rpc:mockRpc(leak)});
  assert.equal(r.status,'POLICY_FAILED');assert.equal(r.allowed,false);
  await assert.rejects(()=>assertCrowdCellFinalizePreflight({transaction:leak,policy,expectedCampaignType:exact,rpc:mockRpc(leak)}),CellGuardPolicyError);
});
test('mock RPC: unavailable pool status fails closed',async()=> {
  const r=await preflightCrowdCellFinalize({transaction:good,policy,expectedCampaignType:exact,rpc:mockRpc(good,{noPool:true})});
  assert.equal(r.status,'INCONCLUSIVE');assert.equal(r.allowed,false);
});
test('mainnet disallowed and malformed CCC data rejected',async()=> {
  await assert.rejects(()=>preflightCrowdCellFinalize({transaction:good,policy,expectedCampaignType:exact,network:'mainnet',rpc:mockRpc()}),/TESTNET-only/);
  assert.throws(()=>toCkbRpcTransaction({...good,outputs:[{...good.outputs[0],capacity:-1n},good.outputs[1]]}),/outside u64/);
  assert.throws(()=>toCkbRpcTransaction({...good,outputs_data:[]}),/equal lengths|outputs_data/);
});

test('keeper hook signs once and submits exactly the already-checked object on PASS',async()=>{
  let signedCalls=0, sendCalls=0; const signed=cccLike(good);
  const signer={signTransaction:async tx=>{signedCalls++;assert.equal(tx,signed);return signed;},
    client:{sendTransaction:async tx=>{sendCalls++;assert.equal(tx,signed);return hex64('c');}}};
  const response=await signGuardAndSendCrowdCellFinalize({transaction:signed,signer,policy,expectedCampaignType:exact,rpc:mockRpc(good)});
  assert.equal(response.txHash,hex64('c'));
  assert.equal(signedCalls,1); assert.equal(sendCalls,1);
});
test('keeper hook never broadcasts after policy FAIL, pool INCONCLUSIVE or wrong pin',async()=>{
  for (const scenario of [
    {tx:leak,rpc:mockRpc(leak),pin:exact},
    {tx:good,rpc:mockRpc(good,{noPool:true}),pin:exact},
    {tx:good,rpc:mockRpc(good),pin:{...exact,args:'0x3456'}}
  ]) {
    let broadcast=0;
    const signer={signTransaction:async()=>scenario.tx,client:{sendTransaction:async()=>{broadcast++;throw Error('must not broadcast');}}};
    await assert.rejects(()=>signGuardAndSendCrowdCellFinalize({transaction:scenario.tx,signer,policy,
      expectedCampaignType:scenario.pin,rpc:scenario.rpc}));
    assert.equal(broadcast,0);
  }
});

test('reject same campaign type moved to different lock even if generic role-accounting policy passes',async()=>{
  const tx=structuredClone(good),cells=structuredClone(inputs);
  const campaignLock=structuredClone(tx.outputs[0].lock);
  const finalizerLock=structuredClone(tx.outputs[1].lock);
  tx.outputs[0].lock=finalizerLock; // typed successor under WRONG lock
  tx.outputs.splice(1,0,{capacity:tx.outputs[0].capacity,lock:campaignLock,type:null});
  tx.outputs_data.push('0x');
  cells[1].capacity='0x'+(700n*100000000n).toString(16);
  const preview=previewCrowdCellFinalize({transaction:tx,policy,expectedCampaignType:exact,resolvedInputs:cells});
  assert.equal(preview.status,'POLICY_FAILED');
  assert.ok(preview.report.findings.some(x=>x.code==='CROWDCELL_CAMPAIGN_TYPE_LOCK_MISMATCH'));
  const live=await preflightCrowdCellFinalize({transaction:tx,policy,expectedCampaignType:exact,
    rpc:mockRpc(tx,{suppliedInputs:cells})});
  assert.equal(live.status,'POLICY_FAILED');assert.equal(live.allowed,false);
  assert.ok(live.report.findings.some(x=>x.code==='CROWDCELL_CAMPAIGN_TYPE_LOCK_MISMATCH'));
});
