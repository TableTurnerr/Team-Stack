'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronUp, Calendar, CheckCircle2, XCircle, Phone, Plus, Building2, Clock, AlertCircle, Bell, Maximize2, List, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { FollowUpTimeDisplay } from '@/components/follow-up-time-display';
import { FollowUpsDetailModal } from './followups-detail-modal';
import { FollowUpTimeline } from './followup-timeline';
import type { FollowUp } from '@/lib/types';

const STORAGE_KEY = 'crm:session:followups-expanded:v1';
const VIEW_MODE_KEY = 'crm:session:followups-view-mode:v1';

type ViewMode = 'list' | 'timeline';

interface SessionFollowUpsProps {
  /** Callback to add a phone number to the power dialer queue */
  onAddToDialer?: (entry: { number: string; company?: string }) => void;
  /** Callback to dial a number immediately */
  onDialNow?: (phoneNumber: string, companyName?: string) => void;
  /** Callback to pre-fill the call form with company info */
  onSelectCompany?: (companyId: string, companyName: string, phoneNumber?: string) => void;
  /** Whether the current call form has unsaved data */
  hasUnsavedCall?: boolean;
  /** Whether a call is currently in progress */
  isCallInProgress?: boolean;
  /** Set of follow-up IDs dismissed for this session (not persisted) */
  sessionDismissedIds?: Set<string>;
  /** Callback to dismiss a follow-up for this session only */
  onSessionDismiss?: (id: string) => void;
  className?: string;
}

type FollowUpCategory = 'overdue' | 'due_soon' | 'upcoming';

interface CategorizedFollowUp {
  followUp: FollowUp;
  category: FollowUpCategory;
  minutesUntil: number;
}

export function SessionFollowUps({
  onAddToDialer,
  onDialNow,
  onSelectCompany,
  hasUnsavedCall = false,
  isCallInProgress = false,
  sessionDismissedIds,
  onSessionDismiss,
  className,
}: SessionFollowUpsProps) {
  const { pendingFollowUps, completeFollowUp } = useFollowUps();
  const { preferences } = useUserPreferences();
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Load expanded state from localStorage
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== 'false';
  });

  // Load view mode from localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return (stored === 'timeline' ? 'timeline' : 'list') as ViewMode;
  });

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded));
  }, [isExpanded]);

  // Persist view mode
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  // Get time window from preferences
  const hoursAhead = preferences?.workflow_preferences?.followup_window_hours_ahead ?? 8;
  const hoursBehind = preferences?.workflow_preferences?.followup_window_hours_behind ?? 8;

  // Filter and categorize follow-ups within the time window
  const categorizedFollowUps = useMemo(() => {
    const now = Date.now();
    const windowStart = now - (hoursBehind * 60 * 60 * 1000);
    const windowEnd = now + (hoursAhead * 60 * 60 * 1000);
    const dueSoonThreshold = 30 * 60 * 1000; // 30 minutes

    const result: CategorizedFollowUp[] = [];

    for (const followUp of pendingFollowUps) {
      const scheduledTime = new Date(followUp.scheduled_time).getTime();

      // Check if within time window
      if (scheduledTime < windowStart || scheduledTime > windowEnd) {
        continue;
      }

      const minutesUntil = (scheduledTime - now) / (60 * 1000);
      let category: FollowUpCategory;

      if (scheduledTime < now) {
        category = 'overdue';
      } else if (scheduledTime - now <= dueSoonThreshold) {
        category = 'due_soon';
      } else {
        category = 'upcoming';
      }

      result.push({ followUp, category, minutesUntil });
    }

    // Sort: overdue first (most overdue first), then due_soon, then upcoming
    result.sort((a, b) => {
      const categoryOrder = { overdue: 0, due_soon: 1, upcoming: 2 };
      if (categoryOrder[a.category] !== categoryOrder[b.category]) {
        return categoryOrder[a.category] - categoryOrder[b.category];
      }
      return a.minutesUntil - b.minutesUntil;
    });

    return result;
  }, [pendingFollowUps, hoursAhead, hoursBehind]);

  // Filter out session-dismissed follow-ups for the main view
  const visibleFollowUps = useMemo(() => {
    if (!sessionDismissedIds || sessionDismissedIds.size === 0) {
      return categorizedFollowUps;
    }
    return categorizedFollowUps.filter(c => !sessionDismissedIds.has(c.followUp.id));
  }, [categorizedFollowUps, sessionDismissedIds]);

  const overdueCount = visibleFollowUps.filter(c => c.category === 'overdue').length;
  const dueSoonCount = visibleFollowUps.filter(c => c.category === 'due_soon').length;
  const totalCount = visibleFollowUps.length;
  const dismissedCount = sessionDismissedIds?.size ?? 0;

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
    }
  }, [onDialNow]);

  const handleSelectForCall = useCallback((followUp: FollowUp) => {
    if (hasUnsavedCall) return;

    const companyId = followUp.company;
    const companyName = followUp.expand?.company?.company_name || '';
    const phoneNumber = followUp.expand?.phone_number_record?.phone_number;

    if (companyId && onSelectCompany) {
      onSelectCompany(companyId, companyName, phoneNumber);
    }
  }, [hasUnsavedCall, onSelectCompany]);

  // Don't render if no follow-ups in window
  if (totalCount === 0) {
    return null;
  }

  return (
    <div className={cn("bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <Bell size={14} className="text-[var(--primary)]" />
          <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
            Follow-Ups
          </h3>
          {/* Badge */}
          <span className={cn(
            "px-2 py-0.5 rounded-full text-xs font-bold",
            overdueCount > 0
              ? "bg-[var(--error-subtle)] text-[var(--error)]"
              : dueSoonCount > 0
                ? "bg-[var(--warning-subtle)] text-[var(--warning)]"
                : "bg-[var(--primary-subtle)] text-[var(--primary)]"
          )}>
            {totalCount}
          </span>
          {overdueCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--error)] font-medium">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--error)] animate-pulse" />
              {overdueCount} overdue
            </span>
          )}
          {isExpanded ? <ChevronUp size={16} className="text-[var(--muted)] ml-auto" /> : <ChevronDown size={16} className="text-[var(--muted)] ml-auto" />}
        </button>
        {/* View mode toggle */}
        <div className="flex items-center gap-1 p-0.5 bg-[var(--sidebar-bg)] rounded-lg ml-2">
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === 'list'
                ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            )}
            title="List view"
          >
            <List size={12} />
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === 'timeline'
                ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            )}
            title="Timeline view"
          >
            <GitBranch size={12} />
          </button>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--primary)] transition-colors ml-1"
          title="View all follow-ups"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-[var(--card-border)] max-h-[300px] overflow-y-auto">
          {viewMode === 'timeline' ? (
            <div className="p-3">
              <FollowUpTimeline
                followUps={visibleFollowUps.map(c => c.followUp)}
                onComplete={completeFollowUp}
                onDismiss={onSessionDismiss}
                onAddToDialer={onAddToDialer}
                onDialNow={onDialNow}
                onSelectCompany={onSelectCompany}
                hasUnsavedCall={hasUnsavedCall}
                isCallInProgress={isCallInProgress}
                compact
              />
            </div>
          ) : (
            <div className="divide-y divide-[var(--card-border)]">
              {visibleFollowUps.map(({ followUp, category }) => (
                <FollowUpItem
                  key={followUp.id}
                  followUp={followUp}
                  category={category}
                  onComplete={completeFollowUp}
                  onDismiss={onSessionDismiss || (() => {})}
                  onAddToDialer={onAddToDialer ? () => handleAddToDialer(followUp) : undefined}
                  onDialNow={onDialNow ? () => handleDialNow(followUp) : undefined}
                  onSelect={!hasUnsavedCall ? () => handleSelectForCall(followUp) : undefined}
                  hasUnsavedCall={hasUnsavedCall}
                  isCallInProgress={isCallInProgress}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      <FollowUpsDetailModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAddToDialer={onAddToDialer}
        onDialNow={onDialNow}
        onSelectCompany={onSelectCompany}
        hasUnsavedCall={hasUnsavedCall}
        isCallInProgress={isCallInProgress}
        sessionDismissedIds={sessionDismissedIds}
        onSessionDismiss={onSessionDismiss}
      />
    </div>
  );
}

interface FollowUpItemProps {
  followUp: FollowUp;
  category: FollowUpCategory;
  onComplete: (id: string) => void;
  onDismiss: (id: string) => void;
  onAddToDialer?: () => void;
  onDialNow?: () => void;
  onSelect?: () => void;
  hasUnsavedCall?: boolean;
  isCallInProgress?: boolean;
}

function FollowUpItem({
  followUp,
  category,
  onComplete,
  onDismiss,
  onAddToDialer,
  onDialNow,
  onSelect,
  hasUnsavedCall,
  isCallInProgress,
}: FollowUpItemProps) {
  const [completing, setCompleting] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const companyName = followUp.expand?.company?.company_name || 'Unknown Company';
  const phoneNumber = followUp.expand?.phone_number_record?.phone_number;
  const hasPhone = !!phoneNumber;

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await onComplete(followUp.id);
    } finally {
      setCompleting(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss(followUp.id);
    } finally {
      setDismissing(false);
    }
  };

  const categoryStyles = {
    overdue: {
      container: 'bg-[var(--error)]/5',
      icon: 'bg-[var(--error)]/20 text-[var(--error)]',
      badge: 'bg-[var(--error-subtle)] text-[var(--error)]',
      label: 'Overdue',
    },
    due_soon: {
      container: 'bg-[var(--warning)]/5',
      icon: 'bg-[var(--warning)]/20 text-[var(--warning)]',
      badge: 'bg-[var(--warning-subtle)] text-[var(--warning)]',
      label: 'Due Soon',
    },
    upcoming: {
      container: '',
      icon: 'bg-[var(--primary-subtle)] text-[var(--primary)]',
      badge: 'bg-[var(--primary-subtle)] text-[var(--primary)]',
      label: 'Upcoming',
    },
  };

  const styles = categoryStyles[category];

  return (
    <div className={cn("p-3 hover:bg-[var(--sidebar-bg)] transition-colors", styles.container)}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn("p-1.5 rounded-lg shrink-0", styles.icon)}>
          <Calendar size={14} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Company name - clickable if no unsaved call */}
          <div className="flex items-center gap-2 mb-1">
            {followUp.expand?.company ? (
              <CompanyHoverCard company={followUp.expand.company} side="bottom">
                <button
                  onClick={onSelect}
                  disabled={hasUnsavedCall}
                  className={cn(
                    "text-sm font-semibold truncate text-left",
                    hasUnsavedCall
                      ? "cursor-not-allowed text-[var(--foreground)]"
                      : "hover:text-[var(--primary)] hover:underline decoration-dotted cursor-pointer"
                  )}
                  title={hasUnsavedCall ? "Save or clear current call first" : `Pre-fill form with ${companyName}`}
                >
                  {companyName}
                </button>
              </CompanyHoverCard>
            ) : (
              <span className="text-sm font-semibold truncate">{companyName}</span>
            )}
            {category !== 'upcoming' && (
              <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", styles.badge)}>
                {styles.label}
              </span>
            )}
          </div>

          {/* Time */}
          <div className="flex items-center gap-2 mb-1">
            <FollowUpTimeDisplay
              scheduledTime={followUp.scheduled_time}
              clientTimezone={followUp.client_timezone}
              compact
            />
            {phoneNumber && (
              <span className="text-xs text-[var(--muted)] font-mono">{phoneNumber}</span>
            )}
          </div>

          {/* Notes */}
          {followUp.notes && (
            <p className="text-xs text-[var(--muted)] line-clamp-1 mt-1">
              {followUp.notes}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Dial now */}
          {hasPhone && onDialNow && (
            <button
              onClick={onDialNow}
              disabled={isCallInProgress || hasUnsavedCall}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                isCallInProgress || hasUnsavedCall
                  ? "opacity-40 cursor-not-allowed text-[var(--muted)]"
                  : "hover:bg-[var(--success)]/10 text-[var(--success)]"
              )}
              title={isCallInProgress ? "Call in progress" : hasUnsavedCall ? "Save current call first" : "Dial now"}
            >
              <Phone size={14} />
            </button>
          )}

          {/* Add to dialer */}
          {hasPhone && onAddToDialer && (
            <button
              onClick={onAddToDialer}
              className="p-1.5 rounded-lg hover:bg-[var(--primary)]/10 text-[var(--primary)] transition-colors"
              title="Add to power dialer"
            >
              <Plus size={14} />
            </button>
          )}

          {/* Complete */}
          <button
            onClick={handleComplete}
            disabled={completing}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              completing
                ? "opacity-50"
                : "hover:bg-[var(--success)]/10 text-[var(--success)]"
            )}
            title="Mark as completed"
          >
            <CheckCircle2 size={14} />
          </button>

          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            disabled={dismissing}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              dismissing
                ? "opacity-50"
                : "hover:bg-[var(--card-hover)] text-[var(--muted)]"
            )}
            title="Dismiss"
          >
            <XCircle size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
