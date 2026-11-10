/**
 * CellGuard x CrowdCell: non-broadcast, fail-closed finalization guard.
 *
 * Application-level checking only. Do NOT mistake these conditions for a
 * formal proof of CrowdCell contract validity or for a signed chain audit.
 * The imported policy is application-specific and must be agreed with its author.
 */
import { analyzeTransaction } from '../../site/assets/lib/analyzer.mjs';
import { parsePolicy } from '../../site/assets/lib/policy.mjs';
import { verifyTransactionOnline } from '../../server/verification.mjs';
import { createRpc } from '../../server/rpc.mjs';

const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const pick = (value, snake, camel) => own(value, snake) ? value[snake] : value?.[camel];
const hash = /^0x[0-9a-fA-F]{64}$/;
const hexBytes = /^0x(?:[0-9a-fA-F]{2})*$/;

function hexNumber(value, path) {
  let n;
  try {
    if (typeof value === 'bigint') n = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
    else if (typeof value === 'string' && /^(?:0x[\da-fA-F]+|\d+)$/.test(value)) n = BigInt(value);
    else throw new Error('invalid quantity');
  } catch { throw new TypeError(`${path}: expected nonnegative integer or hex quantity`); }
  if (n < 0n || n > (1n << 64n) - 1n) throw new TypeError(`${path}: outside u64 range`);
  return `0x${n.toString(16)}`;
}
function bytes(value, path) {
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value !== 'string' || !hexBytes.test(value)) throw new TypeError(`${path}: expected hex bytes`);
  return value.toLowerCase();
}
function script(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path}: script required`);
  const code_hash = pick(value, 'code_hash', 'codeHash');
  const hash_type = pick(value, 'hash_type', 'hashType');
  const args = bytes(value.args, `${path}.args`);
  if (!hash.test(code_hash) || !['data','type','data1','data2'].includes(hash_type))
    throw new TypeError(`${path}: invalid code_hash/hash_type`);
  return { code_hash: code_hash.toLowerCase(), hash_type, args };
}
function outPoint(value, path) {
  if (!value || typeof value !== 'object') throw new TypeError(`${path}: missing OutPoint`);
  const tx_hash = pick(value, 'tx_hash', 'txHash');
  if (!hash.test(tx_hash)) throw new TypeError(`${path}.tx_hash: invalid tx hash`);
  const index = hexNumber(value.index, `${path}.index`);
  if (BigInt(index) > 0xffffffffn) throw new TypeError(`${path}.index: outside u32 range`);
  return { tx_hash: tx_hash.toLowerCase(), index };
}

/**
 * Adapt CCC's camelCase/bigint transaction properties to CKB RPC JSON.
 * Also accepts CKB RPC's own snake_case representation.
 * This converts a detached representation; it does NOT sign or broadcast.
 */
export function toCkbRpcTransaction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Transaction object required');
  const cellDeps = pick(raw, 'cell_deps', 'cellDeps');
  const headerDeps = pick(raw, 'header_deps', 'headerDeps');
  const outputsData = pick(raw, 'outputs_data', 'outputsData');
  for (const [label, value] of Object.entries({cellDeps,headerDeps,inputs:raw.inputs,outputs:raw.outputs,outputsData,witnesses:raw.witnesses})) {
    if (!Array.isArray(value)) throw new TypeError(`Transaction.${label}: expected array (complete transaction required)`);
  }
  if (raw.outputs.length !== outputsData.length || raw.outputs.length === 0)
    throw new TypeError('outputs and outputs_data must have equal lengths and at least one output');
  return {
    version: hexNumber(raw.version, 'version'),
    cell_deps: cellDeps.map((x,i) => {
      const dep_type = pick(x,'dep_type','depType');
      if (!['code','dep_group'].includes(dep_type)) throw new TypeError(`cell_deps[${i}].dep_type invalid`);
      return { out_point: outPoint(pick(x,'out_point','outPoint'),`cell_deps[${i}].out_point`),dep_type };
    }),
    header_deps: headerDeps.map((x,i) => {if (!hash.test(x)) throw new TypeError(`header_deps[${i}] invalid`); return x.toLowerCase();}),
    inputs: raw.inputs.map((x,i) => ({
      since: hexNumber(x.since,`inputs[${i}].since`),
      previous_output: outPoint(pick(x,'previous_output','previousOutput'),`inputs[${i}].previous_output`)
    })),
    outputs: raw.outputs.map((x,i) => ({
      capacity: hexNumber(x.capacity,`outputs[${i}].capacity`),
      lock: script(x.lock,`outputs[${i}].lock`),
      type: x.type == null ? null : script(x.type,`outputs[${i}].type`)
    })),
    outputs_data: outputsData.map((x,i) => bytes(x,`outputs_data[${i}]`)),
    witnesses: raw.witnesses.map((x,i) => bytes(x,`witnesses[${i}]`))
  };
}
function scriptEqual(a,b) {
  const s = x => `${x.code_hash.toLowerCase()}:${x.hash_type}:${x.args.toLowerCase()}`;
  return s(a) === s(b);
}
/**
 * Guard against treating an empty/generic or old beneficiary-flow policy as
 * the correct CrowdCell campaign-capacity-preservation policy.
 * `expectedCampaignType` must be externally confirmed for THIS campaign and
 * deployment (all three fields, including args).
 */
export function validateCrowdCellFinalizePolicy(raw, { expectedCampaignType } = {}) {
  if (!expectedCampaignType) throw new TypeError('Pin the externally verified exact campaign type script (code_hash, hash_type, args)');
  const expected = script(expectedCampaignType,'expectedCampaignType');
  if (raw?.version !== 3 || raw?.strictTransactionShape !== true)
    throw new TypeError('CrowdCell finalize requires strict v3 policy');
  const p = parsePolicy(raw);
  const protectedRules = p.capacityFlow.filter(rule => rule.kind === 'preserve-typed-cell');
  if (protectedRules.length !== 1) throw new TypeError('Exactly one preserve-typed-cell rule is required');
  const protectedScript = protectedRules[0].type;
  if (!scriptEqual(expected, {code_hash:protectedScript.codeHash,hash_type:protectedScript.hashType,args:protectedScript.args}))
    throw new TypeError('Campaign type rule does not match the pinned deployed campaign identity');
  if (!p.roles.campaign || !p.allowedInputRoles.includes('campaign') || !p.allowedOutputRoles.includes('campaign'))
    throw new TypeError('Campaign role must be constrained in both input/output allowlists');
  const campaign = p.roleRequirements.find(rule => rule.role === 'campaign');
  if (!campaign || campaign.minInputCount !== 1 || campaign.maxInputCount !== 1 || campaign.minOutputCount !== 1 || campaign.maxOutputCount !== 1)
    throw new TypeError('The exact campaign role must require one input and one successor output');
  if (!p.requiredCellDeps.length) throw new TypeError('Pin reviewed code cell dependencies before live usage');
  if (p.roles.finalizer && !p.capacityFlow.some(rule => rule.kind === 'max-net-gain' && rule.role === 'finalizer' && rule.maxGain === 0n))
    throw new TypeError('Current finalize policy must forbid finalizer net profit');
  return p;
}
function combine(status, report, mode) {
  return { action: 'finalize', phase: mode, status, allowed: status === 'PASS',
    report, limitations: 'Read-only application preflight. No broadcast, no signature creation, no chain inclusion or contract audit. Revalidate if transaction changes.' };
}
/** The protected typed input/output must ALSO carry the campaign role's lock.
 * A separate, untyped campaign-lock output must not satisfy role accounting.
 * Keep this as an extra dApp-specific check; CellGuard's generic analyzer
 * intentionally treats lock-role and type invariants independently.
 */
function ensureCampaignTypeLockBinding(report,tx,policy,resolvedInputs) {
  const item = report?.capacityFlow?.protectedCells?.find(x => x.id === policy.capacityFlow.find(y=>y.kind==='preserve-typed-cell')?.id);
  if (!item || item.inputIndex == null || item.outputIndex == null) return report;
  const campaignLock = script(policy.roles.campaign,'roles.campaign');
  const inputLock = resolvedInputs?.[item.inputIndex]?.lock;
  const outputLock = tx.outputs[item.outputIndex]?.lock;
  // When no resolved inputs exist, the generic policy already marks input evidence missing.
  if (!inputLock || !outputLock) return report;
  const good = scriptEqual(script(inputLock,'protected input lock'),campaignLock)
    && scriptEqual(script(outputLock,'protected output lock'),campaignLock);
  if (good) return report;
  return {...report,
    errorCount: (report.errorCount ?? report.findings.filter(x=>x.severity==='error').length) + 1,
    findings:[...report.findings,{severity:'error',code:'CROWDCELL_CAMPAIGN_TYPE_LOCK_MISMATCH',
      detail:'The protected campaign type input/output must each use the exact reviewed campaign lock. An unrelated untyped output cannot stand in for the typed successor.'}]};
}
/**
 * Offline pre-signing preview. UNVERIFIED input metadata can NEVER authorize
 * a transaction; see status PREVIEW_ONLY even when the local rule matches.
 */
export function previewCrowdCellFinalize({transaction, policy, expectedCampaignType, resolvedInputs}) {
  validateCrowdCellFinalizePolicy(policy, {expectedCampaignType});
  const tx = toCkbRpcTransaction(transaction);
  const inspected = analyzeTransaction(tx, policy, resolvedInputs ? {resolvedInputs,inputEvidence:'provided-unverified'} : {});
  const report = ensureCampaignTypeLockBinding(inspected,tx,policy,resolvedInputs);
  return combine(report.errorCount ? 'POLICY_FAILED' : 'PREVIEW_ONLY', report, 'offline-unverified');
}
/**
 * Signed pre-broadcast gate: RPC verifies input liveness, capacity accounting,
 * executes scripts and checks tx-pool acceptance (without submission).
 * Fail closed on RPC errors, reorg/state uncertainty and missing policy evidence.
 */
export async function preflightCrowdCellFinalize({transaction,policy,expectedCampaignType,network='testnet',rpc}) {
  if (network !== 'testnet') throw new TypeError('CrowdCell bridge is TESTNET-only; mainnet is intentionally blocked');
  validateCrowdCellFinalizePolicy(policy,{expectedCampaignType});
  const tx = toCkbRpcTransaction(transaction);
  const observed = await verifyTransactionOnline({network,transaction:tx,policy},rpc ?? createRpc(network));
  const report = ensureCampaignTypeLockBinding(observed,tx,policy,observed.inputs);
  const bindingFailed = report.findings.some(x => x.code === 'CROWDCELL_CAMPAIGN_TYPE_LOCK_MISMATCH');
  return combine(bindingFailed || report.status === 'fail' ? 'POLICY_FAILED' : report.status === 'pass' ? 'PASS' : 'INCONCLUSIVE',report,'signed-live-rpc');
}
export class CellGuardPolicyError extends Error {
  constructor(result) {super(`CellGuard CrowdCell finalize blocked: ${result.status}`); this.name='CellGuardPolicyError';this.result=result;}
}
/** Refuses broadcasting unless the same fully signed transaction passed online. */
export async function assertCrowdCellFinalizePreflight(options) {
  const result = await preflightCrowdCellFinalize(options);
  if (!result.allowed) throw new CellGuardPolicyError(result);
  return result;
}

/**
 * Optional Node-side CrowdCell keeper glue. The caller constructs/fee-completes
 * the transaction. We deliberately sign ONCE, preflight THAT signed object, and
 * broadcast the SAME object through the CCC client only after PASS.
 * Do not use a signer.sendTransaction(tx) here: it signs+broadcasts in one step.
 */
export async function signGuardAndSendCrowdCellFinalize({transaction,signer,policy,expectedCampaignType,rpc}) {
  if (typeof signer?.signTransaction !== 'function' || typeof signer?.client?.sendTransaction !== 'function')
    throw new TypeError('CCC signer.signTransaction and signer.client.sendTransaction are required');
  const signed = await signer.signTransaction(transaction);
  const guard = await assertCrowdCellFinalizePreflight({transaction:signed,policy,expectedCampaignType,network:'testnet',rpc});
  const txHash = await signer.client.sendTransaction(signed);
  return {txHash,guard};
}
