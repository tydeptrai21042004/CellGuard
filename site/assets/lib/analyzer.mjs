import { formatCkb, parseTransaction } from './ckb.mjs';
import { parsePolicy } from './policy.mjs';

function matchesExactScript(script, rules) {
  return rules.some(rule => rule.codeHash === script.codeHash && rule.hashType === script.hashType && rule.args === script.args);
}

/** Pure, deterministic offline evaluator. No wallet, RPC, or contract execution. */
export function analyzeTransaction(txInput, policyInput) {
  const policy = parsePolicy(policyInput);
  const tx = parseTransaction(txInput, { strict: policy.strictTransactionShape === true });
  const findings = [];
  const push = (code, severity, path, detail) => findings.push({ code, severity, path, detail });
  if (tx.ignoredFields.length) {
    push('TRANSACTION_UNCHECKED_FIELDS', 'warning', tx.ignoredFields[0],
      `${tx.ignoredFields.length} unsupported field(s) ignored: ${tx.ignoredFields.slice(0, 8).join(', ')}${tx.ignoredFields.length > 8 ? ', …' : ''}. Enable policy v2 strictTransactionShape to reject them.`);
  }
  if (policy.version === 2 && tx.outputs.length < policy.minOutputs) {
    push('POLICY_MIN_OUTPUTS', 'error', 'outputs', `${tx.outputs.length} outputs < required ${policy.minOutputs}`);
  }
  if (tx.outputs.length > policy.maxOutputs) {
    push('POLICY_MAX_OUTPUTS', 'error', 'outputs', `${tx.outputs.length} outputs > giới hạn ${policy.maxOutputs}`);
  }
  let totalCapacity = 0n;
  let totalDataBytes = 0;
  let totalFreeCapacity = 0n;
  let typeScriptCount = 0;
  const outputDetails = [];
  for (const output of tx.outputs) {
    const path = `outputs[${output.index}]`;
    totalCapacity += output.capacity;
    totalDataBytes += output.dataBytes;
    if (output.free > 0n) totalFreeCapacity += output.free;
    if (output.type) typeScriptCount++;
    if (policy.requireTypeScript && !output.type) {
      push('POLICY_TYPE_REQUIRED', 'error', `${path}.type`, 'Type script required for every output');
    }
    if (policy.requireOutputDataEmpty && output.dataBytes) {
      push('POLICY_OUTPUT_DATA_FORBIDDEN', 'error', `outputs_data[${output.index}]`, 'Output data must be empty');
    }
    if (output.capacity < output.occupied) {
      push('CAPACITY_INSUFFICIENT', 'error', path, `Capacity ${formatCkb(output.capacity)} CKB < mức chiếm dụng ${formatCkb(output.occupied)} CKB`);
    }
    if (output.dataBytes > policy.maxDataBytesPerOutput) {
      push('POLICY_DATA_TOO_LARGE', 'error', `${path}.data`, `${output.dataBytes} bytes > giới hạn ${policy.maxDataBytesPerOutput}`);
    }
    if (policy.maxFreeCapacityCKBPerOutput !== null && output.free > policy.maxFreeCapacityCKBPerOutput) {
      push('POLICY_EXCESS_CAPACITY', 'warning', `${path}.capacity`, `Capacity chưa chiếm dụng ${formatCkb(output.free)} CKB > ngưỡng ${formatCkb(policy.maxFreeCapacityCKBPerOutput)} CKB`);
    }
    if (policy.allowedLockCodeHashes.length && !policy.allowedLockCodeHashes.includes(output.lock.codeHash)) {
      push('POLICY_LOCK_NOT_ALLOWED', 'error', `${path}.lock.code_hash`, 'Lock code_hash không nằm trong allowlist của ứng dụng');
    }
    if (policy.allowedLockScripts.length && !matchesExactScript(output.lock, policy.allowedLockScripts)) {
      push('POLICY_LOCK_SCRIPT_NOT_ALLOWED', 'error', `${path}.lock`, 'Lock script không khớp đầy đủ code_hash + hash_type + args');
    }
    if (output.type && policy.denyTypeScripts) {
      push('POLICY_TYPE_FORBIDDEN', 'error', `${path}.type`, 'Ứng dụng không cho phép type script trong output');
    }
    if (output.type && policy.allowedTypeCodeHashes.length && !policy.allowedTypeCodeHashes.includes(output.type.codeHash)) {
      push('POLICY_TYPE_NOT_ALLOWED', 'error', `${path}.type.code_hash`, 'Type code_hash không nằm trong allowlist của ứng dụng');
    }
    if (output.type && policy.allowedTypeScripts.length && !matchesExactScript(output.type, policy.allowedTypeScripts)) {
      push('POLICY_TYPE_SCRIPT_NOT_ALLOWED', 'error', `${path}.type`, 'Type script không khớp đầy đủ code_hash + hash_type + args');
    }
    outputDetails.push({
      index: output.index,
      capacityCKB: formatCkb(output.capacity),
      occupiedCKB: formatCkb(output.occupied),
      freeCKB: formatCkb(output.free),
      dataBytes: output.dataBytes,
      lockCodeHash: output.lock.codeHash,
      lockHashType: output.lock.hashType,
      lockArgs: output.lock.args,
      typeCodeHash: output.type?.codeHash ?? null,
      typeHashType: output.type?.hashType ?? null,
      typeArgs: output.type?.args ?? null
    });
  }
  if (policy.version === 2) {
    if (policy.requiredCellDeps.length) {
      if (!Array.isArray(txInput.cell_deps)) push('POLICY_CELL_DEPS_UNAVAILABLE', 'error', 'cell_deps', 'A full transaction with cell_deps is required to evaluate dependency rules');
      else for (const [i, dep] of policy.requiredCellDeps.entries()) {
        const found = txInput.cell_deps.some(candidate => candidate && candidate.out_point &&
          typeof candidate.out_point.tx_hash === 'string' && typeof candidate.out_point.index === 'string' &&
          candidate.out_point.tx_hash.toLowerCase() + ':' + String(BigInt(candidate.out_point.index)) === dep.outPoint && candidate.dep_type === dep.depType);
        if (!found) push('POLICY_REQUIRED_CELL_DEP', 'error', `requiredCellDeps[${i}]`, `Required ${dep.depType} dependency ${dep.outPoint} is absent`);
      }
    }
    if (typeScriptCount > policy.maxTypeScriptOutputs) {
      push('POLICY_MAX_TYPE_SCRIPTS', 'error', 'outputs', `${typeScriptCount} type-script outputs > allowed ${policy.maxTypeScriptOutputs}`);
    }
    if (policy.maxTotalFreeCapacityCKB !== null && totalFreeCapacity > policy.maxTotalFreeCapacityCKB) {
      push('POLICY_TOTAL_FREE_CAPACITY', 'error', 'outputs', `Total free capacity ${formatCkb(totalFreeCapacity)} CKB exceeds limit ${formatCkb(policy.maxTotalFreeCapacityCKB)} CKB`);
    }
    for (const [ruleIndex, rule] of policy.requiredOutputs.entries()) {
      let matched = 0;
      for (const output of tx.outputs) {
        if (!matchesExactScript(output.lock, [rule.lock])) continue;
        if (rule.type !== undefined && ((rule.type === null && output.type !== null) ||
          (rule.type !== null && (!output.type || !matchesExactScript(output.type, [rule.type]))))) continue;
        if (output.capacity < rule.minCapacity || output.capacity > rule.maxCapacity) {
          push('POLICY_REQUIRED_OUTPUT_CAPACITY', 'error', `outputs[${output.index}].capacity`,
            `Recipient rule #${ruleIndex}: ${formatCkb(output.capacity)} CKB outside ${formatCkb(rule.minCapacity)}–${formatCkb(rule.maxCapacity)} CKB`);
        } else matched++;
      }
      if (matched < rule.minCount || matched > rule.maxCount) {
        push('POLICY_REQUIRED_OUTPUT_COUNT', 'error', `requiredOutputs[${ruleIndex}]`,
          `Matching recipients ${matched}, required ${rule.minCount}–${rule.maxCount}`);
      }
    }
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
    schemaVersion: 2,
    policyVersion: policy.version,
    result: errors ? 'policy-failed' : warnings ? 'review-needed' : 'checks-passed',
    errorCount: errors,
    warningCount: warnings,
    outputCount: tx.outputs.length,
    totalDataBytes,
    totalCapacityCKB: formatCkb(totalCapacity),
    totalFreeCapacityCKB: formatCkb(totalFreeCapacity),
    typeScriptCount,
    findings,
    outputs: outputDetails,
    checks: {
      capacity: !findings.some(f => f.code === 'CAPACITY_INSUFFICIENT'),
      lockPolicy: !findings.some(f => ['POLICY_LOCK_NOT_ALLOWED', 'POLICY_LOCK_SCRIPT_NOT_ALLOWED'].includes(f.code)),
      typePolicy: !findings.some(f => ['POLICY_TYPE_FORBIDDEN', 'POLICY_TYPE_NOT_ALLOWED', 'POLICY_TYPE_SCRIPT_NOT_ALLOWED', 'POLICY_TYPE_REQUIRED', 'POLICY_MAX_TYPE_SCRIPTS'].includes(f.code)),
      intent: !findings.some(f => f.code.startsWith('POLICY_REQUIRED_OUTPUT')),
      constraints: !findings.some(f => f.severity === 'error' && f.code.startsWith('POLICY_') && !['POLICY_LOCK_NOT_ALLOWED', 'POLICY_LOCK_SCRIPT_NOT_ALLOWED', 'POLICY_TYPE_FORBIDDEN', 'POLICY_TYPE_NOT_ALLOWED', 'POLICY_TYPE_SCRIPT_NOT_ALLOWED'].includes(f.code))
    },
    verification: {
      policy: 'evaluated', transactionShape: policy.strictTransactionShape ? 'raw-shape-checked' : 'output-only', onChain: 'not-verified',
      recipientIntent: policy.requiredOutputs?.length ? 'checked-against-configured-rules' : 'not-configured',
      scriptExecution: 'not-verified', cycleCounts: 'not-available',
      signatures: 'not-verified', inputs: 'not-verified', fees: 'not-verified'
    },
    disclaimer: 'Đây chỉ là kiểm tra cấu trúc và policy offline. Không chạy CKB-VM, không xác nhận input/fee/witness, không đảm bảo transaction hợp lệ hoặc an toàn trên chain.'
  };
}
