'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, CheckCircle2, XCircle, Bell, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFollowUps } from '@/contexts/follow-up-context';
import type { FollowUpNotification } from '@/hooks/use-followup-notifications';

interface FollowUpNotificationToastProps {
  notification: FollowUpNotification;
  onDismiss: () => void;
}

const AUTO_DISMISS_DURATION = {
  due: 20000,      // 20 seconds for "now due" notifications
  headsup: 12000,  // 12 seconds for "heads up" notifications
};

export function FollowUpNotificationToast({
  notification,
  onDismiss,
}: FollowUpNotificationToastProps) {
  const { completeFollowUp, dismissFollowUp } = useFollowUps();
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  const { followUp, type } = notification;
  const companyName = followUp.expand?.company?.company_name || 'Unknown Company';
  const isDue = type === 'due';

  const handleClose = useCallback(() => {
    setIsLeaving(true);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  // Enter animation
  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  // Auto dismiss after duration
  useEffect(() => {
    const duration = AUTO_DISMISS_DURATION[type];
    const timer = setTimeout(() => {
      handleClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [type, handleClose]);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeFollowUp(followUp.id);
      handleClose();
    } catch {
      setCompleting(false);
    }
  };

  const handleDismissFollowUp = async () => {
    try {
      await dismissFollowUp(followUp.id);
      handleClose();
    } catch {
      // Ignore
    }
  };

  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-xl border shadow-2xl backdrop-blur-md overflow-hidden",
        "transition-all duration-300 ease-out",
        isDue
          ? "bg-gradient-to-br from-[var(--error)]/10 to-[var(--card-bg)] border-[var(--error)]/50"
          : "bg-gradient-to-br from-[var(--warning)]/10 to-[var(--card-bg)] border-[var(--warning)]/50",
        isVisible && !isLeaving
          ? "opacity-100 translate-x-0 scale-100"
          : "opacity-0 translate-x-4 scale-95"
      )}
      role="alert"
    >
      {/* Header */}
      <div className={cn(
        "px-4 py-2 flex items-center justify-between",
        isDue ? "bg-[var(--error)]/10" : "bg-[var(--warning)]/10"
      )}>
        <div className="flex items-center gap-2">
          <div className={cn(
            "p-1 rounded-md",
            isDue ? "bg-[var(--error)]/20" : "bg-[var(--warning)]/20"
          )}>
            {isDue ? (
              <Bell size={12} className={cn(isDue ? "text-[var(--error)]" : "text-[var(--warning)]", "animate-pulse")} />
            ) : (
              <Clock size={12} className="text-[var(--warning)]" />
            )}
          </div>
          <span className={cn(
            "text-[10px] font-bold uppercase tracking-widest",
            isDue ? "text-[var(--error)]" : "text-[var(--warning)]"
          )}>
            {isDue ? "Follow-Up Due Now" : "Upcoming Follow-Up"}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="p-1 rounded-md hover:bg-[var(--card-hover)] transition-colors text-[var(--muted)]"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Company */}
        <div className="flex items-center gap-2">
          <Calendar size={16} className={cn(isDue ? "text-[var(--error)]" : "text-[var(--warning)]")} />
          <span className="font-semibold text-[var(--foreground)]">{companyName}</span>
        </div>

        {/* Time info */}
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Clock size={14} />
          <span>
            {new Date(followUp.scheduled_time).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="text-xs">({followUp.client_timezone})</span>
        </div>

        {/* Notes */}
        {followUp.notes && (
          <p className="text-xs text-[var(--muted)] bg-[var(--sidebar-bg)] p-2 rounded-lg border border-[var(--card-border)] line-clamp-2">
            {followUp.notes}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleComplete}
            disabled={completing}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
              "bg-[var(--success)] text-white hover:bg-[var(--success)]/90",
              completing && "opacity-50 cursor-not-allowed"
            )}
          >
            <CheckCircle2 size={14} />
            Complete
          </button>
          <button
            onClick={handleDismissFollowUp}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XCircle size={14} />
            Dismiss
          </button>
        </div>
      </div>

      {/* Progress bar for auto-dismiss */}
      <div className={cn(
        "h-0.5 transition-all",
        isDue ? "bg-[var(--error)]" : "bg-[var(--warning)]"
      )}>
        <div
          className="h-full bg-[var(--card-bg)]/50 animate-shrink-width"
          style={{
            animationDuration: `${AUTO_DISMISS_DURATION[type]}ms`,
            animationTimingFunction: 'linear',
          }}
        />
      </div>
    </div>
  );
}

interface FollowUpNotificationContainerProps {
  notifications: FollowUpNotification[];
  onDismiss: (id: string) => void;
}

export function FollowUpNotificationContainer({
  notifications,
  onDismiss,
}: FollowUpNotificationContainerProps) {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-3 pointer-events-none">
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <FollowUpNotificationToast
            notification={notification}
            onDismiss={() => onDismiss(notification.id)}
          />
        </div>
      ))}
    </div>
  );
}
