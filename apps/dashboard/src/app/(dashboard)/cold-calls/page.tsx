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
import { formatDate, formatPhoneNumber, cn, buildPhoneSearchFilter, sanitizeFilterValue, stripPhoneFormatting } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { getOutcomeColors } from '@/lib/call-outcomes';
import { ColdCallsTableSkeleton } from '@/components/dashboard-skeletons';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { PhoneHoverCard } from '@/components/phone-hover-card';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { CallButton } from '@/components/call-button';
import { PageGuard } from '@/components/page-guard';
import { PhoneNumbersTab } from '@/components/phone-numbers-tab';
import { RelativeTime } from '@/components/relative-time';
import {
  TableContainer,
  IndexCell,
  HeaderIndexCell,
  ResizableTh,
  useResizableColumns,
  useTableSelection,
  TablePagination,
  TableEmptyState,
} from '@/components/ui/data-table';

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

// Outcome filter options (built-in outcomes for the filter UI)
const OUTCOME_FILTER_OPTIONS = [
  'Interested', 'Not Interested', 'Callback', 'No Answer', 'Fumbled',
  'Bad Lead', 'Send Email', 'Hung Up (Rude Recep)', 'Hung Up (Other)', 'Missed Call',
];

function SortLabel({
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
    <div
      className="flex items-center gap-1 cursor-pointer"
      onClick={() => onSort(field)}
    >
      {label}
      {isActive && (
        currentSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
      )}
    </div>
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
  const { preferences } = useUserPreferences();
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

  // Selection & resizable columns
  const selection = useTableSelection(callLogs);
  const { widths: colWidths, resize: resizeCol } = useResizableColumns('cold-calls', [
    { key: 'call_time', initialWidth: 130, minWidth: 90 },
    { key: 'company', initialWidth: 160, minWidth: 100 },
    { key: 'phone', initialWidth: 140, minWidth: 100 },
    { key: 'recipient', initialWidth: 130, minWidth: 80 },
    { key: 'call_outcome', initialWidth: 150, minWidth: 90 },
    { key: 'duration', initialWidth: 90, minWidth: 70 },
    { key: 'performance', initialWidth: 100, minWidth: 70 },
    { key: 'session', initialWidth: 130, minWidth: 80 },
    { key: 'ai_transcript', initialWidth: 70, minWidth: 50 },
    { key: 'caller', initialWidth: 100, minWidth: 70 },
    { key: 'notes', initialWidth: 150, minWidth: 80 },
    { key: 'actions', initialWidth: 60, minWidth: 50 },
  ]);

  const pageOffset = (callLogsPage - 1) * perPage;

  // ─── Fetch Call Logs ─────────────────────────────────────────────────────

  const fetchCallLogs = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setCallLogsLoading(true);
      setCallLogsError(null);

      const filters: string[] = [];

      if (searchTerm) {
        const safe = sanitizeFilterValue(searchTerm);
        const digits = stripPhoneFormatting(searchTerm);
        const phoneCondition = digits.length >= 3
          ? buildPhoneSearchFilter('phone_number_record.phone_number', searchTerm)
          : `phone_number_record.phone_number ~ "${safe}"`;
        filters.push(`(company.company_name ~ "${safe}" || ${phoneCondition} || owner_name_found ~ "${safe}" || post_call_notes ~ "${safe}")`);
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
    <PageGuard pageKey="cold-calls">
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
              {OUTCOME_FILTER_OPTIONS.map(outcome => {
                const colors = getOutcomeColors(outcome);
                return (
                  <button
                    key={outcome}
                    onClick={() => toggleOutcomeFilter(outcome)}
                    className={cn(
                      "px-2 py-1 rounded-md text-xs transition-all",
                      outcomeFilter.includes(outcome)
                        ? `${colors.bg} ${colors.text}`
                        : "bg-[var(--sidebar-bg)] text-[var(--muted)] hover:bg-[var(--card-border)]"
                    )}
                  >
                    {outcome}
                  </button>
                );
              })}
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
            selection={selection}
            colWidths={colWidths}
            resizeCol={resizeCol}
            pageOffset={pageOffset}
            timezones={preferences?.timezones}
          />
        )
      ) : (
        <PhoneNumbersTab searchTerm={searchTerm} />
      )}
    </div>
    </PageGuard>
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
  selection,
  colWidths,
  resizeCol,
  pageOffset,
  timezones,
}: {
  logs: CallLog[];
  sort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
  isColumnVisible: (key: string) => boolean;
  hasActiveFilters: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  selection: ReturnType<typeof useTableSelection<CallLog>>;
  colWidths: Record<string, number>;
  resizeCol: (key: string, newWidth: number) => void;
  pageOffset: number;
  timezones?: { timezone: string; label: string }[];
}) {
  return (
    <TableContainer>
      {logs.length === 0 ? (
        <TableEmptyState
          icon={<Phone size={24} className="text-[var(--info)]" />}
          title="No call logs found"
          description={hasActiveFilters
            ? 'Try adjusting your filters'
            : 'Calls made during sessions will appear here'}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                <tr>
                  <HeaderIndexCell
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggleAll={selection.toggleAll}
                  />
                  {isColumnVisible('call_time') && (
                    <ResizableTh width={colWidths.call_time} minWidth={90} onResize={(w) => resizeCol('call_time', w)}>
                      <SortLabel label="Date" field="call_time" currentSort={sort} onSort={onSort} />
                    </ResizableTh>
                  )}
                  {isColumnVisible('company') && (
                    <ResizableTh width={colWidths.company} minWidth={100} onResize={(w) => resizeCol('company', w)}>
                      Company
                    </ResizableTh>
                  )}
                  {isColumnVisible('phone') && (
                    <ResizableTh width={colWidths.phone} minWidth={100} onResize={(w) => resizeCol('phone', w)}>
                      Phone
                    </ResizableTh>
                  )}
                  {isColumnVisible('recipient') && (
                    <ResizableTh width={colWidths.recipient} minWidth={80} onResize={(w) => resizeCol('recipient', w)}>
                      Recipient
                    </ResizableTh>
                  )}
                  {isColumnVisible('call_outcome') && (
                    <ResizableTh width={colWidths.call_outcome} minWidth={90} onResize={(w) => resizeCol('call_outcome', w)}>
                      <SortLabel label="Outcome" field="call_outcome" currentSort={sort} onSort={onSort} />
                    </ResizableTh>
                  )}
                  {isColumnVisible('duration') && (
                    <ResizableTh width={colWidths.duration} minWidth={70} onResize={(w) => resizeCol('duration', w)}>
                      <SortLabel label="Duration" field="duration" currentSort={sort} onSort={onSort} />
                    </ResizableTh>
                  )}
                  {isColumnVisible('performance') && (
                    <ResizableTh width={colWidths.performance} minWidth={70} onResize={(w) => resizeCol('performance', w)}>
                      Performance
                    </ResizableTh>
                  )}
                  {isColumnVisible('session') && (
                    <ResizableTh width={colWidths.session} minWidth={80} onResize={(w) => resizeCol('session', w)}>
                      Session
                    </ResizableTh>
                  )}
                  {isColumnVisible('ai_transcript') && (
                    <ResizableTh width={colWidths.ai_transcript} minWidth={50} onResize={(w) => resizeCol('ai_transcript', w)}>
                      AI
                    </ResizableTh>
                  )}
                  {isColumnVisible('caller') && (
                    <ResizableTh width={colWidths.caller} minWidth={70} onResize={(w) => resizeCol('caller', w)}>
                      Caller
                    </ResizableTh>
                  )}
                  {isColumnVisible('notes') && (
                    <ResizableTh width={colWidths.notes} minWidth={80} onResize={(w) => resizeCol('notes', w)}>
                      Notes
                    </ResizableTh>
                  )}
                  <ResizableTh width={colWidths.actions} minWidth={50} onResize={(w) => resizeCol('actions', w)} resizable={false}>
                    Actions
                  </ResizableTh>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => {
                  const phoneNum = log.expand?.phone_number_record?.phone_number || '';
                  const session = log.expand?.session;
                  const coldCall = log.expand?.cold_call;

                  return (
                    <tr
                      key={log.id}
                      className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors"
                    >
                      <IndexCell
                        index={pageOffset + idx + 1}
                        selected={selection.isSelected(log.id)}
                        onSelect={() => selection.toggle(log.id)}
                        forceCheckbox={selection.hasSelection}
                      />
                      {isColumnVisible('call_time') && (
                        <td className="py-3 px-4 overflow-hidden">
                          {log.call_time ? (
                            <RelativeTime date={log.call_time} timezones={timezones} className="text-sm" />
                          ) : (
                            <span className="text-sm">-</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('company') && (
                        <td className="py-3 px-4 overflow-visible">
                          {log.expand?.company ? (
                            <CompanyHoverCard company={log.expand.company}>
                              <Link href={`/companies/${log.expand.company.id}`} className="block truncate font-medium hover:text-[var(--primary)] transition-colors" title={log.expand.company.company_name}>
                                {log.expand.company.company_name}
                              </Link>
                            </CompanyHoverCard>
                          ) : (
                            <span className="text-[var(--muted)]">Unknown</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('phone') && (
                        <td className="py-3 px-4 overflow-visible">
                          <div className="flex items-center gap-1 min-w-0">
                            {phoneNum ? (
                              <PhoneHoverCard phoneRecord={log.expand?.phone_number_record} phoneNumber={phoneNum}>
                                <span className="text-sm font-mono truncate cursor-default">{formatPhoneNumber(phoneNum)}</span>
                              </PhoneHoverCard>
                            ) : (
                              <span className="text-sm font-mono">-</span>
                            )}
                            {phoneNum && <CallButton phoneNumber={phoneNum} />}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('recipient') && (
                        <td className="py-3 px-4 overflow-hidden">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm truncate">{log.owner_name_found || '-'}</span>
                            {log.owner_reached && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] font-semibold uppercase shrink-0">
                                Owner
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('call_outcome') && (
                        <td className="py-3 px-4 overflow-hidden">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {(Array.isArray(log.call_outcome) ? log.call_outcome : log.call_outcome ? [log.call_outcome] : []).map(oc => {
                              const colors = getOutcomeColors(oc);
                              return (
                                <span key={oc} className={cn("px-2 py-1 rounded-md text-xs font-medium", colors.bg, colors.text)}>
                                  {oc}
                                </span>
                              );
                            })}
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
                        <td className="py-3 px-4 overflow-hidden">
                          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                            <Clock size={12} className="shrink-0" />
                            <span className="truncate">{formatCallDuration(log.duration)}</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('performance') && (
                        <td className="py-3 px-4 overflow-hidden">
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
                        <td className="py-3 px-4 overflow-hidden">
                          {session ? (
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-medium text-[var(--foreground)] truncate">
                                {session.started_at ? formatDate(session.started_at) : '-'}
                              </span>
                              <span className="text-[10px] text-[var(--muted)] truncate">
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
                        <td className="py-3 px-4 overflow-hidden">
                          <span className="text-sm block truncate">{log.expand?.caller?.name || '-'}</span>
                        </td>
                      )}
                      {isColumnVisible('notes') && (
                        <td className="py-3 px-4 overflow-hidden">
                          <span className="text-xs text-[var(--muted)] block truncate" title={log.post_call_notes || undefined}>
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

          <TablePagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </>
      )}
    </TableContainer>
  );
}
