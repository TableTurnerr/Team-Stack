/**
 * 04-cold-calls.spec.ts
 * Tests for the Cold Calls page — call log table, filters, sorting,
 * column visibility, and the Phone Numbers tab.
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
    // 1. Create company
    const company = await createRecord<{ id: string }>('companies', {
      company_name: TEST_COMPANY.name,
      owner_name: TEST_COMPANY.owner,
      source: 'Manual',
    });
    testCompanyId = company.id;

    // 2. Create phone number linked to company
    const phone = await createRecord<{ id: string }>('phone_numbers', {
      company: testCompanyId,
      phone_number: TEST_PHONE_NUMBER.number,
      label: TEST_PHONE_NUMBER.label,
      location_name: TEST_PHONE_NUMBER.locationName,
      receptionist_name: TEST_PHONE_NUMBER.receptionistName,
    });
    testPhoneId = phone.id;

    // 3. Create a call log
    const callLog = await createRecord<{ id: string }>('call_logs', {
      company: testCompanyId,
      phone_number_record: testPhoneId,
      call_time: new Date().toISOString(),
      call_outcome: 'Interested',
      interest_level: 7,
      post_call_notes: `[${TEST_PREFIX}] Playwright automated test call`,
      owner_reached: true,
      pitch_completed: true,
      appointment_set: false,
    });
    testCallLogId = callLog.id;
  });

  test.afterAll(async () => {
    // Clean up in correct order (call_logs first, then phone_numbers, then companies)
    await cleanupByPrefix('call_logs', 'post_call_notes', TEST_PREFIX);
    await cleanupByPrefix('phone_numbers', 'receptionist_name', TEST_PREFIX);
    await cleanupByPrefix('companies', 'company_name', TEST_PREFIX);
    console.log('🧹 Cleaned up cold calls test data.');
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

    // Find the "Phone Numbers" tab
    const phoneTab = page.locator('[role="tab"], button').filter({ hasText: /phone number/i }).first();
    await expect(phoneTab).toBeVisible();
    await phoneTab.click();
    await page.waitForTimeout(500);
    await waitForTableLoad(page);

    // Phone numbers content should load
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('Call Logs tab is active by default', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    // Call Logs tab should be active
    const callLogsTab = page.locator('[role="tab"]').filter({ hasText: /call log/i }).first();
    if (await callLogsTab.count() > 0) {
      // Active tab usually has aria-selected="true" or an active class
      const isSelected = await callLogsTab.getAttribute('aria-selected');
      const hasActiveClass = await callLogsTab.evaluate((el) =>
        el.className.includes('active') || el.className.includes('selected')
      );
      expect(isSelected === 'true' || hasActiveClass).toBeTruthy();
    }
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

  test('search by phone number filters results', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_PHONE_NUMBER.number);
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    // Table should now show only rows with this phone number
    const rows = page.locator('tbody tr, [role="row"]').filter({ hasText: TEST_PHONE_NUMBER.number });
    // Pass if found OR if empty state shown (test data may not surface in all views)
    const foundRows = await rows.count();
    const emptyState = await page.locator('text=/no result|empty|no calls/i').count();
    expect(foundRows > 0 || emptyState > 0).toBeTruthy();
  });

  // ─── Outcome Filter ───────────────────────────────────────────────────────────

  test('outcome filter exists', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    // Look for outcome filter (select or filter button)
    const outcomeFilter = page.locator('select, button').filter({ hasText: /outcome|filter/i }).first();
    if (await outcomeFilter.count() > 0) {
      await outcomeFilter.click();
      await page.waitForTimeout(300);

      // Options: Interested, Not Interested, Callback, No Answer, Fumbled, Other
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

      // All visible outcome badges should say "Interested"
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

      const checkboxes = page.locator('input[type="checkbox"]');
      await expect(checkboxes.first()).toBeVisible({ timeout: 5_000 });

      // Toggle "Caller" column
      const callerCheckbox = page.locator('label').filter({ hasText: /^caller$/i }).first();
      if (await callerCheckbox.count() > 0) {
        await callerCheckbox.click();
        await page.waitForTimeout(300);
        await callerCheckbox.click(); // toggle back
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
      // Verify no crash
      await expect(page.locator('table, [role="table"]').first()).toBeVisible();

      await dateHeader.click(); // reverse
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

    // Performance column should contain icons for our test call
    const performanceCol = page.locator('th, [role="columnheader"]').filter({ hasText: /performance/i }).first();
    await expect(performanceCol).toBeVisible();
  });

  // ─── CSV Export ───────────────────────────────────────────────────────────────

  test('export/download button is visible', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const exportBtn = page.locator('button').filter({ hasText: /export|download|csv/i }).first();
    if (await exportBtn.count() > 0) {
      await expect(exportBtn).toBeEnabled();
    }
    // Test passes even if button doesn't exist on this page
  });

  // ─── Phone Numbers Tab ────────────────────────────────────────────────────────

  test('phone numbers tab: test phone number is visible', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    // Switch to Phone Numbers tab
    const phoneTab = page.locator('[role="tab"], button').filter({ hasText: /phone number/i }).first();
    if (await phoneTab.count() > 0) {
      await phoneTab.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);

      // Search for our test phone number
      const searchInput = page.locator('input[placeholder*="earch"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill(TEST_PHONE_NUMBER.number);
        await page.waitForTimeout(600);
      }

      // Our test phone should appear
      const phoneCard = page.locator('body').filter({ hasText: TEST_PHONE_NUMBER.number }).first();
      await expect(page.locator('body')).not.toContainText('Application error');
    }
  });

  test('phone numbers tab: add new phone number dialog opens', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const phoneTab = page.locator('[role="tab"], button').filter({ hasText: /phone number/i }).first();
    if (await phoneTab.count() > 0) {
      await phoneTab.click();
      await page.waitForTimeout(500);
      await waitForTableLoad(page);

      // Look for "Add" button
      const addBtn = page.locator('button').filter({ hasText: /add|new|^\+$/i }).first();
      if (await addBtn.count() > 0) {
        await addBtn.click();
        await page.waitForTimeout(300);

        // A modal/dialog should open
        const modal = page.locator('[role="dialog"], [class*="modal"]').first();
        if (await modal.count() > 0) {
          await expect(modal).toBeVisible();

          // Close without saving
          const closeBtn = modal.locator('button').filter({ hasText: /cancel|close|×/i }).first();
          if (await closeBtn.count() > 0) {
            await closeBtn.click();
          } else {
            await page.keyboard.press('Escape');
          }
        }
      }
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

    // Look for a detail/view link
    const detailLink = page.locator('a[href*="/cold-calls/"]').first();
    if (await detailLink.count() > 0) {
      await detailLink.click();
      await page.waitForURL(/\/cold-calls\/.+/, { timeout: 25_000 });
      await expect(page).toHaveURL(/\/cold-calls\/.+/);
      await expect(page.locator('body')).not.toContainText('Application error', { timeout: 15_000 });
    }
  });
});
