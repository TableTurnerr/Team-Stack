'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';

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

export interface AgentRecordingState {
    state: 'idle' | 'recording' | 'stopping' | 'error';
    fileName: string | null;
    phoneNumber: string | null;
    duration: number;
    error: string | null;
}

export interface AgentRecordingCompleted {
    fileName: string;
    phoneNumber: string;
    duration: number;
    fileSizeBytes: number;
    startTime: string;
}

export interface AgentUploadQueueStatus {
    pendingCount: number;
    failedCount: number;
    currentUpload: string | null;
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
    /** Ask the agent to launch Zoom (find and start the process) */
    launchZoom: () => void;
    /** Whether a Zoom launch request is in progress */
    zoomLaunching: boolean;
    /** Current recording state from the agent */
    recordingState: AgentRecordingState | null;
    /** Latest completed recording metadata */
    latestRecording: AgentRecordingCompleted | null;
    /** Upload queue status */
    uploadQueueStatus: AgentUploadQueueStatus | null;
    /** Send a command to the agent via WebSocket */
    sendCommand: (command: Record<string, unknown>) => void;
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
    const [zoomLaunching, setZoomLaunching] = useState(false);
    const [recordingState, setRecordingState] = useState<AgentRecordingState | null>(null);
    const [latestRecording, setLatestRecording] = useState<AgentRecordingCompleted | null>(null);
    const [uploadQueueStatus, setUploadQueueStatus] = useState<AgentUploadQueueStatus | null>(null);

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

                    // Relay PocketBase auth to agent for background uploads
                    try {
                        if (pb.authStore.isValid && pb.authStore.token) {
                            ws.send(JSON.stringify({
                                type: 'setUploadConfig',
                                pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL || '',
                                authToken: pb.authStore.token,
                                uploaderId: pb.authStore.model?.id || '',
                            }));
                            console.log('[LocalAgent] Sent upload config to agent');
                        }
                    } catch { /* ignore auth relay errors */ }

                    // Enable agent-side auto-record so the agent records
                    // independently of CRM commands (safety net)
                    try {
                        ws.send(JSON.stringify({ type: 'setAutoRecord', enabled: true, onRinging: false }));
                        ws.send(JSON.stringify({ type: 'getRecordingStatus' }));
                    } catch { /* ignore */ }
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
                            case 'zoomAction':
                                setZoomLaunching(false);
                                if (msg.zoomRunning) setZoomDetected(true);
                                break;
                            case 'recordingState':
                                setRecordingState({
                                    state: msg.state ?? 'idle',
                                    fileName: msg.fileName ?? null,
                                    phoneNumber: msg.phoneNumber ?? null,
                                    duration: msg.duration ?? 0,
                                    error: msg.error ?? null,
                                });
                                break;
                            case 'recordingCompleted':
                                setLatestRecording({
                                    fileName: msg.fileName ?? '',
                                    phoneNumber: msg.phoneNumber ?? '',
                                    duration: msg.duration ?? 0,
                                    fileSizeBytes: msg.fileSizeBytes ?? 0,
                                    startTime: msg.startTime ?? '',
                                });
                                setRecordingState({ state: 'idle', fileName: null, phoneNumber: null, duration: 0, error: null });
                                break;
                            case 'recordingUploaded':
                                // UI can react to this if needed
                                break;
                            case 'uploadQueueStatus':
                                setUploadQueueStatus({
                                    pendingCount: msg.pendingCount ?? 0,
                                    failedCount: msg.failedCount ?? 0,
                                    currentUpload: msg.currentUpload ?? null,
                                });
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

    const sendCommand = useCallback((command: Record<string, unknown>) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify(command));
        } catch { /* ignore send errors */ }
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

    const launchZoom = useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        setZoomLaunching(true);
        try {
            ws.send(JSON.stringify({ type: 'launchZoom' }));
        } catch {
            setZoomLaunching(false);
        }
        // Safety timeout in case agent never responds
        setTimeout(() => setZoomLaunching(false), 10000);
    }, []);

    return (
        <LocalAgentContext.Provider value={{
            isConnected, callState, networkQuality,
            zoomDetected, agentUptime, launchAgent,
            launchZoom, zoomLaunching,
            recordingState, latestRecording, uploadQueueStatus,
            sendCommand,
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
        launchZoom: () => {},
        zoomLaunching: false,
        recordingState: null,
        latestRecording: null,
        uploadQueueStatus: null,
        sendCommand: () => {},
    };
}
