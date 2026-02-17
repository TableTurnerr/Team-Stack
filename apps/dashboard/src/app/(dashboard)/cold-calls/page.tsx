'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Phone,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  Eye,
  RefreshCw,
  Clock,
  UserCheck,
  Target,
  CalendarCheck,
  Zap,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCall, type CallLog, type Company, type User, type ColdCallingSession, type PhoneNumber } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { ColdCallsTableSkeleton } from '@/components/dashboard-skeletons';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { ZoomCallButton } from '@/components/zoom-call-button';

// ─── Column Definitions ──────────────────────────────────────────────────────

const CALL_LOG_COLUMNS: ColumnDefinition[] = [
  { key: 'call_time', label: 'Date', defaultVisible: true },
  { key: 'company', label: 'Company', defaultVisible: true },
  { key: 'phone', label: 'Phone', defaultVisible: true },
  { key: 'recipient', label: 'Recipient', defaultVisible: true },
  { key: 'call_outcome', label: 'Outcome', defaultVisible: true },
  { key: 'interest_level', label: 'Interest', defaultVisible: true },
  { key: 'duration', label: 'Duration', defaultVisible: true },
  { key: 'performance', label: 'Performance', defaultVisible: true },
  { key: 'session', label: 'Session', defaultVisible: true },
  { key: 'caller', label: 'Caller', defaultVisible: false },
  { key: 'notes', label: 'Notes', defaultVisible: false },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

const COLD_CALL_COLUMNS: ColumnDefinition[] = [
  { key: 'created', label: 'Date', defaultVisible: true },
  { key: 'company', label: 'Company', defaultVisible: true },
  { key: 'phone_number', label: 'Phone', defaultVisible: true },
  { key: 'recipients', label: 'Recipient', defaultVisible: true },
  { key: 'call_outcome', label: 'Outcome', defaultVisible: true },
  { key: 'interest_level', label: 'Interest', defaultVisible: true },
  { key: 'claimed_by', label: 'Claimed By', defaultVisible: true },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

// ─── Shared Components ───────────────────────────────────────────────────────

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
  'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
  'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
  'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Wrong Number': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
  'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
};

function InterestBar({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[var(--card-border)] rounded-full overflow-hidden max-w-[80px]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            level >= 7 ? "bg-[var(--success)]" :
              level >= 4 ? "bg-[var(--warning)]" : "bg-[var(--error)]"
          )}
          style={{ width: `${level * 10}%` }}
        />
      </div>
      <span className="text-sm text-[var(--muted)]">{level}/10</span>
    </div>
  );
}

function SortHeader({
  label,
  field,
  currentSort,
  onSort
}: {
  label: string;
  field: string;
  currentSort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
}) {
  const isActive = currentSort.field === field;
  return (
    <th
      className="text-left py-3 px-4 font-medium text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)] transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (
          currentSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
        )}
      </div>
    </th>
  );
}

function formatCallDuration(seconds?: number): string {
  if (!seconds || seconds === 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ─── Tab Type ────────────────────────────────────────────────────────────────

type TabType = 'call_logs' | 'ai_transcripts';

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ColdCallsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('call_logs');

  // Call Logs state
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [callLogsLoading, setCallLogsLoading] = useState(true);
  const [callLogsError, setCallLogsError] = useState<string | null>(null);
  const [callLogsPage, setCallLogsPage] = useState(1);
  const [callLogsTotalPages, setCallLogsTotalPages] = useState(1);

  // AI Transcripts (cold_calls) state
  const [coldCalls, setColdCalls] = useState<ColdCall[]>([]);
  const [coldCallsLoading, setColdCallsLoading] = useState(true);
  const [coldCallsError, setColdCallsError] = useState<string | null>(null);
  const [coldCallsPage, setColdCallsPage] = useState(1);
  const [coldCallsTotalPages, setColdCallsTotalPages] = useState(1);

  // Shared filters
  const [searchTerm, setSearchTerm] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<string[]>([]);
  const [minInterest, setMinInterest] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: activeTab === 'call_logs' ? 'call_time' : 'created',
    dir: 'desc'
  });
  const perPage = 20;

  // Column visibility per tab
  const callLogCols = useColumnVisibility('cold-calls-logs', CALL_LOG_COLUMNS);
  const coldCallCols = useColumnVisibility('cold-calls-transcripts', COLD_CALL_COLUMNS);

  // ─── Fetch Call Logs ─────────────────────────────────────────────────────

  const fetchCallLogs = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setCallLogsLoading(true);
      setCallLogsError(null);

      const filters: string[] = [];

      if (searchTerm) {
        const safe = searchTerm.replace(/"/g, '\\"');
        filters.push(`(expand.company.company_name ~ "${safe}" || expand.phone_number_record.phone_number ~ "${safe}" || owner_name_found ~ "${safe}" || post_call_notes ~ "${safe}")`);
      }
      if (outcomeFilter.length > 0) {
        const outcomeConditions = outcomeFilter.map(o => `call_outcome = "${o}"`).join(' || ');
        filters.push(`(${outcomeConditions})`);
      }
      if (minInterest > 0) {
        filters.push(`interest_level >= ${minInterest}`);
      }

      const sortField = sort.field === 'created' ? 'call_time' : sort.field;
      const result = await pb.collection(COLLECTIONS.CALL_LOGS).getList<CallLog>(callLogsPage, perPage, {
        sort: `${sort.dir === 'desc' ? '-' : ''}${sortField}`,
        expand: 'company,phone_number_record,caller,session',
        ...(filters.length > 0 && { filter: filters.join(' && ') }),
      });

      setCallLogs(result.items);
      setCallLogsTotalPages(result.totalPages);
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch call logs:', err);
        setCallLogsError(`Failed to load call logs: ${err.message}`);
      }
    } finally {
      setCallLogsLoading(false);
    }
  }, [callLogsPage, sort, searchTerm, outcomeFilter, minInterest, isAuthenticated]);

  // ─── Fetch Cold Calls (AI Transcripts) ───────────────────────────────────

  const fetchColdCalls = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setColdCallsLoading(true);
      setColdCallsError(null);

      const filters: string[] = [];

      if (searchTerm) {
        filters.push(`(expand.company.company_name ~ "${searchTerm}" || phone_number ~ "${searchTerm}" || owner_name ~ "${searchTerm}")`);
      }
      if (outcomeFilter.length > 0) {
        const outcomeConditions = outcomeFilter.map(o => `call_outcome = "${o}"`).join(' || ');
        filters.push(`(${outcomeConditions})`);
      }
      if (minInterest > 0) {
        filters.push(`interest_level >= ${minInterest}`);
      }

      const result = await pb.collection(COLLECTIONS.COLD_CALLS).getList<ColdCall>(coldCallsPage, perPage, {
        sort: `${sort.dir === 'desc' ? '-' : ''}${sort.field === 'call_time' ? 'created' : sort.field}`,
        expand: 'company,claimed_by',
        ...(filters.length > 0 && { filter: filters.join(' && ') }),
      });

      setColdCalls(result.items);
      setColdCallsTotalPages(result.totalPages);
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch cold calls:', err);
        setColdCallsError(`Failed to load AI transcripts: ${err.message}`);
      }
    } finally {
      setColdCallsLoading(false);
    }
  }, [coldCallsPage, sort, searchTerm, outcomeFilter, minInterest, isAuthenticated]);

  // Fetch on mount and when deps change
  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'call_logs') {
      fetchCallLogs();
    } else {
      fetchColdCalls();
    }
  }, [isAuthenticated, activeTab, fetchCallLogs, fetchColdCalls]);

  // Reset sort default when switching tabs
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSort({
      field: tab === 'call_logs' ? 'call_time' : 'created',
      dir: 'desc',
    });
  };

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const toggleOutcomeFilter = (outcome: string) => {
    setOutcomeFilter(prev =>
      prev.includes(outcome)
        ? prev.filter(o => o !== outcome)
        : [...prev, outcome]
    );
  };

  const clearFilters = () => {
    setSearchTerm('');
    setOutcomeFilter([]);
    setMinInterest(0);
  };

  // ─── CSV Export ──────────────────────────────────────────────────────────

  const exportToCSV = () => {
    if (activeTab === 'call_logs') {
      const headers = ['Date', 'Company', 'Phone', 'Recipient', 'Outcome', 'Interest Level', 'Duration (s)', 'Owner Reached', 'Pitch Completed', 'Appointment Set', 'Session', 'Caller', 'Notes'];
      const rows = callLogs.map(log => [
        log.call_time ? formatDate(log.call_time) : '',
        log.expand?.company?.company_name || 'Unknown',
        log.expand?.phone_number_record?.phone_number || '',
        log.owner_name_found || '',
        log.call_outcome || '',
        log.interest_level?.toString() || '',
        log.duration?.toString() || '',
        log.owner_reached ? 'Yes' : 'No',
        log.pitch_completed ? 'Yes' : 'No',
        log.appointment_set ? 'Yes' : 'No',
        log.session ? 'Yes' : '',
        log.expand?.caller?.name || '',
        log.post_call_notes || '',
      ]);
      const csv = [headers, ...rows].map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `call-logs-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ['Date', 'Company', 'Phone', 'Recipient', 'Outcome', 'Interest Level', 'Claimed By'];
      const rows = coldCalls.map(call => [
        formatDate(call.created),
        call.expand?.company?.company_name || 'Unknown',
        call.phone_number || '',
        call.recipients || '',
        call.call_outcome || '',
        call.interest_level?.toString() || '',
        call.expand?.claimed_by?.name || ''
      ]);
      const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cold-calls-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const hasActiveFilters = !!searchTerm || outcomeFilter.length > 0 || minInterest > 0;
  const loading = activeTab === 'call_logs' ? callLogsLoading : coldCallsLoading;
  const error = activeTab === 'call_logs' ? callLogsError : coldCallsError;
  const currentItems = activeTab === 'call_logs' ? callLogs : coldCalls;
  const refresh = activeTab === 'call_logs' ? fetchCallLogs : fetchColdCalls;

  if (authLoading) {
    return <ColdCallsTableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cold Calls</h1>
          <p className="text-[var(--muted)] mt-1">View all call logs and AI-analyzed transcripts</p>
        </div>

        <div className="flex items-center gap-2">
          <SearchInput
            placeholder="Search..."
            onSearch={setSearchTerm}
            defaultValue={searchTerm}
            key={`${activeTab}-${searchTerm}`}
            className="w-full sm:w-64"
          />

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
              showFilters || outcomeFilter.length > 0 || minInterest > 0
                ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]"
                : "border-[var(--card-border)] hover:bg-[var(--card-bg)]"
            )}
          >
            <Filter size={16} />
            Filters
            {(outcomeFilter.length > 0 || minInterest > 0) && (
              <span className="ml-1 w-5 h-5 rounded-full bg-[var(--background)]/20 text-xs flex items-center justify-center">
                {outcomeFilter.length + (minInterest > 0 ? 1 : 0)}
              </span>
            )}
          </button>

          <button
            onClick={exportToCSV}
            disabled={currentItems.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors disabled:opacity-50"
          >
            <Download size={16} />
            Export
          </button>

          <ColumnSelector
            columns={activeTab === 'call_logs' ? callLogCols.columns : coldCallCols.columns}
            visibleColumns={activeTab === 'call_logs' ? callLogCols.visibleColumns : coldCallCols.visibleColumns}
            onToggle={activeTab === 'call_logs' ? callLogCols.toggleColumn : coldCallCols.toggleColumn}
          />

          <button
            onClick={refresh}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[var(--sidebar-bg)] p-1 rounded-lg w-fit">
        <button
          onClick={() => handleTabChange('call_logs')}
          className={cn(
            "px-4 py-2 rounded-md text-sm font-medium transition-all",
            activeTab === 'call_logs'
              ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          )}
        >
          <div className="flex items-center gap-2">
            <Phone size={14} />
            Call Logs
          </div>
        </button>
        <button
          onClick={() => handleTabChange('ai_transcripts')}
          className={cn(
            "px-4 py-2 rounded-md text-sm font-medium transition-all",
            activeTab === 'ai_transcripts'
              ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          )}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} />
            AI Transcripts
          </div>
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Filters</h3>
            {(outcomeFilter.length > 0 || minInterest > 0) && (
              <button onClick={clearFilters} className="text-sm text-[var(--primary)] hover:underline">
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Outcome</label>
              <div className="flex flex-wrap gap-1">
                {Object.keys(OUTCOME_COLORS).map(outcome => (
                  <button
                    key={outcome}
                    onClick={() => toggleOutcomeFilter(outcome)}
                    className={cn(
                      "px-2 py-1 rounded-md text-xs transition-all",
                      outcomeFilter.includes(outcome)
                        ? `${OUTCOME_COLORS[outcome].bg} ${OUTCOME_COLORS[outcome].text}`
                        : "bg-[var(--sidebar-bg)] text-[var(--muted)] hover:bg-[var(--card-border)]"
                    )}
                  >
                    {outcome}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">
                Min Interest Level: {minInterest || 'Any'}
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={minInterest}
                onChange={(e) => setMinInterest(parseInt(e.target.value))}
                className="w-full accent-[var(--foreground)]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Table content */}
      {loading ? (
        <ColdCallsTableSkeleton />
      ) : activeTab === 'call_logs' ? (
        <CallLogsTable
          logs={callLogs}
          sort={sort}
          onSort={handleSort}
          isColumnVisible={callLogCols.isColumnVisible}
          hasActiveFilters={hasActiveFilters}
          page={callLogsPage}
          totalPages={callLogsTotalPages}
          onPageChange={setCallLogsPage}
        />
      ) : (
        <ColdCallsTable
          calls={coldCalls}
          sort={sort}
          onSort={handleSort}
          isColumnVisible={coldCallCols.isColumnVisible}
          hasActiveFilters={hasActiveFilters}
          page={coldCallsPage}
          totalPages={coldCallsTotalPages}
          onPageChange={setColdCallsPage}
        />
      )}
    </div>
  );
}

// ─── Call Logs Table ─────────────────────────────────────────────────────────

function CallLogsTable({
  logs,
  sort,
  onSort,
  isColumnVisible,
  hasActiveFilters,
  page,
  totalPages,
  onPageChange,
}: {
  logs: CallLog[];
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  isColumnVisible: (key: string) => boolean;
  hasActiveFilters: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
      {logs.length === 0 ? (
        <div className="p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--info-subtle)] flex items-center justify-center mx-auto mb-4">
            <Phone size={24} className="text-[var(--info)]" />
          </div>
          <p className="text-sm font-medium">No call logs found</p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Calls made during sessions will appear here'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                <tr>
                  {isColumnVisible('call_time') && <SortHeader label="Date" field="call_time" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('company') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Company</th>}
                  {isColumnVisible('phone') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>}
                  {isColumnVisible('recipient') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Recipient</th>}
                  {isColumnVisible('call_outcome') && <SortHeader label="Outcome" field="call_outcome" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('interest_level') && <SortHeader label="Interest" field="interest_level" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('duration') && <SortHeader label="Duration" field="duration" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('performance') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Performance</th>}
                  {isColumnVisible('session') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Session</th>}
                  {isColumnVisible('caller') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Caller</th>}
                  {isColumnVisible('notes') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Notes</th>}
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const phoneNum = log.expand?.phone_number_record?.phone_number || '';
                  const session = log.expand?.session;

                  return (
                    <tr
                      key={log.id}
                      className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors"
                    >
                      {isColumnVisible('call_time') && (
                        <td className="py-3 px-4">
                          <span className="text-sm">{log.call_time ? formatDate(log.call_time) : '-'}</span>
                        </td>
                      )}
                      {isColumnVisible('company') && (
                        <td className="py-3 px-4">
                          {log.expand?.company ? (
                            <Link href={`/companies/${log.expand.company.id}`} className="font-medium hover:text-[var(--primary)] transition-colors">
                              {log.expand.company.company_name}
                            </Link>
                          ) : (
                            <span className="text-[var(--muted)]">Unknown</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('phone') && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-mono">{phoneNum || '-'}</span>
                            {phoneNum && <ZoomCallButton phoneNumber={phoneNum} />}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('recipient') && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{log.owner_name_found || '-'}</span>
                            {log.owner_reached && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] font-semibold uppercase">
                                Owner
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('call_outcome') && (
                        <td className="py-3 px-4">
                          {log.call_outcome && (
                            <span className={cn(
                              "px-2 py-1 rounded-md text-xs font-medium",
                              OUTCOME_COLORS[log.call_outcome]?.bg || 'bg-gray-500/20',
                              OUTCOME_COLORS[log.call_outcome]?.text || 'text-gray-400'
                            )}>
                              {log.call_outcome}
                            </span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('interest_level') && (
                        <td className="py-3 px-4">
                          {log.interest_level !== undefined && log.interest_level > 0 && (
                            <InterestBar level={log.interest_level} />
                          )}
                        </td>
                      )}
                      {isColumnVisible('duration') && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                            <Clock size={12} />
                            <span>{formatCallDuration(log.duration)}</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('performance') && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            {log.owner_reached && (
                              <span className="p-1 rounded bg-[var(--success-subtle)]" title="Owner Reached">
                                <UserCheck size={12} className="text-[var(--success)]" />
                              </span>
                            )}
                            {log.pitch_completed && (
                              <span className="p-1 rounded bg-[var(--info-subtle)]" title="Pitch Completed">
                                <Target size={12} className="text-[var(--info)]" />
                              </span>
                            )}
                            {log.appointment_set && (
                              <span className="p-1 rounded bg-[var(--warning-subtle)]" title="Appointment Set">
                                <CalendarCheck size={12} className="text-[var(--warning)]" />
                              </span>
                            )}
                            {!log.owner_reached && !log.pitch_completed && !log.appointment_set && (
                              <span className="text-xs text-[var(--muted)]">-</span>
                            )}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('session') && (
                        <td className="py-3 px-4">
                          {session ? (
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-[var(--foreground)]">
                                {session.started_at ? formatDate(session.started_at) : '-'}
                              </span>
                              <span className="text-[10px] text-[var(--muted)]">
                                {session.total_dials || 0} dials &middot; {session.total_pickups || 0} pickups
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--muted)] italic">Standalone</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('caller') && (
                        <td className="py-3 px-4">
                          <span className="text-sm">{log.expand?.caller?.name || '-'}</span>
                        </td>
                      )}
                      {isColumnVisible('notes') && (
                        <td className="py-3 px-4 max-w-[200px]">
                          <span className="text-xs text-[var(--muted)] line-clamp-2">
                            {log.post_call_notes || '-'}
                          </span>
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <Link
                          href={`/cold-calls/${log.id}?type=log`}
                          className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors inline-block"
                          title="View Details"
                        >
                          <Eye size={16} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-[var(--card-border)]">
              <span className="text-sm text-[var(--muted)]">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                >
                  Previous
                </button>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Cold Calls (AI Transcripts) Table ───────────────────────────────────────

function ColdCallsTable({
  calls,
  sort,
  onSort,
  isColumnVisible,
  hasActiveFilters,
  page,
  totalPages,
  onPageChange,
}: {
  calls: ColdCall[];
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  isColumnVisible: (key: string) => boolean;
  hasActiveFilters: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
      {calls.length === 0 ? (
        <div className="p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--info-subtle)] flex items-center justify-center mx-auto mb-4">
            <Zap size={24} className="text-[var(--info)]" />
          </div>
          <p className="text-sm font-medium">No AI transcripts found</p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Transcribe some call recordings to see them here'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                <tr>
                  {isColumnVisible('created') && <SortHeader label="Date" field="created" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('company') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Company</th>}
                  {isColumnVisible('phone_number') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>}
                  {isColumnVisible('recipients') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Recipient</th>}
                  {isColumnVisible('call_outcome') && <SortHeader label="Outcome" field="call_outcome" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('interest_level') && <SortHeader label="Interest" field="interest_level" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('claimed_by') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Claimed By</th>}
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr
                    key={call.id}
                    className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors"
                  >
                    {isColumnVisible('created') && (
                      <td className="py-3 px-4">
                        <span className="text-sm">{call.created ? formatDate(call.created) : '-'}</span>
                      </td>
                    )}
                    {isColumnVisible('company') && (
                      <td className="py-3 px-4">
                        <span className="font-medium">
                          {call.expand?.company?.company_name || 'Unknown'}
                        </span>
                      </td>
                    )}
                    {isColumnVisible('phone_number') && (
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-mono">{call.phone_number || '-'}</span>
                          {call.phone_number && <ZoomCallButton phoneNumber={call.phone_number} />}
                        </div>
                      </td>
                    )}
                    {isColumnVisible('recipients') && (
                      <td className="py-3 px-4">
                        <span className="text-sm">{call.recipients || '-'}</span>
                      </td>
                    )}
                    {isColumnVisible('call_outcome') && (
                      <td className="py-3 px-4">
                        {call.call_outcome && (
                          <span className={cn(
                            "px-2 py-1 rounded-md text-xs font-medium",
                            OUTCOME_COLORS[call.call_outcome]?.bg || 'bg-gray-500/20',
                            OUTCOME_COLORS[call.call_outcome]?.text || 'text-gray-400'
                          )}>
                            {call.call_outcome}
                          </span>
                        )}
                      </td>
                    )}
                    {isColumnVisible('interest_level') && (
                      <td className="py-3 px-4">
                        {call.interest_level !== undefined && (
                          <InterestBar level={call.interest_level} />
                        )}
                      </td>
                    )}
                    {isColumnVisible('claimed_by') && (
                      <td className="py-3 px-4">
                        <span className="text-sm">{call.expand?.claimed_by?.name || '-'}</span>
                      </td>
                    )}
                    <td className="py-3 px-4">
                      <Link
                        href={`/cold-calls/${call.id}`}
                        className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors inline-block"
                        title="View Details"
                      >
                        <Eye size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-[var(--card-border)]">
              <span className="text-sm text-[var(--muted)]">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                >
                  Previous
                </button>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}