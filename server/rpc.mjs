/** SSRF-safe allowlisted upstream RPC. No user-specified upstream URLs or methods. */
import { VerificationError } from './verification.mjs';
const DEFAULTS = Object.freeze({ mainnet: 'https://mainnet.ckb.dev/', testnet: 'https://testnet.ckb.dev/' });
const ALLOWED = new Set(['get_blockchain_info', 'get_tip_header', 'get_live_cell', 'estimate_cycles', 'dry_run_transaction', 'test_tx_pool_accept', 'get_transaction', 'get_header', 'get_block_hash', 'get_transaction_proof', 'verify_transaction_proof']);
const MAX_RPC_RESULT = 1_000_000;
export function rpcEndpoint(network, env = process.env) {
  if (!Object.hasOwn(DEFAULTS, network)) throw new VerificationError('BAD_NETWORK', 'Unsupported chain network');
  const raw = network === 'mainnet' ? env.CKB_RPC_MAINNET || DEFAULTS.mainnet : env.CKB_RPC_TESTNET || DEFAULTS.testnet;
  let url;
  try { url = new URL(raw); } catch { throw new VerificationError('RPC_CONFIG', 'Invalid RPC URL configuration', 500); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && env.CKB_ALLOW_LOCAL_RPC === '1')) {
    throw new VerificationError('RPC_CONFIG', 'RPC URL must use HTTPS (local HTTP requires CKB_ALLOW_LOCAL_RPC=1)', 500);
  }
  if (url.username || url.password || url.search || url.hash) throw new VerificationError('RPC_CONFIG', 'RPC URL must not include credentials, query or fragment', 500);
  return url.toString();
}
export function createRpc(network, { fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 7000 } = {}) {
  const endpoint = rpcEndpoint(network, env);
  let id = 0;
  const deadline = Date.now() + 25000; // bounded time budget for a serverless request
  return async function rpc(method, params = []) {
    if (!ALLOWED.has(method)) throw new VerificationError('METHOD_BLOCKED', 'RPC method not allowed', 403);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new VerificationError('RPC_TIMEOUT', 'RPC verification exceeded the 25-second total budget', 503);
    const signal = AbortSignal.timeout(Math.min(timeoutMs, remaining));
    const requestId = ++id;
    let response;
    try {
      response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal });
    } catch (err) { throw new VerificationError('RPC_UNAVAILABLE', `Unable to reach ${network} RPC: ${err instanceof Error ? err.message.slice(0,100) : 'request failed'}`, 503); }
    if (!response.ok) throw new VerificationError('RPC_HTTP', `RPC returned HTTP ${response.status}`, 502);
    if (Number(response.headers.get('content-length')) > MAX_RPC_RESULT) throw new VerificationError('RPC_RESPONSE_TOO_LARGE', 'RPC response too large', 502);
    let payload;
    try {
      const body = await response.text();
      if (body.length > MAX_RPC_RESULT) throw Error('RPC response too large');
      payload = JSON.parse(body);
    } catch { throw new VerificationError('RPC_RESPONSE_INVALID', 'Malformed RPC response', 502); }
    if (!payload || payload.jsonrpc !== '2.0' || payload.id !== requestId) throw new VerificationError('RPC_RESPONSE_INVALID', 'Mismatched RPC request/response ID', 502);
    if (payload.error) {
      const err = new VerificationError('RPC_METHOD_ERROR', typeof payload.error.message === 'string' ? payload.error.message.slice(0,320) : 'CKB RPC failed', 502);
      err.rpcCode = payload.error.code;
      throw err;
    }
    if (!Object.hasOwn(payload, 'result')) throw new VerificationError('RPC_RESPONSE_INVALID', 'RPC result is missing', 502);
    return payload.result;
  };
}
