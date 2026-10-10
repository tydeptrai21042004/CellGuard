/** Application-level capacity accounting. No fungible-CKB provenance is claimed. */
import { formatCkb, parseU64Hex, validateScript } from './ckb.mjs';

const FLAG_MASK = 0xff00000000000000n;
const VALUE_MASK = (1n << 56n) - 1n;
function sameScript(a, b) { return a?.codeHash === b?.codeHash && a?.hashType === b?.hashType && a?.args === b?.args; }
export function decodeSince(raw) {
  const n = parseU64Hex(raw, 'input.since');
  const flag = n & FLAG_MASK;
  const metric = Number((n >> 61n) & 3n);
  if ((flag & 0x1f00000000000000n) !== 0n || metric === 3) throw new Error('Invalid CKB since flags');
  const value = n & VALUE_MASK;
  if (n === 0n || metric !== 1) return { n, flag, metric, value };
  const epoch = value & 0xffffffn;
  const index = (value >> 24n) & 0xffffn;
  let length = (value >> 40n) & 0xffffn;
  if (index === 0n && length === 0n) length = 1n;
  if (length === 0n || index >= length) throw new Error('Invalid CKB since epoch fraction');
  return { n, flag, metric, value, epoch, index, length };
}
/** Compare only like-for-like encoded conditions; NOT actual chain maturity. */
function sameOrAfter(observed, threshold) {
  if (observed.flag !== threshold.flag) return false;
  if (observed.metric !== 1) return observed.value >= threshold.value;
  if (observed.epoch !== threshold.epoch) return observed.epoch > threshold.epoch;
  return observed.index * threshold.length >= threshold.index * observed.length;
}
function parseInputEvidence(rawInputs, txInput) {
  if (!Array.isArray(rawInputs) || !Array.isArray(txInput.inputs) || rawInputs.length !== txInput.inputs.length) return null;
  return rawInputs.map((cell, i) => {
    if (!cell || cell.index !== i || typeof cell.capacity !== 'string') throw new Error(`resolvedInputs[${i}]: missing index or hex capacity`);
    const point = txInput.inputs[i]?.previous_output;
    if (!point || typeof point.tx_hash !== 'string' || typeof point.index !== 'string') throw new Error(`inputs[${i}]: invalid outpoint`);
    // If a source supplied an OutPoint, it must match the transaction exactly.
    if (cell.outPoint && (cell.outPoint.tx_hash?.toLowerCase() !== point.tx_hash.toLowerCase() || BigInt(cell.outPoint.index) !== BigInt(point.index))) {
      throw new Error(`resolvedInputs[${i}]: OutPoint mismatch`);
    }
    return {
      index: i, capacity: parseU64Hex(cell.capacity, `resolvedInputs[${i}].capacity`),
      lock: validateScript(cell.lock, `resolvedInputs[${i}].lock`, { strict: true }),
      since: decodeSince(txInput.inputs[i].since),
      outPoint: `${point.tx_hash.toLowerCase()}:${BigInt(point.index)}`
    };
  });
}
export function evaluateInvariants(txInput, parsedOutputs, policy, { resolvedInputs, inputEvidence = 'unverified' } = {}) {
  const findings = [];
  const push = (code, severity, path, detail) => findings.push({ code, severity, path, detail });
  const rulesConfigured = policy.capacityFlow.length > 0 || policy.sinceRules.length > 0 || policy.allowedInputRoles.length > 0 || policy.maxFee !== null;
  const inputs = resolvedInputs === undefined ? null : parseInputEvidence(resolvedInputs, txInput);
  const roleNames = Object.keys(policy.roles);
  const aggregate = Object.fromEntries(roleNames.map(role => [role, { input: 0n, output: 0n }]));
  for (const output of parsedOutputs) {
    const role = roleNames.find(name => sameScript(output.lock, policy.roles[name]));
    if (role) aggregate[role].output += output.capacity;
    if (policy.allowedOutputRoles.length && !policy.allowedOutputRoles.includes(role)) {
      push('POLICY_OUTPUT_ROLE_FORBIDDEN', 'error', `outputs[${output.index}].lock`, `Output lock is not in the configured allowedOutputRoles list`);
    }
  }
  if (inputs) for (const cell of inputs) {
    const role = roleNames.find(name => sameScript(cell.lock, policy.roles[name]));
    if (role) aggregate[role].input += cell.capacity;
    if (policy.allowedInputRoles.length && !policy.allowedInputRoles.includes(role)) {
      push('POLICY_INPUT_ROLE_FORBIDDEN', 'error', `inputs[${cell.index}]`, 'Input lock is not in the configured allowedInputRoles list');
    }
  }
  if (rulesConfigured && !inputs) {
    push('INPUT_EVIDENCE_REQUIRED', 'error', 'inputs', 'Verified input Cells are required for capacity-flow, input-role and fee rules');
  } else if (rulesConfigured && inputEvidence !== 'rpc-live' && inputEvidence !== 'rpc-historical') {
    push('INPUT_EVIDENCE_UNVERIFIED', 'warning', 'inputs', 'Input details were supplied externally, not verified against the configured CKB node');
  }
  const totalInput = inputs?.reduce((sum, x) => sum + x.capacity, 0n) ?? null;
  const totalOutput = parsedOutputs.reduce((sum, x) => sum + x.capacity, 0n);
  const fee = totalInput === null ? null : totalInput - totalOutput;
  if (inputs && fee < 0n) push('NEGATIVE_FEE', 'error', 'inputs', `Output capacity exceeds input capacity by ${formatCkb(-fee)} CKB (DAO interest or other exceptional accounting requires separate verification)`);
  if (inputs && policy.maxFee !== null && fee > policy.maxFee) push('POLICY_FEE_EXCEEDED', 'error', 'inputs', `Fee ${formatCkb(fee)} CKB exceeds allowed ${formatCkb(policy.maxFee)} CKB`);
  const net = name => aggregate[name].output - aggregate[name].input;
  if (inputs) for (const [i, rule] of policy.capacityFlow.entries()) {
    const path = `capacityFlow[${i}]`;
    if (rule.kind === 'max-net-gain') {
      const gain = net(rule.role);
      if (gain > rule.maxGain) push('POLICY_UNAUTHORIZED_NET_GAIN', 'error', path, `${rule.id}: ${rule.role} gained ${formatCkb(gain)} CKB; allowed maximum ${formatCkb(rule.maxGain)} CKB`);
    } else if (rule.kind === 'min-recipient-net-gain') {
      const sourceDebit = aggregate[rule.source].input - aggregate[rule.source].output;
      if (aggregate[rule.source].input < rule.minSourceInput) push('POLICY_SOURCE_CAPACITY_MISSING', 'error', path, `${rule.id}: input capacity for ${rule.source} is below ${formatCkb(rule.minSourceInput)} CKB`);
      const debit = sourceDebit > 0n ? sourceDebit : 0n;
      const requiredGross = (debit * rule.numerator + rule.denominator - 1n) / rule.denominator;
      const minimum = requiredGross > rule.feeAllowance ? requiredGross - rule.feeAllowance : 0n;
      const received = rule.destinations.reduce((total, destination) => total + net(destination), 0n);
      if (received < minimum) push('CAPACITY_LEAK_DETECTED', 'error', path, `${rule.id}: recipients gained ${formatCkb(received)} CKB net, minimum ${formatCkb(minimum)} CKB from ${formatCkb(debit)} CKB source debit`);
    }
  }
  if (policy.sinceRules.length) for (const [i, rule] of policy.sinceRules.entries()) {
    if (!inputs) break;
    const matching = inputs.filter(cell => sameScript(cell.lock, policy.roles[rule.role]));
    if (!matching.length && rule.requireMatch) push('POLICY_SINCE_INPUT_MISSING', 'error', `sinceRules[${i}]`, `${rule.id}: no inputs matched role ${rule.role}`);
    for (const cell of matching) {
      let valid = false;
      try { valid = rule.operator === 'exact' ? cell.since.n === rule.since.n : sameOrAfter(cell.since, rule.since); }
      catch { valid = false; }
      if (!valid) push('POLICY_SINCE_MISMATCH', 'error', `inputs[${cell.index}].since`, `${rule.id}: input since does not meet the configured ${rule.operator} requirement`);
    }
  }
  const roleBalances = Object.fromEntries(roleNames.map(role => [role, {
    inputCKB: formatCkb(aggregate[role].input), outputCKB: formatCkb(aggregate[role].output), netCKB: formatCkb(net(role))
  }]));
  return { findings, roleBalances, feeCKB: fee === null ? null : formatCkb(fee), inputEvidence: inputs ? inputEvidence : 'missing', inputCount: inputs?.length ?? 0 };
}
