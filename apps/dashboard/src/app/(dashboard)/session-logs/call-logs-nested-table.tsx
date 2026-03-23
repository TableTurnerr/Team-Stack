'use client';

import { useEffect, useState } from 'react';
import { Mic, ExternalLink, Trash2, Loader2, PhoneIncoming, PhoneOutgoing, SlidersHorizontal } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Recording, type ColdCallingSession, type ManualAdjustment } from '@/lib/types';
import Link from 'next/link';
import { useRecycleBinOptional } from '@/contexts/recycle-bin-context';
import { useAuth } from '@/contexts/auth-context';
import { formatPhoneNumber } from '@/lib/utils';
import { RecordingPlayerOverlay } from '@/components/recording-player-overlay';

interface CallLogsNestedTableProps {
    sessionId: string;
    onLogsLoaded?: (count: number) => void;
}

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
    'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
    'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
    'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
    'No Answer': { bg: 'bg-[var(--muted)]/20', text: 'text-[var(--muted)]' },
    'Fumbled': { bg: 'bg-orange-500/10', text: 'text-orange-500' },
    'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
    'Missed Call': { bg: 'bg-purple-500/10', text: 'text-purple-400' },
};

export function CallLogsNestedTable({ sessionId, onLogsLoaded }: CallLogsNestedTableProps) {
    const [callLogs, setCallLogs] = useState<CallLog[]>([]);
    const [manualAdjustments, setManualAdjustments] = useState<ManualAdjustment[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [playerRecording, setPlayerRecording] = useState<Recording | null>(null);
    const [playerLoading, setPlayerLoading] = useState<string | null>(null);

    const recycleBin = useRecycleBinOptional();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const handlePlayRecording = async (log: CallLog) => {
        if (playerLoading === log.id) return;
        setPlayerLoading(log.id);
        try {
            // Try by call_log link first
            const recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                `call_log = "${log.id}"`
            );
            setPlayerRecording(recording);
        } catch {
            // Fallback: try matching by phone number (for agent-mode recordings uploaded before linking)
            try {
                const phoneNumber = log.expand?.phone_number_record?.phone_number;
                if (phoneNumber) {
                    const last10 = phoneNumber.replace(/\D/g, '').slice(-10);
                    const recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                        `phone_number ~ "${last10}"`,
                        { sort: '-recording_date' }
                    );
                    setPlayerRecording(recording);
                }
            } catch {
                // No recording found at all
            }
        } finally {
            setPlayerLoading(null);
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [logs, sessionRecord] = await Promise.all([
                    pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                        filter: `session = "${sessionId}"`,
                        sort: '-call_time',
                        expand: 'company,phone_number_record',
                    }),
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getOne<ColdCallingSession>(sessionId).catch(() => null),
                ]);
                setCallLogs(logs);
                onLogsLoaded?.(logs.length);
                if (sessionRecord?.manual_adjustments && Array.isArray(sessionRecord.manual_adjustments)) {
                    setManualAdjustments(sessionRecord.manual_adjustments);
                }
            } catch (err) {
                console.error('Failed to fetch call logs:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [sessionId, onLogsLoaded]);

    const handleDeleteCallLog = async (log: CallLog) => {
        if (!recycleBin || deletingIds.has(log.id)) return;
        setDeletingIds(prev => new Set([...prev, log.id]));
        try {
            await recycleBin.moveToTrash({
                itemType: 'call_log',
                originalId: log.id,
                itemLabel: `Call log – ${Array.isArray(log.call_outcome) ? log.call_outcome.join(', ') : log.call_outcome || 'Unknown'} at ${new Date(log.call_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
                itemData: log as unknown as Record<string, unknown>,
            });
            setCallLogs(prev => prev.filter(l => l.id !== log.id));
        } catch (err) {
            console.error('Failed to delete call log:', err);
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev);
                next.delete(log.id);
                return next;
            });
        }
    };

    if (loading) {
        return (
            <div className="text-center py-8 text-[var(--muted)] text-sm">
                Loading call logs...
            </div>
        );
    }

    if (callLogs.length === 0 && manualAdjustments.length === 0) {
        return (
            <div className="text-center py-8 text-[var(--muted)] text-sm">
                No calls recorded in this session
            </div>
        );
    }

    return (
        <>
        <RecordingPlayerOverlay
            recording={playerRecording}
            onClose={() => setPlayerRecording(null)}
        />
        <div className="overflow-x-auto bg-[var(--sidebar-bg)] border-t border-[var(--card-border)]">
            <table className="w-full text-sm">
                <thead className="bg-[var(--card-bg)] border-b border-[var(--card-border)]">
                    <tr>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Time</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Company</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Phone</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Direction</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Outcome</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Notes</th>
                        <th className="text-center px-4 py-2 font-medium text-[var(--muted)]">Recording</th>
                        {isAdmin && (
                            <th className="text-center px-4 py-2 font-medium text-[var(--muted)]">Del</th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {callLogs.map((log) => {
                        const isDeletingLog = deletingIds.has(log.id);
                        return (
                            <tr key={log.id} className="border-b border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors">
                                <td className="px-4 py-3 text-xs text-[var(--muted)] whitespace-nowrap">
                                    {new Date(log.call_time).toLocaleTimeString('en-US', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </td>
                                <td className="px-4 py-3">
                                    {log.expand?.company ? (
                                        <Link
                                            href={`/companies/${log.company}`}
                                            className="font-medium hover:text-[var(--primary)] transition-colors flex items-center gap-1"
                                        >
                                            {log.expand.company.company_name}
                                            <ExternalLink size={12} className="opacity-50" />
                                        </Link>
                                    ) : (
                                        <span className="text-[var(--muted)]">Unknown</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">
                                    {log.expand?.phone_number_record?.phone_number ? formatPhoneNumber(log.expand.phone_number_record.phone_number) : '-'}
                                </td>
                                <td className="px-4 py-3">
                                    {log.direction === 'inbound' ? (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
                                            <PhoneIncoming size={11} />
                                            Inbound
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
                                            <PhoneOutgoing size={11} />
                                            Outbound
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    {log.call_outcome && (Array.isArray(log.call_outcome) ? log.call_outcome : [log.call_outcome]).length > 0 ? (
                                        <div className="flex gap-1 flex-wrap">
                                            {(Array.isArray(log.call_outcome) ? log.call_outcome : [log.call_outcome]).map(oc => (
                                                <span key={oc} className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${OUTCOME_COLORS[oc]?.bg || 'bg-[var(--muted)]/20'} ${OUTCOME_COLORS[oc]?.text || 'text-[var(--muted)]'}`}>
                                                    {oc}
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-[var(--muted)] text-xs">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 max-w-xs">
                                    {log.post_call_notes ? (
                                        <p className="text-xs text-[var(--muted)] truncate" title={log.post_call_notes}>
                                            {log.post_call_notes}
                                        </p>
                                    ) : (
                                        <span className="text-[var(--muted)] text-xs">-</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    {log.has_recording ? (
                                        <button
                                            onClick={() => handlePlayRecording(log)}
                                            disabled={playerLoading === log.id}
                                            className="inline-flex items-center justify-center p-1.5 rounded-lg text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-colors disabled:opacity-60"
                                            title="Play recording"
                                        >
                                            {playerLoading === log.id
                                                ? <Loader2 size={14} className="animate-spin" />
                                                : <Mic size={14} />
                                            }
                                        </button>
                                    ) : (
                                        <span className="text-[var(--muted)] text-xs">-</span>
                                    )}
                                </td>
                                {isAdmin && (
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            onClick={() => handleDeleteCallLog(log)}
                                            disabled={isDeletingLog}
                                            className="p-1.5 rounded-lg text-red-400/60 hover:bg-red-500/10 hover:text-red-400 hover:scale-110 transition-all duration-150 inline-flex disabled:opacity-50"
                                            title="Delete call log"
                                        >
                                            {isDeletingLog
                                                ? <Loader2 size={14} className="animate-spin" />
                                                : <Trash2 size={14} />
                                            }
                                        </button>
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                    {manualAdjustments.map((adj, idx) => (
                        <tr key={`adj-${idx}`} className="border-b border-[var(--card-border)] bg-[var(--info-subtle)]/30">
                            <td className="px-4 py-3 text-xs text-[var(--muted)] whitespace-nowrap">
                                {new Date(adj.timestamp).toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </td>
                            <td colSpan={isAdmin ? 7 : 6} className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold bg-[var(--info-subtle)] text-[var(--info)]">
                                        <SlidersHorizontal size={11} />
                                        Manual Adjustment
                                    </span>
                                    <span className="text-xs text-[var(--muted)]">
                                        {adj.changes.map(c => `${c.field}: ${c.from} → ${c.to}`).join(', ')}
                                    </span>
                                    {adj.reason && (
                                        <span className="text-xs text-[var(--muted)] italic ml-1">
                                            — {adj.reason}
                                        </span>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        </>
    );
}
