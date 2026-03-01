'use client';

import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

// ── Zoom Call Status ────────────────────────────────────────────────────
export type ZoomCallStatus = 'idle' | 'ringing' | 'connected' | 'ended';

interface ZoomPhoneContextType {
    /** Whether the dialer panel is currently visible */
    isDialerOpen: boolean;
    /** Toggle the dialer panel open/closed */
    toggleDialer: () => void;
    /** Open the dialer and auto-dial a phone number */
    dialNumber: (phoneNumber: string) => void;
    /** The last phone number that was dialed via CRM buttons */
    lastDialedNumber: string | null;
    /** Current call status as reported by the Zoom embed via postMessage */
    callStatus: ZoomCallStatus;
    /** Phone number of the active/last call from the Zoom dialer UI */
    activeCallNumber: string | null;
    /** Whether the iframe has finished loading its initial URL */
    iframeReady: boolean;
    /** Reference to the iframe element for postMessage communication */
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    /** Function to notify context when iframe is loaded */
    setIframeReady: (ready: boolean) => void;
    /** End the current call via postMessage */
    endCall: () => void;
    /** Current number being typed in the custom dialer (for syncing with recorder) */
    customDialerNumber: string;
    /** Update the number being typed in the custom dialer */
    setCustomDialerNumber: (num: string) => void;
    /** Whether a dial is in progress (hides custom overlay immediately) */
    isDialing: boolean;
    /** Register a callback to be invoked synchronously when dialNumber is called (for auto-starting recording session within user gesture) */
    registerDialCallback: (cb: (() => void) | null) => void;
    /** Refresh the Zoom dialer iframe */
    refreshDialer: () => void;
    /** Key used to force-refresh the Zoom iframe */
    refreshKey: number;
    /** Auto-hangup after N seconds of ringing (false = disabled) */
    autoHangupEnabled: boolean;
    /** Seconds before auto-hangup fires (default 15) */
    autoHangupSeconds: number;
    /** Configure auto-hangup */
    setAutoHangup: (enabled: boolean, seconds?: number) => void;
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

/**
 * Extract a phone number from Zoom embed event data.
 * Zoom events can send the number in different fields depending on the event.
 */
function extractPhoneNumber(data: Record<string, unknown>): string | null {
    // First, try to extract from nested caller/callee objects
    const caller = data?.caller as Record<string, unknown> | undefined;
    const callee = data?.callee as Record<string, unknown> | undefined;

    // Log the structure of caller/callee if they exist (for debugging)
    if (caller && Object.keys(caller).length > 0) {
        console.log('[Zoom Phone] 🔍 Caller object structure:', JSON.stringify(caller, null, 2));
    }
    if (callee && Object.keys(callee).length > 0) {
        console.log('[Zoom Phone] 🔍 Callee object structure:', JSON.stringify(callee, null, 2));
    }

    // Prefer outbound target fields first (callee/to), then generic fields,
    // and only then fallback to caller/from.
    const candidates = [
        data?.targetNumber,
        data?.dialNumber,
        data?.inputNumber,
        data?.value, // For input events
        // Nested in callee object
        callee?.phoneNumber,
        callee?.number,
        callee?.extensionNumber,
        // Try 'to' field (can be string or object)
        typeof data?.to === 'string' ? data.to : (data?.to as Record<string, unknown>)?.phoneNumber,
        // Generic fields
        data?.phoneNumber,
        data?.number,
        // Other nested structures
        (data?.contact as Record<string, unknown>)?.phoneNumber,
        (data?.call as Record<string, unknown>)?.phoneNumber,
        (data?.call as Record<string, unknown>)?.number,
        (data?.participant as Record<string, unknown>)?.phoneNumber,
        // Nested in caller object (lowest priority)
        caller?.phoneNumber,
        caller?.number,
        caller?.extensionNumber,
        // Finally try from field
        typeof data?.from === 'string' ? data.from : (data?.from as Record<string, unknown>)?.phoneNumber,
    ];

    for (const c of candidates) {
        if (typeof c === 'string' && c.replace(/\D/g, '').length >= 7) {
            // Clean and return the phone number
            const cleaned = c.trim();
            console.log('[Zoom Phone] ✅ Extracted phone number:', cleaned);
            return cleaned;
        }
    }
    return null;
}

export function ZoomPhoneProvider({ children }: { children: ReactNode }) {
    const [isDialerOpen, setIsDialerOpen] = useState(false);
    const [iframeReady, setIframeReadyState] = useState(false);
    const [lastDialedNumber, setLastDialedNumber] = useState<string | null>(null);
    const [callStatus, setCallStatus] = useState<ZoomCallStatus>('idle');
    const callStatusRef = useRef<ZoomCallStatus>('idle');
    const [activeCallNumber, setActiveCallNumber] = useState<string | null>(null);
    const pendingCallRef = useRef<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [customDialerNumber, setCustomDialerNumber] = useState('');
    const [isDialing, setIsDialing] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const dialCallbackRef = useRef<(() => void) | null>(null);
    const [autoHangupEnabled, setAutoHangupEnabledState] = useState(false);
    const [autoHangupSeconds, setAutoHangupSecondsState] = useState(15);
    const autoHangupEnabledRef = useRef(false);
    const autoHangupSecondsRef = useRef(15);
    const autoHangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync ref with state
    useEffect(() => {
        callStatusRef.current = callStatus;
    }, [callStatus]);

    const registerDialCallback = useCallback((cb: (() => void) | null) => {
        dialCallbackRef.current = cb;
    }, []);

    const setIframeReady = useCallback((ready: boolean) => {
        setIframeReadyState(ready);
    }, []);

    const refreshDialer = useCallback(() => {
        console.log('[Zoom Phone] Refreshing dialer...');
        setIframeReadyState(false);
        setRefreshKey(prev => prev + 1);
    }, []);

    const toggleDialer = useCallback(() => {
        setIsDialerOpen(prev => !prev);
    }, []);

    // ── Listen for postMessage events from the Zoom embed ───────────
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Only accept messages from Zoom's origin
            if (event.origin !== 'https://applications.zoom.us') return;


            const { type, data } = event.data || {};
            if (!type || typeof type !== 'string') return;

            // Log all events for debugging
            console.log('[Zoom Event]', type, data);

            // Normalize event type — Zoom may use different naming conventions
            const eventLower = type.toLowerCase();

            // Capture phone number early from dialer events (before call is made)
            if (eventLower.includes('dial') || eventLower.includes('number') || eventLower.includes('input') || eventLower.includes('call')) {
                console.log('[Zoom Phone] Dial/input/call event detected, extracting number...');
                const phone = extractPhoneNumber(data || {});
                if (phone) {
                    console.log('[Zoom Phone] ✅ Phone number from dialer:', phone);
                    setActiveCallNumber(phone);
                } else {
                    console.log('[Zoom Phone] ⚠️ No phone number found in event data:', data);
                }
            }

            // Call state events
            if (eventLower.includes('ringing')) {
                console.log('[Zoom Phone] Call ringing');
                setCallStatus('ringing');
                const phone = extractPhoneNumber(data || {});
                if (phone) {
                    console.log('[Zoom Phone] Phone number from ringing event:', phone);
                    setActiveCallNumber(phone);
                }
                // SUCCESS: Stop retrying immediately
                pendingCallRef.current = null;
            } else if (eventLower.includes('connected') || eventLower.includes('answered')) {
                console.log('[Zoom Phone] Call connected');
                setCallStatus('connected');
                const phone = extractPhoneNumber(data || {});
                if (phone) {
                    console.log('[Zoom Phone] Phone number from connected event:', phone);
                    setActiveCallNumber(phone);
                }
                // SUCCESS: Stop retrying immediately
                pendingCallRef.current = null;
            } else if (eventLower.includes('ended') || eventLower.includes('hangup') || eventLower.includes('disconnect')) {
                console.log('[Zoom Phone] Call ended');
                setCallStatus('ended');
                setIsDialing(false);
                pendingCallRef.current = null;
                // We keep activeCallNumber so the recorder can use it for the upload
                // Reset to idle after a brief delay so consumers can react to 'ended' first
                setTimeout(() => setCallStatus('idle'), 2000);
            }

            // Always try to extract phone number from any Zoom event with data
            // This catches dial pad events, number entry, call log clicks, etc.
            if (data && typeof data === 'object') {
                const phone = extractPhoneNumber(data as Record<string, unknown>);
                if (phone) {
                    if (phone !== activeCallNumber) {
                        console.log('[Zoom Phone] ✅ New phone number detected from event:', phone);
                        setActiveCallNumber(phone);
                    }
                } else if (Object.keys(data).length > 0) {
                    // Only log if data exists but no phone found (skip empty data objects)
                    console.log('[Zoom Phone] ℹ️ Event has data but no phone number found. Event type:', type, 'Data keys:', Object.keys(data));
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [activeCallNumber]);

    const sendDialMessage = useCallback((phoneNumber: string) => {
        // Try ref first, then fallback to DOM ID
        const iframe = iframeRef.current || (typeof document !== 'undefined' ? document.getElementById('zoom-iframe') as HTMLIFrameElement : null);

        if (!iframe?.contentWindow) {
            console.error('[Zoom Phone] Iframe or contentWindow not found');
            return false;
        }

        console.log('[Zoom Phone] Sending dial message for:', phoneNumber);
        iframe.contentWindow.postMessage(
            {
                type: 'zp-make-call',
                data: {
                    number: phoneNumber,
                    autoDial: true
                }
            },
            'https://applications.zoom.us'
        );
        return true;
    }, []);

    const endCall = useCallback(() => {
        const iframe = iframeRef.current || (typeof document !== 'undefined' ? document.getElementById('zoom-iframe') as HTMLIFrameElement : null);

        if (!iframe?.contentWindow) {
            console.error('[Zoom Phone] Cannot end call: Iframe or contentWindow not found');
            return;
        }

        console.log('[Zoom Phone] Sending end call commands...');

        // Try multiple command variations to ensure compatibility with Zoom's API
        const commands = [
            'zp-hang-up',
            'zp-terminate-call',
            'zp-end-call',
            'hangup',
            'end-call',
            'disconnect',
            'zp-hangup'
        ];

        commands.forEach(cmd => {
            iframe.contentWindow?.postMessage(
                {
                    type: cmd,
                    data: {}
                },
                'https://applications.zoom.us'
            );
        });

        // Also try with alternative data structures
        iframe.contentWindow?.postMessage(
            {
                action: 'endCall'
            },
            'https://applications.zoom.us'
        );

        iframe.contentWindow?.postMessage(
            {
                action: 'hangup'
            },
            'https://applications.zoom.us'
        );

        // Force update call status to ended after a brief delay if Zoom doesn't respond
        setTimeout(() => {
            if (callStatusRef.current === 'ringing' || callStatusRef.current === 'connected') {
                console.log('[Zoom Phone] Zoom did not respond to end call, forcing status update');
                setCallStatus('ended');
                setTimeout(() => setCallStatus('idle'), 2000);
            }
        }, 1000);
    }, []);

    const setAutoHangup = useCallback((enabled: boolean, seconds?: number) => {
        autoHangupEnabledRef.current = enabled;
        setAutoHangupEnabledState(enabled);
        if (seconds !== undefined) {
            autoHangupSecondsRef.current = seconds;
            setAutoHangupSecondsState(seconds);
        }
    }, []);

    // Keep endCall ref updated so the auto-hangup timer always calls the latest version
    const endCallRef = useRef(endCall);
    endCallRef.current = endCall;

    // Auto-hangup after N seconds of ringing
    useEffect(() => {
        if (callStatus === 'ringing' && autoHangupEnabledRef.current) {
            if (autoHangupTimerRef.current) clearTimeout(autoHangupTimerRef.current);
            autoHangupTimerRef.current = setTimeout(() => {
                if (callStatusRef.current === 'ringing') {
                    console.log('[Zoom Phone] Auto-hangup after', autoHangupSecondsRef.current, 's ringing');
                    endCallRef.current();
                }
            }, autoHangupSecondsRef.current * 1000);
        } else {
            if (autoHangupTimerRef.current) {
                clearTimeout(autoHangupTimerRef.current);
                autoHangupTimerRef.current = null;
            }
        }
        return () => {
            if (autoHangupTimerRef.current) clearTimeout(autoHangupTimerRef.current);
        };
    }, [callStatus]);

    // Retry sending pending call with increasing delays
    // The Zoom app inside the iframe needs time to initialize its message listeners
    // even after the iframe's onload fires
    useEffect(() => {
        const pending = pendingCallRef.current;
        if (!pending || !iframeReady) return;

        // Try multiple times with increasing delays
        const delays = [500, 1500, 3000, 5000];
        const timers: NodeJS.Timeout[] = [];

        delays.forEach(delay => {
            timers.push(setTimeout(() => {
                // IMPORTANT: Only retry if it's still the SAME pending number
                // AND we are still in idle state (no call has started)
                if (pendingCallRef.current === pending && callStatusRef.current === 'idle') {
                    console.log('[Zoom Phone] Retrying dial for:', pending);
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
    }, [iframeReady, sendDialMessage]);

    const dialNumber = useCallback((phoneNumber: string) => {
        // Clean the phone number
        const hasPlus = phoneNumber.startsWith('+');
        const digits = phoneNumber.replace(/\D/g, '');
        const cleaned = hasPlus ? `+${digits}` : digits;

        if (!cleaned || digits.length < 7) return;

        // Prevent dialing if already in a call
        if (callStatusRef.current !== 'idle') {
            console.warn('[Zoom Phone] Call already in progress, ignoring dial request');
            return;
        }

        // Invoke dial callback synchronously (within user gesture) so
        // CallRecorderControls can auto-start the recording session
        dialCallbackRef.current?.();

        // Open the dialer if it's not already open
        setIsDialerOpen(true);
        // Track dialed number for the call recorder
        setLastDialedNumber(cleaned);
        // Also update the active call number
        setActiveCallNumber(cleaned);
        // Hide custom overlay immediately
        setIsDialing(true);

        // Safety timeout for isDialing in case Zoom never responds
        setTimeout(() => {
            setIsDialing(prev => {
                // Only reset if we haven't transitioned to an active call state
                if (prev && callStatusRef.current === 'idle') {
                    return false;
                }
                return prev;
            });
        }, 10000);

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
        <ZoomPhoneContext.Provider value={{
            isDialerOpen, toggleDialer, dialNumber,
            lastDialedNumber, callStatus, activeCallNumber,
            iframeReady, iframeRef, setIframeReady, endCall,
            customDialerNumber, setCustomDialerNumber,
            isDialing, registerDialCallback, refreshDialer,
            refreshKey,
            autoHangupEnabled, autoHangupSeconds, setAutoHangup,
        }}>
            {children}
        </ZoomPhoneContext.Provider>
    );
}
