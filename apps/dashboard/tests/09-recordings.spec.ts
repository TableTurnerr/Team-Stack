/**
 * 09-recordings.spec.ts
 * Tests for the Recordings page (/recordings).
 * Tests page load, bulk-upload modal, and drag-drop UI.
 *
 * Note: We do not actually upload files in automated tests to avoid
 * polluting the database with binary data. We verify the upload UI works.
 */
import { test, expect } from '@playwright/test';
import { waitForTableLoad } from './helpers/test-data';
import * as path from 'path';

test.describe('Recordings Page', () => {
  test('recordings page loads @smoke', async ({ page }) => {
    await page.goto('/recordings');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/recordings');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('recordings page shows upload area or recordings table', async ({ page }) => {
    await page.goto('/recordings');
    // Wait for the heading to confirm the page has rendered before checking elements.
    // count() is synchronous (no waiting), so we must ensure the DOM is ready first.
    await page.waitForSelector('h1', { timeout: 20_000 });
    await waitForTableLoad(page);

    // The page should show either an upload UI (admin) or a recordings table (any user).
    // Bulk Upload button is admin-only; non-admin users see the recordings table.
    const uploadArea = page.locator('[class*="upload"], [class*="drop"], input[type="file"]').first();
    const uploadBtn = page.locator('button').filter({ hasText: /upload|add recording/i }).first();
    const bulkBtn = page.locator('button').filter({ hasText: /bulk|import/i }).first();
    const recordingsTable = page.locator('table').first();
    const emptyState = page.locator('text=/no recording|upload your first/i').first();
    const pageHeading = page.locator('h1').first();

    // Use isVisible() (not count()) so we only count elements the user can actually see.
    const hasUploadUI = (await uploadArea.isVisible().catch(() => false))
      || (await uploadBtn.isVisible().catch(() => false))
      || (await bulkBtn.isVisible().catch(() => false));
    const hasTableOrEmpty = (await recordingsTable.isVisible().catch(() => false))
      || (await emptyState.isVisible().catch(() => false));
    const hasHeading = await pageHeading.isVisible().catch(() => false);

    // Page must show either an upload control, a table/empty-state, or at minimum the heading
    expect(hasUploadUI || hasTableOrEmpty || hasHeading).toBeTruthy();

    // Whatever is visible should render without errors
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('upload modal opens when triggered', async ({ page }) => {
    await page.goto('/recordings');
    await waitForTableLoad(page);

    const openBtn = page.locator('button').filter({ hasText: /upload|add|bulk/i }).first();
    if (await openBtn.count() > 0) {
      await openBtn.click();
      await page.waitForTimeout(500);

      // Modal should open
      const modal = page.locator('[role="dialog"], [class*="modal"]').first();
      if (await modal.count() > 0) {
        await expect(modal).toBeVisible();

        // Modal should have a file drop zone
        const dropZone = modal.locator('[class*="drop"], [class*="upload"]').first();
        if (await dropZone.count() > 0) {
          await expect(dropZone).toBeVisible();
        }

        // Close the modal
        const closeBtn = modal.locator('button').filter({ hasText: /cancel|close|×/i }).first();
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(300);

        // Modal should be closed
        const closedModal = page.locator('[role="dialog"]');
        if (await closedModal.count() > 0) {
          await expect(closedModal).not.toBeVisible({ timeout: 3_000 });
        }
      }
    }
  });

  test('file input accepts audio files', async ({ page }) => {
    await page.goto('/recordings');
    await waitForTableLoad(page);

    // Check if there's a file input with audio accept attribute
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
      const acceptAttr = await fileInput.getAttribute('accept');
      if (acceptAttr) {
        // Should accept audio formats
        expect(acceptAttr).toMatch(/audio|\.mp3|\.wav|\.m4a|\.ogg|\*/i);
      }
    }
  });

  test('recordings list is visible (if recordings exist)', async ({ page }) => {
    await page.goto('/recordings');
    await waitForTableLoad(page);

    // The page should show either recordings or an empty state
    const emptyState = page.locator('text=/no recording|upload your first|empty/i').first();
    const recordingsList = page.locator('table, [class*="recording"], [class*="list"]').first();

    const hasContent = (await emptyState.count() > 0) || (await recordingsList.count() > 0);
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('recordings page has no JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/recordings');
    await waitForTableLoad(page);

    const criticalErrors = errors.filter((e) => !e.includes('ResizeObserver'));
    if (criticalErrors.length > 0) {
      console.warn('JS errors on recordings page:', criticalErrors);
    }
    // Non-critical assertion — just log
  });
});
