'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';

export type RecorderStatus = 'idle' | 'recording' | 'stopping' | 'uploading' | 'success' | 'error';

interface UseCallRecorderReturn {
    /** Whether a persistent audio session is active (screen/tab shared) */
    isSessionActive: boolean;
    /** Current recorder status for the active recording */
    status: RecorderStatus;
    /** Elapsed seconds while recording */
    duration: number;
    /** Error message if status is 'error' */
    error: string | null;
    /** Start persistent audio session — prompts screen/tab share once */
    startSession: () => Promise<void>;
    /** End the persistent audio session */
    endSession: () => void;
    /** Start a new recording on the active session (no prompt) */
    startRecording: () => void;
    /** Stop the current recording and auto-upload */
    stopRecording: () => void;
}

/**
 * Hook for browser-based call recording.
 *
 * Uses a "persistent session" model:
 * 1. `startSession()` — calls getDisplayMedia once, keeps the stream alive.
 * 2. `startRecording()` — creates a MediaRecorder on the existing stream (no prompt).
 * 3. `stopRecording()` — stops the recorder, uploads to PocketBase.
 * 4. Repeat 2-3 for each call without needing to re-share.
 * 5. `endSession()` — tears down the stream when done.
 */
export function useCallRecorder(
    phoneNumberRef: React.RefObject<string | null>,
    uploaderId: string | undefined
): UseCallRecorderReturn {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [status, setStatus] = useState<RecorderStatus>('idle');
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimeRef = useRef<Date | null>(null);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
            }
        };
    }, []);

    // ── Timer helpers ───────────────────────────────────────────────────

    const resetTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setDuration(0);
        startTimeRef.current = null;
    }, []);

    const startTimer = useCallback(() => {
        startTimeRef.current = new Date();
        timerRef.current = setInterval(() => {
            if (startTimeRef.current) {
                setDuration(Math.floor((Date.now() - startTimeRef.current.getTime()) / 1000));
            }
        }, 1000);
    }, []);

    // ── Upload ──────────────────────────────────────────────────────────

    const uploadRecording = useCallback(
        async (blob: Blob, durationSec: number, phone: string | null) => {
            if (!uploaderId) {
                throw new Error('No authenticated user to upload recording');
            }

            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, '0');
            const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
            const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
            const phoneStr = phone || 'unknown';
            const fileName = `recording_${dateStr}_${timeStr}_${phoneStr}.webm`;

            const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });

            const formData = new FormData();
            formData.append('file', file);
            formData.append('uploader', uploaderId);
            formData.append('original_filename', fileName);
            formData.append('duration', Math.round(durationSec).toString());
            formData.append('recording_date', now.toISOString());
            formData.append('note', `Call recorded via browser on ${dateStr} at ${timeStr.replace(/-/g, ':')}`);

            if (phone) {
                formData.append('phone_number', phone);

                // Try to match to a phone_number record for company linking
                try {
                    const phoneRecord = await pb
                        .collection('phone_numbers')
                        .getFirstListItem(`phone_number ~ "${phone}"`);
                    if (phoneRecord) {
                        formData.append('phone_number_record', phoneRecord.id);
                        formData.append('company', phoneRecord.company as string);
                    }
                } catch {
                    // 404 or no match — phone_number string is already set above
                }
            }

            await pb.collection(COLLECTIONS.RECORDINGS).create(formData);
        },
        [uploaderId]
    );

    // ── Persistent Session ──────────────────────────────────────────────

    /**
     * Start a persistent audio capture session.
     * 1. getDisplayMedia → system audio (other party's voice)
     * 2. getUserMedia → microphone (user's own voice)
     * 3. Mix both via Web Audio API into one stream for MediaRecorder
     */
    const startSession = useCallback(async () => {
        try {
            setError(null);

            // 1. Capture system audio
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
                systemAudio: 'include',
                selfBrowserSurface: 'include',
            } as DisplayMediaStreamOptions);

            // Drop the video track — we only need audio
            displayStream.getVideoTracks().forEach((track) => {
                track.stop();
                displayStream.removeTrack(track);
            });

            if (displayStream.getAudioTracks().length === 0) {
                displayStream.getTracks().forEach((t) => t.stop());
                setError('No system audio captured. Select "Entire Screen" and check "Share system audio".');
                return;
            }

            // 2. Capture microphone
            let micStream: MediaStream | null = null;
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    }
                });
            } catch (micErr) {
                console.warn('[Recorder] Microphone not available, recording system audio only:', micErr);
                setError('Microphone not captured — only system audio will be recorded. Check mic permissions or close other apps using the mic.');
            }

            // 3. Mix both streams via Web Audio API
            const audioCtx = new AudioContext();
            // Ensure AudioContext is running (browsers may start it suspended)
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            const destination = audioCtx.createMediaStreamDestination();

            // Add system audio
            const systemSource = audioCtx.createMediaStreamSource(displayStream);
            systemSource.connect(destination);

            // Add mic audio (if available)
            if (micStream) {
                const micSource = audioCtx.createMediaStreamSource(micStream);
                // Boost mic volume so it's audible alongside system audio
                const micGain = audioCtx.createGain();
                micGain.gain.value = 1.5;
                micSource.connect(micGain);
                micGain.connect(destination);
                micStreamRef.current = micStream;
            }

            audioCtxRef.current = audioCtx;

            // The mixed stream is what we'll record
            const mixedStream = destination.stream;

            // Clean up when the browser's "Stop sharing" button is clicked
            displayStream.getAudioTracks().forEach((track) => {
                track.onended = () => {
                    if (mediaRecorderRef.current?.state === 'recording') {
                        mediaRecorderRef.current.stop();
                    }
                    // Clean up mic + audio context
                    micStreamRef.current?.getTracks().forEach(t => t.stop());
                    micStreamRef.current = null;
                    audioCtxRef.current?.close();
                    audioCtxRef.current = null;
                    streamRef.current = null;
                    setIsSessionActive(false);
                };
            });

            streamRef.current = mixedStream;
            setIsSessionActive(true);
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
                // User cancelled — not an error
                return;
            }
            console.error('Failed to start session:', err);
            setError(err instanceof Error ? err.message : 'Failed to start audio session');
        }
    }, []);

    /**
     * End the persistent session and release the shared stream.
     */
    const endSession = useCallback(() => {
        // Stop any active recording first
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }

        setIsSessionActive(false);
        setStatus('idle');
        resetTimer();
    }, [resetTimer]);

    // ── Per-Call Recording ──────────────────────────────────────────────

    /**
     * Start recording on the existing session stream.
     * No browser prompt — the stream is already active.
     */
    const startRecording = useCallback(() => {
        if (!streamRef.current || streamRef.current.getAudioTracks().length === 0) {
            setError('No active audio session. Enable recording session first.');
            return;
        }

        // If already recording, stop the current one first
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
        }

        chunksRef.current = [];

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

        const recorder = new MediaRecorder(streamRef.current, { mimeType });

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunksRef.current.push(e.data);
            }
        };

        recorder.onstop = async () => {
            const blob = new Blob(chunksRef.current, { type: mimeType });
            const durationSec = startTimeRef.current
                ? (Date.now() - startTimeRef.current.getTime()) / 1000
                : 0;

            resetTimer();

            const finalPhone = phoneNumberRef.current;

            if (blob.size > 0 && durationSec > 1) {
                try {
                    setStatus('uploading');
                    await uploadRecording(blob, durationSec, finalPhone);
                    setStatus('success');
                    setTimeout(() => setStatus('idle'), 3000);
                } catch (err: unknown) {
                    console.error('Upload failed:', err);
                    setStatus('error');
                    setError(err instanceof Error ? err.message : 'Upload failed');
                }
            } else {
                setStatus('idle');
            }
        };

        mediaRecorderRef.current = recorder;
        recorder.start(1000);
        startTimer();
        setStatus('recording');
        setError(null);
    }, [resetTimer, startTimer, uploadRecording, phoneNumberRef]);

    /**
     * Stop the current recording.
     */
    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            setStatus('stopping');
            mediaRecorderRef.current.stop();
        }
    }, []);

    return {
        isSessionActive,
        status,
        duration,
        error,
        startSession,
        endSession,
        startRecording,
        stopRecording,
    };
}
