'use client';

import { useEffect, useState, useRef } from 'react';
import { Mic, ExternalLink, Trash2, Loader2, PhoneIncoming, PhoneOutgoing, X, Download, Minimize2, Maximize2, Pause, Play, SlidersHorizontal } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Recording, type ColdCallingSession, type ManualAdjustment } from '@/lib/types';
import Link from 'next/link';
import { useRecycleBinOptional } from '@/contexts/recycle-bin-context';
import { useAuth } from '@/contexts/auth-context';
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
    const [manualAdjustments, setManualAdjustments] = useState<ManualAdjustment[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const [playerRecording, setPlayerRecording] = useState<Recording | null>(null);
    const [playerLoading, setPlayerLoading] = useState<string | null>(null);
    const [playerMinimized, setPlayerMinimized] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isHoveringMic, setIsHoveringMic] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);

    const recycleBin = useRecycleBinOptional();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const handlePlayRecording = async (log: CallLog) => {
        if (playerLoading === log.id) return;
        setPlayerLoading(log.id);
        try {
            const recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                `call_log = "${log.id}"`
            );
            setPlayerRecording(recording);
            setPlayerMinimized(false);
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
        setPlayerMinimized(false);
        setIsPlaying(false);
    };

    const togglePlayback = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
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
        {playerRecording && (
            <div
                className={cn(
                    "fixed z-50 transition-all duration-300",
                    playerMinimized
                        ? "bottom-4 right-4 w-auto"
                        : "inset-0 flex items-end justify-center sm:items-center p-4 bg-black/40 backdrop-blur-sm"
                )}
                onClick={!playerMinimized ? closePlayer : undefined}
            >
                <div
                    className={cn(
                        "bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl transition-all duration-300 overflow-hidden",
                        playerMinimized
                            ? "w-64 p-3 flex flex-col gap-2"
                            : "w-full max-w-md p-4 space-y-3"
                    )}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            {playerMinimized ? (
                                <button
                                    onClick={togglePlayback}
                                    onMouseEnter={() => setIsHoveringMic(true)}
                                    onMouseLeave={() => setIsHoveringMic(false)}
                                    className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all",
                                        isPlaying ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "bg-[var(--warning-subtle)] text-[var(--warning)]"
                                    )}
                                >
                                    {isPlaying ? (
                                        isHoveringMic ? (
                                            <Pause size={16} fill="currentColor" />
                                        ) : (
                                            <Mic size={16} className="animate-pulse" />
                                        )
                                    ) : (
                                        <Play size={16} fill="currentColor" className="ml-0.5" />
                                    )}
                                </button>
                            ) : (
                                <div className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                                    isPlaying ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "bg-[var(--card-hover)] text-[var(--muted)]"
                                )}>
                                    <Mic size={16} />
                                </div>
                            )}
                            <div className="flex flex-col min-w-0">
                                {playerMinimized ? (
                                    <span className="text-xs font-medium truncate text-[var(--foreground)]">
                                        {playerRecording.note || playerRecording.original_filename || 'Call Recording'}
                                    </span>
                                ) : (
                                    <>
                                        <span className={cn(
                                            "text-[10px] font-bold uppercase tracking-widest leading-none mb-1",
                                            isPlaying ? "text-[var(--primary)]" : "text-[var(--muted)]"
                                        )}>
                                            {isPlaying ? 'Playing' : 'Paused'}
                                        </span>
                                        <span className="text-sm font-medium truncate">
                                            {playerRecording.note || playerRecording.original_filename || 'Call Recording'}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {!playerMinimized && playerRecording.file && (
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
                                onClick={() => setPlayerMinimized(!playerMinimized)}
                                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                                title={playerMinimized ? "Expand" : "Minimize"}
                            >
                                {playerMinimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
                            </button>
                            <button
                                onClick={closePlayer}
                                className={cn(
                                    "p-1.5 rounded-lg text-[var(--muted)] transition-colors",
                                    playerMinimized ? "hover:text-[var(--error)] hover:bg-[var(--error)]/5" : "hover:text-[var(--foreground)] hover:bg-[var(--card-hover)]"
                                )}
                                title="Close"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </div>
                    {playerRecording.file ? (
                        <audio
                            ref={audioRef}
                            controls={!playerMinimized}
                            autoPlay
                            preload="metadata"
                            className={cn(
                                "w-full h-10 transition-all",
                                playerMinimized ? "h-0 opacity-0 pointer-events-none" : "h-10 opacity-100"
                            )}
                            src={pb.files.getUrl(playerRecording, playerRecording.file)}
                            onEnded={closePlayer}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                        />
                    ) : !playerMinimized && (
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
