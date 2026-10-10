/** Read-only network verification. Results are observations from a configured CKB RPC, not proofs of consensus. */
import { analyzeTransaction } from '../site/assets/lib/analyzer.mjs';
import { parseTransaction, formatCkb, validateScript } from '../site/assets/lib/ckb.mjs';
import { parsePolicy } from '../site/assets/lib/policy.mjs';

const CHAIN = { mainnet: 'ckb', testnet: 'ckb_testnet' };
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_U64 = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/;
const MAX_RPC_INPUTS = 16;
const MAX_RPC_DEPS = 64;
const MAX_ONLINE_BYTES = 262144;
const MAX_U64 = (1n << 64n) - 1n;
export const ONLINE_LIMIT = MAX_ONLINE_BYTES;

export class VerificationError extends Error {
  constructor(code, message, status = 422) { super(message); this.name = 'VerificationError'; this.code = code; this.status = status; }
}
function fail(code, message, status) { throw new VerificationError(code, message, status); }
function bigintHex(value, path) {
  if (typeof value !== 'string' || !HEX_U64.test(value) || BigInt(value) > MAX_U64) fail('RPC_RESPONSE_INVALID', `${path}: invalid u64`);
  return BigInt(value);
}
function safeNetwork(network) {
  if (!Object.hasOwn(CHAIN, network)) fail('BAD_NETWORK', 'Network must be mainnet or testnet');
  return network;
}
function requireHexHash(value, path) { if (typeof value !== 'string' || !HASH.test(value)) fail('BAD_HASH', `${path}: expected 32-byte hex`); return value.toLowerCase(); }
function errorMessage(err) { return err instanceof Error ? err.message.slice(0, 320) : 'RPC error'; }
function resultBase(network, tip, chain) {
  return { network, chain, tip: { hash: tip.hash, number: tip.number }, observedAt: new Date().toISOString(), source: 'configured-read-only-ckb-rpc', independentProof: false };
}
function validHeader(header) {
  if (!header || typeof header !== 'object' || !HASH.test(header.hash) || typeof header.number !== 'string') fail('RPC_RESPONSE_INVALID', 'Invalid CKB tip header');
  bigintHex(header.number, 'tip.number');
  return header;
}
async function chainContext(rpc, network) {
  const chain = await rpc('get_blockchain_info', []);
  if (!chain || typeof chain !== 'object' || chain.chain !== CHAIN[network]) {
    fail('CHAIN_MISMATCH', `RPC returned ${String(chain?.chain ?? 'unknown')}; expected ${CHAIN[network]}`, 409);
  }
  if (chain.is_initial_block_download === true) fail('NODE_SYNCING', 'CKB node is in initial block download; cannot verify current chain state', 503);
  const tip = validHeader(await rpc('get_tip_header', []));
  return { chain: chain.chain, tip };
}
async function mapLimited(values, concurrency, task) {
  const out = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const i = cursor++;
      out[i] = await task(values[i], i);
    }
  }));
  return out;
}
function inputOutPoint(input, i) {
  if (!input || typeof input !== 'object' || !input.previous_output) fail('BAD_INPUT', `inputs[${i}].previous_output is missing`);
  const point = input.previous_output;
  requireHexHash(point.tx_hash, `inputs[${i}].previous_output.tx_hash`);
  if (typeof point.index !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(point.index)) fail('BAD_INPUT', `inputs[${i}].previous_output.index: invalid u32`);
  return { tx_hash: point.tx_hash, index: point.index };
}
function inputStatus(result, i) {
  if (!result || typeof result !== 'object' || !['live','dead','unknown'].includes(result.status)) fail('RPC_RESPONSE_INVALID', `inputs[${i}]: invalid get_live_cell response`);
  if (result.status !== 'live') return { index: i, status: result.status, capacity: null };
  const output = result.cell?.output;
  if (!output || typeof output !== 'object') fail('RPC_RESPONSE_INVALID', `inputs[${i}]: missing live output`);
  return { index: i, status: 'live', capacity: bigintHex(output.capacity, `inputs[${i}].capacity`).toString(), lock: output.lock ?? null };
}
function sumOutputs(tx) { return tx.outputs.reduce((total, out) => total + BigInt(out.capacity), 0n); }
function witnessCount(tx) { return tx.witnesses.length; }
function byteLength(tx) { return Buffer.byteLength(JSON.stringify(tx), 'utf8'); }
/** Read-only RPC calls: no send_transaction, signing, key access or arbitrary method proxy. */
export async function verifyTransactionOnline({ network, transaction, policy }, rpc) {
  safeNetwork(network);
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) fail('BAD_TRANSACTION', 'Full signed transaction JSON is required');
  if (byteLength(transaction) > MAX_ONLINE_BYTES) fail('BODY_TOO_LARGE', 'Online transaction must not exceed 256 KiB', 413);
  const tx = transaction;
  // Unlike the offline output-only inspector, never accept partial synthetic fixtures online.
  try { parseTransaction(tx, { strict: true }); } catch (error) { fail('BAD_TRANSACTION', error instanceof Error ? error.message : 'Invalid transaction'); }
  if (!tx.inputs.length) fail('NO_INPUTS', 'A real transaction needs at least one input; synthetic output-only fixtures cannot be verified');
  if (tx.inputs.length > MAX_RPC_INPUTS) fail('TOO_MANY_INPUTS', `Online verification supports up to ${MAX_RPC_INPUTS} inputs`);
  if (tx.cell_deps.length > MAX_RPC_DEPS) fail('TOO_MANY_DEPS', `Online verification supports up to ${MAX_RPC_DEPS} cell dependencies`);
  let local;
  try { parsePolicy(policy); local = analyzeTransaction(tx, policy); }
  catch (error) { fail('BAD_POLICY', error instanceof Error ? error.message : 'Invalid policy'); }
  const { chain, tip } = await chainContext(rpc, network);
  const base = resultBase(network, tip, chain);
  const points = tx.inputs.map(inputOutPoint);
  const duplicates = new Set();
  for (const [i, p] of points.entries()) {
    const key = `${p.tx_hash.toLowerCase()}:${BigInt(p.index)}`;
    if (duplicates.has(key)) fail('DUPLICATE_INPUT', `inputs[${i}]: duplicated OutPoint`);
    duplicates.add(key);
  }
  const cells = await mapLimited(points, 4, async (point, i) => inputStatus(await rpc('get_live_cell', [point, false, true]), i));
  const allLive = cells.every(x => x.status === 'live');
  const inputCapacity = cells.filter(x => x.capacity !== null).reduce((s,x) => s + BigInt(x.capacity), 0n);
  const outputCapacity = sumOutputs(tx);
  const fee = allLive ? inputCapacity - outputCapacity : null;
  // Flow policies require trusted input lock/capacity metadata. Missing lock data is
  // inconclusive, never silently treated as verified input evidence.
  if (allLive && cells.every(c => c.lock)) {
    try {
      const resolvedInputs = cells.map((cell, index) => ({ index,
        outPoint: points[index], capacity: '0x' + BigInt(cell.capacity).toString(16), lock: cell.lock }));
      local = analyzeTransaction(tx, policy, { resolvedInputs, inputEvidence: 'rpc-live' });
    } catch (error) { fail('INPUT_RESOLUTION_INVALID', `Invalid live-cell metadata: ${errorMessage(error)}`, 502); }
  }
  const findings = [...local.findings.map(f => ({ severity: f.severity, code: f.code, path: f.path, detail: f.detail }))];
  for (const cell of cells.filter(x => x.status !== 'live')) findings.push({ severity: 'error', code: 'INPUT_NOT_LIVE', detail: `Input #${cell.index} is ${cell.status} according to the RPC` });
  if (fee !== null && fee < 0n) findings.push({ severity: 'error', code: 'NEGATIVE_FEE', detail: `Outputs exceed inputs by ${formatCkb(-fee)} CKB` });
  // This is a preflight policy budget, not a universal CKB protocol fee limit.
  if (fee !== null && fee >= 0n && fee > 100n * 100000000n) findings.push({ severity: 'warning', code: 'HIGH_FEE', detail: `Observed fee ${formatCkb(fee)} CKB exceeds the default 100 CKB review threshold` });
  let scripts = { status: 'skipped', method: null, cycles: null, reason: 'Inputs are not live or output capacity exceeds inputs' };
  if (allLive && fee >= 0n) {
    try {
      let execution;
      let method = 'estimate_cycles';
      try { execution = await rpc(method, [tx]); }
      catch (error) {
        if (error?.rpcCode !== -32601) throw error;
        method = 'dry_run_transaction';
        execution = await rpc(method, [tx]);
      }
      const cycles = bigintHex(execution?.cycles, 'estimate_cycles.cycles');
      scripts = { status: 'pass', method, cycles: cycles.toString(), reason: 'CKB VM accepted all executed lock/type scripts and supplied witnesses at the queried node state' };
    } catch (error) {
      // -301: dependency resolution; -302: script failure; other RPC errors are inconclusive, NOT invalid signatures.
      if ([-301, -302].includes(error?.rpcCode)) {
        scripts = { status: 'fail', method: 'estimate_cycles', cycles: null, reason: errorMessage(error), rpcCode: error.rpcCode };
        findings.push({ severity: 'error', code: error.rpcCode === -302 ? 'SCRIPT_EXECUTION_FAILED' : 'DEPENDENCY_RESOLUTION_FAILED', detail: errorMessage(error) });
      } else {
        scripts = { status: 'unknown', method: 'estimate_cycles', cycles: null, reason: errorMessage(error) };
        findings.push({ severity: 'warning', code: 'SCRIPT_VERIFICATION_UNAVAILABLE', detail: 'CKB VM execution was unavailable; witnesses/signatures remain unverified' });
      }
    }
  }
  // A stronger, read-only node-side txpool validation that DOES NOT submit or broadcast.
  // Its outcome is distinct from VM execution, and is only valid for this node's current state.
  let txPool = { status: 'skipped', reason: 'Inputs/fees or executed scripts failed', cycles: null, feeCKB: null };
  if (allLive && fee >= 0n && scripts.status !== 'fail') {
    try {
      const accepted = await rpc('test_tx_pool_accept', [tx, 'passthrough']);
      if (!accepted || typeof accepted !== 'object') fail('RPC_RESPONSE_INVALID', 'Invalid txpool acceptance response', 502);
      const poolCycles = bigintHex(accepted.cycles, 'test_tx_pool_accept.cycles');
      const poolFee = bigintHex(accepted.fee, 'test_tx_pool_accept.fee');
      txPool = { status: 'pass', reason: 'The CKB node reports it would accept this transaction into its current txpool', cycles: poolCycles.toString(), feeCKB: formatCkb(poolFee) };
      if (poolFee !== fee) {
        txPool.status = 'fail';
        txPool.reason = 'Node-calculated fee differs from capacity-derived fee';
        findings.push({ severity: 'error', code: 'FEE_MISMATCH', detail: `RPC fee ${formatCkb(poolFee)} CKB differs from input-output fee ${formatCkb(fee)} CKB` });
      }
      if (scripts.status === 'unknown' && txPool.status === 'pass') {
        scripts = { status: 'pass', method: 'test_tx_pool_accept', cycles: poolCycles.toString(), reason: 'CKB node txpool preflight accepted executed scripts' };
      }
    } catch (error) {
      if (error?.rpcCode === -32601) {
        txPool = { status: 'unsupported', reason: 'RPC does not expose test_tx_pool_accept', cycles: null, feeCKB: null };
      } else if ([-1106, -1107].includes(error?.rpcCode)) {
        txPool = { status: 'unknown', reason: errorMessage(error), rpcCode: error.rpcCode, cycles: null, feeCKB: null };
        findings.push({ severity: 'warning', code: 'TXPOOL_STATE_INCONCLUSIVE', detail: 'Node pool state prevents a definitive non-mutating acceptance check' });
      } else if ([-301, -302, -1102, -1104, -1105].includes(error?.rpcCode)) {
        txPool = { status: 'fail', reason: errorMessage(error), rpcCode: error.rpcCode, cycles: null, feeCKB: null };
        findings.push({ severity: 'error', code: 'TXPOOL_REJECTED', detail: errorMessage(error) });
      } else {
        txPool = { status: 'unknown', reason: errorMessage(error), cycles: null, feeCKB: null };
        findings.push({ severity: 'warning', code: 'TXPOOL_CHECK_UNAVAILABLE', detail: 'RPC txpool acceptance test did not complete. No acceptance can be asserted.' });
      }
    }
  }
  let tipChanged = false;
  try {
    const after = validHeader(await rpc('get_tip_header', []));
    tipChanged = BigInt(after.number) < BigInt(tip.number) || (BigInt(after.number) === BigInt(tip.number) && after.hash !== tip.hash);
  } catch { tipChanged = true; }
  if (tipChanged) findings.push({ severity: 'warning', code: 'CHAIN_STATE_CHANGED', detail: 'Chain tip changed unexpectedly during verification; results may be stale' });
  const hardFailed = findings.some(f => f.severity === 'error') || scripts.status === 'fail' || txPool.status === 'fail';
  const status = hardFailed ? 'fail' : scripts.status === 'pass' && txPool.status === 'pass' && !tipChanged ? 'pass' : 'inconclusive';
  return {
    ...base, mode: 'online-preflight', status,
    checks: { policy: local.errorCount ? 'fail' : 'pass', inputs: allLive ? 'pass' : 'fail', fee: fee === null ? 'unknown' : fee >= 0n ? 'pass' : 'fail', vmScripts: scripts.status, txPoolAcceptance: txPool.status, lockWitnesses: scripts.status === 'pass' ? 'accepted-by-executed-lock-scripts' : scripts.status === 'fail' ? 'failed-or-unresolved' : 'not-independently-verified', consensus: txPool.status === 'pass' ? 'node-txpool-preflight-pass' : 'not-verified', finality: 'not-verified' },
    inputCount: cells.length, liveInputCount: cells.filter(x => x.status === 'live').length,
    inputs: cells, inputCapacityCKB: allLive ? formatCkb(inputCapacity) : null,
    outputCapacityCKB: formatCkb(outputCapacity), feeCKB: fee === null ? null : formatCkb(fee),
    capacityFlow: local.capacityFlow, scripts, txPool, findings, limitations: 'RPC observations only. test_tx_pool_accept tests current-node txpool acceptance without broadcast, not actual inclusion or permanent consensus validity. A passing script does not imply every custom lock cryptographically verifies a signature. Node state may change. No transaction was submitted.'
  };
}

export async function lookupTransactionOnline({ network, hash }, rpc) {
  safeNetwork(network); const txHash = requireHexHash(hash, 'hash');
  const { chain, tip } = await chainContext(rpc, network);
  const base = resultBase(network, tip, chain);
  const record = await rpc('get_transaction', [txHash]);
  if (record === null || record?.tx_status?.status === 'unknown') return {
    ...base, mode: 'chain-lookup', hash: txHash, status: 'unknown', confirmations: null,
    limitations: 'The queried node did not find a committed transaction. Unknown does not prove nonexistence on other nodes.'
  };
  const state = record?.tx_status?.status;
  if (!['committed', 'pending', 'proposed', 'rejected'].includes(state)) fail('RPC_RESPONSE_INVALID', 'Invalid get_transaction status');
  if (state !== 'committed') return {
    ...base, mode: 'chain-lookup', hash: txHash, status: state, confirmations: null,
    limitations: 'Mempool status is not a blockchain commitment. No finality is asserted.'
  };
  const blockHash = requireHexHash(record.tx_status.block_hash, 'block_hash');
  const header = await rpc('get_header', [blockHash]);
  if (!header || !HEX_U64.test(header.number)) fail('RPC_RESPONSE_INVALID', 'Committed block header unavailable');
  const canonical = await rpc('get_block_hash', [header.number]);
  if (canonical === null || typeof canonical !== 'string' || canonical.toLowerCase() !== blockHash) return {
    ...base, mode: 'chain-lookup', hash: txHash, status: 'reorg-risk', blockHash, confirmations: null,
    limitations: 'The transaction block is not canonical at the queried node tip. Do not treat it as confirmed.'
  };
  let proof = { status: 'unavailable', reason: 'The RPC did not supply a verified inclusion proof' };
  try {
    const txProof = await rpc('get_transaction_proof', [[txHash], blockHash]);
    if (!txProof || typeof txProof !== 'object' || String(txProof.block_hash).toLowerCase() !== blockHash) {
      proof = { status: 'invalid', reason: 'RPC proof refers to a different block' };
    } else {
      const validated = await rpc('verify_transaction_proof', [txProof]);
      proof = Array.isArray(validated) && validated.some(x => typeof x === 'string' && x.toLowerCase() === txHash)
        ? { status: 'verified-by-node', reason: 'RPC node verified its inclusion proof for this block' }
        : { status: 'invalid', reason: 'RPC proof verification did not contain the requested transaction' };
    }
  } catch (error) {
    proof = { status: 'unavailable', reason: errorMessage(error) };
  }
  if (proof.status === 'invalid') return {
    ...base, mode: 'chain-lookup', hash: txHash, status: 'reorg-risk', blockHash, confirmations: null, proof,
    limitations: 'The RPC produced conflicting transaction inclusion proof evidence. Do not treat this as confirmed.'
  };
  const confirmations = BigInt(tip.number) >= BigInt(header.number) ? BigInt(tip.number) - BigInt(header.number) + 1n : 0n;
  return {
    ...base, mode: 'chain-lookup', hash: txHash, status: 'committed', blockHash, blockNumber: header.number,
    confirmations: confirmations.toString(), proof,
    limitations: 'Commitment and confirmations are asserted by the configured RPC node. Inclusion proof, when available, was verified by that SAME RPC node—not independently by CellGuard or an SPV client. No finality proof was performed.'
  };
}

/** Audit historical, canonical committed transactions. Never tests spent inputs for liveness. */
export async function auditCommittedTransactionOnline({ network, hash, policy }, rpc) {
  safeNetwork(network); const txHash = requireHexHash(hash, 'hash');
  let parsedPolicy;
  try { parsedPolicy = parsePolicy(policy); } catch (err) { fail('BAD_POLICY', errorMessage(err)); }
  const inclusion = await lookupTransactionOnline({ network, hash: txHash }, rpc);
  if (inclusion.status !== 'committed') return {
    ...inclusion, mode: 'committed-audit', status: 'inconclusive', chainStatus: inclusion.status,
    findings: [{ severity: 'warning', code: 'TRANSACTION_NOT_CANONICAL_COMMITTED', detail: `Cannot audit historical inputs: ${inclusion.status}` }],
    limitations: 'Historical audit requires a transaction committed in a canonical block according to the selected RPC.'
  };
  const record = await rpc('get_transaction', [txHash]);
  const raw = record?.transaction?.inner ?? record?.transaction;
  if (!raw || typeof raw !== 'object') fail('HISTORY_UNAVAILABLE', 'RPC did not return the committed transaction body', 503);
  if (raw.hash !== undefined && (typeof raw.hash !== 'string' || raw.hash.toLowerCase() !== txHash))
    fail('HISTORY_HASH_MISMATCH', 'RPC committed transaction hash does not match the requested hash', 502);
  const tx = { ...raw }; delete tx.hash;
  try { parseTransaction(tx, { strict: true }); } catch (err) { fail('HISTORY_INVALID', `Committed transaction body malformed: ${errorMessage(err)}`, 502); }
  if (!tx.inputs.length || tx.inputs.length > MAX_RPC_INPUTS) fail('HISTORY_INPUTS_LIMIT', `Audit supports 1–${MAX_RPC_INPUTS} ordinary inputs`);
  const missing = [];
  const uniqueParentCache = new Map();
  const canonicalHeaderCache = new Map();
  const inputs = await mapLimited(tx.inputs, 4, async (input, index) => {
    const point = inputOutPoint(input, index);
    const parentHash = point.tx_hash.toLowerCase();
    if (!uniqueParentCache.has(parentHash)) uniqueParentCache.set(parentHash, rpc('get_transaction', [parentHash]));
    let parent;
    try { parent = await uniqueParentCache.get(parentHash); }
    catch (err) { missing.push(`inputs[${index}]: ${errorMessage(err)}`); return null; }
    if (parent?.tx_status?.status !== 'committed' || !parent.tx_status.block_hash) {
      missing.push(`inputs[${index}]: originating transaction unavailable or not committed`); return null;
    }
    const parentBlockHash = requireHexHash(parent.tx_status.block_hash, 'parent.block_hash');
    if (!canonicalHeaderCache.has(parentBlockHash)) canonicalHeaderCache.set(parentBlockHash, (async () => {
      const header = await rpc('get_header', [parentBlockHash]);
      if (!header || !HEX_U64.test(header.number)) return false;
      const canonical = await rpc('get_block_hash', [header.number]);
      return typeof canonical === 'string' && canonical.toLowerCase() === parentBlockHash;
    })());
    let canonical = false;
    try { canonical = await canonicalHeaderCache.get(parentBlockHash); }
    catch { /* preserve unknown state */ }
    if (!canonical) { missing.push(`inputs[${index}]: parent block is not verifiably canonical`); return null; }
    const originTx = parent.transaction?.inner ?? parent.transaction;
    if (originTx?.hash !== undefined && (typeof originTx.hash !== 'string' || originTx.hash.toLowerCase() !== parentHash)) {
      missing.push(`inputs[${index}]: originating transaction hash mismatch`); return null;
    }
    const n = Number(BigInt(point.index));
    if (!Array.isArray(originTx?.outputs) || n >= originTx.outputs.length) {
      missing.push(`inputs[${index}]: parent output index does not exist`); return null;
    }
    const output = originTx.outputs[n];
    try {
      bigintHex(output.capacity, `inputs[${index}].capacity`);
      validateScript(output.lock, `inputs[${index}].lock`, { strict: true });
      return { index, outPoint: point, capacity: output.capacity, lock: output.lock };
    } catch { missing.push(`inputs[${index}]: malformed historical output`); return null; }
  });
  if (missing.length) return {
    ...inclusion, mode: 'committed-audit', chainStatus: 'committed', status: 'inconclusive',
    policyVersion: parsedPolicy.version, profile: parsedPolicy.profile ?? null,
    findings: missing.map(detail => ({ severity: 'warning', code: 'HISTORICAL_INPUT_UNAVAILABLE', detail })),
    limitations: 'Cannot evaluate capacity invariants without every historical parent output. The transaction is committed, but policy compliance is not established.'
  };
  let report;
  try { report = analyzeTransaction(tx, policy, { resolvedInputs: inputs, inputEvidence: 'rpc-historical' }); }
  catch (err) { fail('HISTORICAL_POLICY_INVALID', errorMessage(err), 502); }
  return {
    ...inclusion, mode: 'committed-audit', chainStatus: 'committed', status: report.errorCount ? 'policy-failed' : 'pass',
    policyVersion: report.policyVersion, profile: report.profile, checks: { policy: report.errorCount ? 'fail' : 'pass',
      historicalInputs: 'resolved-from-canonical-parent-transactions', inclusion: inclusion.proof?.status ?? 'unavailable',
      historicalVmReplay: 'not-performed', finality: 'not-independently-verified' },
    findings: report.findings, capacityFlow: report.capacityFlow, transaction: { inputCount: inputs.length, outputCount: report.outputCount,
      outputCapacityCKB: report.totalCapacityCKB },
    limitations: 'Historical inputs and inclusion are attested by the selected RPC node. This is an application-policy audit, not an independent consensus proof, replay of VM scripts at the historical state, or a finality guarantee.'
  };
}
