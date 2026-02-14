'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Headphones,
    Power,
    Loader2,
    Zap,
    AlertTriangle,
    Phone,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type PhoneNumber } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { SessionMetrics } from './session-metrics';
import { PerformanceTracker } from './performance-tracker';
import { SessionDialer } from './session-dialer';
import { CurrentCallForm, type CallFormData } from './current-call-form';
import { LastCallPreview } from './last-call-preview';
import { SessionModeSelector } from '@/components/session-mode-selector';
import { StandaloneCallInterface } from './standalone-call-interface';

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

import { useSession } from '@/contexts/session-context';

// ... other imports

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';

export default function SessionPage() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { dialNumber, callStatus, isDialing, iframeRef, setIframeReady } = useZoomPhone();
    const { session, setSession, isLoading: sessionLoading, isStandaloneMode, setStandaloneMode } = useSession();

    // Loading combined
    const loading = sessionLoading;

    // Local UI state
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const [collectionMissing, setCollectionMissing] = useState(false);

    // Recording state
    const {
        isSessionActive,
        startSession: startAudioSession,
        startRecording,
        stopRecording,
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

    // ---------------------------------------------------------------------------
    // Check for existing active session on mount
    // ---------------------------------------------------------------------------
    useEffect(() => {
        // ... (checkActiveSession logic is handled by context now, but we might want to sync local state if needed, though context is source of truth)
        // actually, we removed the local check in previous step, so we just rely on session from context.
    }, []);

    // ---------------------------------------------------------------------------
    // Timer logic
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (session && session.status === 'active') {
            // Calculate elapsed from started_at
            const started = new Date(session.started_at).getTime();
            const updateElapsed = () => {
                const now = Date.now();
                setElapsedSec(Math.floor((now - started) / 1000));
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
                    setDialCountIncremented(true);
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                        total_dials: (session.total_dials || 0) + 1
                    }).then(updatedSession => {
                        setSession(updatedSession);
                    }).catch(err => console.error('Failed to increment dial count:', err));
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
        } else if (callStatus === 'ended' || callStatus === 'idle') {
            // Call ended - clear timers only (phone number will be cleared when call is saved or new call is dialed)
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
    }, [callStatus, ringStartTime, connectTime, session, dialCountIncremented, pickupCountIncremented, setSession]);

    // Reset count incremented flags when current phone number changes (new call)
    useEffect(() => {
        if (currentPhoneNumber) {
            setDialCountIncremented(false);
            setPickupCountIncremented(false);
        }
    }, [currentPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Start session
    // ---------------------------------------------------------------------------
    const startSession = useCallback(async () => {
        if (!user) return;
        try {
            setStarting(true);
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
            });
            setSession(newSession);
        } catch (err: any) {
            if (err?.status === 404) {
                setCollectionMissing(true);
            } else {
                console.error('Failed to start session:', err);
            }
        } finally {
            setStarting(false);
        }
    }, [user, setSession]);

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
            setContextPhoneNumber(''); // Clear phone number in context
        } catch (err) {
            console.error('Failed to end session:', err);
        } finally {
            setEnding(false);
        }
    }, [session, elapsedSec, setSession, setContextPhoneNumber]);

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

        setCurrentPhoneNumber(phoneNumber);
        setContextPhoneNumber(phoneNumber); // Update phone number in context

        // Start recording immediately when dialing IF session is active
        if (isSessionActive) {
            startRecording();
        }

        dialNumber(phoneNumber);
    }, [dialNumber, isSessionActive, startRecording, setContextPhoneNumber, isDialing, callStatus]);

    // ---------------------------------------------------------------------------
    // Save call
    // ---------------------------------------------------------------------------
    const handleSaveCall = useCallback(async (data: CallFormData) => {
        // Stop recording when saving the call
        stopRecording();
        setContextPhoneNumber(''); // Clear phone number in context

        if (!session || !user) return;

        try {
            setSavingCall(true);

            // Find or note the phone_number_record
            let phoneNumberRecordId = '';
            try {
                const phoneRecords = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                    filter: `company = "${data.companyId}" && phone_number ~ "${data.phoneNumber.replace(/\D/g, '').slice(-10)}"`,
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
                interest_level: data.interestLevel,
                post_call_notes: data.postCallNotes,
                owner_name_found: data.recipientName || undefined,
                session: session.id,
                owner_reached: data.ownerReached,
                pitch_completed: data.pitchCompleted,
                appointment_set: data.appointmentSet,
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

            // Update session if there are any performance updates
            if (Object.keys(sessionUpdates).length > 0) {
                await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, sessionUpdates);
            }

            // Note: dial count and pickup count are now incremented automatically when calls ring/connect
            // No need to update them here - just refresh the session
            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getOne<ColdCallingSession>(session.id);
            setSession(updatedSession);

            // Shift to last call preview
            setLastCallLog(callLog);
            setLastCallCompanyName(data.companyName);
            setCurrentPhoneNumber('');

            // Reset call timing state for next call
            setRingStartTime(null);
            setConnectTime(null);
            setCurrentCallDuration(0);
            setDialCountIncremented(false);
            setPickupCountIncremented(false);
        } catch (err) {
            console.error('Failed to save call:', err);
        } finally {
            setSavingCall(false);
        }
    }, [session, user, stopRecording, setSession, setContextPhoneNumber, ringStartTime, connectTime]);

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
    // Collection not set up yet
    // ---------------------------------------------------------------------------
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

    // ---------------------------------------------------------------------------
    // Loading state
    // ---------------------------------------------------------------------------
    if (authLoading || loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
            </div>
        );
    }

    // ---------------------------------------------------------------------------
    // No active session — show mode selector or standalone interface
    // ---------------------------------------------------------------------------
    if (!session) {
        // If standalone mode is active, show standalone interface
        if (isStandaloneMode) {
            // Check if audio is connected
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
                                </ol>
                            </div>

                            {recorderError && (
                                <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                    {recorderError}
                                </div>
                            )}

                            <button
                                onClick={startAudioSession}
                                className="w-full py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all"
                            >
                                Connect Audio & Start
                            </button>
                        </div>
                    </div>
                );
            }

            // Audio is connected, show standalone interface
            return <StandaloneCallInterface onExit={exitStandalone} />;
        }

        // Not in standalone mode and no session - show mode selector
        return <SessionModeSelector onStartSession={startSession} onStartStandalone={startStandalone} />;
    }

    // ---------------------------------------------------------------------------
    // Active session BUT Audio Not Connected
    // ---------------------------------------------------------------------------
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
                            Recording must be enabled before you can start calling.
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

                    {recorderError && (
                        <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                            {recorderError}
                        </div>
                    )}

                    <button
                        onClick={startAudioSession}
                        className="w-full py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all"
                    >
                        Connect Audio & Start
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------------------------
    // Active session
    // ---------------------------------------------------------------------------
    return (
        <div className="space-y-6">
            {/* Header */}
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
                        <div className="text-right">
                            <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Phone Number</p>
                            <p className="font-mono text-sm font-medium">{currentPhoneNumber || 'Unknown'}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Main layout */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left column — 60% */}
                <div className="lg:col-span-3 space-y-6">
                    <SessionDialer onDial={handleDial} />
                    <CurrentCallForm
                        phoneNumber={currentPhoneNumber}
                        onSave={handleSaveCall}
                        saving={savingCall}
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

            {/* Hidden Zoom Phone iframe for making calls */}
            <iframe
                ref={iframeRef}
                src={ZOOM_EMBED_URL}
                onLoad={() => setIframeReady(true)}
                className="hidden"
                allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                title="Zoom Phone"
                style={{ display: 'none' }}
            />
        </div>
    );
}
