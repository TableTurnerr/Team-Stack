'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, CheckCircle2, AlertCircle, Phone, X } from 'lucide-react';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
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
 * Synchronized with the global CallRecordingContext.
 */
export function CallRecorderControls() {
    const { lastDialedNumber, callStatus, activeCallNumber, customDialerNumber, registerDialCallback } = useZoomPhone();
    
    // Use the global context instead of a local hook instance
    const {
        isSessionActive,
        status,
        duration,
        error,
        startSession,
        endSession,
        startRecording,
        stopRecording,
        setPhoneNumber
    } = useCallRecording();

    // ── Auto / Manual mode (read from localStorage, set in Settings) ──
    const [isAutoMode, setIsAutoMode] = useState(true);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(AUTORECORD_KEY);
            if (saved !== null) setIsAutoMode(JSON.parse(saved));
        } catch { /* ignore */ }
    }, []);

    // ── Phone number sync ───────────────────────────────────────────
    useEffect(() => {
        if (activeCallNumber) {
            setPhoneNumber(activeCallNumber.replace(/\D/g, '') || activeCallNumber);
        } else if (customDialerNumber) {
            setPhoneNumber(customDialerNumber);
        } else if (lastDialedNumber) {
            setPhoneNumber(lastDialedNumber);
        }
    }, [activeCallNumber, customDialerNumber, lastDialedNumber, setPhoneNumber]);

    // ── Auto-start recording session on first dial ─────────────────
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

        if (!isSessionActive) return;

        // Auto-start only if auto-mode is ON
        if (isAutoMode && callStatus === 'connected' && prev !== 'connected' && status === 'idle') {
            startRecording();
        }

        // ALWAYS auto-stop when call ends, regardless of auto-mode
        // This ensures recordings don't run forever if the user forgets
        if ((callStatus === 'ended' || (callStatus === 'idle' && prev !== 'idle' && prev !== 'ended')) && status === 'recording') {
            stopRecording();
        }
    }, [callStatus, isAutoMode, isSessionActive, status, startRecording, stopRecording]);

    // ── Render ──────────────────────────────────────────────────────

    // Session not active — show nothing, session will auto-start on first dial
    if (!isSessionActive) {
        return null;
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
            {/* --- IDLE / SUCCESS / ERROR (Session Active but not currently recording) --- */}
            {(status === 'idle' || status === 'success' || status === 'error') && (
                <>
                    <span className="relative flex h-2 w-2 shrink-0" title="Recording session active">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>

                    {status === 'success' ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-green-400 font-semibold animate-pulse">
                            <CheckCircle2 size={12} />
                            UPLOADED
                        </div>
                    ) : status === 'error' ? (
                        <div className="flex items-center gap-1.5 text-[10px] text-red-400 font-semibold max-w-[100px] truncate" title={error || ''}>
                            <AlertCircle size={12} />
                            {error || 'FAILED'}
                        </div>
                    ) : isAutoMode ? (
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

                    {callStatus === 'ringing' && (
                        <span className="text-[10px] text-yellow-400 animate-pulse ml-2">Ringing...</span>
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
                    
                    <div className="flex items-center gap-2 ml-auto">
                        <button
                            onClick={stopRecording}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-xs font-semibold hover:opacity-90 active:scale-95 transition-all"
                        >
                            <Square size={10} fill="currentColor" />
                            Stop
                        </button>
                        <button
                            onClick={endSession}
                            className="p-1 rounded text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Force end entire session"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </>
            )}

            {/* --- STOPPING / UPLOADING --- */}
            {(status === 'stopping' || status === 'uploading') && (
                <div className="flex items-center gap-2 text-[10px] text-blue-400 font-semibold italic ml-auto">
                    <Loader2 size={12} className="animate-spin" />
                    {status === 'stopping' ? 'STOPPING...' : 'UPLOADING...'}
                </div>
            )}
        </div>
    );
}
