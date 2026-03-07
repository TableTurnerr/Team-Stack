'use client';

import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp, RotateCcw, Building2, StickyNote, History, ArrowLeft, Check } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Company } from '@/lib/types';
import { cn } from '@/lib/utils';

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

export function LastCallPreview({ callLog, companyName, sessionId }: LastCallPreviewProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [notes, setNotes] = useState(callLog?.post_call_notes || '');
    const [updating, setUpdating] = useState(false);
    const [updated, setUpdated] = useState(false);
    const [ownerReached, setOwnerReached] = useState(callLog?.owner_reached || false);
    const [pitchCompleted, setPitchCompleted] = useState(callLog?.pitch_completed || false);
    const [appointmentSet, setAppointmentSet] = useState(callLog?.appointment_set || false);

    // Call browser state
    const [showBrowser, setShowBrowser] = useState(false);
    const [allCalls, setAllCalls] = useState<CallLog[]>([]);
    const [loadingCalls, setLoadingCalls] = useState(false);
    const [viewingCall, setViewingCall] = useState<CallLog | null>(null);
    const [viewingCompanyName, setViewingCompanyName] = useState('');

    // Track which call we're showing
    const displayCall = viewingCall || callLog;
    const displayCompany = viewingCall ? viewingCompanyName : companyName;
    const isViewingOlderCall = viewingCall !== null;

    // Sync form fields when displayed call changes
    const callId = displayCall?.id;
    const [trackedCallId, setTrackedCallId] = useState(callId);
    if (callId !== trackedCallId) {
        setTrackedCallId(callId);
        setNotes(displayCall?.post_call_notes || '');
        setOwnerReached(displayCall?.owner_reached || false);
        setPitchCompleted(displayCall?.pitch_completed || false);
        setAppointmentSet(displayCall?.appointment_set || false);
        setUpdated(false);
    }

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
    }, [displayCall, notes, ownerReached, pitchCompleted, appointmentSet, isViewingOlderCall, handleBackToLastCall]);

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
        appointmentSet !== (displayCall.appointment_set || false);

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

            {/* Content */}
            {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--card-border)]">
                    {/* Company + Phone */}
                    <div className="flex items-center gap-2 pt-3">
                        <Building2 size={14} className="text-[var(--muted)]" />
                        <span className="text-sm font-medium">{displayCompany || 'Unknown Company'}</span>
                        {displayCall.expand?.phone_number_record?.phone_number && (
                            <span className="text-xs font-light text-[var(--muted)] font-mono">
                                {displayCall.expand.phone_number_record.phone_number}
                            </span>
                        )}
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
                                <span className="text-xs group-hover:text-[var(--foreground)] transition-colors">Appointment Set</span>
                                {appointmentSet && <Check size={12} className="text-[var(--success)]" />}
                            </label>
                        </div>
                    </div>

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
