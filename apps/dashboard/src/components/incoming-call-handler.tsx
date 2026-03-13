'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PhoneIncoming, PhoneMissed, X, Building2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type PhoneNumber, type ColdCallingSession, type CallLog } from '@/lib/types';
import { computeCompanyStatuses } from '@/lib/call-outcomes';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useSession } from '@/contexts/session-context';
import { useAuth } from '@/contexts/auth-context';
import { CurrentCallForm, type CallFormData } from '@/app/(dashboard)/session/current-call-form';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useToast } from '@/components/ui/toast';

export function IncomingCallHandler() {
    const { callStatus, callDirection, incomingCallerNumber } = useZoomPhone();
    const { session, setSession, isStandaloneMode } = useSession();
    const { user } = useAuth();
    const { completeFollowUp } = useFollowUps();
    const { addToast } = useToast();

    // Only show incoming call notifications to the user who is in an active session (or standalone mode)
    const isActiveForCalls = !!(session || isStandaloneMode);

    // ── UI state ──
    const [showRingingBanner, setShowRingingBanner] = useState(false);
    const [showLogForm, setShowLogForm] = useState(false);
    const [showMissedBanner, setShowMissedBanner] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // ── Matched company from our DB ──
    const [matchedCompany, setMatchedCompany] = useState<Company | null>(null);
    const [matchedPhoneRecord, setMatchedPhoneRecord] = useState<PhoneNumber | null>(null);

    // ── Timing refs (mirroring session/page.tsx pattern) ──
    const ringStartTimeRef = useRef<number | null>(null);
    const connectTimeRef = useRef<number | null>(null);
    const callEndTimeRef = useRef<number | null>(null);
    const wasConnectedRef = useRef(false);
    const dialIncrementedRef = useRef(false);
    const pickupIncrementedRef = useRef(false);

    // ── Captured caller number for the form (persists across callDirection reset) ──
    const capturedCallerNumberRef = useRef<string | null>(null);
    const capturedSessionRef = useRef<ColdCallingSession | null>(null);

    // ── Missed call auto-dismiss timer ──
    const missedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Look up caller number in our phone_numbers DB ──
    const lookupIncomingNumber = useCallback(async (number: string | null) => {
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
                const phoneRecord = results.items[0];
                setMatchedPhoneRecord(phoneRecord);
                setMatchedCompany(phoneRecord.expand?.company as Company ?? null);
            } else {
                setMatchedPhoneRecord(null);
                setMatchedCompany(null);
            }
        } catch {
            setMatchedPhoneRecord(null);
            setMatchedCompany(null);
        }
    }, []);

    // ── Effect 1: Inbound ringing ──
    useEffect(() => {
        if (callStatus !== 'ringing' || callDirection !== 'inbound') {
            dialIncrementedRef.current = false; // Reset for next inbound call
            return;
        }
        if (!isActiveForCalls) return;
        if (dialIncrementedRef.current) return; // Already handled this inbound ring

        // Mark as handled immediately to prevent re-firing when session updates
        dialIncrementedRef.current = true;

        // Capture state for this call's lifecycle
        ringStartTimeRef.current = Date.now();
        connectTimeRef.current = null;
        wasConnectedRef.current = false;
        pickupIncrementedRef.current = false;
        capturedCallerNumberRef.current = incomingCallerNumber;
        capturedSessionRef.current = session;

        setMatchedCompany(null);
        setMatchedPhoneRecord(null);
        setShowRingingBanner(true);
        setShowMissedBanner(false);

        lookupIncomingNumber(incomingCallerNumber);

        // Increment session total_incoming only (inbound calls are not dials)
        // Uses PocketBase atomic increment to prevent race conditions with stale session state
        if (session) {
            pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                'total_incoming+': 1,
            } as any).then(updated => {
                setSession(updated);
            }).catch(err => console.error('[IncomingCallHandler] Failed to increment incoming count:', err));
        }
    }, [callStatus, callDirection, incomingCallerNumber, session, setSession, lookupIncomingNumber, isActiveForCalls]);

    // ── Effect 2: Inbound call answered ──
    useEffect(() => {
        if (callStatus !== 'connected' || callDirection !== 'inbound') return;
        if (!isActiveForCalls) return;

        connectTimeRef.current = Date.now();
        wasConnectedRef.current = true;
        setShowRingingBanner(false);

        // Inbound answered — do not count as a pickup (received calls are tracked separately via total_incoming)
        pickupIncrementedRef.current = false;
    }, [callStatus, callDirection, isActiveForCalls]);

    // ── Effect 3: Inbound call ended ──
    useEffect(() => {
        if (callStatus !== 'ended' || callDirection !== 'inbound') return;
        if (!isActiveForCalls) return;

        callEndTimeRef.current = Date.now();
        setShowRingingBanner(false);

        if (wasConnectedRef.current) {
            // Call was answered — show log form
            setShowLogForm(true);
        } else {
            // Missed call
            setShowMissedBanner(true);
            if (missedTimerRef.current) clearTimeout(missedTimerRef.current);
            missedTimerRef.current = setTimeout(() => setShowMissedBanner(false), 30000);
        }
    }, [callStatus, callDirection, isActiveForCalls]);

    // ── Cleanup timer on unmount ──
    useEffect(() => {
        return () => {
            if (missedTimerRef.current) clearTimeout(missedTimerRef.current);
        };
    }, []);

    const dismissForm = useCallback(() => {
        setShowLogForm(false);
        // Reset timing refs for next call
        ringStartTimeRef.current = null;
        connectTimeRef.current = null;
        callEndTimeRef.current = null;
        wasConnectedRef.current = false;
        capturedCallerNumberRef.current = null;
        capturedSessionRef.current = null;
    }, []);

    // ── Save inbound call log ──
    const handleSaveIncomingCall = useCallback(async (data: CallFormData) => {
        if (!user) return;
        if (isSaving) return;
        setIsSaving(true);

        const capturedRingStart = ringStartTimeRef.current;
        const capturedConnect = connectTimeRef.current;
        const activeSession = capturedSessionRef.current || session;

        try {
            // Find or create phone number record
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
                } catch { /* ignore */ }
            }

            // Calculate durations using actual call-end time, not form-submission time
            let ringDuration = 0, callDuration = 0, totalDuration = 0;
            const endTime = callEndTimeRef.current ?? Date.now();
            if (capturedRingStart) {
                if (capturedConnect) {
                    ringDuration = Math.floor((capturedConnect - capturedRingStart) / 1000);
                    callDuration = Math.floor((endTime - capturedConnect) / 1000);
                    totalDuration = ringDuration + callDuration;
                } else {
                    ringDuration = Math.floor((endTime - capturedRingStart) / 1000);
                    totalDuration = ringDuration;
                }
            }

            const hasCallbacks = (data.callbackEvents?.length ?? 0) > 0;

            // Create call log
            await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
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
                direction: 'inbound',
            });

            // Update session performance metrics
            // Uses PocketBase atomic increment operators to prevent race conditions
            if (activeSession) {
                const sessionUpdates: Record<string, number> = {};
                if (data.ownerReached) sessionUpdates['owner_reached+'] = 1;
                if (data.pitchCompleted) sessionUpdates['pitch_completed+'] = 1;
                if (data.appointmentSet) sessionUpdates['appointment_set+'] = 1;
                if (hasCallbacks) sessionUpdates['total_callbacks+'] = 1;
                if (Object.keys(sessionUpdates).length > 0) {
                    const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(activeSession.id, sessionUpdates);
                    setSession(updated);
                }
            }

            // Update company metadata + compute status (non-blocking)
            void (async () => {
                try {
                    const companyUpdates: Record<string, unknown> = { last_contacted: new Date().toISOString() };
                    const existingCompany = await pb.collection(COLLECTIONS.COMPANIES).getOne(data.companyId);
                    if (!existingCompany.source) companyUpdates.source = 'Incoming Call';
                    if (!existingCompany.first_contacted) companyUpdates.first_contacted = new Date().toISOString();
                    if (data.ownerReached && data.ownerName && !existingCompany.owner_name) {
                        companyUpdates.owner_name = data.ownerName;
                    }
                    // Compute company status from last call per phone number
                    try {
                        const allLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                            filter: `company = "${data.companyId}"`,
                            sort: '-call_time',
                            fields: 'phone_number_record,call_time,call_outcome',
                        });
                        companyUpdates.status = computeCompanyStatuses(allLogs);
                    } catch { /* non-critical */ }
                    await pb.collection(COLLECTIONS.COMPANIES).update(data.companyId, companyUpdates);
                } catch { /* non-critical */ }
            })();

            // Complete follow-ups the user chose to resolve in the call form
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
            console.error('[IncomingCallHandler] Failed to save incoming call:', err);
        } finally {
            setIsSaving(false);
        }
    }, [user, session, matchedPhoneRecord, isSaving, setSession, dismissForm, completeFollowUp, addToast]);

    const handleOpenLogFromMissed = useCallback(() => {
        setShowMissedBanner(false);
        if (missedTimerRef.current) clearTimeout(missedTimerRef.current);
        setShowLogForm(true);
    }, []);

    const displayNumber = capturedCallerNumberRef.current || incomingCallerNumber || 'Unknown';

    return (
        <>
            {/* ── Incoming ringing banner ── */}
            {showRingingBanner && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-5 py-3 rounded-2xl bg-[var(--card-bg)] border border-[var(--primary)]/40 shadow-xl shadow-[var(--primary)]/10 min-w-[300px] max-w-[480px]">
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--primary)]/15 shrink-0">
                        <PhoneIncoming size={18} className="text-[var(--primary)] animate-bounce" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[var(--primary)] uppercase tracking-wider">Incoming Call</p>
                        <p className="text-sm font-medium truncate">{incomingCallerNumber || 'Unknown number'}</p>
                        {matchedCompany && (
                            <p className="text-xs text-[var(--muted)] flex items-center gap-1 truncate">
                                <Building2 size={10} />
                                {matchedCompany.company_name}
                            </p>
                        )}
                    </div>
                    {session && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] shrink-0">
                            In session
                        </span>
                    )}
                </div>
            )}

            {/* ── Missed call banner ── */}
            {showMissedBanner && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-5 py-3 rounded-2xl bg-[var(--card-bg)] border border-[var(--error)]/40 shadow-xl shadow-[var(--error)]/10 min-w-[300px] max-w-[520px]">
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--error-subtle)] shrink-0">
                        <PhoneMissed size={18} className="text-[var(--error)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[var(--error)] uppercase tracking-wider">Missed Call</p>
                        <p className="text-sm font-medium truncate">{displayNumber}</p>
                        {matchedCompany && (
                            <p className="text-xs text-[var(--muted)] flex items-center gap-1 truncate">
                                <Building2 size={10} />
                                {matchedCompany.company_name}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={handleOpenLogFromMissed}
                        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)] text-white hover:opacity-90 transition-opacity"
                    >
                        Log it
                    </button>
                    <button
                        onClick={() => setShowMissedBanner(false)}
                        className="shrink-0 p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* ── Log form modal ── */}
            {showLogForm && (
                <div className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center pt-16 p-4 overflow-y-auto">
                    <div className="bg-[var(--card-bg)] rounded-xl w-full max-w-2xl shadow-2xl">
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
                            <div className="flex items-center gap-2.5">
                                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[var(--primary)]/15">
                                    <PhoneIncoming size={14} className="text-[var(--primary)]" />
                                </div>
                                <span className="font-semibold">Log Incoming Call</span>
                                {(capturedSessionRef.current || session) && (
                                    <span className="text-xs text-[var(--muted)] px-2 py-0.5 rounded-full bg-[var(--muted)]/10">
                                        Attaching to session
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={dismissForm}
                                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Form */}
                        <div className="p-5">
                            <CurrentCallForm
                                phoneNumber={displayNumber !== 'Unknown' ? displayNumber : ''}
                                onSave={handleSaveIncomingCall}
                                saving={isSaving}
                                hasUnsavedCall={true}
                                isCallLive={false}
                                onDiscard={dismissForm}
                                suggestedCompanyName={matchedCompany?.company_name ?? undefined}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
