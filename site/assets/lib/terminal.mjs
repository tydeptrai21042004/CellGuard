/** Closed command grammar; online commands invoke only CellGuard's read-only API. */
export function parseTerminalCommand(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Command exceeds 4096 characters');
  const text = raw.trim();
  if (!text) return { action: 'inspect', fixture: 'json' };
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if (['help', '?', '--help'].includes(normalized)) return { action: 'help' };
  if (normalized === 'examples') return { action: 'examples' };
  if (normalized === 'clear' || normalized === 'cls') return { action: 'clear' };
  if (normalized === 'status') return { action: 'status' };
  if (normalized === 'policy') return { action: 'policy' };
  if (normalized === 'diff' || normalized === 'compare json') return { action: 'diff' };
  if (normalized === 'undo') return { action: 'undo' };
  if (normalized === 'report') return { action: 'report' };
  if (normalized === 'load strict') return { action: 'strict-policy' };
  if (normalized === 'load safe' || normalized === 'load risk' || normalized === 'load type') {
    return { action: 'load', fixture: normalized.slice(5) };
  }
  if (normalized === 'verify' || normalized === 'verify json') return { action: 'verify-online' };
  if (normalized === 'lookup' || (normalized.startsWith('lookup ') && !/^lookup 0x[0-9a-f]{64}$/.test(normalized))) return { action: 'lookup-invalid' };
  if (/^lookup 0x[0-9a-f]{64}$/.test(normalized)) return { action: 'lookup-online', hash: normalized.slice(7) };
  if (normalized === 'inspect' || normalized === 'run') return { action: 'inspect', fixture: 'json' };
  const match = /^(inspect|run) (safe|risk|risky|type|json)$/.exec(normalized);
  if (match) return { action: 'inspect', fixture: match[2] === 'risky' ? 'risk' : match[2] };
  if (/\b0x[0-9a-f]{64}\b/i.test(text) || /^(inspect|run)\s+0x/i.test(text)) {
    return { action: 'lookup-invalid' };
  }
  return { action: 'unknown', input: text.slice(0, 120) };
}
