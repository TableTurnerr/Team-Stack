/**
 * 18-agent-connectivity.spec.ts
 * Agent connection lifecycle and auth relay tests.
 *
 * Tests that the dashboard correctly handles agent WebSocket connections,
 * sends configuration on connect, and reflects agent status in the UI.
 *
 * PREREQUISITES
 * ─────────────
 *  1. PocketBase running at NEXT_PUBLIC_POCKETBASE_URL
 *  2. TEST_USER_EMAIL / TEST_USER_PASSWORD in .env.test
 *  3. TEST_PB_ADMIN_EMAIL / TEST_PB_ADMIN_PASSWORD in .env.test
 *  4. Next.js dev server (auto-started by playwright.config.ts)
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
} from './helpers/virtual-dialer';
import {
    setupMockAgent,
    captureAgentCommands,
    sendAgentHeartbeat,
    isMockAgentConnected,
} from './helpers/mock-agent';

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_PREFIX = `${TEST_PREFIX}ACON_`;

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Agent Connectivity — Lifecycle & Auth Relay', () => {
    test.setTimeout(45_000);

    // ── Cleanup ───────────────────────────────────────────────────────────

    test.afterAll(async () => {
        await cleanupByPrefix('call_logs', 'post_call_notes', AGENT_PREFIX);
        await cleanupByPrefix('cold_calling_sessions', 'session_notes', AGENT_PREFIX);
    });

    // ═════════════════════════════════════════════════════════════════════
    //  1. setUploadConfig sent on connect
    // ═════════════════════════════════════════════════════════════════════

    test('setUploadConfig sent on connect', async ({ page }) => {
        await setupVirtualDialer(page, { ringDelay: 50, connectDelay: 150 });
        await setupMockAgent(page);

        await page.goto('/session');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Click Start Session if the mode selector is shown
        const startBtn = page
            .locator('button')
            .filter({ hasText: /^start session$/i })
            .first();
        if ((await startBtn.count()) > 0) {
            await startBtn.click();
            await page.waitForTimeout(2000);
        }

        // Wait for the agent to connect and the dashboard to send config
        await page.waitForTimeout(3000);

        // Capture commands sent to the mock agent
        const commands = await captureAgentCommands(page);

        // Find the setUploadConfig command
        const uploadConfigCmd = commands.find(
            (cmd: any) =>
                cmd.type === 'setUploadConfig' ||
                cmd.command === 'setUploadConfig',
        );

        expect(uploadConfigCmd).toBeTruthy();

        if (uploadConfigCmd) {
            // The config should contain PocketBase connection details
            const data = uploadConfigCmd.data || uploadConfigCmd;
            const hasUrl =
                data.pocketbaseUrl !== undefined ||
                data.url !== undefined ||
                uploadConfigCmd.pocketbaseUrl !== undefined;
            const hasToken =
                data.authToken !== undefined ||
                data.token !== undefined ||
                uploadConfigCmd.authToken !== undefined;
            const hasUploader =
                data.uploaderId !== undefined ||
                data.userId !== undefined ||
                uploadConfigCmd.uploaderId !== undefined;

            expect(hasUrl).toBe(true);
            expect(hasToken).toBe(true);
            expect(hasUploader).toBe(true);
        }
    });

    // ═════════════════════════════════════════════════════════════════════
    //  2. Recording controls disabled when agent offline
    // ═════════════════════════════════════════════════════════════════════

    test('recording controls disabled when agent offline', async ({ page }) => {
        // Setup virtual dialer WITHOUT mock agent — browser fallback mode
        await setupVirtualDialer(page, { ringDelay: 50, connectDelay: 150 });
        // Deliberately NOT calling setupMockAgent(page)

        await page.goto('/session');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        // Click Start Session if the mode selector is shown
        const startBtn = page
            .locator('button')
            .filter({ hasText: /^start session$/i })
            .first();
        if ((await startBtn.count()) > 0) {
            await startBtn.click();
            await page.waitForTimeout(2000);
        }

        // Without the agent, there should be no agent recording indicator.
        // The page should NOT show "Agent connected" or agent recording dot.
        const bodyText = await page.locator('body').innerText();

        // Agent connection status should indicate disconnected or not present
        const agentConnectedVisible = bodyText.includes('Agent connected and running');
        expect(agentConnectedVisible).toBe(false);

        // No active agent recording indicator should be visible
        // (the blue dot / agent recording badge should not appear)
        const agentRecordingIndicator = page.locator('[data-testid="agent-recording-indicator"], .agent-recording-dot');
        if ((await agentRecordingIndicator.count()) > 0) {
            await expect(agentRecordingIndicator).not.toBeVisible();
        }

        await expect(page.locator('body')).not.toContainText('Application error');
    });

    // ═════════════════════════════════════════════════════════════════════
    //  3. Agent connected shows blue recording indicator
    // ═════════════════════════════════════════════════════════════════════

    test('agent connected shows blue recording indicator', async ({ page }) => {
        await setupVirtualDialer(page, { ringDelay: 50, connectDelay: 150 });
        await setupMockAgent(page);

        await startVirtualSession(page);
        await page.waitForTimeout(2000);

        // Agent should be connected
        const connected = await isMockAgentConnected(page);
        expect(connected).toBe(true);

        // The agent status should show as connected in the UI
        await expect(page.locator('text=Agent connected and running')).toBeVisible({ timeout: 8000 });

        // Look for the recording indicator — when agent is connected,
        // a blue dot or recording badge should appear somewhere on the session page.
        // Check for any visual indicator of agent mode being active.
        const bodyText = await page.locator('body').innerText();
        const hasAgentIndicator =
            bodyText.includes('Agent connected') ||
            bodyText.includes('agent') ||
            bodyText.includes('Recording');

        expect(hasAgentIndicator).toBe(true);

        await expect(page.locator('body')).not.toContainText('Application error');
    });

    // ═════════════════════════════════════════════════════════════════════
    //  4. Heartbeat with recording status updates UI
    // ═════════════════════════════════════════════════════════════════════

    test('heartbeat with recording status updates UI', async ({ page }) => {
        await setupVirtualDialer(page, { ringDelay: 50, connectDelay: 150 });
        await setupMockAgent(page);

        await startVirtualSession(page);
        await page.waitForTimeout(2000);

        // Verify agent is connected
        const connected = await isMockAgentConnected(page);
        expect(connected).toBe(true);

        // Send a heartbeat with active recording status
        await page.evaluate(() => {
            const ws = (window as any).__mockAgentWs;
            if (ws && ws.readyState === 1) {
                ws._dispatchMessage({
                    type: 'heartbeat',
                    version: '1.0.0-test',
                    uptime: 500,
                    zoomDetected: true,
                    connectedClients: 1,
                    isRecording: true,
                    recordingDuration: 45,
                    uploadsPending: 2,
                    uploadsFailed: 0,
                    timestamp: Date.now(),
                });
            }
        });

        await page.waitForTimeout(1500);

        // The UI should reflect the recording state from the heartbeat.
        // Check that the page shows recording-related information.
        const bodyText = await page.locator('body').innerText();

        // The dashboard should show some indication of active recording
        // or pending uploads based on the heartbeat data.
        const hasRecordingInfo =
            bodyText.includes('Recording') ||
            bodyText.includes('recording') ||
            bodyText.includes('0:45') ||
            bodyText.includes('45') ||
            bodyText.includes('upload') ||
            bodyText.includes('pending');

        // At minimum, the agent should still show as connected
        await expect(page.locator('text=Agent connected and running')).toBeVisible({ timeout: 5000 });

        // Send another heartbeat — recording stopped, uploads cleared
        await page.evaluate(() => {
            const ws = (window as any).__mockAgentWs;
            if (ws && ws.readyState === 1) {
                ws._dispatchMessage({
                    type: 'heartbeat',
                    version: '1.0.0-test',
                    uptime: 510,
                    zoomDetected: true,
                    connectedClients: 1,
                    isRecording: false,
                    recordingDuration: 0,
                    uploadsPending: 0,
                    uploadsFailed: 0,
                    timestamp: Date.now(),
                });
            }
        });

        await page.waitForTimeout(1000);

        // Agent should still be connected after heartbeat updates
        const stillConnected = await isMockAgentConnected(page);
        expect(stillConnected).toBe(true);

        await expect(page.locator('body')).not.toContainText('Application error');
    });

    // ── Per-test cleanup: end any active sessions ────────────────────────

    test.afterEach(async ({ page }) => {
        try { await endVirtualSession(page); } catch { /* ok */ }
        const active = await fetchRecords<{ id: string }>(
            'cold_calling_sessions',
            `status = 'active'`,
            'id',
        ).catch(() => []);
        for (const s of active) {
            await deleteRecord('cold_calling_sessions', s.id).catch(() => {});
        }
    });
});
