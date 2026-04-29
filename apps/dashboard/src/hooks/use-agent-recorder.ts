'use client';

import { useCallback, useRef } from 'react';
import { useLocalAgent, type AgentRecordingCompleted } from '@/contexts/local-agent-context';

export type RecorderStatus = 'idle' | 'recording' | 'stopping' | 'uploading' | 'success' | 'error';

interface UseAgentRecorderReturn {
    /** Whether the agent is connected (replaces isSessionActive) */
    isSessionActive: boolean;
    /** Current recorder status */
    status: RecorderStatus;
    /** Elapsed seconds while recording */
    duration: number;
    /** Error message if status is 'error' */
    error: string | null;

    /** Start recording (sends command to agent) */
    startRecording: () => void;
    /** Stop recording (sends command to agent) */
    stopRecording: () => void;
    /** Discard the current recording */
    discardRecording: () => void;
    /** Set the phone number for the current recording */
    setPhoneNumber: (phone: string) => void;

    /** Enter deferred mode (no-op for agent — kept for interface compat) */
    enterDeferredMode: () => void;
    /**
     * Link the latest recording to a call log and return a dummy ID.
     * If clientCallId is provided, the agent uses its stable per-call id to
     * locate the exact recording — sidestepping the global-latest-recording
     * race that can mis-attribute the previous call's MP3 to this call_log.
     */
    submitOldestDeferredRecording: (callLogId?: string, clientCallId?: string | null) => Promise<string | null>;
    /** Discard oldest deferred recording */
    discardOldestDeferredRecording: () => void;
    /** Submit all deferred recordings (same as submitOldest for agent) */
    submitDeferredRecording: (callLogId?: string, clientCallId?: string | null) => Promise<string | null>;
    /** Discard all deferred recordings */
    discardDeferredRecording: () => void;
    /** Whether deferred mode is active (always true when agent connected) */
    isDeferredMode: boolean;
    /** Deferred segments (empty array — agent manages segments) */
    deferredSegments: never[];

    /** Start audio session (no-op — agent manages audio) */
    startSession: () => Promise<boolean>;
    /** End audio session (no-op — agent manages audio) */
    endSession: () => void;

    /** Latest completed recording metadata */
    latestRecording: AgentRecordingCompleted | null;
    /** Upload pending count */
    uploadPendingCount: number;
    /** Upload failed count */
    uploadFailedCount: number;
    /** Whether auto-record is enabled */
    autoRecordEnabled: boolean;
    /** Set auto-record mode */
    setAutoRecord: (enabled: boolean) => void;
}

/**
 * Hook that proxies recording controls to the local agent via WebSocket.
 * Drop-in replacement for useCallRecorder with the same interface.
 */
export function useAgentRecorder(
    phoneNumberRef: React.RefObject<string | null>,
    _uploaderId: string | undefined,
): UseAgentRecorderReturn {
    const {
        isConnected,
        recordingState,
        latestRecording,
        uploadQueueStatus,
        sendCommand,
        linkRecordingByClientId,
    } = useLocalAgent();

    const autoRecordRef = useRef(true);
    const phoneRef = useRef<string | null>(null);

    // Map agent recording state to RecorderStatus
    const status: RecorderStatus =
        recordingState?.state === 'recording' ? 'recording' :
        recordingState?.state === 'stopping' ? 'stopping' :
        recordingState?.state === 'error' ? 'error' :
        'idle';

    const duration = recordingState?.duration ?? 0;
    const error = recordingState?.error ?? null;

    const startRecording = useCallback(() => {
        const phone = phoneNumberRef.current ?? phoneRef.current ?? '';
        sendCommand({ type: 'startRecording', phoneNumber: phone });
    }, [sendCommand, phoneNumberRef]);

    const stopRecording = useCallback(() => {
        sendCommand({ type: 'stopRecording' });
    }, [sendCommand]);

    const discardRecording = useCallback(() => {
        sendCommand({ type: 'discardRecording' });
    }, [sendCommand]);

    const setPhoneNumber = useCallback((phone: string) => {
        phoneRef.current = phone;
    }, []);

    const enterDeferredMode = useCallback(() => {
        // No-op: agent always manages recordings independently
    }, []);

    const submitOldestDeferredRecording = useCallback(async (callLogId?: string, clientCallId?: string | null): Promise<string | null> => {
        if (callLogId && clientCallId) {
            // Stable per-call id path: agent finds the recording by the id
            // it stamped at start time, eliminating the global-latest-recording
            // race when MP3 conversion lags.
            linkRecordingByClientId(clientCallId, callLogId);
            return latestRecording?.fileName ?? clientCallId;
        }
        if (!latestRecording) return null;
        if (callLogId) {
            sendCommand({
                type: 'linkRecording',
                recordingId: latestRecording.recordingId,
                fileName: latestRecording.fileName,
                callLogId,
            });
        }
        // Return the fileName as a pseudo-ID so callers know a recording exists
        return latestRecording.fileName;
    }, [latestRecording, sendCommand, linkRecordingByClientId]);

    const discardOldestDeferredRecording = useCallback(() => {
        sendCommand({ type: 'discardRecording' });
    }, [sendCommand]);

    const submitDeferredRecording = useCallback(async (callLogId?: string, clientCallId?: string | null): Promise<string | null> => {
        return submitOldestDeferredRecording(callLogId, clientCallId);
    }, [submitOldestDeferredRecording]);

    const discardDeferredRecording = useCallback(() => {
        sendCommand({ type: 'discardRecording' });
    }, [sendCommand]);

    const startSession = useCallback(async (): Promise<boolean> => {
        // Agent manages audio — no browser session needed
        return isConnected;
    }, [isConnected]);

    const endSession = useCallback(() => {
        // No-op: agent session persists independently
    }, []);

    const setAutoRecord = useCallback((enabled: boolean) => {
        autoRecordRef.current = enabled;
        sendCommand({ type: 'setAutoRecord', enabled, onRinging: false });
    }, [sendCommand]);

    return {
        isSessionActive: isConnected,
        status,
        duration,
        error,
        startRecording,
        stopRecording,
        discardRecording,
        setPhoneNumber,
        enterDeferredMode,
        submitOldestDeferredRecording,
        discardOldestDeferredRecording,
        submitDeferredRecording,
        discardDeferredRecording,
        isDeferredMode: true,
        deferredSegments: [],
        startSession,
        endSession,
        latestRecording,
        uploadPendingCount: uploadQueueStatus?.pendingCount ?? 0,
        uploadFailedCount: uploadQueueStatus?.failedCount ?? 0,
        autoRecordEnabled: autoRecordRef.current,
        setAutoRecord,
    };
}
