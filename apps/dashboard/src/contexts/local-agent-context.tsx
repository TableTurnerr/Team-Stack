'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface AgentCallState {
    state: 'idle' | 'ringing' | 'connected' | 'ended';
    phoneNumber: string | null;
    direction: string | null;
    duration: number;
    confidence: 'low' | 'medium' | 'high';
}

export interface AgentNetworkQuality {
    latencyMs: number;
    jitter: number;
    packetLoss: number;
    isStable: boolean;
}

interface LocalAgentContextType {
    /** Whether the WebSocket connection to the local agent is active */
    isConnected: boolean;
    /** Current call state as reported by the local agent (WASAPI ground truth) */
    callState: AgentCallState | null;
    /** Network quality metrics from the local agent */
    networkQuality: AgentNetworkQuality | null;
    /** Whether Zoom is detected as running on the user's PC */
    zoomDetected: boolean;
    /** Number of seconds the agent has been running */
    agentUptime: number;
    /** Attempt to launch the local agent via protocol handler */
    launchAgent: () => void;
}

// ── Context ─────────────────────────────────────────────────────────

const LocalAgentContext = createContext<LocalAgentContextType | undefined>(undefined);

const AGENT_WS_URL = 'ws://127.0.0.1:9876';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

export function LocalAgentProvider({ children }: { children: ReactNode }) {
    const [isConnected, setIsConnected] = useState(false);
    const [callState, setCallState] = useState<AgentCallState | null>(null);
    const [networkQuality, setNetworkQuality] = useState<AgentNetworkQuality | null>(null);
    const [zoomDetected, setZoomDetected] = useState(false);
    const [agentUptime, setAgentUptime] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const attemptRef = useRef(0);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        function connect() {
            if (!mountedRef.current) return;
            if (wsRef.current?.readyState === WebSocket.OPEN ||
                wsRef.current?.readyState === WebSocket.CONNECTING) return;

            try {
                const ws = new WebSocket(AGENT_WS_URL);

                ws.onopen = () => {
                    if (!mountedRef.current) { ws.close(); return; }
                    console.log('[LocalAgent] Connected to agent');
                    setIsConnected(true);
                    attemptRef.current = 0;
                };

                ws.onmessage = (event) => {
                    if (!mountedRef.current) return;
                    try {
                        const msg = JSON.parse(event.data);
                        switch (msg.type) {
                            case 'callState':
                                setCallState({
                                    state: msg.state ?? 'idle',
                                    phoneNumber: msg.phoneNumber ?? null,
                                    direction: msg.direction ?? null,
                                    duration: msg.duration ?? 0,
                                    confidence: msg.confidence ?? 'low',
                                });
                                break;
                            case 'networkQuality':
                                setNetworkQuality({
                                    latencyMs: msg.latencyMs ?? 0,
                                    jitter: msg.jitter ?? 0,
                                    packetLoss: msg.packetLoss ?? 0,
                                    isStable: msg.isStable ?? true,
                                });
                                break;
                            case 'heartbeat':
                                setZoomDetected(msg.zoomDetected ?? false);
                                setAgentUptime(msg.uptime ?? 0);
                                break;
                        }
                    } catch { /* ignore malformed messages */ }
                };

                ws.onclose = () => {
                    if (!mountedRef.current) return;
                    console.log('[LocalAgent] Disconnected from agent');
                    setIsConnected(false);
                    setCallState(null);
                    wsRef.current = null;
                    scheduleReconnect();
                };

                ws.onerror = () => {
                    // onclose fires after this — no need to handle separately
                };

                wsRef.current = ws;
            } catch {
                scheduleReconnect();
            }
        }

        function scheduleReconnect() {
            if (reconnectTimerRef.current || !mountedRef.current) return;
            const delay = RECONNECT_DELAYS[Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)];
            attemptRef.current++;
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                connect();
            }, delay);
        }

        connect();

        return () => {
            mountedRef.current = false;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onclose = null; // prevent reconnect on unmount
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    const launchAgent = useCallback(() => {
        try {
            // Use an anchor element to trigger the protocol handler
            // without navigating away from the current page
            const a = document.createElement('a');
            a.href = 'crm-agent://launch';
            a.click();
        } catch { /* protocol handler may not be registered */ }
    }, []);

    return (
        <LocalAgentContext.Provider value={{
            isConnected, callState, networkQuality,
            zoomDetected, agentUptime, launchAgent,
        }}>
            {children}
        </LocalAgentContext.Provider>
    );
}

/**
 * Access the local agent context.
 * Returns safe defaults if not wrapped in LocalAgentProvider
 * (graceful degradation — agent is an enhancement, not a requirement).
 */
export function useLocalAgent(): LocalAgentContextType {
    const ctx = useContext(LocalAgentContext);
    return ctx ?? {
        isConnected: false,
        callState: null,
        networkQuality: null,
        zoomDetected: false,
        agentUptime: 0,
        launchAgent: () => {},
    };
}
