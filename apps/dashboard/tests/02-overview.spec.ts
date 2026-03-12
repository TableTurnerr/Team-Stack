/**
 * 02-overview.spec.ts
 * Tests for the main Overview/Dashboard page (/).
 *
 * Removed tests:
 *   - 'recent activity section renders' — no meaningful assertion (only checked body text for "Error")
 *   - 'page has no console errors on load' — logged errors but never failed (non-blocking warn only)
 *   - 'theme / appearance is applied' — tautological; tested that html is visible and body has CSS
 *   - 'all dashboard pages load without crashing' — duplicate of individual smoke tests in each spec file; 180s timeout
 */
import { test, expect } from '@playwright/test';
import { waitForTableLoad } from './helpers/test-data';

test.describe('Overview Dashboard @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForTableLoad(page);
  });

  test('overview page loads with heading and stats', async ({ page }) => {
    await expect(page).toHaveURL('/');
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();

    // Stats cards with numbers should be present
    const cards = page.locator('[class*="card"], [class*="stat"]').filter({ hasText: /\d+/ });
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar navigation is visible with all links', async ({ page }) => {
    const sidebar = page.locator('nav, aside').first();
    await expect(sidebar).toBeVisible();

    // Direct links always visible
    const directLinks = [
      '/companies',
      '/notes',
      '/follow-ups',
      '/settings',
    ];
    for (const href of directLinks) {
      const link = page.locator(`a[href="${href}"]`).first();
      await expect(link).toBeVisible();
    }

    // Cold Calls is a collapsible group — expand it to reveal sub-links
    const coldCallsGroup = page.locator('button').filter({ hasText: /cold calls/i }).first();
    await expect(coldCallsGroup).toBeVisible();
    await coldCallsGroup.click();
    await page.waitForTimeout(300);

    const subLinks = ['/cold-calls', '/session'];
    for (const href of subLinks) {
      const link = page.locator(`a[href="${href}"]`).first();
      await expect(link).toBeVisible();
    }
  });

  test('navigating via sidebar works', async ({ page }) => {
    await page.locator('a[href="/companies"]').first().click();
    await page.waitForURL('/companies', { timeout: 30_000 });
    await expect(page).toHaveURL('/companies');

    // Expand Cold Calls group before clicking sub-link
    const coldCallsGroup = page.locator('button').filter({ hasText: /cold calls/i }).first();
    if ((await coldCallsGroup.count()) > 0) {
      await coldCallsGroup.click();
      await page.waitForTimeout(300);
    }
    await page.locator('a[href="/cold-calls"]').first().click();
    await page.waitForURL('/cold-calls', { timeout: 30_000 });
    await expect(page).toHaveURL('/cold-calls');

    await page.locator('a[href="/notes"]').first().click();
    await page.waitForURL('/notes', { timeout: 30_000 });
    await expect(page).toHaveURL('/notes');
  });
});
