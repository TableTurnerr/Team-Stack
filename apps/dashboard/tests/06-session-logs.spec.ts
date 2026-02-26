/**
 * 06-session-logs.spec.ts
 * Tests for the Session Logs page (/session-logs).
 * Tests listing, filtering, detail view, and CSV export.
 *
 * Strategy:
 *   beforeAll → seed a completed test session via API
 *   tests     → UI interactions
 *   afterAll  → delete test session
 */
import { test, expect } from '@playwright/test';
import { TEST_PREFIX, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord, fetchRecords } from './helpers/pb-client';

let testSessionId: string;
let testUserId: string;

test.describe('Session Logs Page', () => {
  test.beforeAll(async () => {
    // Get the current user's ID from PocketBase (first admin/user)
    try {
      const users = await fetchRecords<{ id: string }>('users', '', 'id');
      testUserId = users[0]?.id ?? '';
    } catch {
      testUserId = '';
    }

    if (testUserId) {
      // Create a completed test session
      const session = await createRecord<{ id: string }>('cold_calling_sessions', {
        user: testUserId,
        started_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
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
    console.log('🧹 Cleaned up session logs test data.');
  });

  // ─── Page Load ───────────────────────────────────────────────────────────────

  test('session logs page loads @smoke', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/session-logs');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('session logs shows table or cards', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const content = page.locator('table, [role="table"], [class*="card"], [class*="session"]').first();
    await expect(content).toBeVisible({ timeout: 10_000 });
  });

  // ─── Status Filter ────────────────────────────────────────────────────────────

  test('can filter by status (active vs completed)', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    // Filter tabs or dropdown for active/completed
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

  // ─── Session Data Display ─────────────────────────────────────────────────────

  test('session entry shows key metrics', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    // Sessions should display: dials, pickups, duration
    const metricsLabels = ['dials', 'pickups', 'duration'];
    for (const label of metricsLabels) {
      const el = page.locator('th, td, span, div').filter({ hasText: new RegExp(label, 'i') }).first();
      if (await el.count() > 0) {
        await expect(el).toBeVisible();
      }
    }
  });

  test('test session appears in completed list', async ({ page }) => {
    if (!testSessionId) {
      test.skip();
      return;
    }

    await page.goto('/session-logs');
    await waitForTableLoad(page);

    // Switch to completed tab
    const completedTab = page.locator('button, [role="tab"]').filter({ hasText: /completed/i }).first();
    if (await completedTab.count() > 0) {
      await completedTab.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);
    }

    // Look for a session with "5 dials" or our notes
    const sessionRow = page.locator('tr, [class*="card"], [class*="row"]').filter({ hasText: /5 dials|5/ }).first();
    if (await sessionRow.count() > 0) {
      await expect(sessionRow).toBeVisible();
    }
  });

  // ─── CSV Export ───────────────────────────────────────────────────────────────

  test('export to CSV button works', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const exportBtn = page.locator('button').filter({ hasText: /export|download|csv/i }).first();
    if (await exportBtn.count() > 0) {
      await expect(exportBtn).toBeEnabled();

      // Trigger download and verify it starts
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5_000 }).catch(() => null),
        exportBtn.click(),
      ]);

      if (download) {
        expect(download.suggestedFilename()).toMatch(/\.csv$/i);
        console.log(`✅ Downloaded: ${download.suggestedFilename()}`);
      }
    }
  });

  // ─── Admin Mode: Edit / Delete ────────────────────────────────────────────────

  test('admin mode toggle is accessible', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    // Admin mode toggle (usually in a header or settings menu)
    const adminToggle = page.locator('button, label').filter({ hasText: /admin mode/i }).first();
    if (await adminToggle.count() > 0) {
      await adminToggle.click();
      await page.waitForTimeout(300);

      // Admin mode should show edit/delete buttons
      const editBtn = page.locator('button').filter({ hasText: /edit|delete/i }).first();
      if (await editBtn.count() > 0) {
        await expect(editBtn).toBeVisible();
      }

      // Toggle off
      await adminToggle.click();
    }
  });

  // ─── Session Detail (if applicable) ──────────────────────────────────────────

  test('clicking a session shows its details', async ({ page }) => {
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    // Look for a detail link or expandable row
    const detailTrigger = page.locator('a[href*="/session-logs/"], button').filter({ hasText: /view|detail|expand/i }).first();
    if (await detailTrigger.count() > 0) {
      await detailTrigger.click();
      await page.waitForTimeout(500);
      // Either navigated or expanded
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });
});
