'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, Download, RefreshCw, Loader2, Filter, Trash2, Copy, Check } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type Recording, type FollowUp } from '@/lib/types';
import { SessionLogRow } from './session-log-row';
import {
    TableContainer,
    HeaderIndexCell,
    useTableSelection,
    TableEmptyState,
    SelectionToolbar,
} from '@/components/ui/data-table';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { useRecycleBinOptional } from '@/contexts/recycle-bin-context';
import { useAuth } from '@/contexts/auth-context';
import { PageGuard } from '@/components/page-guard';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';

const SESSION_LOG_COLUMNS: ColumnDefinition[] = [
    { key: 'started', label: 'Started', defaultVisible: true },
    { key: 'duration', label: 'Duration', defaultVisible: true },
    { key: 'dials', label: 'Dials', defaultVisible: true },
    { key: 'pickups', label: 'Pickups', defaultVisible: true },
    { key: 'pickup_pct', label: 'Pickup %', defaultVisible: true },
    { key: 'owner', label: 'Owner', defaultVisible: true },
    { key: 'pitch', label: 'Pitch', defaultVisible: true },
    { key: 'appt', label: 'Appt', defaultVisible: true },
    { key: 'lead_category', label: 'Lead Category', defaultVisible: true },
    { key: 'user', label: 'User', defaultVisible: true },
    { key: 'status', label: 'Status', defaultVisible: true },
    { key: 'actions', label: 'Actions', alwaysVisible: true },
];

function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

export default function SessionLogsPage() {
    const { preferences } = useUserPreferences();
    const [sessions, setSessions] = useState<ColdCallingSession[]>([]);
    const [categoryBreakdowns, setCategoryBreakdowns] = useState<Map<string, Record<string, number>>>(new Map());
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showFilters, setShowFilters] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
    const [bulkIdsCopied, setBulkIdsCopied] = useState(false);

    const selection = useTableSelection(sessions);
    const columnVisibility = useColumnVisibility('session-logs', SESSION_LOG_COLUMNS);
    const recycleBin = useRecycleBinOptional();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const fetchSessions = useCallback(async () => {
        try {
            setLoading(true);

            // Build filter
            let filter = '';
            if (statusFilter !== 'all') {
                filter = `status = "${statusFilter}"`;
            }

            const result = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getFullList<ColdCallingSession>({
                filter,
                sort: '-started_at',
                expand: 'user',
            });

            setSessions(result);

            // Fetch call logs (with company.lead_category) for these sessions in chunks
            // to compute the lead-category breakdown per session.
            const sessionIds = result.map(s => s.id);
            const breakdown = new Map<string, Record<string, number>>();
            const CHUNK = 40;
            for (let i = 0; i < sessionIds.length; i += CHUNK) {
                const chunk = sessionIds.slice(i, i + CHUNK);
                const filter = chunk.map(id => `session = "${id}"`).join(' || ');
                if (!filter) continue;
                try {
                    const logs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                        filter,
                        expand: 'company.lead_category',
                        fields: 'id,session,expand.company.expand.lead_category.name',
                    });
                    for (const log of logs) {
                        if (!log.session) continue;
                        const name = log.expand?.company?.expand?.lead_category?.name || 'Uncategorized';
                        const map = breakdown.get(log.session) || {};
                        map[name] = (map[name] || 0) + 1;
                        breakdown.set(log.session, map);
                    }
                } catch (err) {
                    console.error('Failed to fetch call log categories:', err);
                }
            }
            setCategoryBreakdowns(breakdown);
        } catch (err) {
            console.error('Failed to fetch sessions:', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    const handleRefresh = () => {
        setRefreshing(true);
        fetchSessions();
    };

    const handleUpdateSession = (updatedSession: ColdCallingSession) => {
        setSessions(prev =>
            prev.map(s => s.id === updatedSession.id ? updatedSession : s)
        );
    };

    const handleDeleteSession = (id: string) => {
        setSessions(prev => prev.filter(s => s.id !== id));
    };

    const handleBulkDelete = async () => {
        if (bulkDeleting) return;
        setBulkDeleting(true);
        try {
            const selectedSessions = sessions.filter(s => selection.selectedIds.has(s.id));
            for (const session of selectedSessions) {
                const callLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                    filter: `session = "${session.id}"`,
                });
                const callLogIds = callLogs.map(l => l.id);

                if (session.is_test) {
                    // Hard delete test sessions (with related data)
                    if (callLogIds.length > 0) {
                        const recordings = await pb.collection(COLLECTIONS.RECORDINGS).getFullList<Recording>({
                            filter: callLogIds.map(id => `call_log = "${id}"`).join(' || '),
                        });
                        await Promise.allSettled(recordings.map(r => pb.collection(COLLECTIONS.RECORDINGS).delete(r.id)));

                        const followUps = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
                            filter: callLogIds.map(id => `call_log = "${id}"`).join(' || '),
                        });
                        await Promise.allSettled(followUps.map(f => pb.collection(COLLECTIONS.FOLLOW_UPS).delete(f.id)));
                    }
                    await Promise.allSettled(callLogs.map(l => pb.collection(COLLECTIONS.CALL_LOGS).delete(l.id)));
                    await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).delete(session.id);
                } else if (isAdmin && recycleBin) {
                    // Soft delete regular sessions to recycle bin (admin only)
                    const relatedData: Record<string, unknown[]> = {};
                    if (callLogs.length > 0) {
                        relatedData[COLLECTIONS.CALL_LOGS] = callLogs as unknown as Record<string, unknown>[];
                        for (const log of callLogs) {
                            try { await pb.collection(COLLECTIONS.CALL_LOGS).delete(log.id); } catch { /* continue */ }
                        }
                    }
                    await recycleBin.moveToTrash({
                        itemType: 'session',
                        originalId: session.id,
                        itemLabel: formatDateTime(session.started_at),
                        itemData: session as unknown as Record<string, unknown>,
                        relatedData,
                    });
                }
            }
            // Remove deleted sessions from state
            setSessions(prev => prev.filter(s => !selection.selectedIds.has(s.id)));
            selection.clear();
        } catch (err) {
            console.error('Bulk delete failed:', err);
        } finally {
            setBulkDeleting(false);
            setConfirmBulkDelete(false);
        }
    };

    const handleBulkCopyIds = async () => {
        const ids = sessions
            .filter(s => selection.selectedIds.has(s.id))
            .map(s => s.id)
            .join('\n');
        if (!ids) return;
        try {
            await navigator.clipboard.writeText(ids);
            setBulkIdsCopied(true);
            setTimeout(() => setBulkIdsCopied(false), 1500);
        } catch (err) {
            console.error('Failed to copy session IDs:', err);
        }
    };

    const handleExportCSV = () => {
        // CSV export functionality
        const csvHeader = 'Date,Duration,Dials,Pickups,Pickup Rate,Owner Reached,Pitch Completed,Appointments,User,Status\n';
        const csvRows = sessions.map(session => {
            const pickupRate = session.total_dials > 0
                ? Math.round((session.total_pickups / session.total_dials) * 100)
                : 0;

            return [
                new Date(session.started_at).toLocaleDateString(),
                Math.floor((session.total_duration_sec || 0) / 60),
                session.total_dials || 0,
                session.total_pickups || 0,
                `${pickupRate}%`,
                session.owner_reached || 0,
                session.pitch_completed || 0,
                session.appointment_set || 0,
                session.expand?.user?.name || '',
                session.status,
            ].join(',');
        }).join('\n');

        const csvContent = csvHeader + csvRows;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-logs-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
            </div>
        );
    }

    return (
        <PageGuard pageKey="session-logs">
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Session Logs</h1>
                    <p className="text-[var(--muted)] mt-1">
                        View and manage all cold calling sessions
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-3 py-2 rounded-lg border transition-colors ${
                            showFilters
                                ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]'
                                : 'border-[var(--card-border)] hover:bg-[var(--card-bg)]'
                        }`}
                    >
                        <Filter size={18} />
                    </button>
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="px-3 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                    <ColumnSelector
                        columns={columnVisibility.columns}
                        visibleColumns={columnVisibility.visibleColumns}
                        onToggle={columnVisibility.toggleColumn}
                        onReset={() => {
                            columnVisibility.resetToDefault();
                            if (typeof window !== 'undefined') {
                                localStorage.removeItem('col-widths-session-logs');
                            }
                        }}
                    />
                    <button
                        onClick={handleExportCSV}
                        disabled={sessions.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors disabled:opacity-50"
                    >
                        <Download size={18} />
                        <span className="hidden sm:inline">Export CSV</span>
                    </button>
                </div>
            </div>

            {/* Filters */}
            {showFilters && (
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                    <div className="flex items-center gap-4">
                        <span className="text-sm font-medium">Status:</span>
                        <div className="flex gap-2">
                            {(['all', 'active', 'completed'] as const).map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setStatusFilter(status)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        statusFilter === status
                                            ? 'bg-[var(--foreground)] text-[var(--background)]'
                                            : 'bg-[var(--sidebar-bg)] hover:bg-[var(--card-hover)]'
                                    }`}
                                >
                                    {status.charAt(0).toUpperCase() + status.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                    <p className="text-sm text-[var(--muted)] mb-1">Total Sessions</p>
                    <p className="text-2xl font-bold">{sessions.length}</p>
                </div>
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                    <p className="text-sm text-[var(--muted)] mb-1">Total Dials</p>
                    <p className="text-2xl font-bold">
                        {sessions.reduce((sum, s) => sum + (s.total_dials || 0), 0)}
                    </p>
                </div>
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                    <p className="text-sm text-[var(--muted)] mb-1">Total Pickups</p>
                    <p className="text-2xl font-bold">
                        {sessions.reduce((sum, s) => sum + (s.total_pickups || 0), 0)}
                    </p>
                </div>
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                    <p className="text-sm text-[var(--muted)] mb-1">Avg Pickup Rate</p>
                    <p className="text-2xl font-bold">
                        {sessions.length > 0
                            ? Math.round(
                                sessions.reduce((sum, s) => {
                                    const rate = s.total_dials > 0
                                        ? (s.total_pickups / s.total_dials) * 100
                                        : 0;
                                    return sum + rate;
                                }, 0) / sessions.length
                            )
                            : 0}%
                    </p>
                </div>
            </div>

            {/* Bulk Action Toolbar */}
            {selection.hasSelection && (
                <SelectionToolbar count={selection.count} totalCount={sessions.length}>
                    <button
                        onClick={handleBulkCopyIds}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-bg)] transition-colors"
                    >
                        {bulkIdsCopied ? <Check size={14} className="text-[var(--success)]" /> : <Copy size={14} />}
                        {bulkIdsCopied ? 'Copied' : 'Copy IDs'}
                    </button>
                    {confirmBulkDelete ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-[var(--error)]">Delete {selection.count} session{selection.count > 1 ? 's' : ''}?</span>
                            <button
                                onClick={handleBulkDelete}
                                disabled={bulkDeleting}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60"
                            >
                                {bulkDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                {bulkDeleting ? 'Deleting...' : 'Confirm'}
                            </button>
                            {!bulkDeleting && (
                                <button
                                    onClick={() => setConfirmBulkDelete(false)}
                                    className="px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    ) : (
                        <button
                            onClick={() => setConfirmBulkDelete(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <Trash2 size={14} />
                            Delete
                        </button>
                    )}
                </SelectionToolbar>
            )}

            {/* Sessions Table */}
            {sessions.length === 0 ? (
                <TableContainer>
                    <TableEmptyState
                        icon={<History size={24} className="text-[var(--muted)]" />}
                        title="No sessions found"
                        description={
                            statusFilter !== 'all'
                                ? `No ${statusFilter} sessions. Try changing the filter.`
                                : 'Start a call session to see it appear here.'
                        }
                    />
                </TableContainer>
            ) : (
                <TableContainer>
                    <div className="overflow-x-hidden">
                        <table className="w-full">
                            <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                                <tr>
                                    <th className="px-2 py-3 w-8"></th>
                                    <HeaderIndexCell
                                        allSelected={selection.allSelected}
                                        someSelected={selection.someSelected}
                                        onToggleAll={selection.toggleAll}
                                    />
                                    {columnVisibility.isColumnVisible('started') && (
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left">Started</th>
                                    )}
                                    {columnVisibility.isColumnVisible('duration') && (
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left whitespace-nowrap">Duration</th>
                                    )}
                                    {columnVisibility.isColumnVisible('dials') && (
                                        <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-center whitespace-nowrap">Dials</th>
                                    )}
                                    {columnVisibility.isColumnVisible('pickups') && (
                                        <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-center whitespace-nowrap">Pickups</th>
                                    )}
                                    {columnVisibility.isColumnVisible('pickup_pct') && (
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left whitespace-nowrap w-[140px]">Pickup %</th>
                                    )}
                                    {columnVisibility.isColumnVisible('owner') && (
                                        <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-center whitespace-nowrap">Owner</th>
                                    )}
                                    {columnVisibility.isColumnVisible('pitch') && (
                                        <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-center whitespace-nowrap">Pitch</th>
                                    )}
                                    {columnVisibility.isColumnVisible('appt') && (
                                        <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-center whitespace-nowrap">Appt</th>
                                    )}
                                    {columnVisibility.isColumnVisible('lead_category') && (
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left whitespace-nowrap">Lead Category</th>
                                    )}
                                    {columnVisibility.isColumnVisible('user') && (
                                        <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left whitespace-nowrap">User</th>
                                    )}
                                    {columnVisibility.isColumnVisible('status') && (
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left whitespace-nowrap">Status</th>
                                    )}
                                    <th className="px-3 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-[90px]"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((session, i) => (
                                    <SessionLogRow
                                        key={session.id}
                                        session={session}
                                        index={i + 1}
                                        selected={selection.isSelected(session.id)}
                                        onSelect={() => selection.toggle(session.id)}
                                        hasSelection={selection.hasSelection}
                                        onUpdate={handleUpdateSession}
                                        onDelete={handleDeleteSession}
                                        timezones={preferences?.timezones}
                                        isColumnVisible={columnVisibility.isColumnVisible}
                                        categoryBreakdown={categoryBreakdowns.get(session.id)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </TableContainer>
            )}
        </div>
        </PageGuard>
    );
}
