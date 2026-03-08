'use client';

import React, { createContext, useContext, useRef, ReactNode } from 'react';
import { useAuth } from './auth-context';
import { useCallRecorder, type RecorderStatus } from '@/hooks/use-call-recorder';

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
    /** Discard the current recording without uploading (e.g. for "No Answer" calls) */
    discardRecording: () => void;
    /** Enter deferred mode — recordings queue in memory instead of auto-uploading */
    enterDeferredMode: () => void;
    /**
     * Pop the OLDEST queued recording and upload it for the given call log.
     * Call once per form submission. Preserves other calls' recordings in the queue.
     */
    submitOldestDeferredRecording: (callLogId?: string) => Promise<string | null>;
    /**
     * Discard the OLDEST queued recording without uploading (e.g. for "No Answer").
     */
    discardOldestDeferredRecording: () => void;
    /**
     * Merge all queued segments and upload as a single file.
     * @param callLogId Optional call log ID to link the recording to.
     * @returns The created recording ID, or null if nothing was uploaded.
     */
    submitDeferredRecording: (callLogId?: string) => Promise<string | null>;
    /** Discard all queued segments without uploading */
    discardDeferredRecording: () => void;
    /** Whether deferred mode is currently active */
    isDeferredMode: boolean;
    /** The queue of completed per-call recordings waiting for submission */
    deferredSegments: any[]; // Use any[] or import DeferredSegment if possible, but any[] is safer for quick fix
}

const CallRecordingContext = createContext<CallRecordingContextType | undefined>(undefined);

export function CallRecordingProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const phoneNumberRef = useRef<string | null>(null);

    const recorder = useCallRecorder(phoneNumberRef, user?.id);

    const setPhoneNumber = (phone: string) => {
        phoneNumberRef.current = phone;
    };

    return (
        <CallRecordingContext.Provider value={{ ...recorder, setPhoneNumber }}>
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
