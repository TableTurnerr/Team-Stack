'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Headphones,
    Power,
    Loader2,
    Zap,
    AlertTriangle,
    Phone,
    Square,
    Pause,
    Play,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type PhoneNumber } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { SessionMetrics } from './session-metrics';
import { PerformanceTracker } from './performance-tracker';
import { CurrentCallForm, type CallFormData, type CallFormDraft, type CallbackReason } from './current-call-form';
import { LastCallPreview } from './last-call-preview';
import { SessionModeSelector } from '@/components/session-mode-selector';
import { StandaloneCallInterface } from './standalone-call-interface';
import { ZoomPhoneDialer } from '@/components/zoom-phone-dialer';
import { PowerDialerPanel } from './power-dialer-panel';
import { useFollowUps } from '@/contexts/follow-up-context';

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

import { useSession } from '@/contexts/session-context';

// ... other imports

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';
const UNSAVED_CALL_STORAGE_KEY = 'crm:session:unsaved-call:v1';

interface UnsavedCallStoragePayload {
    phoneNumber: string;
    hasUnsavedCall: boolean;
    draft: CallFormDraft | null;
}

const hasDraftContent = (draft: CallFormDraft | null) => {
    if (!draft) return false;

    return (
        draft.companySearch.trim().length > 0 ||
        !!draft.selectedCompany ||
        draft.recipientName.trim().length > 0 ||
        !!draft.callOutcome ||
        draft.interestLevel !== 5 ||
        draft.postCallNotes.trim().length > 0 ||
        draft.ownerReached ||
        draft.pitchCompleted ||
        draft.appointmentSet ||
        draft.showFollowUp ||
        !!draft.followUpData
    );
};

export default function SessionPage() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { dialNumber, callStatus, isDialing, iframeRef, setIframeReady, refreshDialer, activeCallNumber } = useZoomPhone();
    const { session, setSession, isLoading: sessionLoading, isStandaloneMode, setStandaloneMode } = useSession();
    const { createFollowUp } = useFollowUps();

    // Loading combined
    const loading = sessionLoading;

    // Local UI state
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const [pausing, setPausing] = useState(false);
    const [collectionMissing, setCollectionMissing] = useState(false);
    const [zoomAppConfirmed, setZoomAppConfirmed] = useState(false);
    const [awaitingAudioConnect, setAwaitingAudioConnect] = useState(false);

    // Recording state
    const {
        isSessionActive,
        status: recorderStatus,
        duration: recorderDuration,
        startSession: startAudioSession,
        startRecording,
        stopRecording,
        discardRecording,
        enterDeferredMode,
        submitDeferredRecording,
        discardDeferredRecording,
        error: recorderError,
        setPhoneNumber: setContextPhoneNumber
    } = useCallRecording();

    // Timer
    const [elapsedSec, setElapsedSec] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Current call
    const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
    const [savingCall, setSavingCall] = useState(false);

    // Last call
    const [lastCallLog, setLastCallLog] = useState<CallLog | null>(null);
    const [lastCallCompanyName, setLastCallCompanyName] = useState('');

    // Call timing state
    const [ringStartTime, setRingStartTime] = useState<number | null>(null);
    const [connectTime, setConnectTime] = useState<number | null>(null);
    const [currentCallDuration, setCurrentCallDuration] = useState(0);
    const [dialCountIncremented, setDialCountIncremented] = useState(false);
    const [pickupCountIncremented, setPickupCountIncremented] = useState(false);
    const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Track unsaved call state — true when call ended but form not yet submitted
    const [hasUnsavedCall, setHasUnsavedCall] = useState(false);
    const [callDraft, setCallDraft] = useState<CallFormDraft | null>(null);
    const didHydrateFromStorage = useRef(false);

    // Callback tracking for the current call
    const [callbackEvents, setCallbackEvents] = useState<Array<{ reason: string; timestamp: string }>>([]);

    // ---------------------------------------------------------------------------
    // Power Dialer state
    // ---------------------------------------------------------------------------
    const [powerDialerQueue, setPowerDialerQueue] = useState<string[]>([]);
    const [powerDialerIndex, setPowerDialerIndex] = useState(0);
    const [powerDialerActive, setPowerDialerActive] = useState(false);
    const [powerDialerPaused, setPowerDialerPaused] = useState(false);
    const [powerDialerDelay, setPowerDialerDelay] = useState(2); // seconds; negative = start next call before submit
    // Pins the old call's phone number in the form during a negative-delay overlap
    const [pinnedFormPhoneNumber, setPinnedFormPhoneNumber] = useState('');
    const powerDialerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Refs for reading power dialer state inside effects/timers without stale closures
    const powerDialerQueueRef = useRef<string[]>(powerDialerQueue);
    const powerDialerIndexRef = useRef(powerDialerIndex);
    const powerDialerActiveRef = useRef(powerDialerActive);
    const powerDialerPausedRef = useRef(powerDialerPaused);
    const powerDialerDelayRef = useRef(powerDialerDelay);
    // Keep refs in sync every render
    powerDialerQueueRef.current = powerDialerQueue;
    powerDialerIndexRef.current = powerDialerIndex;
    powerDialerActiveRef.current = powerDialerActive;
    powerDialerPausedRef.current = powerDialerPaused;
    powerDialerDelayRef.current = powerDialerDelay;

    // ---------------------------------------------------------------------------
    // Check for existing active session on mount
    // ---------------------------------------------------------------------------
    useEffect(() => {
        // ... (checkActiveSession logic is handled by context now, but we might want to sync local state if needed, though context is source of truth)
        // actually, we removed the local check in previous step, so we just rely on session from context.
    }, []);

    // ---------------------------------------------------------------------------
    // Restore unsaved call + draft from localStorage
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (didHydrateFromStorage.current) return;
        didHydrateFromStorage.current = true;

        try {
            const raw = window.sessionStorage.getItem(UNSAVED_CALL_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw) as UnsavedCallStoragePayload;
            if (parsed && typeof parsed.phoneNumber === 'string') {
                if (parsed.phoneNumber) {
                    setCurrentPhoneNumber(parsed.phoneNumber);
                    setContextPhoneNumber(parsed.phoneNumber);
                }
                setHasUnsavedCall(!!parsed.hasUnsavedCall);
                setCallDraft(parsed.draft ?? null);
            }
        } catch {
            // Ignore malformed storage payloads
        }
    }, [setContextPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Persist unsaved call + draft to localStorage
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const shouldPersist = hasUnsavedCall || (!!currentPhoneNumber && hasDraftContent(callDraft));

        if (!shouldPersist) {
            window.sessionStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);
            return;
        }

        const payload: UnsavedCallStoragePayload = {
            phoneNumber: currentPhoneNumber,
            hasUnsavedCall,
            draft: callDraft,
        };

        window.sessionStorage.setItem(UNSAVED_CALL_STORAGE_KEY, JSON.stringify(payload));
    }, [hasUnsavedCall, currentPhoneNumber, callDraft]);

    // ---------------------------------------------------------------------------
    // Timer logic
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (session && session.status === 'active') {
            const started = new Date(session.started_at).getTime();
            const totalPausedSec = session.total_paused_sec ?? 0;
            const updateElapsed = () => {
                const now = Date.now();
                // Subtract accumulated pause time and current pause duration so
                // the timer only counts active calling time.
                // When paused, (now - started) - totalPausedSec - (now - paused_at)
                // simplifies to a constant, naturally freezing the display.
                const currentPauseSec = session.paused_at
                    ? Math.floor((now - new Date(session.paused_at).getTime()) / 1000)
                    : 0;
                setElapsedSec(Math.floor((now - started) / 1000) - totalPausedSec - currentPauseSec);
            };
            updateElapsed();
            timerRef.current = setInterval(updateElapsed, 1000);
            return () => {
                if (timerRef.current) clearInterval(timerRef.current);
            };
        } else {
            setElapsedSec(0);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    }, [session]);

    // ---------------------------------------------------------------------------
    // Track call status and timing
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (callStatus === 'ringing') {
            // Call is ringing - start ring timer
            if (!ringStartTime) {
                setRingStartTime(Date.now());
                setConnectTime(null);
                setCurrentCallDuration(0);

                // Increment dial count only once when ringing starts (and only for session mode)
                if (session && !dialCountIncremented) {
                    console.log('[Session Page] Incrementing dial count for session:', session.id);
                    setDialCountIncremented(true);
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                        total_dials: (session.total_dials || 0) + 1
                    }).then(updatedSession => {
                        console.log('[Session Page] Dial count updated:', updatedSession.total_dials);
                        setSession(updatedSession);
                    }).catch(err => console.error('Failed to increment dial count:', err));
                } else if (!session) {
                    console.log('[Session Page] No active session, dial count not incremented');
                } else if (dialCountIncremented) {
                    console.log('[Session Page] Dial already counted for this call');
                }
            }
        } else if (callStatus === 'connected') {
            // Call connected - mark connect time and start call duration timer
            if (!connectTime) {
                setConnectTime(Date.now());

                // Increment pickup count when call is connected (only for session mode)
                if (session && !pickupCountIncremented) {
                    setPickupCountIncremented(true);
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                        total_pickups: (session.total_pickups || 0) + 1
                    }).then(updatedSession => {
                        setSession(updatedSession);
                    }).catch(err => console.error('Failed to increment pickup count:', err));
                }

                // Start call duration timer
                if (callTimerRef.current) clearInterval(callTimerRef.current);
                callTimerRef.current = setInterval(() => {
                    if (connectTime) {
                        setCurrentCallDuration(Math.floor((Date.now() - connectTime) / 1000));
                    }
                }, 1000);
            }
        } else if (callStatus === 'ended') {
            // Call ended - clear timers, mark as unsaved if there was a phone number
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
                callTimerRef.current = null;
            }
            if (currentPhoneNumber) {
                setHasUnsavedCall(true);
                // Pin the phone number so the form keeps showing the old number
                // even if the power dialer auto-dials a new call (negative-delay overlap)
                setPinnedFormPhoneNumber(currentPhoneNumber);
            }
        } else if (callStatus === 'idle') {
            // Idle - just clear timers (don't set unsaved here, it's set on 'ended')
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
                callTimerRef.current = null;
            }
        }

        return () => {
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
            }
        };
    }, [callStatus, ringStartTime, connectTime, session, dialCountIncremented, pickupCountIncremented, setSession, currentPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Power dialer — negative delay: auto-dial next number N seconds after call ends
    // Runs independently of form submission so the user can fill the old form while
    // the next call is already ringing (overlap mode).
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (callStatus !== 'ended') return;
        if (!powerDialerActiveRef.current || powerDialerPausedRef.current) return;
        if (powerDialerDelayRef.current >= 0) return; // positive/zero delay is handled in handleSaveCall
        if (session?.paused_at) return;

        const nextIdx = powerDialerIndexRef.current + 1;
        if (nextIdx >= powerDialerQueueRef.current.length) {
            // Queue exhausted after this call; will be marked done when user submits the last form
            return;
        }

        if (powerDialerTimerRef.current) clearTimeout(powerDialerTimerRef.current);
        const delayMs = Math.abs(powerDialerDelayRef.current) * 1000;
        powerDialerTimerRef.current = setTimeout(() => {
            if (!powerDialerActiveRef.current || powerDialerPausedRef.current) return;
            setPowerDialerIndex(nextIdx);
            // handleDial is captured via ref to always use the latest version
            handleDialRef.current(powerDialerQueueRef.current[nextIdx]);
        }, delayMs);
    }, [callStatus, session?.paused_at]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup power dialer timer on unmount
    useEffect(() => {
        return () => {
            if (powerDialerTimerRef.current) clearTimeout(powerDialerTimerRef.current);
        };
    }, []);

    // Reset count incremented flags when current phone number changes (new call)
    useEffect(() => {
        if (currentPhoneNumber) {
            setDialCountIncremented(false);
            setPickupCountIncremented(false);
        }
    }, [currentPhoneNumber]);

    // Sync currentPhoneNumber from zoom context when a call is initiated from docked dialer
    useEffect(() => {
        if (activeCallNumber && callStatus === 'ringing') {
            // Check if this is a new call (different number or no current number)
            if (!currentPhoneNumber || activeCallNumber !== currentPhoneNumber) {
                console.log('[Session Page] New call detected from dialer:', activeCallNumber);
                setCurrentPhoneNumber(activeCallNumber);
                setContextPhoneNumber(activeCallNumber);

                // Enter deferred mode + start recording if session is active
                if (isSessionActive) {
                    console.log('[Session Page] Starting recording for call:', activeCallNumber);
                    enterDeferredMode();
                    startRecording();
                }
            }
        }
    }, [activeCallNumber, currentPhoneNumber, callStatus, setContextPhoneNumber, isSessionActive, startRecording, enterDeferredMode]);

    // Warn user before closing tab if session is active
    useEffect(() => {
        if (!session || session.status !== 'active') return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Your active session will end if you close this tab. Are you sure you want to leave?';
            return e.returnValue;
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [session]);

    // ---------------------------------------------------------------------------
    // Start session — step 1: show "Connect Audio" screen
    // ---------------------------------------------------------------------------
    const startSession = useCallback(() => {
        setAwaitingAudioConnect(true);
    }, []);

    // ---------------------------------------------------------------------------
    // Connect audio & create PB session — step 2
    // ---------------------------------------------------------------------------
    const handleConnectAudioAndStart = useCallback(async () => {
        if (!user) return;
        try {
            setStarting(true);

            // 1. Start audio session (screen share) first
            const audioStarted = await startAudioSession();
            if (!audioStarted) {
                // User cancelled or failed - stay on Connect Audio screen
                return;
            }

            // 2. Create the session in PocketBase only after screen share is secured
            const newSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).create<ColdCallingSession>({
                user: user.id,
                started_at: new Date().toISOString(),
                total_dials: 0,
                total_pickups: 0,
                total_duration_sec: 0,
                owner_reached: 0,
                pitch_completed: 0,
                appointment_set: 0,
                status: 'active',
                paused_at: null,
                total_paused_sec: 0,
            });
            setSession(newSession);
            setAwaitingAudioConnect(false);
        } catch (err: any) {
            if (err?.status === 404) {
                setCollectionMissing(true);
            } else {
                console.error('Failed to start session:', err);
            }
        } finally {
            setStarting(false);
        }
    }, [user, setSession, startAudioSession]);

    // ---------------------------------------------------------------------------
    // End session
    // ---------------------------------------------------------------------------
    const endSession = useCallback(async () => {
        if (!session) return;
        try {
            setEnding(true);
            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, {
                ended_at: new Date().toISOString(),
                total_duration_sec: elapsedSec,
                status: 'completed',
            });
            setSession(null);
            setLastCallLog(null);
            setLastCallCompanyName('');
            setCurrentPhoneNumber('');
            setHasUnsavedCall(false);
            setCallDraft(null);
            setCallbackEvents([]);
            setContextPhoneNumber(''); // Clear phone number in context
            window.sessionStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);

            // Reset power dialer
            setPowerDialerActive(false);
            setPowerDialerPaused(false);
            setPowerDialerIndex(0);
            setPinnedFormPhoneNumber('');
            if (powerDialerTimerRef.current) {
                clearTimeout(powerDialerTimerRef.current);
                powerDialerTimerRef.current = null;
            }
        } catch (err) {
            console.error('Failed to end session:', err);
        } finally {
            setEnding(false);
        }
    }, [session, elapsedSec, setSession, setContextPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Pause session
    // ---------------------------------------------------------------------------
    const pauseSession = useCallback(async () => {
        if (!session || session.paused_at) return;
        try {
            setPausing(true);
            const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                paused_at: new Date().toISOString(),
            });
            setSession(updated);
        } catch (err) {
            console.error('Failed to pause session:', err);
        } finally {
            setPausing(false);
        }
    }, [session, setSession]);

    // ---------------------------------------------------------------------------
    // Resume session
    // ---------------------------------------------------------------------------
    const resumeSession = useCallback(async () => {
        if (!session || !session.paused_at) return;
        try {
            setPausing(true);
            const pausedDuration = Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000);
            const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                paused_at: null,
                total_paused_sec: (session.total_paused_sec ?? 0) + pausedDuration,
            });
            setSession(updated);
        } catch (err) {
            console.error('Failed to resume session:', err);
        } finally {
            setPausing(false);
        }
    }, [session, setSession]);

    // ---------------------------------------------------------------------------
    // Start standalone mode
    // ---------------------------------------------------------------------------
    const startStandalone = useCallback(() => {
        setStandaloneMode(true);
    }, [setStandaloneMode]);

    // ---------------------------------------------------------------------------
    // Exit standalone mode
    // ---------------------------------------------------------------------------
    const exitStandalone = useCallback(() => {
        setStandaloneMode(false);
        setLastCallLog(null);
        setLastCallCompanyName('');
        setCurrentPhoneNumber('');
    }, [setStandaloneMode]);

    // ---------------------------------------------------------------------------
    // Handle dial
    // ---------------------------------------------------------------------------
    const handleDial = useCallback((phoneNumber: string) => {
        // Prevent double dialing
        if (isDialing || callStatus === 'ringing' || callStatus === 'connected') {
            console.log('Call already in progress, ignoring dial request');
            return;
        }

        // Prevent dialing while session is paused
        if (session?.paused_at) {
            console.log('Session is paused, ignoring dial request');
            return;
        }

        setCurrentPhoneNumber(phoneNumber);
        setContextPhoneNumber(phoneNumber); // Update phone number in context

        // Enter deferred mode so recordings accumulate in memory (enables callback merging)
        // and start recording immediately when dialing IF session is active
        if (isSessionActive) {
            enterDeferredMode();
            startRecording();
        }

        dialNumber(phoneNumber);
    }, [dialNumber, isSessionActive, startRecording, enterDeferredMode, setContextPhoneNumber, isDialing, callStatus]);

    // Ref so power dialer timers always call the latest handleDial (avoids stale closures)
    const handleDialRef = useRef(handleDial);
    handleDialRef.current = handleDial;

    // ---------------------------------------------------------------------------
    // Handle callback — dial same number, accumulate recording, log reason
    // ---------------------------------------------------------------------------
    const handleCallback = useCallback((reason: string) => {
        if (!currentPhoneNumber) return;

        // Log this callback event
        const event = { reason, timestamp: new Date().toISOString() };
        setCallbackEvents(prev => [...prev, event]);

        // Reset timing for the new call leg
        setRingStartTime(null);
        setConnectTime(null);
        setCurrentCallDuration(0);
        setDialCountIncremented(false);
        setPickupCountIncremented(false);

        // Deferred mode should already be active from the initial dial.
        // The current recording segment is saved automatically when the
        // call ends. Now just dial again — startRecording will be triggered
        // by the ringing→connected transition via call-recorder-controls or
        // the session page's sync effect.
        dialNumber(currentPhoneNumber);
    }, [currentPhoneNumber, dialNumber]);

    // ---------------------------------------------------------------------------
    // Save call
    // ---------------------------------------------------------------------------
    const handleSaveCall = useCallback(async (data: CallFormData) => {
        setContextPhoneNumber(''); // Clear phone number in context

        if (!session || !user) return;

        // Handle recording based on outcome
        if (data.callOutcome === 'No Answer') {
            // Discard recording — No Answer calls should not be saved
            discardDeferredRecording();
        } else {
            // Submit the (potentially merged) deferred recording
            submitDeferredRecording().catch(err => console.error('Failed to submit recording:', err));
        }

        try {
            setSavingCall(true);

            // Find or note the phone_number_record
            let phoneNumberRecordId = '';
            try {
                const digits = data.phoneNumber.replace(/\D/g, '');
                const last10 = digits.slice(-10);
                const filterParts = [`phone_number = "${data.phoneNumber}"`];
                if (digits !== data.phoneNumber) {
                    filterParts.push(`phone_number ~ "${digits}"`);
                }
                if (last10 !== digits && last10.length >= 7) {
                    filterParts.push(`phone_number ~ "${last10}"`);
                }

                const phoneRecords = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                    filter: `company = "${data.companyId}" && (${filterParts.join(' || ')})`,
                });
                if (phoneRecords.items.length > 0) {
                    phoneNumberRecordId = phoneRecords.items[0].id;
                } else {
                    // Create a new phone number record
                    const newPhone = await pb.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                        company: data.companyId,
                        phone_number: data.phoneNumber,
                        receptionist_name: data.recipientName || undefined,
                        last_called: new Date().toISOString(),
                    });
                    phoneNumberRecordId = newPhone.id;
                }
            } catch {
                // If phone number lookup/creation fails, still log the call
            }

            // Calculate call durations
            let ringDuration = 0;
            let callDuration = 0;
            let totalDuration = 0;

            if (ringStartTime) {
                const endTime = Date.now();
                if (connectTime) {
                    // Call was picked up
                    ringDuration = Math.floor((connectTime - ringStartTime) / 1000);
                    callDuration = Math.floor((endTime - connectTime) / 1000);
                    totalDuration = ringDuration + callDuration;
                } else {
                    // Call was not picked up (just rang)
                    ringDuration = Math.floor((endTime - ringStartTime) / 1000);
                    totalDuration = ringDuration;
                }
            }

            // Create call log with performance tracking
            const callLog = await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
                company: data.companyId,
                phone_number_record: phoneNumberRecordId || undefined,
                caller: user.id,
                call_time: new Date().toISOString(),
                duration: totalDuration > 0 ? totalDuration : undefined,
                ring_duration: ringDuration > 0 ? ringDuration : undefined,
                call_duration: callDuration > 0 ? callDuration : undefined,
                call_outcome: data.callOutcome,
                interest_level: data.interestLevel || undefined,
                post_call_notes: data.postCallNotes || undefined,
                owner_name_found: data.recipientName || undefined,
                session: session.id,
                owner_reached: data.ownerReached,
                pitch_completed: data.pitchCompleted,
                appointment_set: data.appointmentSet,
                callback_events: data.callbackEvents && data.callbackEvents.length > 0
                    ? data.callbackEvents
                    : undefined,
            });

            // Update session performance totals based on this call
            const sessionUpdates: Partial<ColdCallingSession> = {};
            if (data.ownerReached) {
                sessionUpdates.owner_reached = (session.owner_reached || 0) + 1;
            }
            if (data.pitchCompleted) {
                sessionUpdates.pitch_completed = (session.pitch_completed || 0) + 1;
            }
            if (data.appointmentSet) {
                sessionUpdates.appointment_set = (session.appointment_set || 0) + 1;
            }
            // No Answer: undo the pickup count if it was already incremented
            // (pickup is incremented when call connects, but No Answer means no human pickup)
            if (data.callOutcome === 'No Answer' && pickupCountIncremented && (session.total_pickups || 0) > 0) {
                sessionUpdates.total_pickups = Math.max(0, (session.total_pickups || 0) - 1);
            }

            // Update session if there are any performance updates
            if (Object.keys(sessionUpdates).length > 0) {
                await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, sessionUpdates);
            }

            // Update company metadata (last_contacted, source, first_contacted)
            try {
                const companyUpdates: Record<string, any> = {
                    last_contacted: new Date().toISOString(),
                };
                const existingCompany = await pb.collection(COLLECTIONS.COMPANIES).getOne(data.companyId);
                if (!existingCompany.source) {
                    companyUpdates.source = 'Cold Call';
                }
                if (!existingCompany.first_contacted) {
                    companyUpdates.first_contacted = new Date().toISOString();
                }
                if (data.ownerReached && data.recipientName && !existingCompany.owner_name) {
                    companyUpdates.owner_name = data.recipientName;
                }
                await pb.collection(COLLECTIONS.COMPANIES).update(data.companyId, companyUpdates);
            } catch {
                // Non-critical — don't block call save
            }

            // Create follow-up if scheduled
            if (data.followUp) {
                try {
                    await createFollowUp({
                        company: data.companyId,
                        phone_number_record: phoneNumberRecordId || undefined,
                        call_log: callLog.id,
                        scheduled_time: data.followUp.scheduledTime,
                        client_timezone: data.followUp.timezone,
                        notes: data.followUp.notes || undefined,
                    });
                } catch (err) {
                    console.error('Failed to create follow-up:', err);
                }
            }

            // Note: dial count and pickup count are now incremented automatically when calls ring/connect
            // No need to update them here - just refresh the session
            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getOne<ColdCallingSession>(session.id);
            setSession(updatedSession);

            // Shift to last call preview
            setLastCallLog(callLog);
            setLastCallCompanyName(data.companyName);
            setCurrentPhoneNumber('');

            // Clear unsaved call state
            setHasUnsavedCall(false);
            setCallDraft(null);
            setCallbackEvents([]);
            window.sessionStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);

            // Reset call timing state for next call
            setRingStartTime(null);
            setConnectTime(null);
            setCurrentCallDuration(0);
            setDialCountIncremented(false);
            setPickupCountIncremented(false);

            // Clear pinned phone number now that the form has been submitted
            setPinnedFormPhoneNumber('');

            // Power dialer — positive / zero delay: schedule next dial after form submit
            // Negative delay is handled by the callStatus 'ended' effect (no action needed here)
            if (powerDialerActiveRef.current && !powerDialerPausedRef.current && powerDialerDelayRef.current >= 0) {
                const nextIdx = powerDialerIndexRef.current + 1;
                if (nextIdx >= powerDialerQueueRef.current.length) {
                    setPowerDialerActive(false);
                } else {
                    setPowerDialerIndex(nextIdx);
                    if (powerDialerTimerRef.current) clearTimeout(powerDialerTimerRef.current);
                    const delayMs = powerDialerDelayRef.current * 1000;
                    const nextNumber = powerDialerQueueRef.current[nextIdx];
                    powerDialerTimerRef.current = setTimeout(() => {
                        handleDialRef.current(nextNumber);
                    }, delayMs);
                }
            }
        } catch (err) {
            console.error('Failed to save call:', err);
        } finally {
            setSavingCall(false);
        }
    }, [session, user, discardDeferredRecording, submitDeferredRecording, setSession, setContextPhoneNumber, ringStartTime, connectTime, pickupCountIncremented, createFollowUp]);

    const handleDiscardCall = useCallback(() => {
        discardDeferredRecording();
        setContextPhoneNumber('');

        setHasUnsavedCall(false);
        setCallDraft(null);
        setCallbackEvents([]);
        setCurrentPhoneNumber('');
        setPinnedFormPhoneNumber('');
        setRingStartTime(null);
        setConnectTime(null);
        setCurrentCallDuration(0);
        setDialCountIncremented(false);
        setPickupCountIncremented(false);
        window.sessionStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);

        // Cancel any pending power dialer auto-dial
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, [discardDeferredRecording, setContextPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Power dialer handlers
    // ---------------------------------------------------------------------------
    const handlePowerDialerStart = useCallback(() => {
        if (powerDialerQueue.length === 0 || hasUnsavedCall) return;
        if (callStatus === 'ringing' || callStatus === 'connected') return;
        setPowerDialerActive(true);
        setPowerDialerPaused(false);
        handleDial(powerDialerQueue[powerDialerIndex]);
    }, [powerDialerQueue, powerDialerIndex, hasUnsavedCall, callStatus, handleDial]);

    const handlePowerDialerPause = useCallback(() => {
        setPowerDialerPaused(true);
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, []);

    const handlePowerDialerResume = useCallback(() => {
        setPowerDialerPaused(false);
        // Next dial fires naturally on the next form-submit (positive delay) or call-end (negative delay)
    }, []);

    const handlePowerDialerStop = useCallback(() => {
        setPowerDialerActive(false);
        setPowerDialerPaused(false);
        setPowerDialerIndex(0);
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, []);

    const handlePowerDialerQueueLoad = useCallback((numbers: string[]) => {
        setPowerDialerQueue(numbers);
        setPowerDialerIndex(0);
        setPowerDialerActive(false);
        setPowerDialerPaused(false);
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, []);

    // ---------------------------------------------------------------------------
    // Update performance counters
    // ---------------------------------------------------------------------------
    const handlePerformanceUpdate = useCallback(async (
        field: 'owner_reached' | 'pitch_completed' | 'appointment_set',
        value: number
    ) => {
        if (!session) return;
        try {
            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                session.id,
                { [field]: value }
            );
            setSession(updatedSession);
        } catch (err) {
            console.error('Failed to update performance counter:', err);
        }
    }, [session, setSession]);

    // ---------------------------------------------------------------------------
    // Helper to render the main UI content
    // ---------------------------------------------------------------------------
    const renderContent = () => {
        if (collectionMissing) {
            return (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="text-center space-y-4 max-w-md">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--warning-subtle)] flex items-center justify-center mx-auto">
                            <AlertTriangle size={28} className="text-[var(--warning)]" />
                        </div>
                        <h1 className="text-xl font-bold">Collection Setup Required</h1>
                        <p className="text-sm text-[var(--muted)] leading-relaxed">
                            The <code className="px-1.5 py-0.5 rounded bg-[var(--sidebar-bg)] text-xs font-mono">cold_calling_sessions</code> collection
                            doesn&apos;t exist in PocketBase yet. Import the updated schema to enable Call Sessions.
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                            Import <code className="px-1 py-0.5 rounded bg-[var(--sidebar-bg)] font-mono text-[10px]">pb_schema_exported.json</code> from
                            the <code className="px-1 py-0.5 rounded bg-[var(--sidebar-bg)] font-mono text-[10px]">packages/pocketbase-client</code> directory.
                        </p>
                    </div>
                </div>
            );
        }

        if (authLoading || loading) {
            return (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
                </div>
            );
        }

        if (!session) {
            if (isStandaloneMode) {
                if (!isSessionActive) {
                    return (
                        <div className="flex items-center justify-center min-h-[60vh]">
                            <div className="text-center space-y-6 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--card-border)] shadow-xl">
                                <div className="w-16 h-16 rounded-2xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto animate-pulse">
                                    <Headphones size={32} className="text-[var(--error)]" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold mb-2">Connect Audio to Start</h2>
                                    <p className="text-[var(--muted)] text-sm mb-4">
                                        Recording must be enabled before you can make standalone calls.
                                    </p>
                                </div>
                                <div className="text-left bg-[var(--sidebar-bg)] p-4 rounded-xl space-y-3 text-sm border border-[var(--card-border)]">
                                    <p className="font-medium text-[var(--foreground)]">Instructions:</p>
                                    <ol className="list-decimal list-inside space-y-2 text-[var(--muted)]">
                                        <li>Click <span className="font-semibold text-[var(--foreground)]">Connect Audio</span> below</li>
                                        <li>Select the <span className="font-semibold text-[var(--foreground)]">Window</span> tab</li>
                                        <li>Choose the <span className="font-semibold text-[var(--foreground)]">Chrome window</span> (this window)</li>
                                        <li><span className="text-[var(--error)] font-bold">IMPORTANT:</span> Toggle <span className="font-semibold text-[var(--foreground)]">Share system audio</span> &quot;ON&quot; at the bottom</li>
                                        <li>Make sure <span className="font-semibold text-[var(--foreground)]">Zoom Workplace app</span> is running on your device</li>
                                    </ol>
                                </div>
                                <label className="flex items-center gap-3 cursor-pointer bg-[var(--sidebar-bg)] p-3 rounded-xl border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors text-left group">
                                    <input
                                        type="checkbox"
                                        checked={zoomAppConfirmed}
                                        onChange={(e) => {
                                            setZoomAppConfirmed(e.target.checked);
                                            if (e.target.checked) refreshDialer();
                                        }}
                                        className="w-4 h-4 rounded border-[var(--card-border)] text-blue-500 focus:ring-blue-500 cursor-pointer"
                                    />
                                    <span className="text-sm font-medium group-hover:text-[var(--foreground)] transition-colors">
                                        <span className="text-[var(--error)]">Zoom Workplace app</span> is running and logged in
                                    </span>
                                </label>
                                {recorderError && (
                                    <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                        {recorderError}
                                    </div>
                                )}
                                <button
                                    onClick={startAudioSession}
                                    disabled={!zoomAppConfirmed}
                                    className="w-full py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                    Connect Audio & Start
                                </button>
                            </div>
                        </div>
                    );
                }
                return <StandaloneCallInterface onExit={exitStandalone} />;
            }

            // Show "Connect Audio" screen after user clicked "Start Session"
            if (awaitingAudioConnect) {
                return (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center space-y-6 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--card-border)] shadow-xl">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto animate-pulse">
                                <Headphones size={32} className="text-[var(--error)]" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold mb-2">Connect Audio to Start</h2>
                                <p className="text-[var(--muted)] text-sm mb-4">
                                    Screen share with system audio is required to record calls.
                                </p>
                            </div>
                            <div className="text-left bg-[var(--sidebar-bg)] p-4 rounded-xl space-y-3 text-sm border border-[var(--card-border)]">
                                <p className="font-medium text-[var(--foreground)]">Instructions:</p>
                                <ol className="list-decimal list-inside space-y-2 text-[var(--muted)]">
                                    <li>Click <span className="font-semibold text-[var(--foreground)]">Connect Audio & Start</span> below</li>
                                    <li>Select the <span className="font-semibold text-[var(--foreground)]">Window</span> tab</li>
                                    <li>Choose the <span className="font-semibold text-[var(--foreground)]">Chrome window</span> (this window)</li>
                                    <li><span className="text-[var(--error)] font-bold">IMPORTANT:</span> Toggle <span className="font-semibold text-[var(--foreground)]">Share system audio</span> &quot;ON&quot; at the bottom</li>
                                    <li>Make sure <span className="font-semibold text-[var(--foreground)]">Zoom Workplace app</span> is running on your device</li>
                                </ol>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer bg-[var(--sidebar-bg)] p-3 rounded-xl border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors text-left group">
                                <input
                                    type="checkbox"
                                    checked={zoomAppConfirmed}
                                    onChange={(e) => {
                                        setZoomAppConfirmed(e.target.checked);
                                        if (e.target.checked) refreshDialer();
                                    }}
                                    className="w-4 h-4 rounded border-[var(--card-border)] text-blue-500 focus:ring-blue-500 cursor-pointer"
                                />
                                <span className="text-sm font-medium group-hover:text-[var(--foreground)] transition-colors">
                                    <span className="text-[var(--error)]">Zoom Workplace app</span> is running and logged in
                                </span>
                            </label>
                            {recorderError && (
                                <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                    {recorderError}
                                </div>
                            )}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setAwaitingAudioConnect(false)}
                                    className="flex-1 py-3 rounded-xl bg-[var(--sidebar-bg)] text-[var(--foreground)] font-semibold text-sm border border-[var(--card-border)] hover:bg-[var(--card-hover)] active:scale-[0.98] transition-all"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={handleConnectAudioAndStart}
                                    disabled={!zoomAppConfirmed || starting}
                                    className="flex-[2] py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                    {starting ? 'Connecting...' : 'Connect Audio & Start'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            return <SessionModeSelector onStartSession={startSession} onStartStandalone={startStandalone} />;
        }

        if (!isSessionActive) {
            // Session exists but audio disconnected (e.g. page reload) - reconnect audio
            return (
                <div className="space-y-6">
                    {/* Active Session Banner */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold">Call Session</h1>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--success-subtle)] text-[var(--success)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                                Active
                            </span>
                            <span className="text-lg font-mono font-semibold tabular-nums text-[var(--muted)]">
                                {formatDuration(elapsedSec)}
                            </span>
                        </div>

                        <button
                            onClick={endSession}
                            disabled={ending}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-medium text-sm border border-[var(--error)]/30 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                        >
                            {ending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                            {ending ? 'Ending...' : 'End Session'}
                        </button>
                    </div>

                    <div className="flex items-center justify-center min-h-[50vh]">
                        <div className="text-center space-y-6 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--card-border)] shadow-xl">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto animate-pulse">
                                <Headphones size={32} className="text-[var(--error)]" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold mb-2">Reconnect Audio</h2>
                                <p className="text-[var(--muted)] text-sm mb-4">
                                    Your session is still active. Reconnect screen share to continue calling.
                                </p>
                            </div>
                            <div className="text-left bg-[var(--sidebar-bg)] p-4 rounded-xl space-y-3 text-sm border border-[var(--card-border)]">
                                <p className="font-medium text-[var(--foreground)]">Instructions:</p>
                                <ol className="list-decimal list-inside space-y-2 text-[var(--muted)]">
                                    <li>Click <span className="font-semibold text-[var(--foreground)]">Connect Audio</span> below</li>
                                    <li>Select the <span className="font-semibold text-[var(--foreground)]">Window</span> tab</li>
                                    <li>Choose the <span className="font-semibold text-[var(--foreground)]">Chrome window</span> (this window)</li>
                                    <li><span className="text-[var(--error)] font-bold">IMPORTANT:</span> Toggle <span className="font-semibold text-[var(--foreground)]">Share system audio</span> &quot;ON&quot; at the bottom</li>
                                </ol>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer bg-[var(--sidebar-bg)] p-3 rounded-xl border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors text-left group">
                                <input
                                    type="checkbox"
                                    checked={zoomAppConfirmed}
                                    onChange={(e) => {
                                        setZoomAppConfirmed(e.target.checked);
                                        if (e.target.checked) refreshDialer();
                                    }}
                                    className="w-4 h-4 rounded border-[var(--card-border)] text-blue-500 focus:ring-blue-500 cursor-pointer"
                                />
                                <span className="text-sm font-medium group-hover:text-[var(--foreground)] transition-colors">
                                    <span className="text-[var(--error)]">Zoom Workplace app</span> is running and logged in
                                </span>
                            </label>
                            {recorderError && (
                                <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                    {recorderError}
                                </div>
                            )}
                            <button
                                onClick={startAudioSession}
                                disabled={!zoomAppConfirmed}
                                className="w-full py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                            >
                                Connect Audio
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">Call Session</h1>
                        {session.paused_at ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--warning-subtle)] text-[var(--warning)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
                                Paused
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--success-subtle)] text-[var(--success)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                                Active
                            </span>
                        )}
                        <span className="text-lg font-mono font-semibold tabular-nums text-[var(--muted)]">
                            {formatDuration(elapsedSec)}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {session.paused_at ? (
                            <button
                                onClick={resumeSession}
                                disabled={pausing}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--success-subtle)] text-[var(--success)] font-medium text-sm border border-[var(--success)]/30 hover:bg-[var(--success)] hover:text-white transition-all disabled:opacity-50"
                            >
                                {pausing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                                {pausing ? 'Resuming...' : 'Resume Session'}
                            </button>
                        ) : (
                            <button
                                onClick={pauseSession}
                                disabled={pausing}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] font-medium text-sm border border-[var(--warning)]/30 hover:bg-[var(--warning)] hover:text-white transition-all disabled:opacity-50"
                            >
                                {pausing ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />}
                                {pausing ? 'Pausing...' : 'Pause Session'}
                            </button>
                        )}
                        <button
                            onClick={endSession}
                            disabled={ending}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-medium text-sm border border-[var(--error)]/30 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                        >
                            {ending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                            {ending ? 'Ending...' : 'End Session'}
                        </button>
                    </div>
                </div>

                {/* Current Call Timer - shown when call is active */}
                {(callStatus === 'ringing' || callStatus === 'connected') && (
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                {callStatus === 'ringing' ? (
                                    <>
                                        <div className="w-12 h-12 rounded-full bg-[var(--warning-subtle)] flex items-center justify-center">
                                            <Phone className="w-6 h-6 text-[var(--warning)] animate-bounce" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-lg">Ringing...</p>
                                            <p className="text-sm text-[var(--muted)]">
                                                Ring Duration: {ringStartTime ? Math.floor((Date.now() - ringStartTime) / 1000) : 0}s
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-12 h-12 rounded-full bg-[var(--success-subtle)] flex items-center justify-center">
                                            <Phone className="w-6 h-6 text-[var(--success)]" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-lg">Call Connected</p>
                                            <div className="flex gap-4 text-sm text-[var(--muted)]">
                                                <span>Ring: {ringStartTime && connectTime ? Math.floor((connectTime - ringStartTime) / 1000) : 0}s</span>
                                                <span>Call: {currentCallDuration}s</span>
                                                <span className="font-medium text-[var(--foreground)]">
                                                    Total: {(ringStartTime && connectTime ? Math.floor((connectTime - ringStartTime) / 1000) : 0) + currentCallDuration}s
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-6">
                                {/* Recording Indicator & Manual Stop */}
                                {recorderStatus === 'recording' && (
                                    <div className="flex items-center gap-3 pr-6 border-r border-[var(--card-border)]">
                                        <div className="flex flex-col items-end">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                                <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Recording</span>
                                            </div>
                                            <span className="text-xs font-mono font-medium">{Math.floor(recorderDuration / 60)}:{(recorderDuration % 60).toString().padStart(2, '0')}</span>
                                        </div>
                                        <button
                                            onClick={() => stopRecording()}
                                            className="p-2 rounded-lg bg-[var(--sidebar-bg)] border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-all group"
                                            title="Stop Recording"
                                        >
                                            <Square size={16} fill="currentColor" className="group-hover:fill-white" />
                                        </button>
                                    </div>
                                )}

                                <div className="text-right">
                                    <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Phone Number</p>
                                    <p className="font-mono text-sm font-medium">{currentPhoneNumber || 'Unknown'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Docked Zoom Phone Dialer - Above Current Call section */}
                <div className="relative">
                    <ZoomPhoneDialer docked disabled={hasUnsavedCall || !!session.paused_at} />
                    {session.paused_at && (
                        <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-[1px] flex items-center justify-center rounded-xl z-10 pointer-events-none">
                            <p className="text-sm font-medium text-[var(--muted)]">Resume session to make calls</p>
                        </div>
                    )}
                </div>

                {/* Power Dialer — between Zoom dialer and main grid */}
                <PowerDialerPanel
                    queue={powerDialerQueue}
                    currentIndex={powerDialerIndex}
                    active={powerDialerActive}
                    paused={powerDialerPaused}
                    delay={powerDialerDelay}
                    onStart={handlePowerDialerStart}
                    onPause={handlePowerDialerPause}
                    onResume={handlePowerDialerResume}
                    onStop={handlePowerDialerStop}
                    onDelayChange={setPowerDialerDelay}
                    onQueueLoad={handlePowerDialerQueueLoad}
                    disabled={!!session.paused_at}
                    canStart={!hasUnsavedCall && callStatus !== 'ringing' && callStatus !== 'connected'}
                />

                {/* Main layout */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Left column — 60% */}
                    <div className="lg:col-span-3 space-y-6">
                        <CurrentCallForm
                            phoneNumber={hasUnsavedCall ? (pinnedFormPhoneNumber || currentPhoneNumber) : currentPhoneNumber}
                            onSave={handleSaveCall}
                            saving={savingCall}
                            hasUnsavedCall={hasUnsavedCall}
                            initialDraft={callDraft}
                            onDraftChange={setCallDraft}
                            onDiscard={handleDiscardCall}
                            isCallLive={callStatus === 'ringing' || callStatus === 'connected'}
                            onCallback={handleCallback}
                            callbackEvents={callbackEvents}
                        />
                    </div>

                    {/* Right column — 40% */}
                    <div className="lg:col-span-2 space-y-6">
                        <SessionMetrics
                            totalDials={session.total_dials || 0}
                            totalPickups={session.total_pickups || 0}
                            durationSec={elapsedSec}
                        />
                        <PerformanceTracker
                            ownerReached={session.owner_reached || 0}
                            pitchCompleted={session.pitch_completed || 0}
                            appointmentSet={session.appointment_set || 0}
                            onUpdate={handlePerformanceUpdate}
                        />
                        <LastCallPreview
                            callLog={lastCallLog}
                            companyName={lastCallCompanyName}
                            sessionId={session.id}
                        />
                    </div>
                </div>
            </div>
        );
    };

    return renderContent();
}
