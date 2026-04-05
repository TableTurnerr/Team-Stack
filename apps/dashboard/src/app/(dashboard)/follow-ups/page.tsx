'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Building2,
  User,
  RefreshCw,
  Loader2,
  Search,
  ChevronRight,
  CheckCheck,
  Ban,
  ClipboardCheck,
  Zap,
  UserCog,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type FollowUp, type User as UserType } from '@/lib/types';
import { cn, formatPhoneNumber } from '@/lib/utils';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { useFollowUps } from '@/contexts/follow-up-context';
import { FollowUpTimeDisplay } from '@/components/follow-up-time-display';
import { formatDateTimeInTimezone } from '@/lib/timezone-utils';
import {
  TableContainer,
  IndexCell,
  HeaderIndexCell,
  ResizableTh,
  useResizableColumns,
  TableEmptyState,
  SelectionToolbar,
} from '@/components/ui/data-table';
import { PageGuard } from '@/components/page-guard';

type StatusFilter = 'overdue' | 'upcoming' | 'completed' | 'dismissed';

const STATUS_TABS: { id: StatusFilter; label: string; icon: LucideIcon }[] = [
  { id: 'overdue',   label: 'Overdue',   icon: AlertCircle },
  { id: 'upcoming',  label: 'Upcoming',  icon: Clock },
  { id: 'completed', label: 'Completed', icon: CheckCheck },
  { id: 'dismissed', label: 'Dismissed', icon: Ban },
];

function statusBadge(status: string, isOverdue: boolean) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400">
        <CheckCircle2 size={10} /> Completed
      </span>
    );
  }
  if (status === 'dismissed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--card-hover)] text-[var(--muted)]">
        <Ban size={10} /> Dismissed
      </span>
    );
  }
  if (isOverdue) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400">
        <AlertCircle size={10} /> Overdue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400">
      <Clock size={10} /> Upcoming
    </span>
  );
}

export default function FollowUpsPage() {
  const { completeFollowUp, dismissFollowUp } = useFollowUps();
  const [allFollowUps, setAllFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<StatusFilter>('overdue');
  const [search, setSearch] = useState('');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [teamMembers, setTeamMembers] = useState<UserType[]>([]);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);

  const { getWidth, resize } = useResizableColumns('follow-ups', [
    { key: 'company', initialWidth: 200 },
    { key: 'scheduled', initialWidth: 150 },
    { key: 'assigned_to', initialWidth: 130 },
    { key: 'phone', initialWidth: 130 },
    { key: 'notes', initialWidth: 180 },
    { key: 'status', initialWidth: 100 },
    { key: 'actions', initialWidth: 120 },
  ]);

  const fetchAll = useCallback(async () => {
    try {
      const results = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
        sort: 'scheduled_time',
        expand: 'company,phone_number_record,assigned_to,created_by',
      });
      setAllFollowUps(results);
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  // Fetch team members for bulk reassign
  useEffect(() => {
    pb.collection(COLLECTIONS.USERS).getFullList<UserType>({ filter: 'status != "suspended"' })
      .then(setTeamMembers)
      .catch(() => {});
  }, []);

  // Close assignee dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setAssigneeDropdownOpen(false);
      }
    };
    if (assigneeDropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [assigneeDropdownOpen]);

  // Clear selection when tab or search changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab, search]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const handleComplete = async (fu: FollowUp) => {
    setActioningId(fu.id);
    try {
      await completeFollowUp(fu.id);
      setAllFollowUps(prev =>
        prev.map(f => f.id === fu.id ? { ...f, status: 'completed', completed_at: new Date().toISOString() } : f)
      );
    } finally {
      setActioningId(null);
    }
  };

  const handleDismiss = async (fu: FollowUp) => {
    setActioningId(fu.id);
    try {
      await dismissFollowUp(fu.id);
      setAllFollowUps(prev =>
        prev.map(f => f.id === fu.id ? { ...f, status: 'dismissed' } : f)
      );
    } finally {
      setActioningId(null);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const now = new Date();

  // Categorise
  const overdue   = allFollowUps.filter(f => f.status === 'pending'   && new Date(f.scheduled_time) < now);
  const upcoming  = allFollowUps.filter(f => f.status === 'pending'   && new Date(f.scheduled_time) >= now);
  const completed = allFollowUps.filter(f => f.status === 'completed');
  const dismissed = allFollowUps.filter(f => f.status === 'dismissed');

  const counts: Record<StatusFilter, number> = { overdue: overdue.length, upcoming: upcoming.length, completed: completed.length, dismissed: dismissed.length };

  const baseList: Record<StatusFilter, FollowUp[]> = { overdue, upcoming, completed, dismissed };

  // Search filter
  const filtered = baseList[activeTab].filter(fu => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const company = fu.expand?.company?.company_name?.toLowerCase() ?? '';
    const notes   = fu.notes?.toLowerCase() ?? '';
    const assignee = (fu.expand?.assigned_to?.name ?? fu.expand?.assigned_to?.email ?? '').toLowerCase();
    return company.includes(q) || notes.includes(q) || assignee.includes(q);
  });

  const allSelected = filtered.length > 0 && filtered.every(fu => selectedIds.has(fu.id));
  const someSelected = filtered.some(fu => selectedIds.has(fu.id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(fu => fu.id)));
    }
  };

  const handleCopyForPowerDialer = async () => {
    const targets = selectedIds.size > 0
      ? filtered.filter(fu => selectedIds.has(fu.id))
      : filtered;

    const categoryLabel = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
    const lines = targets.map((fu, i) => {
      const companyName = fu.expand?.company?.company_name ?? 'Unknown Company';
      const phone = fu.expand?.phone_number_record?.phone_number ?? 'No phone';
      const notes = fu.notes?.trim() || 'No notes';
      return `${i + 1}. ${companyName}\n   Phone: ${phone}\n   Notes: ${notes}`;
    });

    const header = `=== POWER DIALER LIST — ${categoryLabel} (${targets.length} contact${targets.length !== 1 ? 's' : ''}) ===\n\n`;
    const text = header + lines.join('\n\n');

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleBulkReassign = async (userId: string | null) => {
    if (selectedIds.size === 0) return;
    setBulkAssigning(true);
    setAssigneeDropdownOpen(false);
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          pb.collection(COLLECTIONS.FOLLOW_UPS).update(id, { assigned_to: userId ?? '' })
        )
      );
      // Update local state
      setAllFollowUps(prev =>
        prev.map(f =>
          selectedIds.has(f.id)
            ? {
                ...f,
                assigned_to: userId ?? '',
                expand: {
                  ...f.expand,
                  assigned_to: userId ? teamMembers.find(m => m.id === userId) : undefined,
                },
              }
            : f
        )
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to bulk reassign:', err);
    } finally {
      setBulkAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <PageGuard pageKey="follow-ups">
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-subtle)] flex items-center justify-center">
            <CalendarClock size={20} className="text-[var(--primary)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Follow-Ups</h1>
            <p className="text-sm text-[var(--muted)]">
              {overdue.length > 0
                ? `${overdue.length} overdue · ${upcoming.length} upcoming`
                : `${upcoming.length} upcoming`}
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-sm text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-all"
        >
          <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Overdue',   count: overdue.length,   color: 'text-red-400',   bg: 'bg-red-500/10',   icon: AlertCircle },
          { label: 'Upcoming',  count: upcoming.length,  color: 'text-blue-400',  bg: 'bg-blue-500/10',  icon: Clock },
          { label: 'Completed', count: completed.length, color: 'text-green-400', bg: 'bg-green-500/10', icon: CheckCheck },
          { label: 'Dismissed', count: dismissed.length, color: 'text-[var(--muted)]', bg: 'bg-[var(--card-hover)]', icon: Ban },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => setActiveTab(s.label.toLowerCase() as StatusFilter)}
            className={cn(
              'flex flex-col gap-2 p-4 rounded-xl border transition-all text-left',
              activeTab === s.label.toLowerCase()
                ? 'bg-[var(--card-bg)] border-[var(--primary)] shadow-sm'
                : 'bg-[var(--card-bg)] border-[var(--card-border)] hover:border-[var(--card-hover)]'
            )}
          >
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', s.bg)}>
              <s.icon size={16} className={s.color} />
            </div>
            <div>
              <p className="text-2xl font-bold">{s.count}</p>
              <p className="text-xs text-[var(--muted)]">{s.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Tabs + Search ── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex gap-1 p-1 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)]">
          {STATUS_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  isActive
                    ? 'bg-[var(--foreground)] text-[var(--background)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                )}
              >
                <Icon size={12} />
                {tab.label}
                {counts[tab.id] > 0 && (
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1',
                    isActive
                      ? 'bg-[var(--background)] text-[var(--foreground)]'
                      : tab.id === 'overdue'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-[var(--card-hover)] text-[var(--muted)]'
                  )}>
                    {counts[tab.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search company, notes, assignee..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl focus:outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>
      </div>

      {/* ── Selection toolbar + PowerDialer ── */}
      {filtered.length > 0 && (
        <>
          <SelectionToolbar count={selectedIds.size} totalCount={filtered.length}>
            {/* Bulk reassign */}
            <div className="relative" ref={assigneeDropdownRef}>
              <button
                onClick={() => setAssigneeDropdownOpen(!assigneeDropdownOpen)}
                disabled={bulkAssigning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] text-xs font-medium hover:bg-[var(--card-hover)] transition-all disabled:opacity-50"
              >
                {bulkAssigning ? <Loader2 size={12} className="animate-spin" /> : <UserCog size={12} />}
                Change Assignee
                <ChevronDown size={10} />
              </button>
              {assigneeDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => handleBulkReassign(null)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
                  >
                    <User size={12} className="text-[var(--muted)]" />
                    <span>All team</span>
                  </button>
                  {teamMembers.map(member => (
                    <button
                      key={member.id}
                      onClick={() => handleBulkReassign(member.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
                    >
                      <div className="w-5 h-5 rounded-full bg-[var(--primary)] flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                        {member.avatar ? (
                          <Image src={pb.files.getUrl(member, member.avatar, { thumb: '40x40' })} alt={member.name || ''} fill sizes="20px" className="object-cover" />
                        ) : (
                          <span className="text-white text-[8px] font-bold">
                            {member.name?.charAt(0).toUpperCase() ?? member.email?.charAt(0).toUpperCase() ?? 'U'}
                          </span>
                        )}
                      </div>
                      <span>{member.name || member.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* PowerDialer copy */}
            <button
              onClick={handleCopyForPowerDialer}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                copied
                  ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                  : 'bg-[var(--card-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)]'
              )}
            >
              {copied
                ? <><ClipboardCheck size={12} /> Copied!</>
                : <><Zap size={12} /> Copy for PowerDialer</>
              }
            </button>
          </SelectionToolbar>

          {!selectedIds.size && (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-xs text-[var(--muted)]">
                {filtered.length} follow-up{filtered.length !== 1 ? 's' : ''} in view
              </p>
              <button
                onClick={handleCopyForPowerDialer}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                  copied
                    ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                    : 'bg-[var(--primary-subtle)] text-[var(--primary)] border border-[var(--primary)]/20 hover:bg-[var(--primary)] hover:text-white'
                )}
              >
                {copied
                  ? <><ClipboardCheck size={14} /> Copied!</>
                  : <><Zap size={14} /> Copy All for PowerDialer</>
                }
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Table ── */}
      <TableContainer>
        {filtered.length === 0 ? (
          <TableEmptyState
            icon={<CalendarClock size={24} className="text-[var(--muted)]" />}
            title={search ? 'No follow-ups match your search.' : `No ${activeTab} follow-ups.`}
            description={search ? 'Try adjusting your search terms.' : `You have no ${activeTab} follow-ups right now.`}
          />
        ) : (
          <table className="w-full text-left" style={{ tableLayout: 'fixed' }}>
            <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
              <tr>
                <HeaderIndexCell allSelected={allSelected} someSelected={someSelected} onToggleAll={toggleSelectAll} />
                <ResizableTh width={getWidth('company')} minWidth={120} onResize={(w) => resize('company', w)}>Company</ResizableTh>
                <ResizableTh width={getWidth('scheduled')} minWidth={100} onResize={(w) => resize('scheduled', w)}>Scheduled</ResizableTh>
                <ResizableTh width={getWidth('assigned_to')} minWidth={80} onResize={(w) => resize('assigned_to', w)} className="hidden md:table-cell">Assigned To</ResizableTh>
                <ResizableTh width={getWidth('phone')} minWidth={90} onResize={(w) => resize('phone', w)} className="hidden lg:table-cell">Phone</ResizableTh>
                <ResizableTh width={getWidth('notes')} minWidth={80} onResize={(w) => resize('notes', w)} className="hidden lg:table-cell">Notes</ResizableTh>
                <ResizableTh width={getWidth('status')} minWidth={80} onResize={(w) => resize('status', w)}>Status</ResizableTh>
                {(activeTab === 'overdue' || activeTab === 'upcoming') && (
                  <ResizableTh width={getWidth('actions')} minWidth={80} onResize={(w) => resize('actions', w)} resizable={false} align="right">Actions</ResizableTh>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--card-border)]">
              {filtered.map((fu, idx) => {
                const isOverdue = fu.status === 'pending' && new Date(fu.scheduled_time) < now;
                const company = fu.expand?.company;
                const assignee = fu.expand?.assigned_to;
                const phone = fu.expand?.phone_number_record;
                const isActioning = actioningId === fu.id;

                return (
                  <tr
                    key={fu.id}
                    className={cn(
                      'transition-colors hover:bg-[var(--sidebar-bg)]',
                      isOverdue && 'bg-red-500/5',
                      selectedIds.has(fu.id) && 'bg-[var(--primary-subtle)]/40'
                    )}
                  >
                    {/* Index / Checkbox */}
                    <IndexCell
                      index={idx + 1}
                      selected={selectedIds.has(fu.id)}
                      onSelect={() => toggleSelect(fu.id)}
                      forceCheckbox={selectedIds.size > 0}
                    />

                    {/* Company */}
                    <td className="px-4 py-4 overflow-hidden">
                      {company ? (
                        <CompanyHoverCard company={company}>
                          <Link
                            href={`/companies/${fu.company}?tab=follow_ups`}
                            className="flex items-center gap-2 group min-w-0"
                          >
                            <div className="w-7 h-7 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center flex-shrink-0">
                              <Building2 size={12} className="text-[var(--muted)]" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold group-hover:text-[var(--primary)] transition-colors truncate">
                                {company.company_name}
                              </p>
                              {Array.isArray(company.status) && company.status.length > 0 && (
                                <p className="text-[10px] text-[var(--muted)] truncate">{company.status.join(', ')}</p>
                              )}
                            </div>
                            <ChevronRight size={12} className="text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex-shrink-0" />
                          </Link>
                        </CompanyHoverCard>
                      ) : (
                        <span className="text-sm text-[var(--muted)] italic">Unknown company</span>
                      )}
                    </td>

                    {/* Scheduled */}
                    <td className="px-4 py-4 overflow-hidden">
                      <FollowUpTimeDisplay
                        scheduledTime={fu.scheduled_time}
                        clientTimezone={fu.client_timezone}
                        compact={false}
                      />
                      <p className="text-[10px] text-[var(--muted)] mt-1 font-mono truncate">
                        {formatDateTimeInTimezone(fu.scheduled_time, fu.client_timezone)}
                      </p>
                    </td>

                    {/* Assigned to */}
                    <td className="px-4 py-4 hidden md:table-cell overflow-hidden">
                      {assignee ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-[var(--primary)] flex items-center justify-center flex-shrink-0 relative overflow-hidden">
                            {assignee.avatar ? (
                              <Image src={pb.files.getUrl(assignee, assignee.avatar, { thumb: '48x48' })} alt={assignee.name || ''} fill sizes="24px" className="object-cover" />
                            ) : (
                              <span className="text-white text-[9px] font-bold">
                                {assignee.name?.charAt(0).toUpperCase() ?? assignee.email?.charAt(0).toUpperCase() ?? 'U'}
                              </span>
                            )}
                          </div>
                          <span className="text-sm truncate">{assignee.name || assignee.email}</span>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-[var(--muted)]">
                          <User size={12} /> All team
                        </span>
                      )}
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-4 hidden lg:table-cell overflow-hidden">
                      {phone ? (
                        <div className="min-w-0">
                          <p className="text-xs font-mono font-semibold truncate">{formatPhoneNumber(phone.phone_number)}</p>
                          {phone.label && <p className="text-[10px] text-[var(--muted)] truncate">{phone.label}</p>}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-4 hidden lg:table-cell overflow-hidden">
                      {fu.notes ? (
                        <p className="text-xs text-[var(--muted)] truncate" title={fu.notes}>{fu.notes}</p>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4 overflow-hidden">
                      {statusBadge(fu.status, isOverdue)}
                      {fu.status === 'completed' && fu.completed_at && (
                        <p className="text-[10px] text-[var(--muted)] mt-1">
                          {new Date(fu.completed_at).toLocaleDateString()}
                        </p>
                      )}
                    </td>

                    {/* Actions */}
                    {(activeTab === 'overdue' || activeTab === 'upcoming') && (
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleComplete(fu)}
                            disabled={isActioning}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500 hover:text-white transition-all disabled:opacity-50"
                            title="Mark as completed"
                          >
                            {isActioning ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                          </button>
                          <button
                            onClick={() => handleDismiss(fu)}
                            disabled={isActioning}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[var(--card-hover)] text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400 transition-all disabled:opacity-50"
                            title="Dismiss"
                          >
                            <XCircle size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableContainer>

      {filtered.length > 0 && (
        <p className="text-xs text-[var(--muted)] text-center pb-4">
          Showing {filtered.length} {activeTab} follow-up{filtered.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
    </PageGuard>
  );
}
