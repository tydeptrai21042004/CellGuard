import { verifyTransactionOnline, lookupTransactionOnline, ONLINE_LIMIT, VerificationError } from './verification.mjs';
import { createRpc } from './rpc.mjs';
import { parseStrictJSON } from '../site/assets/lib/strict-json.mjs';

export function checkOrigin(origin, host) {
  if (!origin) return true; // CLI / same-origin browsers without Origin
  try { const from = new URL(origin); return (from.protocol === 'https:' || from.protocol === 'http:') && from.host === host; }
  catch { return false; }
}
export async function handleVerify(body, rpcFactory = createRpc) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['verify', 'lookup'].includes(body.action)) throw new VerificationError('BAD_ACTION', 'Expected verify or lookup');
  const rpc = rpcFactory(body.network);
  return body.action === 'verify' ? verifyTransactionOnline(body, rpc) : lookupTransactionOnline(body, rpc);
}
export function sanitizeError(error) {
  if (error?.code === 'BAD_JSON' || error?.name === 'SyntaxError') return { status: 400, body: { error: { code: 'BAD_JSON', message: 'Invalid JSON request' } } };
  if (error?.code === 'TOO_LARGE') return { status: 413, body: { error: { code: 'TOO_LARGE', message: 'Request exceeds online limit' } } };
  if (error instanceof VerificationError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  return { status: 500, body: { error: { code: 'SERVER_ERROR', message: 'Internal verification error' } } };
}
export function jsonHeaders() { return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }; }
export async function handleHttpVerification({ method, origin, host, contentType, contentLength, readBody, rpcFactory }) {
  if (method !== 'POST') return { status: 405, body: { error: { code: 'METHOD', message: 'POST required' } } };
  if (!checkOrigin(origin, host)) return { status: 403, body: { error: { code: 'ORIGIN', message: 'Cross-origin requests are not allowed' } } };
  if (!/^application\/json(?:\s*;|$)/i.test(contentType || '')) return { status: 415, body: { error: { code: 'MEDIA_TYPE', message: 'application/json required' } } };
  if (contentLength && Number(contentLength) > ONLINE_LIMIT + 16384) return { status: 413, body: { error: { code: 'TOO_LARGE', message: 'Request exceeds online limit' } } };
  try {
    const raw = await readBody(ONLINE_LIMIT + 16384);
    let request;
    try { request = typeof raw === 'string' ? parseStrictJSON(raw, 'RPC verification request') : raw; }
    catch { throw new VerificationError('BAD_JSON', 'Invalid JSON request or duplicate property', 400); }
    return { status: 200, body: await handleVerify(request, rpcFactory) };
  } catch (error) { return sanitizeError(error); }
}
