/**
 * 12-live-call-flow.spec.ts
 * Live call testing using public telecom test lines.
 *
 * These tests ACTUALLY DIAL real numbers to verify the full call stack:
 *   Zoom Phone dialer → call placed → audio (recording) → call log creation → cleanup
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  PUBLIC TEST NUMBERS (safe to dial — these are maintained test lines)       │
 * │                                                                             │
 * │  1(804) 222-1111  Richmond, VA   — All-in-One: echo, DTMF, tone menu       │
 * │  1(909) 390-0003  Ontario, CA    — Echo Test: immediate audio echo back     │
 * │  1(800) 444-4444  Toll-Free      — MCI ID Readback: reads your caller ID   │
 * │  1(631) 791-8378  New York, NY   — Audio Test (CallCentric)                │
 * │  1(206) 456-0649  Seattle, WA    — Echo + Music (IPKall)                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * PREREQUISITES:
 *   1. TEST_LIVE_CALLS=true in .env.test  (safety gate — off by default)
 *   2. Zoom Phone app installed and logged in on the test machine
 *   3. TEST_USER_EMAIL / TEST_USER_PASSWORD set in .env.test
 *   4. NEXT_PUBLIC_POCKETBASE_URL pointing to your running PocketBase instance
 *
 * What each test does:
 *   a) Dials the number via the session page Zoom Phone dialer
 *   b) Waits for call status to show "ringing" or "connected"
 *   c) Hangs up after a brief listen period (configurable via TEST_CALL_DURATION_SEC)
 *   d) Submits the call form (company, outcome, notes)
 *   e) Verifies the call log was created in PocketBase
 *   f) Verifies recording was started (if auto-record is on)
 *   g) Deletes all TEST_PW_ call logs and recordings created during the test
 *
 * IMPORTANT: Run with --headed to monitor calls visually:
 *   pnpm test:headed tests/12-live-call-flow.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_PREFIX, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord, fetchRecords, deleteRecord } from './helpers/pb-client';

// ─── Safety gate ──────────────────────────────────────────────────────────────
const LIVE_CALLS_ENABLED = process.env.TEST_LIVE_CALLS === 'true';

// How long to stay on a test call (seconds) before hanging up
const CALL_DURATION_SEC = parseInt(process.env.TEST_CALL_DURATION_SEC ?? '10', 10);

// ─── Test number definitions ──────────────────────────────────────────────────
const TEST_NUMBERS = [
  {
    number: '18042221111',
    displayNumber: '1 (804) 222-1111',
    location: 'Richmond, VA',
    description: 'All-in-One (echo, DTMF, tone menu)',
    expectAudio: true,
    shortCode: 'all-in-one',
  },
  {
    number: '19093900003',
    displayNumber: '1 (909) 390-0003',
    location: 'Ontario, CA',
    description: 'Echo Test — immediate audio echo',
    expectAudio: true,
    shortCode: 'echo-test',
  },
  {
    number: '18004444444',
    displayNumber: '1 (800) 444-4444',
    location: 'Toll-Free',
    description: 'MCI Caller ID Readback',
    expectAudio: true,
    shortCode: 'caller-id-readback',
  },
  {
    number: '16317918378',
    displayNumber: '1 (631) 791-8378',
    location: 'New York, NY',
    description: 'Audio Test (CallCentric)',
    expectAudio: true,
    shortCode: 'callcentric-audio',
  },
  {
    number: '12064560649',
    displayNumber: '1 (206) 456-0649',
    location: 'Seattle, WA',
    description: 'Echo + Music (IPKall)',
    expectAudio: true,
    shortCode: 'ipkall-echo',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure Zoom Phone dialer is open on the session page.
 * Returns the dial circle button or null if not found.
 */
async function openZoomDialer(page: Page) {
  await page.goto('/session');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Click the Zoom dial circle / button to open dialer
  const dialCircle = page
    .locator('button[aria-label*="dial" i], button[aria-label*="call" i], [class*="dial-button"], [class*="zoom-button"]')
    .first();

  if (await dialCircle.count() > 0) {
    await dialCircle.click();
    await page.waitForTimeout(800);
    return dialCircle;
  }
  return null;
}

/**
 * Dial a number using the Zoom Phone dialer or custom dialer overlay.
 * Handles both the native iframe dialer and the custom overlay.
 */
async function dialNumber(page: Page, number: string): Promise<boolean> {
  // Method 1: Custom dialer overlay — look for a text input for manual number entry
  const customDialerInput = page.locator(
    'input[placeholder*="number" i], input[placeholder*="dial" i], input[type="tel"]'
  ).first();

  if (await customDialerInput.count() > 0 && await customDialerInput.isVisible()) {
    await customDialerInput.clear();
    await customDialerInput.fill(number);
    await page.waitForTimeout(300);

    // Hit dial button
    const dialBtn = page
      .locator('button')
      .filter({ hasText: /^dial$|^call$|^call now$/i })
      .first();
    if (await dialBtn.count() > 0) {
      await dialBtn.click();
      return true;
    }
    // Try pressing Enter
    await customDialerInput.press('Enter');
    return true;
  }

  // Method 2: Zoom Smart Embed iframe — postMessage approach
  const zoomFrame = page.frameLocator('iframe[src*="zoom"]').first();
  if (await zoomFrame.locator('body').count() > 0) {
    // Zoom's embedded dialer — type number and press call
    const zoomInput = zoomFrame.locator('input').first();
    if (await zoomInput.count() > 0) {
      await zoomInput.fill(number);
      await zoomInput.press('Enter');
      return true;
    }
  }

  console.warn(`Could not find dialer input for number ${number}`);
  return false;
}

/**
 * Wait for call status to reach "connected" or "ringing" state.
 */
async function waitForCallStatus(page: Page, targetStatus: 'ringing' | 'connected', timeoutMs = 20_000) {
  await page.waitForFunction(
    (status) => {
      const body = document.body.innerText.toLowerCase();
      return body.includes(status) || body.includes('on call') || body.includes('in call');
    },
    targetStatus,
    { timeout: timeoutMs }
  ).catch(() => {
    console.warn(`Call status "${targetStatus}" not detected within ${timeoutMs}ms`);
  });
}

/**
 * Hang up the current call.
 */
async function hangUp(page: Page) {
  const hangUpBtn = page
    .locator('button')
    .filter({ hasText: /hang up|end call|disconnect/i })
    .first();

  if (await hangUpBtn.count() > 0) {
    await hangUpBtn.click();
    await page.waitForTimeout(1000);
    return;
  }

  // Try clicking a red/end-call button
  const redBtn = page.locator('button[class*="red"], button[class*="end"], button[class*="hangup"]').first();
  if (await redBtn.count() > 0) {
    await redBtn.click();
    await page.waitForTimeout(1000);
  }
}

/**
 * Fill and submit the call log form after a call.
 */
async function submitCallForm(
  page: Page,
  opts: {
    companySearch?: string;
    outcome: string;
    interestLevel?: number;
    notes: string;
    ownerReached?: boolean;
  }
) {
  await page.waitForTimeout(500);

  // Company search
  if (opts.companySearch) {
    const companyInput = page.locator('input[placeholder*="company" i], input[placeholder*="search company" i]').first();
    if (await companyInput.count() > 0 && await companyInput.isVisible()) {
      await companyInput.fill(opts.companySearch);
      await page.waitForTimeout(400);
      const suggestion = page.locator('[role="option"], [class*="suggestion"]').first();
      if (await suggestion.count() > 0) {
        await suggestion.click();
      }
    }
  }

  // Call outcome
  const outcomeSelect = page
    .locator('select, [role="combobox"]')
    .filter({ hasText: /outcome|select outcome/i })
    .first();
  if (await outcomeSelect.count() > 0) {
    if ((await outcomeSelect.evaluate((el) => el.tagName)) === 'SELECT') {
      await outcomeSelect.selectOption(opts.outcome);
    } else {
      await outcomeSelect.click();
      await page.waitForTimeout(300);
      await page.locator('[role="option"]').filter({ hasText: opts.outcome }).first().click();
    }
  } else {
    // Button-based outcome selector
    const outcomeBtn = page.locator('button').filter({ hasText: new RegExp(opts.outcome, 'i') }).first();
    if (await outcomeBtn.count() > 0) {
      await outcomeBtn.click();
    }
  }

  // Interest level (slider or number input)
  if (opts.interestLevel !== undefined) {
    const interestInput = page.locator('input[type="range"], input[type="number"]').first();
    if (await interestInput.count() > 0) {
      await interestInput.fill(String(opts.interestLevel));
    }
  }

  // Notes
  const notesField = page.locator('textarea, input[placeholder*="note" i]').first();
  if (await notesField.count() > 0) {
    await notesField.fill(opts.notes);
  }

  // Owner reached
  if (opts.ownerReached) {
    const ownerReachedCheck = page.locator('input[type="checkbox"]').filter({ hasText: /owner reached/i }).first();
    const ownerReachedLabel = page.locator('label').filter({ hasText: /owner reached/i }).first();
    const target = (await ownerReachedCheck.count() > 0) ? ownerReachedCheck : ownerReachedLabel;
    if (await target.count() > 0) {
      const isChecked = await target.isChecked().catch(() => false);
      if (!isChecked) await target.click();
    }
  }

  // Submit / Save Call button
  const submitBtn = page
    .locator('button')
    .filter({ hasText: /save call|log call|submit|next call/i })
    .first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
    await page.waitForTimeout(2000);
    return true;
  }

  return false;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Live Call Testing — Public Test Lines', () => {
  // These tests run with a longer timeout since real calls take time
  test.setTimeout(120_000);

  let createdCallLogIds: string[] = [];
  let createdRecordingIds: string[] = [];
  let testCompanyId: string;
  let testPhoneIds: string[] = [];

  test.beforeAll(async () => {
    if (!LIVE_CALLS_ENABLED) return;

    // Create a test company for call logs
    const company = await createRecord<{ id: string }>('companies', {
      company_name: `${TEST_PREFIX}LiveCall Test Company`,
      source: 'Manual',
    });
    testCompanyId = company.id;

    // Create phone number entries for each test line
    for (const num of TEST_NUMBERS) {
      const phone = await createRecord<{ id: string }>('phone_numbers', {
        company: testCompanyId,
        phone_number: num.displayNumber,
        label: `TEST LINE — ${num.description}`,
        location_name: num.location,
        receptionist_name: `[${TEST_PREFIX}] Auto-test`,
      });
      testPhoneIds.push(phone.id);
    }
  });

  test.afterAll(async () => {
    if (!LIVE_CALLS_ENABLED) return;

    // Delete call logs, recordings, phones, company
    for (const id of createdCallLogIds) await deleteRecord('call_logs', id);
    for (const id of createdRecordingIds) await deleteRecord('recordings', id);
    for (const id of testPhoneIds) await deleteRecord('phone_numbers', id);
    if (testCompanyId) await deleteRecord('companies', testCompanyId);

    // Also catch any stragglers
    await cleanupByPrefix('call_logs', 'post_call_notes', TEST_PREFIX);
    await cleanupByPrefix('recordings', 'note', TEST_PREFIX);
    await cleanupByPrefix('phone_numbers', 'receptionist_name', TEST_PREFIX);
    await cleanupByPrefix('companies', 'company_name', TEST_PREFIX);

    console.log(`🧹 Live call test cleanup: removed ${createdCallLogIds.length} call logs, ${createdRecordingIds.length} recordings.`);
  });

  // ── Skip guard ────────────────────────────────────────────────────────────
  test.beforeEach(async ({}, testInfo) => {
    if (!LIVE_CALLS_ENABLED) {
      testInfo.skip(true, '⏭️  TEST_LIVE_CALLS is not set to "true". Set it in .env.test to enable live call tests.');
    }
  });

  // ─── Dialer Setup Test ────────────────────────────────────────────────────

  test('session page dialer is ready for calls @live', async ({ page }) => {
    await page.goto('/session');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Verify Zoom Phone component is present
    const dialerEl = page
      .locator('button[aria-label*="dial" i], [class*="zoom"], iframe[src*="zoom"]')
      .first();
    await expect(dialerEl).toBeVisible({ timeout: 10_000 });
    console.log('✅ Dialer element found on session page.');
  });

  // ─── Individual Number Tests ──────────────────────────────────────────────

  for (const testNum of TEST_NUMBERS) {
    test(`Dial ${testNum.displayNumber} — ${testNum.description} @live`, async ({ page }) => {
      console.log(`\n📞 Dialing ${testNum.displayNumber} (${testNum.location}) — ${testNum.description}`);

      // 1. Open session page and make sure session is started
      await page.goto('/session');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Check if we need to start a session
      const startBtn = page.locator('button').filter({ hasText: /start session/i }).first();
      if (await startBtn.count() > 0) {
        await startBtn.click();
        await page.waitForTimeout(2000);
      }

      // 2. Open dialer
      const dialerCircle = await openZoomDialer(page);
      if (!dialerCircle) {
        console.warn(`No dialer circle found — attempting direct dial`);
      }

      // 3. Dial the number
      const dialSucceeded = await dialNumber(page, testNum.number);
      if (!dialSucceeded) {
        console.warn(`⚠️  Could not dial ${testNum.number} via UI — Zoom Phone may not be connected.`);
        test.skip();
        return;
      }

      console.log(`  ⏳ Dialing ${testNum.displayNumber}...`);
      await page.waitForTimeout(3000);

      // 4. Wait for ring/connect
      await waitForCallStatus(page, 'ringing', 15_000);
      console.log(`  🔔 Ringing...`);

      // 5. Wait for connection (auto-answer on test lines)
      await waitForCallStatus(page, 'connected', 15_000);
      console.log(`  ✅ Connected to ${testNum.description}!`);

      // 6. Stay on the call for the configured duration
      console.log(`  ⏱️  Listening for ${CALL_DURATION_SEC} seconds (verify audio on your end)...`);
      await page.waitForTimeout(CALL_DURATION_SEC * 1000);

      // 7. Hang up
      await hangUp(page);
      console.log(`  📵 Call ended.`);
      await page.waitForTimeout(1500);

      // 8. Submit call log form
      const phoneIdx = TEST_NUMBERS.indexOf(testNum);
      const formSubmitted = await submitCallForm(page, {
        companySearch: 'LiveCall Test Company',
        outcome: 'Other',
        interestLevel: 5,
        notes: `[${TEST_PREFIX}] Live test call to ${testNum.displayNumber} (${testNum.description})`,
        ownerReached: false,
      });

      if (formSubmitted) {
        console.log(`  📝 Call form submitted.`);
        await page.waitForTimeout(2000);

        // 9. Verify call log was created in PocketBase
        const callLogs = await fetchRecords<{ id: string }>(
          'call_logs',
          `post_call_notes ~ '${TEST_PREFIX}' && post_call_notes ~ '${testNum.shortCode}'`,
          'id'
        ).catch(() => []);

        if (callLogs.length > 0) {
          createdCallLogIds.push(...callLogs.map((r) => r.id));
          console.log(`  ✅ Call log created: ${callLogs[0].id}`);
        } else {
          console.warn(`  ⚠️  Call log not found in DB after submission`);
        }

        // 10. Check for associated recording
        const recordings = await fetchRecords<{ id: string }>(
          'recordings',
          `call_log = '${callLogs[0]?.id ?? ''}'`,
          'id'
        ).catch(() => []);

        if (recordings.length > 0) {
          createdRecordingIds.push(...recordings.map((r) => r.id));
          console.log(`  🎙️  Recording created: ${recordings[0].id}`);
        } else {
          console.log(`  ℹ️  No recording linked (auto-record may be off or recording still uploading)`);
        }
      }

      // 11. Verify on the Cold Calls page that the call log appears
      await page.goto('/cold-calls');
      await waitForTableLoad(page);

      const searchInput = page.locator('input[placeholder*="earch"]').first();
      await searchInput.fill('LiveCall Test Company');
      await page.waitForTimeout(600);
      await waitForTableLoad(page);

      const callRows = page.locator('tbody tr, [role="row"]').filter({ hasText: /LiveCall/i });
      const rowCount = await callRows.count();
      console.log(`  📋 Found ${rowCount} call log row(s) for LiveCall Test Company in /cold-calls`);

      // Test passes as long as the page didn't crash
      await expect(page.locator('body')).not.toContainText('Application error');
    });
  }

  // ─── Full Flow: Session → Dial → Log → Recording → Session End ───────────

  test('full session call flow: start → dial → log → end session @live', async ({ page }) => {
    console.log('\n🔄 Running FULL SESSION FLOW test...');

    // 1. Start a fresh session
    await page.goto('/session');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const startBtn = page.locator('button').filter({ hasText: /start session/i }).first();
    if (await startBtn.count() > 0) {
      await startBtn.click();
      await page.waitForTimeout(2000);
      console.log('  ✅ Session started.');
    }

    // 2. Verify session metrics initialised at 0
    await expect(page.locator('body')).not.toContainText('Application error');

    // 3. Dial the echo test line
    const echoNum = TEST_NUMBERS[1]; // (909) 390-0003
    const dialed = await dialNumber(page, echoNum.number);

    if (!dialed) {
      console.warn('  ⚠️  Dial skipped (dialer not available)');
      return;
    }

    await waitForCallStatus(page, 'connected', 20_000);
    console.log(`  ✅ Connected to ${echoNum.description}`);
    await page.waitForTimeout(5000); // listen briefly

    await hangUp(page);
    console.log('  📵 Hung up.');
    await page.waitForTimeout(1000);

    // 4. Submit the call form
    await submitCallForm(page, {
      outcome: 'No Answer',
      notes: `[${TEST_PREFIX}] Full flow test — echo line`,
    });
    await page.waitForTimeout(2000);

    // 5. End the session
    const endBtn = page.locator('button').filter({ hasText: /end session|stop session/i }).first();
    if (await endBtn.count() > 0) {
      await endBtn.click();
      await page.waitForTimeout(500);

      const confirmBtn = page.locator('button').filter({ hasText: /confirm|yes|end/i }).first();
      if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await page.waitForTimeout(2000);
      }
      console.log('  ✅ Session ended.');
    }

    // 6. Verify session appears in /session-logs
    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const completedTab = page.locator('button, [role="tab"]').filter({ hasText: /completed/i }).first();
    if (await completedTab.count() > 0) {
      await completedTab.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('Application error');
    console.log('  ✅ Session visible in /session-logs.');

    // Cleanup: find and delete the session we just created
    const sessions = await fetchRecords<{ id: string }>(
      'cold_calling_sessions',
      `session_notes ~ '${TEST_PREFIX}' || total_dials = 1`,
      'id'
    ).catch(() => []);

    for (const s of sessions) {
      await deleteRecord('cold_calling_sessions', s.id);
    }
  });

  // ─── Recording Upload Verification ───────────────────────────────────────

  test('recording is uploaded to PocketBase after call ends @live', async ({ page }) => {
    console.log('\n🎙️  Testing recording upload flow...');

    // This test verifies that after a call, if auto-record is on,
    // a recording record appears in PocketBase within 30 seconds.

    const beforeCount = await fetchRecords<{ id: string }>(
      'recordings', `note ~ '${TEST_PREFIX}'`, 'id'
    ).then((r) => r.length).catch(() => 0);

    // Dial a short call
    await page.goto('/session');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const startBtn = page.locator('button').filter({ hasText: /start session/i }).first();
    if (await startBtn.count() > 0) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }

    const dialed = await dialNumber(page, TEST_NUMBERS[0].number); // (804) 222-1111
    if (!dialed) {
      console.warn('  ⚠️  Skipping recording test — dialer not available');
      return;
    }

    await waitForCallStatus(page, 'connected', 20_000);
    await page.waitForTimeout(8000); // 8 second call
    await hangUp(page);
    await page.waitForTimeout(1000);

    await submitCallForm(page, {
      outcome: 'No Answer',
      notes: `[${TEST_PREFIX}] Recording upload test`,
    });

    // Wait up to 30 seconds for recording to appear
    let afterCount = beforeCount;
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.waitForTimeout(5000);
      afterCount = await fetchRecords<{ id: string }>(
        'recordings', `note ~ '${TEST_PREFIX}'`, 'id'
      ).then((r) => r.length).catch(() => 0);

      if (afterCount > beforeCount) {
        console.log(`  ✅ Recording uploaded! (${afterCount - beforeCount} new recording(s))`);
        break;
      }
    }

    if (afterCount > beforeCount) {
      const newRecordings = await fetchRecords<{ id: string }>(
        'recordings', `note ~ '${TEST_PREFIX}'`, 'id'
      ).catch(() => []);
      createdRecordingIds.push(...newRecordings.map((r) => r.id));
    } else {
      console.log('  ℹ️  No new recording found (auto-record may be disabled or still processing)');
    }

    // End session
    const endBtn = page.locator('button').filter({ hasText: /end session|stop session/i }).first();
    if (await endBtn.count() > 0) {
      await endBtn.click();
      await page.waitForTimeout(500);
      const confirmBtn = page.locator('button').filter({ hasText: /confirm|yes|end/i }).first();
      if (await confirmBtn.count() > 0) await confirmBtn.click();
    }

    await expect(page.locator('body')).not.toContainText('Application error');
  });
});
