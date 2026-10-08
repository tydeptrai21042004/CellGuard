/** Vercel Node function, read-only CKB RPC; same interface as local dev server. */
import { handleHttpVerification, jsonHeaders } from '../server/http.mjs';
export default async function handler(req, res) {
  const reply = await handleHttpVerification({
    method: req.method,
    origin: req.headers.origin,
    host: req.headers.host,
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    readBody: async max => {
      if (typeof req.body === 'string') { if (req.body.length > max) throw Object.assign(new Error('Too large'), { code: 'TOO_LARGE' }); return req.body; }
      if (req.body !== undefined) { if (JSON.stringify(req.body).length > max) throw Object.assign(new Error('Too large'), { code: 'TOO_LARGE' }); return req.body; }
      let body = '';
      for await (const part of req) { body += part.toString(); if (body.length > max) throw Object.assign(new Error('Too large'), { code: 'TOO_LARGE' }); }
      return body;
    }
  });
  res.writeHead(reply.status, jsonHeaders()); res.end(JSON.stringify(reply.body));
}
