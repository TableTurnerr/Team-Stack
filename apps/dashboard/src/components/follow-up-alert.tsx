'use client';

import { Calendar, Clock, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { FollowUp, Company } from '@/lib/types';

interface FollowUpAlertProps {
  followUp: FollowUp & { expand?: { company?: Company } };
  onComplete: (id: string) => void;
  onDismiss: (id: string) => void;
  className?: string;
}

export function FollowUpAlert({
  followUp,
  onComplete,
  onDismiss,
  className
}: FollowUpAlertProps) {
  // Convert scheduled_time (client timezone) to local time
  const scheduledDate = new Date(followUp.scheduled_time);
  const isOverdue = scheduledDate < new Date();

  // Get client time string
  const clientTime = scheduledDate.toLocaleTimeString('en-US', {
    timeZone: followUp.client_timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });

  return (
    <div className={cn(
      "p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg animate-in fade-in slide-in-from-right-4",
      isOverdue ? "border-orange-500/30 bg-orange-500/5" : "border-[var(--card-border)]",
      className
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className={cn(
              "p-1.5 rounded-lg",
              isOverdue ? "bg-orange-500/20 text-orange-400" : "bg-[var(--primary-subtle)] text-[var(--primary)]"
            )}>
              <Calendar size={14} />
            </div>
            <span className="text-sm font-semibold truncate">
              Follow up with {followUp.expand?.company?.company_name || 'Company'}
            </span>
          </div>
          
          <div className="space-y-1.5 mt-2">
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <Clock size={12} />
              <span>Your time: <span className="text-[var(--foreground)] font-medium">{formatDate(followUp.scheduled_time)}</span></span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <ArrowRight size={12} />
              <span>Client time: <span className="text-[var(--foreground)] font-medium">{clientTime}</span></span>
            </div>
          </div>

          {followUp.notes && (
            <p className="mt-3 text-xs text-[var(--muted)] bg-[var(--sidebar-bg)] p-2 rounded border border-[var(--card-border)] line-clamp-2">
              "{followUp.notes}"
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <button
            onClick={() => onComplete(followUp.id)}
            className="p-2 rounded-lg bg-[var(--success-subtle)] text-[var(--success)] hover:bg-[var(--success)] hover:text-white transition-all"
            title="Mark as completed"
          >
            <CheckCircle2 size={18} />
          </button>
          <button
            onClick={() => onDismiss(followUp.id)}
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-all"
            title="Dismiss"
          >
            <XCircle size={18} />
          </button>
        </div>
      </div>

      {isOverdue && (
        <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-orange-400 uppercase tracking-widest">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          Overdue Reminder
        </div>
      )}
    </div>
  );
}
