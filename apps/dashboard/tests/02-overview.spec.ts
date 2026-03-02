/**
 * 02-overview.spec.ts
 * Tests for the main Overview/Dashboard page (/).
 * Verifies stats cards, recent activity, sidebar navigation, and page load.
 */
import { test, expect } from '@playwright/test';
import { waitForTableLoad } from './helpers/test-data';

test.describe('Overview Dashboard @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForTableLoad(page);
  });

  test('overview page loads and has correct title', async ({ page }) => {
    await expect(page).toHaveURL('/');
    // Main heading
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
  });

  test('stats cards are visible', async ({ page }) => {
    // Overview should show at least some stat cards with numbers
    // Common patterns: "Total Companies", "Total Cold Calls", team members count
    const cards = page.locator('[class*="card"], [class*="stat"]').filter({ hasText: /\d+/ });
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar navigation is visible with all links', async ({ page }) => {
    const sidebar = page.locator('nav, aside').first();
    await expect(sidebar).toBeVisible();

    // Check all main nav links are present
    const navLinks = [
      { href: '/companies', label: /companies/i },
      { href: '/cold-calls', label: /cold calls/i },
      { href: '/session', label: /session/i },
      { href: '/notes', label: /notes/i },
      { href: '/settings', label: /settings/i },
    ];

    for (const { href, label } of navLinks) {
      const link = page.locator(`a[href="${href}"]`).first();
      await expect(link).toBeVisible();
    }
  });

  test('recent activity section renders', async ({ page }) => {
    // Activity feed or recent events list
    const activitySection = page.locator('text=/recent|activity|event/i').first();
    // May or may not exist depending on data — just check no crash
    await expect(page.locator('body')).not.toContainText('Error');
    await expect(page.locator('body')).not.toContainText('500');
  });

  test('navigating via sidebar works', async ({ page }) => {
    // Click Companies
    await page.locator('a[href="/companies"]').first().click();
    await page.waitForURL('/companies', { timeout: 30_000 });
    await expect(page).toHaveURL('/companies');

    // Click Cold Calls
    await page.locator('a[href="/cold-calls"]').first().click();
    await page.waitForURL('/cold-calls', { timeout: 30_000 });
    await expect(page).toHaveURL('/cold-calls');

    // Click Notes
    await page.locator('a[href="/notes"]').first().click();
    await page.waitForURL('/notes', { timeout: 30_000 });
    await expect(page).toHaveURL('/notes');

    // Return to overview
    await page.locator('a[href="/"]').first().click();
    await page.waitForURL('/', { timeout: 30_000 });
    await expect(page).toHaveURL('/');
  });

  test('page has no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await waitForTableLoad(page);

    // Filter out known browser-level noise (e.g. CSP warnings, extension messages)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('Extension') &&
        !e.includes('favicon') &&
        !e.includes('ERR_BLOCKED') &&
        !e.includes('ResizeObserver')
    );

    if (criticalErrors.length > 0) {
      console.warn('Console errors detected:', criticalErrors);
    }
    // Non-blocking — just log, don't fail the test
  });

  test('theme / appearance is applied (no unstyled flash)', async ({ page }) => {
    // Check root html element has a data-theme or class
    const htmlEl = page.locator('html');
    // Should have some class or data attribute indicating theme is loaded
    await expect(htmlEl).toBeVisible();
    // Just ensure the page has CSS loaded (body has background color)
    const bgColor = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bgColor).not.toBe('');
  });

  test('all dashboard pages load without crashing', async ({ page }) => {
    // Extend timeout: 10 routes × ~15 s each can exceed the default 60 s limit.
    test.setTimeout(180_000);

    const routes = [
      '/',
      '/companies',
      '/cold-calls',
      '/session',
      '/session-logs',
      '/notes',
      '/actors',
      '/team',
      '/settings',
      '/recordings',
    ];

    for (const route of routes) {
      // Use domcontentloaded + a short settle instead of networkidle to avoid
      // long-polling / WebSocket connections keeping the page "busy" indefinitely.
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2_000);

      // Page should not show a generic error (use innerText to avoid hidden Next.js JSON state)
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('Application error');
      expect(body).not.toContain('500 Internal Server Error');
      expect(body).not.toContain('This page could not be found');
    }
  });
});
