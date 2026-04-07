/**
 * ServiceManager — starts and health-checks backend (Wrangler) and frontend (Vite).
 *
 * Rules:
 *  - Only starts a service if the port is not already listening.
 *  - Backend: cd ../zenos-backend && npx wrangler dev --env dev
 *  - Frontend: cd ../zenos-frontend && pnpm dev --host
 *  - Writes started PIDs to .local-dev/e2e-pids for global-teardown to clean up.
 *  - Retries health check up to 60 seconds before giving up.
 */

import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

const E2E_PROJECT_ROOT = path.join(__dirname, '..', '..');
const ZENOS_ROOT = path.join(E2E_PROJECT_ROOT, '..');
const BACKEND_DIR = path.join(ZENOS_ROOT, 'zenos-backend');
const FRONTEND_DIR = path.join(ZENOS_ROOT, 'zenos-frontend');
const LOCAL_DEV_DIR = path.join(E2E_PROJECT_ROOT, '.local-dev');
const PID_FILE = path.join(LOCAL_DEV_DIR, 'e2e-pids');

function isListening(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(url, (res) => {
      resolve(res.statusCode !== undefined);
      res.destroy();
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

async function waitForUrl(url: string, label: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    if (await isListening(url)) {
      console.log(`✅ ${label} ready at ${url}`);
      return;
    }
    attempt++;
    if (attempt % 5 === 0) {
      process.stdout.write(`⏳ Waiting for ${label}... (${Math.round((Date.now() - start) / 1000)}s)\n`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not become available at ${url} within ${timeoutMs / 1000}s`);
}

function trackPid(pid: number): void {
  fs.mkdirSync(LOCAL_DEV_DIR, { recursive: true });
  const existing = fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf-8') : '';
  fs.writeFileSync(PID_FILE, existing + pid + '\n');
}

function startProcess(cmd: string, args: string[], cwd: string, label: string): ChildProcess {
  const logFile = path.join(LOCAL_DEV_DIR, `${label}.log`);
  fs.mkdirSync(LOCAL_DEV_DIR, { recursive: true });
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const proc = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // detached: true creates a new process group so global-teardown can kill the
    // entire group (npx + wrangler + workerd children) with process.kill(-pid).
    detached: true,
  });

  proc.stdout?.pipe(logStream);
  proc.stderr?.pipe(logStream);

  proc.on('error', (err) => {
    console.error(`❌ Failed to start ${label}: ${err.message}`);
  });

  trackPid(proc.pid!);
  console.log(`🔧 Started ${label} (PID ${proc.pid}). Log: ${logFile}`);
  return proc;
}

export class ServiceManager {
  async ensureBackendReady(apiUrl: string): Promise<void> {
    const healthUrl = `${apiUrl}/health`;

    if (process.env.SKIP_SERVICE_START === 'true') {
      await waitForUrl(healthUrl, 'Backend');
      return;
    }

    if (await isListening(healthUrl)) {
      console.log(`✅ Backend already running at ${apiUrl}`);
      return;
    }

    // Extract port from apiUrl and pass explicitly so wrangler never silently bumps to a different port
    const backendPort = new URL(apiUrl).port || '8787';
    const wranglerArgs = ['wrangler', 'dev', '--env', 'dev', '--port', backendPort];

    // CI E2E runs can auto-mint role tokens from a guarded dev-only endpoint.
    if (process.env.CI === 'true' || process.env.E2E_TEST_AUTH_ENABLED === 'true') {
      wranglerArgs.push('--var', 'E2E_TEST_AUTH_ENABLED:true');
      if (process.env.E2E_TEST_AUTH_SECRET) {
        wranglerArgs.push('--var', `E2E_TEST_AUTH_SECRET:${process.env.E2E_TEST_AUTH_SECRET}`);
      }
    }

    // Start Wrangler dev server
    startProcess('npx', wranglerArgs, BACKEND_DIR, 'backend');
    await waitForUrl(healthUrl, 'Backend', 90_000); // wrangler is slow to start
  }

  async ensureFrontendReady(frontendUrl: string): Promise<void> {
    if (process.env.SKIP_SERVICE_START === 'true') {
      await waitForUrl(frontendUrl, 'Frontend');
      return;
    }

    if (await isListening(frontendUrl)) {
      console.log(`✅ Frontend already running at ${frontendUrl}`);
      return;
    }

    startProcess('pnpm', ['dev', '--host'], FRONTEND_DIR, 'frontend');
    await waitForUrl(frontendUrl, 'Frontend', 60_000);
  }
}
