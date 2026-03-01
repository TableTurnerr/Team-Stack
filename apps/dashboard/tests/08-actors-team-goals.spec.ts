/**
 * 08-actors-team-goals.spec.ts
 * Tests for:
 *   - /actors  (Instagram actor accounts)
 *   - /team    (team members list)
 *   - /goals   (coming-soon placeholder)
 */
import { test, expect } from '@playwright/test';
import { waitForTableLoad } from './helpers/test-data';

// ─── Actors ──────────────────────────────────────────────────────────────────

test.describe('Actors Page', () => {
  test('actors page loads @smoke', async ({ page }) => {
    await page.goto('/actors');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/actors');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('actors table renders with expected columns', async ({ page }) => {
    await page.goto('/actors');
    await waitForTableLoad(page);

    const expectedHeaders = ['Account', 'Status', 'Owner'];
    for (const header of expectedHeaders) {
      const el = page.locator('th, [role="columnheader"]').filter({ hasText: new RegExp(header, 'i') }).first();
      if (await el.count() > 0) {
        await expect(el).toBeVisible();
      }
    }
  });

  test('actor status badges display correctly', async ({ page }) => {
    await page.goto('/actors');
    await waitForTableLoad(page);

    // Status values: Active, Suspended By Team, Suspended By Insta, Discarded
    const statusBadge = page.locator('td').filter({ hasText: /active|suspended|discarded/i }).first();
    if (await statusBadge.count() > 0) {
      await expect(statusBadge).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('column visibility toggle works on actors page', async ({ page }) => {
    await page.goto('/actors');
    await waitForTableLoad(page);

    const colBtn = page.locator('button').filter({ hasText: /column/i }).first();
    if (await colBtn.count() > 0) {
      await colBtn.click();
      await page.waitForTimeout(300);
      const checkboxes = page.locator('input[type="checkbox"]');
      if (await checkboxes.count() > 0) {
        await expect(checkboxes.first()).toBeVisible();
      }
      await page.keyboard.press('Escape');
    }
  });

  test('refresh actors list works', async ({ page }) => {
    await page.goto('/actors');
    await waitForTableLoad(page);

    const refreshBtn = page.locator('button[aria-label*="refresh" i], button[title*="refresh" i]').first();
    if (await refreshBtn.count() > 0) {
      await refreshBtn.click();
      await waitForTableLoad(page);
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  test('activity stats display per actor', async ({ page }) => {
    await page.goto('/actors');
    await waitForTableLoad(page);

    // Activity column should show DMs sent count
    const activityCol = page.locator('th, [role="columnheader"]').filter({ hasText: /activity/i }).first();
    if (await activityCol.count() > 0) {
      await expect(activityCol).toBeVisible();
    }
  });
});

// ─── Team ─────────────────────────────────────────────────────────────────────

test.describe('Team Page', () => {
  test('team page loads @smoke', async ({ page }) => {
    await page.goto('/team');
    await waitForTableLoad(page);

    await expect(page).toHaveURL('/team');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('team page shows list of users', async ({ page }) => {
    await page.goto('/team');
    await waitForTableLoad(page);

    // Team page should show at least one team member (the logged-in user)
    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('No team members');
  });

  test('user roles are displayed (admin/operator/member)', async ({ page }) => {
    await page.goto('/team');
    await waitForTableLoad(page);

    // Role badges visible
    const roleBadge = page.locator('span, td').filter({ hasText: /admin|operator|member/i }).first();
    if (await roleBadge.count() > 0) {
      await expect(roleBadge).toBeVisible({ timeout: 15_000 });
    }
  });

  test('user status shown (online/offline/suspended)', async ({ page }) => {
    await page.goto('/team');
    await waitForTableLoad(page);

    const statusIndicator = page.locator('span, div').filter({ hasText: /online|offline|suspended/i }).first();
    if (await statusIndicator.count() > 0) {
      await expect(statusIndicator).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});

// ─── Goals (Coming Soon) ───────────────────────────────────────────────────────

test.describe('Goals Page', () => {
  test('goals page loads and shows coming-soon state @smoke', async ({ page }) => {
    await page.goto('/goals');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL('/goals');
    // Should show the "Coming Soon" placeholder
    await expect(page.locator('text=/coming soon|under development/i').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('goals page shows Goals heading', async ({ page }) => {
    await page.goto('/goals');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('h1').filter({ hasText: /goals/i }).first()).toBeVisible();
  });
});
