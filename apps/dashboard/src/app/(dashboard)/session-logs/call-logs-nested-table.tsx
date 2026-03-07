'use client';

import { useEffect, useState, useRef } from 'react';
import { Mic, ExternalLink, Trash2, CheckSquare, Loader2, PhoneIncoming, PhoneOutgoing, X, Download } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Recording } from '@/lib/types';
import Link from 'next/link';
import { useAdminModeOptional } from '@/contexts/admin-mode-context';
import { cn } from '@/lib/utils';

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
    const [loading, setLoading] = useState(true);
    const [stagingIds, setStagingIds] = useState<Set<string>>(new Set());
    const [playerRecording, setPlayerRecording] = useState<Recording | null>(null);
    const [playerLoading, setPlayerLoading] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    const adminMode = useAdminModeOptional();
    const isAdminMode = adminMode?.isAdminMode ?? false;

    const handlePlayRecording = async (log: CallLog) => {
        if (playerLoading === log.id) return;
        setPlayerLoading(log.id);
        try {
            const recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                `call_log = "${log.id}"`
            );
            setPlayerRecording(recording);
        } catch {
            // No linked recording found — fall back to recordings page
            window.open(`/recordings?call_log=${log.id}`, '_blank');
        } finally {
            setPlayerLoading(null);
        }
    };

    const closePlayer = () => {
        audioRef.current?.pause();
        setPlayerRecording(null);
    };

    useEffect(() => {
        const fetchCallLogs = async () => {
            try {
                const logs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                    filter: `session = "${sessionId}"`,
                    sort: '-call_time',
                    expand: 'company,phone_number_record',
                });
                setCallLogs(logs);
                onLogsLoaded?.(logs.length);
            } catch (err) {
                console.error('Failed to fetch call logs:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchCallLogs();
    }, [sessionId, onLogsLoaded]);

    const isStagedForDeletion = (logId: string) =>
        isAdminMode && adminMode?.pendingDeletions.some(
            d => d.targetId === logId && d.type === 'call_log'
        );

    const handleStageCallLog = async (log: CallLog) => {
        if (!adminMode || stagingIds.has(log.id) || isStagedForDeletion(log.id)) return;
        setStagingIds(prev => new Set([...prev, log.id]));
        try {
            adminMode.addStagedDeletion({
                type: 'call_log',
                targetId: log.id,
                targetLabel: `Call log – ${Array.isArray(log.call_outcome) ? log.call_outcome.join(', ') : log.call_outcome || 'Unknown'} at ${new Date(log.call_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
                associatedCallLogIds: [log.id],
                deleteRecordings: false,
                hasRecordings: log.has_recording || false,
            });
            setCallLogs(prev => prev.filter(l => l.id !== log.id));
        } finally {
            setStagingIds(prev => {
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

    if (callLogs.length === 0) {
        return (
            <div className="text-center py-8 text-[var(--muted)] text-sm">
                No calls recorded in this session
            </div>
        );
    }

    return (
        <>
        {playerRecording && (
            <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/40 backdrop-blur-sm" onClick={closePlayer}>
                <div
                    className="w-full max-w-md bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl p-4 space-y-3"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <Mic size={16} className="text-[var(--primary)] shrink-0" />
                            <span className="text-sm font-medium truncate">
                                {playerRecording.note || playerRecording.original_filename || 'Call Recording'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {playerRecording.file && (
                                <a
                                    href={pb.files.getUrl(playerRecording, playerRecording.file)}
                                    download
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                                    title="Download"
                                >
                                    <Download size={15} />
                                </a>
                            )}
                            <button
                                onClick={closePlayer}
                                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                                title="Close"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </div>
                    {playerRecording.file ? (
                        <audio
                            ref={audioRef}
                            controls
                            autoPlay
                            preload="metadata"
                            className="w-full h-10"
                            src={pb.files.getUrl(playerRecording, playerRecording.file)}
                            onEnded={closePlayer}
                        />
                    ) : (
                        <p className="text-sm text-[var(--muted)] text-center py-2">No audio file attached.</p>
                    )}
                </div>
            </div>
        )}
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
                        {isAdminMode && (
                            <th className="text-center px-4 py-2 font-medium text-[var(--muted)]">Del</th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {callLogs.map((log) => {
                        const isStaged = isStagedForDeletion(log.id);
                        const isStaging = stagingIds.has(log.id);
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
                                    {log.expand?.phone_number_record?.phone_number || '-'}
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
                                {isAdminMode && (
                                    <td className="px-4 py-3 text-center">
                                        {isStaged ? (
                                            <div className="p-1.5 rounded-lg text-green-400 inline-flex" title="Staged for deletion">
                                                <CheckSquare size={14} />
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => handleStageCallLog(log)}
                                                disabled={isStaging}
                                                className={cn(
                                                    "p-1.5 rounded-lg transition-all duration-150 inline-flex",
                                                    isStaging
                                                        ? "text-red-400 opacity-60"
                                                        : "text-red-400/60 hover:bg-red-500/10 hover:text-red-400 hover:scale-110"
                                                )}
                                                title="Stage for deletion"
                                            >
                                                {isStaging
                                                    ? <Loader2 size={14} className="animate-spin" />
                                                    : <Trash2 size={14} />
                                                }
                                            </button>
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
        </>
    );
}
