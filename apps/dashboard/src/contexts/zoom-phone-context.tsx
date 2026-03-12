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
    /** Whether the current/last call was inbound or outbound (null when idle) */
    callDirection: 'outbound' | 'inbound' | null;
    /** Phone number of the incoming caller for inbound calls */
    incomingCallerNumber: string | null;
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

// ── Own-number detection ────────────────────────────────────────────────
// When we make an outbound call, Zoom events include OUR phone number in
// the `caller` field. We learn and persist this number. Any "incoming call"
// whose caller matches our own number is a false positive (Zoom echoing our
// outbound call) and gets suppressed.
const OWN_PHONE_STORAGE_KEY = 'crm:zoom-own-phone-number';

/** Normalize to last 10 digits for comparison (strips country code, +, formatting) */
function normalizeDigits(phone: string): string {
    return phone.replace(/\D/g, '').slice(-10);
}

function isOwnNumber(phone: string | null, ownNumber: string | null): boolean {
    if (!ownNumber || !phone) return false;
    const a = normalizeDigits(phone);
    const b = normalizeDigits(ownNumber);
    return a.length >= 7 && a === b;
}

/**
 * Extract the CALLER's phone number (the person who initiated the call).
 * For outbound calls this is US; for inbound this is the remote party.
 */
function extractCallerNumber(data: Record<string, unknown>): string | null {
    const caller = data?.caller as Record<string, unknown> | undefined;
    const from = data?.from;

    const candidates = [
        caller?.phoneNumber,
        caller?.number,
        caller?.extensionNumber,
        typeof from === 'string' ? from : (from as Record<string, unknown>)?.phoneNumber,
        data?.phoneNumber,
        data?.number,
    ];

    for (const c of candidates) {
        if (typeof c === 'string' && c.replace(/\D/g, '').length >= 7) {
            return c.trim();
        }
    }
    return null;
}

/**
 * Extract a phone number from Zoom embed event data.
 * Prefers outbound-target fields (callee/to) over caller/from.
 */
function extractPhoneNumber(data: Record<string, unknown>): string | null {
    const caller = data?.caller as Record<string, unknown> | undefined;
    const callee = data?.callee as Record<string, unknown> | undefined;

    const candidates = [
        data?.targetNumber,
        data?.dialNumber,
        data?.inputNumber,
        data?.value,
        callee?.phoneNumber,
        callee?.number,
        callee?.extensionNumber,
        typeof data?.to === 'string' ? data.to : (data?.to as Record<string, unknown>)?.phoneNumber,
        data?.phoneNumber,
        data?.number,
        (data?.contact as Record<string, unknown>)?.phoneNumber,
        (data?.call as Record<string, unknown>)?.phoneNumber,
        (data?.call as Record<string, unknown>)?.number,
        (data?.participant as Record<string, unknown>)?.phoneNumber,
        caller?.phoneNumber,
        caller?.number,
        caller?.extensionNumber,
        typeof data?.from === 'string' ? data.from : (data?.from as Record<string, unknown>)?.phoneNumber,
    ];

    for (const c of candidates) {
        if (typeof c === 'string' && c.replace(/\D/g, '').length >= 7) {
            return c.trim();
        }
    }
    return null;
}

export function ZoomPhoneProvider({ children }: { children: ReactNode }) {
    // Virtual dialer: when __TEST_VIRTUAL_DIALER is set on window, skip Zoom iframe
    // and dispatch synthetic call events. All state-machine logic still runs unchanged.
    const isVirtualDialer = typeof window !== 'undefined' && !!(window as any).__TEST_VIRTUAL_DIALER;

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

    // Call direction tracking
    const [callDirection, setCallDirection] = useState<'outbound' | 'inbound' | null>(null);
    const [incomingCallerNumber, setIncomingCallerNumber] = useState<string | null>(null);

    // Outbound intent — set in dialNumber(), persists until call ends.
    const outboundIntentRef = useRef(false);
    const outboundIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Own phone number — auto-learned from outbound calls, persisted in localStorage.
    // Any "incoming call" from this number is suppressed as a false positive.
    const ownPhoneNumberRef = useRef<string | null>(null);

    // Load own number from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(OWN_PHONE_STORAGE_KEY);
            if (saved) {
                ownPhoneNumberRef.current = saved;
                console.log('[Zoom Phone] Loaded own phone number from storage:', saved);
            }
        } catch { /* ignore */ }
    }, []);

    // Virtual dialer: no iframe needed — mark ready immediately
    useEffect(() => {
        if (isVirtualDialer) {
            console.log('[Virtual Dialer] Test mode active — iframe auto-ready');
            setIframeReadyState(true);
        }
    }, [isVirtualDialer]);

    const registerDialCallback = useCallback((cb: (() => void) | null) => {
        dialCallbackRef.current = cb;
    }, []);

    const setIframeReady = useCallback((ready: boolean) => {
        setIframeReadyState(ready);
    }, []);

    const refreshDialer = useCallback(() => {
        console.log('[Zoom Phone] Refreshing dialer — resetting all call state...');
        // Reset call state so stale ringing/connected status doesn't persist
        callStatusRef.current = 'idle';
        setCallStatus('idle');
        setIsDialing(false);
        setCallDirection(null);
        setIncomingCallerNumber(null);
        pendingCallRef.current = null;
        outboundIntentRef.current = false;
        if (outboundIntentTimerRef.current) { clearTimeout(outboundIntentTimerRef.current); outboundIntentTimerRef.current = null; }
        // Reload the iframe
        setIframeReadyState(false);
        setRefreshKey(prev => prev + 1);
    }, []);

    const toggleDialer = useCallback(() => {
        setIsDialerOpen(prev => !prev);
    }, []);

    // ── Listen for postMessage events from the Zoom embed ───────────
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Only accept messages from Zoom's origin (bypassed in virtual dialer test mode)
            if (!isVirtualDialer && event.origin !== 'https://applications.zoom.us') return;

            // Only process events from our primary iframe (prevents duplicate
            // events from the hidden layout iframe vs the docked session iframe).
            // In virtual dialer mode, events come from window.postMessage (same window),
            // so skip this check — the iframe is still mounted but its content is blocked.
            const primaryWindow = iframeRef.current?.contentWindow;
            if (!isVirtualDialer && primaryWindow && event.source !== primaryWindow) return;

            const { type, data } = event.data || {};
            if (!type || typeof type !== 'string') return;

            console.log('[Zoom Event]', type, JSON.stringify(data));

            const eventLower = type.toLowerCase();

            // Capture phone number early from dialer events
            if (eventLower.includes('dial') || eventLower.includes('number') || eventLower.includes('input') || eventLower.includes('call')) {
                const phone = extractPhoneNumber(data || {});
                if (phone) setActiveCallNumber(phone);
            }

            // ── RINGING ──
            if (eventLower.includes('ringing')) {
                // Only process FIRST ringing event per call (ref updated synchronously).
                if (callStatusRef.current !== 'ringing') {
                    callStatusRef.current = 'ringing';
                    setCallStatus('ringing');

                    // --- Direction detection (in priority order) ---
                    let direction: 'inbound' | 'outbound' = 'outbound'; // safe default

                    if (outboundIntentRef.current) {
                        // 1. We initiated this call via dialNumber() → definitely outbound
                        direction = 'outbound';
                    } else {
                        // 2. Not our dial — tentatively treat as inbound, but check own-number filter
                        direction = 'inbound';
                    }

                    // 3. OWN-NUMBER FILTER: If the "incoming" caller is our own Zoom number,
                    //    this is a false positive — Zoom is echoing our outbound call.
                    if (direction === 'inbound') {
                        const callerNum = extractCallerNumber(data || {});
                        if (callerNum && isOwnNumber(callerNum, ownPhoneNumberRef.current)) {
                            console.log('[Zoom Phone] Suppressed false incoming call from own number:', callerNum);
                            direction = 'outbound';
                        }
                    }

                    // 4. LEARN OWN NUMBER: During outbound calls, the `caller` field is US.
                    //    Capture it so we can filter future false incoming calls.
                    if (direction === 'outbound') {
                        const callerNum = extractCallerNumber(data || {});
                        if (callerNum && !isOwnNumber(callerNum, activeCallNumber)) {
                            // callerNum is NOT the number we dialed → it's our own number
                            if (!isOwnNumber(callerNum, ownPhoneNumberRef.current)) {
                                ownPhoneNumberRef.current = callerNum;
                                console.log('[Zoom Phone] Learned own phone number:', callerNum);
                                try { localStorage.setItem(OWN_PHONE_STORAGE_KEY, callerNum); } catch { /* */ }
                            }
                        }
                    }

                    console.log('[Zoom Phone] Call ringing — direction:', direction, '| outboundIntent:', outboundIntentRef.current, '| ownNumber:', ownPhoneNumberRef.current);
                    setCallDirection(direction);

                    if (direction === 'inbound') {
                        const callerNum = extractCallerNumber(data || {});
                        if (callerNum) {
                            console.log('[Zoom Phone] 📞 Incoming call from:', callerNum);
                            setIncomingCallerNumber(callerNum);
                            setActiveCallNumber(callerNum);
                        }
                    } else {
                        const phone = extractPhoneNumber(data || {});
                        if (phone) setActiveCallNumber(phone);
                        pendingCallRef.current = null;
                    }
                }

            // ── CONNECTED ──
            } else if (eventLower.includes('connected') || eventLower.includes('answered')) {
                console.log('[Zoom Phone] Call connected');
                if (callStatusRef.current !== 'connected' && callStatusRef.current !== 'ringing') {
                    // Direction not set yet (skipped ringing) — detect now
                    if (outboundIntentRef.current) {
                        setCallDirection('outbound');
                    } else {
                        const callerNum = extractCallerNumber(data || {});
                        if (callerNum && isOwnNumber(callerNum, ownPhoneNumberRef.current)) {
                            setCallDirection('outbound');
                        } else {
                            setCallDirection('inbound');
                        }
                    }
                }
                callStatusRef.current = 'connected';
                setCallStatus('connected');
                const phone = extractPhoneNumber(data || {});
                if (phone) setActiveCallNumber(phone);
                pendingCallRef.current = null;

            // ── ENDED ──
            } else if (eventLower.includes('ended') || eventLower.includes('hangup') || eventLower.includes('disconnect')) {
                console.log('[Zoom Phone] Call ended');
                callStatusRef.current = 'ended';
                setCallStatus('ended');
                setIsDialing(false);
                pendingCallRef.current = null;
                outboundIntentRef.current = false;
                if (outboundIntentTimerRef.current) { clearTimeout(outboundIntentTimerRef.current); outboundIntentTimerRef.current = null; }
                setTimeout(() => {
                    callStatusRef.current = 'idle';
                    setCallStatus('idle');
                    setCallDirection(null);
                    setIncomingCallerNumber(null);
                }, 2000);

            // ── FAILED / REJECTED ──
            // Zoom may send events like "callFailed", "callRejected", etc.
            // when the VoIP call fails to go through. Without this handler,
            // the call stays stuck in 'ringing' and the recording runs forever.
            } else if (eventLower.includes('fail') || eventLower.includes('reject')) {
                console.log('[Zoom Phone] Call failed/rejected:', type);
                callStatusRef.current = 'ended';
                setCallStatus('ended');
                setIsDialing(false);
                pendingCallRef.current = null;
                outboundIntentRef.current = false;
                if (outboundIntentTimerRef.current) { clearTimeout(outboundIntentTimerRef.current); outboundIntentTimerRef.current = null; }
                setTimeout(() => {
                    callStatusRef.current = 'idle';
                    setCallStatus('idle');
                    setCallDirection(null);
                    setIncomingCallerNumber(null);
                }, 2000);
            }

            // Catch-all: extract phone number from any event with data
            if (data && typeof data === 'object') {
                const phone = extractPhoneNumber(data as Record<string, unknown>);
                if (phone && phone !== activeCallNumber) {
                    setActiveCallNumber(phone);
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [activeCallNumber]);

    const sendDialMessage = useCallback((phoneNumber: string) => {
        // Virtual dialer: dispatch synthetic call events instead of real Zoom postMessage
        if (isVirtualDialer) {
            const cfg = (window as any).__TEST_DIALER_CONFIG || {};
            console.log('[Virtual Dialer] Dial:', phoneNumber);
            setTimeout(() => {
                window.postMessage({ type: 'ringing', data: { targetNumber: phoneNumber, callee: { phoneNumber } } }, '*');
            }, cfg.ringDelay ?? 50);
            if (cfg.shouldConnect !== false && !cfg.shouldFail) {
                setTimeout(() => {
                    window.postMessage({ type: 'connected', data: { targetNumber: phoneNumber } }, '*');
                }, cfg.connectDelay ?? 150);
            }
            if (cfg.shouldFail) {
                setTimeout(() => {
                    window.postMessage({ type: 'ended', data: {} }, '*');
                }, cfg.failDelay ?? 200);
            }
            if (cfg.autoEndDelay && cfg.shouldConnect !== false && !cfg.shouldFail) {
                setTimeout(() => {
                    window.postMessage({ type: 'ended', data: {} }, '*');
                }, (cfg.connectDelay ?? 150) + cfg.autoEndDelay);
            }
            return true;
        }

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
    }, [isVirtualDialer]);

    const endCall = useCallback(() => {
        // Virtual dialer: dispatch ended event directly
        if (isVirtualDialer) {
            window.postMessage({ type: 'ended', data: {} }, '*');
            return;
        }

        const iframe = iframeRef.current || (typeof document !== 'undefined' ? document.getElementById('zoom-iframe') as HTMLIFrameElement : null);

        if (!iframe?.contentWindow) {
            console.error('[Zoom Phone] Cannot end call: Iframe or contentWindow not found');
            return;
        }

        console.log('[Zoom Phone] Sending end call commands...');

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
                { type: cmd, data: {} },
                'https://applications.zoom.us'
            );
        });

        iframe.contentWindow?.postMessage({ action: 'endCall' }, 'https://applications.zoom.us');
        iframe.contentWindow?.postMessage({ action: 'hangup' }, 'https://applications.zoom.us');

        // Force status update if Zoom doesn't respond
        setTimeout(() => {
            if (callStatusRef.current === 'ringing' || callStatusRef.current === 'connected') {
                console.log('[Zoom Phone] Zoom did not respond to end call, forcing status update');
                callStatusRef.current = 'ended';
                setCallStatus('ended');
                setTimeout(() => { callStatusRef.current = 'idle'; setCallStatus('idle'); }, 2000);
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
    useEffect(() => {
        const pending = pendingCallRef.current;
        if (!pending || !iframeReady) return;

        const delays = [500, 1500, 3000, 5000];
        const timers: NodeJS.Timeout[] = [];

        delays.forEach(delay => {
            timers.push(setTimeout(() => {
                if (pendingCallRef.current === pending && callStatusRef.current === 'idle') {
                    console.log('[Zoom Phone] Retrying dial for:', pending);
                    sendDialMessage(pending);
                }
            }, delay));
        });

        timers.push(setTimeout(() => {
            if (pendingCallRef.current === pending) {
                pendingCallRef.current = null;
            }
        }, delays[delays.length - 1] + 500));

        return () => timers.forEach(t => clearTimeout(t));
    }, [iframeReady, sendDialMessage]);

    const dialNumber = useCallback((phoneNumber: string) => {
        const hasPlus = phoneNumber.startsWith('+');
        const digits = phoneNumber.replace(/\D/g, '');
        const cleaned = hasPlus ? `+${digits}` : digits;

        if (!cleaned || digits.length < 7) return;

        // Prevent dialing if already in a call
        if (callStatusRef.current !== 'idle') {
            console.warn('[Zoom Phone] Call already in progress, ignoring dial request');
            return;
        }

        // Invoke dial callback synchronously (within user gesture)
        dialCallbackRef.current?.();

        // Mark outbound intent — persists for the ENTIRE call lifecycle.
        // Cleared only when the call ends (in the 'ended' handler).
        outboundIntentRef.current = true;
        if (outboundIntentTimerRef.current) clearTimeout(outboundIntentTimerRef.current);
        outboundIntentTimerRef.current = setTimeout(() => { outboundIntentRef.current = false; }, 60000);

        setIsDialerOpen(true);
        setLastDialedNumber(cleaned);
        setActiveCallNumber(cleaned);
        setCustomDialerNumber(cleaned);
        setIsDialing(true);

        // Safety timeout for isDialing in case Zoom never responds
        setTimeout(() => {
            setIsDialing(prev => {
                if (prev && callStatusRef.current === 'idle') return false;
                return prev;
            });
        }, 10000);

        if (iframeReady && (isVirtualDialer || iframeRef.current?.contentWindow)) {
            sendDialMessage(cleaned);
            pendingCallRef.current = cleaned;
        } else {
            pendingCallRef.current = cleaned;
        }
    }, [iframeReady, sendDialMessage, isVirtualDialer]);

    return (
        <ZoomPhoneContext.Provider value={{
            isDialerOpen, toggleDialer, dialNumber,
            lastDialedNumber, callStatus, activeCallNumber,
            iframeReady, iframeRef, setIframeReady, endCall,
            customDialerNumber, setCustomDialerNumber,
            isDialing, registerDialCallback, refreshDialer,
            refreshKey,
            autoHangupEnabled, autoHangupSeconds, setAutoHangup,
            callDirection, incomingCallerNumber,
        }}>
            {children}
        </ZoomPhoneContext.Provider>
    );
}
