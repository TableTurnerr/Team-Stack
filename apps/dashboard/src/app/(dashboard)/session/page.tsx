'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Headphones,
    Power,
    Loader2,
    Zap,
    AlertTriangle,
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

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

import { useSession } from '@/contexts/session-context';

// ... other imports

export default function SessionPage() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { dialNumber } = useZoomPhone();
    const { session, setSession, isLoading: sessionLoading } = useSession();

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
    // Handle dial
    // ---------------------------------------------------------------------------
    const handleDial = useCallback((phoneNumber: string) => {
        setCurrentPhoneNumber(phoneNumber);
        setContextPhoneNumber(phoneNumber); // Update phone number in context

        // Start recording immediately when dialing IF session is active
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (isSessionActive) {
            startRecording();
        }

        dialNumber(phoneNumber);
    }, [dialNumber, isSessionActive, startRecording, setContextPhoneNumber]);

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

            // Create call log
            const callLog = await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
                company: data.companyId,
                phone_number_record: phoneNumberRecordId || undefined,
                caller: user.id,
                call_time: new Date().toISOString(),
                call_outcome: data.callOutcome,
                interest_level: data.interestLevel,
                post_call_notes: data.postCallNotes,
                owner_name_found: data.recipientName || undefined,
                session: session.id,
            });

            // Update session counters
            const updates: Partial<ColdCallingSession> = {
                total_dials: (session.total_dials || 0) + 1,
            };
            if (data.wasPickedUp) {
                updates.total_pickups = (session.total_pickups || 0) + 1;
            }

            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                session.id,
                updates
            );
            setSession(updatedSession);

            // Shift to last call preview
            setLastCallLog(callLog);
            setLastCallCompanyName(data.companyName);
            setCurrentPhoneNumber('');
        } catch (err) {
            console.error('Failed to save call:', err);
        } finally {
            setSavingCall(false);
        }
    }, [session, user, stopRecording, setSession, setContextPhoneNumber]);

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
    // No active session — show start CTA
    // ---------------------------------------------------------------------------
    if (!session) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center space-y-6 max-w-md">
                    <div className="w-20 h-20 rounded-2xl bg-[var(--info-subtle)] flex items-center justify-center mx-auto">
                        <Headphones size={36} className="text-[var(--info)]" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold mb-2">Cold Calling Session</h1>
                        <p className="text-[var(--muted)] text-sm leading-relaxed">
                            Start a session to dial companies, track your metrics, and log calls — all in one place.
                        </p>
                    </div>
                    <button
                        onClick={startSession}
                        disabled={starting}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                        {starting ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Zap size={18} />
                        )}
                        {starting ? 'Starting...' : 'Start Session'}
                    </button>
                </div>
            </div>
        );
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
                    />
                </div>
            </div>
        </div>
    );
}
