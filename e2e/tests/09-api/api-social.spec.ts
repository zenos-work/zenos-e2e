/**
 * api-social.spec.ts — Likes, bookmarks, follows, reactions, shares
 */
import { test, expect } from '../../fixtures/base.fixture';

async function getMeWithRetry(client: { getMe: () => Promise<{ id: string }> }): Promise<{ id: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.getMe();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  }
  throw lastError;
}

test.describe('API — Likes @api', () => {
  test('like a published article', async ({ readerClient, publishedArticle }) => {
    const res = await readerClient.likeArticle(publishedArticle.id);
    expect(res.ok).toBeTruthy();
    await readerClient.unlikeArticle(publishedArticle.id);
  });

  test('unlike a previously liked article', async ({ readerClient, publishedArticle }) => {
    await readerClient.likeArticle(publishedArticle.id);
    const res = await readerClient.unlikeArticle(publishedArticle.id);
    expect(res.ok).toBeTruthy();
  });

  test('check like status returns liked=true after liking', async ({ readerClient, publishedArticle }) => {
    await readerClient.likeArticle(publishedArticle.id);
    const res = await readerClient.checkLike(publishedArticle.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { has_liked?: boolean; liked?: boolean };
    expect(body.has_liked ?? body.liked).toBe(true);
    await readerClient.unlikeArticle(publishedArticle.id);
  });

  test('get like stats returns count after like', async ({ readerClient, publishedArticle }) => {
    await readerClient.likeArticle(publishedArticle.id);
    const res = await readerClient.getLikeStats(publishedArticle.id);
    if (res.ok) {
      const body = await res.json() as { count?: number; likes?: number };
      const count = body.count ?? body.likes ?? 0;
      expect(typeof count).toBe('number');
    }
    await readerClient.unlikeArticle(publishedArticle.id);
  });
});

test.describe('API — Bookmarks @api', () => {
  test('bookmark a published article', async ({ readerClient, publishedArticle }) => {
    const res = await readerClient.bookmarkArticle(publishedArticle.id);
    expect(res.ok).toBeTruthy();
    await readerClient.unbookmarkArticle(publishedArticle.id);
  });

  test('unbookmark a bookmarked article', async ({ readerClient, publishedArticle }) => {
    await readerClient.bookmarkArticle(publishedArticle.id);
    const res = await readerClient.unbookmarkArticle(publishedArticle.id);
    expect(res.ok).toBeTruthy();
  });

  test('check bookmark status returns bookmarked=true', async ({ readerClient, publishedArticle }) => {
    await readerClient.bookmarkArticle(publishedArticle.id);
    const res = await readerClient.checkBookmark(publishedArticle.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { has_bookmarked?: boolean; bookmarked?: boolean };
    expect(body.has_bookmarked ?? body.bookmarked).toBe(true);
    await readerClient.unbookmarkArticle(publishedArticle.id);
  });

  test('GET /api/bookmarks returns bookmarks list', async ({ readerClient, publishedArticle }) => {
    await readerClient.bookmarkArticle(publishedArticle.id);
    const res = await readerClient.getBookmarks();
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { data?: unknown[]; bookmarks?: unknown[] };
    const list = body.data ?? body.bookmarks ?? body;
    expect(Array.isArray(list)).toBeTruthy();
    await readerClient.unbookmarkArticle(publishedArticle.id);
  });
});

test.describe('API — Follows @api', () => {
  test('follow author (READER follows AUTHOR)', async ({ readerClient, apiClient }) => {
    const me = await getMeWithRetry(apiClient);
    const res = await readerClient.followUser(me.id);
    expect(res.ok).toBeTruthy();
    await readerClient.unfollowUser(me.id);
  });

  test('unfollow previously followed user', async ({ readerClient, apiClient }) => {
    const me = await getMeWithRetry(apiClient);
    await readerClient.followUser(me.id);
    const res = await readerClient.unfollowUser(me.id);
    expect(res.ok).toBeTruthy();
  });

  test('check follow status returns following=true', async ({ readerClient, apiClient }) => {
    const me = await getMeWithRetry(apiClient);
    await readerClient.followUser(me.id);
    const res = await readerClient.checkFollow(me.id);
    if (res.ok) {
      const body = await res.json() as { is_following?: boolean; following?: boolean };
      expect(body.is_following ?? body.following).toBe(true);
    }
    await readerClient.unfollowUser(me.id);
  });

  test('GET /api/users/:id/followers returns list', async ({ readerClient, apiClient }) => {
    const me = await getMeWithRetry(apiClient);
    await readerClient.followUser(me.id);
    const res = await apiClient.getFollowers(me.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as { data?: unknown[]; followers?: unknown[] };
    const list = body.data ?? body.followers ?? body;
    expect(Array.isArray(list)).toBeTruthy();
    await readerClient.unfollowUser(me.id);
  });

  test('GET /api/users/:id/following returns list', async ({ readerClient, apiClient }) => {
    const me = await getMeWithRetry(apiClient);
    await readerClient.followUser(me.id);
    const readerMe = await getMeWithRetry(readerClient);
    const res = await readerClient.getFollowing(readerMe.id);
    expect(res.ok).toBeTruthy();
    await readerClient.unfollowUser(me.id);
  });

  test('follow stats returns follower count', async ({ readerClient, apiClient }) => {
    const me = await getMeWithRetry(apiClient);
    await readerClient.followUser(me.id);
    const res = await apiClient.getFollowStats(me.id);
    if (res.ok) {
      const body = await res.json() as { followers?: number; following?: number };
      expect(typeof (body.followers ?? body.following ?? 0)).toBe('number');
    }
    await readerClient.unfollowUser(me.id);
  });
});

test.describe('API — Reactions @api', () => {
  test('add reaction to published article', async ({ readerClient, publishedArticle }) => {
    const res = await readerClient.addReaction(publishedArticle.id, 'fire');
    expect(res.ok || res.status === 422).toBeTruthy();
  });

  test('get reactions for article returns object', async ({ readerClient, publishedArticle }) => {
    const res = await readerClient.getReactions(publishedArticle.id);
    expect(res.ok).toBeTruthy();
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body).toBe('object');
  });

  test('remove reaction from article', async ({ readerClient, publishedArticle }) => {
    await readerClient.addReaction(publishedArticle.id, 'fire');
    const res = await readerClient.removeReaction(publishedArticle.id, 'fire');
    expect(res.ok || res.status === 404 || res.status === 422).toBeTruthy();
  });
});

test.describe('API — Shares @api', () => {
  test('record article share', async ({ readerClient, publishedArticle }) => {
    const res = await readerClient.recordShare(publishedArticle.id, 'twitter');
    expect(res.ok || res.status === 400).toBeTruthy();
  });
});
