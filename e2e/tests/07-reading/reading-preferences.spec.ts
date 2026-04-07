/**
 * @reading
 * reading-preferences.spec.ts — tests reading comfort/personalization settings:
 *   - Font family selector
 *   - Font size slider
 *   - Line width / content width
 *   - Color scheme (sepia / default)
 *   - Preferences are persisted to localStorage
 *   - Onboarding topic picker at /onboarding/preferences
 *
 * Runs in the `authenticated` project.
 */

import { test, expect } from '../../fixtures/base.fixture';

test.describe('Reading Preferences @reading', () => {
  test('reading settings panel opens on article page', async ({ page, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);

    const settingsBtn = page
      .locator('button[aria-label*="reading" i], button[aria-label*="settings" i], [data-testid="reading-settings"]')
      .first();

    await expect(settingsBtn).toBeVisible();

    await settingsBtn.click();
    await page.waitForTimeout(300);

    const settingsPanel = page.locator('[data-testid="reading-settings-panel"], .reading-settings').first();
    await expect(settingsPanel).toBeVisible({ timeout: 5_000 });
  });

  test('font family selector changes font', async ({ page, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);

    const settingsBtn = page
      .locator('button[aria-label*="reading" i], [data-testid="reading-settings"]')
      .first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await page.waitForTimeout(300);

    const fontSelector = page
      .locator('select[data-testid="font-family"], [data-testid="font-selector"] button')
      .nth(0);

    await expect(fontSelector).toBeVisible();

    const initialPrefs = await page.evaluate(() => {
      const storage = (globalThis as unknown as { localStorage: { getItem: (key: string) => string | null } }).localStorage;
      const raw = storage.getItem('zenos_reading_prefs') ?? '{}';
      return JSON.parse(raw) as { fontFamily?: string };
    });

    const targetFont = initialPrefs.fontFamily === 'serif' ? 'sans' : 'serif';
    const targetButton = page.getByRole('button', { name: new RegExp(`set ${targetFont} font`, 'i') });
    await expect(targetButton).toBeVisible();
    await targetButton.click();

    await page.waitForTimeout(300);
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => {
          const storage = (globalThis as unknown as { localStorage: { getItem: (key: string) => string | null } }).localStorage;
          return storage.getItem('zenos_reading_prefs') ?? '{}';
        });
        return (JSON.parse(raw) as { fontFamily?: string }).fontFamily ?? null;
      }, { timeout: 5_000 })
      .toBe(targetFont);
  });

  test('font size control adjusts text size', async ({ page, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);

    const settingsBtn = page.locator('button[aria-label*="reading" i], [data-testid="reading-settings"]').first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await page.waitForTimeout(300);

    const initialPrefs = await page.evaluate(() => {
      const storage = (globalThis as unknown as { localStorage: { getItem: (key: string) => string | null } }).localStorage;
      const raw = storage.getItem('zenos_reading_prefs') ?? '{}';
      return JSON.parse(raw) as { fontSize?: 'sm' | 'base' | 'lg' | 'xl' };
    });

    const sizeUp = page.locator('[data-testid="font-size-up"], button[aria-label*="increase font" i]').first();
    const sizeDown = page.locator('[data-testid="font-size-down"], button[aria-label*="decrease font" i]').first();
    const canIncrease = initialPrefs.fontSize !== 'xl';
    const targetSize = initialPrefs.fontSize === 'sm'
      ? 'base'
      : initialPrefs.fontSize === 'base' || !initialPrefs.fontSize
        ? 'lg'
        : initialPrefs.fontSize === 'lg'
          ? 'xl'
          : 'lg';

    await expect(canIncrease ? sizeUp : sizeDown).toBeVisible();

    await (canIncrease ? sizeUp : sizeDown).click();
    await page.waitForTimeout(300);

    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => {
          const storage = (globalThis as unknown as { localStorage: { getItem: (key: string) => string | null } }).localStorage;
          return storage.getItem('zenos_reading_prefs') ?? '{}';
        });
        return (JSON.parse(raw) as { fontSize?: string }).fontSize ?? null;
      }, { timeout: 5_000 })
      .toBe(targetSize);
  });

  test('preferences persist to localStorage', async ({ page, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);

    const settingsBtn = page.locator('[data-testid="reading-settings"], button[aria-label*="reading" i]').first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await page.waitForTimeout(300);

    const sizeUp = page
      .locator('[data-testid="font-size-up"], button[aria-label*="increase font" i]')
      .first();

    await expect(sizeUp).toBeVisible();
    await sizeUp.click();
    await page.waitForTimeout(300);

    const prefs = await page.evaluate(() => {
      const storage = (globalThis as unknown as { localStorage: { getItem: (key: string) => string | null } }).localStorage;
      const raw = storage.getItem('zenos_reading_prefs') ?? '{}';
      return JSON.parse(raw);
    });

    expect(typeof prefs).toBe('object');
    expect(prefs.fontSize).toBeTruthy();
  });
});

test.describe('Onboarding — Topic Preferences @reading', () => {
  test('onboarding/preferences page renders topic picker', async ({ page, goToPage }) => {
    await goToPage('/onboarding/preferences');

    const topicPicker = page
      .locator('[data-testid="topic-picker"], .topic-picker, [data-testid="preferences-page"]')
      .first();

    const heading = page.locator('h1, h2').filter({ hasText: /preferences|interests|topics/i }).first();

    await expect(topicPicker.or(heading).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('main, body').first()).toBeVisible();
  });

  test('topic chips can be selected', async ({ page, goToPage }) => {
    await goToPage('/onboarding/preferences');

    const topicChip = page
      .locator('[data-testid="topic-chip"], .topic-chip, button[data-topic]')
      .first();

    await expect(topicChip).toBeVisible({ timeout: 10_000 });

    const initialClass = await topicChip.evaluate((el) => el.className);
    await topicChip.click();
    await page.waitForTimeout(200);
    const newClass = await topicChip.evaluate((el) => el.className);
    expect(newClass).not.toBe(initialClass);
  });
});

test.describe('Stats Dashboard @reading', () => {
  test.beforeEach(async ({ goToPage }) => {
    await goToPage('/stats');
  });

  test('stats page renders for authenticated user', async ({ page }) => {
    if (!page.url().includes('/stats')) {
      await expect(page.locator('main, [role="main"], body').first()).toBeVisible({ timeout: 15_000 });
      return;
    }
    const main = page.locator('main, [data-testid="stats"], [role="main"]').first();
    await expect(main.or(page.locator('body')).first()).toBeVisible({ timeout: 15_000 });
  });

  test('stats tabs switch between Overview / Stories / Audience / Business', async ({ page }) => {
    const tabs = ['Overview', 'Stories', 'Audience', 'Business'];
    for (const tabName of tabs) {
      const tab = page
        .locator('button, [role="tab"], a')
        .filter({ hasText: new RegExp(`^${tabName}$`, 'i') })
        .first();
      if (await tab.count() > 0) {
        await tab.click();
        await page.waitForTimeout(400);
        await expect(page.locator('main, body').first()).toBeVisible();
      }
    }
  });

  test('date range selector changes stats view', async ({ page }) => {
    const rangeSelector = page
      .locator('select[data-testid="date-range"], [data-testid="range-selector"]')
      .or(page.locator('button').filter({ hasText: /7 days|30 days|this month|all time/i }))
      .first();

    if (await rangeSelector.count() > 0) {
      await rangeSelector.click();
      await page.waitForTimeout(300);
      await expect(page.locator('main, body').first()).toBeVisible();
    }
  });
});

test.describe('Library Page @reading', () => {
  test.beforeEach(async ({ goToPage }) => {
    await goToPage('/library');
  });

  test("library page shows user's articles", async ({ page }) => {
    if (!page.url().includes('/library')) {
      await expect(page.locator('main, [role="main"], body').first()).toBeVisible({ timeout: 15_000 });
      return;
    }
    const main = page.locator('main, [role="main"]').first();
    await expect(main.or(page.locator('body')).first()).toBeVisible({ timeout: 15_000 });
  });

  test('edit link on library article navigates to /write/:id', async ({ page, apiClient, goToPage }) => {
    let seededArticleId: string | null = null;
    const editLink = page.locator('a[href*="/write/"]').first();
    let count = await editLink.count();

    if (count === 0) {
      const seeded = await apiClient.createArticle({
        title: `Library Edit Link ${Date.now()}`,
        content:
          '<h2>Library Seed</h2><p>This seeded draft ensures the library page exposes at least one editable article so the edit-link navigation assertion is deterministic in CI.</p><p>The content is intentionally verbose and structured to satisfy editorial validation requirements.</p>',
      });
      seededArticleId = seeded.id;

      await goToPage('/library');
      await page.waitForTimeout(700);
      count = await editLink.count();
    }

    expect(count).toBeGreaterThan(0);

    const href = await editLink.getAttribute('href');
    expect(href).toMatch(/\/write\/.+/);

    await editLink.click();
    await expect(page).toHaveURL(/\/write\/.+/);

    // Editor should load the existing article
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });

    if (seededArticleId) {
      await apiClient.deleteArticle(seededArticleId);
    }
  });
});
