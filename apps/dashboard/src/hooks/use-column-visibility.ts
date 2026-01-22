'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ColumnDefinition {
  key: string;
  label: string;
  defaultVisible?: boolean;
  alwaysVisible?: boolean; // For action columns that shouldn't be toggleable
}

interface UseColumnVisibilityReturn {
  visibleColumns: Set<string>;
  toggleColumn: (key: string) => void;
  isColumnVisible: (key: string) => boolean;
  columns: ColumnDefinition[];
}

const STORAGE_PREFIX = 'column-visibility-';

export function useColumnVisibility(
  pageKey: string,
  columnDefinitions: ColumnDefinition[]
): UseColumnVisibilityReturn {
  const storageKey = `${STORAGE_PREFIX}${pageKey}`;

  // Initialize with default visibility
  const getInitialVisibility = useCallback((): Set<string> => {
    // Check localStorage first
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as string[];
          return new Set(parsed);
        } catch (e) {
          console.error('Failed to parse column visibility from localStorage:', e);
        }
      }
    }

    // Default: all columns visible
    return new Set(
      columnDefinitions
        .filter((col) => col.defaultVisible !== false)
        .map((col) => col.key)
    );
  }, [storageKey, columnDefinitions]);

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => getInitialVisibility());

  // Sync to localStorage when visibility changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify([...visibleColumns]));
    }
  }, [visibleColumns, storageKey]);

  // Load from localStorage on mount (handles SSR)
  useEffect(() => {
    setVisibleColumns(getInitialVisibility());
  }, [getInitialVisibility]);

  const toggleColumn = useCallback((key: string) => {
    // Don't toggle always-visible columns
    const col = columnDefinitions.find((c) => c.key === key);
    if (col?.alwaysVisible) return;

    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [columnDefinitions]);

  const isColumnVisible = useCallback(
    (key: string) => {
      const col = columnDefinitions.find((c) => c.key === key);
      if (col?.alwaysVisible) return true;
      return visibleColumns.has(key);
    },
    [visibleColumns, columnDefinitions]
  );

  return {
    visibleColumns,
    toggleColumn,
    isColumnVisible,
    columns: columnDefinitions,
  };
}
