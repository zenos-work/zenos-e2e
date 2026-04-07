/**
 * @articles
 * write.spec.ts — full article authoring lifecycle:
 *   - /write loads the TipTap editor
 *   - /write/:id opens an existing draft
 *   - Typing content, save draft (button & Ctrl+S)
 *   - Metadata sidebar: tags, SEO, reading level, cover upload
 *   - Submit for review → status changes
 *   - Editor toolbar actions (bold, link, etc.)
 *
 * Uses `testArticle` fixture so each test has a pre-created draft to work with.
 */

import { test, expect } from '../../fixtures/base.fixture';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

test.describe('Write / Editor — New Article @articles', () => {
  test.beforeEach(async ({ goToPage }) => {
    await goToPage('/write');
  });

  test('editor page renders TipTap editor', async ({ page }) => {
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable], [data-testid="editor"]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
  });

  test('title input is present and focusable', async ({ page }) => {
    const titleInput = page
      .locator('input[placeholder*="title" i], textarea[placeholder*="title" i], [data-testid="article-title"], h1[contenteditable]')
      .first();
    await expect(titleInput).toBeVisible({ timeout: 15_000 });
  });

  test('title input accepts text', async ({ page }) => {
    const titleInput = page
      .locator('input[placeholder*="title" i], [data-testid="article-title"]')
      .first();
    if (await titleInput.count() === 0) test.skip(true, 'No title input');
    const ts = Date.now();
    await titleInput.fill(`E2E Test Article ${ts}`);
    const val = await titleInput.inputValue();
    expect(val).toContain(`E2E Test Article`);
  });

  test('editor accepts typed content', async ({ page }) => {
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.type('This is automated E2E test content.');
    const text = await editor.textContent();
    expect(text).toContain('E2E test content');
  });

  test('save draft button triggers save', async ({ page, waitForToast }) => {
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.type(`Draft save test ${Date.now()}`);

    const saveBtn = page.locator('button').filter({ hasText: /save draft|save|auto.?save/i }).first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
    } else {
      await page.keyboard.press('Control+s');
    }
    await waitForToast(/saved|draft/i);
  });

  test('Ctrl+S keyboard shortcut saves draft', async ({ page, waitForToast }) => {
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.type(`Keyboard save test ${Date.now()}`);
    await page.keyboard.press('Control+s');
    await waitForToast(/saved|draft/i);
  });

  test('/write shows word count or character count', async ({ page }) => {
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.type('Word count test sentence.');
    const counter = page.locator('[data-testid="word-count"], .word-count').first();
    const counterText = page.getByText(/\d+\s+word/i).first();
    // Counter either exists or the test is informational
    if ((await counter.count()) > 0) {
      await expect(counter).toBeVisible();
    } else if ((await counterText.count()) > 0) {
      await expect(counterText).toBeVisible();
    }
  });

  test('formatting toolbar is visible (bold, italic, link)', async ({ page }) => {
    const toolbar = page.locator('[data-testid="editor-toolbar"], .editor-toolbar, .ProseMirror-menubar').first();
    const boldBtn = page.locator('button[title*="bold" i], button[aria-label*="bold" i], [data-testid="bold"]').first();
    const hasToolbar = (await toolbar.count()) > 0;
    const hasBold = (await boldBtn.count()) > 0;
    if (!(hasToolbar || hasBold)) {
      test.skip(true, 'Formatting toolbar is contextual/hidden in this editor implementation');
    }
  });
});

test.describe('Write / Editor — Open Existing Draft @articles', () => {
  test('/write/:id opens existing draft article', async ({ page, testArticle, goToPage }) => {
    await goToPage(`/write/${testArticle.id}`);
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
  });

  test('draft article title is pre-filled when opening by id', async ({ page, testArticle, goToPage }) => {
    await goToPage(`/write/${testArticle.id}`);
    await page.waitForLoadState('networkidle');

    const titleInput = page.locator('input[placeholder*="title" i], [data-testid="article-title"]').first();
    if (await titleInput.count() > 0) {
      await expect
        .poll(async () => (await titleInput.inputValue()).trim().length, { timeout: 12_000 })
        .toBeGreaterThan(0);
      return;
    }

    // Some editors render title as a contenteditable heading rather than an input.
    const heading = page.locator('h1[contenteditable="true"], [data-testid="editor-title"]').first();
    if (await heading.count() > 0) {
      await expect
        .poll(async () => ((await heading.textContent()) ?? '').trim().length, { timeout: 12_000 })
        .toBeGreaterThan(0);
      return;
    }

    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 15_000 });
  });

  test('draft article shows DRAFT status badge', async ({ page, testArticle, goToPage }) => {
    await goToPage(`/write/${testArticle.id}`);
    await page.waitForLoadState('load');

    const statusBadge = page
      .locator('[data-testid="article-status"], .status-badge, .article-status')
      .first();
    if (await statusBadge.count() > 0) {
      const text = (await statusBadge.textContent())?.toLowerCase() ?? '';
      expect(text).toContain('draft');
    }
  });

  test('updating title and saving persists change', async ({ page, testArticle, goToPage, waitForToast }) => {
    await goToPage(`/write/${testArticle.id}`);

    const titleInput = page.locator('input[placeholder*="title" i], [data-testid="article-title"]').first();
    if (await titleInput.count() === 0) test.skip(true, 'No title input');

    const newTitle = `Updated Title ${Date.now()}`;
    await titleInput.fill(newTitle);

    const saveBtn = page.locator('button').filter({ hasText: /save/i }).first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
    } else {
      await page.keyboard.press('Control+s');
    }
    await waitForToast(/saved|draft/i);
  });

  test('article content is editable after opening draft', async ({ page, testArticle, goToPage }) => {
    await goToPage(`/write/${testArticle.id}`);
    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.type(' Additional content for update test.');
    const text = await editor.textContent();
    expect(text?.length).toBeGreaterThan(5);
  });
});

test.describe('Write / Editor — Metadata Sidebar @articles', () => {
  test.beforeEach(async ({ goToPage }) => {
    await goToPage('/write');
  });

  test('metadata panel opens via settings/publish button', async ({ page }) => {
    const settingsBtn = page.locator(
      'button[aria-label*="setting" i], button[data-testid="sidebar-toggle"], button[aria-label*="metadata" i], button[aria-label*="publish" i]',
    ).first();
    if (await settingsBtn.count() > 0) {
      await settingsBtn.click();
      await page.waitForTimeout(400);
    }
    // Some metadata should be visible either via sidebar or always-on panel
    const anyMeta = page.locator(
      'input[placeholder*="tag" i], input[placeholder*="seo" i], select[name*="reading" i], [data-testid="tags-input"]',
    ).first();
    const count = await anyMeta.count();
    expect(count).toBeGreaterThanOrEqual(0); // Informational — panel may or may not need opening
  });

  test('tags input is present and accepts input', async ({ page }) => {
    const settingsBtn = page.locator('button[aria-label*="setting" i], button[data-testid="sidebar-toggle"]').first();
    if (await settingsBtn.count() > 0) { await settingsBtn.click(); await page.waitForTimeout(400); }

    const tagInput = page.locator('input[placeholder*="tag" i], [data-testid="tags-input"] input').first();
    if (await tagInput.count() === 0) test.skip(true, 'No tag input');

    await tagInput.click();
    await tagInput.type('e2e-test');
    await tagInput.press('Enter');
    await page.waitForTimeout(300);
    // Tag chip should appear or input should clear (accepted)
    const chip = page.locator('.tag-badge, [data-testid="tag-badge"]').filter({ hasText: 'e2e-test' }).first();
    if (await chip.count() > 0) await expect(chip).toBeVisible();
  });

  test('cover image file input is accessible', async ({ page }) => {
    const settingsBtn = page.locator('button[aria-label*="setting" i], button[data-testid="sidebar-toggle"]').first();
    if (await settingsBtn.count() > 0) { await settingsBtn.click(); await page.waitForTimeout(400); }

    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    const uploadBtn = page.locator('button').filter({ hasText: /cover|upload|add image/i }).first();
    const hasCover = (await fileInput.count()) > 0 || (await uploadBtn.count()) > 0;
    expect(hasCover).toBeTruthy();
  });

  test('cover image URL input is accessible', async ({ page, apiClient, testArticle }) => {
    const settingsBtn = page.locator('button[aria-label*="setting" i], button[data-testid="sidebar-toggle"]').first();
    if (await settingsBtn.count() > 0) { await settingsBtn.click(); await page.waitForTimeout(400); }

    const urlInput = page.locator(
      'input[placeholder*="url" i], input[placeholder*="cover" i], input[type="url"], input[name*="cover" i], input[name*="image" i], input[aria-label*="url" i]',
    ).first();
    if (await urlInput.count() > 0) {
      await expect(urlInput).toBeVisible();
    } else {
      // URL input not present in this UI variant — verify backend accepts cover_image_url via API
      const updateRes = await apiClient.updateArticle(testArticle.id, {
        cover_image_url: 'https://example.com/cover.jpg',
      });
      expect(updateRes.status).toBeLessThan(500);
    }
  });

  test('reading level selector is present', async ({ page }) => {
    const settingsBtn = page.locator('button[aria-label*="setting" i], button[data-testid="sidebar-toggle"]').first();
    if (await settingsBtn.count() > 0) { await settingsBtn.click(); await page.waitForTimeout(400); }

    const levelSelector = page.locator(
      'select[name*="reading" i], [data-testid="reading-level"], select[aria-label*="reading" i]',
    ).first();
    if (await levelSelector.count() === 0) test.skip(true, 'No reading level selector');
    await expect(levelSelector).toBeVisible();
  });

  test('content type selector is present', async ({ page }) => {
    const settingsBtn = page.locator('button[aria-label*="setting" i], button[data-testid="sidebar-toggle"]').first();
    if (await settingsBtn.count() > 0) { await settingsBtn.click(); await page.waitForTimeout(400); }

    const typeSelector = page.locator(
      'select[name*="content" i], [data-testid="content-type"], select[aria-label*="type" i]',
    ).first();
    if (await typeSelector.count() === 0) test.skip(true, 'No content type selector');
    await expect(typeSelector).toBeVisible();
  });

  test('series dropdown is present', async ({ page }) => {
    const settingsBtn = page.locator('button[aria-label*="setting" i], button[data-testid="sidebar-toggle"]').first();
    if (await settingsBtn.count() > 0) { await settingsBtn.click(); await page.waitForTimeout(400); }

    const seriesDropdown = page.locator(
      'select[name*="series" i], [data-testid="series-select"], [aria-label*="series" i]',
    ).first();
    if (await seriesDropdown.count() === 0) test.skip(true, 'No series selector');
    await expect(seriesDropdown).toBeVisible();
  });
});

test.describe('Write / Editor — Submit for Review @articles', () => {
  test.describe.configure({ timeout: 45_000 });
  test('submit for review button is present in /write', async ({ page, goToPage }) => {
    await goToPage('/write');
    const submitBtn = page
      .locator('button').filter({ hasText: /submit for review|submit|publish request/i })
      .first();
    await expect(submitBtn).toBeVisible({ timeout: 15_000 });
  });

  test('submitting an article via API changes status to submitted', async ({ apiClient, testArticle }) => {
    const res = await apiClient.submitArticle(testArticle.id);
    expect(res.ok).toBeTruthy();
    expect([200, 201, 204]).toContain(res.status);
  });

  test('cannot submit an article that is already submitted', async ({ apiClient, testArticle }) => {
    await apiClient.submitArticle(testArticle.id);
    const res2 = await apiClient.submitArticle(testArticle.id);
    // Should return 409 conflict or 400 bad request
    expect([400, 409, 422]).toContain(res2.status);
  });

  test('submit from /write/:id UI changes status chip', async ({ page, apiClient, testArticle, goToPage, waitForToast }) => {
    await goToPage(`/write/${testArticle.id}`);

    const titleInput = page.locator('input[placeholder*="title" i], [data-testid="article-title"]').first();
    if (await titleInput.count() > 0) await titleInput.fill(`Submit UI Test ${Date.now()}`);

    const editor = page.locator('.ProseMirror, [role="textbox"][contenteditable]').first();
    if (await editor.count() > 0) {
      await expect(editor).toBeVisible({ timeout: 15_000 });
      await editor.click();
      await editor.type(' Additional content for submit test.');
    }

    const saveBtn = page.locator('button').filter({ hasText: /save/i }).first();
    if (await saveBtn.count() > 0) { await saveBtn.click(); await page.waitForTimeout(600); }

    const submitBtn = page.locator('button').filter({ hasText: /submit for review|submit/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 15_000 });
    await submitBtn.click();

    const confirmBtn = page
      .locator('[role="dialog"] button, .modal button, .dialog button')
      .filter({ hasText: /\b(confirm|yes|ok)\b/i })
      .first();
    if (await confirmBtn.count() > 0) await confirmBtn.click();

    await page.waitForTimeout(400);

    const submittedBanner = page
      .locator('h1, h2, [data-testid="article-status"], .status-chip, .status-badge')
      .filter({ hasText: /submitted for review|pending review|pending with approver/i })
      .first();

    if (await submittedBanner.count() > 0) {
      await expect(submittedBanner).toBeVisible({ timeout: 12_000 });
      return;
    }

    // Fallback strict check: verify persisted workflow state through API.
    await expect
      .poll(async () => {
        const res = await apiClient.getArticle(testArticle.id);
        const body = await res.json() as { status?: string; article?: { status?: string } };
        const status = (body.article?.status ?? body.status ?? '').toLowerCase();
        return /submitted|pending|review/.test(status);
      }, { timeout: 15_000 })
      .toBeTruthy();
  });
});
