'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, X, GripHorizontal, Minimize2, Maximize2, ArrowLeftRight, PhoneOff, ChevronLeft, Power, Loader2, Delete } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useSession } from '@/contexts/session-context';
import { CallRecorderControls } from '@/components/call-recorder-controls';
import { CustomDialerOverlay } from '@/components/custom-dialer-overlay';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import { useRouter } from 'next/navigation';

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';

const STORAGE_Y_KEY = 'zoom-dialer-y-position';
const STORAGE_HEIGHT_KEY = 'zoom-dialer-height';
const ZOOM_SHOW_NATIVE_KEY = 'zoom-show-native-dialer';
const DEFAULT_Y = 100;
const DEFAULT_HEIGHT = 690;
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

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

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface ZoomPhoneDialerProps {
    /** If true, renders as a static docked component instead of floating */
    docked?: boolean;
    /** If true, the dialer is disabled (e.g. unsaved call waiting) */
    disabled?: boolean;
}

export function ZoomPhoneDialer({ docked = false, disabled = false }: ZoomPhoneDialerProps = {}) {
    const router = useRouter();
    const { callStatus, dialNumber, iframeRef, iframeReady, setIframeReady, isDialing, refreshKey } = useZoomPhone();
    const { session, setSession } = useSession();

    const [yPosition, setYPosition] = useState(DEFAULT_Y);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(true);
    const [showKeypad, setShowKeypad] = useState(false);
    const [showDialPad, setShowDialPad] = useState(false);
    const [dialerNumber, setDialerNumber] = useState('+1');
    const [ending, setEnding] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [isHovering, setIsHovering] = useState(false);

    const dialerInputRef = useRef<HTMLInputElement>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const positionBeforeExpand = useRef<number | null>(null);

    // "Show Zoom Native Dialer" setting from integrations
    const [showNativeEnabled, setShowNativeEnabled] = useState(false);
    // Manual override: user clicked the swap button
    const [forceNativeDialer, setForceNativeDialer] = useState(false);
    // Show custom dialer overlay when not in an active call, user hasn't forced native, and not mid-dial
    const showCustomDialer = !forceNativeDialer && !isDialing && (callStatus === 'idle' || callStatus === 'ended');

    const isCallActive = callStatus === 'ringing' || callStatus === 'connected';

    // Update elapsed time for session
    useEffect(() => {
        if (session && session.status === 'active') {
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

    // Auto-adjust position when expanding to keep panel within viewport (only in floating mode)
    useEffect(() => {
        if (docked) return; // Skip auto-positioning in docked mode

        const isExpanded = !isMinimized;

        if (isExpanded) {
            // Store original position before expanding (only once when first expanding)
            if (positionBeforeExpand.current === null) {
                positionBeforeExpand.current = yPosition;
            }

            // Use double requestAnimationFrame to ensure the DOM has fully updated with new height
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!panelRef.current) return;

                    const rect = panelRef.current.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;
                    const panelBottom = rect.bottom;

                    if (panelBottom > viewportHeight) {
                        // Panel goes off-screen, calculate how much to move up
                        const overflow = panelBottom - viewportHeight;
                        // Adjust yPosition by the overflow amount plus margin
                        const newY = Math.max(0, yPosition - overflow - 20); // 20px bottom margin
                        setYPosition(newY);
                    }
                });
            });
        } else {
            // Restore original position when minimizing
            if (positionBeforeExpand.current !== null) {
                setYPosition(positionBeforeExpand.current);
                positionBeforeExpand.current = null;
            }
        }
    }, [isMinimized, showKeypad, session, yPosition, docked]);

    // Load the native dialer setting
    useEffect(() => {
        try {
            const saved = localStorage.getItem(ZOOM_SHOW_NATIVE_KEY);
            if (saved !== null) setShowNativeEnabled(JSON.parse(saved));
        } catch { /* ignore */ }
    }, []);

    // Listen for localStorage changes from settings page
    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === ZOOM_SHOW_NATIVE_KEY) {
                setShowNativeEnabled(e.newValue ? JSON.parse(e.newValue) : false);
            }
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }, []);

    const dragOffsetY = useRef<number>(0);
    const resizeStartY = useRef<number>(0);
    const resizeStartHeight = useRef<number>(0);
    const resizeStartPosY = useRef<number>(0);
    const panelRef = useRef<HTMLDivElement>(null);

    // Load saved Y position and height
    useEffect(() => {
        try {
            const savedY = localStorage.getItem(STORAGE_Y_KEY);
            if (savedY) {
                const y = parseInt(savedY, 10);
                const maxY = window.innerHeight - 100;
                setYPosition(Math.max(0, Math.min(y, maxY)));
            }

            const savedHeight = localStorage.getItem(STORAGE_HEIGHT_KEY);
            if (savedHeight) setHeight(parseInt(savedHeight, 10));
        } catch {
            // ignore
        }
    }, []);

    // Save Y position when it changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_Y_KEY, yPosition.toString());
        } catch {
            // ignore
        }
    }, [yPosition]);

    // Save height when it changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_HEIGHT_KEY, height.toString());
        } catch {
            // ignore
        }
    }, [height]);

    // Vertical dragging handler
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!panelRef.current) return;
        e.preventDefault();
        const rect = panelRef.current.getBoundingClientRect();
        dragOffsetY.current = e.clientY - rect.top;
        setIsDragging(true);
    }, []);

    // Resize handlers (Top resize)
    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeStartY.current = e.clientY;
        resizeStartHeight.current = height;
        resizeStartPosY.current = yPosition;
        setIsResizing(true);
    }, [height, yPosition]);

    useEffect(() => {
        if (!isDragging && !isResizing) return;

        let rafId: number | null = null;

        const handleMouseMove = (e: MouseEvent) => {
            // Cancel any pending animation frame
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }

            // Use requestAnimationFrame for smoother updates
            rafId = requestAnimationFrame(() => {
                if (isDragging) {
                    // Only allow vertical movement
                    const newY = e.clientY - dragOffsetY.current;
                    const maxY = window.innerHeight - 100;
                    setYPosition(Math.max(0, Math.min(newY, maxY)));
                } else if (isResizing) {
                    const deltaY = e.clientY - resizeStartY.current;
                    const newHeight = Math.max(MIN_HEIGHT, Math.min(resizeStartHeight.current - deltaY, MAX_HEIGHT));
                    const heightDiff = resizeStartHeight.current - newHeight;

                    setHeight(newHeight);
                    setYPosition(resizeStartPosY.current + heightDiff);
                }
            });
        };

        const handleMouseUp = () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
            setIsDragging(false);
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing]);

    // When the user dials from our custom dialer
    const handleCustomDial = useCallback((phoneNumber: string) => {
        dialNumber(phoneNumber);   // dialNumber sets isDialing in context
    }, [dialNumber]);

    // End session handler
    const handleEndSession = useCallback(async () => {
        if (!session) return;
        try {
            setEnding(true);
            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, {
                ended_at: new Date().toISOString(),
                total_duration_sec: elapsedSec,
                status: 'completed',
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
        setDialerNumber(prev => {
            if (!prev || prev === '+') return '+1' + digit;
            return prev + digit;
        });
        dialerInputRef.current?.focus();
    }, []);

    const handleBackspace = useCallback(() => {
        setDialerNumber(prev => {
            if (prev.length <= 2) return '+1';
            return prev.slice(0, -1);
        });
        dialerInputRef.current?.focus();
    }, []);

    const handleDialerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;
        let digits = val.replace(/\D/g, '');
        digits = digits.replace(/^1+/, '1');
        if (!digits.startsWith('1')) {
            digits = '1' + digits;
        }
        setDialerNumber('+' + digits);
    };

    const canDial = dialerNumber.length === 12 && dialerNumber.startsWith('+1') && !isCallActive;

    const handleDialFromStats = () => {
        if (canDial) {
            dialNumber(dialerNumber);
            setShowKeypad(true); // Show iframe when dialing
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && canDial) {
            e.preventDefault();
            handleDialFromStats();
        }
    };

    // Compute panel dimensions
    const hasSession = session && session.status === 'active';
    // In docked mode, use hover state; in floating mode, use button-controlled minimized state
    // When disabled, always keep collapsed
    const isCollapsed = disabled ? true : (docked ? !isHovering : isMinimized);
    const currentHeight = isCollapsed ? '48px' : (showKeypad ? `${height}px` : (hasSession ? '500px' : `${height}px`));

    return (
        <div
            ref={panelRef}
            onMouseEnter={docked ? () => setIsHovering(true) : undefined}
            onMouseLeave={docked ? () => setIsHovering(false) : undefined}
            className={cn(
                "flex flex-col overflow-hidden",
                "border border-[var(--card-border)]",
                "bg-[var(--card-bg)]",
                disabled && "opacity-60",
                docked ? (
                    // Docked mode: static positioning, full width, rounded corners, hover cursor
                    "rounded-xl shadow-lg w-full transition-all duration-300 ease-in-out"
                ) : (
                    // Floating mode: fixed positioning, right edge
                    cn(
                        "fixed right-0 z-[998] rounded-l-xl",
                        isDragging ? "cursor-grabbing select-none shadow-[0_20px_60px_rgba(0,0,0,0.3)]" : "shadow-2xl"
                    )
                )
            )}
            style={docked ? {
                height: currentHeight,
                transition: 'height 0.3s ease-out',
            } : {
                top: `${yPosition}px`,
                width: '380px',
                height: currentHeight,
                transform: isDragging ? 'scale(1.01)' : 'scale(1)',
                transition: isDragging ? 'transform 0.1s ease-out, box-shadow 0.1s ease-out' : 'top 0.3s ease-out, height 0.3s ease-out, transform 0.2s ease-out, box-shadow 0.2s ease-out',
                willChange: isDragging ? 'top, transform' : 'auto',
            }}
        >
            {/* Header / Drag Handle */}
            <div className="flex shrink-0">
                {/* Vertical Drag Handle - Only show when not docked */}
                {!docked && (
                    <div
                        onMouseDown={handleMouseDown}
                        className={cn(
                            "w-8 flex items-center justify-center bg-[var(--sidebar-bg)] border-r border-[var(--card-border)]",
                            "cursor-grab select-none hover:bg-[var(--card-hover)] transition-colors",
                            isDragging && "cursor-grabbing bg-[var(--card-hover)]"
                        )}
                        title="Drag to move"
                    >
                        <GripHorizontal size={14} className="text-[var(--muted)] rotate-90" />
                    </div>
                )}

                {/* Header Content */}
                <div className="flex-1 flex items-center justify-between px-3 py-2 bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                    <div className="flex items-center gap-2">
                        <Phone size={14} className="text-blue-400" />
                        <span className="text-xs font-semibold">
                            {hasSession ? 'Call Session' : 'Zoom Phone'}
                        </span>
                        {/* Show session info when minimized */}
                        {hasSession && isCollapsed && (
                            <>
                                <span className="text-xs text-[var(--muted)]">•</span>
                                <div className="flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                                    <span className="text-xs font-mono font-semibold tabular-nums text-[var(--muted)]">
                                        {formatDuration(elapsedSec)}
                                    </span>
                                </div>
                            </>
                        )}
                        {/* Disabled hint when unsaved call */}
                        {disabled && (
                            <span className="text-[10px] text-[var(--warning)] font-medium">
                                Submit call log first
                            </span>
                        )}
                        {/* Hover hint for docked mode when collapsed */}
                        {docked && isCollapsed && !hasSession && !disabled && (
                            <span className="text-[10px] text-[var(--muted)] italic">
                                Hover to expand
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* Minimize/Maximize button - only in floating mode */}
                        {!docked && (
                            <button
                                onClick={() => setIsMinimized(!isMinimized)}
                                className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                title={isMinimized ? 'Expand' : 'Minimize'}
                            >
                                {isMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Content Area - Keep mounted but hide with CSS to prevent iframe reload */}
            <div
                className="flex-1 flex flex-col overflow-hidden"
                style={{
                    display: isCollapsed ? 'none' : 'flex'
                }}
            >
                {/* Session Stats Panel - Only show when session is active and NOT docked (stats already on page) */}
                {hasSession && !showKeypad && !docked && (
                        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                            {/* Header with session info */}
                            <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--success-subtle)] text-[var(--success)]">
                                            <span className="w-1 h-1 rounded-full bg-[var(--success)] animate-pulse" />
                                            Active
                                        </span>
                                        <span className="text-xs font-mono font-semibold tabular-nums text-[var(--muted)]">
                                            {formatDuration(elapsedSec)}
                                        </span>
                                    </div>
                                </div>
                                {/* Only show "Go to Session" button when not docked (floating mode) */}
                                {!docked && (
                                    <button
                                        onClick={handleGoToSession}
                                        className="p-2 rounded-lg hover:bg-[var(--sidebar-bg)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                        title="Go to Session Page"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                )}
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
                                        {session.total_dials > 0 ? Math.round((session.total_pickups / session.total_dials) * 100) : 0}%
                                    </div>
                                    <div className="text-[10px] text-[var(--muted)] uppercase">Rate</div>
                                </div>
                            </div>

                            {/* Dialer Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-semibold text-[var(--muted)] uppercase">Quick Dial</h4>
                                    <button
                                        onClick={() => setShowDialPad(!showDialPad)}
                                        className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 rounded hover:bg-[var(--sidebar-bg)] transition-colors"
                                    >
                                        {showDialPad ? 'Hide' : 'Show'} Keypad
                                    </button>
                                </div>

                                {/* Number input */}
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={dialerInputRef}
                                        type="text"
                                        value={dialerNumber}
                                        onChange={handleDialerInputChange}
                                        onKeyDown={handleKeyDown}
                                        disabled={isCallActive}
                                        placeholder="Enter number..."
                                        className="flex-1 text-center text-sm font-semibold bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1.5 placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)] transition-colors disabled:opacity-70"
                                        autoComplete="off"
                                    />
                                    {dialerNumber.length > 2 && !isCallActive && (
                                        <button
                                            onClick={handleBackspace}
                                            className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-bg)] transition-colors"
                                            title="Delete"
                                        >
                                            <Delete size={16} />
                                        </button>
                                    )}
                                    {!isCallActive && (
                                        <button
                                            onClick={handleDialFromStats}
                                            disabled={!canDial}
                                            className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 disabled:opacity-40"
                                            style={{ background: canDial ? 'var(--success)' : 'var(--card-border)' }}
                                            title="Call"
                                        >
                                            <Phone size={14} className="text-white" />
                                        </button>
                                    )}
                                </div>

                                {/* Dial Pad */}
                                {showDialPad && (
                                    <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
                                        {DIAL_PAD.map(({ digit, letters }) => (
                                            <button
                                                key={digit}
                                                onClick={() => appendDigit(digit)}
                                                className="flex flex-col items-center justify-center h-10 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)] active:scale-95 transition-all"
                                                disabled={isCallActive}
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

                            {/* Show Keypad Button */}
                            <button
                                onClick={() => setShowKeypad(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 text-blue-400 font-medium text-sm border border-blue-500/30 hover:bg-blue-500/20 transition-all"
                            >
                                <Phone size={14} />
                                Show Zoom Keypad
                            </button>

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

                    {/* Zoom Iframe - Show when keypad is toggled, no session, or docked mode */}
                    {(showKeypad || !hasSession || docked) && (
                        <>
                            {/* Resize Handle - Only show when keypad is visible */}
                            {showKeypad && (
                                <div
                                    className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-[1000] hover:bg-blue-400/50 transition-colors"
                                    onMouseDown={handleResizeMouseDown}
                                    title="Drag to resize height"
                                />
                            )}

                            {/* Hide Keypad Button - Only show when session is active */}
                            {hasSession && showKeypad && (
                                <div className="px-4 pt-3 pb-2 border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
                                    <button
                                        onClick={() => setShowKeypad(false)}
                                        className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors text-xs"
                                    >
                                        <ChevronLeft size={12} />
                                        Back to Session Stats
                                    </button>
                                </div>
                            )}

                            <div className="flex-1 flex flex-col bg-white overflow-hidden">
                                {/* Call Recorder Controls */}
                                <CallRecorderControls />

                                {/* Dialer / Iframe area */}
                                <div className="flex-1 relative">
                                    {/* Custom Dialer Overlay */}
                                    {showCustomDialer && (
                                        <CustomDialerOverlay onDial={handleCustomDial} />
                                    )}

                                    {/* Loading State */}
                                    {!showCustomDialer && !iframeReady && (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--card-bg)] z-[5]">
                                            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                            <span className="text-xs text-[var(--muted)]">Loading Zoom Phone...</span>
                                        </div>
                                    )}

                                    {/* Zoom iframe — ALWAYS MOUNTED */}
                                    <iframe
                                        id="zoom-iframe"
                                        key={refreshKey}
                                        ref={iframeRef}
                                        src={ZOOM_EMBED_URL}
                                        onLoad={() => setIframeReady(true)}
                                        className="w-full h-full border-0"
                                        allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                                        title="Zoom Phone Dialer"
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>
        </div>
    );
}
