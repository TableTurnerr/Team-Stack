'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Phone,
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
  Headphones,
  Loader2,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type Recording, type User } from '@/lib/types';
import { RecordingPlayerOverlay } from '@/components/recording-player-overlay';
import { formatDate, formatPhoneNumber, cn, buildPhoneSearchFilter, sanitizeFilterValue, stripPhoneFormatting, formatCompanyName } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { getOutcomeColors } from '@/lib/call-outcomes';
import { ColdCallsTableSkeleton } from '@/components/dashboard-skeletons';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { PhoneHoverCard } from '@/components/phone-hover-card';
import { Tooltip } from '@/components/ui/tooltip';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { CallButton } from '@/components/call-button';
import { PageGuard } from '@/components/page-guard';
import { PhoneNumbersTab } from '@/components/phone-numbers-tab';
import { RelativeTime } from '@/components/relative-time';
import {
  FilterBuilder,
  FilterChips,
  buildDirectFilter,
  type FilterCondition,
  type FilterFieldDef,
  type FilterLogic,
} from '@/components/filter-builder';
import { DEFAULT_OUTCOMES } from '@/lib/call-outcomes';
import { useCustomCallOutcomes } from '@/hooks/use-custom-call-outcomes';
import {
  TableContainer,
  IndexCell,
  HeaderIndexCell,
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
  { key: 'session', label: 'Session', defaultVisible: true },
  { key: 'ai_transcript', label: 'AI', defaultVisible: false },
  { key: 'caller', label: 'Caller', defaultVisible: true },
  { key: 'notes', label: 'Notes', defaultVisible: false },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

// ─── Shared Components ───────────────────────────────────────────────────────

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

// ─── Filter fields ───────────────────────────────────────────────────────────

function buildColdCallsFilterFields(customOutcomes: readonly string[]): readonly FilterFieldDef[] {
  return [
    { key: 'call_outcome', label: 'Outcome', type: 'json_array', options: [...DEFAULT_OUTCOMES, ...customOutcomes], group: 'Calls' },
    { key: 'call_time', label: 'Date', type: 'date', group: 'Calls' },
    { key: 'direction', label: 'Direction', type: 'enum', options: ['outbound', 'inbound'] as const, group: 'Calls' },
    { key: 'owner_reached', label: 'Owner Reached', type: 'boolean', group: 'Calls' },
    { key: 'pitch_completed', label: 'Pitch Completed', type: 'boolean', group: 'Calls' },
    { key: 'appointment_set', label: 'Appointment Set', type: 'boolean', group: 'Calls' },
    { key: 'has_recording', label: 'Has Recording', type: 'boolean', group: 'Calls' },
    { key: 'post_call_notes', label: 'Notes', type: 'text', group: 'Notes' },
  ];
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ColdCallsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { preferences } = useUserPreferences();
  const { customOutcomes } = useCustomCallOutcomes();
  const filterFields = useMemo(() => buildColdCallsFilterFields(customOutcomes), [customOutcomes]);
  const [activeTab, setActiveTab] = useState<TabType>('call_logs');

  // Call Logs state
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [callLogsLoading, setCallLogsLoading] = useState(true);
  const [callLogsError, setCallLogsError] = useState<string | null>(null);
  const [callLogsPage, setCallLogsPage] = useState(1);
  const [callLogsTotalPages, setCallLogsTotalPages] = useState(1);

  // Shared filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<FilterLogic>('AND');
  const [appliedConditions, setAppliedConditions] = useState<FilterCondition[]>([]);
  const [appliedLogic, setAppliedLogic] = useState<FilterLogic>('AND');
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'call_time',
    dir: 'desc'
  });
  const perPage = 20;

  // Column visibility
  const callLogCols = useColumnVisibility('cold-calls-logs', CALL_LOG_COLUMNS);

  // Selection
  const selection = useTableSelection(callLogs);

  // Recording player
  const [playerRecording, setPlayerRecording] = useState<Recording | null>(null);
  const [playerLoading, setPlayerLoading] = useState<string | null>(null);

  const handlePlayRecording = async (log: CallLog) => {
    if (playerLoading === log.id) return;
    setPlayerLoading(log.id);
    try {
      const recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
        `call_log = "${log.id}"`
      );
      setPlayerRecording(recording);
    } catch {
      try {
        const phoneNumber = log.expand?.phone_number_record?.phone_number;
        if (phoneNumber) {
          const last10 = phoneNumber.replace(/\D/g, '').slice(-10);
          const recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
            `phone_number ~ "${last10}"`,
            { sort: '-recording_date' }
          );
          setPlayerRecording(recording);
        }
      } catch {
        // No recording found
      }
    } finally {
      setPlayerLoading(null);
    }
  };

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
      const conditionsFilter = buildDirectFilter(appliedConditions, appliedLogic, filterFields);
      if (conditionsFilter) filters.push(conditionsFilter);

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
  }, [callLogsPage, sort, searchTerm, appliedConditions, appliedLogic, isAuthenticated, filterFields]);

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

  const hasActiveFilters = !!searchTerm || appliedConditions.length > 0;
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
              <FilterBuilder
                fields={filterFields}
                conditions={filterConditions}
                logic={filterLogic}
                onChange={(c, l) => {
                  setFilterConditions(c);
                  setFilterLogic(l);
                  setAppliedConditions(c);
                  setAppliedLogic(l);
                  setCallLogsPage(1);
                }}
                title="Filter"
              />

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
                onReset={callLogCols.resetToDefault}
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

      {/* Active filters strip */}
      {activeTab === 'call_logs' && appliedConditions.length > 0 && (
        <FilterChips
          conditions={appliedConditions}
          fields={filterFields}
          onRemove={(id) => {
            const next = appliedConditions.filter(c => c.id !== id);
            setFilterConditions(next);
            setAppliedConditions(next);
            setCallLogsPage(1);
          }}
          onClear={() => {
            setFilterConditions([]);
            setAppliedConditions([]);
            setCallLogsPage(1);
          }}
        />
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
            pageOffset={pageOffset}
            timezones={preferences?.timezones}
            onPlayRecording={handlePlayRecording}
            playerLoading={playerLoading}
          />
        )
      ) : (
        <PhoneNumbersTab searchTerm={searchTerm} />
      )}

      <RecordingPlayerOverlay
        recording={playerRecording}
        onClose={() => setPlayerRecording(null)}
      />
    </div>
    </PageGuard>
  );
}

// ─── Caller Avatar with hover card ───────────────────────────────────────────

function CallerAvatar({ caller }: { caller: User }) {
  const [hovered, setHovered] = useState(false);
  const avatarUrl = caller.avatar ? pb.files.getUrl(caller, caller.avatar) : null;

  const statusColor =
    caller.status === 'suspended' ? 'bg-[var(--muted)]' :
    caller.status === 'online'    ? 'bg-[var(--success)]' :
                                    'bg-[var(--muted-foreground)]';

  const statusLabel =
    caller.status === 'suspended' ? 'Suspended' :
    caller.status === 'online'    ? 'Online' : 'Offline';

  const lastSeen = (() => {
    if (caller.status === 'online' || !caller.last_activity) return null;
    const mins = Math.floor((Date.now() - new Date(caller.last_activity).getTime()) / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  })();

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="w-8 h-8 rounded-full border-2 border-[var(--card-bg)] flex items-center justify-center overflow-hidden relative flex-shrink-0 cursor-default">
        {avatarUrl ? (
          <Image src={avatarUrl} alt={caller.name} fill sizes="32px" className="object-cover" />
        ) : (
          <div className="w-full h-full bg-[var(--primary)] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">{caller.name?.charAt(0).toUpperCase() || '?'}</span>
          </div>
        )}
      </div>
      <div className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--card-bg)]', statusColor)} />

      {hovered && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-[60] min-w-[200px] p-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg pointer-events-none">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden relative flex-shrink-0">
              {avatarUrl ? (
                <Image src={avatarUrl} alt={caller.name} fill sizes="40px" className="object-cover" />
              ) : (
                <div className="w-full h-full bg-[var(--primary)] flex items-center justify-center">
                  <span className="text-white text-sm font-bold">{caller.name?.charAt(0).toUpperCase() || '?'}</span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{caller.name}</p>
              <p className="text-[11px] text-[var(--muted)] truncate">{caller.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--card-border)]">
            <div className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColor)} />
            <span className="text-[11px] text-[var(--muted)]">
              {statusLabel}
              {statusLabel === 'Offline' && lastSeen && (
                <span className="opacity-70"> - Last seen {lastSeen}</span>
              )}
            </span>
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-1 capitalize">{caller.role}</p>
        </div>
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
  selection,
  pageOffset,
  timezones,
  onPlayRecording,
  playerLoading,
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
  pageOffset: number;
  timezones?: { timezone: string; label: string }[];
  onPlayRecording: (log: CallLog) => void;
  playerLoading: string | null;
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
          <div className="overflow-x-hidden">
            <table className="w-full" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                <tr>
                  <HeaderIndexCell
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggleAll={selection.toggleAll}
                  />
                  {isColumnVisible('call_time') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 95 }}>
                      <SortLabel label="Date" field="call_time" currentSort={sort} onSort={onSort} />
                    </th>
                  )}
                  {isColumnVisible('company') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left">
                      Company
                    </th>
                  )}
                  {isColumnVisible('phone') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 138 }}>
                      Phone
                    </th>
                  )}
                  {isColumnVisible('recipient') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 105 }}>
                      Recipient
                    </th>
                  )}
                  {isColumnVisible('call_outcome') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 145 }}>
                      <SortLabel label="Outcome" field="call_outcome" currentSort={sort} onSort={onSort} />
                    </th>
                  )}
                  {isColumnVisible('duration') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 110 }}>
                      <SortLabel label="Duration" field="duration" currentSort={sort} onSort={onSort} />
                    </th>
                  )}
                  {isColumnVisible('session') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 115 }}>
                      Session
                    </th>
                  )}
                  {isColumnVisible('ai_transcript') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 50 }}>
                      AI
                    </th>
                  )}
                  {isColumnVisible('caller') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 54 }}>
                      Caller
                    </th>
                  )}
                  {isColumnVisible('notes') && (
                    <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left">
                      Notes
                    </th>
                  )}
                  <th className="py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-left" style={{ width: 148 }}>
                    Other
                  </th>
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
                        <td className="py-3.5 px-4 overflow-hidden">
                          {log.call_time ? (
                            <RelativeTime date={log.call_time} timezones={timezones} className="text-sm" />
                          ) : (
                            <span className="text-sm">-</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('company') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          {log.expand?.company ? (
                            <CompanyHoverCard company={log.expand.company} className="block min-w-0 max-w-full">
                              <Link href={`/companies/${log.expand.company.id}`} className="block truncate font-medium hover:text-[var(--primary)] transition-colors">
                                {formatCompanyName(log.expand.company.company_name)}
                              </Link>
                            </CompanyHoverCard>
                          ) : (
                            <span className="text-[var(--muted)]">Unknown</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('phone') && (
                        <td className="py-3.5 px-4 overflow-hidden">
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
                        <td className="py-3.5 px-4 overflow-hidden">
                          <Tooltip content={
                            <div className="text-[11px]">
                              <div className="font-semibold">{log.owner_name_found || 'No contact recorded'}</div>
                              {log.owner_reached && <div className="text-[var(--success)] mt-0.5">Owner reached</div>}
                            </div>
                          }>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm truncate">{log.owner_name_found || '-'}</span>
                              {log.owner_reached && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] font-semibold uppercase shrink-0">
                                  Owner
                                </span>
                              )}
                            </div>
                          </Tooltip>
                        </td>
                      )}
                      {isColumnVisible('call_outcome') && (
                        <td className="py-3.5 px-4 overflow-hidden">
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
                              <Tooltip content={
                                <div className="text-[11px]">
                                  <div className="font-semibold mb-1">{log.callback_events!.length} callback{log.callback_events!.length !== 1 ? 's' : ''}</div>
                                  {log.callback_events!.map((e, i) => (
                                    <div key={i} className="text-[var(--muted)]">{e.reason}</div>
                                  ))}
                                </div>
                              } className="whitespace-normal max-w-[200px]">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--warning-subtle)] text-[var(--warning)] border border-[var(--warning)]/30">
                                  <PhoneForwarded size={9} />
                                  Callback
                                </span>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('duration') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                            <Clock size={12} className="shrink-0" />
                            <span className="truncate">{formatCallDuration(log.duration)}</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('session') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          {session ? (
                            <Tooltip content={
                              <div className="text-[11px] flex flex-col gap-1 py-0.5">
                                <div className="font-semibold">{session.started_at ? formatDate(session.started_at) : 'Unknown date'}</div>
                                <div className="text-[var(--muted)]">{session.total_dials || 0} dials · {session.total_pickups || 0} pickups</div>
                                {session.total_duration != null && <div className="text-[var(--muted)]">{formatCallDuration(session.total_duration)} total</div>}
                              </div>
                            } className="whitespace-normal min-w-[160px]">
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-medium text-[var(--foreground)] truncate">
                                  {session.started_at ? formatDate(session.started_at) : '-'}
                                </span>
                                <span className="text-[10px] text-[var(--muted)] truncate">
                                  {session.total_dials || 0} dials &middot; {session.total_pickups || 0} pickups
                                </span>
                              </div>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-[var(--muted)] italic">Standalone</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('ai_transcript') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          {coldCall ? (
                            <Tooltip content="View AI Transcript">
                              <Link
                                href={`/cold-calls/${coldCall.id}`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--info-subtle)] text-[var(--info)] text-xs font-medium hover:opacity-80 transition-opacity"
                              >
                                <Zap size={10} />
                                AI
                              </Link>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">-</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('caller') && (
                        <td className="py-3.5 px-4 overflow-visible">
                          {log.expand?.caller ? (
                            <CallerAvatar caller={log.expand.caller} />
                          ) : (
                            <span className="text-xs text-[var(--muted)]">-</span>
                          )}
                        </td>
                      )}
                      {isColumnVisible('notes') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          {log.post_call_notes ? (
                            <Tooltip content={
                              <div className="text-[11px] max-w-[260px] whitespace-pre-wrap leading-relaxed">
                                {log.post_call_notes}
                              </div>
                            } className="whitespace-normal max-w-[260px]">
                              <span className="text-xs text-[var(--muted)] block truncate cursor-default">
                                {log.post_call_notes}
                              </span>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-[var(--muted)]">-</span>
                          )}
                        </td>
                      )}
                      <td className="py-3.5 px-4 overflow-hidden">
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          {log.has_recording && (
                            <Tooltip content="Play Recording">
                              <button
                                onClick={() => onPlayRecording(log)}
                                disabled={playerLoading === log.id}
                                className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--primary)] transition-colors inline-flex items-center justify-center disabled:opacity-60"
                              >
                                {playerLoading === log.id
                                  ? <Loader2 size={14} className="animate-spin" />
                                  : <Headphones size={14} />
                                }
                              </button>
                            </Tooltip>
                          )}
                          {log.owner_reached && (
                            <Tooltip content="Owner Reached">
                              <span className="p-1 rounded bg-[var(--success-subtle)] inline-flex items-center justify-center">
                                <UserCheck size={12} className="text-[var(--success)]" />
                              </span>
                            </Tooltip>
                          )}
                          {log.pitch_completed && (
                            <Tooltip content="Pitch Completed">
                              <span className="p-1 rounded bg-[var(--info-subtle)] inline-flex items-center justify-center">
                                <Target size={12} className="text-[var(--info)]" />
                              </span>
                            </Tooltip>
                          )}
                          {log.appointment_set && (
                            <Tooltip content="Appointment Set">
                              <span className="p-1 rounded bg-[var(--warning-subtle)] inline-flex items-center justify-center">
                                <CalendarCheck size={12} className="text-[var(--warning)]" />
                              </span>
                            </Tooltip>
                          )}
                          <Tooltip content="View Details">
                            <Link
                              href={`/cold-calls/${log.id}?type=log`}
                              className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors inline-block"
                            >
                              <Eye size={16} />
                            </Link>
                          </Tooltip>
                        </div>
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
