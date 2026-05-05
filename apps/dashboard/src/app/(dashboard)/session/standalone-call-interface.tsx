'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Power, Loader2, Mic, MicOff, Phone, Square, ArrowLeft, PhoneCall } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type PhoneNumber } from '@/lib/types';
import { computeCompanyStatuses } from '@/lib/call-outcomes';
import { useAuth } from '@/contexts/auth-context';
import { usePhone } from '@/contexts/phone-context';
import { useCallOwnershipOptional } from '@/contexts/call-ownership-context';
import { linkCallLogToClaim } from '@/lib/call-claim';
import { autoClaimCompany } from '@/lib/auto-claim';
import { useCallRecording } from '@/contexts/call-recording-context';
import { PhoneDialer } from '@/components/phone-dialer';
import { CurrentCallForm, type CallFormData, type CallFormDraft, type CallbackReason } from './current-call-form';
import { LastCallPreview } from './last-call-preview';
import { SessionFollowUps } from './session-followups';
import { AgentCallStatusBanner } from './agent-call-status-banner';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useFollowUpNotifications, type FollowUpNotification } from '@/hooks/use-followup-notifications';
import { FollowUpNotificationContainer } from '@/components/followup-notification-toast';
import { useToast } from '@/components/ui/toast';

interface StandaloneCallInterfaceProps {
    onExit: () => void;
}

const STANDALONE_UNSAVED_CALL_STORAGE_KEY = 'crm:standalone:unsaved-call:v1';

interface StandaloneUnsavedCallStoragePayload {
    phoneNumber: string;
    hasUnsavedCall: boolean;
    draft: CallFormDraft | null;
}

const hasDraftContent = (draft: CallFormDraft | null) => {
    if (!draft) return false;

    return (
        draft.companySearch.trim().length > 0 ||
        !!draft.selectedCompany ||
        draft.receptionistName.trim().length > 0 ||
        draft.ownerName.trim().length > 0 ||
        (draft.callOutcome?.length ?? 0) > 0 ||
        draft.postCallNotes.trim().length > 0 ||
        draft.ownerReached ||
        draft.pitchCompleted ||
        draft.warmLead ||
        draft.showFollowUp ||
        !!draft.followUpData
    );
};

export function StandaloneCallInterface({ onExit }: StandaloneCallInterfaceProps) {
    const { user } = useAuth();
    const { callStatus, endCall, activeCallNumber, callDirection, dialNumber, setAutoHangup } = usePhone();
    const ownership = useCallOwnershipOptional();
    const {
        isSessionActive,
        status: recorderStatus,
        duration: recordingDuration,
        stopRecording,
        startRecording,
        setPhoneNumber: setContextPhoneNumber
    } = useCallRecording();
    const { completeFollowUp } = useFollowUps();
    const { addToast } = useToast();

    const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
    const [savingCall, setSavingCall] = useState(false);
    const [lastCallLog, setLastCallLog] = useState<CallLog | null>(null);
    const [lastCallCompanyName, setLastCallCompanyName] = useState('');
    const [exiting, setExiting] = useState(false);
    const [hasUnsavedCall, setHasUnsavedCall] = useState(false);
    const [callDraft, setCallDraft] = useState<CallFormDraft | null>(null);
    const [hydratedStorage, setHydratedStorage] = useState(false);
    const [ringStartTime, setRingStartTime] = useState<number | null>(null);
    const [connectTime, setConnectTime] = useState<number | null>(null);
    // Tracks when the call actually ended for accurate duration calculation
    const callEndTimeRef = useRef<number | null>(null);
    const [callbackEvents, setCallbackEvents] = useState<Array<{ reason: string; timestamp: string }>>([]);
    const [autoHangupEnabled, setAutoHangupEnabled] = useState(false);
    const [autoHangupSeconds, setAutoHangupSeconds] = useState(15);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [suggestedCompanyName, setSuggestedCompanyName] = useState('');

    // Follow-up notifications
    const [activeNotifications, setActiveNotifications] = useState<FollowUpNotification[]>([]);
    const [sessionDismissedIds, setSessionDismissedIds] = useState<Set<string>>(new Set());
    const isInCallForNotifications = callStatus === 'ringing' || callStatus === 'connected';

    const handleFollowUpNotification = useCallback((notification: FollowUpNotification) => {
        setActiveNotifications(prev => {
            if (prev.some(n => n.id === notification.id)) return prev;
            return [...prev, notification];
        });
    }, []);

    const handleDismissNotification = useCallback((id: string) => {
        setActiveNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    // Toggle session dismiss for a follow-up (snooze/restore)
    const handleSessionDismiss = useCallback((followUpId: string) => {
        setSessionDismissedIds(prev => {
            const next = new Set(prev);
            if (next.has(followUpId)) {
                next.delete(followUpId);
            } else {
                next.add(followUpId);
            }
            return next;
        });
    }, []);

    useFollowUpNotifications({
        isOnCall: isInCallForNotifications,
        enabled: true,
        onNotification: handleFollowUpNotification,
        sessionDismissedIds,
    });

    // Pre-fill call form with follow-up company
    const handleSelectFollowUpCompany = useCallback((companyId: string, companyName: string, phoneNumber?: string) => {
        if (hasUnsavedCall) return;
        setSuggestedCompanyName(companyName);
        if (phoneNumber) {
            setCurrentPhoneNumber(phoneNumber);
            setContextPhoneNumber(phoneNumber);
        }
        addToast('info', `Selected ${companyName} for next call`);
    }, [hasUnsavedCall, addToast, setContextPhoneNumber]);

    // Dial a follow-up immediately
    const handleDialFollowUp = useCallback((phoneNumber: string, companyName?: string) => {
        if (callStatus === 'ringing' || callStatus === 'connected') {
            addToast('warning', 'A call is already in progress');
            return;
        }
        if (hasUnsavedCall) {
            addToast('warning', 'Save or discard the current call first');
            return;
        }
        if (companyName) {
            setSuggestedCompanyName(companyName);
        }
        setCurrentPhoneNumber(phoneNumber);
        setContextPhoneNumber(phoneNumber);
        dialNumber(phoneNumber);
    }, [callStatus, hasUnsavedCall, dialNumber, setContextPhoneNumber, addToast]);

    // Sync auto-hangup settings to zoom phone context
    useEffect(() => {
        setAutoHangup(autoHangupEnabled, autoHangupSeconds);
    }, [autoHangupEnabled, autoHangupSeconds, setAutoHangup]);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STANDALONE_UNSAVED_CALL_STORAGE_KEY);
            if (!raw) {
                setHydratedStorage(true);
                return;
            }

            const parsed = JSON.parse(raw) as StandaloneUnsavedCallStoragePayload;
            if (parsed && typeof parsed.phoneNumber === 'string') {
                if (parsed.phoneNumber) {
                    setCurrentPhoneNumber(parsed.phoneNumber);
                    setContextPhoneNumber(parsed.phoneNumber);
                }
                setHasUnsavedCall(!!parsed.hasUnsavedCall);
                setCallDraft(parsed.draft ?? null);
            }
        } catch {
            // Ignore malformed local storage payload
        } finally {
            setHydratedStorage(true);
        }
    }, [setContextPhoneNumber]);

    useEffect(() => {
        if (!hydratedStorage) return;

        const shouldPersist = hasUnsavedCall || (!!currentPhoneNumber && hasDraftContent(callDraft));
        if (!shouldPersist) {
            window.localStorage.removeItem(STANDALONE_UNSAVED_CALL_STORAGE_KEY);
            return;
        }

        const payload: StandaloneUnsavedCallStoragePayload = {
            phoneNumber: currentPhoneNumber,
            hasUnsavedCall,
            draft: callDraft,
        };
        window.localStorage.setItem(STANDALONE_UNSAVED_CALL_STORAGE_KEY, JSON.stringify(payload));
    }, [hydratedStorage, hasUnsavedCall, currentPhoneNumber, callDraft]);

    // Track active call from Zoom Phone context — handles both ringing and immediately-answered calls
    useEffect(() => {
        if (activeCallNumber && (callStatus === 'ringing' || callStatus === 'connected')) {
            // Check if this is a new call (different number or no current number)
            if (!currentPhoneNumber || activeCallNumber !== currentPhoneNumber) {
                console.log('[Standalone] New call detected from dialer:', activeCallNumber);
                setCurrentPhoneNumber(activeCallNumber);
                setContextPhoneNumber(activeCallNumber);

                // Auto-start recording if session is active
                if (isSessionActive && recorderStatus === 'idle') {
                    startRecording();
                }
            }
        }
    }, [activeCallNumber, currentPhoneNumber, callStatus, setContextPhoneNumber, startRecording, isSessionActive, recorderStatus]);

    useEffect(() => {
        if (callStatus === 'ringing') {
            if (!ringStartTime) {
                setRingStartTime(Date.now());
                setConnectTime(null);
                callEndTimeRef.current = null; // new call starting
            }
        } else if (callStatus === 'connected') {
            // Handle calls that skip ringing and connect immediately
            if (!ringStartTime) {
                setRingStartTime(Date.now());
                callEndTimeRef.current = null;
            }
            if (!connectTime) {
                setConnectTime(Date.now());
                // Start recording if session is active and not already recording
                if (isSessionActive && recorderStatus === 'idle') {
                    startRecording();
                }
            }
        } else if (callStatus === 'ended') {
            callEndTimeRef.current = Date.now();
            if (currentPhoneNumber) {
                setHasUnsavedCall(true);
            }
        }
    }, [callStatus, currentPhoneNumber, ringStartTime, connectTime, isSessionActive, recorderStatus, startRecording]);

    // Fallback: if audio session becomes active while call is already live, start recording
    const prevIsSessionActiveRef = useRef(isSessionActive);
    useEffect(() => {
        const wasActive = prevIsSessionActiveRef.current;
        prevIsSessionActiveRef.current = isSessionActive;

        if (!wasActive && isSessionActive && (callStatus === 'ringing' || callStatus === 'connected') && recorderStatus === 'idle') {
            console.log('[Standalone] Audio session became active mid-call — starting recording');
            startRecording();
        }
    }, [isSessionActive, callStatus, recorderStatus, startRecording]);

    // Handle saving standalone call
    const handleSaveCall = useCallback(async (data: CallFormData) => {
        if (!user) return;
        setSavingCall(true);
        try {
            // Stop recording and upload
            stopRecording();
            setContextPhoneNumber('');

            // Calculate call durations using the actual call-end time (not form submission time)
            let ringDuration = 0;
            let callDuration = 0;
            let totalDuration = 0;
            const endTime = callEndTimeRef.current ?? Date.now();

            if (ringStartTime) {
                if (connectTime) {
                    ringDuration = Math.floor((connectTime - ringStartTime) / 1000);
                    callDuration = Math.floor((endTime - connectTime) / 1000);
                    totalDuration = ringDuration + callDuration;
                } else {
                    ringDuration = Math.floor((endTime - ringStartTime) / 1000);
                    totalDuration = ringDuration;
                }
            }

            // Find or create phone number record
            let phoneNumberRecordId: string | null = null;
            try {
                // Strip non-digits for search
                const cleanNumber = data.phoneNumber.replace(/\D/g, '').slice(-10);
                const existingPhones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                    filter: `company = "${data.companyId}" && phone_number ~ "${cleanNumber}"`,
                });
                if (existingPhones.items.length > 0) {
                    phoneNumberRecordId = existingPhones.items[0].id;
                } else {
                    const newPhone = await pb.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                        company: data.companyId,
                        phone_number: data.phoneNumber,
                        receptionist_name: data.receptionistName || undefined,
                        last_called: new Date().toISOString(),
                    });
                    phoneNumberRecordId = newPhone.id;
                }
            } catch (phoneErr) {
                console.error('Phone number record error:', phoneErr);
            }

            // Create call log WITHOUT session link (standalone call)
            const callLog = await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
                company: data.companyId,
                phone_number_record: phoneNumberRecordId || undefined,
                caller: user.id,
                call_time: new Date().toISOString(),
                duration: totalDuration > 0 ? totalDuration : undefined,
                ring_duration: ringDuration > 0 ? ringDuration : undefined,
                call_duration: callDuration > 0 ? callDuration : undefined,
                call_outcome: data.callOutcome,
                post_call_notes: data.postCallNotes,
                receptionist_name: data.receptionistName || undefined,
                owner_name_found: data.ownerName || undefined,
                owner_reached: data.ownerReached,
                pitch_completed: data.pitchCompleted,
                warm_lead: data.warmLead,
                callback_events: data.callbackEvents?.length ? data.callbackEvents : undefined,
                zoom_call_id: ownership?.zoomCallId ?? undefined,
                // session field is omitted (will be null) - this marks it as a standalone call
            }, { expand: 'company,phone_number_record' });

            // Auto-claim the company if it was unassigned.
            void autoClaimCompany(data.companyId, user.id);

            // Link log → claim so standalone calls are attributed correctly
            // on the shared Zoom account.
            void linkCallLogToClaim(callLog.id, {
                zoomCallId: ownership?.zoomCallId ?? null,
                phone: activeCallNumber,
                direction: callDirection === 'inbound' ? 'inbound' : 'outbound',
                userId: user.id,
                deviceId: ownership?.deviceId ?? null,
                intentId: ownership?.intentId ?? null,
            });

            // Update company metadata + compute status from call logs
            try {
                const companyUpdates: Record<string, any> = {
                    last_contacted: new Date().toISOString(),
                };
                if (data.ownerReached && data.ownerName) {
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
            } catch (err) {
                // ignore
            }

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

            // Show last call preview
            setLastCallLog(callLog);
            setLastCallCompanyName(data.companyName);
            setCurrentPhoneNumber('');
            setHasUnsavedCall(false);
            setCallDraft(null);
            setCallbackEvents([]);
            window.localStorage.removeItem(STANDALONE_UNSAVED_CALL_STORAGE_KEY);

            // Reset timing state for next call
            setRingStartTime(null);
            setConnectTime(null);
            callEndTimeRef.current = null;
        } catch (err) {
            console.error('Failed to save standalone call:', err);
        } finally {
            setSavingCall(false);
        }
    }, [user, stopRecording, setContextPhoneNumber, ringStartTime, connectTime, completeFollowUp, addToast]);

    const handleDiscardCall = useCallback(() => {
        stopRecording();
        setContextPhoneNumber('');
        setHasUnsavedCall(false);
        setCallDraft(null);
        setCallbackEvents([]);
        setCurrentPhoneNumber('');
        setRingStartTime(null);
        setConnectTime(null);
        callEndTimeRef.current = null;
        window.localStorage.removeItem(STANDALONE_UNSAVED_CALL_STORAGE_KEY);
    }, [stopRecording, setContextPhoneNumber]);

    // Handle callback — re-dial the same number, log the reason
    const handleCallback = useCallback((reason: CallbackReason) => {
        if (!currentPhoneNumber) return;
        const event = { reason, timestamp: new Date().toISOString() };
        setCallbackEvents(prev => [...prev, event]);
        // Reset timing for new call leg
        setRingStartTime(null);
        setConnectTime(null);
        callEndTimeRef.current = null;
        dialNumber(currentPhoneNumber);
    }, [currentPhoneNumber, dialNumber]);

    // Handle exit
    const handleExit = useCallback(async () => {
        setExiting(true);
        try {
            // Stop any active recording
            if (recorderStatus === 'recording') {
                stopRecording();
            }
            window.localStorage.removeItem(STANDALONE_UNSAVED_CALL_STORAGE_KEY);
            // Call parent to exit standalone mode
            onExit();
        } finally {
            setExiting(false);
        }
    }, [recorderStatus, stopRecording, onExit]);

    const onBackClick = () => {
        if (hasUnsavedCall || (callDraft && hasDraftContent(callDraft))) {
            setShowExitConfirm(true);
        } else {
            handleExit();
        }
    };

    return (
        <div className="flex h-full bg-[var(--background)]">
            <div className="flex-1 flex flex-col min-w-0 h-full">
                {/* Header */}
                <div className="h-16 border-b border-[var(--card-border)] bg-[var(--card-bg)] flex items-center justify-between px-6 shrink-0">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBackClick}
                            className="p-2 hover:bg-[var(--sidebar-bg)] rounded-lg text-[var(--muted)] transition-colors"
                            title="Exit dialer"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <PhoneCall size={20} className="text-[var(--primary)]" />
                            Standalone Dialer
                        </h2>
                    </div>

                    <div className="flex items-center gap-6">
                        {recorderStatus === 'recording' && (
                            <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[var(--error-subtle)] border border-[var(--error)]/20">
                                <span className="flex h-2 w-2 rounded-full bg-[var(--error)] animate-pulse" />
                                <span className="text-xs font-mono font-medium text-[var(--error)]">
                                    REC: {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
                                </span>
                            </div>
                        )}

                        <div className="flex items-center gap-4">
                            {/* Auto-hangup toggle */}
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                                <label className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider whitespace-nowrap cursor-pointer" htmlFor="standalone-auto-hangup">
                                    Auto-Hangup
                                </label>
                                {autoHangupEnabled && (
                                    <input
                                        type="number"
                                        min={5}
                                        max={60}
                                        value={autoHangupSeconds}
                                        onChange={e => setAutoHangupSeconds(Math.max(5, Math.min(60, parseInt(e.target.value) || 15)))}
                                        className="w-10 px-1 py-0.5 text-xs text-center bg-[var(--card-bg)] border border-[var(--card-border)] rounded focus:outline-none"
                                    />
                                )}
                                {autoHangupEnabled && <span className="text-[10px] text-[var(--muted)]">s</span>}
                                <button
                                    id="standalone-auto-hangup"
                                    type="button"
                                    onClick={() => setAutoHangupEnabled(v => !v)}
                                    className={`relative w-8 h-4 rounded-full transition-colors ${autoHangupEnabled ? 'bg-[var(--success)]' : 'bg-[var(--card-border)]'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoHangupEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Status</p>
                                <p className="text-sm font-medium capitalize">{recorderStatus}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                    <div className="max-w-4xl mx-auto space-y-6">
                        <AgentCallStatusBanner />
                        <CurrentCallForm
                            phoneNumber={currentPhoneNumber}
                            onSave={handleSaveCall}
                            saving={savingCall}
                            hasUnsavedCall={hasUnsavedCall}
                            initialDraft={callDraft}
                            onDraftChange={setCallDraft}
                            onDiscard={handleDiscardCall}
                            isCallLive={callStatus === 'ringing' || callStatus === 'connected'}
                            onCallback={handleCallback}
                            callbackEvents={callbackEvents}
                            suggestedCompanyName={suggestedCompanyName}
                        />
                    </div>
                </div>
            </div>

            <div className="w-96 border-l border-[var(--card-border)] bg-[var(--card-bg)] flex flex-col h-full shrink-0">
                <div className="p-6 flex-1 overflow-y-auto">
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Dialer</h3>
                            <PhoneDialer docked alwaysExpanded disabled={hasUnsavedCall} />
                        </div>

                        <SessionFollowUps
                            onDialNow={handleDialFollowUp}
                            onSelectCompany={handleSelectFollowUpCompany}
                            hasUnsavedCall={hasUnsavedCall}
                            isCallInProgress={callStatus === 'ringing' || callStatus === 'connected'}
                            sessionDismissedIds={sessionDismissedIds}
                            onSessionDismiss={handleSessionDismiss}
                        />

                        <LastCallPreview
                            callLog={lastCallLog}
                            companyName={lastCallCompanyName}
                        />
                    </div>
                </div>
            </div>

            <ConfirmationModal
                isOpen={showExitConfirm}
                onClose={() => setShowExitConfirm(false)}
                onConfirm={handleExit}
                title="Exit Standalone Dialer?"
                message="You have unsaved call details. If you exit now, they will be saved locally and you can finish logging later."
                confirmText={exiting ? "Exiting..." : "Exit Now"}
                cancelText="Stay"
                variant="default"
            />

            <FollowUpNotificationContainer
                notifications={activeNotifications}
                onDismiss={handleDismissNotification}
            />
        </div>
    );
}
