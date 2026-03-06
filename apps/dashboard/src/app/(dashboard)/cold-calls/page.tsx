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
  Hash,
  PhoneForwarded,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { ColdCallsTableSkeleton } from '@/components/dashboard-skeletons';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { ZoomCallButton } from '@/components/zoom-call-button';
import { PhoneNumbersTab } from '@/components/phone-numbers-tab';

// ─── Column Definitions ──────────────────────────────────────────────────────

const CALL_LOG_COLUMNS: ColumnDefinition[] = [
  { key: 'call_time', label: 'Date', defaultVisible: true },
  { key: 'company', label: 'Company', defaultVisible: true },
  { key: 'phone', label: 'Phone', defaultVisible: true },
  { key: 'recipient', label: 'Recipient', defaultVisible: true },
  { key: 'call_outcome', label: 'Outcome', defaultVisible: true },
  { key: 'duration', label: 'Duration', defaultVisible: true },
  { key: 'performance', label: 'Performance', defaultVisible: true },
  { key: 'session', label: 'Session', defaultVisible: true },
  { key: 'ai_transcript', label: 'AI', defaultVisible: true },
  { key: 'caller', label: 'Caller', defaultVisible: false },
  { key: 'notes', label: 'Notes', defaultVisible: false },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

// ─── Shared Components ───────────────────────────────────────────────────────

const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
  'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
  'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
  'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Fumbled': { bg: 'bg-orange-500/10', text: 'text-orange-500' },
  'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
};

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

type TabType = 'call_logs' | 'phone_numbers';

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

  // Shared filters
  const [searchTerm, setSearchTerm] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'call_time',
    dir: 'desc'
  });
  const perPage = 20;

  // Column visibility
  const callLogCols = useColumnVisibility('cold-calls-logs', CALL_LOG_COLUMNS);

  // ─── Fetch Call Logs ─────────────────────────────────────────────────────

  const fetchCallLogs = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setCallLogsLoading(true);
      setCallLogsError(null);

      const filters: string[] = [];

      if (searchTerm) {
        const safe = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        filters.push(`(expand.company.company_name ~ "${safe}" || expand.phone_number_record.phone_number ~ "${safe}" || owner_name_found ~ "${safe}" || post_call_notes ~ "${safe}")`);
      }
      if (outcomeFilter.length > 0) {
        const outcomeConditions = outcomeFilter.map(o => `call_outcome = "${o}"`).join(' || ');
        filters.push(`(${outcomeConditions})`);
      }
      const sortField = sort.field;
      const result = await pb.collection(COLLECTIONS.CALL_LOGS).getList<CallLog>(callLogsPage, perPage, {
        sort: `${sort.dir === 'desc' ? '-' : ''}${sortField}`,
        expand: 'company,phone_number_record,caller,session,cold_call',
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
  }, [callLogsPage, sort, searchTerm, outcomeFilter, isAuthenticated]);

  // Fetch on mount and when deps change
  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'call_logs') {
      fetchCallLogs();
    }
  }, [isAuthenticated, activeTab, fetchCallLogs]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'call_logs') {
      setSort({ field: 'call_time', dir: 'desc' });
    }
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
  };

  // ─── CSV Export ──────────────────────────────────────────────────────────

  const exportToCSV = () => {
    const headers = ['Date', 'Company', 'Phone', 'Recipient', 'Outcome', 'Duration (s)', 'Owner Reached', 'Pitch Completed', 'Appointment Set', 'AI Transcript', 'Session', 'Caller', 'Notes'];
    const rows = callLogs.map(log => [
      log.call_time ? formatDate(log.call_time) : '',
      log.expand?.company?.company_name || 'Unknown',
      log.expand?.phone_number_record?.phone_number || '',
      log.owner_name_found || '',
      Array.isArray(log.call_outcome) ? log.call_outcome.join(', ') : (log.call_outcome || ''),
      log.duration?.toString() || '',
      log.owner_reached ? 'Yes' : 'No',
      log.pitch_completed ? 'Yes' : 'No',
      log.appointment_set ? 'Yes' : 'No',
      log.cold_call ? 'Yes' : 'No',
      log.session ? 'Yes' : '',
      log.expand?.caller?.name || '',
      log.post_call_notes || '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters = !!searchTerm || outcomeFilter.length > 0;
  const loading = activeTab === 'call_logs' ? callLogsLoading : false;

  if (authLoading) {
    return <ColdCallsTableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cold Calls</h1>
          <p className="text-[var(--muted)] mt-1">View all call logs and phone numbers</p>
        </div>

        <div className="flex items-center gap-2">
          <SearchInput
            placeholder="Search..."
            onSearch={setSearchTerm}
            defaultValue={searchTerm}
            key={`${activeTab}-${searchTerm}`}
            className="w-full sm:w-64"
          />

          {activeTab === 'call_logs' && (
            <>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                  showFilters || outcomeFilter.length > 0
                    ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]"
                    : "border-[var(--card-border)] hover:bg-[var(--card-bg)]"
                )}
              >
                <Filter size={16} />
                Filters
                {outcomeFilter.length > 0 && (
                  <span className="ml-1 w-5 h-5 rounded-full bg-[var(--background)]/20 text-xs flex items-center justify-center">
                    {outcomeFilter.length}
                  </span>
                )}
              </button>

              <button
                onClick={exportToCSV}
                disabled={callLogs.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors disabled:opacity-50"
              >
                <Download size={16} />
                Export
              </button>

              <ColumnSelector
                columns={callLogCols.columns}
                visibleColumns={callLogCols.visibleColumns}
                onToggle={callLogCols.toggleColumn}
              />

              <button
                onClick={fetchCallLogs}
                className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors"
                title="Refresh"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </>
          )}
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
          onClick={() => handleTabChange('phone_numbers')}
          className={cn(
            "px-4 py-2 rounded-md text-sm font-medium transition-all",
            activeTab === 'phone_numbers'
              ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          )}
        >
          <div className="flex items-center gap-2">
            <Hash size={14} />
            Phone Numbers
          </div>
        </button>
      </div>

      {/* Filters Panel (call logs only) */}
      {activeTab === 'call_logs' && showFilters && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Filters</h3>
            {outcomeFilter.length > 0 && (
              <button onClick={clearFilters} className="text-sm text-[var(--primary)] hover:underline">
                Clear all
              </button>
            )}
          </div>
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
        </div>
      )}

      {/* Error */}
      {activeTab === 'call_logs' && callLogsError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
          {callLogsError}
        </div>
      )}

      {/* Table content */}
      {activeTab === 'call_logs' ? (
        callLogsLoading ? (
          <ColdCallsTableSkeleton />
        ) : (
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
        )
      ) : (
        <PhoneNumbersTab searchTerm={searchTerm} />
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
                  {isColumnVisible('duration') && <SortHeader label="Duration" field="duration" currentSort={sort} onSort={onSort} />}
                  {isColumnVisible('performance') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Performance</th>}
                  {isColumnVisible('session') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Session</th>}
                  {isColumnVisible('ai_transcript') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">AI</th>}
                  {isColumnVisible('caller') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Caller</th>}
                  {isColumnVisible('notes') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Notes</th>}
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const phoneNum = log.expand?.phone_number_record?.phone_number || '';
                  const session = log.expand?.session;
                  const coldCall = log.expand?.cold_call;

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
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(Array.isArray(log.call_outcome) ? log.call_outcome : log.call_outcome ? [log.call_outcome] : []).map(oc => (
                              <span key={oc} className={cn(
                                "px-2 py-1 rounded-md text-xs font-medium",
                                OUTCOME_COLORS[oc]?.bg || 'bg-gray-500/20',
                                OUTCOME_COLORS[oc]?.text || 'text-gray-400'
                              )}>
                                {oc}
                              </span>
                            ))}
                            {(log.callback_events?.length ?? 0) > 0 && (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--warning-subtle)] text-[var(--warning)] border border-[var(--warning)]/30"
                                title={`${log.callback_events!.length} callback(s): ${log.callback_events!.map(e => e.reason).join(', ')}`}
                              >
                                <PhoneForwarded size={9} />
                                Callback
                              </span>
                            )}
                          </div>
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
                      {isColumnVisible('ai_transcript') && (
                        <td className="py-3 px-4">
                          {coldCall ? (
                            <Link
                              href={`/cold-calls/${coldCall.id}`}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--info-subtle)] text-[var(--info)] text-xs font-medium hover:opacity-80 transition-opacity"
                              title="View AI Transcript"
                            >
                              <Zap size={10} />
                              AI
                            </Link>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">-</span>
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
