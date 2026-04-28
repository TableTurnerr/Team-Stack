'use client';

import React, { createContext, useContext, useRef, ReactNode } from 'react';
import { useAuth } from './auth-context';
import { useLocalAgent, type AgentRecordingCompleted, type AgentUploadQueueStatus } from './local-agent-context';
import { useAgentRecorder, type RecorderStatus } from '@/hooks/use-agent-recorder';
import { useCallRecorder, type RecorderStatus as BrowserRecorderStatus } from '@/hooks/use-call-recorder';

interface CallRecordingContextType {
    isSessionActive: boolean;
    status: RecorderStatus;
    duration: number;
    error: string | null;
    startSession: () => Promise<boolean>;
    endSession: () => void;
    startRecording: () => void;
    stopRecording: () => void;
    setPhoneNumber: (phone: string) => void;
    discardRecording: () => void;
    enterDeferredMode: () => void;
    /**
     * Submit the oldest deferred recording. If clientCallId is given, the
     * agent uses its stable per-call stamp to find the right recording —
     * this avoids mis-attribution when MP3 conversion lag means the global
     * "latest recording" still points at the previous call.
     */
    submitOldestDeferredRecording: (callLogId?: string, clientCallId?: string | null) => Promise<string | null>;
    discardOldestDeferredRecording: () => void;
    submitDeferredRecording: (callLogId?: string, clientCallId?: string | null) => Promise<string | null>;
    discardDeferredRecording: () => void;
    isDeferredMode: boolean;
    deferredSegments: any[];
    /** Latest completed recording from the local agent (null in browser mode) */
    latestRecording: AgentRecordingCompleted | null;
    /** Agent upload queue status (null in browser mode) */
    uploadQueueStatus: AgentUploadQueueStatus | null;
}

const CallRecordingContext = createContext<CallRecordingContextType | undefined>(undefined);

/**
 * Recording provider that uses the local agent when connected,
 * falling back to browser-based recording when the agent is offline.
 */
export function CallRecordingProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const { isConnected } = useLocalAgent();
    const phoneNumberRef = useRef<string | null>(null);

    // Agent-based recorder (used when agent is connected)
    const agentRecorder = useAgentRecorder(phoneNumberRef, user?.id);

    // Browser-based recorder (fallback when agent is offline)
    const browserRecorder = useCallRecorder(phoneNumberRef, user?.id);

    // Choose which recorder to use based on agent connection
    const recorder = isConnected ? agentRecorder : browserRecorder;

    const setPhoneNumber = (phone: string) => {
        phoneNumberRef.current = phone;
        // Also update the agent recorder's phone ref if available
        if ('setPhoneNumber' in recorder) {
            (recorder as any).setPhoneNumber(phone);
        }
    };

    return (
        <CallRecordingContext.Provider value={{
            ...recorder,
            setPhoneNumber,
            latestRecording: isConnected ? agentRecorder.latestRecording : null,
            uploadQueueStatus: isConnected ? { pendingCount: agentRecorder.uploadPendingCount, failedCount: agentRecorder.uploadFailedCount, currentUpload: null } : null,
        }}>
            {children}
        </CallRecordingContext.Provider>
    );
}

export function useCallRecording() {
    const context = useContext(CallRecordingContext);
    if (context === undefined) {
        throw new Error('useCallRecording must be used within a CallRecordingProvider');
    }
    return context;
}
