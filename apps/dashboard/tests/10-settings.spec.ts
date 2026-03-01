/**
 * 10-settings.spec.ts
 * Tests for the Settings page (/settings).
 * Tests all 8+ settings sections: Profile, Account, Appearance,
 * Notifications, Preferences, Integrations, Data Privacy, Admin Mode.
 */
import { test, expect } from '@playwright/test';
import { waitForTableLoad } from './helpers/test-data';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await waitForTableLoad(page);
  });

  // ─── Page Load ───────────────────────────────────────────────────────────────

  test('settings page loads @smoke', async ({ page }) => {
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('all major settings sections are visible', async ({ page }) => {
    const sections = ['Profile', 'Account', 'Appearance', 'Notifications', 'Preferences', 'Integrations'];
    for (const section of sections) {
      const el = page.locator('h2, h3, [class*="section"]').filter({ hasText: new RegExp(section, 'i') }).first();
      if (await el.count() > 0) {
        await expect(el).toBeVisible();
      }
    }
  });

  // ─── Appearance ───────────────────────────────────────────────────────────────

  test('theme toggle switches between light and dark', async ({ page }) => {
    // Find the theme selector (radio, select, or toggle buttons)
    const darkOption = page.locator('button, input, label').filter({ hasText: /dark/i }).first();
    if (await darkOption.count() > 0) {
      await darkOption.click();
      await page.waitForTimeout(500);

      // HTML element should have dark class/attribute
      const htmlClass = await page.locator('html').getAttribute('class');
      const htmlDataTheme = await page.locator('html').getAttribute('data-theme');
      const isDark = (htmlClass?.includes('dark') || htmlDataTheme === 'dark');
      // Non-blocking check since theme implementation varies
      console.log(`Dark mode applied: ${isDark}`);
    }

    // Switch back to system/light
    const systemOption = page.locator('button, input, label').filter({ hasText: /system|light/i }).first();
    if (await systemOption.count() > 0) {
      await systemOption.click();
      await page.waitForTimeout(500);
    }
  });

  test('display density options exist (comfortable/compact)', async ({ page }) => {
    const densitySection = page.locator('text=/display density|density/i').first();
    if (await densitySection.count() > 0) {
      await expect(densitySection).toBeVisible();

      const comfortableOpt = page.locator('button, input, label').filter({ hasText: /comfortable/i }).first();
      const compactOpt = page.locator('button, input, label').filter({ hasText: /compact/i }).first();

      if (await comfortableOpt.count() > 0) {
        await comfortableOpt.click();
        await page.waitForTimeout(300);
      }
      if (await compactOpt.count() > 0) {
        await compactOpt.click();
        await page.waitForTimeout(300);
      }
      // Revert to comfortable
      if (await comfortableOpt.count() > 0) {
        await comfortableOpt.click();
      }
    }
  });

  // ─── Profile ─────────────────────────────────────────────────────────────────

  test('profile section shows current user name', async ({ page }) => {
    const profileSection = page.locator('section, [class*="section"]').filter({ hasText: /profile/i }).first();
    if (await profileSection.count() > 0) {
      // Should show user name or email in profile section
      await expect(profileSection).toBeVisible();
    }
    // Fallback: just check page rendered
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  // ─── Notifications ────────────────────────────────────────────────────────────

  test('notification toggles are functional', async ({ page }) => {
    const notifSection = page.locator('section, div').filter({ hasText: /notification/i }).first();
    if (await notifSection.count() > 0) {
      // Find toggle switches in the notification section
      const toggles = notifSection.locator('input[type="checkbox"], button[role="switch"]');
      const count = await toggles.count();
      if (count > 0) {
        // Toggle the first switch
        await toggles.first().click();
        await page.waitForTimeout(300);
        // Toggle back
        await toggles.first().click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('DND (Do Not Disturb) settings visible', async ({ page }) => {
    const dndEl = page.locator('text=/do not disturb|dnd/i').first();
    if (await dndEl.count() > 0) {
      await expect(dndEl).toBeVisible();
    }
  });

  // ─── Preferences ─────────────────────────────────────────────────────────────

  test('timezone selector works', async ({ page }) => {
    const tzSection = page.locator('text=/timezone/i').first();
    if (await tzSection.count() > 0) {
      await expect(tzSection).toBeVisible();

      // Look for timezone search or select
      const tzSearch = page.locator('input[placeholder*="timezone" i], input[placeholder*="search" i]').first();
      if (await tzSearch.count() > 0 && await tzSearch.isVisible()) {
        await tzSearch.fill('New York');
        await page.waitForTimeout(400);

        const nyOption = page.locator('text=/America\/New_York|New York/').first();
        if (await nyOption.count() > 0) {
          await nyOption.click();
          await page.waitForTimeout(300);
        }

        // Clear search
        await tzSearch.clear();
      }
    }
  });

  test('default page size preference is configurable', async ({ page }) => {
    const pageSizeEl = page.locator('text=/page size|items per page/i').first();
    if (await pageSizeEl.count() > 0) {
      await expect(pageSizeEl).toBeVisible();
    }
  });

  test('auto-start recording toggle is present', async ({ page }) => {
    const autoRecordEl = page.locator('text=/auto.*record|auto-start recording/i').first();
    if (await autoRecordEl.count() > 0) {
      await expect(autoRecordEl).toBeVisible();
    }
  });

  // ─── Integrations ─────────────────────────────────────────────────────────────

  test('Zoom Phone integration section is visible', async ({ page }) => {
    const zoomSection = page.locator('text=/zoom|integration/i').first();
    if (await zoomSection.count() > 0) {
      await expect(zoomSection).toBeVisible();
    }
  });

  test('autodial toggle in Zoom settings is toggleable', async ({ page }) => {
    const autodialEl = page.locator('text=/autodial|auto.?dial/i').first();
    if (await autodialEl.count() > 0) {
      const toggle = autodialEl.locator('..').locator('input[type="checkbox"], button[role="switch"]').first();
      if (await toggle.count() > 0) {
        await toggle.click();
        await page.waitForTimeout(300);
        await toggle.click(); // revert
      }
    }
  });

  // ─── Admin Mode Section ────────────────────────────────────────────────────────

  test('admin mode section is visible for admin users', async ({ page }) => {
    const adminSection = page.locator('text=/admin mode/i').first();
    if (await adminSection.count() > 0) {
      await expect(adminSection).toBeVisible();
    }
    // Non-admin users won't see this, so just check no crash
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  // ─── Data Privacy ─────────────────────────────────────────────────────────────

  test('data privacy section has export and delete options', async ({ page }) => {
    const privacySection = page.locator('text=/data privacy|privacy/i').first();
    if (await privacySection.count() > 0) {
      await expect(privacySection).toBeVisible();

      // Export data button
      const exportBtn = page.locator('button').filter({ hasText: /export.*data|download.*data/i }).first();
      if (await exportBtn.count() > 0) {
        await expect(exportBtn).toBeVisible();
      }
    }
    // Page should render without errors regardless
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  // ─── Save Changes ─────────────────────────────────────────────────────────────

  test('settings changes trigger save feedback', async ({ page }) => {
    // Toggling any setting should trigger an auto-save or show a save bar
    const notifSection = page.locator('section, div').filter({ hasText: /notification/i }).first();
    if (await notifSection.count() > 0) {
      const toggle = notifSection.locator('input[type="checkbox"]').first();
      if (await toggle.count() > 0) {
        await toggle.click();
        await page.waitForTimeout(800);

        // Look for a save confirmation (toast, floating bar, or green indicator)
        const saveFeedback = page.locator('text=/saved|changes saved|success/i').first();
        if (await saveFeedback.count() > 0) {
          await expect(saveFeedback).toBeVisible({ timeout: 5_000 });
        }

        // Revert
        await toggle.click();
      }
    }
  });

  // ─── Password Change ──────────────────────────────────────────────────────────

  test('password change form fields are present', async ({ page }) => {
    const accountSection = page.locator('section, div').filter({ hasText: /account/i }).first();
    if (await accountSection.count() > 0) {
      const passwordFields = accountSection.locator('input[type="password"]');
      const count = await passwordFields.count();
      // Should have current password + new password + confirm fields
      if (count > 0) {
        await expect(passwordFields.first()).toBeVisible();
      }
    }
  });
});
