'use client';

import { useState, useCallback, useEffect } from 'react';
import { Power, Loader2, Mic, MicOff, Phone, Square } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type PhoneNumber } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { ZoomPhoneDialer } from '@/components/zoom-phone-dialer';
import { CurrentCallForm, type CallFormData } from './current-call-form';
import { LastCallPreview } from './last-call-preview';

interface StandaloneCallInterfaceProps {
    onExit: () => void;
}

export function StandaloneCallInterface({ onExit }: StandaloneCallInterfaceProps) {
    const { user } = useAuth();
    const { callStatus, endCall, activeCallNumber } = useZoomPhone();
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

    // Track active call from Zoom Phone context
    useEffect(() => {
        if (activeCallNumber && callStatus === 'ringing') {
            // Check if this is a new call (different number or no current number)
            if (!currentPhoneNumber || activeCallNumber !== currentPhoneNumber) {
                console.log('[Standalone] New call detected from dialer:', activeCallNumber);
                setCurrentPhoneNumber(activeCallNumber);
                setContextPhoneNumber(activeCallNumber);

                // Auto-start recording
                startRecording();
            }
        }
    }, [activeCallNumber, currentPhoneNumber, callStatus, setContextPhoneNumber, startRecording]);

    // Handle saving standalone call
    const handleSaveCall = useCallback(async (data: CallFormData) => {
        if (!user) return;
        setSavingCall(true);
        try {
            // Stop recording and upload
            stopRecording();
            setContextPhoneNumber('');

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
                        receptionist_name: data.recipientName || undefined,
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
                call_outcome: data.callOutcome,
                interest_level: data.interestLevel,
                post_call_notes: data.postCallNotes,
                owner_name_found: data.recipientName || undefined,
                owner_reached: data.ownerReached,
                pitch_completed: data.pitchCompleted,
                appointment_set: data.appointmentSet,
                // session field is omitted (will be null) - this marks it as a standalone call
            });

            // Update company metadata
            try {
                const companyUpdates: Record<string, any> = {
                    last_contacted: new Date().toISOString(),
                };
                if (data.ownerReached && data.recipientName) {
                    companyUpdates.owner_name = data.recipientName;
                }
                await pb.collection(COLLECTIONS.COMPANIES).update(data.companyId, companyUpdates);
            } catch (err) {
                // ignore
            }

            // Show last call preview
            setLastCallLog(callLog);
            setLastCallCompanyName(data.companyName);
            setCurrentPhoneNumber('');
        } catch (err) {
            console.error('Failed to save standalone call:', err);
        } finally {
            setSavingCall(false);
        }
    }, [user, stopRecording, setContextPhoneNumber]);

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

    // Track unsaved call state
    const hasUnsavedCall = !!(callStatus === 'ended' && currentPhoneNumber);

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
                                    <p className="text-sm text-[var(--muted)]">Hover over the dialer bar to make a call</p>
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

            {/* Docked Zoom Phone Dialer */}
            <ZoomPhoneDialer docked disabled={hasUnsavedCall} />

            {/* Main layout */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left column - Form */}
                <div className="lg:col-span-3 space-y-6">
                    <CurrentCallForm
                        phoneNumber={currentPhoneNumber}
                        onSave={handleSaveCall}
                        saving={savingCall}
                        hasUnsavedCall={hasUnsavedCall}
                    />
                </div>

                {/* Right column - Past Call */}
                <div className="lg:col-span-2 space-y-6">
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
