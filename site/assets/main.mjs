import { analyzeTransaction } from './lib/analyzer.mjs';
import { DEFAULT_POLICY, V2_POLICY } from './lib/policy.mjs';
import { parseStrictJSON, MAX_JSON_BYTES } from './lib/strict-json.mjs';
import { compareTransactions } from './lib/diff.mjs';
import { parseTransaction } from './lib/ckb.mjs';
import { SAFE_TRANSACTION, RISK_TRANSACTION, TYPE_TRANSACTION, DEMO_POLICY } from './lib/fixtures.mjs';
import { parseTerminalCommand } from './lib/terminal.mjs';

const $ = id => document.getElementById(id);
const txInput = $('transaction-input');
const policyInput = $('policy-input');
const commandInput = $('command-input');
const consoleOutput = $('console-output');
const status = $('status');
const metrics = $('metrics');
const checks = $('checks');
const findings = $('findings');
const outputs = $('outputs');
const outputsBody = $('outputs-body');
const scope = $('scope-line');
const download = $('download-report');
const copy = $('copy-report');
const compareInput = $('compare-input');
const diffResults = $('diff-results');
const filterInput = $('finding-filter');
const findingsTools = $('findings-tools');
const STRICT_DEMO_POLICY = Object.freeze({
  ...V2_POLICY, ...DEMO_POLICY, version: 2, strictTransactionShape: true, requireAllowedLock: true,
  requiredOutputs: [{ lock: DEMO_POLICY.allowedLockScripts[0], type: null, minCapacityCKB: '61', maxCapacityCKB: '100', minCount: 2, maxCount: 2 }]
});
let lastLoadedTexts = null;
let undoReplacement = null;
let editRevision = 0;
let uploadSequence = 0;
let currentReport = null;
let pendingNetwork = null;
let onlineRevision = 0;
let currentOnlineReport = null;
let currentSource = 'synthetic safe fixture';
const history = [];
let historyIndex = 0;

const json = value => JSON.stringify(value, null, 2);
const text = (tag, className = '', value = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value);
  return node;
};
function terminalMessage(rows) {
  consoleOutput.replaceChildren();
  for (const [kind, message] of rows) {
    const row = text('p', `console-line ${kind}`, message);
    consoleOutput.append(row);
  }
}
function promptEcho(cmd, lines) {
  terminalMessage([['prompt', `builder@cellguard:~$ ${cmd}`], ...lines]);
}
function statusView(kind, heading, message) {
  status.className = `status ${kind}`;
  status.replaceChildren();
  const icon = text('span', 'status-icon', kind === 'pass' ? '✓' : kind === 'fail' ? '×' : kind === 'warn' ? '!' : 'i');
  icon.setAttribute('aria-hidden', 'true');
  const content = text('div', 'status-content');
  content.append(text('strong', '', heading), text('p', '', message));
  status.append(icon, content);
}
function onlineStatus(kind, heading, message) {
  const el = $('online-status');
  el.className = `status ${kind}`;
  el.replaceChildren();
  const marker = text('span', 'status-icon', kind === 'pass' ? '✓' : kind === 'fail' ? '×' : kind === 'warn' ? '!' : 'i');
  marker.setAttribute('aria-hidden', 'true');
  const content = text('div', 'status-content');
  content.append(text('strong', '', heading), text('p', '', message));
  el.append(marker, content);
}
function invalidateOnline() {
  onlineRevision++;
  if (pendingNetwork) { pendingNetwork.abort(); pendingNetwork = null; }
  currentOnlineReport = null;
  if (['online-preflight', 'chain-lookup', 'committed-audit'].includes(currentReport?.mode)) { currentReport = null; copy.disabled = true; download.disabled = true; }
  $('online-details').replaceChildren(); $('online-details').hidden = true;
  $('verify-online').disabled = false; $('lookup-online').disabled = false; $('audit-online').disabled = false; $('cancel-online').disabled = true;
  onlineStatus('idle', 'Awaiting live verification', 'Previous RPC result cleared because the request or network changed.');
}
function invalidateReport() {
  currentReport = null;
  copy.disabled = true;
  download.disabled = true;
  metrics.replaceChildren(); metrics.hidden = true;
  checks.replaceChildren(); checks.hidden = true;
  findings.replaceChildren(); findings.hidden = true;
  findingsTools.hidden = true;
  diffResults.replaceChildren(); diffResults.hidden = true;
  outputsBody.replaceChildren(); outputs.hidden = true;
  scope.hidden = true;
  statusView('idle', 'Inputs modified', 'Run inspect json to analyze the updated transaction and policy.');
}
function updateSource(label) {
  currentSource = label;
  $('session-label').textContent = `local session · ${label}`;
}
function isModifiedFromLastLoad() {
  return !!lastLoadedTexts && (txInput.value !== lastLoadedTexts.tx || policyInput.value !== lastLoadedTexts.policy);
}
function applyReplacement(nextTx, nextPolicy, label, { ask = true } = {}) {
  const replacing = txInput.value !== nextTx || policyInput.value !== nextPolicy;
  if (ask && replacing && isModifiedFromLastLoad() && !window.confirm('Replace the edited transaction/policy? Unsaved edits will be replaced. Use Undo replacement to restore them.')) return false;
  if (replacing) {
    undoReplacement = { tx: txInput.value, policy: policyInput.value, source: currentSource };
    $('undo-replace').disabled = false;
  }
  txInput.value = nextTx;
  policyInput.value = nextPolicy;
  lastLoadedTexts = { tx: nextTx, policy: nextPolicy };
  editRevision++;
  invalidateOnline();
  updateSource(label);
  invalidateReport();
  return true;
}
function fixture(name, options = {}) {
  const selected = { safe: SAFE_TRANSACTION, risk: RISK_TRANSACTION, type: TYPE_TRANSACTION }[name];
  if (!selected) throw new Error('Unknown example fixture');
  return applyReplacement(json(selected), json(DEMO_POLICY), `synthetic ${name} fixture`, options);
}
function undoLastReplacement() {
  if (!undoReplacement) return false;
  const before = undoReplacement;
  undoReplacement = null;
  $('undo-replace').disabled = true;
  txInput.value = before.tx;
  policyInput.value = before.policy;
  lastLoadedTexts = { tx: before.tx, policy: before.policy };
  editRevision++;
  invalidateOnline();
  updateSource(before.source);
  invalidateReport();
  return true;
}
function metric(name, value) {
  const node = text('div', 'metric');
  node.append(text('span', 'metric-label', name), text('strong', '', value));
  return node;
}
function checkRow(label, passed) {
  const row = text('div', `check-item ${passed ? 'good' : 'bad'}`);
  row.append(text('span', '', label), text('strong', '', passed ? 'ok' : 'failed'));
  return row;
}
function shortened(hash) {
  return hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : '—';
}
const REPAIR_HINTS = Object.freeze({
  CAPACITY_INSUFFICIENT: 'Increase the output capacity or reduce the occupied script/data bytes.',
  POLICY_LOCK_NOT_ALLOWED: 'Review this lock code hash against the application allowlist.',
  POLICY_LOCK_SCRIPT_NOT_ALLOWED: 'Check all three lock fields: code_hash, hash_type and args.',
  POLICY_TYPE_REQUIRED: 'Set an authorized type script for this output, or disable the requirement intentionally.',
  POLICY_REQUIRED_OUTPUT_COUNT: 'Check recipient lock, optional type, allowed amount range and required count.',
  POLICY_REQUIRED_OUTPUT_CAPACITY: 'Correct the output amount to the configured recipient range.',
  TRANSACTION_UNCHECKED_FIELDS: 'Review ignored properties or turn on v2 strictTransactionShape.',
  POLICY_TOTAL_CAPACITY: 'Reduce total output capacity or increase the explicit policy budget.',
  POLICY_DATA_TOO_LARGE: 'Reduce output data bytes or raise the application limit deliberately.'
});
function renderReport(report, durationMs) {
  const failed = report.errorCount > 0;
  const warned = report.warningCount > 0;
  const result = failed ? 'policy failed' : warned ? 'review needed' : 'policy passed';
  statusView(failed ? 'fail' : warned ? 'warn' : 'pass',
    failed ? 'Policy violations found' : warned ? 'Policy requires review' : 'Configured policy checks passed',
    `${report.errorCount} errors · ${report.warningCount} warnings · ${report.outputCount} outputs · ${durationMs.toFixed(1)}ms local analysis · ${currentSource}`);

  metrics.replaceChildren(
    metric('Policy result', result), metric('Total output capacity', `${report.totalCapacityCKB} CKB`),
    metric('Free capacity', `${report.totalFreeCapacityCKB} CKB`),
    metric('Output data', `${report.totalDataBytes} bytes`), metric('Findings', String(report.findings.length))
  );
  metrics.hidden = false;
  checks.replaceChildren(
    checkRow('occupied capacity', report.checks.capacity),
    checkRow('lock script policy', report.checks.lockPolicy),
    checkRow('type script policy', report.checks.typePolicy),
    checkRow('other policy limits', report.checks.constraints),
    ...(report.policyVersion >= 2 ? [checkRow('recipient intent rules', report.checks.intent)] : [])
  );
  checks.hidden = false;
  findings.replaceChildren();
  if (report.findings.length) {
    const h = text('h3', '', `Findings (${report.findings.length})`);
    findings.append(h);
    for (const item of report.findings) {
      const article = text('article', `finding ${item.severity}`);
      const header = text('div', 'finding-header');
      header.append(text('strong', '', `${item.severity.toUpperCase()} · ${item.code}`), text('code', '', item.path));
      article.append(header, text('p', '', item.detail));
      if (REPAIR_HINTS[item.code]) article.append(text('p', 'finding-tip', `→ ${REPAIR_HINTS[item.code]}`));
      findings.append(article);
    }
    findings.hidden = false;
    findingsTools.hidden = false;
    applyFindingFilter();
  }
  outputsBody.replaceChildren();
  for (const out of report.outputs) {
    const row = text('tr');
    for (const [index, value] of [
      ['index', `#${out.index}`],
      ['lock', `${shortened(out.lockCodeHash)} · ${out.lockHashType}`],
      ['type', out.typeCodeHash ? `${shortened(out.typeCodeHash)} · ${out.typeHashType}` : 'none'],
      ['capacity', out.capacityCKB], ['occupied', out.occupiedCKB], ['free', out.freeCKB], ['data', String(out.dataBytes)]
    ]) {
      const cell = text('td', index, value);
      if (index === 'lock' || index === 'type') cell.title = index === 'lock'
        ? `${out.lockCodeHash}\nhash_type: ${out.lockHashType}\nargs: ${out.lockArgs}`
        : out.typeCodeHash ? `${out.typeCodeHash}\nhash_type: ${out.typeHashType}\nargs: ${out.typeArgs}` : 'No type script';
      row.append(cell);
    }
    outputsBody.append(row);
  }
  outputs.hidden = false;
  scope.hidden = false;
  const lines = [
    ['good', `analysis complete · ${durationMs.toFixed(1)}ms · ${currentSource}`],
    [failed ? 'error' : warned ? 'warning' : 'good', `status: ${result}`],
    [report.checks.capacity ? 'good' : 'error', `capacity checks: ${report.checks.capacity ? 'ok' : 'failed'}`],
    [report.checks.lockPolicy ? 'good' : 'error', `lock policy: ${report.checks.lockPolicy ? 'ok' : 'failed'}`],
    [report.checks.typePolicy ? 'good' : 'error', `type policy: ${report.checks.typePolicy ? 'ok' : 'failed'}`],
    ['warning', 'offline results only; use verify json for RPC input/fee/VM analysis']
  ];
  promptEcho($('command-input').value.trim() || 'inspect json', lines);
}
function parseJSON(input, name) { return parseStrictJSON(input, name); }
function applyFindingFilter() {
  const needle = filterInput.value.toLowerCase().trim();
  for (const item of findings.querySelectorAll('article.finding')) {
    item.hidden = !!needle && !item.textContent.toLowerCase().includes(needle);
  }
}
function renderDiff(report) {
  invalidateReport();
  currentReport = { ...report, source: currentSource, analyzerVersion: '0.5.0', generatedAt: new Date().toISOString() };
  copy.disabled = false;
  download.disabled = false;
  statusView(report.changeCount ? 'warn' : 'pass',
    report.changeCount ? `${report.changeCount} indexed output changes` : 'No indexed output changes detected',
    'Comparison is offline; output data is compared exactly, and output reordering may change indices.');
  for (const change of report.changes) {
    const article = text('article');
    article.append(text('strong', '', change.description), text('p', '', change.path));
    const values = text('div', 'diff-content');
    values.append(text('span', '', 'before: '), text('code', '', change.before), text('span', '', '\nafter:  '), text('code', '', change.after));
    article.append(values);
    diffResults.append(article);
  }
  if (!report.changes.length) diffResults.append(text('p', 'muted', 'Indexed script identifiers, capacities and data lengths are unchanged.'));
  diffResults.hidden = false;
  scope.hidden = false;
  promptEcho('diff', [['good', `comparison complete: ${report.changeCount} changes`], ['warning', 'not an on-chain, input or witness comparison']]);
}
function renderOnlineReport(report) {
  const details = $('online-details'); details.replaceChildren(); details.hidden = false;
  const kind = report.status === 'committed' || report.status === 'pass' ? 'pass'
    : ['fail', 'policy-failed', 'rejected', 'reorg-risk'].includes(report.status) ? 'fail' : 'warn';
  onlineStatus(kind, `${report.mode === 'chain-lookup' ? 'RPC transaction status' : report.mode === 'committed-audit' ? 'Historical policy audit' : 'Live preflight'}: ${report.status.toUpperCase()}`,
    `Network ${report.network} · reported chain ${report.chain} · tip ${report.tip.number} · ${report.observedAt}`);
  const rows = report.mode === 'committed-audit'
    ? [['Transaction hash', report.hash], ['Chain state', report.chainStatus],
       ['Confirmations', report.confirmations ?? 'unknown'],
       ['Policy result', report.status], ['Historical inputs', report.checks?.historicalInputs ?? 'unavailable'],
       ['Capacity-flow evidence', report.capacityFlow?.inputEvidence ?? 'unavailable']]
    : report.mode === 'chain-lookup'
    ? [['Transaction hash', report.hash], ['Block', report.blockHash ?? 'not committed'],
       ['Confirmations', report.confirmations ?? 'not confirmed'], ['Inclusion proof', report.proof ? `${report.proof.status} · ${report.proof.reason}` : 'not available']]
    : [['Input cells', `${report.liveInputCount}/${report.inputCount} live`],
       ['Input capacity', report.inputCapacityCKB === null ? 'unresolved' : `${report.inputCapacityCKB} CKB`],
       ['Output capacity', `${report.outputCapacityCKB} CKB`],
       ['Transaction fee', report.feeCKB === null ? 'unresolved' : `${report.feeCKB} CKB`],
       ['CKB VM', `${report.scripts.status} · ${report.scripts.method ?? 'not executed'}`],
       ['VM cycles', report.scripts.cycles ?? 'not available'],
       ['Node txpool acceptance', `${report.txPool.status} · ${report.txPool.reason}`],
       ['Witness / signature status', report.checks.lockWitnesses.replaceAll('-', ' ')],
       ['On-chain inclusion/finality', 'not established by preflight; use hash lookup after submission']];
  for (const [name, value] of rows) {
    const line = text('p');
    line.append(text('strong', '', name + ': '), text('span', '', value));
    details.append(line);
  }
  if (report.capacityFlow?.roles) for (const [role, amounts] of Object.entries(report.capacityFlow.roles)) {
    details.append(text('p', '', `${role}: input ${amounts.inputCKB} CKB · output ${amounts.outputCKB} CKB · net ${amounts.netCKB} CKB`));
  }
  for (const item of report.findings ?? []) details.append(text('p', `online-${item.severity === 'error' ? 'error' : 'warning'}`, `${item.severity.toUpperCase()} ${item.code}: ${item.detail}`));
  details.append(text('p', 'online-warning', `LIMITATION: ${report.limitations}`));
  promptEcho(report.mode === 'chain-lookup' ? 'lookup' : 'verify json', [
    [kind === 'pass' ? 'good' : kind === 'fail' ? 'error' : 'warning', `read-only ${report.network} RPC: ${report.status}`],
    ['plain', report.mode === 'online-preflight' ? `inputs ${report.liveInputCount}/${report.inputCount}; fee ${report.feeCKB ?? '?'} CKB; VM ${report.scripts.status}; pool ${report.txPool.status}; cycles ${report.scripts.cycles ?? '?'}` : `tx status ${report.status}; confirmations ${report.confirmations ?? '?'}`],
    ['warning', 'No transaction submitted; RPC evidence is not independent chain validation']
  ]);
}
async function callLiveApi(action, payload) {
  if (pendingNetwork) pendingNetwork.abort();
  const controller = new AbortController(); pendingNetwork = controller;
  const snapshot = ++onlineRevision;
  $('verify-online').disabled = true; $('lookup-online').disabled = true; $('audit-online').disabled = true; $('cancel-online').disabled = false;
  onlineStatus('idle', 'Querying CKB node…', 'Requesting chain data from the configured read-only RPC. No transaction is broadcast.');
  try {
    const response = await fetch('/api/verify', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, network: $('network-select').value, ...payload }), signal: controller.signal
    });
    const result = await response.json();
    if (snapshot !== onlineRevision) return;
    if (!response.ok || result.error) throw new Error(`${result.error?.code ?? 'HTTP_' + response.status}: ${result.error?.message ?? 'Request failed'}`);
    currentOnlineReport = result;
    currentReport = { ...result, analyzerVersion: '0.5.0' };
    copy.disabled = false; download.disabled = false;
    renderOnlineReport(result);
  } catch (error) {
    if (snapshot !== onlineRevision) return;
    const message = error instanceof Error ? error.message : 'Network request failed';
    onlineStatus('fail', 'Live verification unavailable', message);
    $('online-details').replaceChildren(); $('online-details').hidden = true;
    promptEcho(action === 'lookup' ? 'lookup' : 'verify json', [['error', message], ['warning', 'RPC failed or was unreachable; do not infer transaction invalidity from a connectivity error']]);
  } finally {
    if (snapshot === onlineRevision) {
      pendingNetwork = null;
      $('verify-online').disabled = false; $('lookup-online').disabled = false; $('audit-online').disabled = false; $('cancel-online').disabled = true;
    }
  }
}
function verifyOnline() {
  try {
    const tx = parseJSON(txInput.value, 'Transaction JSON');
    const policy = parseJSON(policyInput.value, 'Policy JSON');
    parseTransaction(tx, { strict: true });
    if (!Array.isArray(tx.inputs) || !tx.inputs.length) throw new Error('Synthetic fixture has no input cells. Paste a complete signed CKB transaction first.');
    if (JSON.stringify(tx).length > 262144) throw new Error('Online transaction exceeds 256 KiB');
    void callLiveApi('verify', { transaction: tx, policy });
  } catch (error) { onlineStatus('fail', 'Cannot verify transaction', error instanceof Error ? error.message : 'Invalid JSON'); }
}
function lookupOnline(hash = $('lookup-hash').value.trim()) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) { onlineStatus('fail', 'Invalid transaction hash', 'Expected 0x followed by 64 hex characters.'); return; }
  $('lookup-hash').value = hash;
  void callLiveApi('lookup', { hash });
}
function auditOnline() {
  const hash = $('lookup-hash').value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    onlineStatus('fail', 'Invalid hash', 'A 32-byte transaction hash is required for historical audit.'); return;
  }
  try { void callLiveApi('audit', { hash, policy: parseJSON(policyInput.value, 'Policy JSON') }); }
  catch (error) { onlineStatus('fail', 'Invalid policy', error instanceof Error ? error.message : 'Invalid JSON'); }
}

function doInspect(command, fixtureName) {
  invalidateOnline();
  if (fixtureName !== 'json' && !fixture(fixtureName)) {
    promptEcho(command, [['warning', 'fixture replacement canceled; existing editor content preserved']]);
    return;
  }
  const start = performance.now();
  const report = analyzeTransaction(parseJSON(txInput.value, 'Transaction JSON'), parseJSON(policyInput.value, 'Policy JSON'));
  const elapsed = performance.now() - start;
  currentReport = { ...report, analyzerVersion: '0.5.0', source: currentSource, generatedAt: new Date().toISOString() };
  download.disabled = false;
  copy.disabled = false;
  renderReport(currentReport, elapsed);
  $('command-input').value = command;
}
function showEditor(expanded) {
  $('workbench-content').hidden = !expanded;
  $('toggle-workbench').setAttribute('aria-expanded', String(expanded));
  $('toggle-workbench').replaceChildren(document.createTextNode(expanded ? 'close editor ' : 'open editor '), text('span', '', expanded ? '⌃' : '⌄'));
}
function runCommand(raw) {
  const command = raw.trim() || 'inspect json';
  if (history.at(-1) !== command) history.push(command);
  if (history.length > 40) history.shift();
  historyIndex = history.length;
  commandInput.value = command;
  let parsed;
  try { parsed = parseTerminalCommand(command); }
  catch (error) { promptEcho('command', [['error', error instanceof Error ? error.message : 'Invalid command']]); return; }
  switch (parsed.action) {
    case 'verify-online':
      verifyOnline(); break;
    case 'lookup-online':
      lookupOnline(parsed.hash); break;
    case 'lookup-invalid':
      onlineStatus('fail', 'Invalid lookup', 'Use lookup 0x followed by 64 hex characters.'); break;
    case 'inspect':
      try { doInspect(command, parsed.fixture); }
      catch (error) {
        invalidateReport();
        const message = error instanceof Error ? error.message : 'Unexpected error';
        statusView('fail', 'Invalid input or policy', message);
        promptEcho(command, [['error', `error: ${message}`], ['comment', 'tip: open JSON workbench to inspect and correct your input']]);
      }
      break;
    case 'load':
      if (fixture(parsed.fixture)) promptEcho(command, [['good', `loaded ${currentSource}`], ['comment', 'run inspect json to evaluate the loaded inputs']]);
      else promptEcho(command, [['warning', 'replacement canceled']]);
      break;
    case 'strict-policy':
      if (applyReplacement(txInput.value, json(STRICT_DEMO_POLICY), 'strict policy v2 / local transaction')) {
        promptEcho(command, [['good', 'strict v2 policy loaded; current transaction preserved'], ['comment', 'adjust requiredOutputs and allowlists for your actual application']]);
        showEditor(true);
      } else promptEcho(command, [['warning', 'replacement canceled']]);
      break;
    case 'undo':
      { const restored = undoLastReplacement(); promptEcho(command, [[restored ? 'good' : 'warning', restored ? 'restored previous editor content' : 'no prior replacement to undo']]); }
      break;
    case 'diff':
      try {
        if (!compareInput.value.trim()) { showEditor(true); throw new Error('Paste previous transaction JSON into compare.json first'); }
        renderDiff(compareTransactions(parseJSON(compareInput.value, 'Previous transaction'), parseJSON(txInput.value, 'Current transaction')));
      } catch (error) {
        invalidateReport();
        const message = error instanceof Error ? error.message : 'Cannot compare transactions';
        statusView('fail', 'Comparison failed', message);
        promptEcho(command, [['error', message]]);
      }
      break;
    case 'clear':
      invalidateReport();
      consoleOutput.replaceChildren(text('p', 'console-line comment', '# terminal cleared · local inputs are unchanged'));
      break;
    case 'help':
      promptEcho(command, [
        ['good', 'CellGuard CLI-style web commands'],
        ['plain', 'inspect safe | risk | type    analyze bundled synthetic fixture'],
        ['plain', 'inspect json                analyze transaction.json and policy.json'],
        ['plain', 'load safe | risk | type     load example without running'],
        ['plain', 'load strict                  use v2 strict policy, keeping transaction'],
        ['plain', 'verify json                  run live CKB input/fee/script verification'],
        ['plain', 'lookup 0x<64 hex>            query transaction confirmation status'],
        ['plain', 'diff                         compare current JSON with comparison editor'],
        ['plain', 'undo                         restore editor before last replacement'],
        ['plain', 'policy                      open editable JSON workbench'],
        ['plain', 'examples                    list synthetic examples'],
        ['plain', 'status                      show verification coverage'],
        ['plain', 'report                      show last report availability'],
        ['plain', 'clear                       clear the current report'],
        ['warning', 'Node txpool preflight ≠ confirmed transaction; provide complete signed JSON for live checks.']
      ]);
      break;
    case 'policy':
      showEditor(true); policyInput.focus();
      promptEcho(command, [['good', 'policy.json opened for editing'], ['comment', 'run inspect json to apply the edited policy']]);
      break;
    case 'examples':
      promptEcho(command, [['plain', 'inspect safe  — capacity + full lock script match pass'], ['plain', 'inspect risk  — low capacity, excessive data, forbidden lock'], ['plain', 'inspect type  — output containing a type script'], ['comment', 'all three are synthetic, not confirmed testnet transactions']]);
      break;
    case 'status':
      promptEcho(command, [['good', 'mode: offline policy + optional read-only live CKB RPC'], ['plain', 'local: output structure, occupied capacity, configured policy'], ['plain', 'online: chain network, inputs, fees, VM, node txpool acceptance, existing tx hash status'], ['warning', 'not verified: independent consensus proofs, all custom signature semantics, future txpool acceptance'], ['comment', 'no wallet, no signing, no broadcasting · online transaction data is shared with RPC']]);
      break;
    case 'report':
      promptEcho(command, [['plain', currentReport ? currentReport.mode === 'indexed-output-diff' ? `comparison report ready: ${currentReport.changeCount} indexed changes` : `policy report ready: ${currentReport.result} (${currentReport.outputCount} outputs)` : 'no report · run inspect first'], ['comment', 'use copy JSON or export report after an analysis']]);
      break;
    default:
      promptEcho(command, [['error', `unknown command: ${parsed.input}`], ['comment', 'type help to see supported commands; no OS shell is executed']]);
  }
}
$('command-form').addEventListener('submit', event => { event.preventDefault(); runCommand(commandInput.value); });
for (const btn of document.querySelectorAll('[data-command]')) {
  btn.addEventListener('click', () => runCommand(btn.dataset.command));
}
commandInput.addEventListener('keydown', event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  if (!history.length) return;
  event.preventDefault();
  historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
  commandInput.value = history[historyIndex] ?? '';
});
$('toggle-workbench').addEventListener('click', () => showEditor($('workbench-content').hidden));
$('inspect-json').addEventListener('click', () => runCommand('inspect json'));
$('load-safe').addEventListener('click', () => { if (fixture('safe')) commandInput.value = 'inspect json'; });
$('load-risk').addEventListener('click', () => { if (fixture('risk')) commandInput.value = 'inspect json'; });
$('reset-policy').addEventListener('click', () => {
  if (applyReplacement(txInput.value, json(DEFAULT_POLICY), 'default policy / local transaction')) {
    promptEcho('policy reset', [['warning', 'policy reset to unrestricted defaults; configure allowlists before enforcement']]);
  }
});
txInput.addEventListener('input', () => { editRevision++; invalidateOnline(); updateSource('edited transaction JSON'); invalidateReport(); });
policyInput.addEventListener('input', () => { editRevision++; invalidateOnline(); invalidateReport(); });
compareInput.addEventListener('input', () => { if (currentReport?.mode === 'indexed-output-diff') invalidateReport(); });
filterInput.addEventListener('input', applyFindingFilter);
$('load-strict').addEventListener('click', () => runCommand('load strict'));
$('run-diff').addEventListener('click', () => runCommand('diff'));
$('undo-replace').addEventListener('click', () => runCommand('undo'));
$('verify-online').addEventListener('click', verifyOnline);
$('lookup-online').addEventListener('click', () => lookupOnline());
$('audit-online').addEventListener('click', auditOnline);
$('network-select').addEventListener('change', invalidateOnline);
$('lookup-hash').addEventListener('input', () => { if (['chain-lookup', 'committed-audit'].includes(currentOnlineReport?.mode)) invalidateOnline(); });
$('cancel-online').addEventListener('click', invalidateOnline);
$('compare-current').addEventListener('click', () => {
  if (compareInput.value.trim() && compareInput.value !== txInput.value && !window.confirm('Replace the comparison baseline with the current transaction?')) return;
  compareInput.value = txInput.value;
  if (currentReport?.mode === 'indexed-output-diff') invalidateReport();
  promptEcho('snapshot', [['good', 'saved current transaction in comparison editor (browser memory only)']]);
});
$('upload-trigger').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const startedAt = editRevision;
  const requestId = ++uploadSequence;
  input.value = '';
  if (file.size > MAX_JSON_BYTES) {
    invalidateReport();
    statusView('fail', 'File too large', 'Transaction JSON must be at most 1 MiB.');
    return;
  }
  try {
    const body = await file.text();
    parseJSON(body, 'Uploaded JSON');
    if (editRevision !== startedAt || requestId !== uploadSequence) {
      promptEcho('upload transaction.json', [['warning', 'Upload finished after editor changed; file was not applied']]);
      return;
    }
    if (applyReplacement(body, policyInput.value, `uploaded ${file.name.slice(0, 80)}`)) {
      promptEcho('upload transaction.json', [['good', 'JSON loaded · run inspect json to evaluate it']]);
    } else promptEcho('upload transaction.json', [['warning', 'Upload canceled; editor preserved']]);
  } catch (error) {
    invalidateReport();
    statusView('fail', 'Unable to load JSON', error instanceof Error ? error.message : 'Read failed');
  }
});
for (const editor of [txInput, policyInput]) {
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runCommand('inspect json');
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      // Native Tab navigation stays enabled for accessibility.
    }
  });
}
async function copyReport() {
  if (!currentReport) return;
  try {
    await navigator.clipboard.writeText(json(currentReport));
    promptEcho('report copy', [['good', 'report JSON copied to clipboard']]);
  } catch {
    promptEcho('report copy', [['error', 'clipboard unavailable here · use export report instead']]);
  }
}
copy.addEventListener('click', copyReport);
download.addEventListener('click', () => {
  if (!currentReport) return;
  const blob = new Blob([json(currentReport)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'cellguard-report.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

// Show a working demonstration on first load, always labeled synthetic/offline.
fixture('safe', { ask: false });
undoReplacement = null;
$('undo-replace').disabled = true;
runCommand('inspect json');
