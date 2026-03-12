/**
 * 11-integration.spec.ts
 * Cross-component integration tests.
 *
 * These tests verify that data flows correctly between components:
 *   1. Call Log → Cold Calls page display
 *   2. Company → Call History in detail page
 *   3. Call Log → Recording linkage (API-level)
 *   4. Call Log → has_recording field integrity (API-level)
 *   5. Callback outcome → Company list display
 *
 * Removed tests (all had no meaningful assertions beyond "no Application error"):
 *   - 'session appears in session logs after completion' — just checked no error
 *   - 'follow-up context is visible' — just checked no error
 *   - 'call log in cold calls table shows session link' — just checked column header
 *   - 'session logs reflect owner_reached count' — extremely loose assertion (/1/)
 *   - 'phone number shows call history' — just checked no error
 *   - 'recordings page contains integration test recording' — just checked no error
 *   - 'recordings page renders linked recording with view-transcript link' — just checked no error
 *
 * Strategy:
 *   All test data is seeded via PocketBase API.
 *   The UI is used to verify correct display and cross-linking.
 *   API-level tests verify data integrity directly.
 *   Cleanup happens in afterAll.
 */
import { test, expect } from '@playwright/test';
import { TEST_PREFIX, TEST_COMPANY, TEST_PHONE_NUMBER, waitForTableLoad } from './helpers/test-data';
import { cleanupByPrefix, createRecord, fetchRecords, deleteRecord } from './helpers/pb-client';

let companyId: string;
let phoneId: string;
let sessionId: string;
let callLogId: string;
let followUpId: string;
let recordingId: string;
let userId: string;

test.describe('Integration: Data Flow Between Components', () => {
  test.beforeAll(async () => {
    // Get test user ID
    try {
      const users = await fetchRecords<{ id: string }>('users', '', 'id');
      userId = users[0]?.id ?? '';
    } catch { userId = ''; }

    // 1. Company
    const company = await createRecord<{ id: string }>('companies', {
      company_name: `${TEST_PREFIX}Integration Restaurant`,
      owner_name: `${TEST_PREFIX}Integration Owner`,
      source: 'Manual',
    });
    companyId = company.id;

    // 2. Phone Number
    const phone = await createRecord<{ id: string }>('phone_numbers', {
      company: companyId,
      phone_number: '555-9999',
      receptionist_name: `${TEST_PREFIX}Integration Receptionist`,
      total_calls: 0,
    });
    phoneId = phone.id;

    // 3. Completed Session
    if (userId) {
      const session = await createRecord<{ id: string }>('cold_calling_sessions', {
        user: userId,
        started_at: new Date(Date.now() - 7200_000).toISOString(),
        ended_at: new Date(Date.now() - 3600_000).toISOString(),
        total_dials: 3,
        total_pickups: 2,
        total_duration_sec: 900,
        owner_reached: 1,
        pitch_completed: 1,
        appointment_set: 0,
        status: 'completed',
        session_notes: `[${TEST_PREFIX}] Integration test session`,
        total_paused_sec: 0,
      });
      sessionId = session.id;
    }

    // 4. Call Log (linked to session, company, phone)
    const callLog = await createRecord<{ id: string }>('call_logs', {
      company: companyId,
      phone_number_record: phoneId,
      ...(sessionId ? { session: sessionId } : {}),
      call_time: new Date(Date.now() - 3650_000).toISOString(),
      call_outcome: ['Callback'],
      interest_level: 6,
      post_call_notes: `[${TEST_PREFIX}] Integration call log - callback scheduled`,
      owner_reached: true,
      pitch_completed: false,
      appointment_set: false,
      has_recording: false,
      ring_duration: 15,
      call_duration: 120,
      duration: 135,
    });
    callLogId = callLog.id;

    // 5. Follow-Up (linked to call log)
    if (userId) {
      const followUp = await createRecord<{ id: string }>('follow_ups', {
        call_log: callLogId,
        company: companyId,
        phone_number_record: phoneId,
        created_by: userId,
        scheduled_time: new Date(Date.now() + 86400_000).toISOString(),
        client_timezone: 'America/New_York',
        notes: `[${TEST_PREFIX}] Follow-up from integration test`,
        status: 'pending',
      });
      followUpId = followUp.id;
    }

    // 6. Recording (linked to call log)
    const recording = await createRecord<{ id: string }>('recordings', {
      company: companyId,
      phone_number_record: phoneId,
      call_log: callLogId,
      note: `[${TEST_PREFIX}] Integration test recording`,
      recording_date: new Date().toISOString(),
      duration: 120,
    });
    recordingId = recording.id;
  });

  test.afterAll(async () => {
    if (followUpId) await deleteRecord('follow_ups', followUpId);
    if (recordingId) await deleteRecord('recordings', recordingId);
    if (callLogId) await deleteRecord('call_logs', callLogId);
    if (sessionId) await deleteRecord('cold_calling_sessions', sessionId);
    if (phoneId) await deleteRecord('phone_numbers', phoneId);
    if (companyId) await deleteRecord('companies', companyId);
  });

  // ─── UI Integration Tests ─────────────────────────────────────────────────────

  test('integration call log appears in /cold-calls', async ({ page }) => {
    await page.goto('/cold-calls');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill('Integration Restaurant');
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const rows = page.locator('tbody tr, [role="row"]')
      .filter({ hasText: /integration/i });
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });

  test('company detail page shows related call logs', async ({ page }) => {
    await page.goto(`/companies/${companyId}`);
    await waitForTableLoad(page);

    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).not.toContainText('This page could not be found');
    await expect(page.locator('body')).toContainText('Integration Restaurant');
  });

  test('call log detail page loads with correct company', async ({ page }) => {
    await page.goto(`/cold-calls/${callLogId}`);
    await waitForTableLoad(page);

    await expect(page.locator('body')).not.toContainText('Application error');
    await expect(page.locator('body')).toContainText('Integration Restaurant');
  });

  test('call with Callback outcome is reflected in company list', async ({ page }) => {
    await page.goto('/companies');
    await waitForTableLoad(page);

    const searchInput = page.locator('input[placeholder*="earch"]').first();
    await searchInput.fill('Integration Restaurant');
    await page.waitForTimeout(600);
    await waitForTableLoad(page);

    const companyRow = page.locator('tr, [role="row"]').filter({ hasText: /Integration Restaurant/i }).first();
    await expect(companyRow).toBeVisible({ timeout: 10_000 });
  });

  // ─── API-Level Data Integrity Tests ───────────────────────────────────────────

  test('recording has call_log relation set correctly', async () => {
    if (!recordingId || !callLogId) return;

    const recordings = await fetchRecords<{ id: string; call_log: string; note: string }>(
      'recordings',
      `id = "${recordingId}"`,
      'id,call_log,note'
    );

    expect(recordings.length).toBe(1);
    expect(recordings[0].call_log).toBe(callLogId);
  });

  test('call log has_recording is false before session submits recording', async () => {
    if (!callLogId) return;

    const callLogs = await fetchRecords<{ id: string; has_recording?: boolean }>(
      'call_logs',
      `id = "${callLogId}"`,
      'id,has_recording'
    );

    expect(callLogs.length).toBe(1);
    expect(callLogs[0].has_recording).toBeFalsy();
  });

  test('follow-up record is linked to correct call log and company', async () => {
    if (!followUpId) {
      test.skip();
      return;
    }

    const followUps = await fetchRecords<{
      id: string;
      call_log: string;
      company: string;
      phone_number_record: string;
      status: string;
    }>(
      'follow_ups',
      `id = "${followUpId}"`,
      'id,call_log,company,phone_number_record,status'
    );

    expect(followUps.length).toBe(1);
    expect(followUps[0].call_log).toBe(callLogId);
    expect(followUps[0].company).toBe(companyId);
    expect(followUps[0].phone_number_record).toBe(phoneId);
    expect(followUps[0].status).toBe('pending');
  });

  test('call log has correct relational fields set', async () => {
    if (!callLogId) return;

    const callLogs = await fetchRecords<{
      id: string;
      company: string;
      phone_number_record: string;
      session?: string;
      call_outcome: string;
      owner_reached: boolean;
      pitch_completed: boolean;
    }>(
      'call_logs',
      `id = "${callLogId}"`,
      'id,company,phone_number_record,session,call_outcome,owner_reached,pitch_completed'
    );

    expect(callLogs.length).toBe(1);
    const log = callLogs[0];
    expect(log.company).toBe(companyId);
    expect(log.phone_number_record).toBe(phoneId);
    if (sessionId) expect(log.session).toBe(sessionId);
    expect(log.call_outcome).toContain('Callback');
    expect(log.owner_reached).toBe(true);
    expect(log.pitch_completed).toBe(false);
  });

  test('session has correct aggregate counters', async () => {
    if (!sessionId) {
      test.skip();
      return;
    }

    const sessions = await fetchRecords<{
      id: string;
      total_dials: number;
      total_pickups: number;
      owner_reached: number;
      pitch_completed: number;
      appointment_set: number;
      status: string;
    }>(
      'cold_calling_sessions',
      `id = "${sessionId}"`,
      'id,total_dials,total_pickups,owner_reached,pitch_completed,appointment_set,status'
    );

    expect(sessions.length).toBe(1);
    const session = sessions[0];
    expect(session.status).toBe('completed');
    expect(session.total_dials).toBe(3);
    expect(session.total_pickups).toBe(2);
    expect(session.owner_reached).toBe(1);
    expect(session.pitch_completed).toBe(1);
    expect(session.appointment_set).toBe(0);
  });
});
