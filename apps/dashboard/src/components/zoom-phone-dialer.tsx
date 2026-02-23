'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneCall, X, GripHorizontal, Minimize2, Maximize2, ArrowLeftRight, ChevronLeft, Power, Loader2, Delete } from 'lucide-react';
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
    /** If true, the dialer is hidden but stays mounted for persistence */
    hidden?: boolean;
}

export function ZoomPhoneDialer({ docked = false, disabled = false, hidden = false }: ZoomPhoneDialerProps = {}) {
    const router = useRouter();
    const { callStatus, dialNumber, iframeRef, iframeReady, setIframeReady, isDialing, refreshKey, customDialerNumber, activeCallNumber } = useZoomPhone();
    const { session, setSession } = useSession();

    const [yPosition, setYPosition] = useState(DEFAULT_Y);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(true);
    const [showKeypad, setShowKeypad] = useState(false);

    const [ending, setEnding] = useState(false);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [isHovering, setIsHovering] = useState(false);
    const [dockedDialInput, setDockedDialInput] = useState('');
    const [isInputFocused, setIsInputFocused] = useState(false);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Zoom dialer 30-second preview state
    const [zoomPreviewActive, setZoomPreviewActive] = useState(false);
    const [zoomPreviewSecondsLeft, setZoomPreviewSecondsLeft] = useState(0);
    const zoomPreviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const positionBeforeExpand = useRef<number | null>(null);

    // Cleanup zoom preview timer on unmount
    useEffect(() => {
        return () => {
            if (zoomPreviewTimerRef.current) clearInterval(zoomPreviewTimerRef.current);
        };
    }, []);

    const handleZoomPreview = useCallback(() => {
        if (zoomPreviewActive) {
            // Cancel preview early
            if (zoomPreviewTimerRef.current) clearInterval(zoomPreviewTimerRef.current);
            zoomPreviewTimerRef.current = null;
            setForceNativeDialer(false);
            setZoomPreviewActive(false);
            setZoomPreviewSecondsLeft(0);
            return;
        }
        setForceNativeDialer(true);
        setZoomPreviewActive(true);
        setZoomPreviewSecondsLeft(30);
        let remaining = 30;
        zoomPreviewTimerRef.current = setInterval(() => {
            remaining--;
            setZoomPreviewSecondsLeft(remaining);
            if (remaining <= 0) {
                clearInterval(zoomPreviewTimerRef.current!);
                zoomPreviewTimerRef.current = null;
                setForceNativeDialer(false);
                setZoomPreviewActive(false);
                setZoomPreviewSecondsLeft(0);
            }
        }, 1000);
    }, [zoomPreviewActive]);
    const dragStartPos = useRef<{ x: number, y: number } | null>(null);



    // "Show Zoom Native Dialer" setting from integrations
    const [showNativeEnabled, setShowNativeEnabled] = useState(false);
    // Manual override: user clicked the swap button
    const [forceNativeDialer, setForceNativeDialer] = useState(false);
    // Show custom dialer overlay when not in an active call, user hasn't forced native, and not mid-dial
    const showCustomDialer = !forceNativeDialer && !isDialing && (callStatus === 'idle' || callStatus === 'ended');

    const isCallActive = callStatus === 'ringing' || callStatus === 'connected';
    const headerDialNumber = customDialerNumber.trim();
    const headerDialDigits = headerDialNumber.replace(/\D/g, '');
    const canHeaderDial = !disabled && !isCallActive && headerDialDigits.length >= 3;
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

    // Docked mode dial handler
    const handleDockedDial = useCallback(() => {
        const cleaned = dockedDialInput.trim();
        if (cleaned.length >= 3) {
            dialNumber(cleaned);
            setDockedDialInput('');
        }
    }, [dockedDialInput, dialNumber]);

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


    // Compute panel dimensions
    const hasSession = session && session.status === 'active';
    // In docked mode, auto-hide/minimize when not hovered
    // When disabled, always keep collapsed
    // In docked mode, expand on hover OR during active call OR when a recording is unsubmitted
    // TODO: wire hasUnsubmittedRecording/unsubmittedDuration to actual state
    const hasUnsubmittedRecording = false;
    const unsubmittedDuration = 0;
    const isCollapsed = disabled ? true : (docked ? (!isHovering && !isCallActive && !isInputFocused && !hasUnsubmittedRecording && !zoomPreviewActive) : isMinimized);
    const currentHeight = docked
        ? (isCollapsed ? '52px' : '550px')
        : (isCollapsed ? '48px' : (showKeypad ? `${height}px` : (hasSession ? 'auto' : `${height}px`)));

    const isFloatingMinimized = !docked && isMinimized;

    // Determine status color and icon for minimized button
    let buttonColor = 'bg-[var(--sidebar-bg)] border-[var(--card-border)] text-[var(--muted)]';
    let buttonIcon = <Phone size={20} className="opacity-50" />;

    if (isCallActive) {
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
                            if (dist < 5) {
                                setIsMinimized(false);
                            }
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

            {/* Main dialer panel — always mounted for persistence */}
            <div
                ref={panelRef}
                onMouseEnter={docked ? () => {
                    if (hoverTimeoutRef.current) {
                        clearTimeout(hoverTimeoutRef.current);
                        hoverTimeoutRef.current = null;
                    }
                    setIsHovering(true);
                } : undefined}
                onMouseLeave={docked ? () => {
                    hoverTimeoutRef.current = setTimeout(() => {
                        setIsHovering(false);
                    }, 300);
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
            {/* Header / Drag Handle */}
            {docked ? (
                /* Docked mode: Simple dial input row */
                <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                    <Phone size={16} className={cn(
                        "shrink-0 transition-colors",
                        isCallActive ? "text-[var(--success)] animate-pulse" : "text-blue-400"
                    )} />
                    {disabled ? (
                        <span className="flex-1 text-xs text-[var(--warning)] font-medium">
                            Submit call log first
                        </span>
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
                                    {isCallActive ? 'Hover for Zoom controls' : 'Hover to Dial'}
                                </span>
                                {!isCallActive && (
                                    <button
                                        type="button"
                                        onClick={handleZoomPreview}
                                        className={cn(
                                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border transition-all",
                                            zoomPreviewActive
                                                ? "bg-blue-50 border-blue-300 text-blue-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                                                : "bg-[var(--sidebar-bg)] border-[var(--card-border)] text-[var(--muted)] hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50"
                                        )}
                                        title={zoomPreviewActive ? 'Click to cancel preview' : 'Preview Zoom dialer for 30 seconds'}
                                    >
                                        {zoomPreviewActive ? `Zoom (${zoomPreviewSecondsLeft}s)` : 'Zoom dialer 30sec'}
                                    </button>
                                )}
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
                            <Phone size={14} className="text-blue-400" />
                            <span className="text-xs font-semibold">
                                {hasSession ? 'Call Session' : 'Zoom Phone'}
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

            {/* Content Area - Keep mounted but hide with CSS to prevent iframe reload */}
            <div
                className="flex-1 flex flex-col overflow-hidden"
                style={{
                    display: isCollapsed ? 'none' : 'flex'
                }}
            >
                {/* Recorded but unsubmitted lead stays visible until submitted */}
                {hasUnsubmittedRecording && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border-b border-yellow-200">
                        <span className="text-xs font-semibold text-yellow-700">Recorded but unsubmitted</span>
                        <span className="text-xs text-yellow-700">{formatDuration(unsubmittedDuration)}</span>
                    </div>
                )}
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
                        <div className="flex items-center justify-between gap-3 px-1 py-1">
                            <span className="text-xs font-semibold text-[var(--muted)] uppercase whitespace-nowrap">Dialer:</span>
                            <div className="flex bg-[var(--sidebar-bg)] p-1 rounded-lg border border-[var(--card-border)] w-full">
                                <button
                                    onClick={() => {
                                        setForceNativeDialer(false);
                                        setShowKeypad(true);
                                    }}
                                    className={cn(
                                        "flex-1 text-xs font-medium py-1.5 rounded-md transition-all text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)]"
                                    )}
                                >
                                    Custom
                                </button>
                                <button
                                    onClick={() => {
                                        setForceNativeDialer(true);
                                        setShowKeypad(true);
                                    }}
                                    className={cn(
                                        "flex-1 text-xs font-medium py-1.5 rounded-md transition-all text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)]"
                                    )}
                                >
                                    Zoom
                                </button>
                            </div>
                        </div>

                        {/* End Session Button removed: Call can only be ended from Zoom dialer iframe */}
                    </div>
                )}

                {/* Zoom Iframe section — always mounted, visibility toggled via CSS */}
                <div
                    className="flex-1 flex flex-col"
                    style={{ display: (showKeypad || !hasSession || docked) ? undefined : 'none' }}
                >
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
                                {/* Custom Dialer Overlay — always mounted for persistence */}
                                <div style={{ display: showCustomDialer ? undefined : 'none' }}>
                                    <CustomDialerOverlay onDial={handleCustomDial} onFocusChange={setIsInputFocused} visible={showCustomDialer} />
                                </div>

                                {/* Loading State */}
                                {!showCustomDialer && !iframeReady && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--card-bg)] z-[5]">
                                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                        <span className="text-xs text-[var(--muted)]">Loading Zoom Phone...</span>
                                    </div>
                                )}

                                {/* Zoom iframe — ALWAYS MOUNTED */}
                                <iframe
                                    id={hidden ? 'zoom-iframe-hidden' : 'zoom-iframe'}
                                    key={refreshKey}
                                    ref={hidden ? undefined : iframeRef}
                                    src={ZOOM_EMBED_URL}
                                    onLoad={() => setIframeReady(true)}
                                    className="w-full h-full border-0"
                                    allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                                    title="Zoom Phone Dialer"
                                />
                            </div>
                        </div>
                </div>
            </div>
        </div>
        </>
    );
}
