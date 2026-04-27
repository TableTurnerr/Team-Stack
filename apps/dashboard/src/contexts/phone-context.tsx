'use client';

import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useLocalAgent } from './local-agent-context';
import { useCallOwnershipOptional } from './call-ownership-context';

// ── Call Status ────────────────────────────────────────────────────
export type CallStatus = 'idle' | 'ringing' | 'connected' | 'ended';

interface PhoneContextType {
    /** Whether the dialer panel is currently visible */
    isDialerOpen: boolean;
    /** Toggle the dialer panel open/closed */
    toggleDialer: () => void;
    /** Dial a phone number via the local agent */
    dialNumber: (phoneNumber: string) => void;
    /** The last phone number that was dialed via CRM buttons */
    lastDialedNumber: string | null;
    /** Current call status as reported by the local agent */
    callStatus: CallStatus;
    /** Phone number of the active/last call */
    activeCallNumber: string | null;
    /** End the current call via Smart Embed */
    endCall: () => void;
    /** Current number being typed in the custom dialer (for syncing with recorder) */
    customDialerNumber: string;
    /** Update the number being typed in the custom dialer */
    setCustomDialerNumber: (num: string) => void;
    /** Whether a dial is in progress */
    isDialing: boolean;
    /** Register a callback to be invoked synchronously when dialNumber is called (for auto-starting recording session within user gesture) */
    registerDialCallback: (cb: (() => void) | null) => void;
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
    /** Whether the local agent is required but not connected */
    agentRequired: boolean;
    /** Duration of the current call in seconds (from agent) */
    callDuration: number;
}

const PhoneContext = createContext<PhoneContextType | null>(null);

export function usePhone() {
    const context = useContext(PhoneContext);
    if (!context) {
        throw new Error('usePhone must be used within PhoneProvider');
    }
    return context;
}

/**
 * Try to use the phone context, returns null if not wrapped in provider.
 * Used by CallButton to optionally integrate with the dialer.
 */
export function usePhoneOptional() {
    return useContext(PhoneContext);
}


/**
 * PhoneProvider — hybrid architecture:
 *
 * CALL DETECTION (ringing, connected, ended):
 *   Primary: Local Agent WASAPI (only detects THIS machine — solves shared account)
 *   Supplementary: Smart Embed events (accepted only when WASAPI confirms this machine)
 *
 * CALL CONTROL (end call, DTMF):
 *   Smart Embed iframe postMessage (hidden iframe, only used as a control channel)
 *
 * DIALING:
 *   Local zoomphonecall: protocol via agent (only launches on THIS machine)
 *
 * RECORDING:
 *   Our own WASAPI recorder (NOT Zoom's recording feature)
 *
 * This design lets multiple teammates share the same Zoom account safely:
 * each CRM only sees calls happening on its own machine.
 */
export function PhoneProvider({ children }: { children: ReactNode }) {
    const { isConnected: agentConnected, callState: agentCallState, sendCommand } = useLocalAgent();
    const ownership = useCallOwnershipOptional();

    // ── State ────────────────────────────────────────────────────────
    const [isDialerOpen, setIsDialerOpen] = useState(false);
    const [lastDialedNumber, setLastDialedNumber] = useState<string | null>(null);
    const [callStatus, setCallStatus] = useState<CallStatus>('idle');
    const callStatusRef = useRef<CallStatus>('idle');
    const [activeCallNumber, setActiveCallNumber] = useState<string | null>(null);
    const [customDialerNumber, setCustomDialerNumber] = useState('');
    const [isDialing, setIsDialing] = useState(false);
    const dialCallbackRef = useRef<(() => void) | null>(null);
    const [autoHangupEnabled, setAutoHangupEnabledState] = useState(false);
    const [autoHangupSeconds, setAutoHangupSecondsState] = useState(15);
    const autoHangupEnabledRef = useRef(false);
    const autoHangupSecondsRef = useRef(15);
    const autoHangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const endedIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Call direction tracking
    const [callDirection, setCallDirection] = useState<'outbound' | 'inbound' | null>(null);
    const [incomingCallerNumber, setIncomingCallerNumber] = useState<string | null>(null);

    // Track whether we initiated an outbound dial
    const outboundIntentRef = useRef(false);

    // ── Agent call state → CRM state mapping ─────────────────────────
    // The local agent broadcasts callState via WebSocket every 1s during calls.
    // This is the ONLY source of truth for call status.
    useEffect(() => {
        if (!agentCallState) return;

        const agentState = agentCallState.state as CallStatus;
        const prevStatus = callStatusRef.current;

        // Map agent state to CRM call state
        if (agentState === 'ringing' && prevStatus !== 'ringing') {
            if (endedIdleTimerRef.current) { clearTimeout(endedIdleTimerRef.current); endedIdleTimerRef.current = null; }
            callStatusRef.current = 'ringing';
            setCallStatus('ringing');
            setIsDialing(false);

            const direction = outboundIntentRef.current ? 'outbound' :
                (agentCallState.direction === 'inbound' ? 'inbound' : 'outbound');
            setCallDirection(direction);

            if (agentCallState.phoneNumber) {
                setActiveCallNumber(agentCallState.phoneNumber);
                if (direction === 'inbound') {
                    setIncomingCallerNumber(agentCallState.phoneNumber);
                }
            }

        } else if ((agentState === 'connected') && prevStatus !== 'connected') {
            if (endedIdleTimerRef.current) { clearTimeout(endedIdleTimerRef.current); endedIdleTimerRef.current = null; }
            callStatusRef.current = 'connected';
            setCallStatus('connected');
            setIsDialing(false);

            if (!callDirection) {
                const direction = outboundIntentRef.current ? 'outbound' :
                    (agentCallState.direction === 'inbound' ? 'inbound' : 'outbound');
                setCallDirection(direction);
            }

            if (agentCallState.phoneNumber) {
                setActiveCallNumber(agentCallState.phoneNumber);
            }

        } else if ((agentState === 'ended' || agentState === 'idle') &&
                   (prevStatus === 'ringing' || prevStatus === 'connected')) {
            callStatusRef.current = 'ended';
            setCallStatus('ended');
            setIsDialing(false);
            outboundIntentRef.current = false;

            if (endedIdleTimerRef.current) clearTimeout(endedIdleTimerRef.current);
            endedIdleTimerRef.current = setTimeout(() => {
                endedIdleTimerRef.current = null;
                callStatusRef.current = 'idle';
                setCallStatus('idle');
                setCallDirection(null);
                setIncomingCallerNumber(null);
            }, 500);
        }

        // Always update phone number from agent if available
        if (agentCallState.phoneNumber && agentCallState.state !== 'idle') {
            setActiveCallNumber(agentCallState.phoneNumber);
        }
    }, [agentCallState, callDirection]);

    // ── Agent disconnect fallback ────────────────────────────────────
    const prevAgentConnectedRef = useRef(agentConnected);
    useEffect(() => {
        const wasConnected = prevAgentConnectedRef.current;
        prevAgentConnectedRef.current = agentConnected;

        if (wasConnected && !agentConnected &&
            (callStatusRef.current === 'ringing' || callStatusRef.current === 'connected')) {
            console.log('[Phone] Agent disconnected while in call — ending call in CRM');
            callStatusRef.current = 'ended';
            setCallStatus('ended');
            setIsDialing(false);
            outboundIntentRef.current = false;
            if (endedIdleTimerRef.current) clearTimeout(endedIdleTimerRef.current);
            endedIdleTimerRef.current = setTimeout(() => {
                endedIdleTimerRef.current = null;
                callStatusRef.current = 'idle';
                setCallStatus('idle');
                setCallDirection(null);
                setIncomingCallerNumber(null);
            }, 500);
        }
    }, [agentConnected]);

    const registerDialCallback = useCallback((cb: (() => void) | null) => {
        dialCallbackRef.current = cb;
    }, []);

    const toggleDialer = useCallback(() => {
        if (!agentConnected) return;
        setIsDialerOpen(prev => !prev);
    }, [agentConnected]);

    // ── End Call ───────────────────────────────────────────────────────
    // The Zoom Smart Embed iframe is rendered in the PhoneDialer component.
    // During a call it's visible (user can click End directly in it).
    // This function is a fallback / programmatic trigger.
    const endCall = useCallback(() => {
        console.log('[Phone] endCall triggered');
        // Notify agent for logging/recording cleanup
        sendCommand({ type: 'endCall' });
    }, [sendCommand]);

    // Call duration from agent
    const callDuration = agentCallState?.duration ?? 0;

    // Keep endCall ref updated so the auto-hangup timer always calls the latest version
    const endCallRef = useRef(endCall);
    endCallRef.current = endCall;

    const setAutoHangup = useCallback((enabled: boolean, seconds?: number) => {
        autoHangupEnabledRef.current = enabled;
        setAutoHangupEnabledState(enabled);
        if (seconds !== undefined) {
            autoHangupSecondsRef.current = seconds;
            setAutoHangupSecondsState(seconds);
        }
    }, []);

    // Auto-hangup after N seconds of ringing
    useEffect(() => {
        if (callStatus === 'ringing' && autoHangupEnabledRef.current) {
            if (autoHangupTimerRef.current) clearTimeout(autoHangupTimerRef.current);
            autoHangupTimerRef.current = setTimeout(() => {
                if (callStatusRef.current === 'ringing') {
                    console.log('[Phone] Auto-hangup after', autoHangupSecondsRef.current, 's ringing');
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

    const dialNumber = useCallback((phoneNumber: string) => {
        if (!agentConnected) return;

        const hasPlus = phoneNumber.startsWith('+');
        const digits = phoneNumber.replace(/\D/g, '');
        const cleaned = hasPlus ? `+${digits}` : digits;

        if (!cleaned || digits.length < 7) return;

        if (callStatusRef.current === 'ended') {
            if (endedIdleTimerRef.current) {
                clearTimeout(endedIdleTimerRef.current);
                endedIdleTimerRef.current = null;
            }
            callStatusRef.current = 'idle';
            setCallStatus('idle');
            setCallDirection(null);
            setIncomingCallerNumber(null);
        } else if (callStatusRef.current !== 'idle') {
            console.warn('[Phone] Call already in progress, ignoring dial request');
            return;
        }

        dialCallbackRef.current?.();
        outboundIntentRef.current = true;

        // Emit a dial intent FIRST, so when the Zoom UI active-call panel
        // lights up the agent can correlate the call to THIS user/device.
        // Without this correlation, every teammate's dashboard would race
        // to claim the call via the shared-account iframe update.
        try { ownership?.emitDialIntent(cleaned); } catch { /* non-fatal */ }

        setIsDialerOpen(true);
        setLastDialedNumber(cleaned);
        setActiveCallNumber(cleaned);
        setCustomDialerNumber(cleaned);
        setIsDialing(true);

        // Safety timeout for isDialing in case agent never responds
        setTimeout(() => {
            setIsDialing(prev => {
                if (prev && callStatusRef.current === 'idle') return false;
                return prev;
            });
        }, 10000);

        // Send dial command to agent (uses local zoomphonecall: protocol)
        sendCommand({ type: 'dial', phoneNumber: cleaned });
    }, [agentConnected, sendCommand]);

    return (
        <PhoneContext.Provider value={{
            isDialerOpen, toggleDialer, dialNumber,
            lastDialedNumber, callStatus, activeCallNumber,
            endCall,
            customDialerNumber, setCustomDialerNumber,
            isDialing, registerDialCallback,
            autoHangupEnabled, autoHangupSeconds, setAutoHangup,
            callDirection, incomingCallerNumber,
            agentRequired: !agentConnected,
            callDuration,
        }}>
            {children}
        </PhoneContext.Provider>
    );
}


