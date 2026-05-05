'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Building2, StickyNote, History, ArrowLeft, Check, User, Crown, Headphones, X, Loader2, Pencil, CheckCircle2, AlertTriangle, Upload, Link as LinkIcon } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Company, type Recording, type CompanyNote } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useLocalAgent } from '@/contexts/local-agent-context';
import { cn } from '@/lib/utils';
import { PhoneHoverCard } from '@/components/phone-hover-card';
import { RecordingPlayerOverlay } from '@/components/recording-player-overlay';

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
    'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
    'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
    'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
    'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
    'Fumbled': { bg: 'bg-orange-500/10', text: 'text-orange-500' },
    'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
};

interface LastCallPreviewProps {
    callLog: CallLog | null;
    companyName: string;
    sessionId?: string; // Optional - for fetching all calls in session
}

const LAST_CALL_STORAGE_KEY = 'crm:session:last-call:v1';

// Defensive shapes for upload-tracking state added by sibling units. Typed as
// optional so this component compiles whether or not the upstream PRs are
// merged. `uploadProgress` may carry either bytes or a precomputed percent.
interface UploadProgressEntry {
    callLogId?: string | null;
    fileName?: string;
    bytesSent?: number;
    bytesTotal?: number;
    percent?: number;
}
interface FailedUploadEntry {
    callLogId?: string | null;
    fileName?: string;
}

export function LastCallPreview({ callLog, companyName, sessionId }: LastCallPreviewProps) {
    const { user } = useAuth();
    const agent = useLocalAgent() as unknown as {
        uploadProgress?: Map<string, UploadProgressEntry>;
        failedUploads?: FailedUploadEntry[];
        sendCommand: (command: Record<string, unknown>) => void;
    };
    const uploadProgress = agent.uploadProgress ?? null;
    const failedUploads = useMemo(() => agent.failedUploads ?? [], [agent.failedUploads]);
    const sendCommand = agent.sendCommand;
    const [retryingFileName, setRetryingFileName] = useState<string | null>(null);
    // FileNames whose upload has completed successfully during this mount
    // (saw progress, then dropped from the map without entering failedUploads).
    const [completedUploads, setCompletedUploads] = useState<Set<string>>(new Set());
    // Tracks the file currently in progress for our display call so we can
    // detect the transition out of uploadProgress.
    const seenInProgressRef = useRef<Map<string, string>>(new Map()); // callLogId -> fileName
    const [isExpanded, setIsExpanded] = useState(true);
    const [localCallLog, setLocalCallLog] = useState<CallLog | null>(null);
    const [localCompanyName, setLocalCompanyName] = useState('');
    const [fetchingLastCall, setFetchingLastCall] = useState(false);

    // Track if we've already attempted to fetch the last call for this session
    const fetchAttemptedRef = useRef(false);

    // Recording state
    const [playerRecording, setPlayerRecording] = useState<Recording | null>(null);
    const [playerLoading, setPlayerLoading] = useState(false);

    // Call browser state
    const [showBrowser, setShowBrowser] = useState(false);
    const [allCalls, setAllCalls] = useState<CallLog[]>([]);
    const [loadingCalls, setLoadingCalls] = useState(false);
    const [viewingCall, setViewingCall] = useState<CallLog | null>(null);
    const [viewingCompanyName, setViewingCompanyName] = useState('');

    const [updating, setUpdating] = useState(false);
    const [updated, setUpdated] = useState(false);

    // Initial hydration from props or localStorage
    useEffect(() => {
        if (callLog) {
            setLocalCallLog(callLog);
            setLocalCompanyName(companyName);
            // Persist to localStorage
            localStorage.setItem(LAST_CALL_STORAGE_KEY, JSON.stringify({ callLog, companyName, sessionId }));
        } else {
            // Try localStorage first for instant UI
            const stored = localStorage.getItem(LAST_CALL_STORAGE_KEY);
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed.sessionId === sessionId) {
                        setLocalCallLog(parsed.callLog);
                        setLocalCompanyName(parsed.companyName);
                    }
                } catch (e) {
                    console.error('Failed to parse stored last call:', e);
                }
            }
        }
    }, [callLog, companyName, sessionId]);

    // Reset fetch attempt when session changes
    useEffect(() => {
        fetchAttemptedRef.current = false;
    }, [sessionId]);

    // Fetch latest call from DB if we have a sessionId but no log
    useEffect(() => {
        if (!sessionId || callLog || localCallLog || fetchAttemptedRef.current) return;

        fetchAttemptedRef.current = true;

        const fetchLastCall = async () => {
            setFetchingLastCall(true);
            try {
                const result = await pb.collection(COLLECTIONS.CALL_LOGS).getList<CallLog>(1, 1, {
                    filter: `session = "${sessionId}"`,
                    sort: '-call_time',
                    expand: 'company,phone_number_record',
                });

                if (result.items.length > 0) {
                    const lastCall = result.items[0];
                    const compName = lastCall.expand?.company?.company_name || 'Unknown';
                    setLocalCallLog(lastCall);
                    setLocalCompanyName(compName);
                    localStorage.setItem(LAST_CALL_STORAGE_KEY, JSON.stringify({
                        callLog: lastCall,
                        companyName: compName,
                        sessionId
                    }));
                }
            } catch (err) {
                console.error('Failed to fetch last call:', err);
            } finally {
                setFetchingLastCall(false);
            }
        };

        fetchLastCall();
    }, [sessionId, callLog, localCallLog]);

    const [notes, setNotes] = useState('');
    const [ownerReached, setOwnerReached] = useState(false);
    const [pitchCompleted, setPitchCompleted] = useState(false);
    const [appointmentSet, setAppointmentSet] = useState(false);
    const [receptionistName, setReceptionistName] = useState('');
    const [ownerName, setOwnerName] = useState('');

    // Pre-call notes for the company
    const [preCallNotes, setPreCallNotes] = useState<CompanyNote[]>([]);
    const [preCallNotesLoading, setPreCallNotesLoading] = useState(false);
    const [editingPreCallNote, setEditingPreCallNote] = useState(false);
    const [preCallNoteDraft, setPreCallNoteDraft] = useState('');
    const [savingPreCallNote, setSavingPreCallNote] = useState(false);
    const lastFetchedPreCallCompanyId = useRef('');

    // Track which call we're showing
    const displayCall = viewingCall || localCallLog;
    const displayCompany = viewingCall ? viewingCompanyName : localCompanyName;
    const isViewingOlderCall = viewingCall !== null;

    const handlePlayRecording = async () => {
        if (!displayCall?.id || !displayCall.has_recording || playerLoading) return;

        setPlayerLoading(true);
        try {
            // Try by call_log first (browser mode, or agent mode where upload happened after linking)
            let recording: Recording | null = null;
            try {
                recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                    `call_log = "${displayCall.id}"`,
                );
            } catch {
                // Fallback: in agent mode the recording may have been uploaded before linking,
                // so the PB record won't have call_log set. Try matching by phone number instead.
                const phone = displayCall.expand?.phone_number_record?.phone_number;
                if (phone) {
                    const digits = phone.replace(/\D/g, '').slice(-10);
                    try {
                        recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                            `phone_number ~ "${digits}"`,
                            { sort: '-created' },
                        );
                    } catch {
                        // No recording found by phone either
                    }
                }
            }
            if (recording && recording.file) {
                setPlayerRecording(recording);
            }
        } catch (err) {
            console.error('Failed to fetch recording for last call preview:', err);
        } finally {
            setPlayerLoading(false);
        }
    };

    // Sync form fields when displayed call changes
    const callId = displayCall?.id;
    const [trackedCallId, setTrackedCallId] = useState(callId);
    
    useEffect(() => {
        if (displayCall?.id !== trackedCallId) {
            setTrackedCallId(displayCall?.id);
            setNotes(displayCall?.post_call_notes || '');
            setOwnerReached(displayCall?.owner_reached || false);
            setPitchCompleted(displayCall?.pitch_completed || false);
            setAppointmentSet(displayCall?.appointment_set || false);
            setReceptionistName(displayCall?.receptionist_name || '');
            setOwnerName(displayCall?.owner_name_found || '');
            setUpdated(false);
            setPlayerRecording(null);
        }
    }, [displayCall, trackedCallId]);

    // Fetch pre-call notes when the displayed call's company changes
    const displayCompanyId = displayCall?.expand?.company?.id || displayCall?.company || '';
    useEffect(() => {
        if (!displayCompanyId) {
            setPreCallNotes([]);
            lastFetchedPreCallCompanyId.current = '';
            setEditingPreCallNote(false);
            setPreCallNoteDraft('');
            return;
        }
        if (displayCompanyId === lastFetchedPreCallCompanyId.current) return;
        lastFetchedPreCallCompanyId.current = displayCompanyId;
        setEditingPreCallNote(false);
        setPreCallNoteDraft('');
        setPreCallNotesLoading(true);
        pb.collection(COLLECTIONS.COMPANY_NOTES).getFullList<CompanyNote>({
            filter: `company = "${displayCompanyId}" && note_type = "pre_call"`,
            sort: '-created',
            expand: 'created_by',
        }).then(notes => setPreCallNotes(notes))
            .catch(console.error)
            .finally(() => setPreCallNotesLoading(false));
    }, [displayCompanyId]);

    const combinedPreCallNote = preCallNotes.map(n => n.content).join('\n\n');
    const mostRecentPreCallNote = preCallNotes[0] ?? null;

    const handleStartEditPreCallNote = useCallback(() => {
        setPreCallNoteDraft(combinedPreCallNote);
        setEditingPreCallNote(true);
    }, [combinedPreCallNote]);

    const handleCancelEditPreCallNote = useCallback(() => {
        setEditingPreCallNote(false);
        setPreCallNoteDraft('');
    }, []);

    const handleSavePreCallNote = useCallback(async () => {
        if (!displayCompanyId || !user) return;
        const trimmed = preCallNoteDraft.trim();
        setSavingPreCallNote(true);
        try {
            if (trimmed.length === 0) {
                await Promise.all(preCallNotes.map(n =>
                    pb.collection(COLLECTIONS.COMPANY_NOTES).delete(n.id)
                ));
                setPreCallNotes([]);
            } else if (mostRecentPreCallNote) {
                const updated = await pb.collection(COLLECTIONS.COMPANY_NOTES).update<CompanyNote>(
                    mostRecentPreCallNote.id,
                    { content: trimmed },
                    { expand: 'created_by' }
                );
                const older = preCallNotes.slice(1);
                await Promise.all(older.map(n =>
                    pb.collection(COLLECTIONS.COMPANY_NOTES).delete(n.id)
                ));
                setPreCallNotes([updated]);
            } else {
                const created = await pb.collection(COLLECTIONS.COMPANY_NOTES).create<CompanyNote>(
                    {
                        company: displayCompanyId,
                        note_type: 'pre_call',
                        content: trimmed,
                        created_by: user.id,
                    },
                    { expand: 'created_by' }
                );
                setPreCallNotes([created]);
            }
            setEditingPreCallNote(false);
            setPreCallNoteDraft('');
        } catch (err) {
            console.error('Failed to save pre-call note:', err);
        } finally {
            setSavingPreCallNote(false);
        }
    }, [displayCompanyId, user, preCallNoteDraft, preCallNotes, mostRecentPreCallNote]);

    // Fetch all calls in session
    const fetchAllCalls = useCallback(async () => {
        if (!sessionId) return;
        try {
            setLoadingCalls(true);
            const calls = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                filter: `session = "${sessionId}"`,
                sort: '-call_time',
                expand: 'company,phone_number_record',
            });
            setAllCalls(calls);
            setShowBrowser(true);
        } catch (err) {
            console.error('Failed to fetch calls:', err);
        } finally {
            setLoadingCalls(false);
        }
    }, [sessionId]);

    // View a specific call from history
    const handleViewCall = useCallback((call: CallLog) => {
        setViewingCall(call);
        setViewingCompanyName(call.expand?.company?.company_name || 'Unknown');
        setShowBrowser(false);
    }, []);

    // Go back to last call
    const handleBackToLastCall = useCallback(() => {
        setViewingCall(null);
        setViewingCompanyName('');
    }, []);

    const handleUpdate = useCallback(async () => {
        if (!displayCall) return;
        try {
            setUpdating(true);
            await pb.collection(COLLECTIONS.CALL_LOGS).update(displayCall.id, {
                post_call_notes: notes,
                owner_reached: ownerReached,
                pitch_completed: pitchCompleted,
                appointment_set: appointmentSet,
                receptionist_name: receptionistName,
                owner_name_found: ownerName,
            });
            setUpdated(true);
            setTimeout(() => {
                setUpdated(false);
                if (isViewingOlderCall) {
                    handleBackToLastCall();
                }
            }, 1000);
        } catch (err) {
            console.error('Failed to update call log:', err);
        } finally {
            setUpdating(false);
        }
    }, [displayCall, notes, ownerReached, pitchCompleted, appointmentSet, receptionistName, ownerName, isViewingOlderCall, handleBackToLastCall]);

    // Recording status pill — find any in-flight or failed upload tied to the
    // displayed call_log. Match by callLogId on the entry, with a fallback that
    // scans the fileName for the agent's `_cl-{callLogId}` rename suffix.
    // Computed unconditionally before the early return to keep hook order stable.
    const callLogIdForStatus = displayCall?.id ?? null;
    const matchesCallLog = (entryCallLogId: string | null | undefined, fileName: string | undefined) => {
        if (!callLogIdForStatus) return false;
        if (entryCallLogId && entryCallLogId === callLogIdForStatus) return true;
        if (fileName && fileName.includes(`_cl-${callLogIdForStatus}`)) return true;
        return false;
    };
    let activeUpload: UploadProgressEntry | null = null;
    if (uploadProgress) {
        for (const entry of uploadProgress.values()) {
            if (matchesCallLog(entry?.callLogId, entry?.fileName)) {
                activeUpload = entry;
                break;
            }
        }
    }
    const failedForCall = failedUploads.find(f => matchesCallLog(f?.callLogId, f?.fileName)) ?? null;
    const isRetrying = retryingFileName !== null
        && (failedForCall?.fileName === retryingFileName || activeUpload?.fileName === retryingFileName);

    // Detect upload completion: when a fileName we previously saw in
    // uploadProgress for this call disappears AND is not in failedUploads,
    // mark it complete. Persisted across the mount in `completedUploads`.
    useEffect(() => {
        if (!callLogIdForStatus) return;
        const seenMap = seenInProgressRef.current;
        if (activeUpload?.fileName) {
            seenMap.set(callLogIdForStatus, activeUpload.fileName);
            return;
        }
        const previouslySeen = seenMap.get(callLogIdForStatus);
        if (!previouslySeen) return;
        const stillFailed = failedUploads.some(f => f?.fileName === previouslySeen);
        if (stillFailed) return;
        seenMap.delete(callLogIdForStatus);
        setCompletedUploads(prev => {
            if (prev.has(previouslySeen)) return prev;
            const next = new Set(prev);
            next.add(previouslySeen);
            return next;
        });
    }, [activeUpload, callLogIdForStatus, failedUploads]);

    const fileNameForCall = activeUpload?.fileName
        ?? failedForCall?.fileName
        ?? seenInProgressRef.current.get(callLogIdForStatus ?? '')
        ?? null;
    const uploadCompleted = fileNameForCall !== null && completedUploads.has(fileNameForCall);

    const recordingPill: { label: string; tone: 'linked' | 'uploading' | 'uploaded' | 'failed' } | null = (() => {
        if (!callLogIdForStatus) return null;
        if (failedForCall && !isRetrying) {
            return { label: 'Failed', tone: 'failed' };
        }
        if (activeUpload) {
            const pct = typeof activeUpload.percent === 'number'
                ? activeUpload.percent
                : (activeUpload.bytesTotal && activeUpload.bytesTotal > 0
                    ? Math.min(100, (activeUpload.bytesSent ?? 0) / activeUpload.bytesTotal * 100)
                    : null);
            const rounded = pct !== null ? Math.round(pct) : null;
            return {
                label: rounded !== null ? `Uploading ${rounded}%` : 'Uploading…',
                tone: 'uploading',
            };
        }
        if (uploadCompleted) {
            return { label: 'Uploaded', tone: 'uploaded' };
        }
        if (displayCall?.has_recording) {
            return { label: 'Linked', tone: 'linked' };
        }
        return null;
    })();

    const handleRetryUpload = () => {
        if (!failedForCall?.fileName) return;
        // Optimistically clear the failed pill — the agent will re-broadcast
        // uploadQueueStatus / uploadProgress shortly with the live state.
        setRetryingFileName(failedForCall.fileName);
        sendCommand({ type: 'uploadRecording', fileName: failedForCall.fileName });
    };

    // Drop the optimistic-retry hint once the matching failed entry clears
    // OR a fresh failure for the same file lands (so the pill can re-appear).
    const stillFailing = retryingFileName !== null
        && failedUploads.some(f => f?.fileName === retryingFileName);
    const stillUploading = retryingFileName !== null
        && uploadProgress !== null
        && Array.from(uploadProgress.values()).some(e => e?.fileName === retryingFileName);
    useEffect(() => {
        if (retryingFileName === null) return;
        if (!stillFailing && !stillUploading) {
            setRetryingFileName(null);
        }
    }, [retryingFileName, stillFailing, stillUploading]);

    if (!displayCall) {
        return (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Last Call
                </h3>
                <p className="text-sm text-[var(--muted)] mt-3">No calls logged yet in this session.</p>
            </div>
        );
    }

    const outcomes = Array.isArray(displayCall.call_outcome) ? displayCall.call_outcome : displayCall.call_outcome ? [displayCall.call_outcome] : [];

    const hasChanged =
        notes !== (displayCall.post_call_notes || '') ||
        ownerReached !== (displayCall.owner_reached || false) ||
        pitchCompleted !== (displayCall.pitch_completed || false) ||
        appointmentSet !== (displayCall.appointment_set || false) ||
        receptionistName !== (displayCall.receptionist_name || '') ||
        ownerName !== (displayCall.owner_name_found || '');

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
            {/* Viewing older call indicator */}
            {isViewingOlderCall && (
                <div className="bg-[var(--warning-subtle)] border-b border-[var(--warning)] px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--warning)]">Viewing Previous Call</span>
                    <button
                        onClick={handleBackToLastCall}
                        className="flex items-center gap-1 text-xs font-medium text-[var(--warning)] hover:underline"
                    >
                        <ArrowLeft size={12} />
                        Back to Last Call
                    </button>
                </div>
            )}

            {/* Header (clickable to toggle) */}
            <div
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-[var(--sidebar-bg)] transition-colors cursor-pointer"
            >
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                        {isViewingOlderCall ? 'Previous Call' : 'Last Call'}
                    </h3>
                    {outcomes.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                            {outcomes.map(oc => {
                                const c = OUTCOME_COLORS[oc] || { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' };
                                return (
                                    <span key={oc} className={cn('px-2 py-0.5 rounded text-xs font-medium', c.bg, c.text)}>
                                        {oc}
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {recordingPill && (
                        <span
                            className={cn(
                                'flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
                                recordingPill.tone === 'linked' && 'bg-[var(--card-hover)] text-[var(--muted)] border-[var(--card-border)]',
                                recordingPill.tone === 'uploading' && 'bg-[var(--info-subtle)] text-[var(--info)] border-[var(--info)]/30',
                                recordingPill.tone === 'uploaded' && 'bg-[var(--success-subtle)] text-[var(--success)] border-[var(--success)]/30',
                                recordingPill.tone === 'failed' && 'bg-[var(--error-subtle)] text-[var(--error)] border-[var(--error)]/30',
                            )}
                            title={recordingPill.label}
                        >
                            {recordingPill.tone === 'linked' && <LinkIcon size={10} />}
                            {recordingPill.tone === 'uploading' && <Loader2 size={10} className="animate-spin" />}
                            {recordingPill.tone === 'uploaded' && <CheckCircle2 size={10} />}
                            {recordingPill.tone === 'failed' && <AlertTriangle size={10} />}
                            <span>{recordingPill.label}</span>
                        </span>
                    )}
                    {recordingPill?.tone === 'failed' && failedForCall?.fileName && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRetryUpload();
                            }}
                            disabled={isRetrying}
                            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--error-subtle)] text-[var(--error)] border border-[var(--error)]/30 hover:bg-[var(--error)]/15 transition-colors disabled:opacity-60"
                            title="Retry upload"
                        >
                            <Upload size={10} />
                            <span>Retry</span>
                        </button>
                    )}
                    {displayCall.has_recording && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handlePlayRecording();
                            }}
                            disabled={playerLoading}
                            className="p-1.5 rounded-lg text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors disabled:opacity-60"
                            title="Play recording"
                        >
                            {playerLoading ? <Loader2 size={14} className="animate-spin" /> : <Headphones size={14} />}
                        </button>
                    )}
                    {sessionId && !isViewingOlderCall && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                fetchAllCalls();
                            }}
                            className="p-1.5 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                            title="View all calls in session"
                            disabled={loadingCalls}
                        >
                            <History size={14} />
                        </button>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-[var(--muted)]" /> : <ChevronDown size={16} className="text-[var(--muted)]" />}
                </div>
            </div>

            <RecordingPlayerOverlay
                recording={playerRecording}
                onClose={() => setPlayerRecording(null)}
            />

            {/* Content */}
            {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--card-border)]">
                    {/* Company + Phone */}
                    <div className="space-y-1.5 pt-3">
                        <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-[var(--muted)]" />
                            <span className="text-sm font-medium">{displayCompany || 'Unknown Company'}</span>
                            {displayCall.expand?.phone_number_record?.phone_number && (
                                <PhoneHoverCard phoneRecord={displayCall.expand.phone_number_record} side="bottom">
                                  <span className="text-xs font-light text-[var(--muted)] font-mono cursor-default">
                                      {displayCall.expand.phone_number_record.phone_number}
                                  </span>
                                </PhoneHoverCard>
                            )}
                        </div>
                        
                        <div className="space-y-2 ml-1 pl-1 border-l border-[var(--card-border)]">
                            <div className="flex items-center gap-2">
                                <User size={12} className="text-[var(--muted)] shrink-0" />
                                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                                    <span className="text-[10px] text-[var(--muted)] uppercase font-semibold shrink-0">Recep</span>
                                    <input
                                        type="text"
                                        value={receptionistName}
                                        onChange={e => setReceptionistName(e.target.value)}
                                        className="flex-1 bg-transparent border-b border-transparent hover:border-[var(--card-border)] focus:border-[var(--primary)] focus:outline-none text-xs text-[var(--foreground)]/80 py-0.5 transition-colors min-w-0"
                                        placeholder="None"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Crown size={12} className="text-[var(--muted)] shrink-0" />
                                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                                    <span className="text-[10px] text-[var(--muted)] uppercase font-semibold shrink-0">Owner</span>
                                    <input
                                        type="text"
                                        value={ownerName}
                                        onChange={e => setOwnerName(e.target.value)}
                                        className="flex-1 bg-transparent border-b border-transparent hover:border-[var(--card-border)] focus:border-[var(--primary)] focus:outline-none text-xs text-[var(--foreground)]/80 py-0.5 transition-colors min-w-0"
                                        placeholder="None"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Performance tracking checkboxes */}
                    <div className="space-y-2 pt-1">
                        <label className="text-xs text-[var(--muted)] mb-1 block">Performance</label>
                        <div className="flex flex-col gap-1.5">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={ownerReached}
                                    onChange={e => setOwnerReached(e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--success)] checked:border-[var(--success)] transition-colors"
                                />
                                <span className="text-xs group-hover:text-[var(--foreground)] transition-colors">Owner Reached</span>
                                {ownerReached && <Check size={12} className="text-[var(--success)]" />}
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={pitchCompleted}
                                    onChange={e => setPitchCompleted(e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--success)] checked:border-[var(--success)] transition-colors"
                                />
                                <span className="text-xs group-hover:text-[var(--foreground)] transition-colors">Pitch Completed</span>
                                {pitchCompleted && <Check size={12} className="text-[var(--success)]" />}
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={appointmentSet}
                                    onChange={e => setAppointmentSet(e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--success)] checked:border-[var(--success)] transition-colors"
                                />
                                <span className="text-xs group-hover:text-[var(--foreground)] transition-colors">Warm Lead</span>
                                {appointmentSet && <Check size={12} className="text-[var(--success)]" />}
                            </label>
                        </div>
                    </div>

                    {/* Pre-call note (company-level, editable inline) */}
                    <div>
                        <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
                            <StickyNote size={10} />
                            <span>Pre-Call Note</span>
                        </label>
                        {preCallNotesLoading ? (
                            <div className="px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-xs text-[var(--muted)]">
                                Loading…
                            </div>
                        ) : editingPreCallNote ? (
                            <div className="space-y-1.5">
                                <textarea
                                    value={preCallNoteDraft}
                                    onChange={e => setPreCallNoteDraft(e.target.value)}
                                    autoFocus
                                    rows={2}
                                    placeholder="Add a pre-call note for this company…"
                                    className="w-full px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors resize-none"
                                />
                                <div className="flex items-center justify-end gap-1.5">
                                    <button
                                        type="button"
                                        onClick={handleCancelEditPreCallNote}
                                        disabled={savingPreCallNote}
                                        className="px-2 py-1 rounded-md text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSavePreCallNote}
                                        disabled={savingPreCallNote}
                                        className="px-2 py-1 rounded-md text-[10px] font-semibold bg-[var(--primary)] text-white hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center gap-1"
                                    >
                                        {savingPreCallNote && <Loader2 size={10} className="animate-spin" />}
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handleStartEditPreCallNote}
                                className="w-full px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm text-left hover:bg-[var(--card-hover)] transition-colors group flex items-start gap-1.5"
                                title={combinedPreCallNote ? 'Click to edit pre-call note' : 'Click to add a pre-call note'}
                            >
                                <span className="flex-1 min-w-0">
                                    {combinedPreCallNote ? (
                                        <span className="text-[var(--foreground)]/80 whitespace-pre-wrap break-words">{combinedPreCallNote}</span>
                                    ) : (
                                        <span className="text-[var(--muted)] italic">None</span>
                                    )}
                                </span>
                                <Pencil size={11} className="shrink-0 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                            </button>
                        )}
                    </div>

                    {/* Editable post-call notes */}
                    <div>
                        <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
                            <StickyNote size={10} />
                            <span>Post-Call Notes</span>
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={2}
                            className="w-full px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors resize-none"
                            placeholder="Add notes..."
                        />
                    </div>

                    {/* Update button */}
                    <button
                        onClick={handleUpdate}
                        disabled={updating || !hasChanged}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all',
                            updated
                                ? 'bg-[var(--success-subtle)] text-[var(--success)]'
                                : 'bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                    >
                        <RotateCcw size={12} />
                        {updated ? 'Updated!' : updating ? 'Updating...' : isViewingOlderCall ? 'Save & Back to Last Call' : 'Update Call'}
                    </button>
                </div>
            )}

            {/* Call browser modal */}
            {showBrowser && (
                <div className="border-t border-[var(--card-border)] bg-[var(--sidebar-bg)] p-4 max-h-[300px] overflow-y-auto">
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                            All Calls ({allCalls.length})
                        </h4>
                        <button
                            onClick={() => setShowBrowser(false)}
                            className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                            Close
                        </button>
                    </div>
                    <div className="space-y-2">
                        {allCalls.map((call, idx) => (
                            <button
                                key={call.id}
                                onClick={() => handleViewCall(call)}
                                className="w-full text-left p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors border border-[var(--card-border)]"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium">
                                        {call.expand?.company?.company_name || 'Unknown'}
                                    </span>
                                    <div className="flex gap-1 flex-wrap">
                                        {(Array.isArray(call.call_outcome) ? call.call_outcome : call.call_outcome ? [call.call_outcome] : []).map(oc => (
                                            <span key={oc} className={cn(
                                                'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                                                OUTCOME_COLORS[oc]?.bg || 'bg-[var(--card-hover)]',
                                                OUTCOME_COLORS[oc]?.text || 'text-[var(--muted)]'
                                            )}>
                                                {oc}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="text-[10px] text-[var(--muted)]">
                                    {new Date(call.call_time).toLocaleString()}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
