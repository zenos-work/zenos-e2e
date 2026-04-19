/**
 * launch-surfaces.spec.ts — UI smoke coverage for post-MVP launch surfaces.
 * The tests enable their corresponding feature flags when present so the active
 * experience can be validated instead of the gated fallback.
 */

import { test, expect } from '../../fixtures/base.fixture';
import { ZenosApiClient } from '../../utils/api-client';

async function getFlag(adminClient: ZenosApiClient, flagKey: string): Promise<{ id: string; is_active: boolean } | null> {
  const res = await adminClient.getAdminFeatureFlags();
  if (!res.ok) return null;
  const body = await res.json() as { flags?: Array<{ id: string; flag_key: string; is_active: boolean }> };
  const flag = body.flags?.find((item) => item.flag_key === flagKey);
  return flag ? { id: flag.id, is_active: Boolean(flag.is_active) } : null;
}

async function setFlagState(adminClient: ZenosApiClient, flagKey: string, nextState: boolean): Promise<(() => Promise<void>) | null> {
  const flag = await getFlag(adminClient, flagKey);
  if (!flag) return null;
  if (flag.is_active !== nextState) {
    const updateRes = await adminClient.updateAdminFeatureFlag(flag.id, { is_active: nextState });
    expect(updateRes.ok).toBeTruthy();
  }

  return async () => {
    if (flag.is_active !== nextState) {
      await adminClient.updateAdminFeatureFlag(flag.id, { is_active: flag.is_active });
    }
  };
}

test.describe('Launch Surfaces UI @ui', () => {
  test.describe.configure({ timeout: 40_000 });

  test('community route renders active experience when community flag is enabled', async ({ page, goToPage, adminClient }) => {
    const restore = await setFlagState(adminClient, 'community', true);
    if (!restore) {
      test.skip(true, 'Community feature flag does not exist in this environment');
      return;
    }

    try {
      await goToPage('/community');
      await expect(page.getByRole('heading', { name: /community spaces/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: /create space/i })).toBeVisible();
      await expect(page.getByPlaceholder(/space name/i)).toBeVisible();
    } finally {
      await restore();
    }
  });

  test('marketplace browse and detail routes render active experience when marketplace flag is enabled', async ({
    page,
    goToPage,
    adminClient,
    apiClient,
  }) => {
    const restore = await setFlagState(adminClient, 'marketplace', true);
    if (!restore) {
      test.skip(true, 'Marketplace feature flag does not exist in this environment');
      return;
    }

    let itemId: string | null = null;

    try {
      const createRes = await apiClient.createMarketplaceItem({
        name: `UI Listing ${Date.now()}`,
        slug: `ui-listing-${Date.now()}`,
        short_desc: 'Marketplace listing created for UI smoke coverage',
        category: 'automation',
        item_type: 'template',
        price_cents: 0,
      });
      expect([200, 201]).toContain(createRes.status);
      const createBody = await createRes.json() as { id?: string };
      itemId = createBody.id ?? null;
      expect(itemId).toBeTruthy();
      if (!itemId) return;

      const publishRes = await apiClient.publishMarketplaceItem(itemId);
      expect(publishRes.ok).toBeTruthy();

      await goToPage('/marketplace');
      await expect(page.getByRole('heading', { name: /^marketplace$/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /browse/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /my listings/i })).toBeVisible();

      await goToPage(`/marketplace/${itemId}`);
      await expect(page.getByRole('heading', { name: new RegExp(`UI Listing`, 'i') })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: /reviews/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /get for free|buy now/i })).toBeVisible();
    } finally {
      if (itemId) {
        await apiClient.deleteMarketplaceItem(itemId);
      }
      await restore();
    }
  });
});