'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, CheckCircle2, AlertCircle, Phone } from 'lucide-react';
import { useCallRecorder } from '@/hooks/use-call-recorder';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';

const AUTORECORD_KEY = 'call-recorder-auto-mode';

function formatTimer(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Recording controls for the Zoom Phone Dialer panel.
 *
 * Reads auto/manual mode from localStorage (set in Settings → Integrations).
 * - Auto (default): Recording starts when call connects, stops when call ends.
 * - Manual: User clicks Record / Stop for each call.
 */
export function CallRecorderControls() {
    const { lastDialedNumber, callStatus, activeCallNumber, customDialerNumber, registerDialCallback } = useZoomPhone();
    const { user } = useAuth();

    // ── Auto / Manual mode (read from localStorage, set in Settings) ──
    const [isAutoMode, setIsAutoMode] = useState(true);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(AUTORECORD_KEY);
            if (saved !== null) setIsAutoMode(JSON.parse(saved));
        } catch { /* ignore */ }
    }, []);

    // Listen for changes from Settings page
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === AUTORECORD_KEY) {
                setIsAutoMode(e.newValue ? JSON.parse(e.newValue) : true);
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    // ── Phone number — synced from Zoom's events and/or CRM ─────────
    const [phoneInput, setPhoneInput] = useState('');
    const phoneRef = useRef<string | null>(null);
    phoneRef.current = phoneInput || null;

    // Sync from Zoom postMessage events
    useEffect(() => {
        if (activeCallNumber) {
            setPhoneInput(activeCallNumber.replace(/\D/g, '') || activeCallNumber);
        }
    }, [activeCallNumber]);

    // Sync from custom dialer as user types
    useEffect(() => {
        if (customDialerNumber) {
            setPhoneInput(customDialerNumber);
        }
    }, [customDialerNumber]);

    // Fallback: sync from CRM dialNumber
    useEffect(() => {
        if (lastDialedNumber && !activeCallNumber && !customDialerNumber) {
            setPhoneInput(lastDialedNumber);
        }
    }, [lastDialedNumber, activeCallNumber, customDialerNumber]);

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPhoneInput(e.target.value.replace(/\D/g, ''));
    };

    // ── Recorder hook ───────────────────────────────────────────────
    const {
        isSessionActive,
        status,
        duration,
        error,
        startSession,
        endSession,
        startRecording,
        stopRecording,
    } = useCallRecorder(phoneRef, user?.id);

    // ── Auto-start recording session on first dial ─────────────────
    // Called synchronously from dialNumber() within the user's click gesture,
    // which allows getDisplayMedia to work without a separate button click.
    useEffect(() => {
        registerDialCallback(() => {
            if (!isSessionActive) {
                startSession();
            }
        });
        return () => registerDialCallback(null);
    }, [registerDialCallback, isSessionActive, startSession]);

    // ── Auto-record: start on call connect, stop on call end ────────
    const prevCallStatusRef = useRef(callStatus);

    useEffect(() => {
        const prev = prevCallStatusRef.current;
        prevCallStatusRef.current = callStatus;

        if (!isAutoMode || !isSessionActive) return;

        if (callStatus === 'connected' && prev !== 'connected' && status === 'idle') {
            startRecording();
        }

        if (callStatus === 'ended' && prev !== 'ended' && status === 'recording') {
            stopRecording();
        }
    }, [callStatus, isAutoMode, isSessionActive, status, startRecording, stopRecording]);

    // ── Render ──────────────────────────────────────────────────────

    // Session not active — show minimal status, session will auto-start on first dial
    if (!isSessionActive) {
        return (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--card-border)] bg-[var(--sidebar-bg)] text-sm shrink-0">
                <span className="relative flex h-2 w-2 shrink-0">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--muted)]" />
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                    Recording starts on first call
                </span>
                {error && (
                    <span className="text-[10px] text-red-400 truncate ml-auto">{error}</span>
                )}
            </div>
        );
    }

    // Session active
    return (
        <div
            className={cn(
                'flex items-center gap-2 px-3 py-2 border-b border-[var(--card-border)]',
                'bg-[var(--sidebar-bg)] text-sm shrink-0',
                status === 'recording' && 'bg-red-500/10 border-red-500/30'
            )}
        >
            {/* --- IDLE --- */}
            {status === 'idle' && (
                <>
                    <span className="relative flex h-2 w-2 shrink-0" title="Recording session active">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>

                    {isAutoMode ? (
                        <span className="text-[10px] text-green-400 font-semibold" title="Recording will start automatically when a call connects">
                            AUTO
                        </span>
                    ) : (
                        <button
                            onClick={startRecording}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 active:scale-95 transition-all"
                        >
                            <Mic size={11} />
                            Record
                        </button>
                    )}

                    <div className="flex items-center gap-1 flex-1 max-w-[140px]">
                        <Phone size={10} className="text-[var(--muted)] shrink-0" />
                        <input
                            type="text"
                            value={phoneInput}
                            onChange={handlePhoneChange}
                            placeholder="Phone #"
                            className="w-full bg-transparent border-b border-[var(--card-border)] focus:border-[var(--foreground)] outline-none text-xs font-mono py-0.5 placeholder:text-[var(--muted)] transition-colors"
                        />
                    </div>

                    {callStatus === 'ringing' && (
                        <span className="text-[10px] text-yellow-400 animate-pulse">Ringing...</span>
                    )}

                    <button
                        onClick={endSession}
                        className="text-[10px] px-2 py-0.5 rounded text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
                        title="End recording session"
                    >
                        End
                    </button>
                </>
            )}

            {/* --- RECORDING --- */}
            {status === 'recording' && (
                <>
                    <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                    </span>
                    <span className="font-mono text-xs font-bold text-red-400 tabular-nums">
                        {formatTimer(duration)}
                    </span>
                    <div className="flex items-center gap-1 flex-1 max-w-[120px]">
                        <Phone size={10} className="text-red-400/60 shrink-0" />
                        <input
                            type="text"
                            value={phoneInput}
                            onChange={handlePhoneChange}
                            placeholder="Phone #"
                            className="w-full bg-transparent border-b border-red-500/30 focus:border-red-400 outline-none text-xs font-mono py-0.5 text-red-300 placeholder:text-red-400/40 transition-colors"
                        />
                    </div>
                    <button
                        onClick={stopRecording}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all ml-auto"
                    >
                        <Square size={10} fill="currentColor" />
                        Stop
                    </button>
                </>
            )}

            {/* --- STOPPING --- */}
            {status === 'stopping' && (
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <Loader2 size={14} className="animate-spin" />
                    Stopping...
                </div>
            )}

            {/* --- UPLOADING --- */}
            {status === 'uploading' && (
                <div className="flex items-center gap-2 text-xs text-blue-400">
                    <Loader2 size={14} className="animate-spin" />
                    Uploading recording...
                </div>
            )}

            {/* --- SUCCESS --- */}
            {status === 'success' && (
                <div className="flex items-center gap-2 text-xs text-green-400">
                    <CheckCircle2 size={14} />
                    Uploaded successfully
                </div>
            )}

            {/* --- ERROR --- */}
            {status === 'error' && (
                <div className="flex items-center gap-2 text-xs text-red-400 flex-1">
                    <AlertCircle size={14} className="shrink-0" />
                    <span className="truncate">{error || 'Recording failed'}</span>
                    <button
                        onClick={startRecording}
                        className="ml-auto shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 hover:bg-red-500/30 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            )}
        </div>
    );
}
