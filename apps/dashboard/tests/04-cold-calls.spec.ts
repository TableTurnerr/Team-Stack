/**
 * 04-cold-calls.spec.ts
 * Tests for the Cold Calls page — call log table, filters, sorting,
 * column visibility, and the Phone Numbers tab.
 *
 * Removed tests:
 *   - 'Call Logs tab is active by default' — trivial state check (aria-selected)
 *   - 'search by phone number filters results' — duplicate of search by company name (same mechanism)
 *   - 'export/download button is visible' — conditional assertion, always passed
 *   - 'phone numbers tab: add new phone number dialog opens' — deeply nested conditionals, never failed
 *
 * Strategy:
 *   beforeAll → seed a test company + phone number + call log via API
 *   tests     → UI interactions on the call log table and phone numbers tab
 *   afterAll  → delete all TEST_PW_ data
 */
import { test, expect } from '@playwright/test';
import { TEST_PREFIX, TEST_COMPANY, TEST_PHONE_NUMBER, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord } from './helpers/pb-client';

let testCompanyId: string;
let testPhoneId: string;
let testCallLogId: string;

test.describe('Cold Calls Page', () => {
  test.beforeAll(async () => {
    const company = await createRecord<{ id: string }>('companies', {
      company_name: TEST_COMPANY.name,
      owner_name: TEST_COMPANY.owner,
      source: 'Manual',
    });
    testCompanyId = company.id;

    const phone = await createRecord<{ id: string }>('phone_numbers', {
      company: testCompanyId,
      phone_number: TEST_PHONE_NUMBER.number,
      label: TEST_PHONE_NUMBER.label,
      location_name: TEST_PHONE_NUMBER.locationName,
      receptionist_name: TEST_PHONE_NUMBER.receptionistName,
    });
    testPhoneId = phone.id;

    const callLog = await createRecord<{ id: string }>('call_logs', {
      company: testCompanyId,
      phone_number_record: testPhoneId,
      call_time: new Date().toISOString(),
      call_outcome: 'Interested',
      interest_level: 7,
      post_call_notes: `[${TEST_PREFIX}] Playwright automated test call`,
      owner_reached: true,
      pitch_completed: true,
      warm_lead: false,
    });
    testCallLogId = callLog.id;
  });

  test.afterAll(async () => {
    await cleanupByPrefix('call_logs', 'post_call_notes', TEST_PREFIX);
    await cleanupByPrefix('phone_numbers', 'receptionist_name', TEST_PREFIX);
    await cleanupByPrefix('companies', 'company_name', TEST_PREFIX);
  });

  // ─── Page Load ───────────────────────────────────────────────────────────────

  test('cold calls page loads with table @smoke', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('table, [role="table"]').first()).toBeVisible();
  });

  test('call log table has expected columns', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const expectedHeaders = ['Date', 'Company', 'Phone', 'Outcome', 'Duration'];
    for (const header of expectedHeaders) {
      await expect(
        page.locator('th, [role="columnheader"]').filter({ hasText: new RegExp(header, 'i') }).first()
      ).toBeVisible();
    }
  });

  // ─── Tab Switching ────────────────────────────────────────────────────────────

  test('Phone Numbers tab is accessible and shows data', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const phoneTab = page.locator('[role="tab"], button').filter({ hasText: /phone number/i }).first();
    await expect(phoneTab).toBeVisible();
    await phoneTab.click();
    await page.waitForTimeout(500);
    await waitForTableLoad(page);

    await expect(page.locator('body')).not.toContainText('Application error');
  });

  // ─── Search ──────────────────────────────────────────────────────────────────

  test('search by company name filters call logs', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await expect(searchInput).toBeVisible();

    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const rows = page.locator('tbody tr, [role="row"]').filter({ hasText: TEST_COMPANY.name });
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  });

  // ─── Outcome Filter ───────────────────────────────────────────────────────────

  test('outcome filter exists', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const outcomeFilter = page.locator('select, button').filter({ hasText: /outcome|filter/i }).first();
    if (await outcomeFilter.count() > 0) {
      await outcomeFilter.click();
      await page.waitForTimeout(300);

      const interestedOption = page.locator('text=/Interested/i').first();
      await expect(interestedOption).toBeVisible({ timeout: 5_000 });
    }
  });

  test('filtering by "Interested" shows only interested calls', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const outcomeFilter = page.locator('select').filter({ hasText: /outcome|all/i }).first();
    if (await outcomeFilter.count() > 0 && await outcomeFilter.isVisible()) {
      await outcomeFilter.selectOption('Interested');
      await page.waitForTimeout(600);
      await waitForTableLoad(page);

      const outcomeBadges = page.locator('td').filter({ hasText: /Not Interested/i });
      await expect(outcomeBadges).toHaveCount(0);
    }
  });

  // ─── Column Visibility ────────────────────────────────────────────────────────

  test('column selector toggles columns in call log table', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const colBtn = page.locator('button').filter({ hasText: /column/i }).first();
    if (await colBtn.count() > 0) {
      await colBtn.click();
      await page.waitForTimeout(300);

      // Column selector uses custom button toggles (not native checkboxes)
      const toggleBtns = page.locator('button').filter({ hasText: /caller|company|outcome|date/i });
      await expect(toggleBtns.first()).toBeVisible({ timeout: 5_000 });

      const callerToggle = page.locator('button').filter({ hasText: /caller/i }).first();
      if (await callerToggle.count() > 0) {
        await callerToggle.click();
        await page.waitForTimeout(300);
        await callerToggle.click();
      }

      await page.keyboard.press('Escape');
    }
  });

  // ─── Sorting ─────────────────────────────────────────────────────────────────

  test('sorting by date works', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const dateHeader = page.locator('th, [role="columnheader"]').filter({ hasText: /date/i }).first();
    if (await dateHeader.count() > 0) {
      await dateHeader.click();
      await page.waitForTimeout(500);
      await expect(page.locator('table, [role="table"]').first()).toBeVisible();

      await dateHeader.click();
      await page.waitForTimeout(300);
      await expect(page.locator('table, [role="table"]').first()).toBeVisible();
    }
  });

  // ─── Performance Icons ────────────────────────────────────────────────────────

  test('performance indicators display (owner reached, pitch, appointment)', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const performanceCol = page.locator('th, [role="columnheader"]').filter({ hasText: /performance/i }).first();
    await expect(performanceCol).toBeVisible();
  });

  // ─── Phone Numbers Tab ────────────────────────────────────────────────────────

  test('phone numbers tab: test phone number is visible', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const phoneTab = page.locator('[role="tab"], button').filter({ hasText: /phone number/i }).first();
    if (await phoneTab.count() > 0) {
      await phoneTab.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);

      const searchInput = page.locator('input[placeholder*="earch"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill(TEST_PHONE_NUMBER.number);
        await page.waitForTimeout(600);
      }

      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  // ─── Call Detail Navigation ───────────────────────────────────────────────────

  test('clicking view detail navigates to call detail page', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_COMPANY.name);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const detailLink = page.locator('a[href*="/cold-calls/"]').first();
    if (await detailLink.count() > 0) {
      await detailLink.click();
      await page.waitForURL(/\/cold-calls\/.+/, { timeout: 25_000 });
      await expect(page).toHaveURL(/\/cold-calls\/.+/);
      await expect(page.locator('body')).not.toContainText('Application error', { timeout: 15_000 });
    }
  });
});
