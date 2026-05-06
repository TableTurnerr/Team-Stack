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
    // Ownership envelope — lets us distinguish "this teammate is on a call"
    // from "some teammate on the shared account is on a call." When
    // uiSeenHere OR audioActiveHere is true, THIS device is the one with
    // the active call panel / ring toast.
    deviceId: string | null;
    intentId: string | null;
    /**
     * Stable per-call id minted by the dashboard at dial time and threaded
     * through the dial intent → recording manifest → broadcast. Lets the
     * dashboard link a recording to the exact call_log it just created
     * without relying on a global "latest recording" pointer.
     */
    clientCallId: string | null;
    zoomCallId: string | null;
    uiSeenHere: boolean;
    audioActiveHere: boolean;
    /**
     * Negative-confirmation signal from the agent. When true, the shared
     * Zoom account shows "On a call" presence but NO local active/ring UI
     * is visible — i.e. another teammate on another device is on a call.
     * Use to (a) reinforce that this device does NOT own the call, and
     * (b) indicate that the shared line is currently busy with a teammate.
     */
    teammateOnCall: boolean;
    /**
     * Soft-end signal: the agent's audio/UI sources stayed quiet long
     * enough to look like a hangup, but no HARD termination signal has
     * arrived. Treated as still-connected by the dashboard, which surfaces
     * a "Has the call ended?" prompt to the user.
     */
    tentativeEnd: boolean;
    /**
     * UTC ISO-8601 timestamp marking when the silence began. Once the
     * user confirms the call ended, this is the cutoff used for talk-time
     * / recording duration so hold/mute periods aren't billed.
     */
    silenceStartedAt: string | null;
}

export interface AgentNetworkQuality {
    latencyMs: number;
    jitter: number;
    packetLoss: number;
    isStable: boolean;
}

export interface AgentRecordingState {
    state: 'idle' | 'recording' | 'stopping' | 'error';
    recordingId: string | null;
    fileName: string | null;
    phoneNumber: string | null;
    duration: number;
    error: string | null;
}

export interface AgentRecordingCompleted {
    recordingId: string;
    fileName: string;
    phoneNumber: string;
    duration: number;
    fileSizeBytes: number;
    startTime: string;
    /**
     * Stable per-call id stamped on the recording at start time, copied
     * from the dial intent. Lets callers link this recording to the exact
     * call_log they just created without using the global latestRecording.
     */
    clientCallId: string | null;
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
    /**
     * Wall-clock ms timestamp of the last frame received from the agent
     * (any type, including pongs/heartbeats). Updated on every WebSocket
     * message so consumers can detect a frozen-but-still-open socket
     * without re-implementing their own staleness tracking.
     */
    lastMessageAt: number;
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
    /**
     * Recordings on disk that haven't been linked to a CRM call log yet.
     * Refreshed on agent connect and whenever the agent reports a state
     * change that could have added/removed an unlinked entry. Lets the UI
     * recover the "Recorded but unsubmitted" pill after a page refresh.
     */
    unlinkedRecordings: AgentRecordingCompleted[];
    /** Upload queue status */
    uploadQueueStatus: AgentUploadQueueStatus | null;
    /** Per-recording upload progress, keyed by file name */
    uploadProgress: Map<string, { bytesSent: number; bytesTotal: number }>;
    /** Recordings that failed to upload (after retry exhaustion) */
    failedUploads: Array<{ fileName: string; phoneNumber: string; startTime: string; error: string | null; retryCount: number; callLogId: string | null }>;
    /** Send a command to the agent via WebSocket */
    sendCommand: (command: Record<string, unknown>) => void;
    /**
     * Fetch a local recording file from the agent as a browser Blob, for
     * previewing recordings that haven't been uploaded to PocketBase yet.
     * Rejects if the agent isn't connected, the file is missing, or the
     * request times out.
     */
    fetchLocalRecording: (fileName: string) => Promise<Blob>;
    /**
     * Link the recording stamped with this clientCallId to the given call_log.
     * Preferred over the global "latestRecording" lookup because it stays
     * correct even when MP3 conversion lag means latestRecording still
     * points at the previous call when the user submits the new form.
     */
    linkRecordingByClientId: (clientCallId: string, callLogId: string) => void;
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
    const [lastMessageAt, setLastMessageAt] = useState<number>(() => Date.now());
    const [recordingState, setRecordingState] = useState<AgentRecordingState | null>(null);
    const [latestRecording, setLatestRecording] = useState<AgentRecordingCompleted | null>(null);
    const [unlinkedRecordings, setUnlinkedRecordings] = useState<AgentRecordingCompleted[]>([]);
    const [uploadQueueStatus, setUploadQueueStatus] = useState<AgentUploadQueueStatus | null>(null);
    const [uploadProgress, setUploadProgress] = useState<Map<string, { bytesSent: number; bytesTotal: number }>>(new Map());
    const [failedUploads, setFailedUploads] = useState<Array<{
        fileName: string; phoneNumber: string; startTime: string;
        error: string | null; retryCount: number; callLogId: string | null;
    }>>([]);

    // Pending local-recording fetch promises keyed by requested file name.
    // Resolved when the matching `localRecording` WebSocket message arrives.
    const pendingLocalFetchesRef = useRef<Map<string, {
        resolve: (b: Blob) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>>(new Map());

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const attemptRef = useRef(0);
    const mountedRef = useRef(true);
    // Pulse-watcher: tracks when we last received ANY message from the
    // agent. A loopback WebSocket can stay "open" for several seconds
    // after the peer process has died (the OS hasn't reaped the TCP
    // socket yet), which masks the issue from the dashboard. We send a
    // periodic ping and force-close + reconnect if no reply arrives.
    const lastMessageAtRef = useRef<number>(Date.now());
    const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        mountedRef.current = true;

        // Re-relay PocketBase auth to the agent whenever the token changes
        // (login, refresh, logout). The initial setUploadConfig is sent on
        // ws.onopen below; this keeps the agent's auth in sync afterwards.
        const unsubscribeAuth = pb.authStore.onChange(() => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            try {
                ws.send(JSON.stringify({
                    type: 'setUploadConfig',
                    pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL || '',
                    authToken: pb.authStore.token || '',
                    uploaderId: pb.authStore.model?.id || '',
                }));
                console.log('[LocalAgent] Re-sent upload config after auth change');
            } catch { /* ignore */ }
        });

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
                    lastMessageAtRef.current = Date.now();

                    // Start the pulse-watcher: every 3 s, if we haven't
                    // heard ANYTHING from the agent in >4 s (heartbeat is
                    // 1 s, so 4 missed beats), force-close the socket so
                    // onclose fires and the reconnect ladder kicks in.
                    // This catches half-open TCP sockets that the OS
                    // hasn't reaped — without it the dashboard waits on
                    // a ghost connection forever.
                    if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
                    pulseTimerRef.current = setInterval(() => {
                        const sock = wsRef.current;
                        if (!sock || sock.readyState !== WebSocket.OPEN) return;
                        const elapsed = Date.now() - lastMessageAtRef.current;
                        if (elapsed > 4_000) {
                            console.warn(`[LocalAgent] No agent message for ${elapsed}ms — force-closing socket to recover`);
                            try { sock.close(); } catch { /* onclose schedules reconnect */ }
                            return;
                        }
                        // Emit a lightweight ping so the agent has reason
                        // to send something back even when nothing else
                        // is happening.
                        try { sock.send(JSON.stringify({ type: 'ping' })); } catch { /* will be detected next tick */ }
                    }, 3_000);

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
                        // Repopulate the list of on-disk unlinked recordings
                        // so the "Recorded but unsubmitted" UI survives page
                        // refreshes and agent reconnects.
                        ws.send(JSON.stringify({ type: 'getUnlinkedRecordings' }));
                    } catch { /* ignore */ }
                };

                ws.onmessage = (event) => {
                    if (!mountedRef.current) return;
                    // Mark liveness on EVERY frame, including unknown types
                    // — the watchdog only cares that the socket is talking.
                    const now = Date.now();
                    lastMessageAtRef.current = now;
                    setLastMessageAt(now);
                    try {
                        const msg = JSON.parse(event.data);
                        switch (msg.type) {
                            case 'pong':
                                // No-op — liveness already recorded above.
                                break;
                            case 'callState': {
                                // Defensive: when the agent reports idle the
                                // call is over, so any per-call identifiers
                                // (intentId / clientCallId / phone) MUST be
                                // wiped here even if the agent payload still
                                // carries leftover values. This prevents the
                                // form from attributing the next call to the
                                // previous call's clientCallId during the
                                // idle→ringing race window.
                                const incomingState = msg.state ?? 'idle';
                                const isIdle = incomingState === 'idle';
                                setCallState({
                                    state: incomingState,
                                    phoneNumber: isIdle ? null : (msg.phoneNumber ?? null),
                                    direction: isIdle ? null : (msg.direction ?? null),
                                    duration: msg.duration ?? 0,
                                    confidence: msg.confidence ?? 'low',
                                    deviceId: msg.deviceId ?? null,
                                    intentId: isIdle ? null : (msg.intentId ?? null),
                                    clientCallId: isIdle ? null : (msg.clientCallId ?? null),
                                    zoomCallId: isIdle ? null : (msg.zoomCallId ?? null),
                                    uiSeenHere: !isIdle && Boolean(msg.uiSeenHere),
                                    audioActiveHere: !isIdle && Boolean(msg.audioActiveHere),
                                    teammateOnCall: Boolean(msg.teammateOnCall),
                                    tentativeEnd: !isIdle && Boolean(msg.tentativeEnd),
                                    silenceStartedAt: isIdle ? null : (msg.silenceStartedAt ?? null),
                                });
                                break;
                            }
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
                                    recordingId: msg.recordingId ?? null,
                                    fileName: msg.fileName ?? null,
                                    phoneNumber: msg.phoneNumber ?? null,
                                    duration: msg.duration ?? 0,
                                    error: msg.error ?? null,
                                });
                                break;
                            case 'recordingCompleted': {
                                const completed: AgentRecordingCompleted = {
                                    recordingId: msg.recordingId ?? '',
                                    fileName: msg.fileName ?? '',
                                    phoneNumber: msg.phoneNumber ?? '',
                                    duration: msg.duration ?? 0,
                                    fileSizeBytes: msg.fileSizeBytes ?? 0,
                                    startTime: msg.startTime ?? '',
                                    clientCallId: msg.clientCallId ?? null,
                                };
                                setLatestRecording(completed);
                                // Keep the unlinked list in sync so the
                                // recording is still visible after refresh.
                                setUnlinkedRecordings(prev => {
                                    const without = prev.filter(r => r.fileName !== completed.fileName);
                                    return [completed, ...without];
                                });
                                setRecordingState({ state: 'idle', recordingId: null, fileName: null, phoneNumber: null, duration: 0, error: null });
                                break;
                            }
                            case 'recordingUploaded': {
                                // Once uploaded (and linked), the recording
                                // is no longer "unsubmitted" — drop it from
                                // the local list.
                                const fn: string = msg.fileName ?? '';
                                if (fn) {
                                    setUnlinkedRecordings(prev => prev.filter(r => r.fileName !== fn));
                                }
                                break;
                            }
                            case 'unlinkedRecordings': {
                                const list: AgentRecordingCompleted[] = Array.isArray(msg.recordings)
                                    ? msg.recordings.map((r: Record<string, unknown>) => ({
                                        recordingId: (r.recordingId as string) ?? '',
                                        fileName: (r.fileName as string) ?? '',
                                        phoneNumber: (r.phoneNumber as string) ?? '',
                                        duration: (r.duration as number) ?? 0,
                                        fileSizeBytes: (r.fileSizeBytes as number) ?? 0,
                                        startTime: (r.startTime as string) ?? '',
                                        clientCallId: (r.clientCallId as string | null | undefined) ?? null,
                                    }))
                                    : [];
                                setUnlinkedRecordings(list);
                                // Seed latestRecording from the most recent
                                // unlinked entry if the live one is empty
                                // (first load after a page refresh).
                                setLatestRecording(prev => prev ?? list[0] ?? null);
                                break;
                            }
                            case 'endCallResult':
                            case 'dialResult':
                                console.log('[LocalAgent] %s: %s', msg.type, msg.success ? 'OK' : `FAILED: ${msg.error}`);
                                break;
                            case 'localRecording': {
                                // Resolve whichever pending fetch matches the base filename.
                                // The agent may return the post-link renamed form (..._cl-<id>.mp3)
                                // even though we asked for the base — match by prefix to stay robust.
                                const rxName: string = msg.fileName ?? '';
                                const base = rxName.replace(/_cl-[^.]+(?=\.)/, '').replace(/\.mp3$/i, '');
                                const pending = pendingLocalFetchesRef.current;
                                const keys = Array.from(pending.keys());
                                const matchKey = keys.find(k => {
                                    const kBase = k.replace(/_cl-[^.]+(?=\.)/, '').replace(/\.mp3$/i, '');
                                    return kBase === base || k === rxName;
                                });
                                if (!matchKey) break;
                                const entry = pending.get(matchKey)!;
                                pending.delete(matchKey);
                                clearTimeout(entry.timer);
                                if (!msg.success || !msg.data) {
                                    entry.reject(new Error(msg.error || 'Agent returned no data'));
                                    break;
                                }
                                try {
                                    const binary = atob(msg.data);
                                    const bytes = new Uint8Array(binary.length);
                                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                                    entry.resolve(new Blob([bytes], { type: msg.mimeType || 'audio/mpeg' }));
                                } catch (e) {
                                    entry.reject(e instanceof Error ? e : new Error('Decode failed'));
                                }
                                break;
                            }
                            case 'uploadQueueStatus':
                                setUploadQueueStatus({
                                    pendingCount: msg.pendingCount ?? 0,
                                    failedCount: msg.failedCount ?? 0,
                                    currentUpload: msg.currentUpload ?? null,
                                });
                                if ((msg.failedCount ?? 0) > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({ type: 'getFailedUploads' }));
                                }
                                break;
                            case 'recordingConverted': {
                                // Same shape as recordingCompleted but fires after MP3 conversion.
                                // Update unlinkedRecordings/latestRecording with final duration +
                                // fileSize, since recordingCompleted may have been broadcast pre-
                                // conversion with placeholder values.
                                const fn: string = msg.fileName ?? '';
                                const dur: number = msg.duration ?? 0;
                                const fs: number = msg.fileSizeBytes ?? 0;
                                if (!fn) break;
                                setUnlinkedRecordings(prev => prev.map(r =>
                                    r.fileName === fn ? { ...r, duration: dur, fileSizeBytes: fs } : r
                                ));
                                setLatestRecording(prev => (prev && prev.fileName === fn)
                                    ? { ...prev, duration: dur, fileSizeBytes: fs }
                                    : prev
                                );
                                break;
                            }
                            case 'uploadProgress': {
                                // Per-recording byte progress while uploading.
                                const fn: string = msg.fileName ?? '';
                                const sent: number = msg.bytesSent ?? 0;
                                const total: number = msg.bytesTotal ?? 0;
                                if (!fn) break;
                                setUploadProgress(prev => {
                                    const next = new Map(prev);
                                    if (sent >= total && total > 0) next.delete(fn); // upload finished
                                    else next.set(fn, { bytesSent: sent, bytesTotal: total });
                                    return next;
                                });
                                break;
                            }
                            case 'failedUploads': {
                                const list = Array.isArray(msg.recordings) ? msg.recordings.map((r: Record<string, unknown>) => ({
                                    fileName: (r.fileName as string) ?? '',
                                    phoneNumber: (r.phoneNumber as string) ?? '',
                                    startTime: (r.startTime as string) ?? '',
                                    error: (r.error as string | null) ?? null,
                                    retryCount: (r.retryCount as number) ?? 0,
                                    callLogId: (r.callLogId as string | null) ?? null,
                                })) : [];
                                setFailedUploads(list);
                                // Drop any in-flight progress entries for
                                // permanently-failed uploads so the map
                                // doesn't grow unbounded across retries.
                                if (list.length > 0) {
                                    setUploadProgress(prev => {
                                        if (prev.size === 0) return prev;
                                        const next = new Map(prev);
                                        let changed = false;
                                        for (const r of list) {
                                            if (r.fileName && next.delete(r.fileName)) changed = true;
                                        }
                                        return changed ? next : prev;
                                    });
                                }
                                break;
                            }
                            case 'uploadCompleted': {
                                // Final outcome of a single upload attempt.
                                // Whether success or failure, the in-flight
                                // progress entry is no longer relevant — drop
                                // it so the map cannot leak across many calls.
                                const fn: string = msg.fileName ?? '';
                                if (fn) {
                                    setUploadProgress(prev => {
                                        if (!prev.has(fn)) return prev;
                                        const next = new Map(prev);
                                        next.delete(fn);
                                        return next;
                                    });
                                }
                                break;
                            }
                            case 'circuitBreakerTripped': {
                                console.warn(
                                    '[LocalAgent] Upload circuit breaker tripped — pausing %ds. Reason: %s',
                                    msg.cooldownSeconds ?? 60,
                                    msg.reason ?? 'consecutive failures',
                                );
                                setUploadQueueStatus(prev => prev
                                    ? { ...prev, currentUpload: null }
                                    : prev);
                                break;
                            }
                            case 'authRestored': {
                                // Agent re-acquired credentials; ensure the
                                // dashboard knows uploads can resume by
                                // re-broadcasting the latest auth token.
                                if (pb.authStore.isValid && pb.authStore.token &&
                                    wsRef.current?.readyState === WebSocket.OPEN) {
                                    try {
                                        wsRef.current.send(JSON.stringify({
                                            type: 'setUploadConfig',
                                            pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL || '',
                                            authToken: pb.authStore.token,
                                            uploaderId: pb.authStore.model?.id || '',
                                        }));
                                    } catch { /* ignore */ }
                                }
                                break;
                            }
                            case 'auth_required': {
                                // Agent's upload pipeline got a 401 (or the
                                // saved token failed DPAPI decryption on
                                // startup). Try to silently refresh the
                                // dashboard's auth and re-broadcast the new
                                // token to the agent — if that succeeds the
                                // user never sees a prompt and the upload
                                // queue resumes draining within a couple of
                                // seconds. If it fails, the user has to
                                // sign in again; surface that via the auth
                                // store so the global auth guard reroutes.
                                console.warn('[LocalAgent] Agent reported auth_required:', msg.reason);
                                (async () => {
                                    try {
                                        if (pb.authStore.isValid) {
                                            await pb.collection('users').authRefresh();
                                            const sock = wsRef.current;
                                            if (sock?.readyState === WebSocket.OPEN && pb.authStore.token) {
                                                sock.send(JSON.stringify({
                                                    type: 'setUploadConfig',
                                                    pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL || '',
                                                    authToken: pb.authStore.token,
                                                    uploaderId: pb.authStore.model?.id || '',
                                                }));
                                                console.log('[LocalAgent] Re-broadcast refreshed auth to agent');
                                            }
                                        } else {
                                            console.warn('[LocalAgent] Cannot recover — dashboard auth is also invalid');
                                            pb.authStore.clear();
                                        }
                                    } catch (err) {
                                        console.error('[LocalAgent] Auth refresh failed:', err);
                                        pb.authStore.clear();
                                    }
                                })();
                                break;
                            }
                        }
                    } catch { /* ignore malformed messages */ }
                };

                ws.onclose = () => {
                    if (!mountedRef.current) return;
                    console.log('[LocalAgent] Disconnected from agent');
                    setIsConnected(false);
                    setCallState(null);
                    wsRef.current = null;
                    if (pulseTimerRef.current) {
                        clearInterval(pulseTimerRef.current);
                        pulseTimerRef.current = null;
                    }
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
            unsubscribeAuth();
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (pulseTimerRef.current) {
                clearInterval(pulseTimerRef.current);
                pulseTimerRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.onclose = null; // prevent reconnect on unmount
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    const fetchLocalRecording = useCallback((fileName: string): Promise<Blob> => {
        return new Promise<Blob>((resolve, reject) => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Local agent is not connected'));
                return;
            }
            // If we already have a pending request for this file, piggy-back on it.
            const existing = pendingLocalFetchesRef.current.get(fileName);
            if (existing) {
                const prevResolve = existing.resolve;
                const prevReject = existing.reject;
                existing.resolve = (b) => { prevResolve(b); resolve(b); };
                existing.reject = (e) => { prevReject(e); reject(e); };
                return;
            }
            const timer = setTimeout(() => {
                pendingLocalFetchesRef.current.delete(fileName);
                reject(new Error('Timed out waiting for local recording'));
            }, 15000);
            pendingLocalFetchesRef.current.set(fileName, { resolve, reject, timer });
            try {
                ws.send(JSON.stringify({ type: 'getLocalRecording', fileName }));
            } catch (err) {
                pendingLocalFetchesRef.current.delete(fileName);
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error('Failed to send request'));
            }
        });
    }, []);

    const sendCommand = useCallback((command: Record<string, unknown>) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify(command));
        } catch { /* ignore send errors */ }
    }, []);

    const linkRecordingByClientId = useCallback((clientCallId: string, callLogId: string) => {
        if (!clientCallId || !callLogId) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify({ type: 'linkRecordingByClientId', clientCallId, callLogId }));
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
            zoomDetected, agentUptime, lastMessageAt, launchAgent,
            launchZoom, zoomLaunching,
            recordingState, latestRecording, unlinkedRecordings, uploadQueueStatus,
            uploadProgress, failedUploads,
            sendCommand, fetchLocalRecording, linkRecordingByClientId,
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
        lastMessageAt: 0,
        launchAgent: () => {},
        launchZoom: () => {},
        zoomLaunching: false,
        recordingState: null,
        latestRecording: null,
        unlinkedRecordings: [],
        uploadQueueStatus: null,
        uploadProgress: new Map(),
        failedUploads: [],
        sendCommand: () => {},
        fetchLocalRecording: () => Promise.reject(new Error('Local agent is not connected')),
        linkRecordingByClientId: () => {},
    };
}
