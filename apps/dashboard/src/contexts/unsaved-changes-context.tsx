'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';

export interface UnsavedChange {
  id: string;          // Unique field identifier (e.g., "company_abc123_name")
  collection: string;  // PocketBase collection name
  recordId: string;    // PocketBase record ID
  field: string;       // Field name on the record
  originalValue: string;
  currentValue: string;
}

interface UnsavedChangesContextType {
  changes: Map<string, UnsavedChange>;
  hasUnsavedChanges: boolean;
  changeCount: number;
  registerChange: (change: UnsavedChange) => void;
  removeChange: (id: string) => void;
  saveAll: () => Promise<{ success: boolean; errors: string[] }>;
  undoAll: () => void;
  undoChange: (id: string) => void;
  isSaving: boolean;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | undefined>(undefined);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [changes, setChanges] = useState<Map<string, UnsavedChange>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  const registerChange = useCallback((change: UnsavedChange) => {
    setChanges(prev => {
      const next = new Map(prev);
      // If value matches original, remove the change
      if (change.currentValue === change.originalValue) {
        next.delete(change.id);
        localStorage.removeItem(`unsaved_${change.id}`);
      } else {
        next.set(change.id, change);
      }
      return next;
    });
  }, []);

  const removeChange = useCallback((id: string) => {
    setChanges(prev => {
      const next = new Map(prev);
      next.delete(id);
      localStorage.removeItem(`unsaved_${id}`);
      return next;
    });
  }, []);

  const saveAll = useCallback(async () => {
    setIsSaving(true);
    const errors: string[] = [];

    try {
      // Group changes by collection + recordId
      const grouped = new Map<string, UnsavedChange[]>();
      for (const change of changes.values()) {
        const key = `${change.collection}:${change.recordId}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(change);
      }

      // Batch update each record
      for (const [key, fieldChanges] of grouped) {
        const [collection, recordId] = key.split(':');
        const updateData: Record<string, string> = {};
        for (const fc of fieldChanges) {
          updateData[fc.field] = fc.currentValue;
        }
        try {
          await pb.collection(collection).update(recordId, updateData);
          // Clear localStorage for successfully saved changes
          for (const fc of fieldChanges) {
            localStorage.removeItem(`unsaved_${fc.id}`);
          }
        } catch (err) {
          errors.push(`Failed to update ${collection}/${recordId}: ${err}`);
        }
      }

      if (errors.length === 0) {
        setChanges(new Map());
      } else {
        // Remove only successfully saved changes
        setChanges(prev => {
          const next = new Map(prev);
          for (const [, fieldChanges] of grouped) {
            for (const fc of fieldChanges) {
              if (!errors.some(e => e.includes(fc.collection))) {
                next.delete(fc.id);
              }
            }
          }
          return next;
        });
      }
    } finally {
      setIsSaving(false);
    }

    return { success: errors.length === 0, errors };
  }, [changes]);

  const undoAll = useCallback(() => {
    for (const change of changes.values()) {
      localStorage.removeItem(`unsaved_${change.id}`);
    }
    setChanges(new Map());
  }, [changes]);

  const undoChange = useCallback((id: string) => {
    localStorage.removeItem(`unsaved_${id}`);
    setChanges(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return (
    <UnsavedChangesContext.Provider
      value={{
        changes,
        hasUnsavedChanges: changes.size > 0,
        changeCount: changes.size,
        registerChange,
        removeChange,
        saveAll,
        undoAll,
        undoChange,
        isSaving,
      }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within an UnsavedChangesProvider');
  }
  return context;
}
