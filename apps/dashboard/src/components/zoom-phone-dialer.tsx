'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, X, GripHorizontal, Minimize2, Maximize2, ArrowLeftRight, PhoneOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { CallRecorderControls } from '@/components/call-recorder-controls';
import { CustomDialerOverlay } from '@/components/custom-dialer-overlay';

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';

const STORAGE_KEY = 'zoom-dialer-position';
const STORAGE_HEIGHT_KEY = 'zoom-dialer-height';
const ZOOM_SHOW_NATIVE_KEY = 'zoom-show-native-dialer';
const DEFAULT_POSITION = { x: -1, y: -1 }; // -1 means "use default" (bottom-right)
const DEFAULT_HEIGHT = 690; // Increased default height
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

interface Position {
    x: number;
    y: number;
}

export function ZoomPhoneDialer() {
    const { isDialerOpen, toggleDialer, callStatus, dialNumber, iframeRef, setIframeReady, isDialing, endCall } = useZoomPhone();
    const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(true);
    const [iframeLoadedLocal, setIframeLoadedLocal] = useState(false);

    // "Show Zoom Native Dialer" setting from integrations
    const [showNativeEnabled, setShowNativeEnabled] = useState(false);
    // Manual override: user clicked the swap button
    const [forceNativeDialer, setForceNativeDialer] = useState(false);
    // Show custom dialer overlay when not in an active call, user hasn't forced native, and not mid-dial
    const showCustomDialer = !forceNativeDialer && !isDialing && (callStatus === 'idle' || callStatus === 'ended');

    // Auto-minimize when call ends
    useEffect(() => {
        if (callStatus === 'ended' || callStatus === 'idle') {
            setIsMinimized(true);
        }
    }, [callStatus]);

    // Un-minimize when dialing starts
    useEffect(() => {
        if (isDialing) {
            setIsMinimized(false);
        }
    }, [isDialing]);

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

    const dragOffset = useRef<Position>({ x: 0, y: 0 });
    const resizeStartY = useRef<number>(0);
    const resizeStartHeight = useRef<number>(0);
    const resizeStartPosY = useRef<number>(0);
    const panelRef = useRef<HTMLDivElement>(null);

    // Load saved position and height
    useEffect(() => {
        try {
            const savedPos = localStorage.getItem(STORAGE_KEY);
            if (savedPos) {
                const parsed = JSON.parse(savedPos);
                // Validate position is within bounds
                const maxX = window.innerWidth - 380;
                const maxY = window.innerHeight - 100;
                const clampedX = Math.max(0, Math.min(parsed.x, maxX));
                const clampedY = Math.max(0, Math.min(parsed.y, maxY));

                setPosition({ x: clampedX, y: clampedY });
            }

            const savedHeight = localStorage.getItem(STORAGE_HEIGHT_KEY);
            if (savedHeight) setHeight(parseInt(savedHeight, 10));
        } catch {
            // ignore
        }
    }, []);

    // Save position when it changes
    useEffect(() => {
        if (position.x !== -1 || position.y !== -1) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
            } catch {
                // ignore
            }
        }
    }, [position]);

    // Save height when it changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_HEIGHT_KEY, height.toString());
        } catch {
            // ignore
        }
    }, [height]);

    // Dragging handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!panelRef.current) return;
        e.preventDefault();
        const rect = panelRef.current.getBoundingClientRect();
        dragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        setIsDragging(true);
    }, []);

    // Resize handlers (Top resize)
    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeStartY.current = e.clientY;
        resizeStartHeight.current = height;
        resizeStartPosY.current = position.y;
        setIsResizing(true);
    }, [height, position.y]);

    useEffect(() => {
        if (!isDragging && !isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const newX = e.clientX - dragOffset.current.x;
                const newY = e.clientY - dragOffset.current.y;

                // Clamp to viewport
                const maxX = window.innerWidth - 380;
                const maxY = window.innerHeight - 100;

                setPosition({
                    x: Math.max(0, Math.min(newX, maxX)),
                    y: Math.max(0, Math.min(newY, maxY))
                });
            } else if (isResizing) {
                const deltaY = e.clientY - resizeStartY.current;
                const newHeight = Math.max(MIN_HEIGHT, Math.min(resizeStartHeight.current - deltaY, MAX_HEIGHT));
                const heightDiff = resizeStartHeight.current - newHeight;

                setHeight(newHeight);
                if (resizeStartPosY.current !== -1) {
                    setPosition(prev => ({
                        ...prev,
                        y: resizeStartPosY.current + heightDiff
                    }));
                }
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, height, position.y]);

    // When the user dials from our custom dialer
    const handleCustomDial = useCallback((phoneNumber: string) => {
        dialNumber(phoneNumber);   // dialNumber sets isDialing in context
    }, [dialNumber]);

    // Compute panel style
    const currentHeight = isMinimized ? '48px' : `${height}px`;

    const panelStyle: React.CSSProperties = position.x === -1 && position.y === -1
        ? { right: '24px', bottom: '24px' }
        : { left: `${position.x}px`, top: `${position.y}px` };

    return (
        <>
            {/* Floating Action Button - Only visible when dialer is CLOSED */}
            {!isDialerOpen && (
                <button
                    onClick={toggleDialer}
                    className={cn(
                        "fixed bottom-6 right-6 z-[999] w-14 h-14 rounded-full shadow-lg",
                        "flex items-center justify-center transition-all duration-300",
                        "hover:scale-110 active:scale-95",
                        "bg-blue-500 hover:bg-blue-600 text-white"
                    )}
                    title="Open Zoom Phone"
                >
                    <Phone size={24} />
                </button>
            )}

            {/* Dialer Panel - ALWAYS rendered but hidden when closed to keep iframe alive */}
            <div
                ref={panelRef}
                className={cn(
                    "fixed z-[998] flex flex-col rounded-xl overflow-hidden shadow-2xl",
                    "border border-[var(--card-border)]",
                    "bg-[var(--card-bg)] transition-all duration-300",
                    isDragging ? "cursor-grabbing select-none" : "",
                    !isDialerOpen && "opacity-0 pointer-events-none translate-y-10 scale-95"
                )}
                style={{
                    ...panelStyle,
                    width: '380px',
                    height: currentHeight,
                    visibility: isDialerOpen ? 'visible' : 'hidden',
                }}
            >
                {/* Header / Drag Handle */}
                <div
                    onMouseDown={handleMouseDown}
                    className={cn(
                        "flex items-center justify-between px-3 py-2",
                        "bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]",
                        "cursor-grab select-none shrink-0",
                        isDragging && "cursor-grabbing"
                    )}
                >
                    <div className="flex items-center gap-2">
                        <GripHorizontal size={14} className="text-[var(--muted)]" />
                        <div className="flex items-center gap-1.5">
                            <Phone size={14} className="text-blue-400" />
                            <span className="text-xs font-semibold">Zoom Phone</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {/* End Call Button — only visible during active call */}
                        {(callStatus === 'ringing' || callStatus === 'connected') && (
                            <button
                                onClick={endCall}
                                className="mr-2 px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold flex items-center gap-1 transition-colors animate-pulse"
                                title="End Call"
                            >
                                <Phone size={10} className="rotate-[135deg]" />
                                <span>END CALL</span>
                            </button>
                        )}

                        {/* Swap to Zoom Native Dialer — only visible when enabled in Settings */}
                        {showNativeEnabled && (
                            <button
                                onClick={() => setForceNativeDialer(!forceNativeDialer)}
                                className={`p-1 rounded hover:bg-[var(--card-hover)] transition-colors ${forceNativeDialer
                                    ? 'text-blue-400 hover:text-blue-300'
                                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                                    }`}
                                title={forceNativeDialer ? 'Switch to Custom Dialer' : 'Switch to Zoom Native Dialer'}
                            >
                                <ArrowLeftRight size={12} />
                            </button>
                        )}
                        <button
                            onClick={() => setIsMinimized(!isMinimized)}
                            className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                            title={isMinimized ? 'Expand' : 'Minimize'}
                        >
                            {isMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                        </button>
                        <button
                            onClick={toggleDialer}
                            className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-red-400 transition-colors"
                            title="Close"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>

                {/* Resize Handle (Top Bar) - Only show when NOT minimized */}
                {!isMinimized && (
                    <div
                        className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-[1000] hover:bg-blue-400/50 transition-colors"
                        onMouseDown={handleResizeMouseDown}
                        title="Drag to resize height"
                    />
                )}

                {/* Content Area - Always rendered to keep iframe alive */}
                <div 
                    className={cn(
                        "flex-1 flex flex-col bg-white overflow-hidden transition-opacity duration-200", 
                        isMinimized ? "opacity-0 pointer-events-none h-0" : "opacity-100"
                    )}
                >
                    {/* Call Recorder Controls — always visible above the dialer/iframe */}
                    <CallRecorderControls />

                    {/* Dialer / Iframe area */}
                    <div className="flex-1 relative">
                        {/* Custom Dialer Overlay — shown when no active call */}
                        {showCustomDialer && (
                            <CustomDialerOverlay onDial={handleCustomDial} />
                        )}

                        {/* Loading State (visible only when Zoom iframe is showing) */}
                        {!showCustomDialer && !iframeLoadedLocal && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--card-bg)] z-[5]">
                                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs text-[var(--muted)]">Loading Zoom Phone...</span>
                            </div>
                        )}

                        {/* Zoom iframe — ALWAYS MOUNTED */}
                        <iframe
                            id="zoom-iframe"
                            ref={iframeRef}
                            src={ZOOM_EMBED_URL}
                            onLoad={() => { setIframeLoadedLocal(true); setIframeReady(true); }}
                            className="w-full h-full border-0"
                            allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                            title="Zoom Phone Dialer"
                        />
                    </div>
                </div>
            </div>
        </>
    );
}
