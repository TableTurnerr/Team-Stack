'use client';

import { useEffect, useState } from 'react';
import { Mic, ExternalLink } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog } from '@/lib/types';
import Link from 'next/link';

interface CallLogsNestedTableProps {
    sessionId: string;
}

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
    'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
    'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
    'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
    'No Answer': { bg: 'bg-[var(--muted)]/20', text: 'text-[var(--muted)]' },
    'Fumbled': { bg: 'bg-orange-500/10', text: 'text-orange-500' },
    'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
};

export function CallLogsNestedTable({ sessionId }: CallLogsNestedTableProps) {
    const [callLogs, setCallLogs] = useState<CallLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCallLogs = async () => {
            try {
                const logs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                    filter: `session = "${sessionId}"`,
                    sort: '-call_time',
                    expand: 'company,phone_number_record',
                });
                setCallLogs(logs);
            } catch (err) {
                console.error('Failed to fetch call logs:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchCallLogs();
    }, [sessionId]);

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
        <div className="overflow-x-auto bg-[var(--sidebar-bg)] border-t border-[var(--card-border)]">
            <table className="w-full text-sm">
                <thead className="bg-[var(--card-bg)] border-b border-[var(--card-border)]">
                    <tr>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Time</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Company</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Phone</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Outcome</th>
                        <th className="text-center px-4 py-2 font-medium text-[var(--muted)]">Interest</th>
                        <th className="text-left px-4 py-2 font-medium text-[var(--muted)]">Notes</th>
                        <th className="text-center px-4 py-2 font-medium text-[var(--muted)]">Recording</th>
                    </tr>
                </thead>
                <tbody>
                    {callLogs.map((log) => (
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
                                {log.call_outcome ? (
                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${OUTCOME_COLORS[log.call_outcome]?.bg || 'bg-[var(--muted)]/20'} ${OUTCOME_COLORS[log.call_outcome]?.text || 'text-[var(--muted)]'}`}>
                                        {log.call_outcome}
                                    </span>
                                ) : (
                                    <span className="text-[var(--muted)] text-xs">-</span>
                                )}
                            </td>
                            <td className="px-4 py-3 text-center">
                                {log.interest_level ? (
                                    <span className="font-medium">{log.interest_level}/10</span>
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
                                    <Link
                                        href={`/recordings?call_log=${log.id}`}
                                        className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                                    >
                                        <Mic size={14} />
                                    </Link>
                                ) : (
                                    <span className="text-[var(--muted)] text-xs">-</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
