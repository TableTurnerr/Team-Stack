'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, User } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession } from '@/lib/types';
import { PerformanceCounterInline } from '@/components/performance-counter-inline';
import { CallLogsNestedTable } from './call-logs-nested-table';
import { InlineEditField } from '@/components/inline-edit-field';

interface SessionLogRowProps {
    session: ColdCallingSession;
    onUpdate: (session: ColdCallingSession) => void;
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

export function SessionLogRow({ session, onUpdate }: SessionLogRowProps) {
    const [isExpanded, setIsExpanded] = useState(false);

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
                    <div className="flex flex-col">
                        <span className="text-sm font-medium">{formatDateTime(session.started_at)}</span>
                        <span className="text-xs text-[var(--muted)]">
                            {session.ended_at ? `Ended: ${formatDateTime(session.ended_at)}` : 'Active'}
                        </span>
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
                        <div className="flex items-center gap-2">
                            <User size={14} className="text-[var(--muted)]" />
                            <span className="text-sm">{session.expand.user.name}</span>
                        </div>
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
            </tr>

            {/* Expanded row showing call logs and notes */}
            {isExpanded && (
                <tr>
                    <td colSpan={11} className="p-0">
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
                                <h4 className="text-sm font-medium mb-3">Call Logs ({session.total_dials || 0} calls)</h4>
                                <CallLogsNestedTable sessionId={session.id} />
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
