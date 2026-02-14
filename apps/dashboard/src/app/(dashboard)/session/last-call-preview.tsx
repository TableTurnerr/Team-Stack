'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Building2, StickyNote } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Company } from '@/lib/types';
import { cn } from '@/lib/utils';

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
    'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
    'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
    'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
    'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
    'Wrong Number': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
    'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
};

interface LastCallPreviewProps {
    callLog: CallLog | null;
    companyName: string;
}

export function LastCallPreview({ callLog, companyName }: LastCallPreviewProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [notes, setNotes] = useState(callLog?.post_call_notes || '');
    const [updating, setUpdating] = useState(false);
    const [updated, setUpdated] = useState(false);

    // Sync notes when callLog changes
    const callId = callLog?.id;
    const [trackedCallId, setTrackedCallId] = useState(callId);
    if (callId !== trackedCallId) {
        setTrackedCallId(callId);
        setNotes(callLog?.post_call_notes || '');
        setUpdated(false);
    }

    const handleUpdate = useCallback(async () => {
        if (!callLog) return;
        try {
            setUpdating(true);
            await pb.collection(COLLECTIONS.CALL_LOGS).update(callLog.id, {
                post_call_notes: notes,
            });
            setUpdated(true);
            setTimeout(() => setUpdated(false), 2000);
        } catch (err) {
            console.error('Failed to update call log:', err);
        } finally {
            setUpdating(false);
        }
    }, [callLog, notes]);

    if (!callLog) {
        return (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Last Call
                </h3>
                <p className="text-sm text-[var(--muted)] mt-3">No calls logged yet in this session.</p>
            </div>
        );
    }

    const outcome = callLog.call_outcome || '';
    const colors = OUTCOME_COLORS[outcome] || { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' };

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
            {/* Header (clickable to toggle) */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-[var(--sidebar-bg)] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                        Last Call
                    </h3>
                    {outcome && (
                        <span className={cn('px-2 py-0.5 rounded text-xs font-medium', colors.bg, colors.text)}>
                            {outcome}
                        </span>
                    )}
                </div>
                {isExpanded ? <ChevronUp size={16} className="text-[var(--muted)]" /> : <ChevronDown size={16} className="text-[var(--muted)]" />}
            </button>

            {/* Content */}
            {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--card-border)]">
                    {/* Company */}
                    <div className="flex items-center gap-2 pt-3">
                        <Building2 size={14} className="text-[var(--muted)]" />
                        <span className="text-sm font-medium">{companyName || 'Unknown Company'}</span>
                    </div>

                    {/* Phone number */}
                    {callLog.expand?.phone_number_record?.phone_number && (
                        <div className="text-sm text-[var(--muted)] font-mono">
                            {callLog.expand.phone_number_record.phone_number}
                        </div>
                    )}

                    {/* Interest level */}
                    {callLog.interest_level !== undefined && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--muted)]">Interest:</span>
                            <div className="flex-1 h-1.5 bg-[var(--card-border)] rounded-full overflow-hidden max-w-[100px]">
                                <div
                                    className={cn(
                                        'h-full rounded-full',
                                        callLog.interest_level >= 7 ? 'bg-[var(--success)]' :
                                            callLog.interest_level >= 4 ? 'bg-[var(--warning)]' : 'bg-[var(--error)]'
                                    )}
                                    style={{ width: `${callLog.interest_level * 10}%` }}
                                />
                            </div>
                            <span className="text-xs text-[var(--muted)]">{callLog.interest_level}/10</span>
                        </div>
                    )}

                    {/* Editable notes */}
                    <div>
                        <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
                            <StickyNote size={10} />
                            <span>Notes</span>
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
                        disabled={updating || notes === (callLog.post_call_notes || '')}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all',
                            updated
                                ? 'bg-[var(--success-subtle)] text-[var(--success)]'
                                : 'bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                    >
                        <RotateCcw size={12} />
                        {updated ? 'Updated!' : updating ? 'Updating...' : 'Update Last Call'}
                    </button>
                </div>
            )}
        </div>
    );
}
