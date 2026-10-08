import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
test('Vercel deploys only the static site folder, no build step', () => {
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'site');
  assert.equal(config.buildCommand, null);
  assert.equal(config.installCommand, '');
});
test('security headers avoid remote connections and inline scripts', () => {
  const h = config.headers.flatMap(item => item.headers);
  const csp = h.find(v => v.key === 'Content-Security-Policy')?.value;
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
test('entry assets exist and import from deployed paths', () => {
  for (const file of ['index.html','assets/styles.css','assets/main.mjs','assets/lib/analyzer.mjs']) {
    assert.ok(existsSync(new URL('../site/' + file, import.meta.url)), file);
  }
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /assets\/main\.mjs/);
  assert.match(html, /assets\/styles\.css/);
});
