/**
 * Playwright configuration for Zenos E2E test suite.
 *
 * Reads port configuration from environment (aligned with wrangler.jsonc):
 *   - Backend: http://127.0.0.1:8787  (wrangler dev --env dev default port)
 *   - Frontend: http://localhost:5173  (vite dev default port)
 *
 * Auth strategy:
 *   - global-setup.ts opens a visible browser and asks the user to sign in once
 *     via real Google OAuth. The session is saved to .auth/user.json and reused
 *     by all tests that need authentication.
 *   - CI mode: inject TEST_ACCESS_TOKEN + TEST_REFRESH_TOKEN env vars instead.
 *     global-setup.ts detects this and writes .auth/user.json programmatically.
 */

import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load local env file if present (.env.e2e in zenos-e2e root)
dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '..', 'zenos-frontend', '.env.local') });

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';
const READER_AUTH_STATE_PATH = path.join(__dirname, '.auth', 'reader.json');
const AUTHOR_AUTH_STATE_PATH = path.join(__dirname, '.auth', 'author.json');
const APPROVER_AUTH_STATE_PATH = path.join(__dirname, '.auth', 'approver.json');
const SUPERADMIN_AUTH_STATE_PATH = path.join(__dirname, '.auth', 'superadmin.json');

// Backward-compatible aliases used by older fixtures/imports.
const AUTH_STATE_PATH = AUTHOR_AUTH_STATE_PATH;
const ADMIN_AUTH_STATE_PATH = SUPERADMIN_AUTH_STATE_PATH;

const HEADLESS = process.env.CI === 'true' || process.env.HEADLESS === 'true' || !process.env.DISPLAY;
const ENABLE_ROLE_PROJECTS = process.env.E2E_ENABLE_ROLE_PROJECTS === 'true';

export {
  FRONTEND_URL,
  API_BASE_URL,
  AUTH_STATE_PATH,
  ADMIN_AUTH_STATE_PATH,
  READER_AUTH_STATE_PATH,
  AUTHOR_AUTH_STATE_PATH,
  APPROVER_AUTH_STATE_PATH,
  SUPERADMIN_AUTH_STATE_PATH,
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,           // sequential within project to avoid DB race conditions
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 20_000,                // 20s per test keeps strict checks realistic under serial local CI load
  expect: { timeout: 4_000 },    // 4s for assertions on slower dev-worker responses

  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: HEADLESS,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: {
      // Pass through so backend can identify test traffic in logs
      'X-Test-Suite': 'zenos-e2e',
    },
  },

  projects: [
    // ── Setup projects (run before tests) ───────────────────────────────────
    {
      name: 'setup-regular-user',
      testMatch: /global-setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ── Unauthenticated tests (public pages only) ────────────────────────────
    {
      name: 'public',
      testMatch: /tests\/(00-auth|01-smoke)\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // No storageState — unauthenticated
      },
    },

    // ── Default authenticated suites (author + superadmin) ───────────────────
    {
      name: 'authenticated',
        testMatch: /tests\/(02-articles|03-social|04-comments|07-reading|08-ui|09-api|10-notifications|11-series|12-profile)\/.*\.spec\.ts/,
      dependencies: ['setup-regular-user'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTHOR_AUTH_STATE_PATH,
      },
    },
    {
      name: 'admin',
      testMatch: /tests\/(05-workflow|06-admin)\/.*\.spec\.ts/,
      dependencies: ['setup-regular-user'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: SUPERADMIN_AUTH_STATE_PATH,
      },
    },

    // ── Optional role-isolated projects (opt-in with E2E_ENABLE_ROLE_PROJECTS=true)
    ...(ENABLE_ROLE_PROJECTS
      ? [
          {
            name: 'role-reader',
            testMatch: /tests\/07-reading\/.*\.spec\.ts/,
            dependencies: ['setup-regular-user'],
            use: {
              ...devices['Desktop Chrome'],
              storageState: READER_AUTH_STATE_PATH,
            },
          },
          {
            name: 'role-author',
            testMatch: /tests\/(02-articles|03-social|04-comments|08-ui|09-api|10-notifications|11-series|12-profile)\/.*\.spec\.ts/,
            dependencies: ['setup-regular-user'],
            use: {
              ...devices['Desktop Chrome'],
              storageState: AUTHOR_AUTH_STATE_PATH,
            },
          },
          {
            name: 'role-approver',
            testMatch: /tests\/05-workflow\/.*\.spec\.ts/,
            dependencies: ['setup-regular-user'],
            use: {
              ...devices['Desktop Chrome'],
              storageState: APPROVER_AUTH_STATE_PATH,
            },
          },
          {
            name: 'role-superadmin',
            testMatch: /tests\/06-admin\/.*\.spec\.ts/,
            dependencies: ['setup-regular-user'],
            use: {
              ...devices['Desktop Chrome'],
              storageState: SUPERADMIN_AUTH_STATE_PATH,
            },
          },
        ]
      : []),

    // ── Mobile viewport smoke ────────────────────────────────────────────────
    {
      name: 'mobile-smoke',
      testMatch: /tests\/01-smoke\/.*\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});

export const TEST_ENV = {
  FRONTEND_URL,
  API_BASE_URL,
  AUTH_STATE_PATH,
  ADMIN_AUTH_STATE_PATH,
  READER_AUTH_STATE_PATH,
  AUTHOR_AUTH_STATE_PATH,
  APPROVER_AUTH_STATE_PATH,
  SUPERADMIN_AUTH_STATE_PATH,
};
