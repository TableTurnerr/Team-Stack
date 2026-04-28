'use client';

import { useCallback, useMemo, useState } from 'react';

export type SelectionMode = 'visible' | 'all_filtered';

export interface AllFilteredState {
  total: number;
  exclusions: Set<string>;
}

export interface UseFilterSelectionResult {
  mode: SelectionMode;
  visible: Set<string>;
  allFiltered: AllFilteredState | null;
  selectedCount: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  togglePageAll: (pageIds: string[]) => void;
  isPageAllSelected: (pageIds: string[]) => boolean;
  enterAllFiltered: (total: number) => void;
  exitAllFiltered: () => void;
  clear: () => void;
  /** Materialize the final selected id list. Pass `fetchAllIds` to expand 'all_filtered' to ids; visible mode just returns the visible set. */
  materialize: (fetchAllIds: () => Promise<string[]>) => Promise<string[]>;
}

export function useFilterSelection(): UseFilterSelectionResult {
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [allFiltered, setAllFiltered] = useState<AllFilteredState | null>(null);

  const mode: SelectionMode = allFiltered ? 'all_filtered' : 'visible';

  const isSelected = useCallback((id: string) => {
    if (allFiltered) return !allFiltered.exclusions.has(id);
    return visible.has(id);
  }, [allFiltered, visible]);

  const toggle = useCallback((id: string) => {
    if (allFiltered) {
      setAllFiltered(s => {
        if (!s) return s;
        const next = new Set(s.exclusions);
        if (next.has(id)) next.delete(id); else next.add(id);
        return { ...s, exclusions: next };
      });
      return;
    }
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [allFiltered]);

  const isPageAllSelected = useCallback((pageIds: string[]) => {
    if (pageIds.length === 0) return false;
    if (allFiltered) return pageIds.every(id => !allFiltered.exclusions.has(id));
    return pageIds.every(id => visible.has(id));
  }, [allFiltered, visible]);

  const togglePageAll = useCallback((pageIds: string[]) => {
    const allOn = isPageAllSelected(pageIds);
    if (allFiltered) {
      setAllFiltered(s => {
        if (!s) return s;
        const next = new Set(s.exclusions);
        if (allOn) for (const id of pageIds) next.add(id);
        else for (const id of pageIds) next.delete(id);
        return { ...s, exclusions: next };
      });
      return;
    }
    setVisible(prev => {
      const next = new Set(prev);
      if (allOn) for (const id of pageIds) next.delete(id);
      else for (const id of pageIds) next.add(id);
      return next;
    });
  }, [allFiltered, isPageAllSelected]);

  const enterAllFiltered = useCallback((total: number) => {
    setAllFiltered({ total, exclusions: new Set() });
    setVisible(new Set());
  }, []);

  const exitAllFiltered = useCallback(() => {
    setAllFiltered(null);
    setVisible(new Set());
  }, []);

  const clear = useCallback(() => {
    setAllFiltered(null);
    setVisible(new Set());
  }, []);

  const selectedCount = useMemo(() => {
    if (allFiltered) return Math.max(0, allFiltered.total - allFiltered.exclusions.size);
    return visible.size;
  }, [allFiltered, visible]);

  const materialize = useCallback(async (fetchAllIds: () => Promise<string[]>): Promise<string[]> => {
    if (!allFiltered) return [...visible];
    const ids = await fetchAllIds();
    return ids.filter(id => !allFiltered.exclusions.has(id));
  }, [allFiltered, visible]);

  return {
    mode,
    visible,
    allFiltered,
    selectedCount,
    isSelected,
    toggle,
    togglePageAll,
    isPageAllSelected,
    enterAllFiltered,
    exitAllFiltered,
    clear,
    materialize,
  };
}

export const SELECT_ALL_CONFIRM_THRESHOLD = 500;

export function shouldConfirmSelectAll(total: number): boolean {
  return total > SELECT_ALL_CONFIRM_THRESHOLD;
}
