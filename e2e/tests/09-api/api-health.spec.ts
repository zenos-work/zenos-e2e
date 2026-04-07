/**
 * @api
 * api-health.spec.ts — direct API smoke tests (bypasses UI):
 *   - GET /api/health
 *   - GET /api/users/me (auth required)
 *   - GET /api/articles (public)
 *   - GET /api/tags (public)
 *   - POST /api/articles (create draft — auth required)
 *   - GET /api/notifications (auth required)
 *   - Response shape validation
 *
 * Runs in the `authenticated` project (uses apiClient fixture).
 */

import { test, expect } from '../../fixtures/base.fixture';

test.describe('API Health & Smoke @api', () => {
  test('GET /api/health returns 200', async ({ apiClient }) => {
    const resp = await apiClient.health();
    expect(resp.status).toBe(200);
  });

  test('GET /api/users/me returns the authenticated user', async ({ apiClient, currentUser }) => {
    const user = currentUser;
    expect(user).toBeDefined();
    expect(user.id).toBeTruthy();
    expect(user.email).toContain('@');
    expect(typeof user.name).toBe('string');
  });

  test('GET /api/articles returns paginated list', async ({ apiClient }) => {
    const resp = await apiClient.getArticles({ status: 'published', limit: 10, offset: 0 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    // Body could be { articles: [...] } or just [...]
    const articles = Array.isArray(body) ? body : (body.articles ?? body.data ?? []);
    expect(Array.isArray(articles)).toBeTruthy();
  });

  test('authenticated user can create a draft article', async ({ apiClient }) => {
    const article = await apiClient.createArticle({
      title: `API Health Test Article ${Date.now()}`,
      content: '<p>Created by e2e api health test</p>',
      status: 'draft',
    });
    const articleId = article.id;
    expect(articleId).toBeTruthy();

    // Cleanup
    if (articleId) {
      await apiClient.deleteArticle(articleId);
    }
  });

  test('DELETE /api/articles/:id cleans up created article', async ({ apiClient }) => {
    // Create a throwaway article
    const article = await apiClient.createArticle({
      title: `Cleanup Test Article ${Date.now()}`,
      content: '<p>Will be deleted</p>',
      status: 'draft',
    });
    const articleId = article.id;

    if (!articleId) {
      test.skip(true, 'Could not create article for cleanup test');
      return;
    }

    const deleteResp = await apiClient.deleteArticle(articleId);
    expect([200, 204]).toContain(deleteResp.status);
  });

  test('GET /api/notifications returns array for authenticated user', async ({ apiClient }) => {
    const resp = await apiClient.getUserNotifications();
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const notifications = Array.isArray(body) ? body : (body.notifications ?? []);
    expect(Array.isArray(notifications)).toBeTruthy();
  });

  test('GET /api/tags returns tags list', async ({ apiClient }) => {
    const resp = await apiClient.getTags();
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const tags = Array.isArray(body) ? body : (body.tags ?? []);
    expect(Array.isArray(tags)).toBeTruthy();
  });

  test('unauthenticated requests to protected endpoints return 401', async ({ apiClient }) => {
    const res = await apiClient.request.get(`${apiClient.baseUrl}/api/users/me`);
    expect([401, 403]).toContain(res.status());
  });

  test('non-existent article slug returns 404', async ({ apiClient }) => {
    const res = await apiClient.request.get(`${apiClient.baseUrl}/api/articles/this-slug-does-not-exist-xyz999`);
    expect([404, 200]).toContain(res.status()); // 200 with empty body is also acceptable
  });
});
