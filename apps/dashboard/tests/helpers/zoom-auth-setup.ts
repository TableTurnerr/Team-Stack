/**
 * zoom-auth-setup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Playwright setup step that guarantees the Zoom web phone dialer is
 * authenticated before any live call tests run.
 *
 * WHAT IT DOES
 * ────────────
 *  1. If tests/.auth/zoom.json already exists, loads those cookies into a
 *     headed Chromium window and verifies they are still valid by navigating
 *     to the Zoom embedded phone URL.
 *  2. If the dialer loads successfully → saves a fresh copy of the state and
 *     exits immediately (no user interaction needed).
 *  3. If the cookies are expired / missing → keeps the window open, shows a
 *     banner with step-by-step login instructions, and waits for the user to
 *     complete login (up to 10 minutes).
 *  4. Once the dialer is detected → saves the new storage state to zoom.json.
 *
 * PERSISTENCE
 * ───────────
 *  The cookies are stored in  tests/.auth/zoom.json  (gitignored).
 *  On the next run the saved cookies are re-validated automatically; the
 *  user only needs to interact again if the Zoom session has expired.
 *
 * WHEN IT RUNS
 * ────────────
 *  This file is the testMatch for the  zoom-setup  Playwright project (see
 *  playwright.config.ts).  That project is only included when
 *  TEST_LIVE_CALLS=true, so it is a no-op for normal test runs.
 *
 * HOW TO RUN MANUALLY
 * ───────────────────
 *  TEST_LIVE_CALLS=true pnpm exec playwright test tests/helpers/zoom-auth-setup.ts \
 *    --project=zoom-setup --headed
 */

import { test, chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ZOOM_AUTH_FILE } from './zoom-auth-constants';

// re-export so existing callers don't need to change their import paths
export { ZOOM_AUTH_FILE };

// ─── Paths & constants ────────────────────────────────────────────────────────

const ZOOM_EMBED_URL =
  'https://applications.zoom.us/integration/phone/embeddablephone/home';

/** Selectors that are present in the authenticated Zoom phone dialer. */
const DIALER_SELECTORS = [
  '[class*="dial-pad"]',
  '[class*="dialPad"]',
  '[class*="dialer"]',
  'button[aria-label*="dial" i]',
  'input[placeholder*="Search"]',
  'input[placeholder*="Enter"]',
  '[data-testid*="dial"]',
  // Zoom web phone specific:
  '.zm-btn--phone',
  '[class*="phone-panel"]',
  '[class*="phonePanel"]',
].join(', ');

/** Selectors that indicate a login / unauthenticated page. */
const LOGIN_SELECTORS = [
  'input[type="password"]',
  'form[action*="signin"]',
  'form[action*="login"]',
  '[id*="login"]',
  '[class*="signin"]',
].join(', ');

/** How long (ms) the user has to complete login before the setup times out. */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** How long (ms) to wait for the dialer to appear after login. */
const DIALER_LOAD_TIMEOUT_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if zoom.json exists and contains non-expired Zoom session cookies.
 * This is a fast, browser-free pre-check to avoid opening a window
 * unnecessarily.
 */
function zoomCookiesLookValid(): boolean {
  if (!fs.existsSync(ZOOM_AUTH_FILE)) return false;

  try {
    const state = JSON.parse(fs.readFileSync(ZOOM_AUTH_FILE, 'utf-8'));
    const cookies: Array<{ name: string; domain: string; expires: number }> =
      state.cookies ?? [];

    const nowSec = Date.now() / 1000;
    const zoomCookies = cookies.filter(
      (c) => c.domain.includes('zoom.us') || c.domain.includes('applications.zoom.us')
    );

    if (zoomCookies.length === 0) return false;

    // Consider valid if at least one known Zoom session cookie is not expired.
    // expires === -1 means "session cookie" (no expiry set), which browsers
    // keep until closed — treat as valid for this check.
    const sessionCookieNames = [
      'zm_aid', '_zm_ssid', 'zm_haid', 'cred', 'zpk',
      '_zm_csp_script_nonce', 'zma',
    ];
    return zoomCookies.some(
      (c) =>
        (c.expires === -1 || c.expires > nowSec) &&
        sessionCookieNames.some((n) => c.name.includes(n))
    );
  } catch {
    return false;
  }
}

/**
 * Inject a visible instruction banner into the page.
 */
async function showLoginBanner(page: import('@playwright/test').Page) {
  await page.evaluate((url) => {
    const existing = document.getElementById('zoom-setup-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'zoom-setup-banner';
    banner.style.cssText = [
      'position:fixed;top:0;left:0;right:0;z-index:2147483647',
      'background:#0f3460;color:#eee;padding:20px 28px',
      'font-family:system-ui,sans-serif;font-size:14px;line-height:1.6',
      'border-bottom:4px solid #e94560;box-shadow:0 4px 24px rgba(0,0,0,.6)',
    ].join(';');

    banner.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:24px;max-width:900px;margin:0 auto">
        <div style="font-size:36px;flex-shrink:0">🔐</div>
        <div style="flex:1">
          <div style="color:#e94560;font-size:18px;font-weight:700;margin-bottom:8px">
            Zoom Web Phone Login Required
          </div>
          <p style="margin:0 0 12px;opacity:.9">
            The Zoom embedded phone needs to be authenticated so tests can place real calls.
            <strong>Please log in below.</strong> After you sign in successfully the dialer will
            appear and this window will close automatically — no further action needed.
          </p>
          <ol style="margin:0;padding-left:20px;opacity:.85">
            <li>If you see a Zoom login page below: sign in with your Zoom account.</li>
            <li>Complete any 2FA / SSO steps if prompted.</li>
            <li>Once the phone dialer appears, this setup will finish automatically.</li>
          </ol>
          <p style="margin:10px 0 0;font-size:12px;opacity:.6">
            Auth state is saved to <code>tests/.auth/zoom.json</code> and reused on future runs.
            This prompt only appears when the session has expired.
          </p>
        </div>
      </div>
    `;

    document.body.prepend(banner);
    console.log('[Zoom Auth Setup] Login banner injected.');
  }, ZOOM_EMBED_URL);
}

// ─── Main setup test ──────────────────────────────────────────────────────────

test('zoom-auth: ensure Zoom web phone dialer is authenticated', async (
  { browser },
  testInfo
) => {
  // Only run when live call tests are enabled
  if (process.env.TEST_LIVE_CALLS !== 'true') {
    testInfo.skip(true, 'Zoom auth setup skipped — TEST_LIVE_CALLS is not "true"');
    return;
  }

  // Increase timeout for this setup (user may need several minutes to log in)
  testInfo.setTimeout(LOGIN_TIMEOUT_MS + 60_000);

  // ── Step 1: Quick cookie validity check ────────────────────────────────────
  const cookiesLookOk = zoomCookiesLookValid();
  console.log(
    cookiesLookOk
      ? '\n🔑 zoom.json found with seemingly valid cookies — will verify with browser...'
      : '\n🔑 No valid Zoom cookies found — will prompt for login...'
  );

  // Ensure the .auth directory exists
  const authDir = path.dirname(ZOOM_AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  // ── Step 2: Launch a headed Chromium window ───────────────────────────────
  // We always open headed so the user can see and interact if needed.
  // Using `chromium.launch` directly lets us force headless:false regardless
  // of the project's default setting.
  const headedBrowser = await chromium.launch({
    headless: false,
    channel: 'chrome', // Prefer system Chrome for Zoom compatibility
    args: ['--start-maximized'],
  });

  const context = await headedBrowser.newContext({
    viewport: null, // Use maximized window size
    // Pre-load any existing Zoom cookies so returning users skip login
    storageState: fs.existsSync(ZOOM_AUTH_FILE) ? ZOOM_AUTH_FILE : undefined,
  });

  const page = await context.newPage();

  try {
    // ── Step 3: Navigate to Zoom embedded phone ─────────────────────────────
    console.log(`\n🌐 Navigating to ${ZOOM_EMBED_URL} ...`);
    await page.goto(ZOOM_EMBED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000); // Let any JS redirects settle

    // ── Step 4: Check current state ─────────────────────────────────────────
    const pageUrl = page.url();
    console.log(`   Current URL: ${pageUrl}`);

    const isOnLoginPage =
      pageUrl.includes('/signin') ||
      pageUrl.includes('/login') ||
      pageUrl.includes('zoom.us/oauth') ||
      (await page.locator(LOGIN_SELECTORS).count()) > 0;

    if (!isOnLoginPage) {
      // Try to detect the dialer with a short timeout
      const dialerFound = await page
        .waitForSelector(DIALER_SELECTORS, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);

      if (dialerFound) {
        console.log('\n✅ Zoom phone dialer is authenticated and ready!');
        await context.storageState({ path: ZOOM_AUTH_FILE });
        console.log(`   Auth state saved → ${ZOOM_AUTH_FILE}\n`);
        return; // All good — exit early
      }

      // Page is at Zoom but dialer didn't load clearly — could be loading…
      // Show the banner and wait anyway (might need a different interaction)
      console.log('   Dialer not immediately detected — waiting longer...');
    }

    // ── Step 5: Show login instructions and wait ─────────────────────────────
    console.log('\n⚠️  Login required — showing instructions in browser window...');
    console.log('   Please complete the Zoom login in the browser window that opened.');
    console.log(`   You have ${Math.round(LOGIN_TIMEOUT_MS / 60_000)} minutes.\n`);

    await showLoginBanner(page);

    // Wait until the dialer appears (meaning the user logged in successfully)
    await page.waitForSelector(DIALER_SELECTORS, {
      timeout: LOGIN_TIMEOUT_MS,
    }).catch(async () => {
      // If selector doesn't match, also watch the URL — some Zoom flows
      // navigate back to the embed URL after login without the exact selectors
      await page.waitForFunction(
        () =>
          window.location.href.includes('applications.zoom.us') &&
          !window.location.href.includes('/signin') &&
          !window.location.href.includes('/login'),
        { timeout: LOGIN_TIMEOUT_MS },
      );
      // Give the dialer JS a moment to render
      await page.waitForTimeout(3_000);
    });

    console.log('\n✅ Zoom login detected — saving auth state...');

    // ── Step 6: Save the storage state ──────────────────────────────────────
    await context.storageState({ path: ZOOM_AUTH_FILE });
    console.log(`   Auth state saved → ${ZOOM_AUTH_FILE}`);
    console.log('   This will be reused on future test runs until the session expires.\n');

  } finally {
    await page.waitForTimeout(1_000); // Brief pause so user sees completion
    await headedBrowser.close();
  }
});
