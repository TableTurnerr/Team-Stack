'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneCall, GripHorizontal, Minimize2, Maximize2, ChevronLeft, Power, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePhone } from '@/contexts/phone-context';
import { useCallOwnershipOptional } from '@/contexts/call-ownership-context';
import { useSession } from '@/contexts/session-context';

// const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home'; // Zoom Smart Embed disabled
import { CallRecorderControls } from '@/components/call-recorder-controls';
import { CustomDialerOverlay } from '@/components/custom-dialer-overlay';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { useLocalAgent } from '@/contexts/local-agent-context';

const STORAGE_Y_KEY = 'zoom-dialer-y-position';
const STORAGE_HEIGHT_KEY = 'zoom-dialer-height';
const DEFAULT_Y = 100;
const DEFAULT_HEIGHT = 690;
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface PhoneDialerProps {
    /** If true, renders as a static docked component instead of floating */
    docked?: boolean;
    /** If true, the dialer is disabled (e.g. unsaved call waiting) */
    disabled?: boolean;
    /** Short message explaining why the dialer is disabled (shown in the header) */
    disabledReason?: string;
    /** If true, the dialer is hidden but stays mounted for persistence */
    hidden?: boolean;
    /**
     * In docked mode the dialer normally collapses to a thin header bar and
     * expands on hover or during an active call. Set this to keep the dialer
     * always expanded in docked mode — used on dedicated surfaces like the
     * /session page where the custom dialer ↔ Zoom embed swap should be
     * visible at all times, not hidden behind a hover.
     */
    alwaysExpanded?: boolean;
}

export function PhoneDialer({ docked = false, disabled = false, disabledReason, hidden = false, alwaysExpanded = false }: PhoneDialerProps = {}) {
    const router = useRouter();
    const { callStatus, dialNumber, isDialing, customDialerNumber, activeCallNumber, agentRequired } = usePhone();
    const ownership = useCallOwnershipOptional();
    const { session, setSession } = useSession();
    const { isConnected: agentConnected, callState: agentCallState, networkQuality, launchAgent, launchZoom, zoomLaunching } = useLocalAgent();

    const [yPosition, setYPosition] = useState(DEFAULT_Y);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(true);
    const [showKeypad, setShowKeypad] = useState(false);

    const [ending, setEnding] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [isHovering, setIsHovering] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const positionBeforeExpand = useRef<number | null>(null);
    const dragStartPos = useRef<{ x: number, y: number } | null>(null);
    const dragOffsetY = useRef<number>(0);
    const resizeStartY = useRef<number>(0);
    const resizeStartHeight = useRef<number>(0);
    const resizeStartPosY = useRef<number>(0);
    const panelRef = useRef<HTMLDivElement>(null);

    // Only treat the call as "active FOR THIS DASHBOARD" when this device
    // actually owns it. On the shared Zoom account the iframe receives
    // updates for every teammate's calls; without this gate we'd flash
    // the Smart Embed UI on everyone's screen whenever any teammate dials.
    const isCallActive =
        (callStatus === 'ringing' || callStatus === 'connected') &&
        (ownership ? ownership.iOwnCurrentCall || ownership.iAmRinging : true);
    const headerDialNumber = customDialerNumber.trim();
    const headerDialDigits = headerDialNumber.replace(/\D/g, '');
    const canHeaderDial = !disabled && !isCallActive && headerDialDigits.length >= 3 && agentConnected;
    const activeDialDigits = activeCallNumber ? activeCallNumber.replace(/\D/g, '') : '';
    const isHeaderNumberActive = isCallActive && headerDialDigits.length >= 3 && activeDialDigits === headerDialDigits;

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

    // Auto-adjust position when expanding (floating mode only)
    useEffect(() => {
        if (docked) return;
        const isExpanded = !isMinimized;
        if (isExpanded) {
            if (positionBeforeExpand.current === null) {
                positionBeforeExpand.current = yPosition;
            }
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!panelRef.current) return;
                    const rect = panelRef.current.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;
                    if (rect.bottom > viewportHeight) {
                        const overflow = rect.bottom - viewportHeight;
                        const newY = Math.max(0, yPosition - overflow - 20);
                        setYPosition(newY);
                    }
                });
            });
        } else {
            if (positionBeforeExpand.current !== null) {
                setYPosition(positionBeforeExpand.current);
                positionBeforeExpand.current = null;
            }
        }
    }, [isMinimized, showKeypad, session, yPosition, docked]);

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
        } catch { /* ignore */ }
    }, []);

    // Save Y position when it changes
    useEffect(() => {
        try { localStorage.setItem(STORAGE_Y_KEY, yPosition.toString()); } catch { /* ignore */ }
    }, [yPosition]);

    // Save height when it changes
    useEffect(() => {
        try { localStorage.setItem(STORAGE_HEIGHT_KEY, height.toString()); } catch { /* ignore */ }
    }, [height]);

    // Vertical dragging handler
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!panelRef.current) return;
        e.preventDefault();
        const rect = panelRef.current.getBoundingClientRect();
        dragOffsetY.current = e.clientY - rect.top;
        setIsDragging(true);
    }, []);

    // Resize handlers
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
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (isDragging) {
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
            if (rafId !== null) cancelAnimationFrame(rafId);
            setIsDragging(false);
            setIsResizing(false);
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing]);

    const handleCustomDial = useCallback((phoneNumber: string) => {
        dialNumber(phoneNumber);
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

    const handleGoToSession = useCallback(() => {
        router.push('/session');
    }, [router]);

    // Compute panel dimensions
    const hasSession = session && session.status === 'active';
    const hasUnsubmittedRecording = false;
    const unsubmittedDuration = 0;
    const isCollapsed = disabled
        ? true
        : docked
            ? (alwaysExpanded ? false : (!isHovering && !isInputFocused))
            : isMinimized;
    const currentHeight = docked
        ? (isCollapsed ? '52px' : '550px')
        : (isCollapsed ? '48px' : (showKeypad ? `${height}px` : (hasSession ? 'auto' : `${height}px`)));

    const isFloatingMinimized = !docked && isMinimized;

    // Status color and icon for minimized button
    let buttonColor = 'bg-[var(--sidebar-bg)] border-[var(--card-border)] text-[var(--muted)]';
    let buttonIcon = <Phone size={20} className="opacity-50" />;
    if (!agentConnected) {
        buttonColor = 'bg-red-500/20 border-red-500/30 text-red-400';
        buttonIcon = <Phone size={20} className="opacity-50" />;
    } else if (isCallActive) {
        buttonColor = 'bg-green-500 text-white animate-pulse shadow-green-500/20';
        buttonIcon = <Phone size={20} />;
    } else if (hasSession) {
        buttonColor = 'bg-blue-500 text-white shadow-blue-500/20';
        buttonIcon = <Phone size={20} />;
    }

    return (
        <>
            {/* Floating minimized button */}
            {isFloatingMinimized && !hidden && (
                <div
                    style={{
                        top: `${yPosition}px`,
                        right: '24px',
                        position: 'fixed',
                        zIndex: 998,
                        transform: isDragging ? 'scale(1.1)' : 'scale(1)',
                        transition: isDragging ? 'transform 0.1s ease-out' : 'top 0.3s ease-out, transform 0.2s ease-out',
                    }}
                    className={cn(
                        "rounded-full shadow-2xl cursor-pointer select-none",
                        isDragging && "cursor-grabbing"
                    )}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        dragOffsetY.current = e.clientY - rect.top;
                        dragStartPos.current = { x: e.clientX, y: e.clientY };
                        setIsDragging(true);
                    }}
                    onMouseUp={(e) => {
                        if (dragStartPos.current) {
                            const dist = Math.sqrt(
                                Math.pow(e.clientX - dragStartPos.current.x, 2) +
                                Math.pow(e.clientY - dragStartPos.current.y, 2)
                            );
                            if (dist < 5) setIsMinimized(false);
                        }
                        dragStartPos.current = null;
                    }}
                >
                    <div className={cn(
                        "w-12 h-12 rounded-full flex items-center justify-center border shadow-lg transition-all hover:scale-105 active:scale-95",
                        buttonColor
                    )}>
                        {buttonIcon}
                    </div>
                </div>
            )}

            {/* Main dialer panel */}
            <div
                ref={panelRef}
                onMouseEnter={docked ? () => {
                    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null; }
                    setIsHovering(true);
                } : undefined}
                onMouseLeave={docked ? () => {
                    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null; }
                    setIsHovering(false);
                    setIsInputFocused(false);
                    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)) {
                        document.activeElement.blur();
                    }
                } : undefined}
                className={cn(
                    "flex flex-col overflow-hidden",
                    "border border-[var(--card-border)]",
                    "bg-[var(--card-bg)]",
                    disabled && "opacity-60",
                    docked ? (
                        "rounded-xl shadow-lg w-full transition-all duration-300 ease-in-out"
                    ) : (
                        cn(
                            "fixed right-0 z-[998] rounded-l-xl",
                            isDragging ? "cursor-grabbing select-none shadow-[0_20px_60px_rgba(0,0,0,0.3)]" : "shadow-2xl"
                        )
                    )
                )}
                style={{
                    ...(docked ? {
                        height: currentHeight,
                        transition: 'height 0.3s ease-out',
                    } : {
                        top: `${yPosition}px`,
                        width: '380px',
                        height: currentHeight,
                        transform: isDragging ? 'scale(1.01)' : 'scale(1)',
                        transition: isDragging ? 'transform 0.1s ease-out, box-shadow 0.1s ease-out' : 'top 0.3s ease-out, height 0.3s ease-out, transform 0.2s ease-out, box-shadow 0.2s ease-out',
                        willChange: isDragging ? 'top, transform' : 'auto',
                    }),
                    ...((isFloatingMinimized || hidden) && { display: 'none' }),
                }}
            >
            {/* Header */}
            {docked ? (
                <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                    <Phone size={16} className={cn(
                        "shrink-0 transition-colors",
                        isCallActive ? "text-[var(--success)] animate-pulse" : agentConnected ? "text-blue-400" : "text-red-400"
                    )} />
                    {disabled ? (
                        <div className="flex-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-[var(--warning)] font-medium">
                                {disabledReason || 'Submit call log first'}
                            </span>
                        </div>
                    ) : !agentConnected ? (
                        <div className="flex-1 flex items-center justify-between gap-2">
                            <button
                                onClick={launchAgent}
                                className="text-xs text-red-500 hover:text-red-400 font-medium transition-colors"
                            >
                                Agent offline — Click to launch
                            </button>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                {headerDialDigits.length > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (canHeaderDial) dialNumber(headerDialNumber);
                                        }}
                                        className={cn(
                                            "flex items-center gap-1.5 text-xs font-semibold truncate",
                                            canHeaderDial ? "text-[var(--foreground)] hover:text-blue-600" : "text-[var(--muted)]"
                                        )}
                                        title={canHeaderDial ? 'Dial this number' : 'Enter at least 3 digits to dial'}
                                    >
                                        <PhoneCall size={12} className={cn(
                                            "shrink-0",
                                            canHeaderDial ? "text-blue-500" : "text-[var(--muted)]"
                                        )} />
                                        <span className="truncate">{headerDialNumber}</span>
                                    </button>
                                ) : (
                                    <span className="text-xs font-semibold text-[var(--muted)]">Dialer</span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {isHeaderNumberActive && (
                                    <span className={cn(
                                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                        callStatus === 'ringing'
                                            ? "bg-amber-100 text-amber-700"
                                            : "bg-[var(--success-subtle)] text-[var(--success)]"
                                    )}>
                                        {callStatus === 'ringing' ? 'Ringing' : 'On Call'}
                                    </span>
                                )}
                                <span className="text-[10px] text-[var(--muted)] italic">
                                    {isCallActive ? 'On call' : 'Hover to Dial'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Floating mode: Drag handle + header */
                <div className="flex shrink-0">
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

                    <div className="flex-1 flex items-center justify-between px-3 py-2 bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                        <div className="flex items-center gap-2">
                            <Phone size={14} className={agentConnected ? "text-blue-400" : "text-red-400"} />
                            <span className="text-xs font-semibold">
                                {hasSession ? 'Call Session' : 'Phone'}
                            </span>
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
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setIsMinimized(!isMinimized)}
                                className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                title={isMinimized ? 'Expand' : 'Minimize'}
                            >
                                {isMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Content Area */}
            <div
                className="flex-1 flex flex-col overflow-hidden"
                style={{ display: isCollapsed ? 'none' : 'flex' }}
            >
                {/* Session Stats Panel - Only show when session is active and NOT docked */}
                {hasSession && !showKeypad && !docked && (
                    <div className="flex-1 p-4 space-y-4 overflow-y-auto">
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

                        <div className="flex items-center justify-between gap-3 px-1 py-1">
                            <span className="text-xs font-semibold text-[var(--muted)] uppercase whitespace-nowrap">Dialer:</span>
                            <button
                                onClick={() => setShowKeypad(true)}
                                className="flex-1 text-xs font-medium py-1.5 rounded-md transition-all text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] bg-[var(--sidebar-bg)] border border-[var(--card-border)]"
                            >
                                Open Dialer
                            </button>
                        </div>
                    </div>
                )}

                {/* Dialer section */}
                <div
                    className="flex-1 flex flex-col"
                    style={{ display: (showKeypad || !hasSession || docked) ? undefined : 'none' }}
                >
                    {/* Resize Handle */}
                    {showKeypad && (
                        <div
                            className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-[1000] hover:bg-blue-400/50 transition-colors"
                            onMouseDown={handleResizeMouseDown}
                            title="Drag to resize height"
                        />
                    )}

                    {/* Hide Keypad Button */}
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

                        {/* Local Agent Status */}
                        <div className={cn(
                            'flex items-center gap-1.5 px-3 py-1 border-b border-[var(--card-border)] text-[10px]',
                            agentConnected ? 'bg-[var(--sidebar-bg)]' : 'bg-red-500/5 border-red-500/20'
                        )}>
                            <span className={cn(
                                'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                                agentConnected ? 'bg-green-500' : 'bg-red-500'
                            )} />
                            {agentConnected ? (
                                <span className="text-[var(--muted)] font-medium flex items-center gap-1.5 flex-wrap">
                                    Agent
                                    {agentCallState?.state === 'connected' && (
                                        <span className="text-green-500 ml-1">Call active</span>
                                    )}
                                    {networkQuality && !networkQuality.isStable && (
                                        <span className="text-yellow-500 ml-1">Network unstable</span>
                                    )}
                                    {ownership?.teammateBusy && (
                                        <span
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30"
                                            title="Shared Zoom account presence reports 'On a call' but no call UI is visible on this machine — another teammate is on the shared line."
                                        >
                                            <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                                            Shared line busy — teammate on call
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <button
                                    onClick={launchAgent}
                                    className="text-red-500 hover:text-red-400 font-medium transition-colors"
                                    title="Click to launch the CRM Agent for phone calls"
                                >
                                    Agent offline — Click to launch
                                </button>
                            )}
                        </div>

                        {/* Dialer area: custom dialer always shown; Zoom app handles active calls */}
                        <div className="flex-1 relative">
                            {!agentConnected ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--card-bg)] p-6">
                                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                                        <Phone size={20} className="text-red-400" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-semibold text-[var(--foreground)]">Agent Required</p>
                                        <p className="text-xs text-[var(--muted)] mt-1">Phone features require the CRM Agent to be running.</p>
                                    </div>
                                    <button
                                        onClick={launchAgent}
                                        className="px-4 py-2 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
                                    >
                                        Launch Agent
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* Zoom Smart Embed disabled — use Zoom app directly for call control */}
                                    {/* isCallActive ? (
                                        <div className="absolute inset-0 flex flex-col">
                                            <iframe
                                                id="zoom-embed-control"
                                                src={ZOOM_EMBED_URL}
                                                allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                                                title="Zoom Phone"
                                                className="w-full flex-1 border-0"
                                                style={{ minHeight: 380 }}
                                            />
                                        </div>
                                    ) : null */}

                                    {isCallActive ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--card-bg)] p-6">
                                            <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                                                <PhoneCall size={20} className="text-green-500" />
                                            </div>
                                            <p className="text-sm font-semibold text-[var(--foreground)] text-center">
                                                Open Zoom App For Call controls
                                            </p>
                                            <button
                                                onClick={launchZoom}
                                                disabled={zoomLaunching}
                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors disabled:opacity-50"
                                            >
                                                {zoomLaunching ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                                                Open Zoom App
                                            </button>
                                        </div>
                                    ) : (
                                        <CustomDialerOverlay onDial={handleCustomDial} onFocusChange={setIsInputFocused} visible={!isCollapsed} />
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </>
    );
}


