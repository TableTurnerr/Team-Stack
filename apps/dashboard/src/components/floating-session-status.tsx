'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Phone, Power, ChevronLeft, Loader2 } from 'lucide-react';
import { useSession } from '@/contexts/session-context';
import { usePhone } from '@/contexts/phone-context';
import { useRouter } from 'next/navigation';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const DIAL_PAD: { digit: string; letters: string }[] = [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'ABC' },
    { digit: '3', letters: 'DEF' },
    { digit: '4', letters: 'GHI' },
    { digit: '5', letters: 'JKL' },
    { digit: '6', letters: 'MNO' },
    { digit: '7', letters: 'PQRS' },
    { digit: '8', letters: 'TUV' },
    { digit: '9', letters: 'WXYZ' },
    { digit: '*', letters: '' },
    { digit: '0', letters: '+' },
    { digit: '#', letters: '' },
];

/**
 * Floating session status widget that sticks to the right edge of the screen.
 * Shows session info and dialer functionality. Expands on hover.
 */
export function FloatingSessionStatus() {
    const { session, setSession } = useSession();
    const { callStatus, dialNumber, endCall, isDialing } = usePhone();
    const router = useRouter();

    const [isExpanded, setIsExpanded] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [ending, setEnding] = useState(false);
    const [showKeypad, setShowKeypad] = useState(false);
    const [number, setNumber] = useState('+1');

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isCallActive = callStatus === 'ringing' || callStatus === 'connected';

    // Update elapsed time — subtracts paused time so only active calling time is shown
    useEffect(() => {
        if (session && session.status === 'active') {
            const started = new Date(session.started_at).getTime();
            const totalPausedSec = session.total_paused_sec ?? 0;
            const updateElapsed = () => {
                const now = Date.now();
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

    // Handle mouse enter with delay
    const handleMouseEnter = useCallback(() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            setIsExpanded(true);
        }, 200);
    }, []);

    // Handle mouse leave with delay
    const handleMouseLeave = useCallback(() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => {
            setIsExpanded(false);
        }, 300);
    }, []);

    // End session
    const handleEndSession = useCallback(async () => {
        if (!session) return;
        try {
            setEnding(true);
            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, {
                ended_at: new Date().toISOString(),
                total_duration_sec: elapsedSec,
                status: 'completed',
                on_call: false,
            });
            setSession(null);
        } catch (err) {
            console.error('Failed to end session:', err);
        } finally {
            setEnding(false);
        }
    }, [session, elapsedSec, setSession]);

    // Navigate to session page
    const handleGoToSession = useCallback(() => {
        router.push('/session');
    }, [router]);

    // Dialer functions
    const appendDigit = useCallback((digit: string) => {
        setNumber(prev => {
            if (!prev || prev === '+') return '+1' + digit;
            return prev + digit;
        });
        inputRef.current?.focus();
    }, []);

    const handleBackspace = useCallback(() => {
        setNumber(prev => {
            if (prev.length <= 2) return '+1';
            return prev.slice(0, -1);
        });
        inputRef.current?.focus();
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;
        let digits = val.replace(/\D/g, '');
        digits = digits.replace(/^1+/, '1');
        if (!digits.startsWith('1')) {
            digits = '1' + digits;
        }
        setNumber('+' + digits);
    };

    const isPaused = !!session?.paused_at;
    const canDial = number.length === 12 && number.startsWith('+1') && !isCallActive && !isPaused;

    const handleDial = () => {
        if (canDial) {
            dialNumber(number);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && canDial) {
            e.preventDefault();
            handleDial();
        }
    };

    // Don't render if no session is active
    if (!session || session.status !== 'active') {
        return null;
    }

    return (
        <div
            className="fixed right-0 top-1/2 -translate-y-1/2 z-[999] flex items-center"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Expanded Panel */}
            <div
                className={cn(
                    "bg-[var(--card-bg)] border-l border-y border-[var(--card-border)] rounded-l-xl shadow-2xl transition-all duration-300 overflow-hidden",
                    isExpanded ? "w-[380px] opacity-100" : "w-0 opacity-0"
                )}
            >
                {isExpanded && (
                    <div className="p-4 space-y-4 w-[380px]">
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-3">
                            <div>
                                <h3 className="text-sm font-semibold">Call Session</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    {isPaused ? (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--warning-subtle)] text-[var(--warning)]">
                                            <span className="w-1 h-1 rounded-full bg-[var(--warning)]" />
                                            Paused
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--success-subtle)] text-[var(--success)]">
                                            <span className="w-1 h-1 rounded-full bg-[var(--success)] animate-pulse" />
                                            Active
                                        </span>
                                    )}
                                    <span className="text-xs font-mono font-semibold tabular-nums text-[var(--muted)]">
                                        {formatDuration(elapsedSec)}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={handleGoToSession}
                                className="p-2 rounded-lg hover:bg-[var(--sidebar-bg)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                title="Go to Session Page"
                            >
                                <ChevronLeft size={16} />
                            </button>
                        </div>

                        {/* Session Stats */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-[var(--sidebar-bg)] rounded-lg p-2">
                                <div className="text-lg font-bold text-[var(--foreground)]">{session.total_dials || 0}</div>
                                <div className="text-[10px] text-[var(--muted)] uppercase">Dials</div>
                            </div>
                            <div className="bg-[var(--sidebar-bg)] rounded-lg p-2">
                                <div className="text-lg font-bold text-[var(--foreground)]">{session.total_pickups || 0}</div>
                                <div className="text-[10px] text-[var(--muted)] uppercase">Pickups</div>
                            </div>
                            <div className="bg-[var(--sidebar-bg)] rounded-lg p-2">
                                <div className="text-lg font-bold text-[var(--foreground)]">
                                    {session.total_pickups > 0 ? Math.round((session.total_pickups / session.total_dials) * 100) : 0}%
                                </div>
                                <div className="text-[10px] text-[var(--muted)] uppercase">Rate</div>
                            </div>
                        </div>

                        {/* Dialer */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-[var(--muted)] uppercase">Dialer</h4>
                                <button
                                    onClick={() => setShowKeypad(!showKeypad)}
                                    className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 rounded hover:bg-[var(--sidebar-bg)] transition-colors"
                                >
                                    {showKeypad ? 'Hide' : 'Show'} Keypad
                                </button>
                            </div>

                            {/* Number input with inline dial button */}
                            <div className="flex items-center gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={number}
                                    onChange={handleInputChange}
                                    onKeyDown={handleKeyDown}
                                    disabled={isCallActive || isPaused}
                                    placeholder="Enter number..."
                                    className="flex-1 text-center text-sm font-semibold bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1.5 placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)] transition-colors disabled:opacity-70"
                                    autoComplete="off"
                                />
                                {isCallActive ? (
                                    <button
                                        onClick={endCall}
                                        className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 transition-all duration-150 active:scale-90 shadow-lg shadow-red-500/20"
                                        title="End Call"
                                    >
                                        <Phone size={14} className="text-white rotate-[135deg]" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleDial}
                                        disabled={!canDial}
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
                                        style={{
                                            background: canDial ? 'var(--success)' : 'var(--card-border)',
                                        }}
                                        title="Call"
                                    >
                                        <Phone size={14} className="text-white" />
                                    </button>
                                )}
                            </div>

                            {/* Collapsible Keypad */}
                            {showKeypad && (
                                <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
                                    {DIAL_PAD.map(({ digit, letters }) => (
                                        <button
                                            key={digit}
                                            onClick={() => appendDigit(digit)}
                                            className="flex flex-col items-center justify-center h-10 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)] active:scale-95 transition-all"
                                            disabled={isCallActive || isPaused}
                                        >
                                            <span className="text-sm font-semibold text-[var(--foreground)]">{digit}</span>
                                            {letters && (
                                                <span className="text-[6px] text-[var(--muted)] font-semibold uppercase tracking-wider">
                                                    {letters}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* End Session Button */}
                        <button
                            onClick={handleEndSession}
                            disabled={ending}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-medium text-sm border border-[var(--error)]/30 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                        >
                            {ending ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                            {ending ? 'Ending...' : 'End Session'}
                        </button>
                    </div>
                )}
            </div>

            {/* Minimized Tab */}
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-l-xl shadow-xl h-[280px] w-16 flex flex-col items-center justify-between py-5 px-2">
                {/* Top: Icon and vertical text */}
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <Phone size={18} className="text-blue-400" style={{ transform: 'rotate(90deg)' }} />
                    </div>
                    <div className="text-[12px] font-bold text-[var(--foreground)] tracking-wide" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                        Zoom Phone
                    </div>
                </div>

                {/* Divider */}
                <div className="w-8 h-px bg-[var(--card-border)]" />

                {/* Middle: Session Status */}
                <div className="flex flex-col items-center gap-3">
                    <div className="flex flex-col items-center gap-1.5">
                        {isPaused ? (
                            <>
                                <div className="w-2 h-2 rounded-full bg-[var(--warning)] shadow-lg shadow-yellow-500/50" />
                                <div className="text-[8px] font-semibold text-[var(--warning)] uppercase tracking-wider" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                                    Paused
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse shadow-lg shadow-green-500/50" />
                                <div className="text-[8px] font-semibold text-[var(--success)] uppercase tracking-wider" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                                    Active
                                </div>
                            </>
                        )}
                    </div>
                    <div className="text-[11px] font-mono font-bold tabular-nums text-[var(--foreground)]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                        {formatDuration(elapsedSec)}
                    </div>
                </div>

                {/* Divider */}
                <div className="w-8 h-px bg-[var(--card-border)]" />

                {/* Bottom: End Session */}
                <button
                    onClick={handleEndSession}
                    disabled={ending}
                    className="w-10 h-10 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50 flex items-center justify-center group"
                    title="End Session"
                >
                    {ending ? (
                        <Loader2 size={16} className="animate-spin" style={{ transform: 'rotate(90deg)' }} />
                    ) : (
                        <Power size={16} style={{ transform: 'rotate(90deg)' }} className="group-hover:scale-110 transition-transform" />
                    )}
                </button>
            </div>
        </div>
    );
}
