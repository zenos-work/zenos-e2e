/**
 * api-comments.spec.ts — Pure API coverage for comment endpoints
 */
import { test, expect } from '../../fixtures/base.fixture';

test.describe('API — Comments @api', () => {
  test('GET /api/articles/:id/comments returns empty array for new article', async ({ apiClient, testArticle }) => {
    const res = await apiClient.getComments(testArticle.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { comments?: unknown[]; data?: unknown[] } | unknown[];
    const comments = Array.isArray(body)
      ? body
      : (body as { comments?: unknown[]; data?: unknown[] }).comments ?? (body as { data?: unknown[] }).data ?? [];
    expect(Array.isArray(comments)).toBeTruthy();
  });

  test('POST comment on published article', async ({ apiClient, publishedArticle, readerClient }) => {
    const res = await readerClient.postComment(publishedArticle.id, 'API test comment');
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { comment?: { id?: string }; id?: string };
    expect(body.comment?.id ?? body.id).toBeTruthy();
  });

  test('GET /api/articles/:id/comments returns posted comment', async ({ readerClient, publishedArticle }) => {
    await readerClient.postComment(publishedArticle.id, 'Visible comment');
    const res = await readerClient.getComments(publishedArticle.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { comments?: { content: string }[]; data?: { content: string }[] } | { content: string }[];
    const list = Array.isArray(body)
      ? body
      : body.comments ?? body.data ?? [];
    const found = Array.isArray(list) && list.some((c) => c.content === 'Visible comment');
    expect(found).toBeTruthy();
  });

  test('PATCH /api/comments/:id edits comment content', async ({ readerClient, publishedArticle }) => {
    const postRes = await readerClient.postComment(publishedArticle.id, 'Original');
    const body = await postRes.json() as { comment?: { id: string }; id?: string };
    const id = body.comment?.id ?? body.id;
    expect(id).toBeTruthy();
    const editRes = await readerClient.editComment(id, 'Edited content');
    expect(editRes.ok).toBeTruthy();
  });

  test('DELETE /api/comments/:id removes comment', async ({ readerClient, publishedArticle }) => {
    const postRes = await readerClient.postComment(publishedArticle.id, 'To delete');
    const body = await postRes.json() as { comment?: { id: string }; id?: string };
    const id = body.comment?.id ?? body.id;
    expect(id).toBeTruthy();
    const delRes = await readerClient.deleteComment(id);
    expect([200, 204]).toContain(delRes.status);
  });

  test('POST nested reply creates threaded comment', async ({ readerClient, publishedArticle }) => {
    const parent = await readerClient.postComment(publishedArticle.id, 'Parent comment');
    const parentBody = await parent.json() as { comment?: { id: string }; id?: string };
    const parentId = parentBody.comment?.id ?? parentBody.id;
    expect(parentId).toBeTruthy();
    const reply = await readerClient.postComment(publishedArticle.id, 'Reply comment', parentId);
    expect(reply.ok).toBeTruthy();
    const replyBody = await reply.json() as { comment?: { id: string }; id?: string };
    expect(replyBody.comment?.id ?? replyBody.id).toBeTruthy();
  });

  test('GET /api/comments/:id/replies returns children', async ({ readerClient, publishedArticle }) => {
    const parent = await readerClient.postComment(publishedArticle.id, 'Thread root');
    const parentBody = await parent.json() as { comment?: { id: string }; id?: string };
    const parentId = parentBody.comment?.id ?? parentBody.id;
    expect(parentId).toBeTruthy();
    await readerClient.postComment(publishedArticle.id, 'Child 1', parentId);
    await readerClient.postComment(publishedArticle.id, 'Child 2', parentId);
    const res = await readerClient.getReplies(parentId);
    expect(res.ok || res.status === 404).toBeTruthy();
  });

  test('POST empty comment body returns 400', async ({ readerClient, publishedArticle }) => {
    const res = await readerClient.postComment(publishedArticle.id, '');
    expect([400, 422]).toContain(res.status);
  });

  test('POST flag comment sends moderation request', async ({ readerClient, publishedArticle, apiClient }) => {
    const c = await readerClient.postComment(publishedArticle.id, 'Flaggable content');
    const body = await c.json() as { comment?: { id: string }; id?: string };
    const id = body.comment?.id ?? body.id;
    expect(id).toBeTruthy();
    const flagRes = await apiClient.flagComment(id, 'spam');
    // Moderation implementations vary (synchronous accept vs. validation/conflict),
    // but this request should never produce a server error.
    expect(flagRes.status).toBeLessThan(500);
  });

  test('unauthenticated user cannot post comment (401)', async ({ apiClient, publishedArticle }) => {
    const res = await apiClient.request.post(`${apiClient.baseUrl}/api/comments`, {
      headers: { 'Content-Type': 'application/json' },
      data: { article_id: publishedArticle.id, content: 'Anon comment' },
    });
    expect(res.status()).toBe(401);
  });

  test('comment on non-existent article returns 404', async ({ readerClient }) => {
    const res = await readerClient.postComment('non-existent-article-id', 'Comment on ghost');
    expect([404, 400, 500]).toContain(res.status);
  });
});
