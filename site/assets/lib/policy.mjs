import { isRecord, parseCkbDecimal, parseHexBytes, SUPPORTED_HASH_TYPES } from './ckb.mjs';

/** v1 policy: old code-hash-only lists remain supported; complete script rules are opt-in. */
const REQUIRED_FIELDS = Object.freeze([
  'version', 'maxOutputs', 'maxDataBytesPerOutput', 'maxTotalDataBytes',
  'maxTotalOutputCapacityCKB', 'maxFreeCapacityCKBPerOutput',
  'allowedLockCodeHashes', 'allowedTypeCodeHashes', 'denyTypeScripts'
]);

export const DEFAULT_POLICY = Object.freeze({
  version: 1,
  maxOutputs: 20,
  maxDataBytesPerOutput: 256,
  maxTotalDataBytes: 2048,
  maxTotalOutputCapacityCKB: '1000',
  maxFreeCapacityCKBPerOutput: '25',
  allowedLockCodeHashes: [],
  allowedTypeCodeHashes: [],
  // Exact script matches require code_hash, hash_type AND args.
  allowedLockScripts: [],
  allowedTypeScripts: [],
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
  return Object.freeze([...new Set(value.map(v => v.toLowerCase()))]);
}
function fullScripts(value, name) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${name}: expected an array of up to 100 scripts`);
  }
  const scripts = value.map((item, index) => {
    const field = `${name}[${index}]`;
    if (!isRecord(item)) throw new Error(`${field}: expected a script object`);
    for (const key of Object.keys(item)) {
      if (!['code_hash', 'hash_type', 'args'].includes(key)) {
        throw new Error(`${field}: unknown field "${key}"`);
      }
    }
    if (typeof item.code_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(item.code_hash)) {
      throw new Error(`${field}.code_hash: expected 32-byte hex`);
    }
    if (!SUPPORTED_HASH_TYPES.includes(item.hash_type)) {
      throw new Error(`${field}.hash_type: invalid hash type`);
    }
    const count = parseHexBytes(item.args, `${field}.args`);
    if (count > 65536) throw new Error(`${field}.args: maximum 65536 bytes`);
    return Object.freeze({ codeHash: item.code_hash.toLowerCase(), hashType: item.hash_type, args: item.args.toLowerCase() });
  });
  const unique = new Map(scripts.map(item => [`${item.codeHash}|${item.hashType}|${item.args}`, item]));
  return Object.freeze([...unique.values()]);
}

export function parsePolicy(input) {
  if (!isRecord(input)) throw new Error('Policy phải là object');
  if (input.version !== 1) throw new Error('Chỉ hỗ trợ policy version=1');
  for (const name of REQUIRED_FIELDS) {
    if (!Object.hasOwn(input, name)) throw new Error(`Policy thiếu trường ${name}`);
  }
  // Fail closed: a typo must not silently disable an application safety rule.
  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_POLICY, name)) throw new Error(`Policy unknown field: ${name}`);
  }
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
    allowedLockScripts: fullScripts(input.allowedLockScripts ?? [], 'allowedLockScripts'),
    allowedTypeScripts: fullScripts(input.allowedTypeScripts ?? [], 'allowedTypeScripts'),
    denyTypeScripts: input.denyTypeScripts
  });
}
