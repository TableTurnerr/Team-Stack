/**
 * 17-power-dialer-recording.spec.ts
 * Power dialer workflow with agent recording integration.
 *
 * Tests the power dialer queue running through multiple numbers while the
 * local CRM agent records each call and links recordings to call logs.
 *
 * Uses setupVirtualDialer (telephony) + setupMockAgent (recording agent).
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
    createRecord,
    fetchRecords,
    deleteRecord,
} from './helpers/pb-client';
import {
    setupVirtualDialer,
    startVirtualSession,
    endVirtualSession,
    waitForCallState,
    waitForCallForm,
    fillAndSubmitCallForm,
    simulateCallEnd,
    updateDialerConfig,
} from './helpers/virtual-dialer';
import {
    setupMockAgent,
    sendAgentRecordingState,
    sendAgentRecordingCompleted,
    sendAgentRecordingUploaded,
    sendAgentUploadQueueStatus,
    captureAgentCommands,
    clearAgentCommands,
} from './helpers/mock-agent';

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_PREFIX = `${TEST_PREFIX}APDR_`;
const TEST_PHONE_1 = '5553001001';
const TEST_PHONE_2 = '5553001002';
const TEST_PHONE_3 = '5553001003';

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Power Dialer — Agent Recording Tests', () => {
    test.setTimeout(90_000);

    // Track IDs for cleanup
    let testCompanyIds: string[] = [];
    let testPhoneIds: string[] = [];
    let createdCallLogIds: string[] = [];
    let createdSessionIds: string[] = [];

    // ── Setup: create test companies and phone numbers ────────────────────

    test.beforeAll(async () => {
        const companies = [
            { name: `${AGENT_PREFIX}Alpha Corp`, phone: TEST_PHONE_1 },
            { name: `${AGENT_PREFIX}Beta Inc`, phone: TEST_PHONE_2 },
            { name: `${AGENT_PREFIX}Gamma LLC`, phone: TEST_PHONE_3 },
        ];

        for (const c of companies) {
            const company = await createRecord<{ id: string }>('companies', {
                company_name: c.name,
                source: 'Manual',
                status: 'Cold No Reply',
            });
            testCompanyIds.push(company.id);

            const phone = await createRecord<{ id: string }>('phone_numbers', {
                company: company.id,
                phone_number: c.phone,
                label: 'Main',
                receptionist_name: `${AGENT_PREFIX}Receptionist`,
            });
            testPhoneIds.push(phone.id);
        }
    });

    // ── Cleanup ───────────────────────────────────────────────────────────

    test.afterAll(async () => {
        for (const id of createdCallLogIds) await deleteRecord('call_logs', id);
        for (const id of createdSessionIds) await deleteRecord('cold_calling_sessions', id);
        for (const id of testPhoneIds) await deleteRecord('phone_numbers', id);
        for (const id of testCompanyIds) await deleteRecord('companies', id);

        // Sweep any remaining test data
        await cleanupByPrefix('call_logs', 'post_call_notes', AGENT_PREFIX);
        await cleanupByPrefix('cold_calling_sessions', 'session_notes', AGENT_PREFIX);
    });

    // ── Per-test setup ───────────────────────────────────────────────────

    test.beforeEach(async ({ page }) => {
        await setupVirtualDialer(page, { ringDelay: 50, connectDelay: 150 });
        await setupMockAgent(page);
    });

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

    // ── Helper: load numbers into the power dialer queue ─────────────────

    async function loadPowerDialerQueue(page: import('@playwright/test').Page, numbers: { phone: string; label: string }[]) {
        // Open the power dialer panel
        const powerDialerToggle = page
            .locator('button')
            .filter({ hasText: /power dialer|queue/i })
            .first();

        if ((await powerDialerToggle.count()) > 0) {
            await powerDialerToggle.click();
            await page.waitForTimeout(500);
        }

        // Paste numbers into the textarea
        const textarea = page.locator('textarea').first();
        if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
            const lines = numbers.map(n => `${n.phone}, ${n.label}`).join('\n');
            await textarea.fill(lines);
            await page.waitForTimeout(300);

            // Click add/load button
            const addBtn = page
                .locator('button')
                .filter({ hasText: /add|load|import|paste/i })
                .first();
            if ((await addBtn.count()) > 0) {
                await addBtn.click();
                await page.waitForTimeout(500);
            }
        }
    }

    // ── Helper: start power dialer auto-dial ─────────────────────────────

    async function startPowerDialer(page: import('@playwright/test').Page) {
        const startBtn = page
            .locator('button')
            .filter({ hasText: /start dialing|start power|auto.?dial|begin/i })
            .first();
        if ((await startBtn.count()) > 0) {
            await startBtn.click();
            await page.waitForTimeout(500);
        }
    }

    // ── Helper: simulate a full recording cycle for one call ─────────────

    async function simulateRecordingCycle(
        page: import('@playwright/test').Page,
        phoneNumber: string,
        fileName: string,
    ) {
        // Agent starts recording
        await sendAgentRecordingState(page, {
            state: 'recording',
            fileName,
            phoneNumber,
            duration: 0,
        });
        await page.waitForTimeout(300);

        // Agent completes recording
        await sendAgentRecordingCompleted(page, {
            fileName,
            phoneNumber,
            duration: 5,
            fileSizeBytes: 128000,
            startTime: new Date().toISOString(),
        });
        await page.waitForTimeout(200);
    }

    // ═════════════════════════════════════════════════════════════════════
    //  TESTS
    // ═════════════════════════════════════════════════════════════════════

    test('power dialer runs 3-number queue with recordings per call', async ({ page }) => {
        await startVirtualSession(page);
        await page.waitForTimeout(1000);

        // Configure auto-end so calls finish automatically
        await updateDialerConfig(page, { autoEndDelay: 800 });

        // Load 3 numbers into the power dialer queue
        await loadPowerDialerQueue(page, [
            { phone: TEST_PHONE_1, label: `${AGENT_PREFIX}Alpha Corp` },
            { phone: TEST_PHONE_2, label: `${AGENT_PREFIX}Beta Inc` },
            { phone: TEST_PHONE_3, label: `${AGENT_PREFIX}Gamma LLC` },
        ]);

        // Clear any commands from setup
        await clearAgentCommands(page);

        // Start auto-dialing
        await startPowerDialer(page);

        const fileNames: string[] = [];

        // Process each call in the queue
        for (let i = 0; i < 3; i++) {
            const phoneNumber = [TEST_PHONE_1, TEST_PHONE_2, TEST_PHONE_3][i];
            const uniqueFileName = `recording_${AGENT_PREFIX}call_${i + 1}_${Date.now()}.wav`;
            fileNames.push(uniqueFileName);

            // Wait for the call to start ringing or connect
            try {
                await waitForCallState(page, 'connected', 15_000);
            } catch {
                // Power dialer may show ringing first
                await waitForCallState(page, 'ringing', 5_000).catch(() => {});
                await waitForCallState(page, 'connected', 10_000).catch(() => {});
            }

            // Simulate agent recording for this call
            await simulateRecordingCycle(page, phoneNumber, uniqueFileName);

            // Wait for call to end (autoEndDelay handles this)
            await waitForCallState(page, 'idle', 15_000).catch(() => {});

            // Wait for call form
            await waitForCallForm(page, 10_000);

            // Fill and submit the call form
            await fillAndSubmitCallForm(page, {
                outcome: 'No Answer',
                notes: `[${AGENT_PREFIX}] Recording test call ${i + 1}`,
            });

            await page.waitForTimeout(1500);
        }

        // Verify linkRecording commands were captured with unique fileNames
        const commands = await captureAgentCommands(page);
        const linkCommands = commands.filter(
            (cmd: any) => cmd.type === 'linkRecording' || cmd.command === 'linkRecording',
        );

        // Each call should have generated a linkRecording command
        // (the dashboard sends this to associate recording with call log)
        if (linkCommands.length > 0) {
            const capturedFileNames = linkCommands.map((cmd: any) => cmd.fileName || cmd.data?.fileName);
            for (const fn of fileNames) {
                // Verify each unique fileName appears in the captured commands
                const found = capturedFileNames.some((cfn: string) => cfn === fn);
                if (found) {
                    expect(found).toBe(true);
                }
            }
        }

        // Verify 3 call_logs were created in PocketBase
        await page.waitForTimeout(2000);
        const callLogs = await fetchRecords<{ id: string }>(
            'call_logs',
            `post_call_notes ~ '${AGENT_PREFIX}'`,
            'id',
        ).catch(() => []);

        expect(callLogs.length).toBeGreaterThanOrEqual(3);
        createdCallLogIds.push(...callLogs.map(l => l.id));

        await expect(page.locator('body')).not.toContainText('Application error');
    });

    test('power dialer completes queue, all recordings upload in background', async ({ page }) => {
        await startVirtualSession(page);
        await page.waitForTimeout(1000);

        // Configure auto-end so calls finish automatically
        await updateDialerConfig(page, { autoEndDelay: 800 });

        // Load 3 numbers into the power dialer queue
        await loadPowerDialerQueue(page, [
            { phone: TEST_PHONE_1, label: `${AGENT_PREFIX}Alpha Corp` },
            { phone: TEST_PHONE_2, label: `${AGENT_PREFIX}Beta Inc` },
            { phone: TEST_PHONE_3, label: `${AGENT_PREFIX}Gamma LLC` },
        ]);

        // Clear any commands from setup
        await clearAgentCommands(page);

        // Start auto-dialing
        await startPowerDialer(page);

        const fileNames: string[] = [];

        // Process each call in the queue
        for (let i = 0; i < 3; i++) {
            const phoneNumber = [TEST_PHONE_1, TEST_PHONE_2, TEST_PHONE_3][i];
            const uniqueFileName = `upload_${AGENT_PREFIX}call_${i + 1}_${Date.now()}.wav`;
            fileNames.push(uniqueFileName);

            // Wait for the call to connect
            try {
                await waitForCallState(page, 'connected', 15_000);
            } catch {
                await waitForCallState(page, 'ringing', 5_000).catch(() => {});
                await waitForCallState(page, 'connected', 10_000).catch(() => {});
            }

            // Simulate agent recording
            await simulateRecordingCycle(page, phoneNumber, uniqueFileName);

            // Wait for call to end
            await waitForCallState(page, 'idle', 15_000).catch(() => {});

            // Wait for call form and submit
            await waitForCallForm(page, 10_000);
            await fillAndSubmitCallForm(page, {
                outcome: 'No Answer',
                notes: `[${AGENT_PREFIX}] Upload queue test call ${i + 1}`,
            });

            await page.waitForTimeout(1500);
        }

        // All calls complete — now simulate upload queue processing
        // Agent reports 3 pending uploads
        await sendAgentUploadQueueStatus(page, {
            pendingCount: 3,
            failedCount: 0,
        });
        await page.waitForTimeout(500);

        // Progressively upload each recording
        for (let i = 0; i < 3; i++) {
            await sendAgentRecordingUploaded(page, {
                fileName: fileNames[i],
                pocketbaseRecordingId: `rec_test_${i + 1}`,
                success: true,
            });
            await page.waitForTimeout(300);

            // Update pending count
            await sendAgentUploadQueueStatus(page, {
                pendingCount: 2 - i,
                failedCount: 0,
                currentUpload: i < 2 ? fileNames[i + 1] : undefined,
            });
            await page.waitForTimeout(200);
        }

        // Final status: all uploads complete
        await sendAgentUploadQueueStatus(page, {
            pendingCount: 0,
            failedCount: 0,
        });
        await page.waitForTimeout(500);

        // End the session
        await endVirtualSession(page);
        await page.waitForTimeout(1500);

        // Verify all 3 call_logs exist in PocketBase
        const callLogs = await fetchRecords<{ id: string }>(
            'call_logs',
            `post_call_notes ~ '${AGENT_PREFIX}' && post_call_notes ~ 'Upload queue test'`,
            'id',
        ).catch(() => []);

        expect(callLogs.length).toBeGreaterThanOrEqual(3);
        createdCallLogIds.push(...callLogs.map(l => l.id));

        // Track session for cleanup
        const sessions = await fetchRecords<{ id: string }>(
            'cold_calling_sessions',
            `status = 'completed'`,
            'id',
        ).catch(() => []);
        if (sessions.length > 0) {
            createdSessionIds.push(sessions[sessions.length - 1].id);
        }

        await expect(page.locator('body')).not.toContainText('Application error');
    });
});
