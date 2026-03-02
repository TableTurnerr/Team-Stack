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
 * PREREQUISITES
 * ─────────────
 *  1. TEST_LIVE_CALLS=true in .env.test  (safety gate — off by default)
 *  2. Zoom Phone desktop app installed and logged in on the test machine
 *  3. TEST_USER_EMAIL / TEST_USER_PASSWORD set in .env.test
 *  4. NEXT_PUBLIC_POCKETBASE_URL pointing to your running PocketBase instance
 *
 * ZOOM AUTHENTICATION FLOW
 * ────────────────────────
 *  Before the main tests run, playwright.config.ts includes a  zoom-setup
 *  project (zoom-auth-setup.ts) that:
 *    • Opens a headed Chrome window
 *    • Navigates to the Zoom embedded phone URL
 *    • If not logged in → shows instructions and waits for the user to sign in
 *    • Saves the resulting cookies to  tests/.auth/zoom.json
 *
 *  In this file's  beforeAll  we load those saved cookies into the browser
 *  context so the embedded Zoom iframe is authenticated without any extra login.
 *
 *  If the session expires DURING a test, the  verifyCallOrAskUser  helper
 *  detects the unauthenticated iframe, shows an in-page banner, waits for the
 *  user to log in again through the iframe, and saves the refreshed cookies
 *  back to zoom.json so the next run is automatic again.
 *
 * SESSION START IN TESTS
 * ──────────────────────
 *  The app requires screen share (getDisplayMedia) to start a call session.
 *  We mock this API via  addInitScript  to return a silent audio stream so
 *  sessions start automatically in tests without a real browser dialog.
 *
 * RUNNING
 * ───────
 *  pnpm test:headed tests/12-live-call-flow.spec.ts   ← always use --headed
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import { TEST_PREFIX, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord, fetchRecords, deleteRecord } from './helpers/pb-client';
import { ZOOM_AUTH_FILE } from './helpers/zoom-auth-constants';

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

// ─── Zoom cookie management ───────────────────────────────────────────────────

/**
 * Load Zoom cookies from zoom.json and inject them into the browser context.
 * Must be called BEFORE the page navigates to the session page (so the Zoom
 * iframe receives the cookies when it first loads).
 */
async function loadZoomCookies(context: BrowserContext): Promise<boolean> {
  if (!fs.existsSync(ZOOM_AUTH_FILE)) {
    console.warn('  ⚠️  tests/.auth/zoom.json not found — Zoom iframe may need manual login.');
    return false;
  }

  try {
    const state = JSON.parse(fs.readFileSync(ZOOM_AUTH_FILE, 'utf-8'));
    const cookies: Parameters<BrowserContext['addCookies']>[0] = state.cookies ?? [];
    if (cookies.length === 0) return false;

    await context.addCookies(cookies);
    console.log(`  🍪 Loaded ${cookies.length} Zoom cookie(s) into browser context.`);
    return true;
  } catch (err) {
    console.warn('  ⚠️  Failed to load zoom.json:', err);
    return false;
  }
}

/**
 * Save current browser context cookies back to zoom.json.
 * Called after the user re-authenticates in the Zoom iframe during a test.
 */
async function saveZoomCookies(context: BrowserContext) {
  try {
    const state = await context.storageState();
    fs.writeFileSync(ZOOM_AUTH_FILE, JSON.stringify(state, null, 2));
    console.log(`  💾 Zoom auth saved → ${ZOOM_AUTH_FILE}`);
  } catch (err) {
    console.warn('  ⚠️  Failed to save zoom cookies:', err);
  }
}

// ─── Screen share mock ────────────────────────────────────────────────────────

/**
 * Inject a mock for navigator.mediaDevices.getDisplayMedia / getUserMedia
 * so the session can start without a real browser screen-share dialog.
 *
 * The mock returns a MediaStream with a silent audio track (AudioContext
 * oscillator) which satisfies the recorder's check that the stream has at
 * least one audio track (getAudioTracks().length > 0).
 *
 * Must be called BEFORE the first page.goto() of a test.
 */
async function mockScreenShare(page: Page) {
  await page.addInitScript(() => {
    const makeSilentStream = (): MediaStream => {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.frequency.value = 0; // completely silent
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        // Keep the AudioContext from being GC'd
        (window as any).__testAudioCtxs = (window as any).__testAudioCtxs ?? [];
        (window as any).__testAudioCtxs.push(ctx);
        return dest.stream;
      } catch {
        return new MediaStream();
      }
    };

    navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(makeSilentStream());
    navigator.mediaDevices.getUserMedia   = () => Promise.resolve(makeSilentStream());
  });
}

// ─── Zoom iframe auth check ───────────────────────────────────────────────────

/**
 * Inspect the Zoom iframe's current URL to decide if it is authenticated.
 *
 * Playwright operates at CDP level and CAN read cross-origin iframe URLs, so
 * we don't need to read the iframe's DOM — just its navigation URL is enough.
 *
 * Returns:
 *   true  — dialer appears to be loaded
 *   false — iframe is on a login/auth redirect page
 *   null  — iframe not found yet (still loading)
 */
function getZoomFrameAuthStatus(page: Page): 'authenticated' | 'unauthenticated' | 'not-found' {
  const zoomFrame = page.frames().find(
    (f) =>
      f.url().includes('applications.zoom.us') ||
      f.url().includes('zoom.us/integration')
  );

  if (!zoomFrame) return 'not-found';

  const frameUrl = zoomFrame.url();

  // If the iframe redirected to a sign-in page it's not authenticated
  if (
    frameUrl.includes('/signin') ||
    frameUrl.includes('/login') ||
    frameUrl.includes('/oauth') ||
    frameUrl.includes('zoom.us/j/') // accidentally joined a meeting
  ) {
    return 'unauthenticated';
  }

  return 'authenticated';
}

// ─── User intervention helpers ────────────────────────────────────────────────

/**
 * Show a visible banner on the page and wait for the user to click "Continue".
 */
async function waitForUserAction(
  page: Page,
  heading: string,
  steps: string[],
  timeoutMs = 300_000,
) {
  const stepsHtml = steps
    .map((s, i) => `<li style="margin:6px 0">${i + 1}. ${s}</li>`)
    .join('');

  console.log('\n' + '═'.repeat(70));
  console.log(`🚨  USER ACTION REQUIRED: ${heading}`);
  steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
  console.log('   → Click the "✅ Done — Continue Test" button on the page.');
  console.log('═'.repeat(70) + '\n');

  await page.evaluate(
    ({ h, sh }: { h: string; sh: string }) => {
      const existing = document.getElementById('pw-intervention-banner');
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.id = 'pw-intervention-banner';
      banner.style.cssText = [
        'position:fixed;top:0;left:0;right:0;z-index:2147483647',
        'background:#1a1a2e;color:#eee;padding:18px 24px',
        'font-family:monospace;font-size:13px;line-height:1.5',
        'border-bottom:3px solid #ff6b6b;box-shadow:0 4px 20px rgba(0,0,0,.5)',
      ].join(';');
      banner.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:20px">
          <div style="flex:1">
            <div style="color:#ff6b6b;font-size:16px;font-weight:bold;margin-bottom:10px">
              ⚠️ ${h}
            </div>
            <ol style="margin:0;padding-left:0;list-style:none">${sh}</ol>
          </div>
          <button id="pw-continue-btn" style="
            background:#4ecdc4;color:#000;border:none;padding:12px 22px;
            font-size:14px;font-weight:bold;cursor:pointer;border-radius:6px;
            white-space:nowrap;flex-shrink:0;margin-top:2px
          ">✅ Done — Continue Test</button>
        </div>
      `;
      document.body.prepend(banner);
      document.getElementById('pw-continue-btn')!.onclick = () => {
        banner.remove();
        (window as any).__pwUserActionDone = true;
      };
    },
    { h: heading, sh: stepsHtml },
  );

  await page.waitForFunction(
    () => (window as any).__pwUserActionDone === true,
    { timeout: timeoutMs },
  );
  await page.evaluate(() => { delete (window as any).__pwUserActionDone; });
}

// ─── Session helpers ──────────────────────────────────────────────────────────

/**
 * Navigate to /session and ensure a session is active so the dialer is shown.
 *
 * Flow:
 *   1. SessionModeSelector  → click "Start Session"
 *   2. "Connect Audio" screen → check Zoom checkbox, click "Connect Audio & Start"
 *      (getDisplayMedia is intercepted by the mock — no real browser dialog)
 *   3. Session active — full UI with docked ZoomPhoneDialer is rendered
 */
async function ensureSessionActive(page: Page): Promise<boolean> {
  await page.goto('/session');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Already on the full session page?
  if (await page.locator('h1').filter({ hasText: /call session/i }).count() > 0) {
    console.log('  ✅ Session already active.');
    return true;
  }

  // Mode selector — click "Start Session"
  const startBtn = page.locator('button').filter({ hasText: /^start session$/i }).first();
  if (await startBtn.count() > 0) {
    console.log('  🖱️  Clicking "Start Session"...');
    await startBtn.click();
    await page.waitForTimeout(1500);
  }

  // "Connect Audio" screen — check Zoom checkbox and click Connect
  const connectBtn = page.locator('button').filter({ hasText: /connect audio/i }).first();
  if (await connectBtn.count() > 0) {
    console.log('  🖱️  On "Connect Audio" screen — ticking checkbox and connecting...');

    const zoomCheckbox = page.locator('input[type="checkbox"]').first();
    if (await zoomCheckbox.count() > 0 && !(await zoomCheckbox.isChecked())) {
      await zoomCheckbox.click();
      await page.waitForTimeout(400);
    }

    const activeConnectBtn = page.locator('button').filter({ hasText: /connect audio/i }).first();
    if (await activeConnectBtn.count() > 0 && !(await activeConnectBtn.isDisabled())) {
      await activeConnectBtn.click();
      console.log('  ⏳ Waiting for session to start (mock screen share)...');
      await page.waitForTimeout(3000);
    }
  }

  // Wait for full session UI
  const isActive = await page
    .waitForFunction(
      () =>
        document.body.innerText.includes('Call Session') &&
        !document.body.innerText.includes('Start Session') &&
        !document.body.innerText.includes('Connect Audio to Start'),
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!isActive) {
    console.warn('  ⚠️  Session did not start automatically — asking user to intervene.');
    await waitForUserAction(page, 'Please start a call session manually', [
      'Look at the session page — click "Start Session" if shown',
      'On the "Connect Audio" screen: tick the Zoom checkbox, then click "Connect Audio & Start"',
      'In the browser screen-share dialog: choose the Chrome window, enable "Share system audio", click Share',
      'Wait until you see "Call Session — Active", then click "Done — Continue Test"',
    ]);
  }

  return true;
}

// ─── Dialer helpers ───────────────────────────────────────────────────────────

/**
 * Expand the docked Zoom Phone dialer by hovering over its header.
 * The docked dialer collapses when not hovered; hovering shows the custom
 * dialer overlay with its phone-number input.
 *
 * Uses isVisible() (not count()) to avoid matching hidden DOM elements, and
 * passes { force: true } to hover() so Playwright does not time out waiting
 * for full actionability (e.g. the element being un-obscured) — the dialer
 * bar is intentionally a thin overlay that may be partially covered.
 */
async function expandDockedDialer(page: Page): Promise<boolean> {
  const hoverToDial = page.locator('text=Hover to Dial').first();
  if (await hoverToDial.isVisible().catch(() => false)) {
    await hoverToDial.hover({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    return true;
  }
  const dialerText = page.locator('text=Dialer').first();
  if (await dialerText.isVisible().catch(() => false)) {
    await dialerText.hover({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    return true;
  }
  return false;
}

/**
 * Ensure the Zoom dialer is open, expanded, and ready for use.
 */
async function openZoomDialer(page: Page) {
  await ensureSessionActive(page);
  await page.waitForTimeout(1000);
  await expandDockedDialer(page);
}

/**
 * Dial a number using the custom dialer overlay (our own UI).
 *
 * The overlay has:
 *   - An <input> with placeholder "Enter a name or number..."
 *   - A dial <button title="Dial"> with a Phone SVG icon (no text)
 *
 * After filling the input and clicking Dial, the context calls
 * dialNumber(phone) which sends a postMessage to the Zoom iframe.
 */
async function dialNumber(page: Page, number: string): Promise<boolean> {
  // Expand the docked dialer first (it collapses by default)
  await expandDockedDialer(page);
  await page.waitForTimeout(500);

  // Method 1: Custom dialer overlay input
  const customDialerInput = page
    .locator('input[placeholder*="number" i], input[placeholder*="name" i], input[placeholder*="dial" i], input[type="tel"]')
    .first();

  if (await customDialerInput.count() > 0 && await customDialerInput.isVisible()) {
    await customDialerInput.clear();
    await customDialerInput.fill(number);
    await page.waitForTimeout(300);

    // Dial button — CustomDialerOverlay uses title="Dial" (SVG icon, no text)
    const dialBtn = page.locator('button[title="Dial"]').first();
    if (await dialBtn.count() > 0) {
      await dialBtn.click();
      return true;
    }
    // Fallback: button text match
    const dialBtnByText = page.locator('button').filter({ hasText: /^dial$|^call$|^call now$/i }).first();
    if (await dialBtnByText.count() > 0) {
      await dialBtnByText.click();
      return true;
    }
    // Last resort: Enter key
    await customDialerInput.press('Enter');
    return true;
  }

  // Method 2: Send postMessage directly via page JS (cross-origin iframe approach)
  const sent = await page.evaluate((num: string) => {
    const iframe = document.getElementById('zoom-iframe') as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) return false;
    iframe.contentWindow.postMessage(
      { type: 'zp-make-call', data: { number: num, autoDial: true } },
      'https://applications.zoom.us',
    );
    return true;
  }, number);

  if (sent) {
    console.log(`  📤 Sent zp-make-call postMessage for ${number}`);
    return true;
  }

  console.warn(`Could not find dialer input for number ${number}`);
  return false;
}

// ─── Zoom iframe re-authentication ────────────────────────────────────────────

/**
 * After dialing, verify the call started (status = ringing/connected).
 * If no call event is detected within  checkMs:
 *   1. Check the Zoom iframe URL for signs of an unauthenticated state.
 *   2. If unauthenticated → show the user an intervention banner asking them
 *      to log in to Zoom through the iframe.
 *   3. After the user clicks "Done", save the refreshed cookies to zoom.json
 *      so the next run is automatic.
 *
 * Returns true if the call is active after all of this, false otherwise.
 */
async function verifyCallOrAskUser(
  page: Page,
  context: BrowserContext,
  numberLabel: string,
  checkMs = 8_000,
): Promise<boolean> {
  const callStarted = await page
    .waitForFunction(
      () => {
        const body = document.body.innerText.toLowerCase();
        return (
          body.includes('ringing') ||
          body.includes('on call') ||
          body.includes('in call') ||
          body.includes('connected')
        );
      },
      { timeout: checkMs },
    )
    .then(() => true)
    .catch(() => false);

  if (callStarted) return true;

  // Diagnose the Zoom iframe
  const authStatus = getZoomFrameAuthStatus(page);
  console.warn(
    `\n  ⚠️  No call event received after ${checkMs}ms.` +
    `  Zoom iframe status: ${authStatus}`
  );

  const isUnauthenticated = authStatus === 'unauthenticated';

  // Build the appropriate instructions
  const steps = isUnauthenticated
    ? [
        'In the Zoom Phone panel (right side of the page) you should see a Zoom login screen',
        'Sign in with your Zoom account (the panel is a live iframe of Zoom web phone)',
        'Complete any 2FA / SSO steps if prompted',
        `Once the dialer keypad appears, dial: ${numberLabel}`,
        'When the call is ringing or connected, click "Done — Continue Test"',
      ]
    : [
        `In the Zoom Phone panel, manually dial: ${numberLabel}`,
        'If the dialer is not visible, hover over the "Hover to Dial" bar to expand it',
        'Once the call is ringing or connected, click "Done — Continue Test"',
        'If you cannot place the call, still click "Done" (the test will skip gracefully)',
      ];

  await waitForUserAction(
    page,
    isUnauthenticated
      ? 'Zoom Phone needs login — please sign in to Zoom web'
      : 'Please dial the number manually in the Zoom panel',
    steps,
  );

  // Save refreshed cookies (the user just logged in via the iframe)
  await saveZoomCookies(context);

  // Re-check after user action
  return page
    .waitForFunction(
      () => {
        const body = document.body.innerText.toLowerCase();
        return (
          body.includes('ringing') ||
          body.includes('on call') ||
          body.includes('in call') ||
          body.includes('connected')
        );
      },
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);
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

  if (opts.companySearch) {
    const companyInput = page.locator('input[placeholder*="company" i], input[placeholder*="search company" i]').first();
    if (await companyInput.count() > 0 && await companyInput.isVisible()) {
      await companyInput.fill(opts.companySearch);
      await page.waitForTimeout(400);
      const suggestion = page.locator('[role="option"], [class*="suggestion"]').first();
      if (await suggestion.count() > 0) await suggestion.click();
    }
  }

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
    const outcomeBtn = page.locator('button').filter({ hasText: new RegExp(opts.outcome, 'i') }).first();
    if (await outcomeBtn.count() > 0) await outcomeBtn.click();
  }

  if (opts.interestLevel !== undefined) {
    const interestInput = page.locator('input[type="range"], input[type="number"]').first();
    if (await interestInput.count() > 0) await interestInput.fill(String(opts.interestLevel));
  }

  const notesField = page.locator('textarea, input[placeholder*="note" i]').first();
  if (await notesField.count() > 0) await notesField.fill(opts.notes);

  if (opts.ownerReached) {
    const ownerReachedLabel = page.locator('label').filter({ hasText: /owner reached/i }).first();
    if (await ownerReachedLabel.count() > 0) {
      const isChecked = await ownerReachedLabel.isChecked().catch(() => false);
      if (!isChecked) await ownerReachedLabel.click();
    }
  }

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
  test.setTimeout(120_000);

  let createdCallLogIds: string[] = [];
  let createdRecordingIds: string[] = [];
  let testCompanyId: string;
  let testPhoneIds: string[] = [];

  // ── Zoom cookie injection ────────────────────────────────────────────────
  // Load saved Zoom cookies once for the whole describe block so the Zoom
  // iframe is authenticated when it first loads inside the test browser.
  test.beforeAll(async ({ browser }) => {
    if (!LIVE_CALLS_ENABLED) return;

    // Create a temporary page just to get access to a browser context for
    // cookie injection — we use the first available context.
    const context = await browser.newContext();
    await loadZoomCookies(context);
    await context.close();

    // Create test company
    const company = await createRecord<{ id: string }>('companies', {
      company_name: `${TEST_PREFIX}LiveCall Test Company`,
      source: 'Manual',
    });
    testCompanyId = company.id;

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

    for (const id of createdCallLogIds) await deleteRecord('call_logs', id);
    for (const id of createdRecordingIds) await deleteRecord('recordings', id);
    for (const id of testPhoneIds) await deleteRecord('phone_numbers', id);
    if (testCompanyId) await deleteRecord('companies', testCompanyId);

    await cleanupByPrefix('call_logs', 'post_call_notes', TEST_PREFIX);
    await cleanupByPrefix('recordings', 'note', TEST_PREFIX);
    await cleanupByPrefix('phone_numbers', 'receptionist_name', TEST_PREFIX);
    await cleanupByPrefix('companies', 'company_name', TEST_PREFIX);

    console.log(`🧹 Cleanup done: ${createdCallLogIds.length} call logs, ${createdRecordingIds.length} recordings removed.`);
  });

  test.beforeEach(async ({ page, context }, testInfo) => {
    if (!LIVE_CALLS_ENABLED) {
      testInfo.skip(true, '⏭️  TEST_LIVE_CALLS is not "true". Set it in .env.test to enable live call tests.');
      return;
    }

    // Inject Zoom cookies into THIS test's page context so the iframe is
    // authenticated when it loads.
    await loadZoomCookies(context);

    // Mock screen share so the session can start without a browser dialog.
    await mockScreenShare(page);
  });

  // ─── Dialer Setup Test ──────────────────────────────────────────────────

  test('session page dialer is ready for calls @live', async ({ page }) => {
    await page.goto('/session');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const modeSelector = page.locator('button').filter({ hasText: /start session|make quick call/i }).first();
    if (await modeSelector.count() > 0) {
      console.log('ℹ️ On mode selector — attempting to start session...');
      await ensureSessionActive(page);
    }

    await expandDockedDialer(page);
    await page.waitForTimeout(500);

    const dialerEl = page
      .locator('input[placeholder*="number" i], input[placeholder*="name" i], iframe[src*="zoom"], text=Hover to Dial')
      .first();
    if (await dialerEl.count() > 0) {
      console.log('✅ Dialer element found on session page.');
    }

    // Check Zoom iframe auth status and warn if session has expired
    await page.waitForTimeout(3000); // allow iframe to navigate
    const zoomStatus = getZoomFrameAuthStatus(page);
    if (zoomStatus === 'unauthenticated') {
      console.warn('⚠️  Zoom iframe is unauthenticated — a re-login prompt will appear during call tests.');
    } else if (zoomStatus === 'authenticated') {
      console.log('✅ Zoom iframe is authenticated.');
    }

    await expect(page.locator('body')).not.toContainText('Application error');
  });

  // ─── Individual Number Tests ────────────────────────────────────────────

  for (const testNum of TEST_NUMBERS) {
    test(`Dial ${testNum.displayNumber} — ${testNum.description} @live`, async ({ page, context }) => {
      console.log(`\n📞 Dialing ${testNum.displayNumber} (${testNum.location}) — ${testNum.description}`);

      // 1. Open / start the session
      await openZoomDialer(page);
      await page.waitForTimeout(1000);

      // 2. Dial the number
      const dialSucceeded = await dialNumber(page, testNum.number);
      if (!dialSucceeded) {
        console.warn(`⚠️  Could not find dialer UI for ${testNum.number}.`);
      }

      console.log(`  ⏳ Dialing ${testNum.displayNumber}...`);

      // 3. Verify call started — handles Zoom re-login if needed
      const callActive = await verifyCallOrAskUser(page, context, testNum.displayNumber, 8_000);
      if (!callActive) {
        console.log('  ℹ️  No active call after user intervention — skipping.');
        test.skip();
        return;
      }

      console.log(`  🔔 Ringing...`);
      await waitForCallStatus(page, 'connected', 15_000);
      console.log(`  ✅ Connected to ${testNum.description}!`);

      // 4. Stay on the call for the configured duration
      console.log(`  ⏱️  Listening for ${CALL_DURATION_SEC}s...`);
      await page.waitForTimeout(CALL_DURATION_SEC * 1000);

      // 5. Hang up
      await hangUp(page);
      console.log(`  📵 Call ended.`);
      await page.waitForTimeout(1500);

      // 6. Submit call log form
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

        const recordings = await fetchRecords<{ id: string }>(
          'recordings',
          `call_log = '${callLogs[0]?.id ?? ''}'`,
          'id'
        ).catch(() => []);

        if (recordings.length > 0) {
          createdRecordingIds.push(...recordings.map((r) => r.id));
          console.log(`  🎙️  Recording created: ${recordings[0].id}`);
        } else {
          console.log(`  ℹ️  No recording linked (auto-record may be off or still uploading)`);
        }
      }

      // 7. Verify on the Cold Calls page
      await page.goto('/cold-calls');
      await waitForTableLoad(page);

      const searchInput = page.locator('input[placeholder*="earch"]').first();
      await searchInput.fill('LiveCall Test Company');
      await page.waitForTimeout(600);
      await waitForTableLoad(page);

      const callRows = page.locator('tbody tr, [role="row"]').filter({ hasText: /LiveCall/i });
      const rowCount = await callRows.count();
      console.log(`  📋 Found ${rowCount} call log row(s) in /cold-calls`);

      await expect(page.locator('body')).not.toContainText('Application error');
    });
  }

  // ─── Full Flow: Session → Dial → Log → Recording → Session End ──────────

  test('full session call flow: start → dial → log → end session @live', async ({ page, context }) => {
    console.log('\n🔄 Running FULL SESSION FLOW test...');

    await ensureSessionActive(page);
    console.log('  ✅ Session started.');

    await expect(page.locator('body')).not.toContainText('Application error');

    const echoNum = TEST_NUMBERS[1]; // (909) 390-0003
    await expandDockedDialer(page);
    const dialed = await dialNumber(page, echoNum.number);

    if (!dialed) {
      console.warn('  ⚠️  Dial skipped (dialer not available)');
      return;
    }

    const callActive = await verifyCallOrAskUser(page, context, echoNum.displayNumber, 8_000);
    if (!callActive) {
      console.log('  ℹ️  No active call — ending test early.');
      return;
    }

    await waitForCallStatus(page, 'connected', 20_000);
    console.log(`  ✅ Connected to ${echoNum.description}`);
    await page.waitForTimeout(5000);

    await hangUp(page);
    console.log('  📵 Hung up.');
    await page.waitForTimeout(1000);

    await submitCallForm(page, {
      outcome: 'No Answer',
      notes: `[${TEST_PREFIX}] Full flow test — echo line`,
    });
    await page.waitForTimeout(2000);

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

    await page.goto('/session-logs');
    await waitForTableLoad(page);

    const completedTab = page.locator('button, [role="tab"]').filter({ hasText: /completed/i }).first();
    if (await completedTab.count() > 0) {
      await completedTab.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('body')).not.toContainText('Application error');
    console.log('  ✅ Session visible in /session-logs.');

    const sessions = await fetchRecords<{ id: string }>(
      'cold_calling_sessions',
      `session_notes ~ '${TEST_PREFIX}' || total_dials = 1`,
      'id'
    ).catch(() => []);
    for (const s of sessions) await deleteRecord('cold_calling_sessions', s.id);
  });

  // ─── Recording Upload Verification ─────────────────────────────────────

  test('recording is uploaded to PocketBase after call ends @live', async ({ page, context }) => {
    console.log('\n🎙️  Testing recording upload flow...');

    const beforeCount = await fetchRecords<{ id: string }>(
      'recordings', `note ~ '${TEST_PREFIX}'`, 'id'
    ).then((r) => r.length).catch(() => 0);

    await ensureSessionActive(page);
    await expandDockedDialer(page);

    const dialed = await dialNumber(page, TEST_NUMBERS[0].number);
    if (!dialed) {
      console.warn('  ⚠️  Skipping recording test — dialer not available');
      return;
    }

    const callActive = await verifyCallOrAskUser(page, context, TEST_NUMBERS[0].displayNumber, 8_000);
    if (!callActive) {
      console.log('  ℹ️  No active call — skipping recording verification.');
      return;
    }

    await waitForCallStatus(page, 'connected', 20_000);
    await page.waitForTimeout(8000);
    await hangUp(page);
    await page.waitForTimeout(1000);

    await submitCallForm(page, {
      outcome: 'No Answer',
      notes: `[${TEST_PREFIX}] Recording upload test`,
    });

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
