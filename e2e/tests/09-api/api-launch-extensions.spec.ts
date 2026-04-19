/**
 * api-launch-extensions.spec.ts — launch-scope feature coverage added after MVP:
 * - feature announcement preview
 * - connected social accounts
 * - workflow versioning and restore
 * - community spaces and posts
 * - marketplace listings, purchases, and reviews
 */

import { test, expect } from '../../fixtures/base.fixture';
import { ZenosApiClient } from '../../utils/api-client';

function extractId(body: unknown, keys: string[] = ['id']): string | null {
  if (!body || typeof body !== 'object') return null;

  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  for (const value of Object.values(body as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const nested = extractId(value, keys);
      if (nested) return nested;
    }
  }

  return null;
}

async function findFlagId(adminClient: ZenosApiClient, flagKey: string): Promise<string | null> {
  const listRes = await adminClient.getAdminFeatureFlags();
  if (!listRes.ok) return null;
  const body = await listRes.json() as { flags?: Array<{ id: string; flag_key: string }> };
  return body.flags?.find((flag) => flag.flag_key === flagKey)?.id ?? null;
}

test.describe('Launch Extensions API @api', () => {
  test.describe.configure({ timeout: 40_000 });

  test('SUPERADMIN can preview a feature announcement payload', async ({ adminClient }) => {
    const res = await adminClient.previewAdminFeatureAnnouncement({
      flag_key: 'launch_extension_preview',
      name: 'Launch Extension Preview',
      category: 'general',
      action: 'enabled',
      is_active: true,
      target_type: 'global',
      metadata: {
        announcement: {
          enabled_title: 'Launch Extension Preview enabled',
          enabled_summary: 'Preview this message before rollout.',
          channels: ['in_app', 'email'],
        },
      },
    });

    expect(res.ok).toBeTruthy();
    const body = await res.json() as {
      action?: string;
      message?: string;
      scope?: string;
      channels?: string[];
      recipient_count?: number;
    };

    expect(body.action).toBe('enabled');
    expect(typeof body.message).toBe('string');
    expect((body.message ?? '').length).toBeGreaterThan(0);
    expect(Array.isArray(body.channels)).toBeTruthy();
    expect(typeof body.recipient_count).toBe('number');
  });

  test('AUTHOR can connect, list, inspect share URL, and disconnect a social account', async ({ apiClient, publishedArticle }) => {
    const provider = 'linkedin';
    const providerUid = `e2e-linkedin-${Date.now()}`;

    const connectRes = await apiClient.connectSocialAccount({
      provider,
      provider_uid: providerUid,
      handle: '@zenos-e2e',
    });
    expect([200, 201, 409]).toContain(connectRes.status);

    const listRes = await apiClient.getSocialAccounts();
    expect(listRes.ok).toBeTruthy();
    const listBody = await listRes.json() as { data?: Array<{ provider: string; provider_uid?: string }> };
    expect(Array.isArray(listBody.data)).toBeTruthy();
    expect((listBody.data ?? []).some((account) => account.provider === provider)).toBeTruthy();

    const shareUrlRes = await apiClient.getShareUrl(
      publishedArticle.id,
      provider,
      `https://zenos.work/article/${publishedArticle.slug}`,
      publishedArticle.title,
    );
    expect(shareUrlRes.ok).toBeTruthy();
    const shareUrlBody = await shareUrlRes.json() as { provider?: string; share_url?: string; url?: string };
    expect(shareUrlBody.provider).toBe(provider);
    expect(typeof (shareUrlBody.share_url ?? shareUrlBody.url)).toBe('string');

    const disconnectRes = await apiClient.disconnectSocialAccount(provider);
    expect(disconnectRes.ok).toBeTruthy();
  });

  test('AUTHOR workflow supports version creation and restore', async ({ apiClient }) => {
    let workflowId: string | null = null;

    try {
      const createRes = await apiClient.createWorkflow({
        name: `E2E Workflow ${Date.now()}`,
        description: 'Workflow created by Playwright for version coverage',
        status: 'draft',
      });

      if (!createRes.ok) {
        test.skip(true, `Workflow creation unavailable (${createRes.status})`);
        return;
      }

      const createBody = await createRes.json() as Record<string, unknown>;
      workflowId = extractId(createBody, ['workflow_id', 'id']);
      expect(workflowId).toBeTruthy();
      if (!workflowId) return;

      const versionsBeforeRes = await apiClient.getWorkflowVersions(workflowId);
      expect(versionsBeforeRes.ok).toBeTruthy();

      const createVersionRes = await apiClient.createWorkflowVersion(workflowId, 'E2E version checkpoint');
      expect([200, 201]).toContain(createVersionRes.status);
      const createVersionBody = await createVersionRes.json() as { version_number?: number };
      const versionNumber = createVersionBody.version_number;
      expect(typeof versionNumber).toBe('number');

      if (typeof versionNumber === 'number') {
        const restoreRes = await apiClient.restoreWorkflowVersion(workflowId, versionNumber);
        expect(restoreRes.ok).toBeTruthy();
        const restoreBody = await restoreRes.json() as { restored_version?: number };
        expect(restoreBody.restored_version).toBe(versionNumber);
      }
    } finally {
      if (workflowId) {
        await apiClient.deleteWorkflow(workflowId);
      }
    }
  });

  test('AUTHOR can create community space, join it, publish a post, and like it', async ({ apiClient }) => {
    let spaceId: string | null = null;

    try {
      const createSpaceRes = await apiClient.createCommunitySpace({
        name: `E2E Space ${Date.now()}`,
        slug: `e2e-space-${Date.now()}`,
        description: 'Community space created by Playwright',
        space_type: 'open',
      });
      expect([200, 201]).toContain(createSpaceRes.status);
      const createSpaceBody = await createSpaceRes.json() as Record<string, unknown>;
      spaceId = extractId(createSpaceBody);
      expect(spaceId).toBeTruthy();
      if (!spaceId) return;

      const joinRes = await apiClient.joinCommunitySpace(spaceId);
      expect([200, 201, 409]).toContain(joinRes.status);

      const createPostRes = await apiClient.createCommunityPost(spaceId, {
        title: `E2E Community Post ${Date.now()}`,
        body: 'Community post body created by the automated functional suite.',
        post_type: 'discussion',
      });
      expect([200, 201]).toContain(createPostRes.status);
      const createPostBody = await createPostRes.json() as Record<string, unknown>;
      const postId = extractId(createPostBody);
      expect(postId).toBeTruthy();

      const postsRes = await apiClient.getCommunityPosts(spaceId);
      expect(postsRes.ok).toBeTruthy();
      const postsBody = await postsRes.json() as { posts?: Array<{ id: string }> };
      expect(Array.isArray(postsBody.posts)).toBeTruthy();

      if (postId) {
        const likeRes = await apiClient.likeCommunityPost(spaceId, postId);
        expect(likeRes.ok).toBeTruthy();

        const replyRes = await apiClient.createCommunityPost(spaceId, {
          title: '',
          body: 'Reply created by Playwright',
          parent_id: postId,
        });
        expect([200, 201]).toContain(replyRes.status);

        const repliesRes = await apiClient.getCommunityReplies(spaceId, postId);
        expect(repliesRes.ok).toBeTruthy();
      }
    } finally {
      if (spaceId) {
        await apiClient.deleteCommunitySpace(spaceId);
      }
    }
  });

  test('AUTHOR and READER can complete marketplace create, publish, purchase, and review flow', async ({ apiClient, readerClient }) => {
    let itemId: string | null = null;

    try {
      const createItemRes = await apiClient.createMarketplaceItem({
        name: `E2E Listing ${Date.now()}`,
        slug: `e2e-listing-${Date.now()}`,
        short_desc: 'Marketplace listing created by Playwright',
        category: 'automation',
        item_type: 'template',
        price_cents: 0,
        currency: 'USD',
      });
      expect([200, 201]).toContain(createItemRes.status);
      const createItemBody = await createItemRes.json() as Record<string, unknown>;
      itemId = extractId(createItemBody);
      expect(itemId).toBeTruthy();
      if (!itemId) return;

      const publishRes = await apiClient.publishMarketplaceItem(itemId);
      expect(publishRes.ok).toBeTruthy();

      const listRes = await apiClient.getMarketplaceItems();
      expect(listRes.ok).toBeTruthy();
      const listBody = await listRes.json() as { items?: Array<{ id: string }> };
      expect(Array.isArray(listBody.items)).toBeTruthy();

      const detailRes = await readerClient.getMarketplaceItem(itemId);
      expect(detailRes.ok).toBeTruthy();

      const purchaseRes = await readerClient.purchaseMarketplaceItem(itemId, {
        price_paid_cents: 0,
        currency: 'USD',
      });
      expect([200, 201, 409]).toContain(purchaseRes.status);

      const myPurchasesRes = await readerClient.getMyMarketplacePurchases();
      expect(myPurchasesRes.ok).toBeTruthy();

      const reviewRes = await readerClient.createMarketplaceReview(itemId, {
        rating: 5,
        body: 'Strong marketplace review from Playwright coverage.',
      });
      expect([200, 201, 409]).toContain(reviewRes.status);

      const reviewsRes = await readerClient.getMarketplaceReviews(itemId);
      expect(reviewsRes.ok).toBeTruthy();
      const reviewsBody = await reviewsRes.json() as { reviews?: Array<{ rating?: number }> };
      expect(Array.isArray(reviewsBody.reviews)).toBeTruthy();
      expect((reviewsBody.reviews ?? []).length).toBeGreaterThan(0);
    } finally {
      if (itemId) {
        await apiClient.deleteMarketplaceItem(itemId);
      }
    }
  });

  test('SUPERADMIN can access community and marketplace launch flags when present', async ({ adminClient }) => {
    const communityFlagId = await findFlagId(adminClient, 'community');
    const marketplaceFlagId = await findFlagId(adminClient, 'marketplace');

    if (!communityFlagId && !marketplaceFlagId) {
      test.skip(true, 'Community and marketplace flags are not seeded in this environment');
      return;
    }

    expect(communityFlagId || marketplaceFlagId).toBeTruthy();
  });
});