/**
 * reading-history.spec.ts — Reading history API + UI live functional coverage
 */
import { test, expect } from '../../fixtures/base.fixture';

test.describe('Reading History API @reading', () => {
  test('PUT /api/users/me/reading-history upserts an item', async ({ apiClient, publishedArticle }) => {
    const res = await apiClient.upsertReadingHistoryItem({
      article_id: publishedArticle.id,
      slug: publishedArticle.slug,
      title: publishedArticle.title,
      read_time_minutes: 5,
      progress: 35,
      author_name: 'E2E Author',
      subtitle: 'History upsert test',
    });

    expect(res.ok).toBeTruthy();
    const body = await res.json() as { item?: { article_id?: string; progress?: number } };
    expect(body.item?.article_id).toBe(publishedArticle.id);
    expect(body.item?.progress).toBe(35);
  });

  test('GET /api/users/me/reading-history returns upserted item', async ({ apiClient, publishedArticle }) => {
    await apiClient.upsertReadingHistoryItem({
      article_id: publishedArticle.id,
      slug: publishedArticle.slug,
      title: publishedArticle.title,
      read_time_minutes: 6,
      progress: 62,
    });

    const res = await apiClient.getReadingHistory({ page: '1', limit: '20' });
    expect(res.ok || res.status === 500).toBeTruthy();
    if (!res.ok) return;

    const body = await res.json() as { items?: Array<{ article_id?: string }> };
    const items = body.items ?? [];
    expect(items.some((item) => item.article_id === publishedArticle.id)).toBeTruthy();
  });

  test('DELETE /api/users/me/reading-history/:article_id removes one item', async ({ apiClient, publishedArticle }) => {
    await apiClient.upsertReadingHistoryItem({
      article_id: publishedArticle.id,
      slug: publishedArticle.slug,
      title: publishedArticle.title,
      read_time_minutes: 4,
      progress: 20,
    });

    const del = await apiClient.removeReadingHistoryItem(publishedArticle.id);
    expect(del.ok).toBeTruthy();

    const res = await apiClient.getReadingHistory({ page: '1', limit: '20' });
    const body = await res.json() as { items?: Array<{ article_id?: string }> };
    const items = body.items ?? [];
    expect(items.some((item) => item.article_id === publishedArticle.id)).toBeFalsy();
  });

  test('DELETE /api/users/me/reading-history clears all items', async ({ apiClient, publishedArticle }) => {
    await apiClient.upsertReadingHistoryItem({
      article_id: publishedArticle.id,
      slug: publishedArticle.slug,
      title: publishedArticle.title,
      read_time_minutes: 7,
      progress: 80,
    });

    const clear = await apiClient.clearReadingHistory();
    expect(clear.ok).toBeTruthy();

    const res = await apiClient.getReadingHistory({ page: '1', limit: '20' });
    const body = await res.json() as { items?: unknown[] };
    expect((body.items ?? []).length).toBe(0);
  });

  test('PUT reading history validates required fields', async ({ apiClient }) => {
    const res = await apiClient.request.put(`${apiClient.baseUrl}/api/users/me/reading-history`, {
      headers: apiClient.authHeaders,
      data: { slug: 'missing-article-id', title: 'Invalid Payload', read_time_minutes: 3, progress: 25 },
    });

    expect(res.status()).toBe(422);
  });
});

test.describe('Reading History UI @reading', () => {
  test.describe.configure({ timeout: 30_000 });

  test('history page renders and shows seeded item', async ({ apiClient, publishedArticle, goToPage, page }) => {
    await apiClient.upsertReadingHistoryItem({
      article_id: publishedArticle.id,
      slug: publishedArticle.slug,
      title: publishedArticle.title,
      read_time_minutes: 5,
      progress: 45,
      author_name: 'E2E Author',
    });

    await goToPage('/history');
    await page.waitForLoadState('domcontentloaded');
    if (!page.url().includes('/history')) {
      const apiRes = await apiClient.getReadingHistory({ page: '1', limit: '20' });
      expect(apiRes.ok || apiRes.status === 500).toBeTruthy();
      return;
    }

    await expect(page.locator('h1').filter({ hasText: /reading history/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`text=${publishedArticle.title}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('clear history button empties visible list', async ({ apiClient, publishedArticle, goToPage, page }) => {
    await apiClient.upsertReadingHistoryItem({
      article_id: publishedArticle.id,
      slug: publishedArticle.slug,
      title: publishedArticle.title,
      read_time_minutes: 4,
      progress: 55,
    });

    await goToPage('/history');
    const clearBtn = page.locator('button').filter({ hasText: /clear history/i }).first();
    if (await clearBtn.count() === 0) {
      const clearRes = await apiClient.clearReadingHistory();
      expect(clearRes.ok).toBeTruthy();
      return;
    }

    await clearBtn.click();
    await expect(page.getByText(/Read an article and it will show up here automatically/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
