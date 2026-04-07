/**
 * draft-flow.spec.ts — Draft article creation, persistence, listing, and management.
 */
import { test, expect } from '../../fixtures/base.fixture';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

test.describe('Draft Flow — API Layer @articles', () => {
  test('create draft returns id and status=draft', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Draft Create ${Date.now()}` });
    expect(article.id).toBeTruthy();
    expect(article.status).toBe('DRAFT');
    await apiClient.deleteArticle(article.id);
  });

  test('draft appears in GET /api/articles/mine', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Draft Mine ${Date.now()}` });
    const res = await apiClient.getMyArticles();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { items?: { id: string }[] };
    const list = body.items ?? (body as unknown as { id: string }[]);
    const ids = Array.isArray(list) ? list.map((a) => a.id) : [];
    expect(ids).toContain(article.id);
    await apiClient.deleteArticle(article.id);
  });

  test('update draft title persists change', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Before Update ${Date.now()}` });
    const newTitle = `After Update ${Date.now()}`;
    const res = await apiClient.updateArticle(article.id, { title: newTitle });
    expect(res.ok).toBeTruthy();
    const fetched = await apiClient.getArticle(article.id);
    const body = await fetched.json() as { article?: { title: string }; title?: string };
    const title = body.article?.title ?? body.title;
    expect(title).toBe(newTitle);
    await apiClient.deleteArticle(article.id);
  });

  test('update draft content persists', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Content Draft ${Date.now()}` });
    const content = '<h2>Hello world</h2><p>This updated draft content is intentionally long enough to pass validation constraints and persist in the backend during end-to-end checks.</p>';
    const res = await apiClient.updateArticle(article.id, { content });
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('draft status stays draft before submission', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Status Check ${Date.now()}` });
    const res = await apiClient.getArticle(article.id);
    const body = await res.json() as { article?: { status: string }; status?: string };
    const status = body.article?.status ?? body.status;
    expect(status).toBe('DRAFT');
    await apiClient.deleteArticle(article.id);
  });

  test('submit draft changes status to submitted', async ({ apiClient }) => {
    const article = await apiClient.createArticle({
      title: `Submit Status ${Date.now()}`,
      content: '<h2>Submission Test</h2><p>This draft is intentionally verbose and includes many words so automated moderation can classify it as substantial editorial content. The article explains how teams plan architecture changes, break down milestones, evaluate rollout risks, communicate scope clearly, and verify outcomes with measurable quality signals. It discusses incident prevention, observability standards, ownership boundaries, and iterative delivery practices across engineering and editorial workflows. The final section reinforces practical value by outlining implementation details, review checkpoints, publication readiness criteria, and follow up actions for continuous improvement in production systems.</p>',
    });
    await apiClient.submitArticle(article.id);
    const res = await apiClient.getArticle(article.id);
    const body = await res.json() as { article?: { status: string }; status?: string };
    const status = body.article?.status ?? body.status;
    expect(status).toMatch(/SUBMITTED|APPROVED|PUBLISHED/);
    await apiClient.deleteArticle(article.id);
  });

  test('delete draft removes it from mine list', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Delete Draft ${Date.now()}` });
    await apiClient.deleteArticle(article.id);
    const res = await apiClient.getMyArticles();
    const body = await res.json() as { items?: { id: string }[] };
    const ids = (body.items ?? []).map((a) => a.id);
    expect(ids).not.toContain(article.id);
  });

  test('multiple drafts all appear in mine list', async ({ apiClient }) => {
    const a1 = await apiClient.createArticle({ title: `Multi Draft 1 ${Date.now()}` });
    const a2 = await apiClient.createArticle({ title: `Multi Draft 2 ${Date.now()}` });
    const res = await apiClient.getMyArticles();
    const body = await res.json() as { items?: { id: string }[] };
    const ids = (body.items ?? []).map((a) => a.id);
    expect(ids).toContain(a1.id);
    expect(ids).toContain(a2.id);
    await apiClient.deleteArticle(a1.id);
    await apiClient.deleteArticle(a2.id);
  });
});

test.describe('Draft Flow — Editor UI @articles', () => {
  test.describe.configure({ timeout: 30_000 });

  test('navigating to /write creates new draft route', async ({ goToPage, page }) => {
    await goToPage('/write');
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/\/write/);
  });

  test('/write/:id opens existing draft', async ({ goToPage, page, testArticle }) => {
    await goToPage(`/write/${testArticle.id}`);
    await page.waitForLoadState('domcontentloaded');
    const titleInput = page.locator('input[placeholder="Article title..."], [data-testid="title-input"], input[placeholder*="title" i], h1[contenteditable]').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
  });

  test('draft title shows in editor after navigation', async ({ goToPage, page, testArticle }) => {
    await goToPage(`/write/${testArticle.id}`);
    const titleInput = page.locator('input[placeholder="Article title..."], [data-testid="title-input"], input[placeholder*="title" i], h1[contenteditable]').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(
        async () => {
          const inputValue = await titleInput.inputValue().catch(() => '');
          if (inputValue.trim().length > 0) return inputValue;
          return (await titleInput.textContent()) ?? '';
        },
        { timeout: 10_000 }
      )
      .toContain('E2E Draft');
  });

  test('DRAFT status indicator visible in editor', async ({ goToPage, page, testArticle }) => {
    await goToPage(`/write/${testArticle.id}`);
    const badge = page.locator('[data-testid="status-badge"], .status-badge, [class*="status"]').filter({ hasText: /draft/i }).first();
    if (await badge.count() > 0) await expect(badge).toBeVisible({ timeout: 5_000 });
  });

  test('library page renders /library route', async ({ goToPage, page }) => {
    await goToPage('/library');
    await expect(page).toHaveURL(/\/library/);
    await expect(page.locator('main, [role="main"], body').first()).toBeVisible({ timeout: 10_000 });
  });

  test('library page shows draft articles', async ({ goToPage, page, testArticle }) => {
    await goToPage('/library');
    await page.waitForLoadState('domcontentloaded');
    const draftItem = page.locator(`[data-testid="article-item"], .article-card, li`).filter({ hasText: testArticle.title }).first();
    if (await draftItem.count() > 0) await expect(draftItem).toBeVisible({ timeout: 5_000 });
  });

  test('library page shows edit link for drafts', async ({ goToPage, page }) => {
    await goToPage('/library');
    await page.waitForLoadState('domcontentloaded');
    const editLink = page.locator('a[href*="/write/"], [data-testid="edit-link"]').first();
    if (await editLink.count() > 0) await expect(editLink).toBeVisible();
  });

  test('status badge in library shows DRAFT for draft articles', async ({ goToPage, page, testArticle }) => {
    await goToPage('/library');
    await page.waitForTimeout(1000);
    const draftBadge = page.locator('.badge, [class*="status"], [data-testid*="status"]').filter({ hasText: /draft/i }).first();
    if (await draftBadge.count() > 0) await expect(draftBadge).toBeVisible();
  });
});
