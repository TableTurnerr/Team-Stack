'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, X, GripHorizontal, Minimize2, Maximize2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useZoomPhone } from '@/contexts/zoom-phone-context';

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';

const STORAGE_KEY = 'zoom-dialer-position';
const STORAGE_HEIGHT_KEY = 'zoom-dialer-height';
const DEFAULT_POSITION = { x: -1, y: -1 }; // -1 means "use default" (bottom-right)
const DEFAULT_HEIGHT = 690; // Increased default height
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 800;

interface Position {
    x: number;
    y: number;
}

export function ZoomPhoneDialer() {
    const { isDialerOpen, toggleDialer, iframeRef, setIframeReady } = useZoomPhone();
    const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [iframeLoadedLocal, setIframeLoadedLocal] = useState(false);

    const dragOffset = useRef<Position>({ x: 0, y: 0 });
    const resizeStartY = useRef<number>(0);
    const resizeStartHeight = useRef<number>(0);
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
        setIsResizing(true);
    }, [height]);

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
                // Resizing from top means: deltaY > 0 -> shrink, deltaY < 0 -> grow
                // But we also need to adjust Y position so bottom stays fixed relative to cursor
                // Actually simplest is just changing height.
                // Wait, if it's a fixed position panel, resizing from top should usually change top position + height.
                // Let's implement resize from top handle for consistency with "floating up" UI.

                const deltaY = e.clientY - resizeStartY.current;
                const newHeight = Math.max(MIN_HEIGHT, Math.min(resizeStartHeight.current - deltaY, MAX_HEIGHT));

                // If we change height, we must also change Top position to make it grow "upwards" 
                // ONLY if it was positioned relative to top (which it is when x/y are set).
                // If we are resizing "up", top decreases.

                if (newHeight !== height) {
                    setHeight(newHeight);
                    // Adjust Y position to keep bottom anchored visually (optional, but better UX)
                    if (position.y !== -1) {
                        setPosition(prev => ({
                            ...prev,
                            y: prev.y + (resizeStartHeight.current - newHeight) // deltaY approximation
                        }));
                    }
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

    // Compute panel style
    // If minimized, force height to auto/header size
    const currentHeight = isMinimized ? '48px' : `${height}px`;

    // Default position: Bottom 88px, Right 24px
    // When opened without saved position, we use fixed positioning.
    const panelStyle: React.CSSProperties = position.x === -1 && position.y === -1
        ? { right: '24px', bottom: '24px' } // No longer sitting above FAB, since FAB hides
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

            {/* Dialer Panel */}
            {isDialerOpen && (
                <div
                    ref={panelRef}
                    className={cn(
                        "fixed z-[998] flex flex-col rounded-xl overflow-hidden shadow-2xl",
                        "border border-[var(--card-border)]",
                        "bg-[var(--card-bg)]",
                        isDragging ? "cursor-grabbing select-none" : ""
                    )}
                    style={{
                        ...panelStyle,
                        width: '380px',
                        height: currentHeight,
                        transition: (isDragging || isResizing) ? 'none' : 'height 0.2s ease, opacity 0.2s ease',
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
                                {/* Resize Handle (Horizontal grip in header for dragging, we'll add a separate resize handle at top) */}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
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

                    {/* Iframe Content */}
                    {!isMinimized && (
                        <div className="flex-1 relative bg-white flex flex-col">
                            {/* Loading State */}
                            {!iframeLoadedLocal && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--card-bg)]">
                                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-xs text-[var(--muted)]">Loading Zoom Phone...</span>
                                </div>
                            )}

                            <iframe
                                ref={iframeRef}
                                src={ZOOM_EMBED_URL}
                                onLoad={() => { setIframeLoadedLocal(true); setIframeReady(true); }}
                                className="w-full h-full border-0"
                                allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                                title="Zoom Phone Dialer"
                            />
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
