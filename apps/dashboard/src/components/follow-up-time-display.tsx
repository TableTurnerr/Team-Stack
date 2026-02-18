'use client';

import { useState } from 'react';
import { Clock, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeFollowUp, formatOriginalScheduleInfo, formatDateTimeInTimezone } from '@/lib/timezone-utils';

interface FollowUpTimeDisplayProps {
  scheduledTime: string;  // ISO string
  clientTimezone: string; // IANA timezone
  showDetails?: boolean;  // Start expanded
  compact?: boolean;
  className?: string;
}

export function FollowUpTimeDisplay({
  scheduledTime,
  clientTimezone,
  showDetails = false,
  compact = false,
  className,
}: FollowUpTimeDisplayProps) {
  const [expanded, setExpanded] = useState(showDetails);
  const isOverdue = new Date(scheduledTime) < new Date();
  const relativeText = formatRelativeFollowUp(scheduledTime);
  const originalInfo = formatOriginalScheduleInfo(scheduledTime, clientTimezone);
  const fullDateTime = formatDateTimeInTimezone(scheduledTime, clientTimezone);

  if (compact) {
    return (
      <span
        className={cn(
          'text-xs cursor-pointer',
          isOverdue ? 'text-[var(--error)] font-medium' : 'text-[var(--muted)]',
          className
        )}
        title={`Scheduled: ${fullDateTime} (${clientTimezone})`}
      >
        {isOverdue && <AlertCircle size={10} className="inline mr-1" />}
        {relativeText}
      </span>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-1.5 text-sm transition-colors',
          isOverdue
            ? 'text-[var(--error)] font-medium'
            : 'text-[var(--foreground)] hover:text-[var(--primary)]'
        )}
      >
        <Clock size={14} />
        <span>{relativeText}</span>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {expanded && (
        <div className="pl-5 space-y-0.5 text-xs text-[var(--muted)] animate-in fade-in slide-in-from-top-1 duration-150">
          <p>Scheduled: {originalInfo}</p>
          <p className="text-[10px]">{clientTimezone}</p>
        </div>
      )}
    </div>
  );
}
