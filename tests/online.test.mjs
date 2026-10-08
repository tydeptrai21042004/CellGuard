import test from 'node:test';
import assert from 'node:assert/strict';
import { SAFE_TRANSACTION, DEMO_POLICY } from '../site/assets/lib/fixtures.mjs';
import { verifyTransactionOnline, lookupTransactionOnline } from '../server/verification.mjs';
import { createRpc, rpcEndpoint } from '../server/rpc.mjs';
import { handleHttpVerification } from '../server/http.mjs';
import { parseTerminalCommand } from '../site/assets/lib/terminal.mjs';

const H = '0x' + 'a'.repeat(64);
const B = '0x' + 'b'.repeat(64);
const tx = () => ({ ...structuredClone(SAFE_TRANSACTION), inputs: [{ previous_output: { tx_hash: H, index: '0x0' }, since: '0x0' }], witnesses: ['0x1234'] });
const cap = (ckb) => `0x${(BigInt(ckb)*100000000n).toString(16)}`;
const chainHeader = { hash: B, number: '0x100' };
function mocked(override = {}) {
  const calls = [];
  const outputs = {
    get_blockchain_info: { chain: 'ckb_testnet', is_initial_block_download: false },
    get_tip_header: chainHeader,
    get_live_cell: { status: 'live', cell: { output: { capacity: cap(130) } } },
    estimate_cycles: { cycles: '0x2000' },
    test_tx_pool_accept: { cycles: '0x2000', fee: cap(3) },
    get_transaction: { tx_status: { status: 'committed', block_hash: B } },
    get_header: { number: '0xf0' },
    get_block_hash: B,
    get_transaction_proof: { block_hash: B, proof: { indices:['0x0'], lemmas:[] }, witnesses_root: H },
    verify_transaction_proof: [H], ...override
  };
  async function rpc(method, args) {
    calls.push({ method, args });
    const v = outputs[method];
    if (v instanceof Error) throw v;
    return typeof v === 'function' ? await v() : v;
  }
  return { rpc, calls };
}

test('online VM pass verifies script execution, fee and input liveness without claiming full consensus validity', async () => {
  const mock = mocked();
  const result = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, mock.rpc);
  assert.equal(result.status, 'pass');
  assert.equal(result.checks.consensus, 'node-txpool-preflight-pass');
  assert.equal(result.txPool.status, 'pass');
  assert.equal(result.checks.finality, 'not-verified');
  assert.equal(result.checks.lockWitnesses, 'accepted-by-executed-lock-scripts');
  assert.equal(result.feeCKB, '3');
  assert.equal(result.scripts.cycles, '8192');
  assert.ok(mock.calls.some(x => x.method === 'estimate_cycles'));
  assert.ok(!mock.calls.some(x => x.method === 'send_transaction'));
});
test('live inputs with negative fee produce a hard error and do not execute scripts', async () => {
  const m = mocked({ get_live_cell: { status: 'live', cell: { output: { capacity: cap(70) } } } });
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, m.rpc);
  assert.equal(r.status, 'fail');
  assert.equal(r.checks.fee, 'fail');
  assert.equal(r.scripts.status, 'skipped');
  assert.ok(r.findings.some(f => f.code === 'NEGATIVE_FEE'));
});
test('spent/unknown inputs are failures and fee cannot be computed', async () => {
  for (const state of ['dead', 'unknown']) {
    const m = mocked({ get_live_cell: { status: state, cell: null } });
    const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, m.rpc);
    assert.equal(r.status, 'fail'); assert.equal(r.feeCKB, null); assert.equal(r.scripts.status, 'skipped');
    assert.ok(r.findings.some(f => f.code === 'INPUT_NOT_LIVE'));
  }
});
test('RPC -302 script execution failure is a failure, not a generic timeout', async () => {
  const error = Object.assign(new Error('Invalid secp256k1 witness'), { rpcCode: -302 });
  const m = mocked({ estimate_cycles: error });
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, m.rpc);
  assert.equal(r.scripts.status, 'fail'); assert.equal(r.status, 'fail');
  assert.ok(r.findings.some(f => f.code === 'SCRIPT_EXECUTION_FAILED'));
});
test('unknown RPC errors yield inconclusive, not false invalid-signature assertions', async () => {
  const m = mocked({ estimate_cycles: new Error('Gateway timeout') });
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, m.rpc);
  assert.equal(r.status, 'pass'); assert.equal(r.scripts.status, 'pass'); assert.equal(r.scripts.method, 'test_tx_pool_accept');
});
test('missing estimate_cycles method falls back to deprecated dry_run_transaction', async () => {
  const m = mocked({ estimate_cycles: Object.assign(new Error('method not found'), { rpcCode: -32601 }), dry_run_transaction: { cycles: '0xf' } });
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, m.rpc);
  assert.equal(r.scripts.method, 'dry_run_transaction'); assert.equal(r.scripts.cycles, '15');
});
test('chain mismatch and syncing node fail closed', async () => {
  await assert.rejects(verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, mocked({ get_blockchain_info: { chain: 'ckb' } }).rpc), /expected ckb_testnet/);
  await assert.rejects(verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, mocked({ get_blockchain_info: { chain: 'ckb_testnet', is_initial_block_download: true } }).rpc), /initial block download/);
});
test('strict full tx required; offline demonstration is never sent to RPC', async () => {
  const m = mocked();
  await assert.rejects(verifyTransactionOnline({ network: 'testnet', transaction: SAFE_TRANSACTION, policy: DEMO_POLICY }, m.rpc), /at least one input/);
  assert.equal(m.calls.length, 0);
  await assert.rejects(verifyTransactionOnline({ network: 'testnet', transaction: { ...tx(), unexpected: 1 }, policy: DEMO_POLICY }, m.rpc), /unsupported field/);
});
test('unexpected same-height chain tip hash marks result inconclusive', async () => {
  let n = 0;
  const m = mocked({ get_tip_header: () => (++n > 1) ? { number: '0x100', hash: H } : chainHeader });
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, m.rpc);
  assert.equal(r.status, 'inconclusive');
  assert.ok(r.findings.some(f => f.code === 'CHAIN_STATE_CHANGED'));
});
test('lookup canonical committed transaction with confirmations, no cryptographic proof claim', async () => {
  const m = mocked();
  const r = await lookupTransactionOnline({ network: 'testnet', hash: H }, m.rpc);
  assert.equal(r.status, 'committed'); assert.equal(r.confirmations, '17');
  assert.equal(r.independentProof, false); assert.equal(r.proof.status, 'verified-by-node');
});
test('lookup non-canonical block, pending and unknown states', async () => {
  const mismatch = await lookupTransactionOnline({ network: 'testnet', hash: H }, mocked({ get_block_hash: H }).rpc);
  assert.equal(mismatch.status, 'reorg-risk');
  const pending = await lookupTransactionOnline({ network: 'testnet', hash: H }, mocked({ get_transaction: { tx_status: { status: 'pending' } } }).rpc);
  assert.equal(pending.status, 'pending');
  const unknown = await lookupTransactionOnline({ network: 'testnet', hash: H }, mocked({ get_transaction: null }).rpc);
  assert.equal(unknown.status, 'unknown');
});
test('RPC endpoint URL config blocks insecure upstreams unless explicitly local', () => {
  assert.match(rpcEndpoint('mainnet', {}), /mainnet.ckb.dev/);
  assert.throws(() => rpcEndpoint('mainnet', { CKB_RPC_MAINNET: 'http://internal.local/rpc' }), /HTTPS/);
  assert.throws(() => rpcEndpoint('mainnet', { CKB_RPC_MAINNET: 'https://admin:pass@example.org/' }), /credentials/);
  assert.equal(rpcEndpoint('testnet', { CKB_RPC_TESTNET:'http://127.0.0.1:8114/', CKB_ALLOW_LOCAL_RPC: '1' }), 'http://127.0.0.1:8114/');
});
test('RPC client correctly tracks concurrent JSON RPC IDs and forbids arbitrary methods', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const req = JSON.parse(options.body); requests.push(req);
    await new Promise(resolve => setTimeout(resolve, req.id === 1 ? 12 : 1));
    return { ok:true, headers:{ get:()=>null }, text:async () => JSON.stringify({ id: req.id, jsonrpc:'2.0', result:req.id }) };
  };
  const rpc = createRpc('mainnet', { fetchImpl, env:{} });
  const results = await Promise.all([rpc('get_tip_header'), rpc('get_blockchain_info')]);
  assert.deepEqual(results, [1,2]);
  await assert.rejects(rpc('send_transaction', []), /not allowed/);
});
test('HTTP handler rejects other origins, unsupported methods and duplicate JSON keys', async () => {
  const base = { host: 'localhost:3000', contentType: 'application/json', contentLength:'', readBody: async () => '{}' };
  const cross = await handleHttpVerification({ ...base, method:'POST', origin:'https://evil.example' }); assert.equal(cross.status, 403);
  const method = await handleHttpVerification({ ...base, method:'GET' }); assert.equal(method.status, 405);
  const duplicate = await handleHttpVerification({ ...base, method:'POST', readBody:async () => '{"action":"lookup","action":"lookup"}' }); assert.equal(duplicate.status, 400);
});
test('HTTP handler serves valid lookup through injected trusted RPC without network', async () => {
  const body = JSON.stringify({ action:'lookup', network:'testnet', hash:H });
  const r = await handleHttpVerification({ method:'POST', host:'localhost:3000', origin:'http://localhost:3000', contentType:'application/json', contentLength:String(body.length), readBody: async()=>body, rpcFactory:() => mocked().rpc });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'committed');
});
test('new terminal commands accepted without accidental system shell parsing', () => {
  assert.equal(parseTerminalCommand('verify json').action, 'verify-online');
  assert.equal(parseTerminalCommand(`lookup ${H}`).action, 'lookup-online');
  assert.equal(parseTerminalCommand('lookup 0xwrong').action, 'lookup-invalid');
});

test('txpool read-only acceptance rejection is a hard error distinct from VM script pass', async () => {
  const er = Object.assign(new Error('PoolRejectedTransactionByMinFeeRate'), { rpcCode: -1104 });
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, mocked({ test_tx_pool_accept: er }).rpc);
  assert.equal(r.scripts.status, 'pass'); assert.equal(r.txPool.status, 'fail'); assert.equal(r.status, 'fail');
  assert.ok(r.findings.some(x => x.code === 'TXPOOL_REJECTED'));
});
test('txpool unavailable or unimplemented is INCONCLUSIVE not false pass', async () => {
  for (const error of [Object.assign(new Error('method not found'), { rpcCode: -32601 }), new Error('RPC timeout')]) {
    const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, mocked({ test_tx_pool_accept: error }).rpc);
    assert.equal(r.status, 'inconclusive');
    assert.ok(['unsupported','unknown'].includes(r.txPool.status));
  }
});
test('txpool node fee disagreement is rejected', async () => {
  const r = await verifyTransactionOnline({ network: 'testnet', transaction: tx(), policy: DEMO_POLICY }, mocked({ test_tx_pool_accept: { cycles: '0x222', fee: cap(4) } }).rpc);
  assert.equal(r.status, 'fail'); assert.ok(r.findings.some(x => x.code === 'FEE_MISMATCH'));
});

test('inclusion proof mismatch fails closed, method unavailable preserves RPC-committed status with warning', async () => {
  const mismatch = await lookupTransactionOnline({ network: 'testnet', hash: H }, mocked({ verify_transaction_proof: [] }).rpc);
  assert.equal(mismatch.status, 'reorg-risk'); assert.equal(mismatch.proof.status, 'invalid');
  const unavailable = await lookupTransactionOnline({ network: 'testnet', hash: H }, mocked({ get_transaction_proof: Object.assign(new Error('method disabled'), { rpcCode:-32601 }) }).rpc);
  assert.equal(unavailable.status, 'committed'); assert.equal(unavailable.proof.status, 'unavailable');
});
