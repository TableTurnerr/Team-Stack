'use client';

import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

interface ZoomPhoneContextType {
    /** Whether the dialer panel is currently visible */
    isDialerOpen: boolean;
    /** Toggle the dialer panel open/closed */
    toggleDialer: () => void;
    /** Open the dialer and auto-dial a phone number */
    dialNumber: (phoneNumber: string) => void;
    /** Reference to the iframe element for postMessage communication */
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    /** Function to notify context when iframe is loaded */
    setIframeReady: (ready: boolean) => void;
}

const ZoomPhoneContext = createContext<ZoomPhoneContextType | null>(null);

export function useZoomPhone() {
    const context = useContext(ZoomPhoneContext);
    if (!context) {
        throw new Error('useZoomPhone must be used within ZoomPhoneProvider');
    }
    return context;
}

/**
 * Try to use the zoom phone context, returns null if not wrapped in provider.
 * Used by ZoomCallButton to optionally integrate with the dialer.
 */
export function useZoomPhoneOptional() {
    return useContext(ZoomPhoneContext);
}

export function ZoomPhoneProvider({ children }: { children: ReactNode }) {
    const [isDialerOpen, setIsDialerOpen] = useState(false);
    const [iframeReady, setIframeReadyState] = useState(false);
    const pendingCallRef = useRef<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    const setIframeReady = useCallback((ready: boolean) => {
        setIframeReadyState(ready);
    }, []);

    const toggleDialer = useCallback(() => {
        setIsDialerOpen(prev => !prev);
    }, []);

    const sendDialMessage = useCallback((phoneNumber: string) => {
        if (!iframeRef.current?.contentWindow) return false;

        // Read the user's autoDial preference from localStorage
        // Default: false (populate number only, user presses Call in dialer)
        // When true: Zoom routes the call through the desktop app automatically
        let autoDialEnabled = false;
        try {
            const saved = localStorage.getItem('zoom-phone-autodial');
            if (saved !== null) autoDialEnabled = JSON.parse(saved);
        } catch {
            // ignore
        }

        iframeRef.current.contentWindow.postMessage(
            {
                type: 'zp-make-call',
                data: {
                    number: phoneNumber,
                    autoDial: autoDialEnabled
                }
            },
            'https://applications.zoom.us'
        );
        return true;
    }, []);

    // Retry sending pending call with increasing delays
    // The Zoom app inside the iframe needs time to initialize its message listeners
    // even after the iframe's onload fires
    useEffect(() => {
        const pending = pendingCallRef.current;
        if (!pending || !isDialerOpen || !iframeReady) return;

        // Try multiple times with increasing delays
        const delays = [500, 1500, 3000, 5000];
        const timers: NodeJS.Timeout[] = [];

        delays.forEach(delay => {
            timers.push(setTimeout(() => {
                if (pendingCallRef.current === pending) {
                    sendDialMessage(pending);
                }
            }, delay));
        });

        // Clear pending after the last attempt
        timers.push(setTimeout(() => {
            if (pendingCallRef.current === pending) {
                pendingCallRef.current = null;
            }
        }, delays[delays.length - 1] + 500));

        return () => timers.forEach(t => clearTimeout(t));
    }, [iframeReady, isDialerOpen, sendDialMessage]);

    const dialNumber = useCallback((phoneNumber: string) => {
        // Clean the phone number
        const hasPlus = phoneNumber.startsWith('+');
        const digits = phoneNumber.replace(/\D/g, '');
        const cleaned = hasPlus ? `+${digits}` : digits;

        if (!cleaned || digits.length < 7) return;

        // Open the dialer if it's not already open
        setIsDialerOpen(true);

        if (iframeReady && iframeRef.current?.contentWindow) {
            // Dialer is loaded — send immediately and also retry in case
            // the Zoom app hasn't fully initialized
            sendDialMessage(cleaned);
            pendingCallRef.current = cleaned;
        } else {
            // Queue it — the useEffect will fire once iframeReady becomes true
            pendingCallRef.current = cleaned;
        }
    }, [iframeReady, sendDialMessage]);

    return (
        <ZoomPhoneContext.Provider value={{ isDialerOpen, toggleDialer, dialNumber, iframeRef, setIframeReady }}>
            {children}
        </ZoomPhoneContext.Provider>
    );
}
