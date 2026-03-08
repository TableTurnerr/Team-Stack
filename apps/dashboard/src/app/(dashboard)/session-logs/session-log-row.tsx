'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChevronDown, ChevronRight, Clock, User, Trash2, CheckSquare, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type Recording, type FollowUp } from '@/lib/types';
import { PerformanceCounterInline } from '@/components/performance-counter-inline';
import { CallLogsNestedTable } from './call-logs-nested-table';
import { InlineEditField } from '@/components/inline-edit-field';
import { useAdminModeOptional } from '@/contexts/admin-mode-context';
import { cn } from '@/lib/utils';

import { Tooltip } from '@/components/ui/tooltip';

interface SessionLogRowProps {
    session: ColdCallingSession;
    onUpdate: (session: ColdCallingSession) => void;
    onDelete?: (id: string) => void;
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) {
        return `${h}h ${m}m`;
    }
    return `${m}m`;
}

function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function SessionLogRow({ session, onUpdate, onDelete }: SessionLogRowProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isTrashHovered, setIsTrashHovered] = useState(false);
    const [isStagingSession, setIsStagingSession] = useState(false);
    const [actualCallCount, setActualCallCount] = useState<number | null>(null);

    // Test session deletion state
    const [confirmTestDelete, setConfirmTestDelete] = useState(false);
    const [isDeletingTest, setIsDeletingTest] = useState(false);
    const [testDeleteError, setTestDeleteError] = useState(false);

    const adminMode = useAdminModeOptional();
    const isAdminMode = adminMode?.isAdminMode ?? false;

    const isStagedForDeletion = isAdminMode && adminMode?.pendingDeletions.some(
        d => d.targetId === session.id && d.type === 'session'
    );

    const pickupRate = session.total_dials > 0
        ? Math.round((session.total_pickups / session.total_dials) * 100)
        : 0;

    const handleUpdateCounter = async (
        field: 'owner_reached' | 'pitch_completed' | 'appointment_set',
        value: number
    ) => {
        try {
            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                session.id,
                { [field]: value }
            );
            onUpdate(updatedSession);
        } catch (err) {
            console.error('Failed to update session:', err);
            throw err;
        }
    };

    const handleUpdateNotes = async (notes: string) => {
        try {
            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                session.id,
                { session_notes: notes }
            );
            onUpdate(updatedSession);
        } catch (err) {
            console.error('Failed to update session notes:', err);
            throw err;
        }
    };

    const handleDirectStage = async () => {
        if (!adminMode || isStagedForDeletion) return;
        setIsStagingSession(true);
        try {
            const logs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                filter: `session = "${session.id}"`,
                sort: '-call_time',
            });
            adminMode.addStagedDeletion({
                type: 'session',
                targetId: session.id,
                targetLabel: sessionLabel,
                associatedCallLogIds: logs.map(l => l.id),
                deleteRecordings: false,
                hasRecordings: logs.some(l => l.has_recording),
            });
            onDelete?.(session.id);
        } catch (err) {
            console.error('Failed to stage session deletion:', err);
        } finally {
            setIsStagingSession(false);
        }
    };

    const handleDeleteTestSession = async () => {
        setIsDeletingTest(true);
        setTestDeleteError(false);
        try {
            // 1. Get all call logs for this session
            const callLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                filter: `session = "${session.id}"`,
            });
            const callLogIds = callLogs.map(l => l.id);

            // 2. Delete recordings linked to those call logs
            if (callLogIds.length > 0) {
                const recordings = await pb.collection(COLLECTIONS.RECORDINGS).getFullList<Recording>({
                    filter: callLogIds.map(id => `call_log = "${id}"`).join(' || '),
                });
                await Promise.allSettled(recordings.map(r => pb.collection(COLLECTIONS.RECORDINGS).delete(r.id)));
            }

            // 3. Delete follow-ups linked to those call logs
            if (callLogIds.length > 0) {
                const followUps = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
                    filter: callLogIds.map(id => `call_log = "${id}"`).join(' || '),
                });
                await Promise.allSettled(followUps.map(f => pb.collection(COLLECTIONS.FOLLOW_UPS).delete(f.id)));
            }

            // 4. Delete all call logs
            await Promise.allSettled(callLogs.map(l => pb.collection(COLLECTIONS.CALL_LOGS).delete(l.id)));

            // 5. Delete the session record
            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).delete(session.id);

            onDelete?.(session.id);
        } catch (err) {
            console.error('Failed to delete test session:', err);
            setTestDeleteError(true);
            setIsDeletingTest(false);
            setConfirmTestDelete(false);
        }
    };

    const sessionLabel = formatDateTime(session.started_at);

    return (
        <>
            <tr className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors">
                <td className="px-4 py-3">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-1 hover:bg-[var(--card-bg)] rounded transition-colors"
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                        {isExpanded ? (
                            <ChevronDown size={16} className="text-[var(--muted)]" />
                        ) : (
                            <ChevronRight size={16} className="text-[var(--muted)]" />
                        )}
                    </button>
                </td>
                <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{formatDateTime(session.started_at)}</span>
                            {session.is_test && (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30 tracking-wide">
                                    TEST
                                </span>
                            )}
                        </div>
                        <span className="text-xs text-[var(--muted)]">
                            {session.ended_at ? `Ended: ${formatDateTime(session.ended_at)}` : 'Active'}
                        </span>
                        {testDeleteError && (
                            <span className="text-[10px] text-[var(--error)]">Delete failed — try again</span>
                        )}
                    </div>
                </td>
                <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-sm">
                        <Clock size={14} className="text-[var(--muted)]" />
                        <span>{formatDuration(session.total_duration_sec || 0)}</span>
                    </div>
                </td>
                <td className="px-4 py-3 text-center">
                    <span className="font-medium tabular-nums">{session.total_dials || 0}</span>
                </td>
                <td className="px-4 py-3 text-center">
                    <span className="font-medium tabular-nums">{session.total_pickups || 0}</span>
                </td>
                <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-[var(--muted)]/10 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-[var(--success)] transition-all"
                                style={{ width: `${pickupRate}%` }}
                            />
                        </div>
                        <span className="text-sm font-medium tabular-nums w-10 text-right">
                            {pickupRate}%
                        </span>
                    </div>
                </td>
                <td className="px-4 py-3 text-center">
                    <PerformanceCounterInline
                        value={session.owner_reached || 0}
                        onSave={(value) => handleUpdateCounter('owner_reached', value)}
                        label="Owner Reached"
                    />
                </td>
                <td className="px-4 py-3 text-center">
                    <PerformanceCounterInline
                        value={session.pitch_completed || 0}
                        onSave={(value) => handleUpdateCounter('pitch_completed', value)}
                        label="Pitch Completed"
                    />
                </td>
                <td className="px-4 py-3 text-center">
                    <PerformanceCounterInline
                        value={session.appointment_set || 0}
                        onSave={(value) => handleUpdateCounter('appointment_set', value)}
                        label="Appointment Set"
                    />
                </td>
                <td className="px-4 py-3">
                    {session.expand?.user ? (
                        <Tooltip content={session.expand.user.name}>
                            <div className="flex items-center w-fit cursor-help">
                                {session.expand.user.avatar ? (
                                    <div className="w-6 h-6 rounded-full overflow-hidden border border-[var(--card-border)] bg-[var(--sidebar-bg)] relative">
                                        <Image
                                            src={pb.files.getUrl(session.expand.user, session.expand.user.avatar, { thumb: '64x64' })}
                                            alt={session.expand.user.name}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                ) : (
                                    <div className="w-6 h-6 rounded-full bg-[var(--muted)]/20 flex items-center justify-center border border-[var(--card-border)]">
                                        <User size={12} className="text-[var(--muted)]" />
                                    </div>
                                )}
                            </div>
                        </Tooltip>
                    ) : (
                        <span className="text-[var(--muted)] text-sm">-</span>
                    )}
                </td>
                <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                        session.status === 'active'
                            ? 'bg-[var(--success-subtle)] text-[var(--success)]'
                            : 'bg-[var(--muted)]/20 text-[var(--muted)]'
                    }`}>
                        {session.status === 'active' ? 'Active' : 'Completed'}
                    </span>
                </td>
                <td className="px-4 py-3">
                    {session.is_test ? (
                        /* Test session delete button — available to all users */
                        confirmTestDelete ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleDeleteTestSession}
                                    disabled={isDeletingTest}
                                    className="px-2 py-1 rounded text-[10px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-1"
                                    title="Confirm delete"
                                >
                                    {isDeletingTest ? <Loader2 size={10} className="animate-spin" /> : null}
                                    {isDeletingTest ? 'Deleting...' : 'Confirm'}
                                </button>
                                {!isDeletingTest && (
                                    <button
                                        onClick={() => setConfirmTestDelete(false)}
                                        className="px-2 py-1 rounded text-[10px] font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmTestDelete(true)}
                                className="p-1.5 rounded-lg text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150"
                                title="Delete all test session data"
                            >
                                <Trash2 size={15} />
                            </button>
                        )
                    ) : isAdminMode ? (
                        /* Admin staging delete for normal sessions */
                        isStagedForDeletion ? (
                            <div className="p-1.5 rounded-lg text-green-400" title="Staged for deletion">
                                <CheckSquare size={15} />
                            </div>
                        ) : (
                            <button
                                onClick={handleDirectStage}
                                disabled={isStagingSession}
                                onMouseEnter={() => setIsTrashHovered(true)}
                                onMouseLeave={() => setIsTrashHovered(false)}
                                className={cn(
                                    "p-1.5 rounded-lg transition-all duration-150",
                                    isStagingSession
                                        ? "text-red-400 opacity-60"
                                        : isTrashHovered
                                            ? "text-red-400 bg-red-500/15 scale-110"
                                            : "text-red-400/60 hover:bg-red-500/10 hover:text-red-400"
                                )}
                                title="Stage for permanent deletion"
                            >
                                {isStagingSession
                                    ? <Loader2 size={15} className="animate-spin" />
                                    : isTrashHovered
                                        ? <CheckSquare size={15} />
                                        : <Trash2 size={15} />
                                }
                            </button>
                        )
                    ) : null}
                </td>
            </tr>

            {/* Expanded row showing call logs and notes */}
            {isExpanded && (
                <tr>
                    <td colSpan={12} className="p-0">
                        <div className="bg-[var(--card-bg)] border-t border-b border-[var(--card-border)]">
                            {/* Session Notes */}
                            <div className="px-6 py-4 border-b border-[var(--card-border)]">
                                <h4 className="text-sm font-medium mb-2">Session Notes</h4>
                                <InlineEditField
                                    value={session.session_notes || ''}
                                    onSave={handleUpdateNotes}
                                    label="Session Notes"
                                    id={`session-notes-${session.id}`}
                                    type="textarea"
                                    placeholder="Add notes about this session..."
                                />
                            </div>

                            {/* Call Logs Table */}
                            <div className="px-6 py-4">
                                <h4 className="text-sm font-medium mb-3">
                                    Call Logs ({actualCallCount !== null ? actualCallCount : session.total_dials || 0} logged
                                    {actualCallCount !== null && actualCallCount !== (session.total_dials || 0) && (
                                        <span className="text-[var(--muted)] font-normal"> / {session.total_dials || 0} dialed</span>
                                    )})
                                </h4>
                                <CallLogsNestedTable sessionId={session.id} onLogsLoaded={setActualCallCount} />
                            </div>
                        </div>
                    </td>
                </tr>
            )}

        </>
    );
}
