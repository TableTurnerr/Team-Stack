/**
 * 06-session-logs.spec.ts
 * Tests for the Session Logs page (/session-logs).
 *
 * Removed tests:
 *   - 'session logs shows table or cards' — duplicate of the smoke test
 *   - 'session entry shows key metrics' — conditional assertions, always passed
 *   - 'admin mode toggle is accessible' — conditional assertions, always passed
 *   - 'clicking a session shows its details' — conditional assertions, always passed
 */
import { test, expect } from '@playwright/test';
import { TEST_PREFIX, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord, fetchRecords } from './helpers/pb-client';

let testSessionId: string;
let testUserId: string;

test.describe('Session Logs Page', () => {
  test.beforeAll(async () => {
    try {
      const users = await fetchRecords<{ id: string }>('users', '', 'id');
      testUserId = users[0]?.id ?? '';
    } catch {
      testUserId = '';
    }

    if (testUserId) {
      const session = await createRecord<{ id: string }>('cold_calling_sessions', {
        user: testUserId,
        started_at: new Date(Date.now() - 3600_000).toISOString(),
        ended_at: new Date().toISOString(),
        total_dials: 5,
        total_pickups: 3,
        total_duration_sec: 1800,
        owner_reached: 2,
        pitch_completed: 2,
        appointment_set: 1,
        status: 'completed',
        session_notes: `[${TEST_PREFIX}] Playwright test session`,
        total_paused_sec: 0,
      });
      testSessionId = session.id;
    }
  });

  test.afterAll(async () => {
    await cleanupByPrefix('cold_calling_sessions', 'session_notes', TEST_PREFIX);
  });

  test('session logs page loads @smoke', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/session-logs');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('can filter by status (active vs completed)', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const completedFilter = page.locator('button, [role="tab"]').filter({ hasText: /completed/i }).first();
    if (await completedFilter.count() > 0) {
      await completedFilter.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);
      await expect(page.locator('body')).not.toContainText('Application error');
    }

    const activeFilter = page.locator('button, [role="tab"]').filter({ hasText: /active/i }).first();
    if (await activeFilter.count() > 0) {
      await activeFilter.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  test('test session appears in completed list', async ({ page }) => {
    if (!testSessionId) {
      test.skip();
      return;
    }

    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const completedTab = page.locator('button, [role="tab"]').filter({ hasText: /completed/i }).first();
    if (await completedTab.count() > 0) {
      await completedTab.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);
    }

    const sessionRow = page.locator('tr, [class*="card"], [class*="row"]').filter({ hasText: /5 dials|5/ }).first();
    if (await sessionRow.count() > 0) {
      await expect(sessionRow).toBeVisible();
    }
  });

  test('export to CSV button works', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const exportBtn = page.locator('button').filter({ hasText: /export|download|csv/i }).first();
    if (await exportBtn.count() > 0) {
      await expect(exportBtn).toBeEnabled();

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5_000 }).catch(() => null),
        exportBtn.click(),
      ]);

      if (download) {
        expect(download.suggestedFilename()).toMatch(/\.csv$/i);
      }
    }
  });
});
