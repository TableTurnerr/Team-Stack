/**
 * 14-local-agent.spec.ts
 * Focused tests for the Local CRM Agent integration.
 *
 * Tests two critical behaviors:
 *   1. Agent connection gates session start (Connect Audio button requires agent)
 *   2. Zoom ended events are processed instantly (no grace period delay)
 */

import { test, expect } from '@playwright/test';
import { TEST_PREFIX } from './helpers/test-data';
import {
    cleanupByPrefix,
    fetchRecords,
    deleteRecord,
} from './helpers/pb-client';
import {
    setupVirtualDialer,
    startVirtualSession,
    endVirtualSession,
    dialInUI,
    fillAndSubmitCallForm,
    waitForCallState,
    waitForCallForm,
    updateDialerConfig,
    simulateCallEnd,
} from './helpers/virtual-dialer';
import {
    setupMockAgent,
    sendAgentCallState,
} from './helpers/mock-agent';

const AGENT_PREFIX = `${TEST_PREFIX}AGT_`;

test.describe('Local Agent — Integration Tests', () => {
    test.setTimeout(45_000);

    let createdCallLogIds: string[] = [];

    test.beforeEach(async ({ page }) => {
        await setupVirtualDialer(page, { ringDelay: 50, connectDelay: 150 });
        await setupMockAgent(page);
    });

    test.afterEach(async ({ page }) => {
        try { await endVirtualSession(page); } catch { /* ok */ }
        const active = await fetchRecords<{ id: string }>('cold_calling_sessions', `status = 'active'`, 'id').catch(() => []);
        for (const s of active) await deleteRecord('cold_calling_sessions', s.id).catch(() => {});
    });

    test.afterAll(async () => {
        for (const id of createdCallLogIds) await deleteRecord('call_logs', id);
        await cleanupByPrefix('call_logs', 'post_call_notes', AGENT_PREFIX);
        await cleanupByPrefix('cold_calling_sessions', 'session_notes', AGENT_PREFIX);
    });

    // ── 1. Agent connection gates session start ───────────────────────────

    test('agent connected status shows on session setup and enables start', async ({ page }) => {
        await page.goto('/session');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        const startBtn = page.locator('button').filter({ hasText: /^start session$/i }).first();
        if ((await startBtn.count()) > 0) {
            await startBtn.click();
            await page.waitForTimeout(1000);
        }

        // Agent card should show connected (mock fires onopen after 50ms)
        await expect(page.locator('text=Agent connected and running')).toBeVisible({ timeout: 8000 });

        // Zoom is auto-confirmed in virtual dialer mode, so Connect Audio should be enabled
        const connectBtn = page.locator('button').filter({ hasText: /connect audio/i }).first();
        if ((await connectBtn.count()) > 0) {
            await page.waitForFunction(() => {
                const btn = [...document.querySelectorAll('button')].find(b => /connect audio/i.test(b.textContent || ''));
                return btn && !btn.disabled;
            }, { timeout: 10_000 });
            await expect(connectBtn).toBeEnabled();
        }
    });

    // ── 2. Instant call-end detection ─────────────────────────────────────

    test('Zoom ended event is processed instantly even when agent says call is active', async ({ page }) => {
        await startVirtualSession(page);
        await page.waitForTimeout(1000);

        await updateDialerConfig(page, { autoEndDelay: 0 });

        // Dial — call connects via virtual dialer
        await dialInUI(page, '5552001001');
        await waitForCallState(page, 'connected', 10_000);

        // Agent reports call connected (WASAPI ground truth)
        await sendAgentCallState(page, {
            state: 'connected',
            phoneNumber: '5552001001',
            direction: 'outbound',
            duration: 3,
            confidence: 'high',
        });

        // Wait for React to propagate agent state to refs
        await page.waitForTimeout(1000);

        // Fire Zoom "ended" event — should be processed immediately (no grace period)
        await simulateCallEnd(page);

        // The call form should appear quickly (ended→idle is now 500ms)
        await waitForCallForm(page, 5_000);
        await fillAndSubmitCallForm(page, {
            outcome: 'No Answer',
            notes: `${AGENT_PREFIX}instant end test`,
        });

        const logs = await fetchRecords<{ id: string }>('call_logs', `post_call_notes ~ '${AGENT_PREFIX}'`, 'id').catch(() => []);
        createdCallLogIds.push(...logs.map(l => l.id));
    });
});
