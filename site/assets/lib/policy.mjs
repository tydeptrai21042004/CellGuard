import { isRecord, parseCkbDecimal } from './ckb.mjs';

export const DEFAULT_POLICY = Object.freeze({
  version: 1,
  maxOutputs: 20,
  maxDataBytesPerOutput: 256,
  maxTotalDataBytes: 2048,
  maxTotalOutputCapacityCKB: '1000',
  maxFreeCapacityCKBPerOutput: '25',
  allowedLockCodeHashes: [],
  allowedTypeCodeHashes: [],
  denyTypeScripts: false
});

function integerInRange(value, name, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${name}: cần số nguyên từ 0 đến ${max}`);
  }
  return value;
}
function hashes(value, name) {
  if (!Array.isArray(value) || value.length > 100 || !value.every(v => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v))) {
    throw new Error(`${name}: cần mảng tối đa 100 code_hash, mỗi hash 32 byte`);
  }
  return [...new Set(value.map(v => v.toLowerCase()))];
}
export function parsePolicy(input) {
  if (!isRecord(input)) throw new Error('Policy phải là object');
  if (input.version !== 1) throw new Error('Chỉ hỗ trợ policy version=1');
  const required = Object.keys(DEFAULT_POLICY);
  for (const name of required) if (!Object.hasOwn(input, name)) throw new Error(`Policy thiếu trường ${name}`);
  if (typeof input.denyTypeScripts !== 'boolean') throw new Error('denyTypeScripts phải là boolean');
  return Object.freeze({
    version: 1,
    maxOutputs: integerInRange(input.maxOutputs, 'maxOutputs', 512),
    maxDataBytesPerOutput: integerInRange(input.maxDataBytesPerOutput, 'maxDataBytesPerOutput', 1_000_000),
    maxTotalDataBytes: integerInRange(input.maxTotalDataBytes, 'maxTotalDataBytes', 1_000_000),
    maxTotalOutputCapacityCKB: parseCkbDecimal(input.maxTotalOutputCapacityCKB, 'maxTotalOutputCapacityCKB'),
    maxFreeCapacityCKBPerOutput: parseCkbDecimal(input.maxFreeCapacityCKBPerOutput, 'maxFreeCapacityCKBPerOutput'),
    allowedLockCodeHashes: hashes(input.allowedLockCodeHashes, 'allowedLockCodeHashes'),
    allowedTypeCodeHashes: hashes(input.allowedTypeCodeHashes, 'allowedTypeCodeHashes'),
    denyTypeScripts: input.denyTypeScripts
  });
}
