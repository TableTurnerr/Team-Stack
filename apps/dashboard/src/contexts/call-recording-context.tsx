'use client';

import React, { createContext, useContext, useRef, ReactNode } from 'react';
import { useAuth } from './auth-context';
import { useCallRecorder, type RecorderStatus } from '@/hooks/use-call-recorder';

interface CallRecordingContextType {
    isSessionActive: boolean;
    status: RecorderStatus;
    duration: number;
    error: string | null;
    startSession: () => Promise<void>;
    endSession: () => void;
    startRecording: () => void;
    stopRecording: () => void;
    setPhoneNumber: (phone: string) => void;
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
