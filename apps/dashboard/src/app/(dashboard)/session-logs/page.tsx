'use client';

import { useState, useEffect, useCallback } from 'react';
import { History, Download, RefreshCw, Loader2, Filter } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession } from '@/lib/types';
import { SessionLogRow } from './session-log-row';

export default function SessionLogsPage() {
    const [sessions, setSessions] = useState<ColdCallingSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showFilters, setShowFilters] = useState(false);

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
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-12">
                    <div className="text-center space-y-4">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--muted)]/10 flex items-center justify-center mx-auto">
                            <History size={32} className="text-[var(--muted)]" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold mb-1">No sessions found</h3>
                            <p className="text-sm text-[var(--muted)]">
                                {statusFilter !== 'all'
                                    ? `No ${statusFilter} sessions. Try changing the filter.`
                                    : 'Start a call session to see it appear here.'}
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wide w-10"></th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Started</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Duration</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Dials</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Pickups</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Pickup %</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Owner</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Pitch</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Appt</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wide">User</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sessions.map((session) => (
                                    <SessionLogRow
                                        key={session.id}
                                        session={session}
                                        onUpdate={handleUpdateSession}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
