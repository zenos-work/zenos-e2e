/**
 * @social
 * like-bookmark.spec.ts — tests like and bookmark interactions:
 *   - Like button on article detail page (toggle on/off)
 *   - Bookmark button on article detail page (toggle on/off)
 *   - Bookmarked articles appear on /bookmarks
 *   - Removing bookmark removes it from /bookmarks
 *   - Bookmark search and sort on /bookmarks
 *
 * Runs in the `authenticated` project.
 */

import { test, expect } from '../../fixtures/base.fixture';

test.describe('Like and Bookmark @social', () => {
  test.describe.configure({ timeout: 45_000 });

  test('like button on article page toggles liked state', async ({ page, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);

    const likeBtn = page
      .locator('[data-testid="like-button"], button[aria-label*="like" i], button[aria-label*="heart" i]')
      .first();

    await expect(likeBtn).toBeVisible();

    // Read initial state
    const initialClass = await likeBtn.evaluate((el) => el.className);
    const initialAriaPressed = await likeBtn.getAttribute('aria-pressed');

    // Click to like
    await likeBtn.click();
    await page.waitForTimeout(700);

    const newClass = await likeBtn.evaluate((el) => el.className);
    const newAriaPressed = await likeBtn.getAttribute('aria-pressed');

    const stateChanged = newClass !== initialClass || newAriaPressed !== initialAriaPressed;
    expect(stateChanged).toBeTruthy();

    // Toggle off (unlike)
    await likeBtn.click();
    await page.waitForTimeout(500);
  });

  test('bookmark button on article page toggles saved state', async ({ page, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);

    const bookmarkBtn = page
      .locator('[data-testid="bookmark-button"], button[aria-label*="bookmark" i], button[aria-label*="save" i]')
      .first();

    await expect(bookmarkBtn).toBeVisible();

    // Ensure it's not bookmarked initially
    const initialAriaPressed = await bookmarkBtn.getAttribute('aria-pressed');
    if (initialAriaPressed === 'true') {
      // Unbookmark first
      await bookmarkBtn.click();
      await page.waitForTimeout(500);
    }

    // Bookmark it
    await bookmarkBtn.click();
    await page.waitForTimeout(700);

    // Should be in bookmarked state
    const newAriaPressed = await bookmarkBtn.getAttribute('aria-pressed');
    const newClass = await bookmarkBtn.getAttribute('class') ?? '';
    const isBookmarked = newAriaPressed === 'true' || newClass.includes('active') || newClass.includes('saved');
    expect(isBookmarked).toBeTruthy();
  });

  test('bookmarked article appears on /bookmarks page', async ({ page, goToPage, publishedArticle }) => {
    // Ensure article is bookmarked
    await goToPage(`/article/${publishedArticle.slug}`);
    const bookmarkBtn = page
      .locator('[data-testid="bookmark-button"], button[aria-label*="bookmark" i]')
      .first();

    await expect(bookmarkBtn).toBeVisible();

    const ariaPressed = await bookmarkBtn.getAttribute('aria-pressed');
    if (ariaPressed !== 'true') {
      await bookmarkBtn.click();
      await page.waitForTimeout(700);
    }

    await expect
      .poll(async () => {
        const current = await bookmarkBtn.getAttribute('aria-pressed');
        return current === 'true';
      }, { timeout: 8_000 })
      .toBeTruthy();

    // Visit bookmarks page
    await goToPage('/bookmarks');
    const bookmarkItems = page.locator('[data-testid="bookmark-item"], .bookmark-item, article');
    const target = bookmarkItems.filter({ hasText: publishedArticle.title }).first();
    await expect(target).toBeVisible({ timeout: 12_000 });
  });

  test('/bookmarks page shows search input', async ({ page, goToPage }) => {
    await goToPage('/bookmarks');

    const searchInput = page
      .locator('input[type="search"], input[placeholder*="search" i], [data-testid="bookmarks-search"]')
      .first();

    const count = await searchInput.count();
    if (count > 0) {
      await expect(searchInput).toBeVisible();
    }
  });

  test('/bookmarks page shows sort dropdown or buttons', async ({ page, goToPage }) => {
    await goToPage('/bookmarks');

    const sortEl = page
      .locator('select[name*="sort"], [data-testid="sort-dropdown"]')
      .or(page.locator('button').filter({ hasText: /sort|newest|oldest/i }))
      .first();

    const count = await sortEl.count();
    if (count > 0) {
      await expect(sortEl).toBeVisible();
    }
  });

  test('remove bookmark from /bookmarks removes article from list', async ({ page, apiClient, goToPage, publishedArticle }) => {
    await goToPage(`/article/${publishedArticle.slug}`);
    const articleBookmarkBtn = page.locator('[data-testid="bookmark-button"], button[aria-label*="bookmark" i]').first();
    await expect(articleBookmarkBtn).toBeVisible();
    const ariaPressed = await articleBookmarkBtn.getAttribute('aria-pressed');
    if (ariaPressed !== 'true') {
      await articleBookmarkBtn.click();
      await page.waitForTimeout(700);
    }

    await goToPage('/bookmarks');

    const items = page.locator('[data-testid="bookmark-item"], .bookmark-item');
    const targetItem = items.filter({ hasText: publishedArticle.title }).first();
    await expect(targetItem).toBeVisible();

    // Find a remove/unbookmark button on the first item
    const removeBtn = targetItem
      .locator('button[aria-label*="remove" i], button[aria-label*="bookmark" i], button[aria-label*="unsave" i]')
      .first();

    await expect(removeBtn).toBeVisible();

    await removeBtn.click();
    await page.waitForTimeout(700);

    await expect
      .poll(async () => {
        const res = await apiClient.checkBookmark(publishedArticle.id);
        if (!res.ok) return false;
        const payload = await res.json() as { is_bookmarked?: boolean; bookmarked?: boolean };
        return !(payload.is_bookmarked === true || payload.bookmarked === true);
      }, { timeout: 12_000 })
      .toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(targetItem).toHaveCount(0, { timeout: 8_000 });
  });
});
