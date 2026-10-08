import { analyzeTransaction } from './lib/analyzer.mjs';
import { DEFAULT_POLICY } from './lib/policy.mjs';
import { SAFE_TRANSACTION, RISK_TRANSACTION, DEMO_POLICY } from './lib/fixtures.mjs';

const $ = (id) => document.getElementById(id);
const txInput = $('transaction-input');
const policyInput = $('policy-input');
const status = $('status');
const findings = $('findings');
const metrics = $('metrics');
const outputs = $('outputs');
const outputsBody = $('outputs-body');
const download = $('download-report');
let currentReport = null;

function json(value) { return JSON.stringify(value, null, 2); }
function element(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== undefined) node.textContent = String(textValue);
  return node;
}
function updateStatus(kind, title, message) {
  status.className = `status ${kind}`;
  status.replaceChildren(
    element('div', 'status-icon', kind === 'pass' ? '✓' : kind === 'fail' ? '!' : kind === 'warn' ? '!' : 'i'),
    (() => { const box = element('div'); box.append(element('strong', '', title), element('span', '', message)); return box; })()
  );
}
function resetResult() {
  currentReport = null;
  download.disabled = true;
  metrics.replaceChildren();
  metrics.hidden = true;
  findings.replaceChildren();
  outputsBody.replaceChildren();
  outputs.hidden = true;
  updateStatus('idle', 'Inputs changed', 'Nhấn “Phân tích giao dịch” để cập nhật báo cáo.');
}
function renderReport(report) {
  const isFail = report.errorCount > 0;
  const isWarn = report.warningCount > 0;
  updateStatus(isFail ? 'fail' : isWarn ? 'warn' : 'pass',
    isFail ? 'Policy checks failed' : isWarn ? 'Review required' : 'Configured checks passed',
    `${report.errorCount} lỗi · ${report.warningCount} cảnh báo. Đây không phải kết luận về tính hợp lệ on-chain.`
  );
  metrics.replaceChildren();
  for (const [label, value] of [
    ['Outputs', report.outputCount], ['Tổng capacity', `${report.totalCapacityCKB} CKB`],
    ['Dữ liệu output', `${report.totalDataBytes} bytes`], ['Findings', report.findings.length]
  ]) {
    const card = element('div', 'metric');
    card.append(element('span', '', label), element('strong', '', value));
    metrics.append(card);
  }
  metrics.hidden = false;
  findings.replaceChildren(element('h3', '', 'Policy findings'));
  if (!report.findings.length) findings.append(element('div', 'empty-finding', 'Không tìm thấy vi phạm trong các quy tắc được triển khai. Không thay thế xác thực consensus.'));
  for (const item of report.findings) {
    const card = element('article', `finding ${item.severity}`);
    const head = element('div', 'finding-head');
    head.append(element('strong', '', item.code), element('code', '', item.path));
    card.append(head, element('p', '', item.detail));
    findings.append(card);
  }
  outputsBody.replaceChildren();
  for (const out of report.outputs) {
    const tr = element('tr');
    for (const val of [`#${out.index}`, out.capacityCKB, out.occupiedCKB, out.freeCKB, out.dataBytes]) {
      tr.append(element('td', '', val));
    }
    outputsBody.append(tr);
  }
  outputs.hidden = false;
}
function loadFixture(tx) {
  txInput.value = json(tx);
  policyInput.value = json(DEMO_POLICY);
  resetResult();
}
$('load-safe').addEventListener('click', () => loadFixture(SAFE_TRANSACTION));
$('load-risk').addEventListener('click', () => loadFixture(RISK_TRANSACTION));
$('reset-policy').addEventListener('click', () => { policyInput.value = json(DEFAULT_POLICY); resetResult(); });
txInput.addEventListener('input', resetResult);
policyInput.addEventListener('input', resetResult);
$('file-input').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    resetResult();
    updateStatus('fail', 'File too large', 'Tệp JSON tối đa 1 MiB.');
  } else {
    txInput.value = await file.text();
    resetResult();
  }
  event.currentTarget.value = '';
});
$('analyze').addEventListener('click', () => {
  resetResult();
  try {
    if (new Blob([txInput.value]).size > 1024 * 1024 || new Blob([policyInput.value]).size > 1024 * 1024) {
      throw new Error('Giới hạn tối đa 1 MiB mỗi JSON input');
    }
    const report = analyzeTransaction(JSON.parse(txInput.value), JSON.parse(policyInput.value));
    currentReport = { ...report, generatedAt: new Date().toISOString(), analyzerVersion: '0.1.0' };
    renderReport(currentReport);
    download.disabled = false;
  } catch (error) {
    updateStatus('fail', 'Invalid input', error instanceof Error ? error.message : 'Lỗi không xác định');
  }
});
download.addEventListener('click', () => {
  if (!currentReport) return;
  const blob = new Blob([json(currentReport)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cellguard-report.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
loadFixture(SAFE_TRANSACTION);
