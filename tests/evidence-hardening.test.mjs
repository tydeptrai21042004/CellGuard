import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import vercelHandler, { readRawRequest } from '../api/verify.mjs';
import { handleHttpVerification } from '../server/http.mjs';
import { createRpc } from '../server/rpc.mjs';

const H = '0x' + '7'.repeat(64);
const HEAD = '0x' + '8'.repeat(64);
const jsonReq = (body) => Object.assign(Readable.from([Buffer.from(body)]), {
  method: 'POST',
  headers: { host: 'cellguard.example', origin: 'https://cellguard.example', 'content-type': 'application/json' }
});
async function invoke(body) {
  const req = jsonReq(body);
  Object.defineProperty(req, 'body', { get() { throw Error('Vercel parsed-body getter must not be used'); } });
  const res = { status: null, headers: null, text: '', writeHead(code, headers) { this.status = code; this.headers = headers; return this; }, end(raw) { this.text = raw; return this; } };
  await vercelHandler(req, res);
  return { status: res.status, body: JSON.parse(res.text) };
}

test('Vercel entrypoint preserves raw JSON for duplicate key detection, never reads req.body', async () => {
  const bad = await invoke('{"action":"lookup","action":"lookup"}');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_JSON');
  const good = await invoke('{"action":"missing"}');
  assert.equal(good.status, 422);
  assert.equal(good.body.error.code, 'BAD_ACTION');
});

test('Vercel entrypoint rejects oversized streaming request and preserves split UTF-8', async () => {
  const large = await invoke('a'.repeat(262144 + 16385));
  assert.equal(large.status, 413);
  assert.equal(large.body.error.code, 'TOO_LARGE');
  const raw = Readable.from([Buffer.from([0x22, 0xf0, 0x9f]), Buffer.from([0x8c, 0xb4, 0x22])]);
  assert.equal(await readRawRequest(raw, 16), '"🌴"');
});

test('raw-only HTTP entry rejects parsed request objects and malformed content-length', async () => {
  const base = { method:'POST', contentType:'application/json', host:'localhost:3000', origin:null };
  const parsed = await handleHttpVerification({ ...base, readBody:async () => ({action:'lookup', network:'testnet', hash:H}) });
  assert.equal(parsed.status,400);
  const len = await handleHttpVerification({ ...base, contentLength:'Infinity', readBody:async()=> '{}' });
  assert.equal(len.status,413);
});

test('per-instance backpressure limits outstanding RPC-heavy verifications', async () => {
  let resolve;
  const held = new Promise(r => { resolve = r; });
  let called = 0;
  const rpcFactory = () => async (method) => {
    if (method === 'get_blockchain_info') { called++; await held; return { chain:'ckb_testnet', is_initial_block_download:false }; }
    if (method === 'get_tip_header') return { hash:HEAD, number:'0x2' };
    if (method === 'get_transaction') return null;
    throw Error(`unexpected ${method}`);
  };
  const body = JSON.stringify({action:'lookup',network:'testnet',hash:H});
  const base = {method:'POST',contentType:'application/json',host:'localhost',origin:null,
    readBody: async()=>body,rpcFactory};
  const promises = Array.from({length:6},()=>handleHttpVerification(base));
  try {
    // Each request must reach the RPC before testing concurrent admission.
    await new Promise(r=>setImmediate(r));
    assert.equal(called,6);
    const extra = await handleHttpVerification(base);
    assert.equal(extra.status,429);
    assert.equal(extra.body.error.code,'BUSY');
  } finally { resolve(); }
  assert.deepEqual((await Promise.all(promises)).map(p=>p.status),Array(6).fill(200));
});

test('streaming RPC limits actual received bytes without content-length', async () => {
  const huge = Buffer.alloc(1_000_001, 65);
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(huge.subarray(0,500_000)); controller.enqueue(huge.subarray(500_000)); controller.close(); }
  });
  const rpc = createRpc('testnet', { env:{}, fetchImpl:async()=>({ ok:true, headers:{get:()=>null}, body:stream }) });
  await assert.rejects(rpc('get_tip_header'), err => err.code === 'RPC_RESPONSE_TOO_LARGE');
});

test('RPC rejects oversized multibyte data in compatibility text transport', async () => {
  const rpc = createRpc('testnet', { env:{}, fetchImpl:async()=>({ ok:true, headers:{get:()=>null}, text:async()=> '🌴'.repeat(300_000) }) });
  await assert.rejects(rpc('get_tip_header'), err => err.code === 'RPC_RESPONSE_TOO_LARGE');
});
