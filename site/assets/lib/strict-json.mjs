/** Bounded JSON grammar scanner that rejects duplicate keys at every nesting level.
 * We intentionally return JSON.parse's ordinary output after validating the raw text.
 * No eval, dynamic code generation, or third-party parser is used.
 */
export const MAX_JSON_BYTES = 1_048_576;
const encoder = new TextEncoder();
export function parseStrictJSON(source, label = 'JSON', options = {}) {
  const maxBytes = options.maxBytes ?? MAX_JSON_BYTES;
  const maxDepth = options.maxDepth ?? 64;
  const maxTokens = options.maxTokens ?? 200_000;
  if (typeof source !== 'string') throw new Error(`${label}: expected JSON text`);
  if (encoder.encode(source).byteLength > maxBytes) throw new Error(`${label}: exceeds ${maxBytes} byte limit`);
  let at = 0;
  let tokens = 0;
  const fail = reason => { throw new Error(`${label}: ${reason} at character ${at}`); };
  const space = () => { while (at < source.length && /[ \t\n\r]/.test(source[at])) at++; };
  function quoted() {
    const start = at;
    if (source[at++] !== '"') fail('expected string');
    while (at < source.length) {
      const char = source[at++];
      if (char === '"') return JSON.parse(source.slice(start, at));
      if (char === '\\') {
        const escaped = source[at++];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(at, at + 4))) fail('invalid Unicode escape');
          at += 4;
        } else if (!'"\\/bfnrt'.includes(escaped ?? '')) fail('invalid string escape');
      } else if (char.charCodeAt(0) < 32) fail('control character in string');
    }
    fail('unterminated string');
  }
  function value(depth, path) {
    if (++tokens > maxTokens) fail('too many JSON tokens');
    if (depth > maxDepth) fail('JSON nesting limit exceeded');
    space();
    const c = source[at];
    if (c === '"') { quoted(); return; }
    if (c === '{') {
      at++; space();
      const keys = new Set();
      if (source[at] === '}') { at++; return; }
      while (at < source.length) {
        space();
        if (source[at] !== '"') fail('object key must be a string');
        const key = quoted();
        if (keys.has(key)) fail(`duplicate key ${JSON.stringify(key)} in ${path}`);
        keys.add(key);
        space(); if (source[at++] !== ':') fail('expected colon');
        value(depth + 1, `${path}.${key}`);
        space();
        const sep = source[at++];
        if (sep === '}') return;
        if (sep !== ',') fail('expected comma or end of object');
      }
      fail('unclosed object');
    }
    if (c === '[') {
      at++; space();
      if (source[at] === ']') { at++; return; }
      let idx = 0;
      while (at < source.length) {
        value(depth + 1, `${path}[${idx++}]`);
        space();
        const sep = source[at++];
        if (sep === ']') return;
        if (sep !== ',') fail('expected comma or end of array');
      }
      fail('unclosed array');
    }
    if (c === 't' && source.slice(at, at + 4) === 'true') { at += 4; return; }
    if (c === 'f' && source.slice(at, at + 5) === 'false') { at += 5; return; }
    if (c === 'n' && source.slice(at, at + 4) === 'null') { at += 4; return; }
    const match = source.slice(at).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (match) { at += match[0].length; return; }
    fail('invalid JSON value');
  }
  value(0, '$');
  space();
  if (at !== source.length) fail('unexpected trailing characters');
  try { return JSON.parse(source); } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}
