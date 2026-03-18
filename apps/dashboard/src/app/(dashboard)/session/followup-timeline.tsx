'use client';

import { useMemo, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  Phone,
  Plus,
  Building2,
  AlertCircle,
  CalendarClock,
} from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { FollowUpTimeDisplay } from '@/components/follow-up-time-display';
import type { FollowUp } from '@/lib/types';

interface FollowUpTimelineProps {
  followUps: FollowUp[];
  onComplete?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onAddToDialer?: (entry: { number: string; company?: string }) => void;
  onDialNow?: (phoneNumber: string, companyName?: string) => void;
  onSelectCompany?: (companyId: string, companyName: string, phoneNumber?: string) => void;
  hasUnsavedCall?: boolean;
  isCallInProgress?: boolean;
  compact?: boolean;
}

interface TimelineGroup {
  date: string;
  label: string;
  isToday: boolean;
  isFuture: boolean;
  followUps: Array<{
    followUp: FollowUp;
    status: 'overdue' | 'due_soon' | 'upcoming';
  }>;
}

export function FollowUpTimeline({
  followUps,
  onComplete,
  onDismiss,
  onAddToDialer,
  onDialNow,
  onSelectCompany,
  hasUnsavedCall = false,
  isCallInProgress = false,
  compact = false,
}: FollowUpTimelineProps) {
  // Group follow-ups by date
  const groupedFollowUps = useMemo(() => {
    const now = Date.now();
    const dueSoonThreshold = 30 * 60 * 1000; // 30 minutes
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Categorize and sort follow-ups
    const categorized = followUps
      .map(followUp => {
        const scheduledTime = new Date(followUp.scheduled_time).getTime();
        let status: 'overdue' | 'due_soon' | 'upcoming';

        if (scheduledTime < now) {
          status = 'overdue';
        } else if (scheduledTime - now <= dueSoonThreshold) {
          status = 'due_soon';
        } else {
          status = 'upcoming';
        }

        return { followUp, status, scheduledTime };
      })
      .sort((a, b) => a.scheduledTime - b.scheduledTime);

    // Group by date
    const groups: Map<string, TimelineGroup> = new Map();

    for (const item of categorized) {
      const date = new Date(item.followUp.scheduled_time);
      date.setHours(0, 0, 0, 0);
      const dateKey = date.toISOString().split('T')[0];

      let label: string;
      let isToday = false;
      let isFuture = false;

      if (dateKey === today.toISOString().split('T')[0]) {
        label = 'Today';
        isToday = true;
      } else if (dateKey === yesterday.toISOString().split('T')[0]) {
        label = 'Yesterday';
      } else if (dateKey === tomorrow.toISOString().split('T')[0]) {
        label = 'Tomorrow';
        isFuture = true;
      } else if (date < today) {
        label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      } else {
        label = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        isFuture = true;
      }

      if (!groups.has(dateKey)) {
        groups.set(dateKey, { date: dateKey, label, isToday, isFuture, followUps: [] });
      }

      groups.get(dateKey)!.followUps.push({ followUp: item.followUp, status: item.status });
    }

    // Sort groups by date
    return Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [followUps]);

  // Stats
  const overdueCount = followUps.filter(f => new Date(f.scheduled_time).getTime() < Date.now()).length;
  const upcomingCount = followUps.length - overdueCount;

  // Ref for today's section to auto-scroll
  const todayRef = useRef<HTMLDivElement>(null);

  // Find the index of today or the first future date to scroll to
  const todayIndex = groupedFollowUps.findIndex(g => g.isToday);
  const firstFutureIndex = groupedFollowUps.findIndex(g => g.isFuture);
  const scrollTargetIndex = todayIndex >= 0 ? todayIndex : firstFutureIndex >= 0 ? firstFutureIndex : -1;

  // Auto-scroll to today/current section on mount
  useEffect(() => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  if (followUps.length === 0) {
    return (
      <div className="py-12 text-center">
        <Clock size={36} className="mx-auto text-[var(--card-border)] mb-3" />
        <p className="text-sm text-[var(--muted)] font-medium">No follow-ups scheduled</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      {!compact && (
        <div className="flex flex-wrap gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-xs">
            <span className="text-[var(--muted)]">Total: </span>
            <span className="font-bold">{followUps.length}</span>
          </div>
          {overdueCount > 0 && (
            <div className="px-3 py-1.5 rounded-lg bg-[var(--error-subtle)] border border-[var(--error)]/20 text-xs">
              <span className="text-[var(--error)]">Overdue: </span>
              <span className="font-bold text-[var(--error)]">{overdueCount}</span>
            </div>
          )}
          <div className="px-3 py-1.5 rounded-lg bg-[var(--primary-subtle)] border border-[var(--primary)]/20 text-xs">
            <span className="text-[var(--primary)]">Upcoming: </span>
            <span className="font-bold text-[var(--primary)]">{upcomingCount}</span>
          </div>
        </div>
      )}

      {/* Timeline */}
      {groupedFollowUps.map((group, index) => (
        <div
          key={group.date}
          ref={index === scrollTargetIndex ? todayRef : undefined}
        >
          {/* Date header */}
          <div className="sticky top-0 z-10 flex items-center gap-3 mb-3">
            <span className={cn(
              "text-xs font-bold uppercase tracking-widest pr-3",
              group.isToday ? "text-[var(--primary)]" : "text-[var(--muted)]"
            )}>
              {group.label}
            </span>
            <div className="flex-1 h-px bg-[var(--card-border)]" />
            <span className={cn(
              "text-[10px] pl-3",
              group.followUps.some(f => f.status === 'overdue')
                ? "text-[var(--error)]"
                : "text-[var(--muted)]"
            )}>
              {group.followUps.length} follow-up{group.followUps.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Timeline items */}
          <div className="relative ml-4 md:ml-6 border-l-2 border-[var(--card-border)]">
            {group.followUps.map(({ followUp, status }) => (
              <TimelineItem
                key={followUp.id}
                followUp={followUp}
                status={status}
                onComplete={onComplete}
                onDismiss={onDismiss}
                onAddToDialer={onAddToDialer}
                onDialNow={onDialNow}
                onSelectCompany={onSelectCompany}
                hasUnsavedCall={hasUnsavedCall}
                isCallInProgress={isCallInProgress}
                compact={compact}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface TimelineItemProps {
  followUp: FollowUp;
  status: 'overdue' | 'due_soon' | 'upcoming';
  onComplete?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onAddToDialer?: (entry: { number: string; company?: string }) => void;
  onDialNow?: (phoneNumber: string, companyName?: string) => void;
  onSelectCompany?: (companyId: string, companyName: string, phoneNumber?: string) => void;
  hasUnsavedCall?: boolean;
  isCallInProgress?: boolean;
  compact?: boolean;
}

function TimelineItem({
  followUp,
  status,
  onComplete,
  onDismiss,
  onAddToDialer,
  onDialNow,
  onSelectCompany,
  hasUnsavedCall,
  isCallInProgress,
  compact,
}: TimelineItemProps) {
  const company = followUp.expand?.company;
  const companyName = company?.company_name || 'Unknown Company';
  const phoneNumber = followUp.expand?.phone_number_record?.phone_number;
  const hasPhone = !!phoneNumber;
  const assignedTo = followUp.expand?.assigned_to;

  const statusStyles = {
    overdue: {
      iconBg: 'bg-[var(--error-subtle)] text-[var(--error)] border-[var(--error)]/30',
      badge: 'bg-[var(--error-subtle)] text-[var(--error)]',
      cardBorder: 'border-[var(--error)]/30 hover:border-[var(--error)]/50',
      label: 'Overdue',
    },
    due_soon: {
      iconBg: 'bg-[var(--warning-subtle)] text-[var(--warning)] border-[var(--warning)]/30',
      badge: 'bg-[var(--warning-subtle)] text-[var(--warning)]',
      cardBorder: 'border-[var(--warning)]/30 hover:border-[var(--warning)]/50',
      label: 'Due Soon',
    },
    upcoming: {
      iconBg: 'bg-[var(--primary-subtle)] text-[var(--primary)] border-[var(--primary)]/30',
      badge: 'bg-[var(--primary-subtle)] text-[var(--primary)]',
      cardBorder: 'border-[var(--card-border)] hover:border-[var(--sidebar-border)]',
      label: 'Upcoming',
    },
  };

  const styles = statusStyles[status];
  const scheduledTime = new Date(followUp.scheduled_time);

  const handleDialNow = () => {
    if (phoneNumber && onDialNow) {
      onDialNow(phoneNumber, companyName);
    }
  };

  const handleAddToDialer = () => {
    if (phoneNumber && onAddToDialer) {
      onAddToDialer({ number: phoneNumber, company: companyName });
    }
  };

  const handleSelectCompany = () => {
    if (company && onSelectCompany) {
      onSelectCompany(company.id, companyName, phoneNumber);
    }
  };

  return (
    <div className="relative pl-6 md:pl-8 pb-4 last:pb-0">
      {/* Timeline dot */}
      <div className={cn(
        "absolute -left-[11px] top-3 w-5 h-5 rounded-full flex items-center justify-center border-2 border-[var(--background)]",
        styles.iconBg
      )}>
        {status === 'overdue' ? (
          <AlertCircle size={11} />
        ) : (
          <CalendarClock size={11} />
        )}
      </div>

      {/* Card */}
      <div className={cn(
        "bg-[var(--card-bg)] border rounded-xl transition-all",
        compact ? "p-3" : "p-4",
        styles.cardBorder
      )}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            {/* Company name */}
            {company ? (
              <CompanyHoverCard company={company}>
                <button
                  onClick={handleSelectCompany}
                  disabled={hasUnsavedCall}
                  className={cn(
                    "text-sm font-semibold text-left truncate block",
                    hasUnsavedCall
                      ? "cursor-not-allowed"
                      : "hover:text-[var(--primary)] hover:underline decoration-dotted"
                  )}
                >
                  {companyName}
                </button>
              </CompanyHoverCard>
            ) : (
              <span className="text-sm font-semibold truncate block">{companyName}</span>
            )}

            {/* Time */}
            <div className="flex items-center gap-2 mt-1">
              <time className="text-xs text-[var(--muted)] font-medium">
                {scheduledTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </time>
              {status !== 'upcoming' && (
                <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", styles.badge)}>
                  {styles.label}
                </span>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-1 shrink-0">
            {hasPhone && onDialNow && (
              <button
                onClick={handleDialNow}
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
            {hasPhone && onAddToDialer && (
              <button
                onClick={handleAddToDialer}
                className="p-1.5 rounded-lg hover:bg-[var(--primary)]/10 text-[var(--primary)] transition-colors"
                title="Add to dialer"
              >
                <Plus size={14} />
              </button>
            )}
            {onComplete && (
              <button
                onClick={() => onComplete(followUp.id)}
                className="p-1.5 rounded-lg hover:bg-[var(--success)]/10 text-[var(--success)] transition-colors"
                title="Complete"
              >
                <CheckCircle2 size={14} />
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(followUp.id)}
                className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors"
                title="Dismiss"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Details */}
        {!compact && (
          <div className="space-y-1.5">
            {/* Phone number */}
            {phoneNumber && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <Phone size={12} />
                <span className="font-mono">{phoneNumber}</span>
              </div>
            )}

            {/* Timezone info */}
            {followUp.client_timezone && (
              <div className="text-[10px] text-[var(--muted)]">
                <FollowUpTimeDisplay
                  scheduledTime={followUp.scheduled_time}
                  clientTimezone={followUp.client_timezone}
                  compact
                />
              </div>
            )}

            {/* Assigned to */}
            {assignedTo && (
              <div className="text-[10px] text-[var(--muted)]">
                Assigned to <span className="font-bold text-[var(--foreground)]">{assignedTo.name || assignedTo.email}</span>
              </div>
            )}

            {/* Notes */}
            {followUp.notes && (
              <p className="text-xs text-[var(--muted)] line-clamp-2 mt-2 p-2 bg-[var(--sidebar-bg)] rounded-lg">
                {followUp.notes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
