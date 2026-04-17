'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import { COLLECTIONS, type FollowUp, type User } from '@/lib/types';

interface CreateFollowUpData {
  company: string;
  phone_number_record?: string;
  call_log?: string;
  scheduled_time: string; // ISO string (UTC)
  client_timezone: string;
  assigned_to?: string; // null = all teammates
  notes?: string;
}

interface FollowUpContextType {
  pendingFollowUps: FollowUp[];
  overdueFollowUps: FollowUp[];
  upcomingFollowUps: FollowUp[];
  createFollowUp: (data: CreateFollowUpData) => Promise<FollowUp>;
  completeFollowUp: (id: string) => Promise<void>;
  dismissFollowUp: (id: string) => Promise<void>;
  refreshFollowUps: () => Promise<void>;
  isLoading: boolean;
}

const FollowUpContext = createContext<FollowUpContextType | undefined>(undefined);

const POLL_INTERVAL = 60000; // 60 seconds

async function callFollowUpApi(path: string, followUpId: string) {
  try {
    await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pb.authStore.token}`,
      },
      body: JSON.stringify({ followUpId }),
    });
  } catch (err) {
    console.error(`[follow-up] ${path} failed`, err);
  }
}

export function FollowUpProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [pendingFollowUps, setPendingFollowUps] = useState<FollowUp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  const fetchPendingFollowUps = useCallback(async () => {
    if (!isAuthenticated || !user) return;

    try {
      const results = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
        filter: `status = "pending"`,
        sort: 'scheduled_time',
        expand: 'call_log,company,phone_number_record,assigned_to,created_by',
      });
      setPendingFollowUps(results);
    } catch (err) {
      console.error('Failed to fetch follow-ups:', err);
    }
  }, [isAuthenticated, user]);

  const refreshFollowUps = useCallback(async () => {
    setIsLoading(true);
    await fetchPendingFollowUps();
    setIsLoading(false);
  }, [fetchPendingFollowUps]);

  // Initial load + polling
  useEffect(() => {
    if (!isAuthenticated) return;

    fetchPendingFollowUps();
    pollTimerRef.current = setInterval(fetchPendingFollowUps, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isAuthenticated, fetchPendingFollowUps]);

  const now = new Date();
  const overdueFollowUps = pendingFollowUps.filter(f => new Date(f.scheduled_time) < now);
  const upcomingFollowUps = pendingFollowUps.filter(f => new Date(f.scheduled_time) >= now);

  const createFollowUp = useCallback(async (data: CreateFollowUpData): Promise<FollowUp> => {
    const followUp = await pb.collection(COLLECTIONS.FOLLOW_UPS).create<FollowUp>({
      ...data,
      created_by: user?.id,
      assigned_to: data.assigned_to || user?.id,
      status: 'pending',
    });

    // Create alerts for team members
    try {
      if (data.assigned_to) {
        // Create alert for specific user only
        await pb.collection(COLLECTIONS.ALERTS).create({
          created_by: user?.id,
          target_user: data.assigned_to,
          entity_type: 'follow_up',
          entity_id: followUp.id,
          entity_label: data.notes || 'Follow-up scheduled',
          alert_time: data.scheduled_time,
          message: `Follow-up scheduled`,
          is_dismissed: false,
        });
      } else {
        // Create alerts for all team members
        const allUsers = await pb.collection(COLLECTIONS.USERS).getFullList<User>({
          filter: `status != "suspended"`,
        });
        for (const teamMember of allUsers) {
          await pb.collection(COLLECTIONS.ALERTS).create({
            created_by: user?.id,
            target_user: teamMember.id,
            entity_type: 'follow_up',
            entity_id: followUp.id,
            entity_label: data.notes || 'Follow-up scheduled',
            alert_time: data.scheduled_time,
            message: `Follow-up scheduled`,
            is_dismissed: false,
          });
        }
      }
    } catch (err) {
      console.error('Failed to create follow-up alerts:', err);
    }

    // Schedule background push via QStash (no-op if unconfigured).
    void callFollowUpApi('/api/follow-ups/schedule-push', followUp.id);

    // Refresh list
    await fetchPendingFollowUps();
    return followUp;
  }, [user, fetchPendingFollowUps]);

  const completeFollowUp = useCallback(async (id: string) => {
    void callFollowUpApi('/api/follow-ups/cancel-push', id);
    await pb.collection(COLLECTIONS.FOLLOW_UPS).update(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    // Dismiss related alerts
    try {
      const alerts = await pb.collection(COLLECTIONS.ALERTS).getFullList({
        filter: `entity_type = "follow_up" && entity_id = "${id}"`,
      });
      for (const alert of alerts) {
        await pb.collection(COLLECTIONS.ALERTS).update(alert.id, { is_dismissed: true });
      }
    } catch { /* ignore */ }
    await fetchPendingFollowUps();
  }, [fetchPendingFollowUps]);

  const dismissFollowUp = useCallback(async (id: string) => {
    void callFollowUpApi('/api/follow-ups/cancel-push', id);
    await pb.collection(COLLECTIONS.FOLLOW_UPS).update(id, {
      status: 'dismissed',
    });
    try {
      const alerts = await pb.collection(COLLECTIONS.ALERTS).getFullList({
        filter: `entity_type = "follow_up" && entity_id = "${id}"`,
      });
      for (const alert of alerts) {
        await pb.collection(COLLECTIONS.ALERTS).update(alert.id, { is_dismissed: true });
      }
    } catch { /* ignore */ }
    await fetchPendingFollowUps();
  }, [fetchPendingFollowUps]);

  return (
    <FollowUpContext.Provider
      value={{
        pendingFollowUps,
        overdueFollowUps,
        upcomingFollowUps,
        createFollowUp,
        completeFollowUp,
        dismissFollowUp,
        refreshFollowUps,
        isLoading,
      }}
    >
      {children}
    </FollowUpContext.Provider>
  );
}

export function useFollowUps() {
  const context = useContext(FollowUpContext);
  if (!context) {
    throw new Error('useFollowUps must be used within a FollowUpProvider');
  }
  return context;
}
