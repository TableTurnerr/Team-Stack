import type PocketBase from 'pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type PhoneNumber, type FollowUp, type Company } from './types';
import { computeCompanyStatuses } from './call-outcomes';
import { autoClaimCompany } from './auto-claim';
import { linkCallLogToClaim } from './call-claim';
import type { CallFormData } from '@/app/(dashboard)/session/current-call-form';

/**
 * Durable, serializable payloads + PocketBase write logic for the offline
 * outbox (see offline-outbox.ts). Every payload here MUST stay plain JSON —
 * it is persisted to localStorage and replayed after the CRM server (a
 * self-hosted PocketBase) comes back from an outage.
 *
 * Recordings/audio are NEVER queued here — the desktop agent owns those.
 */

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface CreateSessionPayload {
    /** Local placeholder id (`offline-<uuid>`) used by the page until the real record exists. */
    tempSessionId: string;
    /** Full create body for cold_calling_sessions. */
    body: Record<string, unknown>;
}

export interface IncrementSessionPayload {
    sessionId: string;
    field: 'total_dials' | 'total_pickups';
    amount: number;
}

export interface EndSessionPayload {
    sessionId: string;
    /** Full update body (ended_at, total_duration_sec, status, on_call). */
    body: Record<string, unknown>;
}

export interface CallSavePayload {
    /** The submitted call form, exactly as handleSaveCall received it. */
    form: CallFormData;
    sessionId: string;
    userId: string;
    /** ISO timestamp of when the user saved the call (used as call_time). */
    callTime: string;
    /** Captured timing (ms epoch) — survives the instant UI reset. */
    ringStart: number | null;
    connectTime: number | null;
    endTime: number;
    pickupIncremented: boolean;
    clientCallId: string | null;
    hasCallbacks: boolean;
    /** Claim-linking hints (best-effort ownership ledger). */
    zoomCallId: string | null;
    deviceId: string | null;
    intentId: string | null;
    activePhone: string | null;
    direction: 'inbound' | 'outbound';
}

/**
 * Page-injected callbacks for the parts of a call save that must NOT be
 * replayed from the outbox (recording linkage via the agent WebSocket, live
 * UI state). All optional — a replay after a page reload simply skips them.
 */
export interface CallSaveHooks {
    /** Fired right after the call_log is created. The page uses this to submit
     *  the deferred recording, mark has_recording, and update the last-call preview. */
    onCallLogCreated?: (callLog: CallLog, payload: CallSavePayload) => void;
    /** Fired with the freshly re-fetched session after counters were updated. */
    onSessionRefreshed?: (session: ColdCallingSession) => void;
    /** Follow-up creation override (the page passes its context version, which
     *  also creates alerts + schedules pushes). */
    createFollowUp?: (data: {
        company: string;
        phone_number_record?: string;
        call_log?: string;
        scheduled_time: string;
        client_timezone: string;
        notes?: string;
    }) => Promise<unknown>;
    /** Follow-up completion override (context version also dismisses alerts). */
    completeFollowUp?: (id: string) => Promise<void>;
    /** Fired after completeFollowUpIds were processed successfully. */
    onFollowUpsCompleted?: (count: number, companyName: string) => void;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** True when the error looks like "server unreachable" rather than a rejection.
 *  PocketBase's ClientResponseError reports status 0 for network-level failures. */
export function isPbNetworkError(err: unknown): boolean {
    if (err instanceof TypeError) return true; // raw fetch network failure
    const status = (err as { status?: number } | null)?.status;
    return status === 0;
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

export async function executeSessionCreate(
    pbClient: PocketBase,
    payload: CreateSessionPayload
): Promise<ColdCallingSession> {
    return pbClient
        .collection(COLLECTIONS.COLD_CALLING_SESSIONS)
        .create<ColdCallingSession>(payload.body, { requestKey: null });
}

export async function executeSessionIncrement(
    pbClient: PocketBase,
    payload: IncrementSessionPayload
): Promise<void> {
    await pbClient.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(
        payload.sessionId,
        { [`${payload.field}+`]: payload.amount },
        { requestKey: null }
    );
}

export async function executeSessionEnd(
    pbClient: PocketBase,
    payload: EndSessionPayload
): Promise<void> {
    await pbClient
        .collection(COLLECTIONS.COLD_CALLING_SESSIONS)
        .update(payload.sessionId, payload.body, { requestKey: null });
}

/**
 * Persist one saved call to PocketBase. Extracted verbatim from the session
 * page's fire-and-forget background save so the same logic serves both the
 * live save path and outbox replay.
 *
 * Throws when the PRIMARY write path fails (company resolution / call_log
 * create) so the outbox can retry. Secondary work after the call_log exists
 * (session counters, company metadata, follow-ups) keeps the original
 * best-effort Promise.allSettled semantics and never throws.
 */
export async function executeCallSave(
    pbClient: PocketBase,
    payload: CallSavePayload,
    hooks?: CallSaveHooks | null
): Promise<CallLog> {
    const data = payload.form;

    // Build the phone-number filter once — reused both by the
    // global pre-check (anti-duplicate-company guard) and by the
    // company-scoped lookup further down.
    const phoneDigits = data.phoneNumber.replace(/\D/g, '');
    const phoneLast10 = phoneDigits.slice(-10);
    const phoneFilterParts = [`phone_number = "${data.phoneNumber}"`];
    if (phoneDigits !== data.phoneNumber) phoneFilterParts.push(`phone_number ~ "${phoneDigits}"`);
    if (phoneLast10 !== phoneDigits && phoneLast10.length >= 7) phoneFilterParts.push(`phone_number ~ "${phoneLast10}"`);

    // Boundary recheck — if the user is creating a NEW company but
    // the phone number already lives on a different company, adopt
    // that existing company instead of creating a duplicate.
    let adoptedCompanyId: string | null = null;
    if (!data.companyId && data.newCompanyName?.trim() && phoneLast10.length >= 7) {
        try {
            const existing = await pbClient.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                filter: phoneFilterParts.join(' || '),
                expand: 'company',
                requestKey: null,
            });
            const hit = existing.items[0];
            if (hit?.company) {
                adoptedCompanyId = hit.company;
                const hitCompany = hit.expand?.company as Company | undefined;
                console.warn('[call-save] Phone already linked to company', hit.company,
                    hitCompany ? `(${hitCompany.company_name})` : '',
                    '— adopting existing company instead of creating duplicate.');
            }
        } catch {
            // Non-fatal: fall through to the original create path.
        }
    }

    // Resolve companyId — when the user typed a brand-new company name,
    // create the company in parallel with the phone lookup. Unlike the old
    // inline block, a create failure REJECTS (instead of resolving null) so
    // a server outage is retryable from the outbox.
    const companyCreatePromise: Promise<string | null> =
        adoptedCompanyId
            ? Promise.resolve(adoptedCompanyId)
            : !data.companyId && data.newCompanyName?.trim()
                ? pbClient.collection(COLLECTIONS.COMPANIES).create<{ id: string }>({
                    company_name: data.newCompanyName.trim(),
                    owner_name: data.ownerName || undefined,
                    source: 'Cold Call',
                    first_contacted: payload.callTime,
                    last_contacted: payload.callTime,
                    assigned_to: payload.userId,
                }, { requestKey: null }).then(c => c.id)
                : Promise.resolve(data.companyId || null);

    // Find or create phone number record (kicked off in parallel with
    // company creation; resolved once we have a companyId).
    const phoneLookupPromise: Promise<string> = (async () => {
        const cid = await companyCreatePromise.catch(() => null);
        if (!cid) return '';
        try {
            const phoneRecords = await pbClient.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                filter: `company = "${cid}" && (${phoneFilterParts.join(' || ')})`,
                requestKey: null,
            });
            if (phoneRecords.items.length > 0) {
                return phoneRecords.items[0].id;
            }
            const newPhone = await pbClient.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                company: cid,
                phone_number: data.phoneNumber,
                receptionist_name: data.receptionistName || undefined,
                last_called: payload.callTime,
            }, { requestKey: null });
            // Race-window dedupe: a parallel save can also pass the empty
            // getList check and create a second row for the same
            // (company, phone). Re-query immediately after create; if
            // duplicates exist, keep the oldest and delete ours.
            try {
                const dupes = await pbClient.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 5, {
                    filter: `company = "${cid}" && (${phoneFilterParts.join(' || ')})`,
                    sort: 'created',
                    requestKey: null,
                });
                if (dupes.items.length > 1) {
                    const winner = dupes.items[0];
                    if (winner.id !== newPhone.id) {
                        await pbClient.collection(COLLECTIONS.PHONE_NUMBERS).delete(newPhone.id).catch(() => {});
                        return winner.id;
                    }
                }
            } catch {
                // Non-fatal — duplicate dedupe is best-effort.
            }
            return newPhone.id;
        } catch {
            return '';
        }
    })();

    const resolvedCompanyId = await companyCreatePromise;
    const phoneNumberRecordId = await phoneLookupPromise;
    if (!resolvedCompanyId) {
        throw new Error('Failed to resolve company for call log');
    }

    // Calculate call durations from captured values.
    // endTime was captured when callStatus became 'ended', so it reflects
    // the real call-end moment even if the save is replayed much later.
    let ringDuration = 0, callDuration = 0, totalDuration = 0;
    if (payload.ringStart) {
        if (payload.connectTime) {
            ringDuration = Math.floor((payload.connectTime - payload.ringStart) / 1000);
            callDuration = Math.floor((payload.endTime - payload.connectTime) / 1000);
            totalDuration = ringDuration + callDuration;
        } else {
            // Call rang but never connected (no answer)
            ringDuration = Math.floor((payload.endTime - payload.ringStart) / 1000);
            totalDuration = ringDuration;
        }
    }

    // Create call log — the PRIMARY record. Throws on failure (retryable).
    const callLog = await pbClient.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
        company: resolvedCompanyId,
        phone_number_record: phoneNumberRecordId || undefined,
        caller: payload.userId,
        call_time: payload.callTime,
        duration: totalDuration > 0 ? totalDuration : undefined,
        ring_duration: ringDuration > 0 ? ringDuration : undefined,
        call_duration: callDuration > 0 ? callDuration : undefined,
        call_outcome: data.callOutcome,
        post_call_notes: data.postCallNotes || undefined,
        receptionist_name: data.receptionistName || undefined,
        owner_name_found: data.ownerName || undefined,
        session: payload.sessionId,
        owner_reached: data.ownerReached,
        pitch_completed: data.pitchCompleted,
        warm_lead: data.warmLead,
        callback_events: data.callbackEvents?.length ? data.callbackEvents : undefined,
        is_callback: payload.hasCallbacks ? true : undefined,
        zoom_call_id: payload.zoomCallId ?? undefined,
    }, { expand: 'company,phone_number_record', requestKey: null });

    // Auto-claim the company if it was unassigned.
    void autoClaimCompany(resolvedCompanyId, payload.userId);

    // Link log → claim (shared-Zoom-account ownership ledger). Best-effort.
    void linkCallLogToClaim(callLog.id, {
        zoomCallId: payload.zoomCallId,
        phone: payload.activePhone,
        direction: payload.direction,
        userId: payload.userId,
        deviceId: payload.deviceId,
        intentId: payload.intentId,
    });

    // Recording submission + has_recording flag + last-call preview live in
    // the page (agent WebSocket + React state) — injected, never replayed.
    hooks?.onCallLogCreated?.(callLog, payload);

    // Save additional phone number found during call
    if (data.additionalPhoneNumber) {
        pbClient.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
            company: resolvedCompanyId,
            phone_number: data.additionalPhoneNumber,
            receptionist_name: data.additionalPhoneNote || undefined,
            last_called: payload.callTime,
        }, { requestKey: null }).catch(err => console.error('Failed to save additional phone number:', err));
    }

    // Background: session perf + company metadata + follow-up (best-effort,
    // same Promise.allSettled semantics as the original inline block).
    await Promise.allSettled([
        (async () => {
            // Use PocketBase atomic increment/decrement operators to prevent
            // race conditions when multiple calls update the session concurrently.
            const sessionUpdates: Record<string, number> = {};
            if (data.ownerReached) sessionUpdates['owner_reached+'] = 1;
            if (data.pitchCompleted) sessionUpdates['pitch_completed+'] = 1;
            if (data.warmLead) sessionUpdates['warm_lead+'] = 1;
            if (payload.hasCallbacks) sessionUpdates['total_callbacks+'] = 1;
            if (callDuration > 0) sessionUpdates['total_call_time+'] = callDuration;
            if (data.callOutcome.includes('No Answer') && payload.pickupIncremented) {
                // Atomically decrement — PB's min:0 constraint prevents going negative
                sessionUpdates['total_pickups-'] = 1;
            } else if (!data.callOutcome.includes('No Answer') && !payload.pickupIncremented) {
                // Fallback: if the call was NOT marked "No Answer" but the
                // connected-state pickup detection missed it, count it now.
                // This ensures pickups = dials − no-answer calls.
                sessionUpdates['total_pickups+'] = 1;
            }
            if (Object.keys(sessionUpdates).length > 0) {
                await pbClient.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(payload.sessionId, sessionUpdates, { requestKey: null });
            }
            if (hooks?.onSessionRefreshed) {
                const updatedSession = await pbClient.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getOne<ColdCallingSession>(payload.sessionId, { requestKey: null });
                hooks.onSessionRefreshed(updatedSession);
            }
        })(),
        (async () => {
            try {
                const companyUpdates: Record<string, unknown> = { last_contacted: payload.callTime };
                const existingCompany = await pbClient.collection(COLLECTIONS.COMPANIES).getOne(resolvedCompanyId, { requestKey: null });
                if (!existingCompany.source) companyUpdates.source = 'Cold Call';
                if (!existingCompany.first_contacted) companyUpdates.first_contacted = payload.callTime;
                if (data.ownerReached && data.ownerName && !existingCompany.owner_name) {
                    companyUpdates.owner_name = data.ownerName;
                }
                if (data.email && !existingCompany.email) {
                    companyUpdates.email = data.email;
                }
                // Compute company status from last call per phone number
                try {
                    const allLogs = await pbClient.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                        filter: `company = "${resolvedCompanyId}"`,
                        sort: '-call_time',
                        fields: 'phone_number_record,call_time,call_outcome',
                        requestKey: null,
                    });
                    const statuses = computeCompanyStatuses(allLogs);
                    companyUpdates.status = statuses;
                } catch { /* non-critical */ }
                await pbClient.collection(COLLECTIONS.COMPANIES).update(resolvedCompanyId, companyUpdates, { requestKey: null });
            } catch { /* non-critical */ }
        })(),
        data.followUp ? (async () => {
            try {
                const followUpInput = {
                    company: resolvedCompanyId,
                    phone_number_record: phoneNumberRecordId || undefined,
                    call_log: callLog.id,
                    scheduled_time: data.followUp!.scheduledTime,
                    client_timezone: data.followUp!.timezone,
                    notes: data.followUp!.notes || undefined,
                };
                if (hooks?.createFollowUp) {
                    await hooks.createFollowUp(followUpInput);
                } else {
                    // Outbox replay without page context — create the record
                    // directly (alerts/push scheduling are skipped).
                    await pbClient.collection(COLLECTIONS.FOLLOW_UPS).create<FollowUp>({
                        ...followUpInput,
                        created_by: payload.userId,
                        assigned_to: payload.userId,
                        status: 'pending',
                    }, { requestKey: null });
                }
            } catch (err) { console.error('Failed to create follow-up:', err); }
        })() : Promise.resolve(),
        // Complete follow-ups the user chose to resolve in the call form
        data.completeFollowUpIds?.length ? (async () => {
            try {
                for (const fuId of data.completeFollowUpIds!) {
                    if (hooks?.completeFollowUp) {
                        await hooks.completeFollowUp(fuId);
                    } else {
                        await pbClient.collection(COLLECTIONS.FOLLOW_UPS).update(fuId, {
                            status: 'completed',
                            completed_at: new Date().toISOString(),
                        }, { requestKey: null });
                    }
                }
                hooks?.onFollowUpsCompleted?.(data.completeFollowUpIds!.length, data.companyName);
            } catch { /* non-critical */ }
        })() : Promise.resolve(),
    ]);

    return callLog;
}
