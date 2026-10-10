import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTransactionOnline, auditCommittedTransactionOnline } from '../server/verification.mjs';
import { handleHttpVerification } from '../server/http.mjs';
const load = p => JSON.parse(readFileSync(new URL('../examples/'+p, import.meta.url), 'utf8'));
const policy = load('profiles/finalize.example.json');
const good = load('crowdcell-synthetic/finalize-valid.json');
const leak = load('crowdcell-synthetic/finalize-leak-474.json');
const inputs = load('crowdcell-synthetic/finalize-inputs.unverified.json');
const B = '0x'+'b'.repeat(64), T = '0x'+'f'.repeat(64), P = '0x'+'e'.repeat(64);
const tip={hash:B,number:'0x90'};
function mockRpc(target=good) {
  const calls=[];
  const rpc=async (method, params=[])=>{
    calls.push({method,params});
    switch(method){
      case 'get_blockchain_info':return {chain:'ckb_testnet',is_initial_block_download:false};
      case 'get_tip_header':return tip;
      case 'get_live_cell':{
        const match=inputs.find(x=>x.outPoint.tx_hash.toLowerCase()===params[0].tx_hash.toLowerCase());
        return match ? {status:'live',cell:{output:{capacity:match.capacity,lock:match.lock,type:null}}} : {status:'unknown',cell:null};
      }
      case 'estimate_cycles':return {cycles:'0x1000'};
      case 'test_tx_pool_accept':return {cycles:'0x1000',fee:'0x989680'}; // 0.1 CKB
      case 'get_header':return {number:'0x80'};
      case 'get_block_hash':return B;
      case 'get_transaction_proof':return {block_hash:B,proof:{indices:['0x0'],lemmas:[]},witnesses_root:P};
      case 'verify_transaction_proof':return [T];
      case 'get_transaction':{
        const hash=params[0].toLowerCase();
        if(hash===T) return {tx_status:{status:'committed',block_hash:B},transaction:{hash:T,...target}};
        const match=inputs.find(x=>x.outPoint.tx_hash.toLowerCase()===hash);
        if(match)return {tx_status:{status:'committed',block_hash:B},transaction:{outputs:[{capacity:match.capacity,lock:match.lock,type:null}]}};
        return null;
      }
      default:throw new Error(`Unexpected RPC method ${method}`);
    }
  };
  return {rpc,calls};
}
test('live RPC resolved inputs make valid finalize policy pass without trusting local metadata',async()=>{
  const m=mockRpc();const r=await verifyTransactionOnline({network:'testnet',transaction:good,policy},m.rpc);
  assert.equal(r.status,'pass',JSON.stringify(r.findings));
  assert.equal(r.capacityFlow.inputEvidence,'rpc-live');
  assert.equal(r.capacityFlow.roles.finalizer.netCKB,'0');
  assert.ok(!r.findings.some(f=>f.code==='INPUT_EVIDENCE_UNVERIFIED'));
});
test('live RPC capacity leak fails policy even when VM and txpool return pass',async()=>{
  const m=mockRpc(leak);const r=await verifyTransactionOnline({network:'testnet',transaction:leak,policy},m.rpc);
  assert.equal(r.status,'fail');assert.equal(r.txPool.status,'pass');assert.equal(r.scripts.status,'pass');
  assert.ok(r.findings.some(f=>f.code==='CAPACITY_LEAK_DETECTED'));
  assert.ok(r.findings.some(f=>f.code==='POLICY_UNAUTHORIZED_NET_GAIN'));
});
test('committed audit resolves historical inputs rather than flagging spent as not-live',async()=>{
  const m=mockRpc(leak);const r=await auditCommittedTransactionOnline({network:'testnet',hash:T,policy},m.rpc);
  assert.equal(r.chainStatus,'committed');assert.equal(r.status,'policy-failed');
  assert.equal(r.capacityFlow.inputEvidence,'rpc-historical');
  assert.ok(r.findings.some(f=>f.code==='CAPACITY_LEAK_DETECTED'));
  assert.ok(!m.calls.some(x=>x.method==='get_live_cell'||x.method==='estimate_cycles'||x.method==='test_tx_pool_accept'));
});
test('historical valid transaction passes policy and reports node-sourced proof limitation',async()=>{
  const r=await auditCommittedTransactionOnline({network:'testnet',hash:T,policy},mockRpc().rpc);
  assert.equal(r.status,'pass');assert.equal(r.independentProof,false);
  assert.equal(r.checks.historicalVmReplay,'not-performed');
});
test('a non-canonical historical parent forces an inconclusive audit, not pass',async()=>{
  const m=mockRpc();let n=0;
  const guarded=async(method,params)=>{
    if(method==='get_block_hash')return ++n===1?B:P;
    return m.rpc(method,params);
  };
  const r=await auditCommittedTransactionOnline({network:'testnet',hash:T,policy},guarded);
  assert.equal(r.status,'inconclusive');assert.ok(r.findings.some(x=>x.code==='HISTORICAL_INPUT_UNAVAILABLE'));
});
test('historical record absent or noncanonical target is inconclusive, not success',async()=>{
  const m=mockRpc();const rpc=async(method,args)=> method==='get_transaction'&&args[0]===T?{tx_status:{status:'pending'}}:m.rpc(method,args);
  const r=await auditCommittedTransactionOnline({network:'testnet',hash:T,policy},rpc);
  assert.equal(r.status,'inconclusive');assert.equal(r.chainStatus,'pending');
});
test('HTTP audit action uses trusted configured RPC only',async()=>{
  const body=JSON.stringify({action:'audit',network:'testnet',hash:T,policy});
  const r=await handleHttpVerification({method:'POST',host:'localhost:3000',origin:'http://localhost:3000',contentType:'application/json',contentLength:String(body.length),readBody:async()=>body,rpcFactory:()=>mockRpc().rpc});
  assert.equal(r.status,200);assert.equal(r.body.status,'pass');
});
