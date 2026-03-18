'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { playNotificationSound } from '@/lib/notification-sound';
import type { FollowUp } from '@/lib/types';

const CHECK_INTERVAL = 30000; // 30 seconds
// Only notify for follow-ups that became due within this window (prevents spam on load)
const NOTIFICATION_WINDOW_MS = 60000; // 1 minute

export interface FollowUpNotification {
  id: string;
  followUp: FollowUp;
  type: 'headsup' | 'due';
  timestamp: number;
}

interface UseFollowUpNotificationsOptions {
  /** Whether the user is currently on a call */
  isOnCall?: boolean;
  /** Whether notifications are enabled (e.g., session is active) */
  enabled?: boolean;
  /** Callback when a notification should be shown */
  onNotification?: (notification: FollowUpNotification) => void;
}

export function useFollowUpNotifications(options: UseFollowUpNotificationsOptions = {}) {
  const { isOnCall = false, enabled = true, onNotification } = options;
  const { pendingFollowUps } = useFollowUps();
  const { preferences } = useUserPreferences();

  // Track which follow-ups have been notified (by ID + type)
  const notifiedRef = useRef<Set<string>>(new Set());
  // Queue notifications that arrived during a call
  const queuedRef = useRef<FollowUpNotification[]>([]);
  // Track if we were on a call in the previous check
  const wasOnCallRef = useRef(false);
  // Track initialization time - don't notify for follow-ups already past due at init
  const initTimeRef = useRef<number>(Date.now());
  // Browser notification permission
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  // Get preferences with defaults
  const preNotificationMinutes = preferences?.workflow_preferences?.followup_pre_notification_minutes ?? 0;
  const soundEnabled = preferences?.workflow_preferences?.followup_sound_enabled ?? true;

  // Request browser notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(setNotificationPermission);
      }
    }
  }, []);

  const triggerNotification = useCallback((notification: FollowUpNotification) => {
    const { followUp, type } = notification;
    const companyName = followUp.expand?.company?.company_name || 'Unknown Company';

    // Play sound if enabled
    if (soundEnabled) {
      playNotificationSound(type);
    }

    // Show browser notification
    if (notificationPermission === 'granted') {
      const title = type === 'due'
        ? `Follow-up Due: ${companyName}`
        : `Upcoming Follow-up: ${companyName}`;
      const body = followUp.notes || `Scheduled follow-up with ${companyName}`;

      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: `followup-${followUp.id}-${type}`,
          requireInteraction: type === 'due', // Keep "due" notifications until dismissed
        });
      } catch (err) {
        console.warn('Failed to show browser notification:', err);
      }
    }

    // Call the callback for in-app toast
    onNotification?.(notification);
  }, [soundEnabled, notificationPermission, onNotification]);

  // Process queued notifications when call ends
  useEffect(() => {
    if (wasOnCallRef.current && !isOnCall && queuedRef.current.length > 0) {
      // Call just ended - process queued notifications
      const queued = [...queuedRef.current];
      queuedRef.current = [];

      queued.forEach(notification => {
        triggerNotification(notification);
      });
    }
    wasOnCallRef.current = isOnCall;
  }, [isOnCall, triggerNotification]);

  // Main check loop
  useEffect(() => {
    if (!enabled) return;

    const checkFollowUps = () => {
      const now = Date.now();
      const initTime = initTimeRef.current;

      pendingFollowUps.forEach(followUp => {
        const scheduledTime = new Date(followUp.scheduled_time).getTime();
        const preNotificationTime = scheduledTime - (preNotificationMinutes * 60 * 1000);

        // Check for "due" notification (at or past scheduled time)
        const dueKey = `${followUp.id}:due`;
        if (scheduledTime <= now && !notifiedRef.current.has(dueKey)) {
          // Only notify if:
          // 1. The follow-up became due AFTER we initialized (not already overdue), OR
          // 2. The follow-up became due within the notification window (recently due)
          const becameDueAfterInit = scheduledTime >= initTime;
          const isRecentlyDue = (now - scheduledTime) <= NOTIFICATION_WINDOW_MS;

          if (becameDueAfterInit || isRecentlyDue) {
            notifiedRef.current.add(dueKey);

            const notification: FollowUpNotification = {
              id: dueKey,
              followUp,
              type: 'due',
              timestamp: now,
            };

            if (isOnCall) {
              // Queue for when call ends
              queuedRef.current.push(notification);
            } else {
              triggerNotification(notification);
            }
          } else {
            // Mark as notified to prevent future spam (it was already overdue when we loaded)
            notifiedRef.current.add(dueKey);
          }
        }

        // Check for "heads up" notification (pre-notification time)
        if (preNotificationMinutes > 0) {
          const headsupKey = `${followUp.id}:headsup`;
          if (preNotificationTime <= now && scheduledTime > now && !notifiedRef.current.has(headsupKey)) {
            // Only notify if pre-notification time is after init (not already in the window)
            const preNotifyAfterInit = preNotificationTime >= initTime;
            const isRecentPreNotify = (now - preNotificationTime) <= NOTIFICATION_WINDOW_MS;

            if (preNotifyAfterInit || isRecentPreNotify) {
              notifiedRef.current.add(headsupKey);

              const notification: FollowUpNotification = {
                id: headsupKey,
                followUp,
                type: 'headsup',
                timestamp: now,
              };

              if (isOnCall) {
                queuedRef.current.push(notification);
              } else {
                triggerNotification(notification);
              }
            } else {
              // Mark as notified to prevent future spam
              notifiedRef.current.add(headsupKey);
            }
          }
        }
      });
    };

    // Run immediately
    checkFollowUps();

    // Set up interval
    const intervalId = setInterval(checkFollowUps, CHECK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [enabled, pendingFollowUps, preNotificationMinutes, isOnCall, triggerNotification]);

  // Clear notified set when follow-up is completed/dismissed
  const clearNotified = useCallback((followUpId: string) => {
    notifiedRef.current.delete(`${followUpId}:due`);
    notifiedRef.current.delete(`${followUpId}:headsup`);
  }, []);

  // Get count of queued notifications
  const queuedCount = queuedRef.current.length;

  return {
    notificationPermission,
    queuedCount,
    clearNotified,
    requestPermission: useCallback(async () => {
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        return permission;
      }
      return 'denied' as NotificationPermission;
    }, []),
  };
}
