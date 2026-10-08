/** CKB occupied-capacity math; does not execute scripts or validate chain consensus. */
export const SHANNONS_PER_CKB = 100_000_000n;
export const MAX_U64 = (1n << 64n) - 1n;
export const SUPPORTED_HASH_TYPES = Object.freeze(['data', 'type', 'data1', 'data2']);

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseHexBytes(value, field = 'hex') {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${field}: cần chuỗi hex 0x với số chữ số chẵn`);
  }
  return (value.length - 2) / 2;
}
export function parseU64Hex(value, field = 'capacity') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) {
    throw new Error(`${field}: cần số nguyên u64 dạng hex (0x...)`);
  }
  const number = BigInt(value);
  if (number > MAX_U64) throw new Error(`${field}: vượt giới hạn u64`);
  return number;
}
export function parseCkbDecimal(value, field = 'amount') {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new Error(`${field}: số CKB phải là chuỗi thập phân không âm, tối đa 8 chữ số lẻ`);
  }
  const [whole, fractional = ''] = value.split('.');
  const result = BigInt(whole) * SHANNONS_PER_CKB + BigInt((fractional + '00000000').slice(0, 8));
  if (result > MAX_U64) throw new Error(`${field}: vượt giới hạn u64`);
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
export function validateScript(value, field) {
  if (!isRecord(value)) throw new Error(`${field}: script phải là object`);
  if (typeof value.code_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.code_hash)) {
    throw new Error(`${field}.code_hash: phải đúng 32 byte`);
  }
  if (!SUPPORTED_HASH_TYPES.includes(value.hash_type)) {
    throw new Error(`${field}.hash_type: không hợp lệ`);
  }
  const argsBytes = parseHexBytes(value.args, `${field}.args`);
  return Object.freeze({
    codeHash: value.code_hash.toLowerCase(),
    hashType: value.hash_type,
    argsBytes,
    scriptBytes: 33 + argsBytes
  });
}
export function parseTransaction(value) {
  if (!isRecord(value)) throw new Error('Transaction phải là JSON object');
  if (!Array.isArray(value.outputs) || !Array.isArray(value.outputs_data)) {
    throw new Error('Cần arrays outputs và outputs_data trong CKB raw transaction');
  }
  if (value.outputs.length !== value.outputs_data.length) {
    throw new Error('outputs và outputs_data phải có cùng số phần tử');
  }
  if (value.outputs.length === 0 || value.outputs.length > 512) {
    throw new Error('Demo yêu cầu 1–512 output');
  }
  const outputs = value.outputs.map((output, index) => {
    const field = `outputs[${index}]`;
    if (!isRecord(output)) throw new Error(`${field}: cần object`);
    const capacity = parseU64Hex(output.capacity, `${field}.capacity`);
    const lock = validateScript(output.lock, `${field}.lock`);
    const type = output.type === null || output.type === undefined ? null : validateScript(output.type, `${field}.type`);
    const dataBytes = parseHexBytes(value.outputs_data[index], `outputs_data[${index}]`);
    const occupiedBytes = 8 + lock.scriptBytes + (type?.scriptBytes || 0) + dataBytes;
    const occupied = BigInt(occupiedBytes) * SHANNONS_PER_CKB;
    return Object.freeze({ index, capacity, lock, type, dataBytes, occupiedBytes, occupied, free: capacity - occupied });
  });
  return Object.freeze({ outputs });
}
