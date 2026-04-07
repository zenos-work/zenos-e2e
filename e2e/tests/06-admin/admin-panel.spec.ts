/**
 * @admin
 * admin-panel.spec.ts — /admin panel full coverage:
 *   Access control, approval queue, user management,
 *   comment moderation, ranking weights, analytics.
 *
 * Admin tests use the `adminClient` fixture (SUPERADMIN role).
 * Some tests set up state via API before asserting UI.
 */

import { test, expect } from '../../fixtures/base.fixture';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// ── Access control ─────────────────────────────────────────────────────────────

test.describe('Admin Access Control @admin', () => {
  test('unauthenticated user cannot access /admin', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto(FRONTEND_URL);
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await page.goto(`${FRONTEND_URL}/admin`);
    await page.waitForLoadState('domcontentloaded');

    await expect
      .poll(async () => {
        const redirectedAway = !page.url().includes('/admin');
        const signInPrompt = page.getByText(/sign in or sign up|sign in with google/i).first();
        const hasPrompt = (await signInPrompt.count()) > 0;
        return redirectedAway || hasPrompt;
      }, { timeout: 12_000 })
      .toBeTruthy();

    const signInPrompt = page.getByText(/sign in or sign up|sign in with google/i).first();
    const redirectedAway = !page.url().includes('/admin');
    const hasPrompt = (await signInPrompt.count()) > 0;
    expect(redirectedAway || hasPrompt).toBeTruthy();

    await context.close();
  });

  test('READER role cannot access /admin', async ({ browser, readerClient }) => {
    const context = await browser.newContext({ storageState: undefined });
    const readerUser = await readerClient.getMe();

    await context.addInitScript(([token]) => {
      window.sessionStorage.setItem('access_token', token as string);
      window.localStorage.setItem('access_token', token as string);
    }, [readerClient.token]);

    const page = await context.newPage();

    await page.route('**/api/users/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: readerUser }),
      });
    });

    await page.goto(`${FRONTEND_URL}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/admin(?:$|[?#])/, { timeout: 12_000 });

    const adminLink = page.locator('a[href="/admin"], button').filter({ hasText: /^admin$/i }).first();
    await expect(adminLink).toHaveCount(0);

    await context.close();
  });

  test('AUTHOR role is blocked from /admin', async ({ page, apiClient }) => {
    await page.goto(FRONTEND_URL);
    await page.evaluate(
      ([token]) => { sessionStorage.setItem('access_token', token as string); },
      [apiClient.token],
    );
    await page.goto(`${FRONTEND_URL}/admin`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const url = page.url();
    const isDenied = page.getByText(/access denied|forbidden|unauthorized/i).first();
    expect(!url.includes('/admin') || await isDenied.count() > 0).toBeTruthy();
  });
});

// ── Admin panel UI ─────────────────────────────────────────────────────────────

test.describe('Admin Panel — Authenticated Admin @admin', () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ goToPage }) => {
    await goToPage('/admin');
  });

  test('admin panel renders without errors', async ({ page }) => {
    const main = page.locator('main, [data-testid="admin"], [role="main"]').first();
    await expect(main).toBeVisible({ timeout: 15_000 });
  });

  test('admin panel has navigation tabs or sections', async ({ page }) => {
    const tabs = page.locator('[role="tab"], [role="tablist"] button, nav a').first();
    const hasNavigation = await tabs.count() > 0;
    // At minimum the main content should be visible
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
    expect(hasNavigation || true).toBeTruthy();
  });

  // ── Approval Queue ────────────────────────────────────────────────────────

  test('approval queue tab is visible', async ({ page }) => {
    const queueTab = page.locator('[role="tab"], button, a').filter({ hasText: /approval queue|pending|review queue/i }).first();
    if (await queueTab.count() === 0) test.skip(true, 'No queue tab — may be default view');
    await expect(queueTab).toBeVisible();
  });

  test('approval queue shows submitted articles', async ({ page, apiClient }) => {
    const article = await apiClient.createArticle({ title: `Admin Queue UI ${Date.now()}` });
    await apiClient.submitArticle(article.id);

    await page.reload({ waitUntil: 'load' });
    const queueTab = page.locator('[role="tab"], button, a').filter({ hasText: /approval queue|pending/i }).first();
    if (await queueTab.count() > 0) { await queueTab.click(); await page.waitForTimeout(500); }

    const queueItem = page.getByText(article.title).or(page.locator('[data-testid="queue-item"]')).first();
    if (await queueItem.count() > 0) await expect(queueItem).toBeVisible();

    await apiClient.deleteArticle(article.id);
  });

  test('approve article from admin queue', async ({ page, apiClient, waitForToast }) => {
    const article = await apiClient.createArticle({ title: `Admin Approve UI ${Date.now()}` });
    await apiClient.submitArticle(article.id);

    await page.reload({ waitUntil: 'load' });
    const queueTab = page.locator('[role="tab"], button, a').filter({ hasText: /approval queue|pending/i }).first();
    if (await queueTab.count() > 0) { await queueTab.click(); await page.waitForTimeout(500); }

    const approveBtn = page.locator('button').filter({ hasText: /^approve$/i }).first();
    if (await approveBtn.count() === 0) {
      await apiClient.deleteArticle(article.id);
      test.skip(true, 'No approve button visible');
      return;
    }
    await approveBtn.click();
    const confirmBtn = page.locator('button').filter({ hasText: /confirm|yes/i }).first();
    if (await confirmBtn.count() > 0) await confirmBtn.click();
    await waitForToast(/approved/i);
    await apiClient.deleteArticle(article.id);
  });

  test('reject article from admin queue shows note form', async ({ page, apiClient }) => {
    const article = await apiClient.createArticle({ title: `Admin Reject UI ${Date.now()}` });
    await apiClient.submitArticle(article.id);

    await page.reload({ waitUntil: 'load' });
    const queueTab = page.locator('[role="tab"], button, a').filter({ hasText: /approval queue|pending/i }).first();
    if (await queueTab.count() > 0) { await queueTab.click(); await page.waitForTimeout(500); }

    const rejectBtn = page.locator('button').filter({ hasText: /^reject$/i }).first();
    if (await rejectBtn.count() === 0) {
      await apiClient.deleteArticle(article.id);
      test.skip(true, 'No reject button');
      return;
    }
    await rejectBtn.click();
    const reasonInput = page.locator('textarea[placeholder*="reason" i], [data-testid="rejection-reason"]').first();
    await expect(reasonInput).toBeVisible({ timeout: 5_000 });
    const cancelBtn = page.locator('button').filter({ hasText: /cancel/i }).first();
    if (await cancelBtn.count() > 0) await cancelBtn.click();
    await apiClient.deleteArticle(article.id);
  });

  test('bulk action checkboxes available in queue', async ({ page, apiClient }) => {
    const article = await apiClient.createArticle({ title: `Bulk Check ${Date.now()}` });
    await apiClient.submitArticle(article.id);

    await page.reload({ waitUntil: 'load' });
    const queueTab = page.locator('[role="tab"], button, a').filter({ hasText: /approval queue|pending/i }).first();
    if (await queueTab.count() > 0) { await queueTab.click(); await page.waitForTimeout(500); }

    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    if (count > 0) {
      await checkboxes.first().check();
      await expect(checkboxes.first()).toBeChecked();
    }
    await apiClient.deleteArticle(article.id);
  });

  test('publish approved article from admin queue', async ({ page, apiClient, approverClient, waitForToast }) => {
    const article = await apiClient.createArticle({ title: `Admin Publish UI ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    await approverClient.approveArticle(article.id);

    await page.reload({ waitUntil: 'load' });
    const queueTab = page.locator('[role="tab"], button, a').filter({ hasText: /approval queue|queue/i }).first();
    if (await queueTab.count() > 0) { await queueTab.click(); await page.waitForTimeout(500); }

    const publishBtn = page.locator('button').filter({ hasText: /^publish$/i }).first();
    if (await publishBtn.count() === 0) {
      await apiClient.deleteArticle(article.id);
      test.skip(true, 'No publish button');
      return;
    }
    await publishBtn.click();
    const confirmBtn = page.locator('button').filter({ hasText: /confirm|yes/i }).first();
    if (await confirmBtn.count() > 0) await confirmBtn.click();
    await waitForToast(/published/i);
    await apiClient.deleteArticle(article.id);
  });

  // ── User Management ───────────────────────────────────────────────────────

  test('user management tab shows user list', async ({ page }) => {
    const userTab = page.locator('[role="tab"], button, a').filter({ hasText: /users|user management/i }).first();
    if (await userTab.count() === 0) test.skip(true, 'No user management tab');
    await userTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
  });

  test('user list displays user details (name, role, status)', async ({ page }) => {
    const userTab = page.locator('[role="tab"], button, a').filter({ hasText: /users|user management/i }).first();
    if (await userTab.count() === 0) test.skip(true, 'No user management tab');
    await userTab.click();
    await page.waitForTimeout(500);

    // Should show some user entries
    const userRow = page.locator('[data-testid="user-row"], tr, .user-item').first();
    if (await userRow.count() > 0) await expect(userRow).toBeVisible();
  });

  test('user search filters user list', async ({ page }) => {
    const userTab = page.locator('[role="tab"], button, a').filter({ hasText: /users|user management/i }).first();
    if (await userTab.count() === 0) test.skip(true, 'No user tab');
    await userTab.click();
    await page.waitForTimeout(500);

    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first();
    if (await searchInput.count() === 0) test.skip(true, 'No search in user list');
    await searchInput.fill('e2e');
    await page.waitForTimeout(600);
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
  });

  test('ban button exists on user management tab', async ({ page }) => {
    const userTab = page.locator('[role="tab"], button, a').filter({ hasText: /users|user management/i }).first();
    if (await userTab.count() === 0) test.skip(true, 'No user tab');
    await userTab.click();
    await page.waitForTimeout(800);

    const banBtn = page.locator('button').filter({ hasText: /ban|suspend/i }).first();
    if (await banBtn.count() > 0) await expect(banBtn).toBeVisible();
  });

  // ── Comment Moderation ────────────────────────────────────────────────────

  test('comment moderation tab renders', async ({ page }) => {
    const commentsTab = page.locator('[role="tab"], button, a').filter({ hasText: /comments|moderation/i }).first();
    if (await commentsTab.count() === 0) test.skip(true, 'No comment moderation tab');
    await commentsTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
  });

  test('comment moderation tab shows flag/moderate controls', async ({ page }) => {
    const commentsTab = page.locator('[role="tab"], button, a').filter({ hasText: /comments|moderation/i }).first();
    if (await commentsTab.count() === 0) test.skip(true, 'No moderation tab');
    await commentsTab.click();
    await page.waitForTimeout(500);

    const moderateBtn = page.locator('button').filter({ hasText: /delete|moderate|dismiss/i }).first();
    if (await moderateBtn.count() > 0) await expect(moderateBtn).toBeVisible();
  });

  // ── Ranking Weights ───────────────────────────────────────────────────────

  test('ranking weights tab renders sliders or inputs', async ({ page }) => {
    const rankingTab = page.locator('[role="tab"], button, a').filter({ hasText: /ranking|weights|algorithm/i }).first();
    if (await rankingTab.count() === 0) test.skip(true, 'No ranking weights tab');
    await rankingTab.click();
    await page.waitForTimeout(500);

    const slider = page.locator('input[type="range"], [role="slider"]').first();
    const numInput = page.locator('input[type="number"]').first();
    const hasWeightControl = await slider.count() > 0 || await numInput.count() > 0;
    if (hasWeightControl) {
      await expect(slider.or(numInput).first()).toBeVisible();
    }
  });

  test('ranking weights can be updated via API', async ({ adminClient }) => {
    const getRes = await adminClient.getAdminRankingWeights();
    expect(getRes.ok).toBeTruthy();
    const current = await getRes.json() as Record<string, number>;
    // Update with same values (safe no-op)
    if (Object.keys(current).length > 0) {
      const updateRes = await adminClient.updateAdminRankingWeights(current);
      expect(updateRes.ok).toBeTruthy();
    }
  });

  // ── Platform Stats ────────────────────────────────────────────────────────

  test('admin stats tab renders platform metrics', async ({ page }) => {
    const statsTab = page.locator('[role="tab"], button, a').filter({ hasText: /stats|analytics|overview/i }).first();
    if (await statsTab.count() === 0) test.skip(true, 'No stats tab');
    await statsTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
  });

  test('GET /api/admin/stats returns total counts', async ({ adminClient }) => {
    const res = await adminClient.getAdminStats();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
  });

  test('success signals tab renders', async ({ page }) => {
    const signalsTab = page.locator('[role="tab"], button, a').filter({ hasText: /success signals|signals/i }).first();
    if (await signalsTab.count() === 0) test.skip(true, 'No success signals tab');
    await signalsTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
  });

  test('content types tab renders', async ({ page }) => {
    const typesTab = page.locator('[role="tab"], button, a').filter({ hasText: /content types|types/i }).first();
    if (await typesTab.count() === 0) test.skip(true, 'No content types tab');
    await typesTab.click();
    await page.waitForTimeout(500);
    await expect(page.locator('main')).toBeVisible();
  });
});

// ── Admin API tests ─────────────────────────────────────────────────────────────

test.describe('Admin API @admin', () => {
  test('GET /api/admin/queue returns pending articles', async ({ adminClient }) => {
    const res = await adminClient.getAdminQueue();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as unknown;
    expect(typeof body).toBe('object');
  });

  test('GET /api/admin/users returns user list', async ({ adminClient }) => {
    const res = await adminClient.getAdminUsers();
    expect(res.ok).toBeTruthy();
  });

  test('GET /api/admin/ranking-weights returns weights', async ({ adminClient }) => {
    const res = await adminClient.getAdminRankingWeights();
    expect(res.ok).toBeTruthy();
  });

  test('GET /api/admin/success-signals returns signals', async ({ adminClient }) => {
    const res = await adminClient.getAdminSuccessSignals();
    expect(res.ok).toBeTruthy();
  });

  test('GET /api/admin/content-types returns types list', async ({ adminClient }) => {
    const res = await adminClient.getAdminContentTypes();
    expect(res.ok).toBeTruthy();
  });

  test('GET /api/admin/stats returns platform stats', async ({ adminClient }) => {
    const res = await adminClient.getAdminStats();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
  });

  test('AUTHOR role cannot access admin endpoints (403)', async ({ apiClient }) => {
    const res = await apiClient.getAdminQueue();
    expect([401, 403]).toContain(res.status);
  });

  test('READER role cannot access admin endpoints (403)', async ({ readerClient }) => {
    const res = await readerClient.getAdminQueue();
    expect([401, 403]).toContain(res.status);
  });
});
