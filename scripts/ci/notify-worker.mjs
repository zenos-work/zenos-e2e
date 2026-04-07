#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const reportDir = process.env.E2E_REPORT_OUTPUT_DIR || path.join(process.cwd(), 'artifacts', 'email');
const workerUrl = process.env.CF_E2E_WORKER_URL || process.env.CF_JOBS_WORKER_URL;
const notifySecret = process.env.CF_E2E_NOTIFY_SECRET || process.env.CF_JOBS_NOTIFY_SECRET;

if (!workerUrl || !notifySecret) {
  console.log('Notification skipped: worker URL/secret env vars are missing (CF_E2E_WORKER_URL + CF_E2E_NOTIFY_SECRET).');
  process.exit(0);
}

const html = fs.readFileSync(path.join(reportDir, 'email-report.html'), 'utf8');
const text = fs.readFileSync(path.join(reportDir, 'email-report.txt'), 'utf8');
const metadata = JSON.parse(fs.readFileSync(path.join(reportDir, 'email-metadata.json'), 'utf8'));

const response = await fetch(`${workerUrl.replace(/\/$/, '')}/notify`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-trigger-secret': notifySecret,
  },
  body: JSON.stringify({
    subject: metadata.subject,
    html,
    text,
  }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`Failed to send notification via worker (${response.status}): ${body}`);
  process.exit(1);
}

console.log('Notification sent via Cloudflare Worker.');
