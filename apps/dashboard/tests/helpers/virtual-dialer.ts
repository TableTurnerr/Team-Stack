/**
 * virtual-dialer.ts
 * Playwright helpers for the Virtual Dialer test mode.
 *
 * The virtual dialer replaces Zoom telephony during test runs. It works by
 * setting `window.__TEST_VIRTUAL_DIALER = true` before the page loads, which
 * tells ZoomPhoneProvider to:
 *   1. Bypass the Zoom iframe origin check on postMessage events
 *   2. Auto-mark the iframe as ready (no real iframe needed)
 *   3. Dispatch synthetic ringing/connected/ended events instead of sending
 *      postMessages to a real Zoom iframe
 *
 * All state-machine logic (direction detection, auto-hangup, timing, retries)
 * runs exactly as in production — only the telephony boundary is replaced.
 */

import { type Page } from '@playwright/test';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VirtualDialerConfig {
    /** ms before ringing event fires after dial (default 50) */
    ringDelay?: number;
    /** ms before connected event fires after dial (default 150) */
    connectDelay?: number;
    /** ms before ended event fires on failure (default 200) */
    failDelay?: number;
    /** Whether the call connects after ringing (default true) */
    shouldConnect?: boolean;
    /** Simulate immediate connection failure (default false) */
    shouldFail?: boolean;
    /** ms after connect to auto-end the call (0 = manual end, default 0) */
    autoEndDelay?: number;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Inject virtual dialer mode and screen-share mock before the page loads.
 * Call BEFORE page.goto().
 */
export async function setupVirtualDialer(page: Page, config?: VirtualDialerConfig) {
    // Set virtual dialer flag + config before any page scripts run
    await page.addInitScript((cfg) => {
        (window as any).__TEST_VIRTUAL_DIALER = true;
        (window as any).__TEST_DIALER_CONFIG = cfg;
    }, config || {});

    // Mock getDisplayMedia / getUserMedia so recording sessions start without
    // a real browser screen-share dialog (produces silent audio tracks).
    await page.addInitScript(() => {
        const makeSilentStream = (): MediaStream => {
            try {
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                osc.frequency.value = 0;
                const dest = ctx.createMediaStreamDestination();
                osc.connect(dest);
                osc.start();
                (window as any).__testAudioCtxs = (window as any).__testAudioCtxs ?? [];
                (window as any).__testAudioCtxs.push(ctx);
                return dest.stream;
            } catch {
                return new MediaStream();
            }
        };
        navigator.mediaDevices.getDisplayMedia = () => Promise.resolve(makeSilentStream());
        navigator.mediaDevices.getUserMedia = () => Promise.resolve(makeSilentStream());
    });

    // Block all requests to Zoom servers — the iframe may still render in the
    // DOM but it won't make any external requests.
    await page.route('**/applications.zoom.us/**', (route) => route.abort());
    await page.route('**/zoom.us/**', (route) => route.abort());
}

// ─── Runtime control ──────────────────────────────────────────────────────────

/** Update the virtual dialer config mid-test (affects future dials). */
export async function updateDialerConfig(page: Page, config: Partial<VirtualDialerConfig>) {
    await page.evaluate((cfg) => {
        (window as any).__TEST_DIALER_CONFIG = {
            ...(window as any).__TEST_DIALER_CONFIG,
            ...cfg,
        };
    }, config);
}

/**
 * Simulate an incoming call from a given phone number.
 * Dispatches a ringing event with caller data, then optionally connects.
 */
export async function simulateIncomingCall(
    page: Page,
    callerNumber: string,
    opts?: { autoConnect?: boolean; connectDelay?: number; autoEndDelay?: number },
) {
    await page.evaluate(
        ({ number, options }) => {
            const connectDelay = options?.connectDelay ?? 200;
            // Emit ringing (inbound direction — no outboundIntent set)
            window.postMessage(
                {
                    type: 'ringing',
                    data: {
                        caller: { phoneNumber: number },
                        from: number,
                        phoneNumber: number,
                    },
                },
                '*',
            );
            // Auto-connect
            if (options?.autoConnect !== false) {
                setTimeout(() => {
                    window.postMessage(
                        { type: 'connected', data: { phoneNumber: number } },
                        '*',
                    );
                }, connectDelay);
            }
            // Auto-end
            if (options?.autoEndDelay) {
                setTimeout(() => {
                    window.postMessage({ type: 'ended', data: {} }, '*');
                }, connectDelay + options.autoEndDelay);
            }
        },
        { number: callerNumber, options: opts },
    );
}

/** Manually dispatch a 'connected' event. */
export async function simulateCallConnect(page: Page, number?: string) {
    await page.evaluate((num) => {
        window.postMessage(
            { type: 'connected', data: num ? { targetNumber: num } : {} },
            '*',
        );
    }, number ?? null);
}

/** Manually dispatch an 'ended' event. */
export async function simulateCallEnd(page: Page) {
    await page.evaluate(() => {
        window.postMessage({ type: 'ended', data: {} }, '*');
    });
}

// ─── Wait helpers ─────────────────────────────────────────────────────────────

/**
 * Wait until the page's body text indicates a specific call state.
 * Accepts: 'ringing', 'connected', 'idle', 'ended'.
 */
export async function waitForCallState(
    page: Page,
    state: 'ringing' | 'connected' | 'idle' | 'ended',
    timeoutMs = 10_000,
) {
    await page.waitForFunction(
        (s) => {
            const body = document.body.innerText.toLowerCase();
            switch (s) {
                case 'ringing':
                    return body.includes('ringing');
                case 'connected':
                    return (
                        body.includes('on call') ||
                        body.includes('in call') ||
                        body.includes('connected')
                    );
                case 'idle':
                case 'ended':
                    return (
                        !body.includes('ringing') &&
                        !body.includes('on call') &&
                        !body.includes('in call')
                    );
                default:
                    return false;
            }
        },
        state,
        { timeout: timeoutMs },
    );
}

/** Wait for the call form to appear (form becomes visible after call ends). */
export async function waitForCallForm(page: Page, timeoutMs = 10_000) {
    // The form shows outcome pills and a Save Call button
    await page.waitForFunction(
        () => {
            const body = document.body.innerText;
            return (
                body.includes('No Answer') ||
                body.includes('Interested') ||
                body.includes('Save Call')
            );
        },
        { timeout: timeoutMs },
    );
}

// ─── Session helpers ──────────────────────────────────────────────────────────

/**
 * Navigate to /session and start a new call session.
 * Handles the SessionModeSelector → Connect Audio → Session Active flow.
 */
export async function startVirtualSession(page: Page) {
    await page.goto('/session');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // If already on the full session page, skip setup
    const h1 = page.locator('h1').filter({ hasText: /call session/i });
    if ((await h1.count()) > 0) {
        return;
    }

    // Click "Start Session" on the mode selector (if shown)
    const startBtn = page
        .locator('button')
        .filter({ hasText: /^start session$/i })
        .first();
    if ((await startBtn.count()) > 0) {
        await startBtn.click();
        await page.waitForTimeout(800);
    }

    // Handle "Connect Audio" screen
    const connectBtn = page
        .locator('button')
        .filter({ hasText: /connect audio/i })
        .first();
    if ((await connectBtn.count()) > 0) {
        // Check the Zoom checkbox (if present and unchecked)
        const checkbox = page.locator('input[type="checkbox"]').first();
        if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) {
            await checkbox.click();
            await page.waitForTimeout(200);
        }

        const btn = page
            .locator('button')
            .filter({ hasText: /connect audio/i })
            .first();
        if ((await btn.count()) > 0 && !(await btn.isDisabled())) {
            await btn.click();
            await page.waitForTimeout(2000);
        }
    }

    // Wait for the session page to be fully active
    await page.waitForFunction(
        () =>
            document.body.innerText.includes('Call Session') &&
            !document.body.innerText.includes('Start Session') &&
            !document.body.innerText.includes('Connect Audio'),
        { timeout: 15_000 },
    );
}

/** End the current session via the End Session button. */
export async function endVirtualSession(page: Page) {
    const endBtn = page
        .locator('button')
        .filter({ hasText: /end session/i })
        .first();
    if ((await endBtn.count()) > 0) {
        await endBtn.click();
        await page.waitForTimeout(400);
        // Confirm if a confirmation dialog appears
        const confirmBtn = page
            .locator('button')
            .filter({ hasText: /confirm|yes|^end$/i })
            .first();
        if ((await confirmBtn.count()) > 0) {
            await confirmBtn.click();
            await page.waitForTimeout(1500);
        }
    }
}

// ─── Dialer UI helpers ────────────────────────────────────────────────────────

/** Expand the docked dialer by hovering its header bar. */
export async function expandDialer(page: Page) {
    const hoverTarget = page.locator('text=Hover to Dial').first();
    if (await hoverTarget.isVisible().catch(() => false)) {
        await hoverTarget.hover({ force: true });
        await page.waitForTimeout(500);
        return;
    }
    const dialerText = page.locator('text=Dialer').first();
    if (await dialerText.isVisible().catch(() => false)) {
        await dialerText.hover({ force: true });
        await page.waitForTimeout(500);
    }
}

/**
 * Dial a phone number using the custom dialer overlay UI.
 * Expands the dialer → types the number → clicks Dial.
 */
export async function dialInUI(page: Page, number: string) {
    await expandDialer(page);
    await page.waitForTimeout(300);

    const input = page
        .locator(
            'input[placeholder*="number" i], input[placeholder*="name" i], input[type="tel"]',
        )
        .first();

    if ((await input.count()) > 0 && (await input.isVisible())) {
        await input.clear();
        await input.fill(number);
        await page.waitForTimeout(200);

        const dialBtn = page.locator('button[title="Dial"]').first();
        if ((await dialBtn.count()) > 0) {
            await dialBtn.click();
            return;
        }
        // Fallback: press Enter
        await input.press('Enter');
    }
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

/**
 * Fill and submit the call log form after a call ends.
 * Returns true if the form was submitted successfully.
 */
export async function fillAndSubmitCallForm(
    page: Page,
    opts: {
        companySearch?: string;
        outcome: string;
        notes?: string;
        ownerReached?: boolean;
        pitchCompleted?: boolean;
        appointmentSet?: boolean;
    },
): Promise<boolean> {
    await page.waitForTimeout(500);

    // Company search
    if (opts.companySearch) {
        const companyInput = page
            .locator(
                'input[placeholder*="company" i], input[placeholder*="search" i]',
            )
            .first();
        if (
            (await companyInput.count()) > 0 &&
            (await companyInput.isVisible())
        ) {
            await companyInput.fill(opts.companySearch);
            await page.waitForTimeout(800);
            // Click the first suggestion
            const suggestion = page
                .locator('[role="option"], [role="listbox"] > *')
                .first();
            if ((await suggestion.count()) > 0) {
                await suggestion.click();
                await page.waitForTimeout(300);
            }
        }
    }

    // Select outcome pill (button matching the outcome text)
    const outcomeBtn = page
        .locator('button')
        .filter({ hasText: new RegExp(`^${opts.outcome}$`, 'i') })
        .first();
    if ((await outcomeBtn.count()) > 0) {
        await outcomeBtn.click();
        await page.waitForTimeout(200);
    }

    // Performance flags
    if (opts.ownerReached) {
        const ownerBtn = page.locator('button, label').filter({ hasText: /owner reached/i }).first();
        if ((await ownerBtn.count()) > 0) await ownerBtn.click();
    }
    if (opts.pitchCompleted) {
        const pitchBtn = page.locator('button, label').filter({ hasText: /pitch completed/i }).first();
        if ((await pitchBtn.count()) > 0) await pitchBtn.click();
    }
    if (opts.appointmentSet) {
        const apptBtn = page.locator('button, label').filter({ hasText: /appointment set/i }).first();
        if ((await apptBtn.count()) > 0) await apptBtn.click();
    }

    // Notes
    if (opts.notes) {
        const notesField = page.locator('textarea').first();
        if ((await notesField.count()) > 0) {
            await notesField.fill(opts.notes);
            await page.waitForTimeout(200);
        }
    }

    // Submit
    const submitBtn = page
        .locator('button')
        .filter({ hasText: /save call|submit|log call/i })
        .first();
    if ((await submitBtn.count()) > 0 && !(await submitBtn.isDisabled())) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
        return true;
    }
    return false;
}

// ─── Full call cycle helper ───────────────────────────────────────────────────

/**
 * Execute a complete call cycle: dial → wait for connect → wait for end → submit form.
 * Uses autoEndDelay to automatically end the call after a short duration.
 * Returns true if the form was submitted.
 */
export async function executeCallCycle(
    page: Page,
    opts: {
        phoneNumber: string;
        companySearch?: string;
        outcome: string;
        notes?: string;
        callDurationMs?: number;
    },
): Promise<boolean> {
    // Configure auto-end for this call
    await updateDialerConfig(page, {
        autoEndDelay: opts.callDurationMs ?? 300,
    });

    // Dial the number
    await dialInUI(page, opts.phoneNumber);
    await page.waitForTimeout(500);

    // Wait for call to end (autoEndDelay handles this)
    await waitForCallState(page, 'idle', 15_000);

    // Wait for call form to appear
    await waitForCallForm(page, 10_000);

    // Fill and submit the form
    const submitted = await fillAndSubmitCallForm(page, {
        companySearch: opts.companySearch,
        outcome: opts.outcome,
        notes: opts.notes,
    });

    // Reset autoEndDelay so future dials don't auto-end
    await updateDialerConfig(page, { autoEndDelay: 0 });

    return submitted;
}
