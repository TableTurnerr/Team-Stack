'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';

export interface StagedDeletion {
  stagingId: string;
  type: 'phone_number' | 'company';
  targetId: string;
  targetLabel: string;
  associatedCallLogIds: string[];
  deleteRecordings: boolean;
  hasRecordings: boolean;
  /** Only for company deletions — phone number IDs to also delete */
  associatedPhoneNumberIds?: string[];
}

interface AdminModeContextValue {
  isAdminMode: boolean;
  enableAdminMode: () => void;
  exitAdminMode: () => void;
  pendingDeletions: StagedDeletion[];
  addStagedDeletion: (d: Omit<StagedDeletion, 'stagingId'>) => void;
  removeStagedDeletion: (stagingId: string) => void;
  updateStagedDeletion: (stagingId: string, updates: Partial<Pick<StagedDeletion, 'deleteRecordings'>>) => void;
  commitAndExit: () => Promise<void>;
  isCommitting: boolean;
  commitError: string | null;
}

const AdminModeContext = createContext<AdminModeContextValue | null>(null);

export function AdminModeProvider({ children }: { children: React.ReactNode }) {
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [pendingDeletions, setPendingDeletions] = useState<StagedDeletion[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const enableAdminMode = useCallback(() => {
    setIsAdminMode(true);
    setPendingDeletions([]);
    setCommitError(null);
  }, []);

  const exitAdminMode = useCallback(() => {
    setIsAdminMode(false);
    setPendingDeletions([]);
    setCommitError(null);
  }, []);

  const addStagedDeletion = useCallback((d: Omit<StagedDeletion, 'stagingId'>) => {
    const stagingId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingDeletions(prev => {
      const exists = prev.some(p => p.targetId === d.targetId && p.type === d.type);
      if (exists) return prev;
      return [...prev, { ...d, stagingId }];
    });
  }, []);

  const removeStagedDeletion = useCallback((stagingId: string) => {
    setPendingDeletions(prev => prev.filter(d => d.stagingId !== stagingId));
  }, []);

  const updateStagedDeletion = useCallback((stagingId: string, updates: Partial<Pick<StagedDeletion, 'deleteRecordings'>>) => {
    setPendingDeletions(prev => prev.map(d => d.stagingId === stagingId ? { ...d, ...updates } : d));
  }, []);

  const commitAndExit = useCallback(async () => {
    if (pendingDeletions.length === 0) {
      exitAdminMode();
      return;
    }

    setIsCommitting(true);
    setCommitError(null);

    try {
      for (const deletion of pendingDeletions) {
        // 1. Optionally delete recordings linked to the staged call logs
        if (deletion.deleteRecordings && deletion.associatedCallLogIds.length > 0) {
          for (const callLogId of deletion.associatedCallLogIds) {
            try {
              const recordings = await pb.collection(COLLECTIONS.RECORDINGS).getFullList({
                filter: `call_log = "${callLogId}"`,
              });
              for (const rec of recordings) {
                await pb.collection(COLLECTIONS.RECORDINGS).delete(rec.id);
              }
            } catch {
              // Non-critical
            }
          }
        }

        // 2. Delete the staged call logs
        for (const callLogId of deletion.associatedCallLogIds) {
          try {
            await pb.collection(COLLECTIONS.CALL_LOGS).delete(callLogId);
          } catch {
            // Continue on individual failures
          }
        }

        // 3. For company deletions: clean up remaining call logs + delete each phone number
        if (deletion.type === 'company' && deletion.associatedPhoneNumberIds) {
          for (const phoneId of deletion.associatedPhoneNumberIds) {
            try {
              const remainingLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList({
                filter: `phone_number_record = "${phoneId}"`,
              });
              for (const log of remainingLogs) {
                try { await pb.collection(COLLECTIONS.CALL_LOGS).delete(log.id); } catch { /* Continue */ }
              }
              await pb.collection(COLLECTIONS.PHONE_NUMBERS).delete(phoneId);
            } catch { /* Continue */ }
          }
        }

        // 4. Delete the primary record
        if (deletion.type === 'phone_number') {
          await pb.collection(COLLECTIONS.PHONE_NUMBERS).delete(deletion.targetId);
        } else if (deletion.type === 'company') {
          await pb.collection(COLLECTIONS.COMPANIES).delete(deletion.targetId);
        }
      }

      exitAdminMode();
    } catch (err) {
      setCommitError('Some deletions failed. Please retry or contact support.');
      console.error('[AdminMode] commit error:', err);
    } finally {
      setIsCommitting(false);
    }
  }, [pendingDeletions, exitAdminMode]);

  return (
    <AdminModeContext.Provider value={{
      isAdminMode,
      enableAdminMode,
      exitAdminMode,
      pendingDeletions,
      addStagedDeletion,
      removeStagedDeletion,
      updateStagedDeletion,
      commitAndExit,
      isCommitting,
      commitError,
    }}>
      {children}
    </AdminModeContext.Provider>
  );
}

export function useAdminMode() {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error('useAdminMode must be used within AdminModeProvider');
  return ctx;
}

export function useAdminModeOptional() {
  return useContext(AdminModeContext);
}
