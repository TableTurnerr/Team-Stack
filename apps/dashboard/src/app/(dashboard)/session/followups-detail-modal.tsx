'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Calendar,
  CheckCircle2,
  XCircle,
  Phone,
  Plus,
  Clock,
  AlertCircle,
  Bell,
  Filter,
  Search,
  User,
  Building2,
  ChevronRight,
  RefreshCw,
  List,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { FollowUpTimeDisplay } from '@/components/follow-up-time-display';
import { FollowUpTimeline } from './followup-timeline';
import type { FollowUp } from '@/lib/types';

type FollowUpCategory = 'all' | 'overdue' | 'due_soon' | 'upcoming' | 'dismissed';
type ViewMode = 'list' | 'timeline';

interface FollowUpsDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToDialer?: (entry: { number: string; company?: string }) => void;
  onDialNow?: (phoneNumber: string, companyName?: string) => void;
  onSelectCompany?: (companyId: string, companyName: string, phoneNumber?: string) => void;
  hasUnsavedCall?: boolean;
  isCallInProgress?: boolean;
  /** Set of follow-up IDs dismissed for this session */
  sessionDismissedIds?: Set<string>;
  /** Callback to dismiss/restore a follow-up for this session */
  onSessionDismiss?: (id: string) => void;
}

export function FollowUpsDetailModal({
  isOpen,
  onClose,
  onAddToDialer,
  onDialNow,
  onSelectCompany,
  hasUnsavedCall = false,
  isCallInProgress = false,
  sessionDismissedIds,
  onSessionDismiss,
}: FollowUpsDetailModalProps) {
  const { pendingFollowUps, completeFollowUp, refreshFollowUps, isLoading } = useFollowUps();
  const { preferences } = useUserPreferences();
  const [selectedCategory, setSelectedCategory] = useState<FollowUpCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFollowUp, setSelectedFollowUp] = useState<FollowUp | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedFollowUp) {
          setSelectedFollowUp(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, selectedFollowUp]);

  // Categorize follow-ups
  const categorizedFollowUps = useMemo(() => {
    const now = Date.now();
    const dueSoonThreshold = 30 * 60 * 1000; // 30 minutes

    return pendingFollowUps.map(followUp => {
      const scheduledTime = new Date(followUp.scheduled_time).getTime();
      const minutesUntil = (scheduledTime - now) / (60 * 1000);
      const isSessionDismissed = sessionDismissedIds?.has(followUp.id) ?? false;

      let category: 'overdue' | 'due_soon' | 'upcoming';
      if (scheduledTime < now) {
        category = 'overdue';
      } else if (scheduledTime - now <= dueSoonThreshold) {
        category = 'due_soon';
      } else {
        category = 'upcoming';
      }

      return { followUp, category, minutesUntil, isSessionDismissed };
    }).sort((a, b) => {
      // Sort dismissed items last
      if (a.isSessionDismissed !== b.isSessionDismissed) {
        return a.isSessionDismissed ? 1 : -1;
      }
      const categoryOrder = { overdue: 0, due_soon: 1, upcoming: 2 };
      if (categoryOrder[a.category] !== categoryOrder[b.category]) {
        return categoryOrder[a.category] - categoryOrder[b.category];
      }
      return a.minutesUntil - b.minutesUntil;
    });
  }, [pendingFollowUps, sessionDismissedIds]);

  // Filter by category and search
  const filteredFollowUps = useMemo(() => {
    return categorizedFollowUps.filter(({ followUp, category, isSessionDismissed }) => {
      // Category filter
      if (selectedCategory === 'dismissed') {
        if (!isSessionDismissed) return false;
      } else if (selectedCategory !== 'all') {
        if (category !== selectedCategory) return false;
        // In non-dismissed categories, hide dismissed items unless showing "all"
        if (isSessionDismissed) return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const companyName = followUp.expand?.company?.company_name?.toLowerCase() || '';
        const phoneNumber = followUp.expand?.phone_number_record?.phone_number || '';
        const notes = followUp.notes?.toLowerCase() || '';

        return companyName.includes(query) || phoneNumber.includes(query) || notes.includes(query);
      }

      return true;
    });
  }, [categorizedFollowUps, selectedCategory, searchQuery]);

  // Counts (exclude session-dismissed from active counts)
  const overdueCount = categorizedFollowUps.filter(c => c.category === 'overdue' && !c.isSessionDismissed).length;
  const dueSoonCount = categorizedFollowUps.filter(c => c.category === 'due_soon' && !c.isSessionDismissed).length;
  const upcomingCount = categorizedFollowUps.filter(c => c.category === 'upcoming' && !c.isSessionDismissed).length;
  const dismissedCount = categorizedFollowUps.filter(c => c.isSessionDismissed).length;
  const totalCount = pendingFollowUps.length;

  const handleAddToDialer = useCallback((followUp: FollowUp) => {
    const phoneNumber = followUp.expand?.phone_number_record?.phone_number;
    const companyName = followUp.expand?.company?.company_name;

    if (phoneNumber && onAddToDialer) {
      onAddToDialer({ number: phoneNumber, company: companyName });
    }
  }, [onAddToDialer]);

  const handleDialNow = useCallback((followUp: FollowUp) => {
    const phoneNumber = followUp.expand?.phone_number_record?.phone_number;
    const companyName = followUp.expand?.company?.company_name;

    if (phoneNumber && onDialNow) {
      onDialNow(phoneNumber, companyName);
      onClose();
    }
  }, [onDialNow, onClose]);

  const handleSelectForCall = useCallback((followUp: FollowUp) => {
    if (hasUnsavedCall) return;

    const companyId = followUp.company;
    const companyName = followUp.expand?.company?.company_name || '';
    const phoneNumber = followUp.expand?.phone_number_record?.phone_number;

    if (companyId && onSelectCompany) {
      onSelectCompany(companyId, companyName, phoneNumber);
      onClose();
    }
  }, [hasUnsavedCall, onSelectCompany, onClose]);

  if (!isOpen) return null;

  const categories: { key: FollowUpCategory; label: string; count: number; color: string }[] = [
    { key: 'all', label: 'All', count: totalCount, color: 'text-[var(--foreground)]' },
    { key: 'overdue', label: 'Overdue', count: overdueCount, color: 'text-[var(--error)]' },
    { key: 'due_soon', label: 'Due Soon', count: dueSoonCount, color: 'text-[var(--warning)]' },
    { key: 'upcoming', label: 'Upcoming', count: upcomingCount, color: 'text-[var(--primary)]' },
    ...(dismissedCount > 0 ? [{ key: 'dismissed' as FollowUpCategory, label: 'Snoozed', count: dismissedCount, color: 'text-[var(--muted)]' }] : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="followups-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl',
          'w-full max-w-4xl max-h-[85vh] flex flex-col',
          'animate-in fade-in zoom-in-95 duration-200'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--primary-subtle)]">
              <Bell size={18} className="text-[var(--primary)]" />
            </div>
            <div>
              <h2 id="followups-modal-title" className="text-lg font-semibold">
                Follow-Ups
              </h2>
              <p className="text-xs text-[var(--muted)]">
                {totalCount} pending follow-up{totalCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshFollowUps()}
              disabled={isLoading}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isLoading
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-[var(--card-hover)] text-[var(--muted)]"
              )}
              title="Refresh"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-[var(--card-border)] space-y-3">
          {/* Category tabs and view mode toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-x-auto flex-1">
              {categories.map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    selectedCategory === cat.key
                      ? "bg-[var(--foreground)] text-[var(--background)]"
                      : "bg-[var(--sidebar-bg)] hover:bg-[var(--card-hover)]"
                  )}
                >
                  {cat.label}
                  <span className={cn(
                    "ml-1.5 px-1.5 py-0.5 rounded text-xs",
                    selectedCategory === cat.key
                      ? "bg-[var(--background)]/20"
                      : cat.key === 'overdue' && cat.count > 0
                        ? "bg-[var(--error-subtle)] text-[var(--error)]"
                        : cat.key === 'due_soon' && cat.count > 0
                          ? "bg-[var(--warning-subtle)] text-[var(--warning)]"
                          : "bg-[var(--card-hover)]"
                  )}>
                    {cat.count}
                  </span>
                </button>
              ))}
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 p-1 bg-[var(--sidebar-bg)] rounded-lg shrink-0">
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === 'list'
                    ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                )}
                title="List view"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === 'timeline'
                    ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                )}
                title="Timeline view"
              >
                <GitBranch size={16} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search by company, phone, or notes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {viewMode === 'timeline' ? (
            /* Timeline View */
            <div className="flex-1 overflow-y-auto p-4">
              <FollowUpTimeline
                followUps={filteredFollowUps.map(f => f.followUp)}
                onComplete={completeFollowUp}
                onDismiss={onSessionDismiss}
                onAddToDialer={onAddToDialer}
                onDialNow={onDialNow}
                onSelectCompany={onSelectCompany}
                hasUnsavedCall={hasUnsavedCall}
                isCallInProgress={isCallInProgress}
                sessionDismissedIds={sessionDismissedIds}
              />
            </div>
          ) : (
            <>
              {/* List View */}
              <div className={cn(
                "flex-1 overflow-y-auto",
                selectedFollowUp ? "hidden md:block md:w-1/2 md:border-r md:border-[var(--card-border)]" : ""
              )}>
                {filteredFollowUps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="p-3 rounded-full bg-[var(--sidebar-bg)] mb-3">
                      <Bell size={24} className="text-[var(--muted)]" />
                    </div>
                    <p className="text-sm font-medium text-[var(--muted)]">No follow-ups found</p>
                    <p className="text-xs text-[var(--muted)] mt-1">
                      {searchQuery ? 'Try adjusting your search' : 'All caught up!'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--card-border)]">
                    {filteredFollowUps.map(({ followUp, category, isSessionDismissed }) => (
                      <FollowUpListItem
                        key={followUp.id}
                        followUp={followUp}
                        category={category}
                        isSelected={selectedFollowUp?.id === followUp.id}
                        onSelect={() => setSelectedFollowUp(followUp)}
                        onComplete={completeFollowUp}
                        onSessionDismiss={onSessionDismiss}
                        isSessionDismissed={isSessionDismissed}
                        onAddToDialer={onAddToDialer ? () => handleAddToDialer(followUp) : undefined}
                        onDialNow={onDialNow ? () => handleDialNow(followUp) : undefined}
                        onSelectForCall={!hasUnsavedCall ? () => handleSelectForCall(followUp) : undefined}
                        hasUnsavedCall={hasUnsavedCall}
                        isCallInProgress={isCallInProgress}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Detail panel */}
              {selectedFollowUp && (
                <div className="flex-1 md:w-1/2 overflow-y-auto bg-[var(--sidebar-bg)]">
                  <FollowUpDetailPanel
                    followUp={selectedFollowUp}
                    onClose={() => setSelectedFollowUp(null)}
                    onComplete={async () => {
                      await completeFollowUp(selectedFollowUp.id);
                      setSelectedFollowUp(null);
                    }}
                    onSessionDismiss={() => {
                      onSessionDismiss?.(selectedFollowUp.id);
                      setSelectedFollowUp(null);
                    }}
                    isSessionDismissed={sessionDismissedIds?.has(selectedFollowUp.id) ?? false}
                    onAddToDialer={onAddToDialer ? () => handleAddToDialer(selectedFollowUp) : undefined}
                    onDialNow={onDialNow ? () => handleDialNow(selectedFollowUp) : undefined}
                    onSelectForCall={!hasUnsavedCall ? () => handleSelectForCall(selectedFollowUp) : undefined}
                    hasUnsavedCall={hasUnsavedCall}
                    isCallInProgress={isCallInProgress}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface FollowUpListItemProps {
  followUp: FollowUp;
  category: 'overdue' | 'due_soon' | 'upcoming';
  isSelected: boolean;
  onSelect: () => void;
  onComplete: (id: string) => void;
  onSessionDismiss?: (id: string) => void;
  isSessionDismissed?: boolean;
  onAddToDialer?: () => void;
  onDialNow?: () => void;
  onSelectForCall?: () => void;
  hasUnsavedCall?: boolean;
  isCallInProgress?: boolean;
}

function FollowUpListItem({
  followUp,
  category,
  isSelected,
  onSelect,
  onComplete,
  onSessionDismiss,
  isSessionDismissed,
  onAddToDialer,
  onDialNow,
  onSelectForCall,
  hasUnsavedCall,
  isCallInProgress,
}: FollowUpListItemProps) {
  const [completing, setCompleting] = useState(false);

  const companyName = followUp.expand?.company?.company_name || 'Unknown Company';
  const phoneNumber = followUp.expand?.phone_number_record?.phone_number;
  const hasPhone = !!phoneNumber;

  const handleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCompleting(true);
    try {
      await onComplete(followUp.id);
    } finally {
      setCompleting(false);
    }
  };

  const handleSessionDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSessionDismiss?.(followUp.id);
  };

  const categoryStyles = {
    overdue: {
      bg: 'bg-[var(--error)]/5',
      badge: 'bg-[var(--error-subtle)] text-[var(--error)]',
      icon: 'text-[var(--error)]',
    },
    due_soon: {
      bg: 'bg-[var(--warning)]/5',
      badge: 'bg-[var(--warning-subtle)] text-[var(--warning)]',
      icon: 'text-[var(--warning)]',
    },
    upcoming: {
      bg: '',
      badge: 'bg-[var(--primary-subtle)] text-[var(--primary)]',
      icon: 'text-[var(--primary)]',
    },
  };

  const styles = categoryStyles[category];

  return (
    <div
      onClick={onSelect}
      className={cn(
        "p-4 cursor-pointer transition-colors",
        isSelected ? "bg-[var(--primary)]/10" : "hover:bg-[var(--card-hover)]",
        isSessionDismissed ? "opacity-60" : styles.bg
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn("p-2 rounded-lg bg-[var(--card-bg)] shrink-0", isSessionDismissed ? "text-[var(--muted)]" : styles.icon)}>
          <Calendar size={16} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("font-semibold truncate", isSessionDismissed && "text-[var(--muted)]")}>{companyName}</span>
            {isSessionDismissed ? (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[var(--muted)]">
                Snoozed
              </span>
            ) : category !== 'upcoming' && (
              <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", styles.badge)}>
                {category === 'overdue' ? 'Overdue' : 'Due Soon'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <FollowUpTimeDisplay
              scheduledTime={followUp.scheduled_time}
              clientTimezone={followUp.client_timezone}
              compact
            />
            {phoneNumber && (
              <>
                <span>·</span>
                <span className="font-mono">{phoneNumber}</span>
              </>
            )}
          </div>

          {followUp.notes && (
            <p className="text-xs text-[var(--muted)] line-clamp-1 mt-1">
              {followUp.notes}
            </p>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isSessionDismissed ? (
            <button
              onClick={handleSessionDismiss}
              className="p-1.5 rounded-lg hover:bg-[var(--primary)]/10 text-[var(--primary)] transition-colors"
              title="Restore for this session"
            >
              <RefreshCw size={14} />
            </button>
          ) : (
            <>
              {hasPhone && onDialNow && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDialNow(); }}
                  disabled={isCallInProgress || hasUnsavedCall}
                  className={cn(
                    "p-1.5 rounded-lg transition-colors",
                    isCallInProgress || hasUnsavedCall
                      ? "opacity-40 cursor-not-allowed text-[var(--muted)]"
                      : "hover:bg-[var(--success)]/10 text-[var(--success)]"
                  )}
                  title="Dial now"
                >
                  <Phone size={14} />
                </button>
              )}
              <button
                onClick={handleComplete}
                disabled={completing}
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  completing ? "opacity-50" : "hover:bg-[var(--success)]/10 text-[var(--success)]"
                )}
                title="Complete"
              >
                <CheckCircle2 size={14} />
              </button>
            </>
          )}
          <ChevronRight size={14} className="text-[var(--muted)]" />
        </div>
      </div>
    </div>
  );
}

interface FollowUpDetailPanelProps {
  followUp: FollowUp;
  onClose: () => void;
  onComplete: () => void;
  onSessionDismiss: () => void;
  isSessionDismissed: boolean;
  onAddToDialer?: () => void;
  onDialNow?: () => void;
  onSelectForCall?: () => void;
  hasUnsavedCall?: boolean;
  isCallInProgress?: boolean;
}

function FollowUpDetailPanel({
  followUp,
  onClose,
  onComplete,
  onSessionDismiss,
  isSessionDismissed,
  onAddToDialer,
  onDialNow,
  onSelectForCall,
  hasUnsavedCall,
  isCallInProgress,
}: FollowUpDetailPanelProps) {
  const [completing, setCompleting] = useState(false);

  const company = followUp.expand?.company;
  const phoneNumber = followUp.expand?.phone_number_record?.phone_number;
  const assignedTo = followUp.expand?.assigned_to;
  const createdBy = followUp.expand?.created_by;

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await onComplete();
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="p-4">
      {/* Back button (mobile) */}
      <button
        onClick={onClose}
        className="md:hidden flex items-center gap-2 text-sm text-[var(--muted)] mb-4 hover:text-[var(--foreground)]"
      >
        <ChevronRight size={14} className="rotate-180" />
        Back to list
      </button>

      {/* Company info */}
      <div className="mb-6">
        <div className="flex items-start gap-3">
          <div className="p-3 rounded-xl bg-[var(--card-bg)]">
            <Building2 size={24} className="text-[var(--primary)]" />
          </div>
          <div className="flex-1 min-w-0">
            {company ? (
              <CompanyHoverCard company={company}>
                <button
                  onClick={onSelectForCall}
                  disabled={hasUnsavedCall}
                  className={cn(
                    "text-lg font-semibold text-left",
                    hasUnsavedCall
                      ? "cursor-not-allowed"
                      : "hover:text-[var(--primary)] hover:underline decoration-dotted"
                  )}
                >
                  {company.company_name}
                </button>
              </CompanyHoverCard>
            ) : (
              <span className="text-lg font-semibold">Unknown Company</span>
            )}
            {company?.company_location && (
              <p className="text-sm text-[var(--muted)]">{company.company_location}</p>
            )}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-4 mb-6">
        {/* Scheduled time */}
        <div className="flex items-start gap-3">
          <Clock size={16} className="text-[var(--muted)] mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-0.5">Scheduled</p>
            <FollowUpTimeDisplay
              scheduledTime={followUp.scheduled_time}
              clientTimezone={followUp.client_timezone}
            />
          </div>
        </div>

        {/* Phone number */}
        {phoneNumber && (
          <div className="flex items-start gap-3">
            <Phone size={16} className="text-[var(--muted)] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-0.5">Phone</p>
              <p className="font-mono">{phoneNumber}</p>
            </div>
          </div>
        )}

        {/* Assigned to */}
        {assignedTo && (
          <div className="flex items-start gap-3">
            <User size={16} className="text-[var(--muted)] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-0.5">Assigned To</p>
              <p>{assignedTo.name || assignedTo.email}</p>
            </div>
          </div>
        )}

        {/* Created by */}
        {createdBy && (
          <div className="flex items-start gap-3">
            <User size={16} className="text-[var(--muted)] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-0.5">Created By</p>
              <p>{createdBy.name || createdBy.email}</p>
            </div>
          </div>
        )}

        {/* Notes */}
        {followUp.notes && (
          <div className="p-3 bg-[var(--card-bg)] rounded-lg">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Notes</p>
            <p className="text-sm whitespace-pre-wrap">{followUp.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {phoneNumber && onDialNow && (
          <button
            onClick={onDialNow}
            disabled={isCallInProgress || hasUnsavedCall}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors",
              isCallInProgress || hasUnsavedCall
                ? "bg-[var(--card-bg)] text-[var(--muted)] cursor-not-allowed"
                : "bg-[var(--success)] text-white hover:bg-[var(--success)]/90"
            )}
          >
            <Phone size={16} />
            Dial Now
          </button>
        )}

        {phoneNumber && onAddToDialer && (
          <button
            onClick={onAddToDialer}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 transition-colors"
          >
            <Plus size={16} />
            Add to Power Dialer
          </button>
        )}

        {onSelectForCall && (
          <button
            onClick={onSelectForCall}
            disabled={hasUnsavedCall}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors",
              hasUnsavedCall
                ? "bg-[var(--card-bg)] text-[var(--muted)] cursor-not-allowed"
                : "bg-[var(--card-bg)] hover:bg-[var(--card-hover)]"
            )}
          >
            <Building2 size={16} />
            Pre-fill Call Form
          </button>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleComplete}
            disabled={completing}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors",
              completing
                ? "opacity-50 cursor-not-allowed"
                : "bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20"
            )}
          >
            {completing ? (
              <span className="w-4 h-4 border-2 border-[var(--success)]/30 border-t-[var(--success)] rounded-full animate-spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            Complete
          </button>

          <button
            onClick={onSessionDismiss}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors",
              isSessionDismissed
                ? "bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20"
                : "bg-[var(--card-bg)] text-[var(--muted)] hover:bg-[var(--card-hover)]"
            )}
          >
            {isSessionDismissed ? (
              <>
                <RefreshCw size={16} />
                Restore
              </>
            ) : (
              <>
                <XCircle size={16} />
                Snooze
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
