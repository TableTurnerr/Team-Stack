'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, PhoneOff, Phone, Loader2 } from 'lucide-react';
import { usePhone } from '@/contexts/phone-context';
import { useLocalAgent } from '@/contexts/local-agent-context';

/**
 * Two related bits of UI surfaced above the active-call panel:
 *
 *   1. AGENT HEALTH — warns when the dashboard can't talk to the Local
 *      CRM Agent (WebSocket dropped, or no heartbeat for >12 s). Without
 *      the agent, every call-state, recording, and dial signal is broken,
 *      so the user needs to know immediately how to fix it.
 *
 *   2. TENTATIVE-END PROMPT — shown when the agent's audio/UI signals
 *      went quiet long enough to look like a hangup but no HARD signal
 *      confirmed it. Could be on-hold, mute, or a long pause. We do NOT
 *      auto-end the call (silence is too unreliable); instead we ask the
 *      user. If they confirm, talk-time/recording duration are clipped to
 *      the silence-start timestamp so hold time isn't billed.
 */
export function AgentCallStatusBanner() {
    const { tentativeEnd, silenceStartedAt, confirmCallEnded, dismissTentativeEnd, callStatus } = usePhone();
    const { isConnected: agentConnected, callState } = useLocalAgent();

    // Heartbeat-staleness detection. agentConnected only tells us if the
    // WebSocket is open; it can stay true while the agent process freezes
    // and stops broadcasting. Track the last message we received and flag
    // the agent as unresponsive if nothing arrives for 12 s (heartbeat is
    // every 5 s, so 12 s = 2 missed beats).
    const [agentStaleSince, setAgentStaleSince] = useState<number | null>(null);
    const lastSeenRef = useRef<number>(Date.now());

    useEffect(() => {
        // Any new callState payload counts as a sign of life from the agent.
        lastSeenRef.current = Date.now();
        setAgentStaleSince(null);
    }, [callState]);

    useEffect(() => {
        if (!agentConnected) {
            setAgentStaleSince(null);
            return;
        }
        // Heartbeat is 1 s on the agent side, so 4 s without ANY message
        // (including callState/recordingState that also tick every second
        // during a call) is 4 missed beats — well past noise. Lower than
        // this and a single GC pause / WebSocket frame backup creates
        // false alarms.
        const interval = setInterval(() => {
            const elapsed = Date.now() - lastSeenRef.current;
            if (elapsed > 4_000) {
                setAgentStaleSince(prev => prev ?? lastSeenRef.current);
            } else {
                setAgentStaleSince(null);
            }
        }, 1_000);
        return () => clearInterval(interval);
    }, [agentConnected]);

    const showAgentWarning = !agentConnected || agentStaleSince != null;
    const showTentativePrompt = tentativeEnd && (callStatus === 'connected' || callStatus === 'ringing');

    if (!showAgentWarning && !showTentativePrompt) return null;

    return (
        <div className="space-y-3">
            {showAgentWarning && <AgentHealthWarning connected={agentConnected} staleSince={agentStaleSince} />}
            {showTentativePrompt && (
                <TentativeEndPrompt
                    silenceStartedAt={silenceStartedAt}
                    onConfirm={confirmCallEnded}
                    onDismiss={dismissTentativeEnd}
                />
            )}
        </div>
    );
}

function AgentHealthWarning({ connected, staleSince }: { connected: boolean; staleSince: number | null }) {
    const reason = !connected
        ? 'The dashboard cannot reach the Local CRM Agent on this machine.'
        : `The Local CRM Agent stopped responding ${Math.round((Date.now() - (staleSince ?? Date.now())) / 1000)}s ago.`;

    return (
        <div className="bg-[var(--warning-subtle)] border border-[var(--warning)]/40 rounded-xl p-4">
            <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[var(--warning)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 text-sm">
                    <p className="font-semibold text-[var(--warning)]">Local Agent connection issue</p>
                    <p className="mt-1 text-[var(--foreground)]/90">{reason}</p>
                    <p className="mt-2 text-[var(--muted)]">
                        Without the agent, call detection, recording, and dialing won&apos;t work reliably. Try:
                    </p>
                    <ul className="mt-1 ml-4 list-disc text-[var(--muted)] space-y-0.5">
                        <li>Check the system tray for the &quot;Local CRM Agent&quot; icon — if it&apos;s missing, relaunch it from Tool Manager.</li>
                        <li>Make sure no other dashboard tab is holding the WebSocket on <code className="text-[var(--foreground)]">ws://127.0.0.1:9876</code>.</li>
                        <li>If your antivirus / VPN blocks localhost sockets, allow it through.</li>
                        <li>Last resort: quit the agent from the tray and restart it, then reload this page.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

function TentativeEndPrompt({
    silenceStartedAt,
    onConfirm,
    onDismiss,
}: {
    silenceStartedAt: string | null;
    onConfirm: () => void;
    onDismiss: () => void;
}) {
    const [confirming, setConfirming] = useState(false);
    const [dismissing, setDismissing] = useState(false);
    const silentSeconds = silenceStartedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(silenceStartedAt).getTime()) / 1000))
        : 0;

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--warning)]/40 rounded-xl p-4">
            <div className="flex items-start gap-3">
                <PhoneOff className="w-5 h-5 text-[var(--warning)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--foreground)]">Has the call ended?</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                        We haven&apos;t heard audio for ~{silentSeconds}s. This could mean the call ended, or you&apos;re on hold / muted.
                        We&apos;ll keep the call live until you confirm — talk time and recording duration won&apos;t count any silence past this point.
                    </p>
                    <div className="mt-3 flex gap-2">
                        <button
                            onClick={() => { setConfirming(true); onConfirm(); }}
                            disabled={confirming}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-medium text-sm border border-[var(--error)]/40 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-60"
                        >
                            {confirming ? <Loader2 size={14} className="animate-spin" /> : <PhoneOff size={14} />}
                            Yes, the call ended
                        </button>
                        <button
                            onClick={() => { setDismissing(true); onDismiss(); setTimeout(() => setDismissing(false), 800); }}
                            disabled={dismissing}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] text-sm transition-all disabled:opacity-60"
                        >
                            {dismissing ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
                            No, still on the call
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
