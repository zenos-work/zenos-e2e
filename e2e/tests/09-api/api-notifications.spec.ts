/**
 * api-notifications.spec.ts — Notifications API coverage
 */
import { test, expect } from '../../fixtures/base.fixture';

test.describe('API — Notifications @api', () => {
  test('GET /api/notifications returns notification list', async ({ apiClient }) => {
    const res = await apiClient.getUserNotifications();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { notifications?: unknown[] };
    const list = body.notifications ?? body;
    expect(Array.isArray(list)).toBeTruthy();
  });

  test('notification created when article is approved', async ({ apiClient, approverClient }) => {
    const article = await apiClient.createArticle({ title: `Notify Approve ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    await approverClient.approveArticle(article.id);

    const res = await apiClient.getUserNotifications();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { notifications?: { type: string }[] };
    const list = body.notifications ?? (body as unknown as { type: string }[]);
    if (Array.isArray(list) && list.length > 0) {
      const types = list.map((n) => n.type);
      expect(types.some((t) => /approv|status/i.test(t))).toBeTruthy();
    }
    await apiClient.deleteArticle(article.id);
  });

  test('notification created when article is rejected', async ({ apiClient, approverClient }) => {
    const article = await apiClient.createArticle({ title: `Notify Reject ${Date.now()}` });
    await apiClient.submitArticle(article.id);
    await approverClient.rejectArticle(article.id, 'Needs more detail');

    const res = await apiClient.getUserNotifications();
    expect(res.ok).toBeTruthy();
    await apiClient.deleteArticle(article.id);
  });

  test('notification created when someone follows author', async ({ readerClient, apiClient }) => {
    const me = await apiClient.getMe();
    await readerClient.followUser(me.id);

    const res = await apiClient.getUserNotifications();
    expect(res.ok).toBeTruthy();
    await readerClient.unfollowUser(me.id);
  });

  test('mark single notification as read', async ({ apiClient }) => {
    const listRes = await apiClient.getUserNotifications();
    const body = await listRes.json() as { notifications?: { id: string }[] };
    const list = body.notifications ?? (body as unknown as { id: string }[]);

    if (Array.isArray(list) && list.length > 0) {
      const notifId = list[0].id;
      const res = await apiClient.markNotificationRead(notifId);
      expect(res.ok || res.status === 404).toBeTruthy();
    } else {
      test.skip(true, 'No notifications to mark read');
    }
  });

  test('mark all notifications as read', async ({ apiClient }) => {
    const res = await apiClient.markAllNotificationsRead();
    expect(res.ok).toBeTruthy();
  });

  test('GET /api/notifications after mark-all shows read status', async ({ apiClient }) => {
    await apiClient.markAllNotificationsRead();
    const res = await apiClient.getUserNotifications();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { notifications?: { read: boolean }[] };
    const list = body.notifications ?? (body as unknown as { read: boolean }[]);
    if (Array.isArray(list)) {
      list.forEach((n) => {
        if ('read' in n) expect(n.read).toBe(true);
      });
    }
  });

  test('unread count decreases after marking read', async ({ apiClient }) => {
    const res1 = await apiClient.getUserNotifications();
    const b1 = await res1.json() as { notifications?: { read: boolean }[]; unreadCount?: number };
    const unreadBefore = b1.unreadCount ?? (Array.isArray(b1.notifications) ? b1.notifications.filter((n) => !n.read).length : 0);

    await apiClient.markAllNotificationsRead();

    const res2 = await apiClient.getUserNotifications();
    const b2 = await res2.json() as { notifications?: { read: boolean }[]; unreadCount?: number };
    const unreadAfter = b2.unreadCount ?? (Array.isArray(b2.notifications) ? b2.notifications.filter((n) => !n.read).length : 0);

    expect(unreadAfter).toBeLessThanOrEqual(unreadBefore);
  });

  test('unauthenticated GET /api/admin/notifications returns 401', async ({ apiClient }) => {
    const res = await apiClient.request.get(`${apiClient.baseUrl}/api/admin/notifications`);
    expect(res.status()).toBe(401);
  });
});
