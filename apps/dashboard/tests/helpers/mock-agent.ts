/**
 * mock-agent.ts
 * Playwright helpers for mocking the Local CRM Agent WebSocket connection.
 *
 * The real local agent is a Windows-only desktop app that broadcasts call state
 * over WebSocket at ws://127.0.0.1:9876. In tests, we intercept the WebSocket
 * constructor to create a fake connection that we can control from Playwright.
 *
 * This allows testing:
 *   1. Agent status indicators (connected/disconnected)
 *   2. Grace period logic (agent prevents false Zoom disconnects)
 *   3. Session verification requiring agent connection
 */

import { type Page } from '@playwright/test';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MockAgentCallState {
    state: 'idle' | 'ringing' | 'connected' | 'ended';
    phoneNumber?: string;
    direction?: 'inbound' | 'outbound';
    duration?: number;
    confidence?: 'low' | 'medium' | 'high';
}

export interface MockAgentNetworkQuality {
    latencyMs?: number;
    jitter?: number;
    packetLoss?: number;
    isStable?: boolean;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Inject a mock WebSocket that intercepts connections to the local agent URL.
 * Must be called BEFORE page.goto().
 *
 * The mock immediately fires `onopen` so the LocalAgentProvider sees
 * `isConnected = true`. A heartbeat is sent every 2 seconds to keep the
 * connection alive and set `zoomDetected = true`.
 */
export async function setupMockAgent(page: Page) {
    await page.addInitScript(() => {
        const AGENT_URL = 'ws://127.0.0.1:9876';
        const OriginalWebSocket = window.WebSocket;

        // Store the mock instance so Playwright can send messages to it
        (window as any).__mockAgentWs = null;
        (window as any).__mockAgentConnected = false;

        // @ts-ignore — override WebSocket constructor
        window.WebSocket = function (url: string, protocols?: any) {
            // Only intercept connections to the agent URL
            if (url === AGENT_URL) {
                const mockWs: any = {
                    url,
                    readyState: 0, // CONNECTING
                    CONNECTING: 0,
                    OPEN: 1,
                    CLOSING: 2,
                    CLOSED: 3,
                    bufferedAmount: 0,
                    extensions: '',
                    protocol: '',
                    binaryType: 'blob',
                    onopen: null,
                    onmessage: null,
                    onclose: null,
                    onerror: null,
                    send: (data: string) => {
                        // Capture commands sent TO the agent
                        try {
                            const cmd = JSON.parse(data);
                            (window as any).__mockAgentCommands = (window as any).__mockAgentCommands ?? [];
                            (window as any).__mockAgentCommands.push(cmd);
                        } catch {}
                    },
                    close: () => {
                        mockWs.readyState = 3;
                        if (mockWs._heartbeatTimer) clearInterval(mockWs._heartbeatTimer);
                        (window as any).__mockAgentConnected = false;
                        if (mockWs.onclose) {
                            mockWs.onclose(new CloseEvent('close'));
                        }
                    },
                    // Helper to dispatch a message event
                    _dispatchMessage: (data: any) => {
                        if (mockWs.onmessage) {
                            mockWs.onmessage(new MessageEvent('message', {
                                data: JSON.stringify(data),
                            }));
                        }
                    },
                    _heartbeatTimer: null as any,
                    addEventListener: (type: string, fn: any) => {
                        if (type === 'open') mockWs.onopen = fn;
                        if (type === 'message') mockWs.onmessage = fn;
                        if (type === 'close') mockWs.onclose = fn;
                        if (type === 'error') mockWs.onerror = fn;
                    },
                    removeEventListener: () => {},
                    dispatchEvent: () => true,
                };

                (window as any).__mockAgentWs = mockWs;

                // Simulate connection opening after a short delay
                setTimeout(() => {
                    if (mockWs.readyState === 3) return; // already closed
                    mockWs.readyState = 1; // OPEN
                    (window as any).__mockAgentConnected = true;
                    if (mockWs.onopen) {
                        mockWs.onopen(new Event('open'));
                    }
                    // Send initial heartbeat (with recording fields)
                    mockWs._dispatchMessage({
                        type: 'heartbeat',
                        version: '1.0.0-test',
                        uptime: 100,
                        zoomDetected: true,
                        connectedClients: 1,
                        isRecording: false,
                        recordingDuration: 0,
                        uploadsPending: 0,
                        uploadsFailed: 0,
                        timestamp: Date.now(),
                    });
                    // Send idle call state
                    mockWs._dispatchMessage({
                        type: 'callState',
                        state: 'idle',
                        phoneNumber: null,
                        direction: null,
                        duration: 0,
                        confidence: 'high',
                        timestamp: Date.now(),
                    });
                    // Periodic heartbeats
                    mockWs._heartbeatTimer = setInterval(() => {
                        if (mockWs.readyState !== 1) return;
                        mockWs._dispatchMessage({
                            type: 'heartbeat',
                            version: '1.0.0-test',
                            uptime: Math.floor((Date.now() - 100000) / 1000),
                            zoomDetected: true,
                            connectedClients: 1,
                            timestamp: Date.now(),
                        });
                    }, 2000);
                }, 50);

                return mockWs;
            }

            // All other WebSocket connections use the real implementation
            return new OriginalWebSocket(url, protocols);
        } as any;

        // Copy static properties
        (window.WebSocket as any).CONNECTING = 0;
        (window.WebSocket as any).OPEN = 1;
        (window.WebSocket as any).CLOSING = 2;
        (window.WebSocket as any).CLOSED = 3;
        (window.WebSocket as any).prototype = OriginalWebSocket.prototype;
    });
}

// ─── Runtime control ──────────────────────────────────────────────────────────

/** Send a callState message through the mock WebSocket. */
export async function sendAgentCallState(page: Page, callState: MockAgentCallState) {
    await page.evaluate((cs) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'callState',
                state: cs.state,
                phoneNumber: cs.phoneNumber ?? null,
                direction: cs.direction ?? null,
                duration: cs.duration ?? 0,
                confidence: cs.confidence ?? 'high',
                timestamp: Date.now(),
            });
        }
    }, callState);
}

/** Send a networkQuality message through the mock WebSocket. */
export async function sendAgentNetworkQuality(page: Page, quality: MockAgentNetworkQuality) {
    await page.evaluate((q) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'networkQuality',
                latencyMs: q.latencyMs ?? 25,
                jitter: q.jitter ?? 3,
                packetLoss: q.packetLoss ?? 0,
                isStable: q.isStable ?? true,
                timestamp: Date.now(),
            });
        }
    }, quality);
}

/** Send a heartbeat message through the mock WebSocket. */
export async function sendAgentHeartbeat(
    page: Page,
    opts?: { zoomDetected?: boolean; uptime?: number },
) {
    await page.evaluate((o) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'heartbeat',
                version: '1.0.0-test',
                uptime: o?.uptime ?? 100,
                zoomDetected: o?.zoomDetected ?? true,
                connectedClients: 1,
                timestamp: Date.now(),
            });
        }
    }, opts ?? {});
}

/** Disconnect the mock agent WebSocket (simulates agent going offline). */
export async function disconnectMockAgent(page: Page) {
    await page.evaluate(() => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws.close();
        }
    });
}

/** Check if the mock agent is connected. */
export async function isMockAgentConnected(page: Page): Promise<boolean> {
    return page.evaluate(() => !!(window as any).__mockAgentConnected);
}

// ─── Recording message helpers ───────────────────────────────────────────────

export interface MockRecordingState {
    state: 'idle' | 'recording' | 'stopping' | 'error';
    fileName?: string;
    phoneNumber?: string;
    duration?: number;
    error?: string;
}

export interface MockRecordingCompleted {
    fileName: string;
    phoneNumber: string;
    duration: number;
    fileSizeBytes: number;
    startTime: string;
}

export interface MockRecordingUploaded {
    fileName: string;
    pocketbaseRecordingId: string;
    callLogId?: string;
    success: boolean;
    error?: string;
}

export interface MockUploadQueueStatus {
    pendingCount: number;
    failedCount: number;
    currentUpload?: string;
}

/** Send a recordingState message through the mock WebSocket. */
export async function sendAgentRecordingState(page: Page, state: MockRecordingState) {
    await page.evaluate((s) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'recordingState',
                state: s.state,
                fileName: s.fileName ?? null,
                phoneNumber: s.phoneNumber ?? null,
                duration: s.duration ?? 0,
                error: s.error ?? null,
                timestamp: Date.now(),
            });
        }
    }, state);
}

/** Send a recordingCompleted message through the mock WebSocket. */
export async function sendAgentRecordingCompleted(page: Page, completed: MockRecordingCompleted) {
    await page.evaluate((c) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'recordingCompleted',
                fileName: c.fileName,
                phoneNumber: c.phoneNumber,
                duration: c.duration,
                fileSizeBytes: c.fileSizeBytes,
                startTime: c.startTime,
                timestamp: Date.now(),
            });
        }
    }, completed);
}

/** Send a recordingUploaded message through the mock WebSocket. */
export async function sendAgentRecordingUploaded(page: Page, uploaded: MockRecordingUploaded) {
    await page.evaluate((u) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'recordingUploaded',
                fileName: u.fileName,
                pocketbaseRecordingId: u.pocketbaseRecordingId,
                callLogId: u.callLogId ?? null,
                success: u.success,
                error: u.error ?? null,
                timestamp: Date.now(),
            });
        }
    }, uploaded);
}

/** Send an uploadQueueStatus message through the mock WebSocket. */
export async function sendAgentUploadQueueStatus(page: Page, status: MockUploadQueueStatus) {
    await page.evaluate((s) => {
        const ws = (window as any).__mockAgentWs;
        if (ws && ws.readyState === 1) {
            ws._dispatchMessage({
                type: 'uploadQueueStatus',
                pendingCount: s.pendingCount,
                failedCount: s.failedCount,
                currentUpload: s.currentUpload ?? null,
                timestamp: Date.now(),
            });
        }
    }, status);
}

/** Capture commands sent TO the mock agent from the dashboard. */
export async function captureAgentCommands(page: Page): Promise<any[]> {
    return page.evaluate(() => (window as any).__mockAgentCommands ?? []);
}

/** Clear captured agent commands. */
export async function clearAgentCommands(page: Page) {
    await page.evaluate(() => { (window as any).__mockAgentCommands = []; });
}
