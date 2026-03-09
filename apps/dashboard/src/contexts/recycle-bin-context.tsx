'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type RecycleBinItemType } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';

const RECYCLE_BIN_RETENTION_DAYS = 30;

export interface DeletedItemInfo {
  id: string;
  itemType: RecycleBinItemType;
  itemLabel: string;
  recycleBinId: string;
}

interface RecycleBinContextValue {
  /** Move an item to the recycle bin. Returns info needed for undo. */
  moveToTrash: (params: {
    itemType: RecycleBinItemType;
    originalId: string;
    itemLabel: string;
    itemData: Record<string, unknown>;
    relatedData?: Record<string, unknown>;
  }) => Promise<DeletedItemInfo>;
  /** Restore an item from the recycle bin by its recycle bin record ID. */
  restoreItem: (recycleBinId: string) => Promise<void>;
  /** Permanently delete from recycle bin. */
  permanentlyDelete: (recycleBinId: string) => Promise<void>;
  /** Undo the last deletion (calls restoreItem internally). */
  undoLastDeletion: () => Promise<void>;
  /** The last deleted item info (for undo). */
  lastDeleted: DeletedItemInfo | null;
  /** Whether the user is admin. */
  isAdmin: boolean;
}

const RecycleBinContext = createContext<RecycleBinContextValue | null>(null);

export function RecycleBinProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [lastDeleted, setLastDeleted] = useState<DeletedItemInfo | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear lastDeleted after 8 seconds (matches toast duration)
  useEffect(() => {
    if (lastDeleted) {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = setTimeout(() => {
        setLastDeleted(null);
      }, 8000);
    }
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, [lastDeleted]);

  const moveToTrash = useCallback(async (params: {
    itemType: RecycleBinItemType;
    originalId: string;
    itemLabel: string;
    itemData: Record<string, unknown>;
    relatedData?: Record<string, unknown>;
  }) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + RECYCLE_BIN_RETENTION_DAYS);

    const record = await pb.collection(COLLECTIONS.RECYCLE_BIN).create({
      item_type: params.itemType,
      original_id: params.originalId,
      item_label: params.itemLabel,
      item_data: params.itemData,
      related_data: params.relatedData || null,
      deleted_by: user?.id || '',
      expires_at: expiresAt.toISOString(),
    });

    // Now delete the original record
    const collectionMap: Record<RecycleBinItemType, string> = {
      company: COLLECTIONS.COMPANIES,
      phone_number: COLLECTIONS.PHONE_NUMBERS,
      call_log: COLLECTIONS.CALL_LOGS,
      session: COLLECTIONS.COLD_CALLING_SESSIONS,
    };

    try {
      await pb.collection(collectionMap[params.itemType]).delete(params.originalId);
    } catch (err) {
      // If delete fails, remove the recycle bin entry too
      try { await pb.collection(COLLECTIONS.RECYCLE_BIN).delete(record.id); } catch { /* ignore */ }
      throw err;
    }

    const info: DeletedItemInfo = {
      id: params.originalId,
      itemType: params.itemType,
      itemLabel: params.itemLabel,
      recycleBinId: record.id,
    };

    setLastDeleted(info);
    return info;
  }, [user?.id]);

  const restoreItem = useCallback(async (recycleBinId: string) => {
    const record = await pb.collection(COLLECTIONS.RECYCLE_BIN).getOne(recycleBinId);
    const itemData = record.item_data as Record<string, unknown>;

    const collectionMap: Record<string, string> = {
      company: COLLECTIONS.COMPANIES,
      phone_number: COLLECTIONS.PHONE_NUMBERS,
      call_log: COLLECTIONS.CALL_LOGS,
      session: COLLECTIONS.COLD_CALLING_SESSIONS,
    };

    const collection = collectionMap[record.item_type];
    if (!collection) throw new Error(`Unknown item type: ${record.item_type}`);

    // Recreate the original record — PocketBase allows setting id on create
    const { id, created, updated, collectionId, collectionName, ...restData } = itemData as any;
    await pb.collection(collection).create({ id: record.original_id, ...restData });

    // Restore related data if present
    if (record.related_data) {
      const related = record.related_data as Record<string, unknown[]>;
      for (const [relCollection, items] of Object.entries(related)) {
        if (Array.isArray(items)) {
          for (const item of items) {
            const { id: relId, created: rc, updated: ru, collectionId: rci, collectionName: rcn, ...relRest } = item as any;
            try {
              await pb.collection(relCollection).create({ id: relId, ...relRest });
            } catch {
              // Item might already exist
            }
          }
        }
      }
    }

    // Remove from recycle bin
    await pb.collection(COLLECTIONS.RECYCLE_BIN).delete(recycleBinId);
    setLastDeleted(null);
  }, []);

  const permanentlyDelete = useCallback(async (recycleBinId: string) => {
    await pb.collection(COLLECTIONS.RECYCLE_BIN).delete(recycleBinId);
  }, []);

  const undoLastDeletion = useCallback(async () => {
    if (!lastDeleted) return;
    await restoreItem(lastDeleted.recycleBinId);
  }, [lastDeleted, restoreItem]);

  // Ctrl+Z global handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && lastDeleted) {
        // Don't undo if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.contentEditable === 'true') return;

        e.preventDefault();
        undoLastDeletion();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lastDeleted, undoLastDeletion]);

  return (
    <RecycleBinContext.Provider value={{
      moveToTrash,
      restoreItem,
      permanentlyDelete,
      undoLastDeletion,
      lastDeleted,
      isAdmin,
    }}>
      {children}
    </RecycleBinContext.Provider>
  );
}

export function useRecycleBin() {
  const ctx = useContext(RecycleBinContext);
  if (!ctx) throw new Error('useRecycleBin must be used within RecycleBinProvider');
  return ctx;
}

export function useRecycleBinOptional() {
  return useContext(RecycleBinContext);
}
