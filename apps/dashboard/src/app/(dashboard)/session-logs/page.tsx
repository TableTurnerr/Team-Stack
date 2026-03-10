'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, Download, RefreshCw, Loader2, Filter } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession } from '@/lib/types';
import { SessionLogRow } from './session-log-row';
import {
    TableContainer,
    HeaderIndexCell,
    ResizableTh,
    useResizableColumns,
    useTableSelection,
    TableEmptyState,
} from '@/components/ui/data-table';
import { useUserPreferences } from '@/hooks/use-user-preferences';

const COLUMN_CONFIG = [
    { key: 'expand' },
    { key: 'started', initialWidth: 180, minWidth: 120 },
    { key: 'duration', initialWidth: 100, minWidth: 80 },
    { key: 'dials', initialWidth: 80, minWidth: 60 },
    { key: 'pickups', initialWidth: 80, minWidth: 60 },
    { key: 'pickup_pct', initialWidth: 120, minWidth: 90 },
    { key: 'owner', initialWidth: 80, minWidth: 60 },
    { key: 'pitch', initialWidth: 80, minWidth: 60 },
    { key: 'appt', initialWidth: 80, minWidth: 60 },
    { key: 'user', initialWidth: 80, minWidth: 60 },
    { key: 'status', initialWidth: 100, minWidth: 80 },
    { key: 'actions' },
];

export default function SessionLogsPage() {
    const { preferences } = useUserPreferences();
    const [sessions, setSessions] = useState<ColdCallingSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showFilters, setShowFilters] = useState(false);

    const selection = useTableSelection(sessions);
    const { resize, getWidth } = useResizableColumns('session-logs', COLUMN_CONFIG);

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
                    <div className="overflow-x-auto">
                        <table className="w-full" style={{ tableLayout: 'fixed' }}>
                            <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-10"></th>
                                    <HeaderIndexCell
                                        allSelected={selection.allSelected}
                                        someSelected={selection.someSelected}
                                        onToggleAll={selection.toggleAll}
                                    />
                                    <ResizableTh width={getWidth('started')} onResize={(w) => resize('started', w)}>Started</ResizableTh>
                                    <ResizableTh width={getWidth('duration')} onResize={(w) => resize('duration', w)}>Duration</ResizableTh>
                                    <ResizableTh width={getWidth('dials')} onResize={(w) => resize('dials', w)} align="center">Dials</ResizableTh>
                                    <ResizableTh width={getWidth('pickups')} onResize={(w) => resize('pickups', w)} align="center">Pickups</ResizableTh>
                                    <ResizableTh width={getWidth('pickup_pct')} onResize={(w) => resize('pickup_pct', w)}>Pickup %</ResizableTh>
                                    <ResizableTh width={getWidth('owner')} onResize={(w) => resize('owner', w)} align="center">Owner</ResizableTh>
                                    <ResizableTh width={getWidth('pitch')} onResize={(w) => resize('pitch', w)} align="center">Pitch</ResizableTh>
                                    <ResizableTh width={getWidth('appt')} onResize={(w) => resize('appt', w)} align="center">Appt</ResizableTh>
                                    <ResizableTh width={getWidth('user')} onResize={(w) => resize('user', w)}>User</ResizableTh>
                                    <ResizableTh width={getWidth('status')} onResize={(w) => resize('status', w)}>Status</ResizableTh>
                                    <th className="px-4 py-3 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider w-10"></th>
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
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </TableContainer>
            )}
        </div>
    );
}
