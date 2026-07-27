import { test, expect } from '@playwright/test';

test.describe('Migrated dashboard shell @smoke', () => {
  test('root redirects and exactly four active navigation links remain', async ({ page }) => {
    await page.route('**/api/ghl/dashboard/config', route => route.fulfill({
      json: { configured: true, locationId: 'loc', pipelines: [{ id: 'pipe', name: 'Sales', stages: [{ id: 'new', name: 'New', position: 0 }] }], users: [], tags: [], customFields: [], currentUser: { matched: true, ghlUserId: 'u1', ghlUserName: 'Test User' }, defaults: { leadSource: 'Dashboard' } },
    }));
    await page.goto('/');
    await expect(page).toHaveURL(/\/lead-submission$/);
    const nav = page.getByRole('navigation', { name: 'Dashboard navigation' });
    const links = nav.locator('a');
    await expect(links).toHaveCount(4);
    await expect(links).toHaveText(['Lead Submission', 'Pipeline', 'Financial Overview', 'Team Overview']);
  });

  test('legacy items are disabled and direct routes render Locked', async ({ page }) => {
    await page.route('**/api/ghl/dashboard/config', route => route.fulfill({ status: 503, json: { error: 'Not configured' } }));
    await page.goto('/lead-submission');
    const locked = page.getByRole('navigation').locator('[aria-disabled="true"]');
    await expect(locked).toHaveCount(15);
    await expect(locked.first()).toContainText('Locked');
    await page.goto('/companies');
    await expect(page.getByRole('heading', { name: /companies is locked/i })).toBeVisible();
  });
});
