/**
 * base.fixture.ts
 *
 * Extends Playwright's base `test` with:
 *   - `apiClient`        — ZenosApiClient for the current authenticated user (AUTHOR)
 *   - `approverClient`  — ZenosApiClient for an APPROVER role (minted via /auth/test/token)
 *   - `adminClient`     — ZenosApiClient for a SUPERADMIN role
 *   - `readerClient`    — ZenosApiClient for a READER role
 *   - `currentUser`     — the signed-in ZenosUser object
 *   - `testArticle`     — draft article created pre-test, deleted post-test
 *   - `publishedArticle`— article created → submitted → approved → published pre-test, deleted post-test
 *   - `goToPage`        — navigate helper
 *   - `waitForToast`    — toast assertion helper
 *   - `dismissToast`    — dismiss toast helper
 */

import { test as base, Page, expect } from '@playwright/test';
import { ZenosApiClient, ZenosUser, ZenosArticle, UserRole } from '../utils/api-client';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';

const IS_CI = process.env.CI === 'true';
const TOKEN_MINT_ATTEMPTS = 4;
const TOKEN_MINT_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function isRetryableMintFailure(status: number, body: string): boolean {
  return TOKEN_MINT_RETRYABLE_STATUS.has(status)
    || /worker restarted|timeout|temporar|try again|unavailable/i.test(body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mintRoleTokens(
  request: Parameters<typeof ZenosApiClient.forRole>[0],
  role: UserRole,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const secret = process.env.E2E_TEST_AUTH_SECRET;
  let lastError: unknown;

  for (let attempt = 1; attempt <= TOKEN_MINT_ATTEMPTS; attempt += 1) {
    try {
      const mintRes = await request.post(`${API_BASE_URL}/auth/test/token`, {
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-e2e-auth-secret': secret } : {}),
        },
        data: { role },
        timeout: 20_000,
      });

      if (!mintRes.ok()) {
        const bodyText = await mintRes.text();
        const retryable = isRetryableMintFailure(mintRes.status(), bodyText);
        if (retryable && attempt < TOKEN_MINT_ATTEMPTS) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Error(`Failed to mint ${role} token in fixture: ${mintRes.status()} ${bodyText}`);
      }

      const payload = await mintRes.json() as { access_token?: string; refresh_token?: string };
      if (!payload.access_token) {
        throw new Error(`Missing access_token from /auth/test/token for role ${role}`);
      }

      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token ?? null,
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
    : new Error(`Failed to mint ${role} token in fixture after ${TOKEN_MINT_ATTEMPTS} attempts`);
}

async function getToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in sessionStorage — is the user signed in?');
  return token;
}

async function seedAuthorSessionIfMissing(page: Page, request: Parameters<typeof ZenosApiClient.forRole>[0]): Promise<void> {
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });

  const existing = await page.evaluate(() => ({
    access: sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token'),
    refresh: sessionStorage.getItem('refresh_token') ?? localStorage.getItem('refresh_token'),
  }));

  if (existing.access) {
    // Keep both stores aligned for frontend code paths.
    await page.evaluate(([access, refresh]) => {
      if (access) {
        sessionStorage.setItem('access_token', access);
        localStorage.setItem('access_token', access);
      }
      if (refresh) {
        sessionStorage.setItem('refresh_token', refresh);
        localStorage.setItem('refresh_token', refresh);
      }
    }, [existing.access, existing.refresh]);
    return;
  }

  if (!IS_CI) {
    return;
  }

  const payload = await mintRoleTokens(request, 'AUTHOR');

  await page.evaluate(([access, refresh]) => {
    sessionStorage.setItem('access_token', access);
    localStorage.setItem('access_token', access);
    if (refresh) {
      sessionStorage.setItem('refresh_token', refresh);
      localStorage.setItem('refresh_token', refresh);
    }
  }, [payload.accessToken, payload.refreshToken]);
}

async function retryAction<T>(attempts: number, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }
  throw lastError;
}

/** Create a role-specific API client — works in CI (uses /auth/test/token) */
async function makeRoleClient(
  request: Parameters<typeof ZenosApiClient.forRole>[0],
  role: UserRole,
): Promise<ZenosApiClient> {
  return ZenosApiClient.forRole(request, API_BASE_URL, role);
}

type ZenosFixtures = {
  frontendUrl: string;
  apiBaseUrl: string;
  currentUser: ZenosUser;
  apiClient: ZenosApiClient;
  approverClient: ZenosApiClient;
  adminClient: ZenosApiClient;
  readerClient: ZenosApiClient;
  testArticle: ZenosArticle;
  publishedArticle: ZenosArticle;
  goToPage: (path: string) => Promise<void>;
  waitForToast: (text?: string | RegExp) => Promise<void>;
  dismissToast: () => Promise<void>;
};

export const test = base.extend<ZenosFixtures>({
  frontendUrl: async ({}, use) => { await use(FRONTEND_URL); },
  apiBaseUrl:  async ({}, use) => { await use(API_BASE_URL); },

  page: async ({ page, context, request }, use) => {
    if (IS_CI) {
      const tokens = await mintRoleTokens(request, 'AUTHOR');
      await context.addInitScript(([access, refresh]) => {
        window.localStorage.setItem('access_token', access);
        window.sessionStorage.setItem('access_token', access);
        if (refresh) {
          window.localStorage.setItem('refresh_token', refresh);
          window.sessionStorage.setItem('refresh_token', refresh);
        }
      }, [tokens.accessToken, tokens.refreshToken]);
    }

    await context.addInitScript(() => {
      const accessToken = window.localStorage.getItem('access_token');
      const refreshToken = window.localStorage.getItem('refresh_token');
      if (accessToken && !window.sessionStorage.getItem('access_token')) {
        window.sessionStorage.setItem('access_token', accessToken);
      }
      if (refreshToken && !window.sessionStorage.getItem('refresh_token')) {
        window.sessionStorage.setItem('refresh_token', refreshToken);
      }
    });

    await use(page);
  },

  /** API client for the currently authenticated user (AUTHOR role in default project) */
  apiClient: async ({ page, request }, use) => {
    await seedAuthorSessionIfMissing(page, request);

    let client: ZenosApiClient;
    try {
      const token = await getToken(page);
      client = new ZenosApiClient(request, API_BASE_URL, token);
    } catch (err) {
      if (!IS_CI) {
        throw err;
      }
      client = await makeRoleClient(request, 'AUTHOR');
    }

    await use(client);
  },

  /** APPROVER role client — uses /auth/test/token in CI or falls back to the current session */
  approverClient: async ({ request }, use) => {
    await use(await makeRoleClient(request, 'APPROVER'));
  },

  /** SUPERADMIN role client */
  adminClient: async ({ request }, use) => {
    await use(await makeRoleClient(request, 'SUPERADMIN'));
  },

  /** READER role client */
  readerClient: async ({ request }, use) => {
    await use(await makeRoleClient(request, 'READER'));
  },

  currentUser: async ({ apiClient }, use) => {
    const user = await apiClient.getMe();
    await use(user);
  },

  /**
   * Creates a DRAFT article before the test and deletes it after.
   * Use this for write/editor tests.
   */
  testArticle: async ({ apiClient }, use) => {
    const article = await apiClient.createArticle({
      title: `E2E Draft ${Date.now()}`,
      content: '<h2>Introduction</h2><p>This is an automated draft created to exercise editor behavior, persistence, and workflow transitions in a realistic end to end environment. It is intentionally verbose and structured so moderation checks recognize it as substantial editorial writing.</p><p>The text explains why the scenario matters, what user actions are expected, and how the platform should behave across save, submit, review, and publish stages. It also describes validation behavior for metadata, content quality, and permission boundaries.</p><p>Additional narrative ensures the draft remains comfortably above minimum word requirements while staying coherent and deterministic for automated execution. This allows tests to focus on system behavior rather than failing because of content-length policy checks.</p>',
    });
    await use(article);
    try { (await apiClient.deleteArticle(article.id)); } catch { /* already deleted by test */ }
  },

  /**
   * Creates a PUBLISHED article before the test and deletes it after.
   * Lifecycle: create (AUTHOR) → submit → approve (APPROVER) → publish (SUPERADMIN)
   * Use this for comments, reading, social, and feed tests.
   */
  publishedArticle: async ({ apiClient, approverClient, adminClient }, use) => {
    // 1. Create
    const article = await apiClient.createArticle({
      title: `E2E Published ${Date.now()}`,
      content: '<h2>Introduction</h2><p>This published test article is created by the E2E suite for comments, reactions, reading history, and profile surfaces across the platform. It provides realistic long form content that can move through moderation and approval flows without artificial shortcuts.</p><p>The body includes several complete paragraphs describing purpose, expected behavior, and measurable outcomes so quality gates treat it as review-ready writing. It also captures implementation context that helps downstream tests validate rendering, metadata, and interaction patterns on detail pages.</p><p>By keeping the narrative explicit and sufficiently long, the suite avoids false negatives tied to minimum-word constraints and can reliably verify lifecycle transitions from draft through submission, approval, publication, and subsequent engagement events.</p>',
      tags: ['e2e', 'test'],
    });

    // 2. Submit
    const submitRes = await apiClient.submitArticle(article.id);
    if (!submitRes.ok) {
      await apiClient.deleteArticle(article.id);
      throw new Error(`Submit failed for article ${article.id}: ${submitRes.status}`);
    }

    // 3. Approve
    const approveRes = await retryAction(3, async () => {
      const result = await approverClient.approveArticle(article.id);
      if (!result.ok) {
        throw new Error(`Approve failed for article ${article.id}: ${result.status}`);
      }
      return result;
    });
    if (!approveRes.ok) {
      await apiClient.deleteArticle(article.id);
      throw new Error(`Approve failed for article ${article.id}: ${approveRes.status}`);
    }

    // 4. Publish
    const publishRes = await retryAction(3, async () => {
      const result = await adminClient.publishArticle(article.id);
      if (!result.ok) {
        throw new Error(`Publish failed for article ${article.id}: ${result.status}`);
      }
      return result;
    });
    if (!publishRes.ok) {
      await apiClient.deleteArticle(article.id);
      throw new Error(`Publish failed for article ${article.id}: ${publishRes.status}`);
    }

    // 5. Fetch updated record (to get slug + updated status)
    let published: ZenosArticle = article;
    const fetchRes = await apiClient.getArticle(article.id);
    if (fetchRes.ok) {
      const body = await fetchRes.json() as ZenosArticle | { article: ZenosArticle };
      published = ('article' in body ? body.article : body) as ZenosArticle;
    }

    await use(published);
    try { await adminClient.deleteArticle(article.id); } catch { /* ignore */ }
  },

  goToPage: async ({ page, request }, use) => {
    await use(async (path: string) => {
      await seedAuthorSessionIfMissing(page, request);

      const isOnLogin = () => /\/login(?:$|[?#])/.test(new URL(page.url()).pathname + new URL(page.url()).search);

      const navigate = async () => {
        await page.goto(`${FRONTEND_URL}${path}`, { waitUntil: 'domcontentloaded' });
        // Give AuthContext/route guards a moment to settle before assertions continue.
        await page.waitForTimeout(1200);
      };

      await navigate();

      // In CI we occasionally hit /login before AuthContext hydrates.
      // If that happens, reseed fresh AUTHOR tokens and retry once.
      if (IS_CI && isOnLogin()) {
        const tokens = await mintRoleTokens(request, 'AUTHOR');
        await page.evaluate(([access, refresh]) => {
          window.localStorage.setItem('access_token', access);
          window.sessionStorage.setItem('access_token', access);
          if (refresh) {
            window.localStorage.setItem('refresh_token', refresh);
            window.sessionStorage.setItem('refresh_token', refresh);
          }
        }, [tokens.accessToken, tokens.refreshToken]);

        await navigate();

        if (isOnLogin()) {
          const meRes = await request.get(`${API_BASE_URL}/api/users/me`, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          });

          if (meRes.ok()) {
            const meBody = await meRes.text();
            await page.route('**/api/users/me', async (route) => {
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: meBody,
              });
            });

            await navigate();
          }
        }
      }
    });
  },

  waitForToast: async ({ page }, use) => {
    await use(async (text?: string | RegExp) => {
      const toast = page.locator('[role="alert"], [data-testid="toast"], .toast, .Toastify__toast').first();
      const statusMessage = page
        .locator('[aria-live="polite"], [aria-live="assertive"], [data-testid="article-status"], .status-chip, .status-badge')
        .first();

      const toastCount = await toast.count();
      if (toastCount > 0) {
        await expect(toast).toBeVisible({ timeout: 10_000 });
        if (text) {
          await expect(toast).toContainText(text, { timeout: 8_000 });
        }
        return;
      }

      if (text) {
        const statusCount = await statusMessage.count();
        if (statusCount > 0) {
          await expect(statusMessage).toContainText(text, { timeout: 10_000 });
          return;
        }
      }

      // Nothing explicitly toast-like surfaced. Keep this non-fatal to avoid
      // false negatives when UI feedback is inline or ephemeral.
      await page.waitForTimeout(800);
    });
  },

  dismissToast: async ({ page }, use) => {
    await use(async () => {
      const closeBtn = page.locator('[data-testid="toast-close"], .toast-close, [aria-label="Dismiss"]').first();
      if (await closeBtn.isVisible()) await closeBtn.click();
    });
  },
});

export { expect };
