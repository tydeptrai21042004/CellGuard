import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAFE_TRANSACTION } from '../site/assets/lib/fixtures.mjs';

/** Dependency-free DOM event smoke test: checks module wiring, not browser layout. */
class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this._text = '';
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(x => x.textContent ?? '').join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() {}
  querySelectorAll(selector) {
    const answer = [];
    const search = node => {
      for (const child of node.children) {
        if (selector === 'article.finding' && child.tagName === 'article' && child.className.includes('finding')) answer.push(child);
        search(child);
      }
    };
    search(this);
    return answer;
  }
  fire(type) { const fn = this.listeners.get(type); assert.equal(typeof fn, 'function', `${type} not wired`); return fn({ preventDefault() {}, currentTarget:this }); }
}
test('browser module initial render, strict preset, diff and undo are wired', async () => {
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const identifiers = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const nodes = new Map(identifiers.map(id => [id, new FakeNode()]));
  assert.equal(identifiers.length, nodes.size, 'unique HTML IDs');
  const document = {
    getElementById(id) { assert.ok(nodes.has(id), `Missing HTML element ${id}`); return nodes.get(id); },
    createElement(tag) { return new FakeNode(tag); },
    createTextNode(str) { const n = new FakeNode('text'); n.textContent = str; return n; },
    querySelectorAll(selector) { assert.equal(selector, '[data-command]'); return []; }
  };
  let confirmationCount = 0;
  globalThis.document = document;
  globalThis.window = { confirm() { confirmationCount++; return true; } };
  const n = id => nodes.get(id);
  try {
    await import('../site/assets/main.mjs');
    assert.match(n('status').textContent, /Configured policy checks passed/);
    assert.equal(n('download-report').disabled, false);
    assert.equal(n('undo-replace').disabled, true);
    n('load-strict').fire('click');
    assert.equal(JSON.parse(n('policy-input').value).version, 2);
    assert.equal(n('undo-replace').disabled, false);
    n('undo-replace').fire('click');
    assert.equal(JSON.parse(n('policy-input').value).version, 1);
    n('compare-current').fire('click');
    assert.deepEqual(JSON.parse(n('compare-input').value), SAFE_TRANSACTION);
    n('run-diff').fire('click');
    assert.match(n('status').textContent, /No indexed output changes detected/);
    assert.equal(n('diff-results').hidden, false);
    n('transaction-input').value = '{"bad":"json"}';
    n('transaction-input').fire('input');
    assert.equal(n('copy-report').disabled, true);
    n('inspect-json').fire('click');
    assert.match(n('status').textContent, /Invalid input or policy/);
    n('load-safe').fire('click');
    assert.equal(JSON.parse(n('transaction-input').value).outputs.length, 2);
    assert.ok(confirmationCount >= 1, 'edited content requires replacement confirmation');
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});
