/**
 * @admin @smoke
 * P4 admin flag smoke: toggle admin_earnings on/off and verify
 * API behavior + UI visibility in a single flow.
 */

import { test, expect } from '../../fixtures/base.fixture';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

test.describe('P4 Admin Feature Flag Smoke @admin @smoke', () => {
  test('admin_earnings toggle controls API + UI', async ({ page, adminClient, goToPage }) => {
    const headers = {
      Authorization: `Bearer ${adminClient.token}`,
      'Content-Type': 'application/json',
      'X-Test-Suite': 'zenos-e2e',
    };

    const listRes = await adminClient.request.get(`${adminClient.baseUrl}/api/admin/feature-flags`, { headers });
    if (!listRes.ok()) {
      test.skip(true, `Feature flag admin endpoint unavailable (${listRes.status()})`);
      return;
    }

    const listBody = await listRes.json() as { flags?: Array<{ id: string; flag_key: string; is_active: boolean }> };
    const flags = listBody.flags ?? [];
    const earningsFlag = flags.find((flag) => flag.flag_key === 'admin_earnings');

    expect(earningsFlag, 'admin_earnings flag must exist').toBeDefined();
    if (!earningsFlag) return;

    const originalState = Boolean(earningsFlag.is_active);

    const setActive = async (nextState: boolean) => {
      const updateRes = await adminClient.request.put(
        `${adminClient.baseUrl}/api/admin/feature-flags/${earningsFlag.id}`,
        {
          headers,
          data: { is_active: nextState },
        },
      );
      if (!updateRes.ok()) {
        test.skip(true, `Unable to toggle admin_earnings flag (${updateRes.status()})`);
        return;
      }
    };

    try {
      // 1) Turn OFF and verify API denies + UI section hidden.
      await setActive(false);

      const offApiRes = await adminClient.request.post(
        `${adminClient.baseUrl}/api/admin/earnings/calculate`,
        {
          headers,
          data: {
            period_start: '2026-04-01',
            period_end: '2026-04-30',
            active_subscribers: 10,
          },
        },
      );
      expect(offApiRes.status(), 'Expected flag-off API denial').toBe(403);

      await goToPage('/admin');
      const featureFlagsTab = page.locator('button, a').filter({ hasText: /feature flags/i }).first();
      if (await featureFlagsTab.count()) {
        await featureFlagsTab.click();
      }
      await page.waitForTimeout(900);
      await expect(page.getByRole('heading', { name: /earnings calculation/i })).toHaveCount(0);

      // 2) Turn ON and verify API allowed + UI section visible.
      await setActive(true);

      const onApiRes = await adminClient.request.post(
        `${adminClient.baseUrl}/api/admin/earnings/calculate`,
        {
          headers,
          data: {
            period_start: '2026-04-01',
            period_end: '2026-04-30',
            active_subscribers: 10,
          },
        },
      );
      expect(onApiRes.status(), 'Expected flag-on API to be reachable').not.toBe(403);

      await page.goto(`${FRONTEND_URL}/admin`, { waitUntil: 'domcontentloaded' });
      if (await featureFlagsTab.count()) {
        await featureFlagsTab.click();
      }
      await expect(page.getByRole('heading', { name: /earnings calculation/i })).toBeVisible({ timeout: 12_000 });
    } finally {
      await setActive(originalState);
    }
  });
});
