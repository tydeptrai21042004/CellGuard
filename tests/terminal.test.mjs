import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTerminalCommand } from '../site/assets/lib/terminal.mjs';

for (const [input, action, fixture] of [
  ['inspect safe', 'inspect', 'safe'],
  ['run risk', 'inspect', 'risk'],
  ['RUN RISKY', 'inspect', 'risk'],
  ['inspect type', 'inspect', 'type'],
  ['inspect json', 'inspect', 'json'],
  ['run', 'inspect', 'json'],
  ['', 'inspect', 'json'],
  ['load safe', 'load', 'safe'],
  ['load type', 'load', 'type'],
  ['help', 'help'], ['examples', 'examples'], ['status', 'status'], ['clear', 'clear'], ['policy', 'policy'], ['report', 'report']
]) {
  test(`command parser: ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseTerminalCommand(input), fixture ? { action, fixture } : { action });
  });
}
test('bare hash is not silently interpreted as a lookup', () => {
  assert.equal(parseTerminalCommand('inspect 0x' + 'a'.repeat(64)).action, 'lookup-invalid');
});
test('arbitrary shell-like commands cannot execute', () => {
  assert.equal(parseTerminalCommand('rm -rf /').action, 'unknown');
  assert.equal(parseTerminalCommand('curl https://example.com').action, 'unknown');
  assert.equal(parseTerminalCommand('inspect safe && whoami').action, 'unknown');
});
test('reject oversized command', () => {
  assert.throws(() => parseTerminalCommand('x'.repeat(4097)), /4096/);
});
