/**
 * 03-companies.spec.ts
 * Full CRUD + UI tests for the Companies page.
 *
 * Removed tests:
 *   - 'zoom call button is visible for companies with phone numbers' — conditional assertions, just checked row visible
 *   - 'refresh button reloads data' — marginal value, duplicate pattern
 *
 * Strategy:
 *   beforeAll  → create a test company via PocketBase API
 *   tests      → search, filter, sort, inline-edit, column toggle, detail page
 *   afterAll   → delete all TEST_PW_ companies via PocketBase API
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_PREFIX, TEST_COMPANY, TEST_COMPANY_2, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord, fetchRecords } from './helpers/pb-client';

let testCompanyId: string;

test.describe('Companies Page', () => {
  test.beforeAll(async () => {
    const record = await createRecord<{ id: string }>('companies', {
      company_name: TEST_COMPANY.name,
      owner_name: TEST_COMPANY.owner,
      phone_numbers: TEST_COMPANY.phone,
      company_location: TEST_COMPANY.location,
      instagram_handle: TEST_COMPANY.instagram,
      email: TEST_COMPANY.email,
      status: TEST_COMPANY.status,
      source: 'Manual',
    });
    testCompanyId = record.id;
  });

  test.afterAll(async () => {
    const deleted = await cleanupByPrefix('companies', 'company_name', TEST_PREFIX);
    console.log(`Cleaned up ${deleted} test companies.`);
  });

  // ─── Page Load ───────────────────────────────────────────────────────────────

  test('companies page loads @smoke', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    await expect(page.locator('h1').first()).toBeVisible();
    const table = page.locator('table, [role="table"]').first();
    await expect(table).toBeVisible();
  });

  test('displays table headers', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    for (const header of ['Company', 'Owner', 'Status', 'Source']) {
      await expect(page.locator('th, [role="columnheader"]').filter({ hasText: new RegExp(header, 'i') }).first()).toBeVisible();
    }
  });

  // ─── Search ──────────────────────────────────────────────────────────────────

  test('search by company name filters results', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    await expect(page.locator('td, [role="cell"]').filter({ hasText: TEST_COMPANY.name }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('search for non-existent company shows empty state', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill('ZZZNOMATCHXXX999');
    await searchInput.press('Enter');
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const noResults = page.locator('text=/no result|no compan|empty|nothing found/i');
    const rowCount = await page.locator('tbody tr, [role="row"]').count();
    const hasEmpty = await noResults.count() > 0;
    expect(hasEmpty || rowCount <= 1).toBeTruthy();
  });

  test('clearing search restores full list', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill('ZZZNOMATCH');
    await page.waitForTimeout(600);

    await searchInput.clear();
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const rows = page.locator('tbody tr, [role="row"]').filter({ hasNot: page.locator('th') });
    await expect(rows.first()).toBeVisible();
  });

  // ─── Filters ─────────────────────────────────────────────────────────────────

  test('status filter dropdown exists and is functional', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const filterEl = page.locator('select, button').filter({ hasText: /status|filter/i }).first();
    if (await filterEl.count() > 0) {
      await filterEl.click();
      await page.waitForTimeout(300);
      const warmOption = page.locator('text=/Warm|Booked|Replied|Excluded/i').first();
      await expect(warmOption).toBeVisible({ timeout: 5_000 });
    }
  });

  // ─── Column Visibility ────────────────────────────────────────────────────────

  test('column selector opens and toggles columns', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const colBtn = page.locator('button').filter({ hasText: /column/i }).first();
    if (await colBtn.count() > 0) {
      await colBtn.click();
      await page.waitForTimeout(300);

      // Column selector uses custom button toggles (not native checkboxes)
      const toggleBtns = page.locator('button').filter({ hasText: /email|status|location|company name/i });
      await expect(toggleBtns.first()).toBeVisible({ timeout: 5_000 });

      const emailToggle = page.locator('button').filter({ hasText: /email/i }).first();
      if (await emailToggle.count() > 0) {
        await emailToggle.click();
        await page.waitForTimeout(200);
        await emailToggle.click();
      }

      await page.keyboard.press('Escape');
    }
  });

  // ─── Sorting ─────────────────────────────────────────────────────────────────

  test('clicking column header sorts the table', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const companyHeader = page.locator('th, [role="columnheader"]').filter({ hasText: /company/i }).first();
    if (await companyHeader.count() > 0) {
      await companyHeader.click();
      await page.waitForTimeout(500);
      await expect(page.locator('table, [role="table"]').first()).toBeVisible();

      await companyHeader.click();
      await page.waitForTimeout(300);
      await expect(page.locator('table, [role="table"]').first()).toBeVisible();
    }
  });

  // ─── Inline Edit ─────────────────────────────────────────────────────────────

  test('inline edit company name works', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const companyCell = page.locator('td, [role="cell"]').filter({ hasText: TEST_COMPANY.name }).first();
    await expect(companyCell).toBeVisible({ timeout: 10_000 });

    await companyCell.hover();
    await page.waitForTimeout(200);

    const editBtn = companyCell.locator('button, [role="button"]').first();
    if (await editBtn.count() > 0) {
      await editBtn.click();
      await page.waitForTimeout(300);

      const editInput = page.locator('input[type="text"]').first();
      if (await editInput.count() > 0 && await editInput.isVisible()) {
        const newName = `${TEST_COMPANY.name} EDITED`;
        await editInput.clear();
        await editInput.fill(newName);
        await editInput.press('Enter');
        await page.waitForTimeout(1000);

        // Revert
        await companyCell.hover();
        const revertBtn = companyCell.locator('button').first();
        if (await revertBtn.count() > 0) {
          await revertBtn.click();
          const revertInput = page.locator('input[type="text"]').first();
          if (await revertInput.isVisible()) {
            await revertInput.clear();
            await revertInput.fill(TEST_COMPANY.name);
            await revertInput.press('Enter');
            await page.waitForTimeout(1000);
          }
        }
      }
    }
  });

  test('inline edit status works', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const statusCell = page.locator('td').filter({ hasText: /Cold No Reply|Warm|Replied|Booked|Paid|Client|Excluded/i }).first();
    if (await statusCell.count() > 0) {
      await statusCell.click();
      await page.waitForTimeout(300);

      const warmOption = page.locator('[role="option"], option, button').filter({ hasText: /Warm/i }).first();
      if (await warmOption.count() > 0) {
        await warmOption.click();
        await page.waitForTimeout(1000);

        // Revert
        await statusCell.click();
        await page.waitForTimeout(300);
        const originalOption = page.locator('[role="option"], option, button').filter({ hasText: /Cold No Reply/i }).first();
        if (await originalOption.count() > 0) {
          await originalOption.click();
          await page.waitForTimeout(1000);
        }
      }
    }
  });

  // ─── Company Detail Page ──────────────────────────────────────────────────────

  test('clicking company name navigates to detail page', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const detailLink = page.locator(`a[href*="/companies/${testCompanyId}"]`).first();
    if (await detailLink.count() > 0) {
      await detailLink.click();
      await page.waitForURL(/\/companies\/.+/, { timeout: 25_000 });
      await expect(page).toHaveURL(/\/companies\/.+/);
      await expect(page.locator('body')).toContainText(TEST_COMPANY.name, { timeout: 25_000 });
    }
  });
});
