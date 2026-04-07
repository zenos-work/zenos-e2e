/**
 * global-setup.ts
 *
 * Runs ONCE before all tests. Responsibilities:
 *   1. Start the Wrangler dev server (backend) if not already running.
 *   2. Start the Vite dev server (frontend) if not already running.
 *   3. Wait for both services to be healthy.
 *   4. Obtain authenticated sessions for a regular user AND an admin user.
 *
 * Auth capture — two modes:
 *
 *  [Interactive mode — local dev]
 *    If .auth/user.json is missing or >23h old, opens a real browser window
 *    and prints instructions to sign in with Google. Waits up to 3 minutes.
 *    After successful sign-in, saves storageState to .auth/user.json.
 *    Repeat for admin session (.auth/admin.json) if ADMIN_EMAIL is different
 *    from the regular user.
 *
 *  [CI mode — non-interactive]
 *    Preferred: calls backend /auth/test/token (dev-only) to mint tokens at
 *    runtime for required roles. If explicit TEST_* tokens are provided, those
 *    are used instead. No interactive Google sign-in is needed.
 *
 * The session file is valid for 23 hours. After that, a new sign-in is needed.
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceManager } from './utils/service-manager';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';
const AUTH_DIR = path.join(__dirname, '.auth');
const READER_STATE_PATH = path.join(AUTH_DIR, 'reader.json');
const AUTHOR_STATE_PATH = path.join(AUTH_DIR, 'author.json');
const APPROVER_STATE_PATH = path.join(AUTH_DIR, 'approver.json');
const SUPERADMIN_STATE_PATH = path.join(AUTH_DIR, 'superadmin.json');

// Backward-compatible aliases used by older configs/scripts.
const USER_STATE_PATH = AUTHOR_STATE_PATH;
const ADMIN_STATE_PATH = SUPERADMIN_STATE_PATH;

const SESSION_TTL_HOURS = 23;
const SIGNIN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for user to sign in
const E2E_TOKEN_ENDPOINT = `${API_BASE_URL}/auth/test/token`;
const TOKEN_MINT_ATTEMPTS = 4;
const TOKEN_MINT_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

type Role = 'READER' | 'AUTHOR' | 'APPROVER' | 'SUPERADMIN';
type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
};

function isStateFresh(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  const ageMs = Date.now() - stat.mtimeMs;
  return ageMs < SESSION_TTL_HOURS * 60 * 60 * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableMintFailure(status: number, bodyText: string): boolean {
  return TOKEN_MINT_RETRYABLE_STATUS.has(status)
    || /worker restarted|timeout|temporar|try again|unavailable/i.test(bodyText);
}

async function injectCITokens(
  context: BrowserContext,
  accessToken: string,
  refreshToken: string,
  savePath: string,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(FRONTEND_URL);

  // Persist tokens in localStorage because Playwright storageState restores
  // localStorage across new contexts, but not sessionStorage.
  await page.evaluate(
    ([at, rt]) => {
      localStorage.setItem('access_token', at);
      localStorage.setItem('refresh_token', rt);
      sessionStorage.setItem('access_token', at);
      sessionStorage.setItem('refresh_token', rt);
    },
    [accessToken, refreshToken],
  );

  // Verify the token actually works against the real backend
  const response = await page.request.get(`${API_BASE_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok()) {
    throw new Error(
      `CI token validation failed: GET /api/users/me → ${response.status()}. ` +
        'Check TEST_ACCESS_TOKEN is valid for the configured backend.',
    );
  }

  const payload = await response.json() as Record<string, unknown>;
  const user = (payload.user as Record<string, unknown> | undefined) ?? payload;
  const email = typeof user.email === 'string' ? user.email : 'unknown-email';
  const role = typeof user.role === 'string' ? user.role : 'unknown-role';
  console.log(`\n✅ CI auth: signed in as ${email} (role: ${role})`);

  // Save storageState immediately — tokens are in sessionStorage and validated.
  // We save BEFORE any further navigation so the app's AuthContext cannot
  // clear the tokens during a re-render/re-fetch cycle.
  await context.storageState({ path: savePath });
  await page.close();
}

async function interactiveSignIn(
  browser: Browser,
  savePath: string,
  label: string,
): Promise<void> {
  // Open headed browser so the user can interact
  const context = await browser.newContext({ headless: false } as Parameters<typeof browser.newContext>[0]);
  const page = await context.newPage();

  await page.goto(`${FRONTEND_URL}/login`);

  console.log('\n' + '═'.repeat(60));
  console.log(`🔐  SIGN IN REQUIRED — ${label}`);
  console.log('═'.repeat(60));
  console.log(`  1. The browser window is now open at ${FRONTEND_URL}/login`);
  console.log('  2. Click "Sign in with Google" and complete the OAuth flow.');
  console.log('  3. Once you land on the home page, this script will continue.');
  console.log(`  4. You have ${SIGNIN_TIMEOUT_MS / 60000} minutes.`);
  console.log('═'.repeat(60) + '\n');

  // Wait until the user is redirected away from /login and
  // the access_token is in sessionStorage (AuthContext has set it)
  await page.waitForFunction(
    () => sessionStorage.getItem('access_token') !== null,
    { timeout: SIGNIN_TIMEOUT_MS },
  );

  const token = await page.evaluate(() => sessionStorage.getItem('access_token') ?? '');
  const response = await page.request.get(`${API_BASE_URL}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const user = await response.json();
  console.log(`✅ Signed in as ${user.email} (role: ${user.role})`);

  // Save full storageState (includes sessionStorage)
  await context.storageState({ path: savePath });
  await context.close();
}

async function requestRuntimeTokens(role: Role): Promise<IssuedTokens> {
  const payload = { role };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.E2E_TEST_AUTH_SECRET) {
    headers['x-e2e-auth-secret'] = process.env.E2E_TEST_AUTH_SECRET;
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= TOKEN_MINT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(E2E_TOKEN_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const retryable = isRetryableMintFailure(response.status, bodyText);
        if (retryable && attempt < TOKEN_MINT_ATTEMPTS) {
          await sleep(500 * attempt);
          continue;
        }

        throw new Error(
          `Failed to mint runtime ${role} tokens from ${E2E_TOKEN_ENDPOINT} ` +
          `(${response.status}). ${bodyText || 'Check backend dev test-auth settings.'}`,
        );
      }

      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string;
      };

      if (!data.access_token || !data.refresh_token) {
        throw new Error(`Token endpoint did not return access_token/refresh_token for role ${role}.`);
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      };
    } catch (error) {
      lastError = error;
      if (attempt < TOKEN_MINT_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to mint runtime ${role} tokens from ${E2E_TOKEN_ENDPOINT}`);
}

async function resolveTokensForRole(role: Role, kind: 'regular' | 'admin' | 'none' = 'none'): Promise<IssuedTokens> {
  if (kind === 'regular' && process.env.TEST_ACCESS_TOKEN && process.env.TEST_REFRESH_TOKEN) {
    console.log('\n📋 CI mode: using provided TEST_ACCESS_TOKEN/TEST_REFRESH_TOKEN.');
    return {
      accessToken: process.env.TEST_ACCESS_TOKEN,
      refreshToken: process.env.TEST_REFRESH_TOKEN,
    };
  }

  if (kind === 'admin' && process.env.TEST_ADMIN_ACCESS_TOKEN && process.env.TEST_ADMIN_REFRESH_TOKEN) {
    console.log('📋 CI mode: using provided TEST_ADMIN_ACCESS_TOKEN/TEST_ADMIN_REFRESH_TOKEN.');
    return {
      accessToken: process.env.TEST_ADMIN_ACCESS_TOKEN,
      refreshToken: process.env.TEST_ADMIN_REFRESH_TOKEN,
    };
  }

  console.log(`📋 CI mode: minting runtime tokens for role ${role}...`);
  return requestRuntimeTokens(role);
}

async function writeRoleState(role: Role, savePath: string, kind: 'regular' | 'admin' | 'none' = 'none'): Promise<void> {
  const tokens = await resolveTokensForRole(role, kind);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await injectCITokens(context, tokens.accessToken, tokens.refreshToken, savePath);
  await browser.close();
}

export default async function globalSetup(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // ── 1. Start services ─────────────────────────────────────────────────────
  const svcManager = new ServiceManager();
  await svcManager.ensureBackendReady(API_BASE_URL);
  await svcManager.ensureFrontendReady(FRONTEND_URL);

  const isCI = process.env.CI === 'true' || !!process.env.TEST_ACCESS_TOKEN || !!process.env.TEST_REFRESH_TOKEN;

  // ── 2. Author/session states (legacy regular-user + role files) ─────────
  const authorStateReady = isStateFresh(AUTHOR_STATE_PATH);
  const readerStateReady = isStateFresh(READER_STATE_PATH);
  const approverStateReady = isStateFresh(APPROVER_STATE_PATH);
  const superadminStateReady = isStateFresh(SUPERADMIN_STATE_PATH);

  if (isCI) {
    try {
      await writeRoleState('AUTHOR', AUTHOR_STATE_PATH, 'regular');
      await writeRoleState('READER', READER_STATE_PATH);
      await writeRoleState('APPROVER', APPROVER_STATE_PATH);
      await writeRoleState('SUPERADMIN', SUPERADMIN_STATE_PATH, 'admin');
    } catch (error) {
      const hasFreshCachedStates = authorStateReady && readerStateReady && approverStateReady && superadminStateReady;
      if (!hasFreshCachedStates) {
        throw error;
      }

      console.warn('\n⚠️  Runtime CI token minting failed; reusing fresh cached .auth states.');
      console.warn('   If this keeps happening, restart backend via run-e2e without pre-running services so E2E test-auth vars are applied.\n');
    }
  } else if (!authorStateReady) {
    // Interactive mode — ask user to sign in for author state
    const browser = await chromium.launch({ headless: false, slowMo: 50 });
    await interactiveSignIn(browser, AUTHOR_STATE_PATH, 'Author User');
    await browser.close();
  } else {
    console.log('\n✅ Author user session loaded from cache (< 23h old).');
  }

  // ── 3. Superadmin state for admin suites in non-CI mode ──────────────────
  if (!isCI) {
    if (!superadminStateReady) {
      console.log('\n⚠️  No superadmin session found.');
      console.log('   Admin tests require an APPROVER or SUPERADMIN account.');
      console.log('   Sign in with an admin account next:\n');
      const browser = await chromium.launch({ headless: false, slowMo: 50 });
      await interactiveSignIn(browser, SUPERADMIN_STATE_PATH, 'Superadmin / Approver User');
      await browser.close();
    } else {
      console.log('✅ Superadmin user session loaded from cache (< 23h old).');
    }

    // If role-specific local states are missing, copy baseline states for convenience.
    // CI creates true per-role tokens; local interactive mode keeps existing UX.
    if (!isStateFresh(READER_STATE_PATH) && fs.existsSync(AUTHOR_STATE_PATH)) {
      fs.copyFileSync(AUTHOR_STATE_PATH, READER_STATE_PATH);
    }
    if (!isStateFresh(APPROVER_STATE_PATH) && fs.existsSync(SUPERADMIN_STATE_PATH)) {
      fs.copyFileSync(SUPERADMIN_STATE_PATH, APPROVER_STATE_PATH);
    }
  }

  // Legacy compatibility paths
  if (AUTHOR_STATE_PATH !== USER_STATE_PATH && fs.existsSync(AUTHOR_STATE_PATH)) {
    fs.copyFileSync(AUTHOR_STATE_PATH, USER_STATE_PATH);
  }
  if (SUPERADMIN_STATE_PATH !== ADMIN_STATE_PATH && fs.existsSync(SUPERADMIN_STATE_PATH)) {
    fs.copyFileSync(SUPERADMIN_STATE_PATH, ADMIN_STATE_PATH);
  }

  console.log('\n🚀 Global setup complete. Running tests...\n');
}
