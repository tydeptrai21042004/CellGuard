import { isRecord, parseCkbDecimal, parseHexBytes, parseU64Hex, SUPPORTED_HASH_TYPES } from './ckb.mjs';

/** v1/v2 remain compatible; v3 adds application-level capacity invariants. */
const REQUIRED_FIELDS = Object.freeze([
  'version', 'maxOutputs', 'maxDataBytesPerOutput', 'maxTotalDataBytes',
  'maxTotalOutputCapacityCKB', 'maxFreeCapacityCKBPerOutput',
  'allowedLockCodeHashes', 'allowedTypeCodeHashes', 'denyTypeScripts'
]);
export const DEFAULT_POLICY = Object.freeze({
  version: 1, maxOutputs: 20, maxDataBytesPerOutput: 256,
  maxTotalDataBytes: 2048, maxTotalOutputCapacityCKB: null,
  maxFreeCapacityCKBPerOutput: null,
  allowedLockCodeHashes: [], allowedTypeCodeHashes: [],
  allowedLockScripts: [], allowedTypeScripts: [], denyTypeScripts: false
});
export const V2_POLICY = Object.freeze({
  ...DEFAULT_POLICY, version: 2, strictTransactionShape: true,
  minOutputs: 1, requireTypeScript: false,
  maxTypeScriptOutputs: 512, requireOutputDataEmpty: false,
  requireAllowedLock: false, maxTotalFreeCapacityCKB: null,
  requiredOutputs: [], requiredCellDeps: []
});
export const V3_POLICY = Object.freeze({
  ...V2_POLICY, version: 3, maxTotalOutputCapacityCKB: null, maxFreeCapacityCKBPerOutput: null,
  profile: 'generic', roles: {}, allowedInputRoles: [], allowedOutputRoles: [],
  capacityFlow: [], sinceRules: [], maxFeeCKB: null
});
function integerInRange(value, name, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${name}: expected integer from 0 to ${max}`);
  }
  return value;
}
function boolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name}: expected boolean`);
  return value;
}
function hashes(value, name) {
  if (!Array.isArray(value) || value.length > 100 || !value.every(v => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v))) {
    throw new Error(`${name}: expected at most 100 32-byte code_hash values`);
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
function requiredCellDeps(value) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('requiredCellDeps: expected up to 64 entries');
  return Object.freeze(value.map((dep, i) => {
    if (!isRecord(dep) || Object.keys(dep).some(key => !['out_point', 'dep_type'].includes(key))) throw new Error(`requiredCellDeps[${i}]: invalid dependency`);
    if (!isRecord(dep.out_point) || Object.keys(dep.out_point).some(key => !['tx_hash','index'].includes(key))) throw new Error(`requiredCellDeps[${i}].out_point: invalid outpoint`);
    const { tx_hash, index } = dep.out_point;
    if (typeof tx_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash) || typeof index !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(index) || BigInt(index) > 0xffffffffn) throw new Error(`requiredCellDeps[${i}]: invalid outpoint`);
    if (!['code','dep_group'].includes(dep.dep_type)) throw new Error(`requiredCellDeps[${i}].dep_type: invalid type`);
    return Object.freeze({ outPoint: `${tx_hash.toLowerCase()}:${BigInt(index)}`, depType: dep.dep_type });
  }));
}
function roleName(v, field) {
  if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(v)) throw new Error(`${field}: invalid role name`);
  return v;
}
function parseRoles(value) {
  if (!isRecord(value) || Object.keys(value).length > 32) throw new Error('roles: expected an object with no more than 32 roles');
  const result = Object.create(null), fingerprints = new Set();
  for (const [name, raw] of Object.entries(value)) {
    roleName(name, `roles.${name}`);
    const normalized = script(raw, `roles.${name}`);
    const key = `${normalized.codeHash}:${normalized.hashType}:${normalized.args}`;
    if (fingerprints.has(key)) throw new Error(`roles.${name}: a lock script cannot belong to multiple roles`);
    fingerprints.add(key); result[name] = normalized;
  }
  return Object.freeze(result);
}
function roleList(value, field, roles) {
  if (!Array.isArray(value) || value.length > 32) throw new Error(`${field}: expected an array of role names`);
  return Object.freeze([...new Set(value.map((x, i) => {
    roleName(x, `${field}[${i}]`);
    if (!Object.hasOwn(roles, x)) throw new Error(`${field}[${i}]: undefined role ${x}`);
    return x;
  }))]);
}
function capacityRules(value, roles) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('capacityFlow: expected at most 100 rules');
  const ids = new Set();
  return Object.freeze(value.map((r, i) => {
    const path = `capacityFlow[${i}]`;
    if (!isRecord(r) || !['max-net-gain','min-recipient-net-gain'].includes(r.kind)) throw new Error(`${path}: invalid rule kind`);
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || ids.has(r.id)) throw new Error(`${path}.id: invalid or duplicate id`);
    ids.add(r.id);
    const known = r.kind === 'max-net-gain' ? ['id','kind','role','maxGainCKB'] : ['id','kind','source','destinations','minRatio','feeAllowanceCKB','minSourceInputCKB'];
    if (Object.keys(r).some(k => !known.includes(k))) throw new Error(`${path}: unknown field`);
    if (r.kind === 'max-net-gain') {
      const [role] = roleList([r.role], `${path}.role`, roles);
      return Object.freeze({ id: r.id, kind: r.kind, role, maxGain: parseCkbDecimal(r.maxGainCKB ?? '0', `${path}.maxGainCKB`) });
    }
    const [source] = roleList([r.source], `${path}.source`, roles);
    const destinations = roleList(r.destinations, `${path}.destinations`, roles);
    if (!destinations.length || destinations.includes(source)) throw new Error(`${path}: source and destinations must be distinct`);
    const ratio = r.minRatio ?? '1';
    if (typeof ratio !== 'string' || !/^(?:0(?:\.[0-9]{1,8})?|1(?:\.0{1,8})?)$/.test(ratio)) throw new Error(`${path}.minRatio: expected decimal between 0 and 1`);
    const [whole, fraction=''] = ratio.split('.');
    const numerator = BigInt(whole)*100000000n + BigInt((fraction + '00000000').slice(0,8));
    return Object.freeze({ id: r.id, kind: r.kind, source, destinations, numerator, denominator: 100000000n,
      feeAllowance: parseCkbDecimal(r.feeAllowanceCKB ?? '0', `${path}.feeAllowanceCKB`),
      minSourceInput: parseCkbDecimal(r.minSourceInputCKB ?? '0', `${path}.minSourceInputCKB`) });
  }));
}
function sinceRules(value, roles) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('sinceRules: expected at most 64 rules');
  return Object.freeze(value.map((rule, i) => {
    const path = `sinceRules[${i}]`;
    if (!isRecord(rule) || Object.keys(rule).some(k => !['id','role','operator','value','requireMatch'].includes(k))) throw new Error(`${path}: invalid rule`);
    const [role] = roleList([rule.role], `${path}.role`, roles);
    if (!['exact','at-least'].includes(rule.operator)) throw new Error(`${path}.operator: expected exact or at-least`);
    if (typeof rule.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(rule.id)) throw new Error(`${path}.id: invalid id`);
    const n = parseU64Hex(rule.value, `${path}.value`);
    const metric = Number((n >> 61n) & 3n);
    if (metric === 3 || (n & 0x1f00000000000000n) !== 0n) throw new Error(`${path}.value: invalid since flags`);
    let since = { n, flag: n & 0xff00000000000000n, metric, value: n & ((1n << 56n)-1n) };
    if (metric === 1) {
      const epoch = n & 0xffffffn, index = (n >> 24n) & 0xffffn, rawLength = (n >> 40n) & 0xffffn;
      const length = rawLength === 0n && index === 0n ? 1n : rawLength;
      if (!length || index >= length) throw new Error(`${path}.value: invalid epoch fraction`);
      since = { ...since, epoch, index, length };
    }
    return Object.freeze({ id: rule.id, role, operator: rule.operator, since, requireMatch: rule.requireMatch === undefined ? true : boolean(rule.requireMatch, `${path}.requireMatch`) });
  }));
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
  if (!isRecord(input)) throw new Error('Policy must be an object');
  if (![1,2,3].includes(input.version)) throw new Error('Policy version must be 1, 2 or 3');
  for (const name of REQUIRED_FIELDS) {
    if (!Object.hasOwn(input, name) && input.version !== 3) throw new Error(`Policy missing field ${name}`);
  }
  const extended = input.version >= 2;
  const defaults = input.version === 3 ? V3_POLICY : extended ? V2_POLICY : DEFAULT_POLICY;
  const p = { ...defaults, ...input };
  for (const name of Object.keys(input)) {
    if (!Object.hasOwn(defaults, name)) throw new Error(`Policy unknown field: ${name}`);
  }
  const base = {
    version: input.version,
    maxOutputs: integerInRange(p.maxOutputs, 'maxOutputs', 512),
    maxDataBytesPerOutput: integerInRange(p.maxDataBytesPerOutput, 'maxDataBytesPerOutput', 1_000_000),
    maxTotalDataBytes: integerInRange(p.maxTotalDataBytes, 'maxTotalDataBytes', 1_000_000),
    maxTotalOutputCapacityCKB: p.maxTotalOutputCapacityCKB === null ? null : parseCkbDecimal(p.maxTotalOutputCapacityCKB, 'maxTotalOutputCapacityCKB'),
    maxFreeCapacityCKBPerOutput: p.maxFreeCapacityCKBPerOutput === null ? null : parseCkbDecimal(p.maxFreeCapacityCKBPerOutput, 'maxFreeCapacityCKBPerOutput'),
    allowedLockCodeHashes: hashes(p.allowedLockCodeHashes, 'allowedLockCodeHashes'),
    allowedTypeCodeHashes: hashes(p.allowedTypeCodeHashes, 'allowedTypeCodeHashes'),
    allowedLockScripts: fullScripts(p.allowedLockScripts ?? [], 'allowedLockScripts'),
    allowedTypeScripts: fullScripts(p.allowedTypeScripts ?? [], 'allowedTypeScripts'),
    denyTypeScripts: boolean(p.denyTypeScripts, 'denyTypeScripts')
  };
  if (!extended) return Object.freeze(base);
  const extension = {
    strictTransactionShape: boolean(p.strictTransactionShape, 'strictTransactionShape'),
    minOutputs: integerInRange(p.minOutputs, 'minOutputs', 512),
    requireTypeScript: boolean(p.requireTypeScript, 'requireTypeScript'),
    maxTypeScriptOutputs: integerInRange(p.maxTypeScriptOutputs, 'maxTypeScriptOutputs', 512),
    requireOutputDataEmpty: boolean(p.requireOutputDataEmpty, 'requireOutputDataEmpty'),
    requireAllowedLock: boolean(p.requireAllowedLock, 'requireAllowedLock'),
    maxTotalFreeCapacityCKB: p.maxTotalFreeCapacityCKB === null ? null : parseCkbDecimal(p.maxTotalFreeCapacityCKB, 'maxTotalFreeCapacityCKB'),
    requiredOutputs: requiredOutputs(p.requiredOutputs),
    requiredCellDeps: requiredCellDeps(p.requiredCellDeps)
  };
  if (base.denyTypeScripts && extension.requireTypeScript) throw new Error('denyTypeScripts conflicts with requireTypeScript');
  if (extension.minOutputs > base.maxOutputs) throw new Error('minOutputs > maxOutputs');
  if (extension.requireAllowedLock && !base.allowedLockScripts.length && !base.allowedLockCodeHashes.length) {
    throw new Error('requireAllowedLock requires a nonempty lock allowlist');
  }
  if (input.version !== 3) return Object.freeze({ ...base, ...extension });
  if (typeof p.profile !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.profile)) throw new Error('profile: invalid name');
  const roles = parseRoles(p.roles);
  return Object.freeze({ ...base, ...extension, profile: p.profile, roles,
    allowedInputRoles: roleList(p.allowedInputRoles, 'allowedInputRoles', roles),
    allowedOutputRoles: roleList(p.allowedOutputRoles, 'allowedOutputRoles', roles),
    capacityFlow: capacityRules(p.capacityFlow, roles), sinceRules: sinceRules(p.sinceRules, roles),
    maxFee: p.maxFeeCKB === null ? null : parseCkbDecimal(p.maxFeeCKB, 'maxFeeCKB') });
}
