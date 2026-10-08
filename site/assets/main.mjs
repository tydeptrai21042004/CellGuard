import { analyzeTransaction } from './lib/analyzer.mjs';
import { DEFAULT_POLICY } from './lib/policy.mjs';
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
const MAX_JSON_BYTES = 1024 * 1024;
let currentReport = null;
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
function invalidateReport() {
  currentReport = null;
  copy.disabled = true;
  download.disabled = true;
  metrics.replaceChildren(); metrics.hidden = true;
  checks.replaceChildren(); checks.hidden = true;
  findings.replaceChildren(); findings.hidden = true;
  outputsBody.replaceChildren(); outputs.hidden = true;
  scope.hidden = true;
  statusView('idle', 'Inputs modified', 'Run inspect json to analyze the updated transaction and policy.');
}
function updateSource(label) {
  currentSource = label;
  $('session-label').textContent = `local session · ${label}`;
}
function fixture(name) {
  const selected = { safe: SAFE_TRANSACTION, risk: RISK_TRANSACTION, type: TYPE_TRANSACTION }[name];
  if (!selected) throw new Error('Unknown example fixture');
  txInput.value = json(selected);
  policyInput.value = json(DEMO_POLICY);
  updateSource(`synthetic ${name} fixture`);
  invalidateReport();
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
function renderReport(report, durationMs) {
  const failed = report.errorCount > 0;
  const warned = report.warningCount > 0;
  const result = failed ? 'policy failed' : warned ? 'review needed' : 'policy passed';
  statusView(failed ? 'fail' : warned ? 'warn' : 'pass',
    failed ? 'Policy violations found' : warned ? 'Policy requires review' : 'Configured policy checks passed',
    `${report.errorCount} errors · ${report.warningCount} warnings · ${report.outputCount} outputs · ${durationMs.toFixed(1)}ms local analysis · ${currentSource}`);

  metrics.replaceChildren(
    metric('Policy result', result), metric('Total output capacity', `${report.totalCapacityCKB} CKB`),
    metric('Output data', `${report.totalDataBytes} bytes`), metric('Findings', String(report.findings.length))
  );
  metrics.hidden = false;
  checks.replaceChildren(
    checkRow('occupied capacity', report.checks.capacity),
    checkRow('lock script policy', report.checks.lockPolicy),
    checkRow('type script policy', report.checks.typePolicy),
    checkRow('other policy limits', report.checks.constraints)
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
      findings.append(article);
    }
    findings.hidden = false;
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
    ['warning', 'verification: NOT VERIFIED on chain (no RPC, signatures, input or VM execution)']
  ];
  promptEcho($('command-input').value.trim() || 'inspect json', lines);
}
function parseJSON(input, name) {
  if (new Blob([input]).size > MAX_JSON_BYTES) throw new Error(`${name} exceeds the 1 MiB limit`);
  try { return JSON.parse(input); }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`${name}: ${reason}`);
  }
}
function doInspect(command, fixtureName) {
  if (fixtureName !== 'json') fixture(fixtureName);
  const start = performance.now();
  const report = analyzeTransaction(parseJSON(txInput.value, 'Transaction JSON'), parseJSON(policyInput.value, 'Policy JSON'));
  const elapsed = performance.now() - start;
  currentReport = { ...report, analyzerVersion: '0.2.0', source: currentSource, generatedAt: new Date().toISOString() };
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
  const parsed = parseTerminalCommand(command);
  switch (parsed.action) {
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
      fixture(parsed.fixture);
      promptEcho(command, [['good', `loaded ${currentSource}`], ['comment', 'run inspect json to evaluate the loaded inputs']]);
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
        ['plain', 'policy                      open editable JSON workbench'],
        ['plain', 'examples                    list synthetic examples'],
        ['plain', 'status                      show verification coverage'],
        ['plain', 'report                      show last report availability'],
        ['plain', 'clear                       clear the current report'],
        ['warning', 'Hash lookup and cycle counts are unavailable offline. No on-chain validity is asserted.']
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
      promptEcho(command, [['good', 'mode: offline browser preflight'], ['plain', 'covered: output structure, occupied capacity, configured policy'], ['warning', 'not verified: tx hash lookup, chain state, input cells, fees, witnesses, signature validity, CKB-VM, cycles'], ['comment', 'network: none · wallet: none · server storage: none']]);
      break;
    case 'report':
      promptEcho(command, [['plain', currentReport ? `report ready: ${currentReport.result} (${currentReport.outputCount} outputs)` : 'no report · run inspect first'], ['comment', 'use copy JSON or export report after a successful analysis']]);
      break;
    case 'hash-unsupported':
      promptEcho(command, [['error', 'error: transaction-hash lookup is unavailable in offline mode'], ['comment', 'paste the raw transaction JSON into the workbench and run inspect json'], ['warning', 'CellGuard deliberately does not invent block height, script cycles, or RPC results']]);
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
$('load-safe').addEventListener('click', () => { fixture('safe'); commandInput.value = 'inspect json'; });
$('load-risk').addEventListener('click', () => { fixture('risk'); commandInput.value = 'inspect json'; });
$('reset-policy').addEventListener('click', () => {
  policyInput.value = json(DEFAULT_POLICY);
  invalidateReport();
  promptEcho('policy reset', [['good', 'policy reset to default (no allowlist restrictions)']]);
});
txInput.addEventListener('input', () => { updateSource('edited transaction JSON'); invalidateReport(); });
policyInput.addEventListener('input', invalidateReport);
$('upload-trigger').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  if (file.size > MAX_JSON_BYTES) {
    invalidateReport();
    statusView('fail', 'File too large', 'Transaction JSON must be at most 1 MiB.');
    return;
  }
  try {
    const body = await file.text();
    parseJSON(body, 'Uploaded JSON');
    txInput.value = body;
    updateSource(`uploaded ${file.name.slice(0, 80)}`);
    invalidateReport();
    promptEcho('upload transaction.json', [['good', 'JSON loaded · run inspect json to evaluate it']]);
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
fixture('safe');
runCommand('inspect safe');
