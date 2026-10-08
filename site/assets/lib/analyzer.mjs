import { formatCkb, parseTransaction } from './ckb.mjs';
import { parsePolicy } from './policy.mjs';

/** Pure, deterministic offline evaluator. No wallet, RPC or contract execution. */
export function analyzeTransaction(txInput, policyInput) {
  const tx = parseTransaction(txInput);
  const policy = parsePolicy(policyInput);
  const findings = [];
  const push = (code, severity, path, detail) => findings.push({ code, severity, path, detail });
  if (tx.outputs.length > policy.maxOutputs) {
    push('POLICY_MAX_OUTPUTS', 'error', 'outputs', `${tx.outputs.length} outputs > giới hạn ${policy.maxOutputs}`);
  }
  let totalCapacity = 0n;
  let totalDataBytes = 0;
  const outputDetails = [];
  for (const output of tx.outputs) {
    const path = `outputs[${output.index}]`;
    totalCapacity += output.capacity;
    totalDataBytes += output.dataBytes;
    if (output.capacity < output.occupied) {
      push('CAPACITY_INSUFFICIENT', 'error', path, `Capacity ${formatCkb(output.capacity)} CKB < mức chiếm dụng ${formatCkb(output.occupied)} CKB`);
    }
    if (output.dataBytes > policy.maxDataBytesPerOutput) {
      push('POLICY_DATA_TOO_LARGE', 'error', `${path}.data`, `${output.dataBytes} bytes > giới hạn ${policy.maxDataBytesPerOutput}`);
    }
    if (output.free > policy.maxFreeCapacityCKBPerOutput) {
      push('POLICY_EXCESS_CAPACITY', 'warning', `${path}.capacity`, `Capacity chưa chiếm dụng ${formatCkb(output.free)} CKB > ngưỡng ${formatCkb(policy.maxFreeCapacityCKBPerOutput)} CKB`);
    }
    if (policy.allowedLockCodeHashes.length && !policy.allowedLockCodeHashes.includes(output.lock.codeHash)) {
      push('POLICY_LOCK_NOT_ALLOWED', 'error', `${path}.lock.code_hash`, 'Lock code_hash không nằm trong allowlist của ứng dụng');
    }
    if (output.type && policy.denyTypeScripts) {
      push('POLICY_TYPE_FORBIDDEN', 'error', `${path}.type`, 'Ứng dụng không cho phép type script trong output');
    }
    if (output.type && policy.allowedTypeCodeHashes.length && !policy.allowedTypeCodeHashes.includes(output.type.codeHash)) {
      push('POLICY_TYPE_NOT_ALLOWED', 'error', `${path}.type.code_hash`, 'Type code_hash không nằm trong allowlist của ứng dụng');
    }
    outputDetails.push({
      index: output.index,
      capacityCKB: formatCkb(output.capacity),
      occupiedCKB: formatCkb(output.occupied),
      freeCKB: formatCkb(output.free),
      dataBytes: output.dataBytes,
      lockCodeHash: output.lock.codeHash,
      typeCodeHash: output.type?.codeHash ?? null
    });
  }
  if (totalDataBytes > policy.maxTotalDataBytes) {
    push('POLICY_TOTAL_DATA_TOO_LARGE', 'error', 'outputs_data', `${totalDataBytes} bytes > giới hạn ${policy.maxTotalDataBytes}`);
  }
  if (totalCapacity > policy.maxTotalOutputCapacityCKB) {
    push('POLICY_TOTAL_CAPACITY', 'error', 'outputs', `Tổng output ${formatCkb(totalCapacity)} CKB > ngân sách ${formatCkb(policy.maxTotalOutputCapacityCKB)} CKB`);
  }
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  return {
    schemaVersion: 1,
    result: errors ? 'policy-failed' : warnings ? 'review-needed' : 'checks-passed',
    errorCount: errors,
    warningCount: warnings,
    outputCount: tx.outputs.length,
    totalDataBytes,
    totalCapacityCKB: formatCkb(totalCapacity),
    findings,
    outputs: outputDetails,
    disclaimer: 'Đây chỉ là kiểm tra cấu trúc và policy offline. Không chạy CKB-VM, không xác nhận input/fee/witness, không đảm bảo transaction hợp lệ hoặc an toàn trên chain.'
  };
}
