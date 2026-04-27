'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useLocalAgent } from './local-agent-context';
import { useAuth } from './auth-context';

/**
 * Call Ownership.
 *
 * On a shared Zoom account every teammate's dashboard receives iframe and
 * webhook signals for calls happening on OTHER teammates' machines. Without
 * a per-device ownership gate, each teammate's CRM would try to log every
 * call, double-counting and mis-attributing them.
 *
 * Rule: each dashboard connects to its OWN local agent at
 * ws://127.0.0.1:9876, so every `callState` it receives is already
 * per-device. Ownership is derived from:
 *
 *   - `state === 'ringing'`  (this device's SipCallNormalIncomingCallWindow
 *     is visible — iAmRinging)
 *   - `audioActiveHere`       (WASAPI sees Zoom audio flowing on this
 *     device — iOwnCurrentCall; clean per-device signal)
 *   - `uiSeenHere`            (retained for when UIA is re-enabled; ignore
 *     when false because the watcher may be disabled)
 *
 * Use `iOwnCurrentCall` to gate:
 *   - showing the Zoom Smart Embed iframe
 *   - flipping `cold_calling_sessions.on_call`
 *   - opening the call-log form
 *   - counting the dial in session metrics
 */

interface CallOwnershipContextType {
    /** True when THIS device is the one actually on the call. */
    iOwnCurrentCall: boolean;
    /** Ring toast is visible on THIS device (inbound not-yet-answered). */
    iAmRinging: boolean;
    /**
     * The shared Zoom account presence shows "On a call" but this device
     * has no local active/ring UI — a teammate on another device is on a
     * call. Use to gate dial collisions and to surface "line busy" hints.
     */
    teammateBusy: boolean;
    /** Raw stable identifier for this device (persisted by the agent). */
    deviceId: string | null;
    /** Latest dial-intent id associated with this ownership (if outbound). */
    intentId: string | null;
    /** Latest Zoom call_id (once the webhook has correlated the call). */
    zoomCallId: string | null;
    /** Generate a new intentId and push it to the agent for correlation. */
    emitDialIntent: (phoneNumber: string, sessionId?: string | null) => string;
}

const CallOwnershipContext = createContext<CallOwnershipContextType | null>(null);

export function useCallOwnership() {
    const ctx = useContext(CallOwnershipContext);
    if (!ctx) throw new Error('useCallOwnership must be used within CallOwnershipProvider');
    return ctx;
}

/** Optional form — null when the provider isn't mounted (e.g. public routes). */
export function useCallOwnershipOptional() {
    return useContext(CallOwnershipContext);
}

export function CallOwnershipProvider({ children }: { children: ReactNode }) {
    const { callState, sendCommand } = useLocalAgent();
    const { user } = useAuth();

    // A call is "present" on this device only if THIS machine's local
    // agent reports it. We never trust iframe/webhook state for
    // ownership. Any callState flowing through useLocalAgent() came from
    // the dashboard's own localhost agent, so it's inherently per-device.
    const iOwnCurrentCall = useMemo(() => {
        if (!callState) return false;
        if (callState.state === 'idle' || callState.state === 'ended') return false;
        // connected | ringing both qualify: connected means WASAPI sees
        // flowing Zoom audio here, ringing means the ring window is up
        // here. Both are local agent-derived facts.
        return callState.state === 'connected' || callState.state === 'ringing';
    }, [callState]);

    const iAmRinging = useMemo(() => {
        if (!callState) return false;
        // state=ringing is set by the local agent only when the
        // SipCallNormalIncomingCallWindow is visible on THIS device.
        return callState.state === 'ringing';
    }, [callState]);

    // Teammate-busy is strictly a negative confirmation: account presence
    // says "On a call" AND this device has no local UI/audio signal. We
    // also require iOwnCurrentCall to be false — if we already own the
    // call, surfacing "teammate busy" would be misleading.
    const teammateBusy = useMemo(() => {
        if (!callState) return false;
        if (iOwnCurrentCall || iAmRinging) return false;
        return Boolean(callState.teammateOnCall);
    }, [callState, iOwnCurrentCall, iAmRinging]);

    const emitDialIntent = useCallback((phoneNumber: string, sessionId?: string | null) => {
        const intentId =
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `intent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        try {
            sendCommand({
                type: 'dialIntent',
                intentId,
                phoneNumber,
                userId: user?.id ?? '',
                sessionId: sessionId ?? undefined,
            });
        } catch (e) {
            console.warn('[CallOwnership] dialIntent send failed:', e);
        }
        return intentId;
    }, [sendCommand, user?.id]);

    const value = useMemo<CallOwnershipContextType>(() => ({
        iOwnCurrentCall,
        iAmRinging,
        teammateBusy,
        deviceId: callState?.deviceId ?? null,
        intentId: callState?.intentId ?? null,
        zoomCallId: callState?.zoomCallId ?? null,
        emitDialIntent,
    }), [iOwnCurrentCall, iAmRinging, teammateBusy, callState?.deviceId, callState?.intentId, callState?.zoomCallId, emitDialIntent]);

    return (
        <CallOwnershipContext.Provider value={value}>
            {children}
        </CallOwnershipContext.Provider>
    );
}
