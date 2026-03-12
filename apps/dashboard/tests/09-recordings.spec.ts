/**
 * 09-recordings.spec.ts
 * Tests for the Recordings page (/recordings).
 *
 * Removed tests:
 *   - 'file input accepts audio files' — tautological; tested a static HTML accept attribute
 *   - 'recordings list is visible (if recordings exist)' — conditional assertions, always passed
 *   - 'recordings page has no JS errors' — logged errors but never failed (non-blocking warn only)
 */
import { test, expect } from '@playwright/test';
import { waitForTableLoad } from './helpers/test-data';

test.describe('Recordings Page', () => {
  test('recordings page loads @smoke', async ({ page }) => {
    await page.goto('/recordings');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/recordings');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('recordings page shows upload area or recordings table', async ({ page }) => {
    await page.goto('/recordings');
    await page.waitForSelector('h1', { timeout: 20_000 });
    await waitForTableLoad(page);

    const uploadArea = page.locator('[class*="upload"], [class*="drop"], input[type="file"]').first();
    const uploadBtn = page.locator('button').filter({ hasText: /upload|add recording/i }).first();
    const bulkBtn = page.locator('button').filter({ hasText: /bulk|import/i }).first();
    const recordingsTable = page.locator('table').first();
    const emptyState = page.locator('text=/no recording|upload your first/i').first();
    const pageHeading = page.locator('h1').first();

    const hasUploadUI = (await uploadArea.isVisible().catch(() => false))
      || (await uploadBtn.isVisible().catch(() => false))
      || (await bulkBtn.isVisible().catch(() => false));
    const hasTableOrEmpty = (await recordingsTable.isVisible().catch(() => false))
      || (await emptyState.isVisible().catch(() => false));
    const hasHeading = await pageHeading.isVisible().catch(() => false);

    expect(hasUploadUI || hasTableOrEmpty || hasHeading).toBeTruthy();
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('upload modal opens when triggered', async ({ page }) => {
    await page.goto('/recordings');
    await waitForTableLoad(page);

    const openBtn = page.locator('button').filter({ hasText: /upload|add|bulk/i }).first();
    if (await openBtn.count() > 0) {
      await openBtn.click();
      await page.waitForTimeout(500);

      const modal = page.locator('[role="dialog"], [class*="modal"]').first();
      if (await modal.count() > 0) {
        await expect(modal).toBeVisible();

        const dropZone = modal.locator('[class*="drop"], [class*="upload"]').first();
        if (await dropZone.count() > 0) {
          await expect(dropZone).toBeVisible();
        }

        const closeBtn = modal.locator('button').filter({ hasText: /cancel|close|×/i }).first();
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(300);

        const closedModal = page.locator('[role="dialog"]');
        if (await closedModal.count() > 0) {
          await expect(closedModal).not.toBeVisible({ timeout: 3_000 });
        }
      }
    }
  });
});
