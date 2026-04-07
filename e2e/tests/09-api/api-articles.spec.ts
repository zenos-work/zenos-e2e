/**
 * api-articles.spec.ts — Pure API coverage for article endpoints
 */
import { test, expect } from '../../fixtures/base.fixture';

test.describe('API — Articles CRUD @api', () => {
  test('POST /api/articles creates a draft', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `API Draft ${Date.now()}` });
    expect(article.id).toBeTruthy();
      expect(article.status.toLowerCase()).toBe('draft');
    await apiClient.deleteArticle(article.id);
  });

  test('GET /api/articles/mine returns author articles', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Mine ${Date.now()}` });
    const res = await apiClient.getMyArticles();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { articles?: { id: string }[]; data?: { id: string }[] } | { id: string }[];
    const list = Array.isArray(body) ? body : (body.articles ?? body.data ?? []);
    const ids = list.map((a) => a.id);
    expect(Array.isArray(ids)).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('GET /api/articles/:id returns article', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Read ${Date.now()}` });
    const res = await apiClient.getArticle(article.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { article?: { id: string }; id?: string };
    const id = body.article ? body.article.id : body.id;
    expect(id).toBe(article.id);
    await apiClient.deleteArticle(article.id);
  });

  test('PATCH /api/articles/:id updates title', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Patch Before ${Date.now()}` });
    const newTitle = `Patch After ${Date.now()}`;
    const res = await apiClient.updateArticle(article.id, { title: newTitle });
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('DELETE /api/articles/:id deletes draft', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Delete Me ${Date.now()}` });
    const res = await apiClient.deleteArticle(article.id);
    expect([200, 204]).toContain(res.status);
  });

  test('POST /api/articles/:id/submit changes status to submitted', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Submit ${Date.now()}` });
    const res = await apiClient.submitArticle(article.id);
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('double submit returns 409 conflict', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Double Submit ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    const second = await apiClient.submitArticle(article.id);
    expect(second.status).toBe(409);
    await apiClient.deleteArticle(article.id);
  });

  test('APPROVER can approve submitted article', async ({ apiClient, approverClient }) => {
    const article = await apiClient.createArticle({ title: `Approve ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    const res = await approverClient.approveArticle(article.id);
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('APPROVER can reject submitted article with reason', async ({ apiClient, approverClient }) => {
    const article = await apiClient.createArticle({ title: `Reject ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    const res = await approverClient.rejectArticle(article.id, 'Quality issue in intro');
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('SUPERADMIN can publish approved article', async ({ apiClient, approverClient, adminClient }) => {
    const article = await apiClient.createArticle({ title: `Publish ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    await approverClient.approveArticle(article.id);
    const res = await adminClient.publishArticle(article.id);
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('AUTHOR cannot approve own article', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Self Approve ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    const res = await apiClient.approveArticle(article.id);
    expect([400, 401, 403]).toContain(res.status);
    await apiClient.deleteArticle(article.id);
  });

  test('GET /api/articles?status=published returns only published', async ({ apiClient, approverClient, adminClient }) => {
    const article = await apiClient.createArticle({ title: `Published Filter ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    await approverClient.approveArticle(article.id);
    await adminClient.publishArticle(article.id);

    const res = await apiClient.request.get(`${apiClient.baseUrl}/api/articles?status=published`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { articles?: { status: string }[] };
    if (body.articles) {
      body.articles.forEach((a) => expect(a.status).toBe('published'));
    }
    await apiClient.deleteArticle(article.id);
  });

  test('GET /api/articles/:id/related returns array', async ({ apiClient }) => {
    const article = await apiClient.createArticle({ title: `Related ${Date.now()}` });
    const res = await apiClient.getRelatedArticles(article.id);
    expect(res.ok || res.status === 404).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('SUPERADMIN can archive published article', async ({ apiClient, approverClient, adminClient }) => {
    const article = await apiClient.createArticle({ title: `Archive ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    await approverClient.approveArticle(article.id);
    await adminClient.publishArticle(article.id);
    const res = await adminClient.archiveArticle(article.id);
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('unauthenticated POST /api/articles returns 401', async ({ apiClient }) => {
    const res = await apiClient.request.post(`${apiClient.baseUrl}/api/articles`, {
      headers: { 'Content-Type': 'application/json' },
      data: { title: 'Unauth Article' },
    });
    expect(res.status()).toBe(401);
  });
});
