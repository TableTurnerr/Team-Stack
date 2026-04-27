'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { PhoneOutgoing, X, Building2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type PhoneNumber, type ColdCallingSession, type CallLog } from '@/lib/types';
import { computeCompanyStatuses } from '@/lib/call-outcomes';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { PhoneHoverCard } from '@/components/phone-hover-card';
import { usePhone } from '@/contexts/phone-context';
import { useCallOwnershipOptional } from '@/contexts/call-ownership-context';
import { useSession } from '@/contexts/session-context';
import { useAuth } from '@/contexts/auth-context';
import { CurrentCallForm, type CallFormData } from '@/app/(dashboard)/session/current-call-form';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useToast } from '@/components/ui/toast';
import { linkCallLogToClaim } from '@/lib/call-claim';
import { autoClaimCompany } from '@/lib/auto-claim';

/**
 * Logs outbound calls made OUTSIDE the /session page.
 *
 * Within /session the page itself (`session/page.tsx` or the embedded
 * StandaloneCallInterface) owns the full call lifecycle — dial, timing,
 * log form, session metric updates. Everywhere else (/companies,
 * /dashboard, etc.) the floating PhoneDialer is the only dial entry point
 * and nothing was logging the call once it ended. This handler plugs
 * that gap: when the user dials from a non-/session page, we track the
 * ring → connect → end lifecycle here and prompt for a call-log form.
 *
 * If a cold-calling session happens to be active when the call is placed,
 * the resulting call_log is attached to it so the session still counts
 * the dial. Otherwise the log exists on its own and surfaces in the
 * company's call history.
 */
export function OutOfSessionOutboundHandler() {
    const pathname = usePathname();
    const { callStatus, callDirection, activeCallNumber } = usePhone();
    const ownership = useCallOwnershipOptional();
    const { session, setSession, isStandaloneMode } = useSession();
    const { user } = useAuth();
    const { completeFollowUp } = useFollowUps();
    const { addToast } = useToast();

    // The /session page has its own end-to-end handling of outbound calls
    // (both for session mode and standalone mode). Stay out of its way
    // to avoid double-logging.
    const onSessionPage = pathname === '/session';
    const isActiveForCalls =
        !onSessionPage &&
        !isStandaloneMode &&
        callDirection === 'outbound' &&
        (ownership ? ownership.iOwnCurrentCall : true);

    // ── UI state ──
    const [showLogForm, setShowLogForm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Capture current activity snapshot so late form submission still
    // references the real call, not the next one.
    const [matchedCompany, setMatchedCompany] = useState<Company | null>(null);
    const [matchedPhoneRecord, setMatchedPhoneRecord] = useState<PhoneNumber | null>(null);

    const ringStartTimeRef = useRef<number | null>(null);
    const connectTimeRef = useRef<number | null>(null);
    const callEndTimeRef = useRef<number | null>(null);
    const wasConnectedRef = useRef(false);
    const capturedNumberRef = useRef<string | null>(null);
    const capturedSessionRef = useRef<ColdCallingSession | null>(null);
    const capturedDialCountedRef = useRef(false);
    const capturedPickupCountedRef = useRef(false);

    // ── Look up number in our phone_numbers DB ──
    const lookupNumber = useCallback(async (number: string | null) => {
        if (!number) { setMatchedCompany(null); setMatchedPhoneRecord(null); return; }
        try {
            const digits = number.replace(/\D/g, '');
            const last10 = digits.slice(-10);
            const filterParts = [`phone_number = "${number}"`];
            if (digits !== number) filterParts.push(`phone_number ~ "${digits}"`);
            if (last10 !== digits && last10.length >= 7) filterParts.push(`phone_number ~ "${last10}"`);

            const results = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                filter: filterParts.join(' || '),
                expand: 'company',
            });
            if (results.items.length > 0) {
                const rec = results.items[0];
                setMatchedPhoneRecord(rec);
                setMatchedCompany((rec.expand?.company as Company) ?? null);
            } else {
                setMatchedPhoneRecord(null);
                setMatchedCompany(null);
            }
        } catch {
            setMatchedPhoneRecord(null);
            setMatchedCompany(null);
        }
    }, []);

    // ── Ringing: capture start of lifecycle ──
    useEffect(() => {
        if (callStatus !== 'ringing') return;
        if (!isActiveForCalls) return;
        if (ringStartTimeRef.current) return; // already captured this call's start

        ringStartTimeRef.current = Date.now();
        connectTimeRef.current = null;
        callEndTimeRef.current = null;
        wasConnectedRef.current = false;
        capturedDialCountedRef.current = false;
        capturedPickupCountedRef.current = false;
        capturedNumberRef.current = activeCallNumber;
        capturedSessionRef.current = session;
        setMatchedCompany(null);
        setMatchedPhoneRecord(null);

        lookupNumber(activeCallNumber);

        // Count the dial against the session if one is active, so metrics
        // still reflect the out-of-session dial.
        if (session && !capturedDialCountedRef.current) {
            capturedDialCountedRef.current = true;
            pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                'total_dials+': 1,
            } as unknown as Partial<ColdCallingSession>).then(updated => setSession(updated))
              .catch(err => console.error('[OutOfSessionOutbound] Failed to increment dials:', err));
        }
    }, [callStatus, isActiveForCalls, activeCallNumber, session, setSession, lookupNumber]);

    // ── Connected: mark connect time and count pickup ──
    useEffect(() => {
        if (callStatus !== 'connected') return;
        if (!isActiveForCalls) return;
        if (connectTimeRef.current) return; // already handled
        connectTimeRef.current = Date.now();
        wasConnectedRef.current = true;

        if (session && !capturedPickupCountedRef.current) {
            capturedPickupCountedRef.current = true;
            pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                'total_pickups+': 1,
            } as unknown as Partial<ColdCallingSession>).then(updated => setSession(updated))
              .catch(err => console.error('[OutOfSessionOutbound] Failed to increment pickups:', err));
        }
    }, [callStatus, isActiveForCalls, session, setSession]);

    // ── Ended: show the log form ──
    useEffect(() => {
        if (callStatus !== 'ended') return;
        if (!ringStartTimeRef.current) return; // not our call
        callEndTimeRef.current = Date.now();
        setShowLogForm(true);
    }, [callStatus]);

    const dismissForm = useCallback(() => {
        setShowLogForm(false);
        ringStartTimeRef.current = null;
        connectTimeRef.current = null;
        callEndTimeRef.current = null;
        wasConnectedRef.current = false;
        capturedNumberRef.current = null;
        capturedSessionRef.current = null;
        setMatchedCompany(null);
        setMatchedPhoneRecord(null);
    }, []);

    // ── Save the outbound call log ──
    const handleSave = useCallback(async (data: CallFormData) => {
        if (!user || isSaving) return;
        setIsSaving(true);

        const ringStart = ringStartTimeRef.current;
        const connectAt = connectTimeRef.current;
        const endAt = callEndTimeRef.current ?? Date.now();
        const activeSession = capturedSessionRef.current || session;

        try {
            // Find or create phone_number record for this company+number pair
            let phoneNumberRecordId = matchedPhoneRecord?.id || '';
            if (!phoneNumberRecordId && data.phoneNumber) {
                try {
                    const digits = data.phoneNumber.replace(/\D/g, '');
                    const last10 = digits.slice(-10);
                    const filterParts = [`phone_number = "${data.phoneNumber}"`];
                    if (digits !== data.phoneNumber) filterParts.push(`phone_number ~ "${digits}"`);
                    if (last10 !== digits && last10.length >= 7) filterParts.push(`phone_number ~ "${last10}"`);

                    const phoneRecords = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                        filter: `company = "${data.companyId}" && (${filterParts.join(' || ')})`,
                    });
                    if (phoneRecords.items.length > 0) {
                        phoneNumberRecordId = phoneRecords.items[0].id;
                    } else {
                        const newPhone = await pb.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                            company: data.companyId,
                            phone_number: data.phoneNumber,
                            last_called: new Date().toISOString(),
                        });
                        phoneNumberRecordId = newPhone.id;
                    }
                } catch { /* non-critical */ }
            }

            let ringDuration = 0, callDuration = 0, totalDuration = 0;
            if (ringStart) {
                if (connectAt) {
                    ringDuration = Math.floor((connectAt - ringStart) / 1000);
                    callDuration = Math.floor((endAt - connectAt) / 1000);
                    totalDuration = ringDuration + callDuration;
                } else {
                    ringDuration = Math.floor((endAt - ringStart) / 1000);
                    totalDuration = ringDuration;
                }
            }
            const hasCallbacks = (data.callbackEvents?.length ?? 0) > 0;

            const createdLog = await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
                company: data.companyId,
                phone_number_record: phoneNumberRecordId || undefined,
                caller: user.id,
                call_time: new Date().toISOString(),
                duration: totalDuration > 0 ? totalDuration : undefined,
                ring_duration: ringDuration > 0 ? ringDuration : undefined,
                call_duration: callDuration > 0 ? callDuration : undefined,
                call_outcome: data.callOutcome,
                post_call_notes: data.postCallNotes || undefined,
                receptionist_name: data.receptionistName || undefined,
                owner_name_found: data.ownerName || undefined,
                session: activeSession?.id,
                owner_reached: data.ownerReached,
                pitch_completed: data.pitchCompleted,
                appointment_set: data.appointmentSet,
                callback_events: data.callbackEvents?.length ? data.callbackEvents : undefined,
                is_callback: hasCallbacks ? true : undefined,
                direction: 'outbound',
                zoom_call_id: ownership?.zoomCallId ?? undefined,
            });

            // Auto-claim the company if it was unassigned.
            void autoClaimCompany(data.companyId, user.id);

            // Link to call_claim for shared-Zoom-account ownership ledger
            try {
                void linkCallLogToClaim(createdLog.id, {
                    zoomCallId: ownership?.zoomCallId ?? null,
                    phone: capturedNumberRef.current || activeCallNumber,
                    direction: 'outbound',
                    userId: user.id,
                    deviceId: ownership?.deviceId ?? null,
                    intentId: ownership?.intentId ?? null,
                });
            } catch (e) { console.warn('[OutOfSessionOutbound] linkCallLogToClaim failed:', e); }

            // Update session performance metrics if a session is active
            if (activeSession) {
                const sessionUpdates: Record<string, number> = {};
                if (data.ownerReached) sessionUpdates['owner_reached+'] = 1;
                if (data.pitchCompleted) sessionUpdates['pitch_completed+'] = 1;
                if (data.appointmentSet) sessionUpdates['appointment_set+'] = 1;
                if (hasCallbacks) sessionUpdates['total_callbacks+'] = 1;
                if (Object.keys(sessionUpdates).length > 0) {
                    const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                        activeSession.id,
                        sessionUpdates as unknown as Partial<ColdCallingSession>,
                    );
                    setSession(updated);
                }
            }

            // Update company metadata + recompute status (non-blocking)
            void (async () => {
                try {
                    const existing = await pb.collection(COLLECTIONS.COMPANIES).getOne(data.companyId);
                    const updates: Record<string, unknown> = { last_contacted: new Date().toISOString() };
                    if (!existing.first_contacted) updates.first_contacted = new Date().toISOString();
                    if (data.ownerReached && data.ownerName && !existing.owner_name) {
                        updates.owner_name = data.ownerName;
                    }
                    try {
                        const allLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                            filter: `company = "${data.companyId}"`,
                            sort: '-call_time',
                            fields: 'phone_number_record,call_time,call_outcome',
                        });
                        updates.status = computeCompanyStatuses(allLogs);
                    } catch { /* non-critical */ }
                    await pb.collection(COLLECTIONS.COMPANIES).update(data.companyId, updates);
                } catch { /* non-critical */ }
            })();

            if (data.completeFollowUpIds?.length) {
                void (async () => {
                    try {
                        for (const fuId of data.completeFollowUpIds!) {
                            await completeFollowUp(fuId);
                        }
                        addToast('success', `Completed ${data.completeFollowUpIds!.length} follow-up${data.completeFollowUpIds!.length > 1 ? 's' : ''} for ${data.companyName}`);
                    } catch { /* non-critical */ }
                })();
            }

            dismissForm();
        } catch (err) {
            console.error('[OutOfSessionOutbound] Failed to save outbound call:', err);
        } finally {
            setIsSaving(false);
        }
    }, [user, session, matchedPhoneRecord, isSaving, setSession, dismissForm, completeFollowUp, addToast, activeCallNumber, ownership]);

    const displayNumber = capturedNumberRef.current || activeCallNumber || 'Unknown';

    if (!showLogForm) return null;

    return (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-16 p-4 overflow-y-auto">
            <div className="bg-[var(--card-bg)] rounded-xl w-full max-w-2xl shadow-2xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--primary)]/15">
                            <PhoneOutgoing size={14} className="text-[var(--primary)]" />
                        </div>
                        <span className="font-semibold">Log Outbound Call</span>
                        {capturedSessionRef.current && (
                            <span className="text-xs text-[var(--muted)] px-2 py-0.5 rounded-full bg-[var(--muted)]/10">
                                Attaching to session
                            </span>
                        )}
                        {matchedCompany && (
                            <CompanyHoverCard company={matchedCompany} side="bottom">
                              <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)] cursor-default">
                                  <Building2 size={10} />
                                  {matchedCompany.company_name}
                              </span>
                            </CompanyHoverCard>
                        )}
                        <PhoneHoverCard phoneRecord={matchedPhoneRecord ?? undefined} phoneNumber={displayNumber} side="bottom">
                          <span className="text-xs text-[var(--muted)] cursor-default">{displayNumber}</span>
                        </PhoneHoverCard>
                    </div>
                    <button
                        onClick={dismissForm}
                        className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="p-5">
                    <CurrentCallForm
                        phoneNumber={displayNumber !== 'Unknown' ? displayNumber : ''}
                        onSave={handleSave}
                        saving={isSaving}
                        hasUnsavedCall={true}
                        isCallLive={false}
                        onDiscard={dismissForm}
                        suggestedCompanyName={matchedCompany?.company_name ?? undefined}
                    />
                </div>
            </div>
        </div>
    );
}
