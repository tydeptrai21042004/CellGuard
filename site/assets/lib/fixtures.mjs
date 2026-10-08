import { DEFAULT_POLICY } from './policy.mjs';

// Synthetic examples: structurally representative outputs, NOT chain-confirmed transactions.
const lock = { code_hash: '0x' + '11'.repeat(32), hash_type: 'type', args: '0x' + '22'.repeat(20) };
const output = (ckb, lockOverride = lock) => ({ capacity: `0x${(BigInt(ckb) * 100000000n).toString(16)}`, lock: lockOverride, type: null });
export const SAFE_TRANSACTION = Object.freeze({
  version: '0x0', cell_deps: [], header_deps: [], inputs: [],
  outputs: [output(62), output(65)], outputs_data: ['0x', '0x' + 'a1'.repeat(2)], witnesses: []
});
export const RISK_TRANSACTION = Object.freeze({
  version: '0x0', cell_deps: [], header_deps: [], inputs: [],
  outputs: [
    output(60),
    output(600, { ...lock, code_hash: '0x' + 'ef'.repeat(32) }),
    output(200)
  ],
  outputs_data: ['0x', '0x' + 'ab'.repeat(400), '0x'], witnesses: []
});
export const DEMO_POLICY = Object.freeze({
  ...DEFAULT_POLICY,
  allowedLockCodeHashes: [lock.code_hash]
});
