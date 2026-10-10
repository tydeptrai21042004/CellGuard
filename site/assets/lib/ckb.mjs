/** CKB occupied-capacity math; does not execute scripts or validate chain consensus. */
export const SHANNONS_PER_CKB = 100_000_000n;
export const MAX_U64 = (1n << 64n) - 1n;
export const SUPPORTED_HASH_TYPES = Object.freeze(['data', 'type', 'data1', 'data2']);

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseHexBytes(value, field = 'hex') {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${field}: expected 0x-prefixed hex string with an even number of digits`);
  }
  return (value.length - 2) / 2;
}
export function parseU64Hex(value, field = 'capacity') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) {
    throw new Error(`${field}: expected u64 hexadecimal integer (0x...)`);
  }
  const number = BigInt(value);
  if (number > MAX_U64) throw new Error(`${field}: exceeds u64 maximum`);
  return number;
}
export function parseCkbDecimal(value, field = 'amount') {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new Error(`${field}: expected nonnegative decimal CKB string with up to 8 fractional digits`);
  }
  const [whole, fractional = ''] = value.split('.');
  const result = BigInt(whole) * SHANNONS_PER_CKB + BigInt((fractional + '00000000').slice(0, 8));
  if (result > MAX_U64) throw new Error(`${field}: exceeds u64 maximum`);
  return result;
}
export function formatCkb(value) {
  if (typeof value !== 'bigint') throw new Error('formatCkb requires bigint');
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / SHANNONS_PER_CKB;
  const rest = (abs % SHANNONS_PER_CKB).toString().padStart(8, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${rest ? '.' + rest : ''}`;
}
function unknownProperties(value, allowed, field, strict, ignored) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      if (strict) throw new Error(`${field}: unsupported field "${key}"`);
      ignored.push(`${field}.${key}`);
    }
  }
}
function parseU32Hex(value, field) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(value)) {
    throw new Error(`${field}: expected u32 hex`);
  }
  return Number(BigInt(value));
}
function parseOutPoint(value, field, ignored) {
  if (!isRecord(value)) throw new Error(`${field}: expected out_point object`);
  unknownProperties(value, ['tx_hash', 'index'], field, true, ignored);
  if (typeof value.tx_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.tx_hash)) {
    throw new Error(`${field}.tx_hash: expected 32-byte hex`);
  }
  const index = parseU32Hex(value.index, `${field}.index`);
  return `${value.tx_hash.toLowerCase()}:${index}`;
}
export function validateScript(value, field, options = {}) {
  if (!isRecord(value)) throw new Error(`${field}: script must be an object`);
  if (typeof value.code_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.code_hash)) {
    throw new Error(`${field}.code_hash: expected exactly 32 bytes`);
  }
  if (!SUPPORTED_HASH_TYPES.includes(value.hash_type)) {
    throw new Error(`${field}.hash_type: invalid hash type`);
  }
  const ignored = options.ignored ?? [];
  unknownProperties(value, ['code_hash', 'hash_type', 'args'], field, options.strict === true, ignored);
  const argsBytes = parseHexBytes(value.args, `${field}.args`);
  if (argsBytes > 65536) throw new Error(`${field}.args: maximum 65536 bytes`);
  return Object.freeze({
    codeHash: value.code_hash.toLowerCase(),
    hashType: value.hash_type,
    args: value.args.toLowerCase(),
    argsBytes,
    scriptBytes: 33 + argsBytes
  });
}
export function parseTransaction(value, options = {}) {
  const strict = options.strict === true;
  const ignoredFields = [];
  if (isRecord(value)) {
    unknownProperties(value, ['version', 'cell_deps', 'header_deps', 'inputs', 'outputs', 'outputs_data', 'witnesses'], 'transaction', strict, ignoredFields);
  }
  if (!isRecord(value)) throw new Error('Transaction must be a JSON object');
  if (!Array.isArray(value.outputs) || !Array.isArray(value.outputs_data)) {
    throw new Error('CKB transaction requires outputs and outputs_data arrays');
  }
  if (value.outputs.length !== value.outputs_data.length) {
    throw new Error('outputs and outputs_data must have equal lengths');
  }
  if (value.outputs.length === 0 || value.outputs.length > 512) {
    throw new Error('Expected 1–512 outputs');
  }
  if (strict) {
    for (const field of ['version', 'cell_deps', 'header_deps', 'inputs', 'witnesses']) {
      if (!Object.hasOwn(value, field)) throw new Error(`transaction.${field}: required for strict transaction shape`);
    }
    parseU32Hex(value.version, 'transaction.version');
    if (!Array.isArray(value.inputs) || value.inputs.length > 4096) throw new Error('transaction.inputs: expected up to 4096 inputs');
    if (!Array.isArray(value.cell_deps) || value.cell_deps.length > 4096) throw new Error('transaction.cell_deps: expected up to 4096 deps');
    if (!Array.isArray(value.header_deps) || value.header_deps.length > 4096) throw new Error('transaction.header_deps: expected up to 4096 hashes');
    if (!Array.isArray(value.witnesses) || value.witnesses.length > 4096) throw new Error('transaction.witnesses: expected up to 4096 witnesses');
    const seenInputs = new Set();
    for (const [i, input] of value.inputs.entries()) {
      if (!isRecord(input)) throw new Error(`inputs[${i}]: expected object`);
      unknownProperties(input, ['since', 'previous_output'], `inputs[${i}]`, true, ignoredFields);
      parseU64Hex(input.since, `inputs[${i}].since`);
      const point = parseOutPoint(input.previous_output, `inputs[${i}].previous_output`, ignoredFields);
      if (seenInputs.has(point)) throw new Error(`inputs[${i}]: duplicate previous_output`);
      seenInputs.add(point);
    }
    const seenDeps = new Set();
    for (const [i, dep] of value.cell_deps.entries()) {
      if (!isRecord(dep)) throw new Error(`cell_deps[${i}]: expected object`);
      unknownProperties(dep, ['out_point', 'dep_type'], `cell_deps[${i}]`, true, ignoredFields);
      if (!['code', 'dep_group'].includes(dep.dep_type)) throw new Error(`cell_deps[${i}].dep_type: invalid value`);
      const point = parseOutPoint(dep.out_point, `cell_deps[${i}].out_point`, ignoredFields);
      if (seenDeps.has(point)) throw new Error(`cell_deps[${i}]: duplicate out_point`);
      seenDeps.add(point);
    }
    for (const [i, h] of value.header_deps.entries()) {
      if (typeof h !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`header_deps[${i}]: expected 32-byte hex`);
    }
    for (const [i, w] of value.witnesses.entries()) parseHexBytes(w, `witnesses[${i}]`);
  }
  const outputs = value.outputs.map((output, index) => {
    const field = `outputs[${index}]`;
    if (!isRecord(output)) throw new Error(`${field}: expected object`);
    unknownProperties(output, ['capacity', 'lock', 'type'], field, strict, ignoredFields);
    const capacity = parseU64Hex(output.capacity, `${field}.capacity`);
    const lock = validateScript(output.lock, `${field}.lock`, { strict, ignored: ignoredFields });
    const type = output.type === null || output.type === undefined ? null : validateScript(output.type, `${field}.type`, { strict, ignored: ignoredFields });
    const dataBytes = parseHexBytes(value.outputs_data[index], `outputs_data[${index}]`);
    const occupiedBytes = 8 + lock.scriptBytes + (type?.scriptBytes || 0) + dataBytes;
    const occupied = BigInt(occupiedBytes) * SHANNONS_PER_CKB;
    return Object.freeze({ index, capacity, lock, type, dataBytes, occupiedBytes, occupied, free: capacity - occupied });
  });
  return Object.freeze({ outputs, ignoredFields: Object.freeze(ignoredFields) });
}
