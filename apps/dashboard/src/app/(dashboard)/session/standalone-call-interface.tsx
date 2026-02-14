'use client';

import { useState, useCallback } from 'react';
import { Power, Loader2, Mic, MicOff, Phone, Square } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type PhoneNumber } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { SessionDialer } from './session-dialer';
import { CurrentCallForm, type CallFormData } from './current-call-form';
import { LastCallPreview } from './last-call-preview';

interface StandaloneCallInterfaceProps {
    onExit: () => void;
}

export function StandaloneCallInterface({ onExit }: StandaloneCallInterfaceProps) {
    const { user } = useAuth();
    const { dialNumber, callStatus, endCall } = useZoomPhone();
    const {
        status: recorderStatus,
        duration: recordingDuration,
        stopRecording,
        startRecording,
        setPhoneNumber: setContextPhoneNumber
    } = useCallRecording();

    const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
    const [savingCall, setSavingCall] = useState(false);
    const [lastCallLog, setLastCallLog] = useState<CallLog | null>(null);
    const [lastCallCompanyName, setLastCallCompanyName] = useState('');
    const [exiting, setExiting] = useState(false);

    // Handle dialing
    const handleDial = useCallback((phoneNumber: string) => {
        setCurrentPhoneNumber(phoneNumber);
        setContextPhoneNumber(phoneNumber);
        dialNumber(phoneNumber);
        // Auto-start recording
        startRecording();
    }, [dialNumber, setContextPhoneNumber, startRecording]);

    // Handle saving standalone call
    const handleSaveCall = useCallback(async (data: CallFormData) => {
        if (!user) return;
        setSavingCall(true);
        try {
            // Stop recording and upload
            stopRecording();

            // Find or create phone number record
            let phoneNumberRecordId: string | null = null;
            try {
                const existingPhones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
                    filter: `phone_number ~ "${currentPhoneNumber}"`,
                    limit: 1,
                });
                if (existingPhones.length > 0) {
                    phoneNumberRecordId = existingPhones[0].id;
                } else {
                    const newPhone = await pb.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                        company: data.companyId,
                        phone_number: currentPhoneNumber,
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
                call_outcome: data.callOutcome,
                interest_level: data.interestLevel,
                post_call_notes: data.postCallNotes,
                owner_name_found: data.recipientName || undefined,
                owner_reached: data.ownerReached,
                pitch_completed: data.pitchCompleted,
                appointment_set: data.appointmentSet,
                // session field is omitted (will be null) - this marks it as a standalone call
            });

            // Show last call preview
            setLastCallLog(callLog);
            setLastCallCompanyName(data.companyName);
            setCurrentPhoneNumber('');
        } catch (err) {
            console.error('Failed to save standalone call:', err);
        } finally {
            setSavingCall(false);
        }
    }, [user, currentPhoneNumber, stopRecording]);

    // Handle exit
    const handleExit = useCallback(async () => {
        setExiting(true);
        try {
            // Stop any active recording
            if (recorderStatus === 'recording') {
                stopRecording();
            }
            // Call parent to exit standalone mode
            onExit();
        } finally {
            setExiting(false);
        }
    }, [recorderStatus, stopRecording, onExit]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold">Standalone Call</h1>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--info-subtle)] text-[var(--info)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--info)] animate-pulse" />
                        Quick Call Mode
                    </span>
                </div>

                <button
                    onClick={handleExit}
                    disabled={exiting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--card-bg)] text-[var(--foreground)] font-medium text-sm border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-all disabled:opacity-50"
                >
                    {exiting ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                    {exiting ? 'Exiting...' : 'Exit Standalone Mode'}
                </button>
            </div>

            {/* Recording Status Indicator */}
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {recorderStatus === 'recording' ? (
                            <>
                                <div className="w-10 h-10 rounded-full bg-[var(--error-subtle)] flex items-center justify-center">
                                    <Mic className="w-5 h-5 text-[var(--error)] animate-pulse" />
                                </div>
                                <div>
                                    <p className="font-medium">Recording</p>
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm text-[var(--muted)]">
                                            {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                                        </p>
                                        <button
                                            onClick={() => stopRecording()}
                                            className="ml-2 p-1 rounded bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                            title="Stop Recording"
                                        >
                                            <Square size={12} fill="currentColor" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="w-10 h-10 rounded-full bg-[var(--muted)]/10 flex items-center justify-center">
                                    <MicOff className="w-5 h-5 text-[var(--muted)]" />
                                </div>
                                <div>
                                    <p className="font-medium">Not Recording</p>
                                    <p className="text-sm text-[var(--muted)]">Dial a number to start</p>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-6">
                        {(callStatus === 'ringing' || callStatus === 'connected') && (
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={endCall}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-all active:scale-95 shadow-lg shadow-red-500/20"
                                >
                                    <Phone size={16} className="rotate-[135deg]" />
                                    End Call
                                </button>
                                <span className="text-xs text-red-400 font-medium animate-pulse">
                                    {callStatus === 'ringing' ? 'Ringing...' : 'In Progress'}
                                </span>
                            </div>
                        )}

                        <div className="text-right">
                            <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Status</p>
                            <p className="text-sm font-medium capitalize">{recorderStatus}</p>
                        </div>
                    </div>
                </div>
            </div>
            {/* Main layout - simplified single column on mobile, two columns on large screens */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left column */}
                <div className="space-y-6">
                    <SessionDialer onDial={handleDial} />
                </div>

                {/* Right column */}
                <div className="space-y-6">
                    <CurrentCallForm
                        phoneNumber={currentPhoneNumber}
                        onSave={handleSaveCall}
                        saving={savingCall}
                    />
                    <LastCallPreview
                        callLog={lastCallLog}
                        companyName={lastCallCompanyName}
                    />
                </div>
            </div>

            {/* Info footer */}
            <div className="bg-[var(--info-subtle)]/30 border border-[var(--info)] rounded-lg p-4">
                <p className="text-sm text-[var(--info)]">
                    <span className="font-semibold">Note:</span> Standalone calls are logged separately and not tracked in session metrics.
                    All calls are automatically recorded for documentation.
                </p>
            </div>
        </div>
    );
}
