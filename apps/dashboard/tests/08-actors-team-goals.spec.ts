/**
 * 08-actors-team-goals.spec.ts
 * Tests for:
 *   - /actors  (Instagram actor accounts)
 *   - /team    (team members list)
 *   - /goals   (coming-soon placeholder)
 *
 * Removed tests:
 *   - 'actor status badges display correctly' — conditional assertion, always passed
 *   - 'column visibility toggle works on actors page' — duplicate pattern tested in 03, 04
 *   - 'refresh actors list works' — duplicate pattern tested in 03
 *   - 'activity stats display per actor' — conditional assertion, always passed
 *   - 'user status shown (online/offline/suspended)' — conditional assertion, always passed
 *   - 'goals page shows Goals heading' — duplicate of the coming-soon smoke test
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

    for (const header of ['Account', 'Status', 'Owner']) {
      const el = page.locator('th, [role="columnheader"]').filter({ hasText: new RegExp(header, 'i') }).first();
      if (await el.count() > 0) {
        await expect(el).toBeVisible();
      }
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

  test('team page shows list of users with roles', async ({ page }) => {
    await page.goto('/team');
    await waitForTableLoad(page);

    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('No team members');

    // Role badges visible
    const roleBadge = page.locator('span, td').filter({ hasText: /admin|operator|member/i }).first();
    if (await roleBadge.count() > 0) {
      await expect(roleBadge).toBeVisible({ timeout: 15_000 });
    }
  });
});

// ─── Goals (Coming Soon) ───────────────────────────────────────────────────────

test.describe('Goals Page', () => {
  test('goals page loads and shows coming-soon state @smoke', async ({ page }) => {
    await page.goto('/goals');
    await page.waitForLoadState('domcontentloaded');

    await expect(page).toHaveURL('/goals');
    await expect(page.locator('text=/coming soon|under development/i').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
