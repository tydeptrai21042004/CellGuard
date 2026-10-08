import { parseTransaction, formatCkb } from './ckb.mjs';

/** Indexed output diff only. Output index is not a semantic recipient identity. */
export function compareTransactions(before, after) {
  const oldTx = parseTransaction(before);
  const newTx = parseTransaction(after);
  const changes = [];
  const add = (severity, path, oldValue, newValue, description) => {
    changes.push({ severity, path, before: oldValue, after: newValue, description });
  };
  for (let i = 0; i < Math.max(oldTx.outputs.length, newTx.outputs.length); i++) {
    const a = oldTx.outputs[i];
    const b = newTx.outputs[i];
    const path = `outputs[${i}]`;
    if (!a || !b) { add('review', path, a ? 'present' : 'absent', b ? 'present' : 'absent', 'Output added/removed; review all indices after this change'); continue; }
    for (const field of ['capacity', 'dataBytes', 'data', 'lock', 'type']) {
      const display = (out) => {
        if (field === 'capacity') return formatCkb(out.capacity);
        if (field === 'dataBytes') return String(out.dataBytes);
        if (field === 'data') {
          const full = (out === a ? before : after).outputs_data[i].toLowerCase();
          return full.length > 90 ? `${full.slice(0, 50)}…${full.slice(-30)} (${(full.length - 2) / 2} bytes)` : full;
        }
        const script = out[field];
        return script ? `${script.codeHash}/${script.hashType}/${script.args}` : 'none';
      };
      const va = display(a), vb = display(b);
      const different = field === 'data' ? before.outputs_data[i].toLowerCase() !== after.outputs_data[i].toLowerCase() : va !== vb;
      if (different) add(field === 'lock' || field === 'type' ? 'review' : 'info', `${path}.${field}`, va, vb,
        field === 'lock' ? 'Lock changed; verify recipient intent' : field === 'type' ? 'Type script changed; review asset state' : field === 'capacity' ? 'Capacity changed; verify amounts and change' : field === 'data' ? 'Output data contents changed' : 'Output data length changed');
    }
  }
  return { schemaVersion: 1, mode: 'indexed-output-diff', changeCount: changes.length,
    beforeCount: oldTx.outputs.length, afterCount: newTx.outputs.length, changes,
    disclaimer: 'Indexed offline summary only. No chain validation; output-data bytes are compared by length only, not by content. Output reordering can produce numerous differences.' };
}
