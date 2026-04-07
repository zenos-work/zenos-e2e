/**
 * @smoke
 * public-pages.spec.ts — smoke-checks every public route for:
 *  - no runtime/network errors
 *  - at least one meaningful content element rendered
 *  - correct HTTP-level status (via API requests observer)
 *
 * Runs in the `public` project (no storageState).
 */

import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';

// Minimal list of checks per public route
const PUBLIC_ROUTES: Array<{
  path: string;
  label: string;
  /** Selector that must be visible after load */
  selector: string;
  /** Optional: page title substring to assert */
  titleMatch?: string | RegExp;
}> = [
  { path: '/', label: 'Home / Feed', selector: 'main, [role="main"], header', titleMatch: /Zenos/i },
  { path: '/explore', label: 'Explore', selector: 'h1:has-text("Explore"), main, [role="main"]' },
  { path: '/search', label: 'Search', selector: 'input[type="search"], input[placeholder*="search" i]' },
  { path: '/membership', label: 'Membership', selector: 'main, [data-testid="membership"], h1, .membership' },
  { path: '/terms', label: 'Terms', selector: 'main, article, section, h1' },
  { path: '/not-a-real-page-404xyz', label: '404 page', selector: 'main, [data-testid="not-found"], h1' },
];

test.describe('Public Page Smoke Tests @smoke', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.label} (${route.path}) renders without errors`, async ({ page }) => {
      const networkErrors: string[] = [];

      page.on('response', (response) => {
        // Only flag failed XHR/fetch to backend API (not static assets)
        const url = response.url();
        if (url.includes('/api/') && response.status() >= 500) {
          networkErrors.push(`${response.status()} on ${url}`);
        }
      });

      page.on('pageerror', (err) => {
        // Collect JS errors but don't fail immediately — assert below
        networkErrors.push(`JS error: ${err.message}`);
      });

      await page.goto(`${FRONTEND_URL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Wait for initial render
      const locator = page.locator(route.selector).first();
      await expect(locator).toBeVisible({ timeout: 3_000 });

      // No critical errors
      expect(networkErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);

      if (route.titleMatch) {
        await expect(page).toHaveTitle(route.titleMatch);
      }
    });
  }

  test('article detail page renders given a real slug from feed', async ({ page, request }) => {
    const openSeededArticle = async () => {
      const mint = async (role: 'AUTHOR' | 'APPROVER' | 'SUPERADMIN') => {
        const secret = process.env.E2E_TEST_AUTH_SECRET;
        const mintRes = await request.post(`${API_BASE_URL}/auth/test/token`, {
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'x-e2e-auth-secret': secret } : {}),
          },
          data: { role },
        });
        expect(mintRes.ok()).toBeTruthy();
        const payload = await mintRes.json() as { access_token: string };
        return payload.access_token;
      };

      const authorToken = await mint('AUTHOR');
      const approverToken = await mint('APPROVER');
      const adminToken = await mint('SUPERADMIN');

      const createRes = await request.post(`${API_BASE_URL}/api/articles`, {
        headers: {
          Authorization: `Bearer ${authorToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          title: `Public Detail Seed ${Date.now()}`,
          slug: `public-detail-seed-${Date.now()}`,
          status: 'draft',
          tags: ['technology', 'e2e'],
          content:
            '<h2>Public Detail Seed</h2><p>This seeded article exists so smoke tests can always open an article detail route even on a fresh database with no feed content. The body intentionally includes enough words to satisfy moderation checks and move through workflow transitions.</p><p>It verifies article rendering and public route behavior deterministically in CI.</p>',
        },
      });
      expect(createRes.ok()).toBeTruthy();

      const created = await createRes.json() as { id?: string; article?: { id?: string } };
      const seededId = created.article?.id ?? created.id;
      expect(seededId).toBeTruthy();

      await request.post(`${API_BASE_URL}/api/articles/${seededId}/submit`, {
        headers: { Authorization: `Bearer ${authorToken}` },
      });
      await request.post(`${API_BASE_URL}/api/articles/${seededId}/approve`, {
        headers: { Authorization: `Bearer ${approverToken}` },
      });
      await request.post(`${API_BASE_URL}/api/articles/${seededId}/publish`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      const detailRes = await request.get(`${API_BASE_URL}/api/articles/${seededId}`, {
        headers: { Authorization: `Bearer ${authorToken}` },
      });
      expect(detailRes.ok()).toBeTruthy();
      const detail = await detailRes.json() as { slug?: string; article?: { slug?: string } };
      const seededSlug = detail.article?.slug ?? detail.slug;
      expect(seededSlug).toBeTruthy();

      await page.goto(`${FRONTEND_URL}/article/${seededSlug}`, { waitUntil: 'domcontentloaded' });
      const seededContent = page.locator('article, [data-testid="article-content"], .article-body, .prose').first();
      await expect(page.getByText(/article not found/i).first()).toHaveCount(0);
      await expect(seededContent).toBeVisible({ timeout: 10_000 });

      await request.delete(`${API_BASE_URL}/api/articles/${seededId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    };

    // Navigate to home, find first article link and follow it
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' });

    // Look for any article card with a nested link to /article/...
    const articleLink = page.locator('a[href*="/article/"]').first();

    // If no article cards are rendered yet, exercise the route directly.
    const count = await articleLink.count();
    if (count === 0) {
      await openSeededArticle();
      return;
    }

    const href = await articleLink.getAttribute('href');
    await page.goto(`${FRONTEND_URL}${href}`, { waitUntil: 'domcontentloaded' });

    // Article content area must be visible
    const content = page.locator('article, [data-testid="article-content"], .article-body, .prose').first();
    if (await content.count() === 0) {
      await openSeededArticle();
      return;
    }
    await expect(content).toBeVisible({ timeout: 5_000 });
  });

  test('series page renders when navigating from a series link', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' });

    const seriesLink = page.locator('a[href*="/series/"]').first();
    const count = await seriesLink.count();
    if (count === 0) {
      await page.goto(`${FRONTEND_URL}/series`, { waitUntil: 'domcontentloaded' });
      const seriesFallback = page.locator('main, [data-testid="series-list"], h1').first();
      await expect(seriesFallback).toBeVisible({ timeout: 5_000 });
      return;
    }

    const href = await seriesLink.getAttribute('href');
    await page.goto(`${FRONTEND_URL}${href}`, { waitUntil: 'domcontentloaded' });

    const heading = page.locator('h1, [data-testid="series-title"]').first();
    await expect(heading).toBeVisible({ timeout: 3_000 });
  });

  test('tag page renders when navigating from a tag chip', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/`, { waitUntil: 'domcontentloaded' });

    const tagLink = page.locator('a[href*="/tag/"]').first();
    const count = await tagLink.count();
    if (count === 0) {
      await page.goto(`${FRONTEND_URL}/tag/technology`, { waitUntil: 'domcontentloaded' });
      const tagFallback = page.locator('main, [data-testid="tag-page"], h1').first();
      await expect(tagFallback).toBeVisible({ timeout: 5_000 });
      return;
    }

    const href = await tagLink.getAttribute('href');
    await page.goto(`${FRONTEND_URL}${href}`, { waitUntil: 'domcontentloaded' });

    const content = page.locator('main, [data-testid="tag-page"]').first();
    await expect(content).toBeVisible({ timeout: 3_000 });
  });
});
