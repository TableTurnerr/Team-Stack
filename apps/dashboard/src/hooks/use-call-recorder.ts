'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';

export type RecorderStatus = 'idle' | 'recording' | 'stopping' | 'uploading' | 'success' | 'error';

/** One completed recording segment queued for later submission */
interface DeferredSegment {
    blob: Blob;
    duration: number;
    phone: string | null;
    mimeType: string;
}

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
    startSession: () => Promise<boolean>;
    /** End the persistent audio session */
    endSession: () => void;
    /** Start a new recording on the active session (no prompt) */
    startRecording: () => void;
    /** Stop the current recording and auto-upload */
    stopRecording: () => void;
    /**
     * Discard the current recording without uploading.
     * Use for "No Answer" calls where we don't want to save the recording.
     * Also clears any accumulated deferred segments.
     */
    discardRecording: () => void;
    /**
     * Enter deferred-upload mode. Subsequent stopRecording() calls will
     * queue each completed recording in memory instead of uploading immediately.
     * Multiple calls may queue up without losing each other.
     * Use submitOldestDeferredRecording() to pop and upload one at a time,
     * or submitDeferredRecording() to merge all and upload at once.
     */
    enterDeferredMode: () => void;
    /**
     * Pop the OLDEST pending recording from the queue and upload it.
     * Call this once per form submission to link each call's recording to its call log.
     * If recording is still active, waits for it to complete first.
     * @param callLogId Optional call log ID to link the recording to.
     * @returns The created recording ID, or null if nothing was uploaded.
     */
    submitOldestDeferredRecording: (callLogId?: string, clientCallId?: string | null) => Promise<string | null>;
    /**
     * Discard the OLDEST pending recording from the queue (e.g. for "No Answer").
     * If recording is still active, discards it without queuing.
     */
    discardOldestDeferredRecording: () => void;
    /**
     * Stop the active recording (if any), merge ALL queued segments,
     * and upload the result as a single file.
     * Exits deferred mode. Used for backward compat / session cleanup.
     * @param callLogId Optional call log ID to link the recording to.
     * @returns The created recording ID, or null if nothing was uploaded.
     */
    submitDeferredRecording: (callLogId?: string, clientCallId?: string | null) => Promise<string | null>;
    /**
     * Discard ALL queued segments without uploading and exit deferred mode.
     */
    discardDeferredRecording: () => void;
    /** Whether deferred mode is currently active */
    isDeferredMode: boolean;
    /** The queue of completed per-call recordings waiting for submission */
    deferredSegments: DeferredSegment[];
}

/**
 * Hook for browser-based call recording.
 *
 * Uses a "persistent session" model:
 * 1. `startSession()` — calls getDisplayMedia once, keeps the stream alive.
 * 2. `startRecording()` — creates a MediaRecorder on the existing stream (no prompt).
 * 3. `stopRecording()` — stops the recorder, uploads to PocketBase (or defers in deferred mode).
 * 4. Repeat 2-3 for each call without needing to re-share.
 * 5. `endSession()` — tears down the stream when done.
 *
 * Deferred mode: When `enterDeferredMode()` is called, all recording segments are
 * held in memory. `submitDeferredRecording()` merges all segments and uploads them
 * as a single file. This enables callback recording where multiple call legs are
 * joined into one recording.
 */
export function useCallRecorder(
    phoneNumberRef: React.RefObject<string | null>,
    uploaderId: string | undefined
): UseCallRecorderReturn {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [status, setStatus] = useState<RecorderStatus>('idle');
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isDeferredMode, setIsDeferredMode] = useState(false);
    const [deferredSegments, setDeferredSegments] = useState<DeferredSegment[]>([]);

    const streamRef = useRef<MediaStream | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const sourceStreamRef = useRef<MediaStream | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startTimeRef = useRef<Date | null>(null);

    // Deferred mode state — queue of completed per-call recordings
    // Each call's completed recording is pushed here; form submissions pop one at a time.
    // This prevents recordings from being lost when the next call starts before
    // the previous call's form is submitted.
    const isDeferredRef = useRef(false);
    const deferredSegmentsRef = useRef<DeferredSegment[]>([]);

    // Discard flag: when true, onstop skips upload/defer and just clears
    const shouldDiscardRef = useRef(false);

    // Promise resolver for waiting on onstop after stop() call
    const onStopResolveRef = useRef<(() => void) | null>(null);

    // True between when stop() is called and when onstop fires.
    // Lets submitOldestDeferredRecording/submitDeferredRecording wait even when
    // the recorder state is already 'inactive' (stop called externally) but the
    // onstop callback hasn't pushed the blob to the queue yet.
    const stopPendingRef = useRef(false);

    // Generation counter: increments on each startRecording() call.
    // Old onstop handlers compare their captured gen to the current gen
    // and skip timer/status resets if a newer recorder has started.
    const recorderGenRef = useRef(0);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
            }
            if (sourceStreamRef.current) {
                sourceStreamRef.current.getTracks().forEach((t) => t.stop());
            }
            if (micStreamRef.current) {
                micStreamRef.current.getTracks().forEach((t) => t.stop());
            }
            if (audioCtxRef.current) {
                audioCtxRef.current.close().catch(console.error);
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
            // Keep AudioContext alive while recording — browsers may suspend it
            // when the tab loses focus, which silently kills audio flow.
            if (audioCtxRef.current?.state === 'suspended') {
                audioCtxRef.current.resume().catch(console.error);
            }
        }, 1000);
    }, []);

    // ── Upload ──────────────────────────────────────────────────────────

    const uploadRecording = useCallback(
        async (blob: Blob, durationSec: number, phone: string | null, callLogId?: string): Promise<string> => {
            if (!uploaderId) {
                throw new Error('No authenticated user to upload recording');
            }

            const now = new Date();
            const pad = (n: number) => n.toString().padStart(2, '0');
            const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
            const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
            const phoneStr = (phone || 'unknown').replace(/[^\d+]/g, '');
            const callLogSuffix = callLogId ? `_cl-${callLogId}` : '';
            const fileName = `recording_${dateStr}_${timeStr}_${phoneStr}${callLogSuffix}.webm`;

            const file = new File([blob], fileName, { type: blob.type || 'audio/webm' });

            const formData = new FormData();
            formData.append('file', file);
            formData.append('uploader', uploaderId);
            formData.append('original_filename', fileName);
            formData.append('duration', Math.round(durationSec).toString());
            formData.append('recording_date', now.toISOString());
            formData.append('note', `Call recorded via browser on ${dateStr} at ${timeStr.replace(/-/g, ':')}`);

            if (callLogId) {
                formData.append('call_log', callLogId);
            }

            if (phone) {
                formData.append('phone_number', phone);

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

            const created = await pb.collection(COLLECTIONS.RECORDINGS).create<{ id: string }>(formData);
            return created.id;
        },
        [uploaderId]
    );

    // ── Persistent Session ──────────────────────────────────────────────

    const startSession = useCallback(async (): Promise<boolean> => {
        try {
            setError(null);

            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
                systemAudio: 'include',
                selfBrowserSurface: 'include',
                surfaceSwitching: 'include',
                monitorTypeSurfaces: 'exclude',
            } as any);

            if (displayStream.getAudioTracks().length === 0) {
                displayStream.getTracks().forEach((t) => t.stop());
                setError('No system audio captured. Select "Entire Screen" and check "Share system audio".');
                return false;
            }

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

            const audioCtx = new AudioContext();
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            const destination = audioCtx.createMediaStreamDestination();

            const systemSource = audioCtx.createMediaStreamSource(displayStream);
            systemSource.connect(destination);

            if (micStream) {
                const micSource = audioCtx.createMediaStreamSource(micStream);
                const micGain = audioCtx.createGain();
                micGain.gain.value = 1.5;
                micSource.connect(micGain);
                micGain.connect(destination);
                micStreamRef.current = micStream;
            }

            audioCtxRef.current = audioCtx;

            const mixedStream = destination.stream;

            const handleStreamEnded = () => {
                if (mediaRecorderRef.current?.state === 'recording') {
                    mediaRecorderRef.current.stop();
                }
                if (micStreamRef.current) {
                    micStreamRef.current.getTracks().forEach(t => t.stop());
                    micStreamRef.current = null;
                }
                if (audioCtxRef.current) {
                    audioCtxRef.current.close().catch(console.error);
                    audioCtxRef.current = null;
                }
                if (sourceStreamRef.current) {
                    sourceStreamRef.current.getTracks().forEach((t) => t.stop());
                    sourceStreamRef.current = null;
                }
                streamRef.current = null;
                setIsSessionActive(false);
            };

            // Only listen for ended on AUDIO tracks. The video track from
            // getDisplayMedia can end randomly (browser optimisation, tab switch,
            // minimised shared window) while the audio continues — attaching
            // onended to it was the root cause of recordings stopping mid-call.
            displayStream.getAudioTracks().forEach((track) => {
                track.onended = handleStreamEnded;
            });

            // Stop video tracks immediately — we only need audio, and keeping
            // them alive wastes resources and can interfere with recording.
            displayStream.getVideoTracks().forEach((t) => t.stop());

            streamRef.current = mixedStream;
            sourceStreamRef.current = displayStream;
            setIsSessionActive(true);
            return true;
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
                return false;
            }
            console.error('Failed to start session:', err);
            setError(err instanceof Error ? err.message : 'Failed to start audio session');
            return false;
        }
    }, []);

    const endSession = useCallback(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }

        if (sourceStreamRef.current) {
            sourceStreamRef.current.getTracks().forEach((t) => t.stop());
            sourceStreamRef.current = null;
        }

        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach((t) => t.stop());
            micStreamRef.current = null;
        }

        if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(console.error);
            audioCtxRef.current = null;
        }

        // Clear deferred state on session end
        isDeferredRef.current = false;
        deferredSegmentsRef.current = [];
        shouldDiscardRef.current = false;
        setIsDeferredMode(false);

        setIsSessionActive(false);
        setStatus('idle');
        resetTimer();
    }, [resetTimer]);

    // ── Per-Call Recording ──────────────────────────────────────────────

    const startRecording = useCallback(() => {
        if (!streamRef.current || streamRef.current.getAudioTracks().length === 0) {
            setError('No active audio session. Enable recording session first.');
            setStatus('error');
            return;
        }

        // If already recording, DON'T stop-and-restart. Multiple effects may
        // trigger startRecording() for the same call (activeCallNumber sync,
        // callStatus change, auto-record in call-recorder-controls, handleDial).
        // Restarting kills the in-progress recording after ~0-2 seconds and
        // produces a tiny/empty segment — root cause of "recordings cut short."
        if (mediaRecorderRef.current?.state === 'recording') {
            return;
        }

        // Resume AudioContext if the browser suspended it (common when tab
        // loses focus). A suspended context stops feeding audio to the
        // MediaRecorder, causing empty/truncated recordings.
        if (audioCtxRef.current?.state === 'suspended') {
            audioCtxRef.current.resume().catch(console.error);
        }

        // Bump generation so any in-flight onstop from the previous recorder
        // knows it is stale and skips timer / status resets.
        const gen = ++recorderGenRef.current;

        // Each recorder gets its own local chunks array so old onstop handlers
        // cannot corrupt the new recorder's data.
        const localChunks: Blob[] = [];

        // Capture the phone number now so the onstop handler uses the value at
        // recording-start time, even if the caller clears the ref before the call ends.
        const capturedPhone = phoneNumberRef.current;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

        const recorder = new MediaRecorder(streamRef.current, { mimeType });

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                localChunks.push(e.data);
            }
        };

        recorder.onstop = async () => {
            // stop() has fully fired — clear the pending flag before anything else
            // so that any awaiter in submitOldestDeferredRecording can read a
            // consistent queue state after we resolve their promise below.
            stopPendingRef.current = false;

            const blob = new Blob(localChunks, { type: mimeType });
            const durationSec = startTimeRef.current
                ? (Date.now() - startTimeRef.current.getTime()) / 1000
                : 0;

            // If a newer recorder has already started, this onstop is stale.
            // We still push deferred segments (don't lose recordings), but we
            // must NOT reset the timer or status — that would clobber the new recorder.
            const isStale = gen !== recorderGenRef.current;

            if (!isStale) {
                resetTimer();
            }

            // Resolve any waiting promise first
            const resolve = onStopResolveRef.current;
            if (!isStale) {
                onStopResolveRef.current = null;
            }

            // Discard mode: clear everything, no upload
            if (shouldDiscardRef.current) {
                if (!isStale) {
                    shouldDiscardRef.current = false;
                    setStatus('idle');
                }
                resolve?.();
                return;
            }

            // Deferred mode: push this call's completed recording to the queue.
            // This preserves recordings when the next call starts before the
            // previous call's form is submitted.
            // Always push even if stale — we must not lose completed recordings.
            if (isDeferredRef.current) {
                if (blob.size > 100) {
                    const newSegment = {
                        blob,
                        duration: durationSec,
                        phone: capturedPhone,
                        mimeType,
                    };
                    deferredSegmentsRef.current.push(newSegment);
                    setDeferredSegments([...deferredSegmentsRef.current]);
                    console.log('[Recorder] Queued deferred segment. Queue size:', deferredSegmentsRef.current.length);
                }
                if (!isStale) {
                    setStatus('idle');
                }
                resolve?.();
                return;
            }


            // Normal mode: upload immediately (only if this is the active recorder)
            // Use the phone number captured when recording started (not the ref, which may
            // have been cleared by the caller between startRecording and onstop firing).
            if (isStale) {
                // Stale recorder in non-deferred mode — discard silently
                resolve?.();
                return;
            }

            const finalPhone = capturedPhone;

            if (blob.size > 100) {
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

            resolve?.();
        };

        mediaRecorderRef.current = recorder;
        recorder.start(250); // 250ms timeslice: capture chunks frequently so very short calls aren't missed
        startTimer();
        setStatus('recording');
        setError(null);
    }, [resetTimer, startTimer, uploadRecording, phoneNumberRef]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            setStatus('stopping');
            stopPendingRef.current = true;
            mediaRecorderRef.current.stop();
        }
    }, []);

    // ── Discard recording ───────────────────────────────────────────────

    /**
     * Stop the current recording without uploading and clear any deferred segments.
     * Use for "No Answer" calls.
     */
    const discardRecording = useCallback(() => {
        shouldDiscardRef.current = true;
        deferredSegmentsRef.current = [];
        isDeferredRef.current = false;
        setIsDeferredMode(false);

        if (mediaRecorderRef.current?.state === 'recording') {
            setStatus('stopping');
            stopPendingRef.current = true;
            mediaRecorderRef.current.stop();
        } else {
            stopPendingRef.current = false;
            resetTimer();
            setStatus('idle');
        }
    }, [resetTimer]);

    // ── Deferred mode ───────────────────────────────────────────────────

    /** Enter deferred mode: future stopRecording() calls queue blobs in memory instead of uploading */
    const enterDeferredMode = useCallback(() => {
        isDeferredRef.current = true;
        // NOTE: do NOT clear deferredSegmentsRef here.
        // Previous calls' recordings stay in the queue until their forms are submitted
        // via submitOldestDeferredRecording().  Clearing here was the root cause of
        // recordings being lost when a new call started before the previous form was saved.
        setIsDeferredMode(true);
    }, []);

    /**
     * Pop the OLDEST pending recording from the queue and upload it.
     * Call once per form submission so each call's recording is linked to its own call log.
     * If recording is still active (e.g. session ends mid-call), stops it first.
     */
    const submitOldestDeferredRecording = useCallback(async (callLogId?: string, _clientCallId?: string | null): Promise<string | null> => {
        // Capture phone synchronously before any async gap
        const phoneForUpload = phoneNumberRef.current;

        // If currently recording, stop and wait for onstop to queue the final segment.
        // Also wait if stop() was already called externally (stopPendingRef=true) but
        // onstop hasn't fired yet — otherwise the queue is empty and the recording is lost.
        if (mediaRecorderRef.current?.state === 'recording') {
            await new Promise<void>(resolve => {
                onStopResolveRef.current = resolve;
                setStatus('stopping');
                stopPendingRef.current = true;
                mediaRecorderRef.current!.stop();
            });
        } else if (stopPendingRef.current) {
            // stop() was called externally (e.g., by call-recorder-controls) but onstop
            // hasn't fired yet.  Register a resolver so onstop will wake us up.
            await new Promise<void>(resolve => {
                onStopResolveRef.current = resolve;
            });
        }

        // Pop the oldest segment from the queue (FIFO)
        const segment = deferredSegmentsRef.current.shift();
        setDeferredSegments([...deferredSegmentsRef.current]);

        // Exit deferred mode once the queue is empty
        if (deferredSegmentsRef.current.length === 0) {
            isDeferredRef.current = false;
            setIsDeferredMode(false);
        }

        if (!segment || segment.blob.size <= 100) return null;

        try {
            setStatus('uploading');
            const recordingId = await uploadRecording(
                segment.blob,
                segment.duration,
                segment.phone ?? phoneForUpload,
                callLogId,
            );
            setStatus('success');
            setTimeout(() => setStatus('idle'), 3000);
            return recordingId;
        } catch (err: unknown) {
            console.error('Deferred upload failed:', err);
            setStatus('error');
            setError(err instanceof Error ? err.message : 'Upload failed');
            return null;
        }
    }, [uploadRecording, phoneNumberRef]);

    /**
     * Discard the OLDEST pending recording from the queue (e.g. for "No Answer" calls).
     * If recording is still active, stops and discards it without queuing.
     */
    const discardOldestDeferredRecording = useCallback(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
            // Set discard flag so onstop does NOT push to the queue
            shouldDiscardRef.current = true;
            setStatus('stopping');
            stopPendingRef.current = true;
            mediaRecorderRef.current.stop();
        } else {
            // Recording already stopped — just pop and discard the oldest segment
            stopPendingRef.current = false;
            deferredSegmentsRef.current.shift();
            setDeferredSegments([...deferredSegmentsRef.current]);
            if (deferredSegmentsRef.current.length === 0) {
                isDeferredRef.current = false;
                setIsDeferredMode(false);
            }
            resetTimer();
            setStatus('idle');
        }
    }, [resetTimer]);

    /**
     * Stop the active recording (if any), merge ALL queued segments, and upload as one file.
     * Exits deferred mode. Kept for backward-compat / edge cases where merging is desired.
     */
    const submitDeferredRecording = useCallback(async (callLogId?: string, _clientCallId?: string | null): Promise<string | null> => {
        // Capture phone immediately (synchronously) before any async operations
        const finalPhone = phoneNumberRef.current;

        // If currently recording, stop and wait for onstop to accumulate the final segment
        if (mediaRecorderRef.current?.state === 'recording') {
            await new Promise<void>(resolve => {
                onStopResolveRef.current = resolve;
                setStatus('stopping');
                stopPendingRef.current = true;
                mediaRecorderRef.current!.stop();
            });
        } else if (stopPendingRef.current) {
            // stop() was called externally but onstop hasn't fired yet — wait for it
            await new Promise<void>(resolve => {
                onStopResolveRef.current = resolve;
            });
        }

        // Exit deferred mode before uploading
        isDeferredRef.current = false;
        setIsDeferredMode(false);

        const segments = deferredSegmentsRef.current;
        deferredSegmentsRef.current = [];
        setDeferredSegments([]);

        if (segments.length === 0) return null;

        const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
        const mimeType = segments[segments.length - 1]?.mimeType || 'audio/webm';
        const merged = new Blob(segments.map(s => s.blob), { type: mimeType });

        if (merged.size > 100) {
            try {
                setStatus('uploading');
                const recordingId = await uploadRecording(merged, totalDuration, finalPhone, callLogId);
                setStatus('success');
                setTimeout(() => setStatus('idle'), 3000);
                return recordingId;
            } catch (err: unknown) {
                console.error('Deferred upload failed:', err);
                setStatus('error');
                setError(err instanceof Error ? err.message : 'Upload failed');
            }
        } else {
            setStatus('idle');
        }
        return null;
    }, [uploadRecording, phoneNumberRef]);

    /** Discard ALL queued segments without uploading and exit deferred mode */
    const discardDeferredRecording = useCallback(() => {
        shouldDiscardRef.current = true;
        deferredSegmentsRef.current = [];
        setDeferredSegments([]);
        isDeferredRef.current = false;
        setIsDeferredMode(false);

        if (mediaRecorderRef.current?.state === 'recording') {
            setStatus('stopping');
            mediaRecorderRef.current.stop();
        } else {
            resetTimer();
            setStatus('idle');
        }
    }, [resetTimer]);

    return {
        isSessionActive,
        status,
        duration,
        error,
        startSession,
        endSession,
        startRecording,
        stopRecording,
        discardRecording,
        enterDeferredMode,
        submitOldestDeferredRecording,
        discardOldestDeferredRecording,
        submitDeferredRecording,
        discardDeferredRecording,
        isDeferredMode,
        deferredSegments,
    };
}
