/**
 * api-membership.spec.ts — Membership and premium conversion API coverage
 */
import { test, expect } from '../../fixtures/base.fixture';

test.describe('API — Membership & Premium @api', () => {
  test('GET /api/membership/plans returns plans list', async ({ apiClient }) => {
    const res = await apiClient.getMembershipPlans();
    expect(res.ok).toBeTruthy();

    const body = await res.json() as { plans?: Array<{ tier?: string; name?: string }> };
    const plans = body.plans ?? [];
    expect(Array.isArray(plans)).toBeTruthy();
    expect(plans.length).toBeGreaterThan(0);
  });

  test('GET /api/membership/me returns current membership', async ({ apiClient }) => {
    const res = await apiClient.getMyMembership();
    expect(res.ok || res.status === 404).toBeTruthy();

    if (res.ok) {
      const body = await res.json() as { membership?: { tier?: string; status?: string } };
      expect(body.membership).toBeTruthy();
    }
  });

  test('POST /api/membership/upgrade upgrades tier for signed-in user', async ({ apiClient }) => {
    const tier: 'creator_pro' | 'team_suite' = Date.now() % 2 === 0 ? 'creator_pro' : 'team_suite';
    const res = await apiClient.upgradeMembership({
      tier,
      stripe_subscription_id: `e2e-sub-${Date.now()}`,
    });
    expect(res.ok).toBeTruthy();

    const body = await res.json() as { tier?: string; status?: string };
    expect(body.tier).toBe(tier);
    expect(body.status).toBe('active');
  });

  test('POST /api/membership/premium-read tracks a premium read event', async ({ apiClient, publishedArticle }) => {
    const res = await apiClient.trackPremiumRead({
      article_id: publishedArticle.id,
      scroll_depth: 87.4,
      duration_seconds: 156,
    });

    expect(res.ok).toBeTruthy();
    const body = await res.json() as { id?: string; tracked_at?: string };
    expect(body.id).toBeTruthy();
    expect(body.tracked_at).toBeTruthy();
  });

  test('POST /api/membership/funnel-event logs conversion funnel event (authenticated)', async ({ apiClient, publishedArticle }) => {
    const res = await apiClient.logPremiumFunnelEvent({
      event_type: 'paywall_viewed',
      article_id: publishedArticle.id,
      device_type: 'desktop',
      referrer: 'e2e-suite',
    });

    expect(res.ok).toBeTruthy();
    const body = await res.json() as { event_id?: string; logged_at?: string };
    expect(body.event_id).toBeTruthy();
    expect(body.logged_at).toBeTruthy();
  });

  test('POST /api/membership/funnel-event logs anonymous event too', async ({ apiClient }) => {
    const res = await apiClient.request.post(`${apiClient.baseUrl}/api/membership/funnel-event`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        event_type: 'pricing_page_view',
        device_type: 'desktop',
        referrer: 'anonymous-e2e',
      },
    });

    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);
  });

  test('POST /api/membership/upgrade rejects invalid tier', async ({ apiClient }) => {
    const res = await apiClient.request.post(`${apiClient.baseUrl}/api/membership/upgrade`, {
      headers: apiClient.authHeaders,
      data: { tier: 'enterprise_ultra' },
    });

    expect(res.status()).toBe(400);
  });

  test('POST /api/membership/premium-read requires article_id', async ({ apiClient }) => {
    const res = await apiClient.request.post(`${apiClient.baseUrl}/api/membership/premium-read`, {
      headers: apiClient.authHeaders,
      data: { scroll_depth: 20, duration_seconds: 10 },
    });

    expect(res.status()).toBe(400);
  });
});
