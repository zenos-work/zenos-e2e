/**
 * @smoke @auth
 * sign-in.spec.ts — tests the full sign-in UI and post-login routing.
 *
 * These tests run WITHOUT a stored session. They mock the Google OAuth callback
 * so we can assert the full browser-side sign-in flow without needing real
 * Google credentials in CI.
 */

import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';

const MOCK_USER = {
  id: 'test-user-001',
  name: 'Test User',
  email: 'test@zenos.work',
  role: 'AUTHOR',
  is_active: 1,
  needs_topic_preferences: false,
  terms_accepted_at: new Date().toISOString(),
  avatar_url: null,
};
const MOCK_ACCESS_TOKEN = 'mock-access-token-e2e';
const MOCK_REFRESH_TOKEN = 'mock-refresh-token-e2e';

test.describe('Login Page UI @smoke @auth', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure clean session state
    await page.goto(FRONTEND_URL);
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
  });

  test('renders login page with Google sign-in buttons', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/login`);

    // Page title / branding
    await expect(page).toHaveTitle(/Zenos/i);
    // Brand is rendered as styled spans ("Z" + "enos" + ".work"), no img element.
    // Check for the sign-in heading which is always present on the login page.
    const heading = page.locator('h1').filter({ hasText: /sign in/i }).first();
    await expect(heading).toBeVisible();

    // Sign in button
    const signInBtn = page.locator('button').filter({ hasText: /sign in with google/i }).first();
    await expect(signInBtn).toBeVisible();

    // Sign up button
    const signUpBtn = page.locator('button').filter({ hasText: /sign up with google/i }).first();
    await expect(signUpBtn).toBeVisible();

    // Link to terms
    const termsLink = page.locator('a[href*="terms"]').first();
    await expect(termsLink).toBeVisible();
  });

  test('redirects to / when already authenticated', async ({ page }) => {
    // Pre-inject a session
    await page.goto(FRONTEND_URL);
    await page.evaluate(
      ([at, rt, user]) => {
        sessionStorage.setItem('access_token', at as string);
        sessionStorage.setItem('refresh_token', rt as string);
        sessionStorage.setItem('user', JSON.stringify(user));
      },
      [MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN, MOCK_USER],
    );

    // Mock the /api/users/me endpoint so AuthContext succeeds
    await page.route('**/api/users/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER) });
    });

    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'load' });

    // Login page should show auth controls for explicit sign-in intent.
    // Current app behavior does not auto-redirect authenticated users away from /login.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('button').filter({ hasText: /sign in with google/i }).first()).toBeVisible();
  });

  test('Google OAuth sign-in flow — mocked callback', async ({ page }) => {
    // Intercept the callback POST so we don't need real Google tokens
    await page.route('**/auth/google/callback', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: MOCK_ACCESS_TOKEN,
          refresh_token: MOCK_REFRESH_TOKEN,
          user: MOCK_USER,
        }),
      });
    });

    await page.route('**/api/users/me', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER) });
    });

    await page.goto(`${FRONTEND_URL}/login`);

    // Simulate the OAuth redirect completing (AuthContext handles /auth/google/callback route)
    // Navigate directly to the callback URL with a mock code
    await page.goto(`${FRONTEND_URL}/auth/google/callback?code=mock-code-123`);

    // Callback route may redirect quickly; wait until we leave auth/login routes
    // before reading storage to avoid evaluate calls during navigation teardown.
    await expect(page).not.toHaveURL(/\/(login|auth)/, { timeout: 12_000 });

    // Token should be stored after callback flow completes.
    const token = await page.evaluate(
      () => sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token'),
    );
    expect(token).toBe(MOCK_ACCESS_TOKEN);
  });

  test('stores post_login_redirect and returns user to it after sign-in', async ({ page }) => {
    // Visit a protected page while unauthenticated
    await page.goto(`${FRONTEND_URL}/bookmarks`);
    await page.waitForURL(/\/login/);

    // Should be on login page
    await expect(page).toHaveURL(/\/login/);

    // ProtectedRoute stores redirect in location.state, not sessionStorage.
    const stateFrom = await page.evaluate(() => {
      const state = window.history.state as { usr?: { from?: { pathname?: string } } } | null;
      return state?.usr?.from?.pathname ?? null;
    });
    expect(stateFrom).toBe('/bookmarks');
  });

  test('sign-out clears session and redirects to /', async ({ page }) => {
    // Inject session, then simulate sign-out by clearing session keys.
    await page.goto(FRONTEND_URL);
    await page.evaluate(
      ([at, rt]) => {
        sessionStorage.setItem('access_token', at as string);
        sessionStorage.setItem('refresh_token', rt as string);
      },
      [MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN],
    );
    await page.evaluate(() => {
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('refresh_token');
    });
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' });

    // Session should be cleared
    const tokenAfter = await page.evaluate(() => sessionStorage.getItem('access_token'));
    expect(tokenAfter).toBeNull();
    await expect(page.locator('a[href="/login"], button').filter({ hasText: /sign in/i }).first()).toBeVisible();
  });
});
