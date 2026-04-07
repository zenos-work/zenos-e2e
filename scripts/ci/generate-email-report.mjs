#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.env.E2E_REPO_ROOT || process.cwd();
const runLogDir = path.join(repoRoot, '.local-dev', 'e2e-logs');
const reportJsonPath = path.join(repoRoot, 'e2e', 'playwright-report', 'results.json');
const outputDir = process.env.E2E_REPORT_OUTPUT_DIR || path.join(repoRoot, 'artifacts', 'email');
const runUrl = process.env.GITHUB_RUN_URL || '';
const suite = process.env.E2E_SUITE || 'smoke';
const exitCode = Number(process.env.E2E_EXIT_CODE || '1');

fs.mkdirSync(outputDir, { recursive: true });

function findLatestRunLog() {
  if (!fs.existsSync(runLogDir)) return null;
  const logs = fs
    .readdirSync(runLogDir)
    .filter((name) => /^run-\d{8}-\d{6}\.log$/.test(name))
    .sort()
    .reverse();
  return logs.length ? path.join(runLogDir, logs[0]) : null;
}

function parseCounts(text) {
  const failed = Number((text.match(/\n\s*(\d+) failed\b/) || [])[1] || 0);
  const passed = Number((text.match(/\n\s*(\d+) passed\b/) || [])[1] || 0);
  const skipped = Number((text.match(/\n\s*(\d+) skipped\b/) || [])[1] || 0);
  return { failed, passed, skipped };
}

function parseFailures(text) {
  const lines = text.split('\n');
  const failures = [];
  for (const line of lines) {
    const m = line.match(/^\s*\d+\)\s+\[(.+?)\]\s+›\s+(.+)$/);
    if (!m) continue;
    failures.push(`[${m[1]}] ${m[2]}`);
    if (failures.length >= 12) break;
  }
  return failures;
}

function parseJsonFallback() {
  if (!fs.existsSync(reportJsonPath)) {
    return { passed: 0, failed: exitCode === 0 ? 0 : 1, skipped: 0 };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
    const stats = parsed?.stats || {};
    const passed = Number(stats.expected || 0);
    const failed = Number(stats.unexpected || 0);
    const skipped = Number(stats.skipped || 0);
    return { passed, failed, skipped };
  } catch {
    return { passed: 0, failed: exitCode === 0 ? 0 : 1, skipped: 0 };
  }
}

const latestLog = findLatestRunLog();
const logText = latestLog && fs.existsSync(latestLog) ? fs.readFileSync(latestLog, 'utf8') : '';
const fromLog = parseCounts(logText);
const counts = (fromLog.passed + fromLog.failed + fromLog.skipped) > 0 ? fromLog : parseJsonFallback();
const failures = parseFailures(logText);

const statusLabel = counts.failed === 0 && exitCode === 0 ? 'PASS' : 'FAIL';
const statusColor = statusLabel === 'PASS' ? '#0b7a52' : '#b42318';
const subject = `[Zenos E2E Smoke] ${statusLabel} | passed ${counts.passed}, failed ${counts.failed}, skipped ${counts.skipped}`;

const failHtml = failures.length
  ? `<h3 style="margin:16px 0 8px;">Top failing tests</h3><ul>${failures.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
  : '<p>No failing tests.</p>';

const html = `<!doctype html>
<html>
  <body style="font-family:Arial,Helvetica,sans-serif; color:#111;">
    <h2 style="margin-bottom:8px;">Zenos Smoke E2E Result: <span style="color:${statusColor};">${statusLabel}</span></h2>
    <p style="margin-top:0;">Suite: <b>${escapeHtml(suite)}</b></p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse; border-color:#ddd;">
      <tr><th align="left">Passed</th><td>${counts.passed}</td></tr>
      <tr><th align="left">Failed</th><td>${counts.failed}</td></tr>
      <tr><th align="left">Skipped</th><td>${counts.skipped}</td></tr>
      <tr><th align="left">Run URL</th><td>${runUrl ? `<a href="${escapeHtml(runUrl)}">Open GitHub run</a>` : 'N/A'}</td></tr>
      <tr><th align="left">Run log</th><td>${latestLog ? escapeHtml(path.relative(repoRoot, latestLog)) : 'N/A'}</td></tr>
    </table>
    ${failHtml}
    <p style="margin-top:18px; color:#444;">Full Playwright HTML report is available in the workflow artifact named <b>playwright-report-smoke</b>.</p>
  </body>
</html>`;

const text = [
  `Zenos Smoke E2E Result: ${statusLabel}`,
  `Suite: ${suite}`,
  `Passed: ${counts.passed}`,
  `Failed: ${counts.failed}`,
  `Skipped: ${counts.skipped}`,
  runUrl ? `Run URL: ${runUrl}` : 'Run URL: N/A',
  latestLog ? `Run log: ${path.relative(repoRoot, latestLog)}` : 'Run log: N/A',
  '',
  failures.length ? `Top failing tests:\n- ${failures.join('\n- ')}` : 'No failing tests.',
].join('\n');

fs.writeFileSync(path.join(outputDir, 'email-report.html'), html, 'utf8');
fs.writeFileSync(path.join(outputDir, 'email-report.txt'), text, 'utf8');
fs.writeFileSync(
  path.join(outputDir, 'email-metadata.json'),
  JSON.stringify({ subject, statusLabel, counts, suite, runUrl }, null, 2),
  'utf8',
);

console.log(`Generated email report at ${outputDir}`);

function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
