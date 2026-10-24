/** Vercel Node function. Read the raw request stream so duplicate JSON keys survive
 * until parseStrictJSON; accessing Vercel's lazy req.body would discard them.
 */
import { handleHttpVerification, jsonHeaders } from '../server/http.mjs';

export async function readRawRequest(req, maxBytes) {
  const chunks = [];
  let total = 0;
  // Do not access req.body: the Vercel helper lazily parses application/json.
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw Object.assign(new Error('Request too large'), { code: 'TOO_LARGE' });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export default async function handler(req, res) {
  const reply = await handleHttpVerification({
    method: req.method,
    origin: req.headers.origin,
    host: req.headers.host,
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    readBody: max => readRawRequest(req, max)
  });
  res.writeHead(reply.status, jsonHeaders());
  res.end(JSON.stringify(reply.body));
}
