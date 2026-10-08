import { isRecord, parseCkbDecimal, parseHexBytes, SUPPORTED_HASH_TYPES } from './ckb.mjs';

/** v1 remains compatible; v2 adds opt-in transaction-intent and strict shape rules. */
const REQUIRED_FIELDS = Object.freeze([
  'version', 'maxOutputs', 'maxDataBytesPerOutput', 'maxTotalDataBytes',
  'maxTotalOutputCapacityCKB', 'maxFreeCapacityCKBPerOutput',
  'allowedLockCodeHashes', 'allowedTypeCodeHashes', 'denyTypeScripts'
]);
export const DEFAULT_POLICY = Object.freeze({
  version: 1, maxOutputs: 20, maxDataBytesPerOutput: 256,
  maxTotalDataBytes: 2048, maxTotalOutputCapacityCKB: '1000',
  maxFreeCapacityCKBPerOutput: '25',
  allowedLockCodeHashes: [], allowedTypeCodeHashes: [],
  allowedLockScripts: [], allowedTypeScripts: [], denyTypeScripts: false
});
export const V2_POLICY = Object.freeze({
  ...DEFAULT_POLICY, version: 2, strictTransactionShape: true,
  minOutputs: 1, requireTypeScript: false,
  maxTypeScriptOutputs: 512, requireOutputDataEmpty: false,
  requireAllowedLock: false, maxTotalFreeCapacityCKB: null,
  requiredOutputs: []
});
function integerInRange(value, name, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${name}: cần số nguyên từ 0 đến ${max}`);
  }
  return value;
}
function boolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name}: expected boolean`);
  return value;
}
function hashes(value, name) {
  if (!Array.isArray(value) || value.length > 100 || !value.every(v => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v))) {
    throw new Error(`${name}: cần mảng tối đa 100 code_hash, mỗi hash 32 byte`);
  }
  return Object.freeze([...new Set(value.map(v => v.toLowerCase()))]);
}
function script(value, name) {
  if (!isRecord(value)) throw new Error(`${name}: expected a script object`);
  for (const key of Object.keys(value)) {
    if (!['code_hash', 'hash_type', 'args'].includes(key)) throw new Error(`${name}: unknown field "${key}"`);
  }
  if (typeof value.code_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.code_hash)) {
    throw new Error(`${name}.code_hash: expected 32-byte hex`);
  }
  if (!SUPPORTED_HASH_TYPES.includes(value.hash_type)) throw new Error(`${name}.hash_type: invalid hash type`);
  const count = parseHexBytes(value.args, `${name}.args`);
  if (count > 65536) throw new Error(`${name}.args: maximum 65536 bytes`);
  return Object.freeze({ codeHash: value.code_hash.toLowerCase(), hashType: value.hash_type, args: value.args.toLowerCase() });
}
function fullScripts(value, name) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${name}: expected an array of up to 100 scripts`);
  const scripts = value.map((item, index) => script(item, `${name}[${index}]`));
  const unique = new Map(scripts.map(item => [`${item.codeHash}|${item.hashType}|${item.args}`, item]));
  return Object.freeze([...unique.values()]);
}
function requiredOutputs(value) {
  if (!Array.isArray(value) || value.length > 32) throw new Error('requiredOutputs: expected at most 32 rules');
  return Object.freeze(value.map((item, i) => {
    const path = `requiredOutputs[${i}]`;
    if (!isRecord(item)) throw new Error(`${path}: expected object`);
    for (const key of Object.keys(item)) {
      if (!['lock', 'type', 'minCapacityCKB', 'maxCapacityCKB', 'minCount', 'maxCount'].includes(key)) {
        throw new Error(`${path}: unknown field "${key}"`);
      }
    }
    if (!Object.hasOwn(item, 'lock')) throw new Error(`${path}.lock is required`);
    const minCount = integerInRange(item.minCount ?? 1, `${path}.minCount`, 512);
    const maxCount = integerInRange(item.maxCount ?? 512, `${path}.maxCount`, 512);
    if (minCount > maxCount) throw new Error(`${path}: minCount > maxCount`);
    const minCapacity = parseCkbDecimal(item.minCapacityCKB ?? '0', `${path}.minCapacityCKB`);
    const maxCapacity = parseCkbDecimal(item.maxCapacityCKB ?? '184467440737.09551615', `${path}.maxCapacityCKB`);
    if (minCapacity > maxCapacity) throw new Error(`${path}: minCapacityCKB > maxCapacityCKB`);
    return Object.freeze({
      lock: script(item.lock, `${path}.lock`),
      type: Object.hasOwn(item, 'type') ? item.type === null ? null : script(item.type, `${path}.type`) : undefined,
      minCapacity, maxCapacity, minCount, maxCount
    });
  }));
}
export function parsePolicy(input) {
  if (!isRecord(input)) throw new Error('Policy phải là object');
  if (input.version !== 1 && input.version !== 2) throw new Error('Chỉ hỗ trợ policy version=1 hoặc version=2');
  for (const name of REQUIRED_FIELDS) {
    if (!Object.hasOwn(input, name)) throw new Error(`Policy thiếu trường ${name}`);
  }
  const v2 = input.version === 2;
  const defaults = v2 ? V2_POLICY : DEFAULT_POLICY;
  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(defaults, name)) throw new Error(`Policy unknown field: ${name}`);
  }
  const base = {
    version: input.version,
    maxOutputs: integerInRange(input.maxOutputs, 'maxOutputs', 512),
    maxDataBytesPerOutput: integerInRange(input.maxDataBytesPerOutput, 'maxDataBytesPerOutput', 1_000_000),
    maxTotalDataBytes: integerInRange(input.maxTotalDataBytes, 'maxTotalDataBytes', 1_000_000),
    maxTotalOutputCapacityCKB: parseCkbDecimal(input.maxTotalOutputCapacityCKB, 'maxTotalOutputCapacityCKB'),
    maxFreeCapacityCKBPerOutput: parseCkbDecimal(input.maxFreeCapacityCKBPerOutput, 'maxFreeCapacityCKBPerOutput'),
    allowedLockCodeHashes: hashes(input.allowedLockCodeHashes, 'allowedLockCodeHashes'),
    allowedTypeCodeHashes: hashes(input.allowedTypeCodeHashes, 'allowedTypeCodeHashes'),
    allowedLockScripts: fullScripts(input.allowedLockScripts ?? [], 'allowedLockScripts'),
    allowedTypeScripts: fullScripts(input.allowedTypeScripts ?? [], 'allowedTypeScripts'),
    denyTypeScripts: boolean(input.denyTypeScripts, 'denyTypeScripts')
  };
  if (!v2) return Object.freeze(base);
  const p = { ...V2_POLICY, ...input };
  const extension = {
    strictTransactionShape: boolean(p.strictTransactionShape, 'strictTransactionShape'),
    minOutputs: integerInRange(p.minOutputs, 'minOutputs', 512),
    requireTypeScript: boolean(p.requireTypeScript, 'requireTypeScript'),
    maxTypeScriptOutputs: integerInRange(p.maxTypeScriptOutputs, 'maxTypeScriptOutputs', 512),
    requireOutputDataEmpty: boolean(p.requireOutputDataEmpty, 'requireOutputDataEmpty'),
    requireAllowedLock: boolean(p.requireAllowedLock, 'requireAllowedLock'),
    maxTotalFreeCapacityCKB: p.maxTotalFreeCapacityCKB === null ? null : parseCkbDecimal(p.maxTotalFreeCapacityCKB, 'maxTotalFreeCapacityCKB'),
    requiredOutputs: requiredOutputs(p.requiredOutputs)
  };
  if (base.denyTypeScripts && extension.requireTypeScript) throw new Error('denyTypeScripts conflicts with requireTypeScript');
  if (extension.minOutputs > base.maxOutputs) throw new Error('minOutputs > maxOutputs');
  if (extension.requireAllowedLock && !base.allowedLockScripts.length && !base.allowedLockCodeHashes.length) {
    throw new Error('requireAllowedLock requires a nonempty lock allowlist');
  }
  return Object.freeze({ ...base, ...extension });
}
