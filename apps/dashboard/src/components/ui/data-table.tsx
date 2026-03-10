'use client';

import { useState, useRef, useCallback, useEffect, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Table Container ─────────────────────────────────────────────────────────

interface TableContainerProps {
  children: ReactNode;
  className?: string;
}

export function TableContainer({ children, className }: TableContainerProps) {
  return (
    <div className={cn(
      "bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden",
      className
    )}>
      {children}
    </div>
  );
}

// ─── Index Cell (Number → Checkbox on hover) ─────────────────────────────────

interface IndexCellProps {
  index: number;
  selected: boolean;
  onSelect: () => void;
  /** When true, always show checkbox (e.g., when some rows are selected) */
  forceCheckbox?: boolean;
  className?: string;
}

export function IndexCell({ index, selected, onSelect, forceCheckbox, className }: IndexCellProps) {
  return (
    <td className={cn("py-3 px-4 w-12", className)}>
      <div className="relative w-5 h-5 flex items-center justify-center group/idx">
        <span className={cn(
          "text-xs tabular-nums text-[var(--muted)] select-none transition-opacity",
          (selected || forceCheckbox) ? "opacity-0" : "group-hover/idx:opacity-0"
        )}>
          {index}
        </span>
        <div
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className={cn(
            "absolute inset-0 flex items-center justify-center cursor-pointer transition-opacity",
            (selected || forceCheckbox) ? "opacity-100" : "opacity-0 group-hover/idx:opacity-100"
          )}
        >
          <div className={cn(
            "w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-all",
            selected
              ? "bg-[var(--foreground)] border-[var(--foreground)]"
              : "border-[var(--muted)] hover:border-[var(--foreground)]"
          )}>
            {selected && <Check size={10} className="text-[var(--background)]" strokeWidth={3} />}
          </div>
        </div>
      </div>
    </td>
  );
}

// ─── Header Index Cell (Select All) ──────────────────────────────────────────

interface HeaderIndexCellProps {
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  className?: string;
}

export function HeaderIndexCell({ allSelected, someSelected, onToggleAll, className }: HeaderIndexCellProps) {
  return (
    <th className={cn("py-3 px-4 w-12", className)}>
      <div
        onClick={onToggleAll}
        className="w-4 h-4 rounded border-[1.5px] flex items-center justify-center cursor-pointer transition-all mx-auto"
        style={{
          backgroundColor: allSelected || someSelected ? 'var(--foreground)' : 'transparent',
          borderColor: allSelected || someSelected ? 'var(--foreground)' : 'var(--muted)',
        }}
      >
        {allSelected && <Check size={10} className="text-[var(--background)]" strokeWidth={3} />}
        {someSelected && !allSelected && (
          <div className="w-2 h-0.5 bg-[var(--background)] rounded-full" />
        )}
      </div>
    </th>
  );
}

// ─── Resizable Table Header ──────────────────────────────────────────────────

interface ResizableThProps {
  children: ReactNode;
  width?: number;
  minWidth?: number;
  onResize?: (newWidth: number) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
  /** If false, no resize handle shown */
  resizable?: boolean;
}

/** Max width when auto-fitting a column on double-click */
const AUTO_FIT_MAX = 480;
const AUTO_FIT_PAD = 32; // px padding (px-4 = 16px each side)

export function ResizableTh({
  children,
  width,
  minWidth = 60,
  onResize,
  className,
  align = 'left',
  resizable = true,
}: ResizableThProps) {
  const thRef = useRef<HTMLTableCellElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startWidthRef.current = thRef.current?.offsetWidth || 0;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const diff = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(minWidth, startWidthRef.current + diff);
      onResize?.(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [minWidth, onResize]);

  /** Double-click: auto-fit column width to content */
  const handleDoubleClick = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!thRef.current || !onResize) return;

    const table = thRef.current.closest('table');
    if (!table) return;

    // Find column index
    const headerRow = thRef.current.parentElement;
    if (!headerRow) return;
    const colIndex = Array.from(headerRow.children).indexOf(thRef.current);

    // Measure all body cells in this column
    let maxContent = 0;
    const bodyCells = table.querySelectorAll(`tbody tr td:nth-child(${colIndex + 1})`);
    bodyCells.forEach((cell) => {
      // scrollWidth gives the full content width even if truncated
      const el = cell as HTMLElement;
      maxContent = Math.max(maxContent, el.scrollWidth);
    });

    // Also consider header content
    maxContent = Math.max(maxContent, thRef.current.scrollWidth);

    const fitted = Math.min(AUTO_FIT_MAX, Math.max(minWidth, maxContent + AUTO_FIT_PAD));
    onResize(fitted);
  }, [minWidth, onResize]);

  const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

  return (
    <th
      ref={thRef}
      className={cn(
        "py-3 px-4 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider relative group/th select-none",
        alignClass,
        className
      )}
      style={width ? { width: `${width}px` } : undefined}
    >
      {children}
      {resizable && onResize && (
        <div
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--primary)] opacity-0 group-hover/th:opacity-40 transition-opacity"
        />
      )}
    </th>
  );
}

// ─── useResizableColumns hook ────────────────────────────────────────────────

interface ColumnWidthConfig {
  key: string;
  initialWidth?: number;
  minWidth?: number;
}

export function useResizableColumns(pageKey: string, columns: ColumnWidthConfig[]) {
  const storageKey = `col-widths-${pageKey}`;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) return JSON.parse(stored);
      } catch { /* ignore */ }
    }
    const initial: Record<string, number> = {};
    columns.forEach(c => {
      if (c.initialWidth) initial[c.key] = c.initialWidth;
    });
    return initial;
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && Object.keys(widths).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    }
  }, [widths, storageKey]);

  const resize = useCallback((key: string, newWidth: number) => {
    setWidths(prev => ({ ...prev, [key]: newWidth }));
  }, []);

  const getWidth = useCallback((key: string) => widths[key], [widths]);

  return { widths, resize, getWidth };
}

// ─── useTableSelection hook ──────────────────────────────────────────────────

export function useTableSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map(i => i.id));
    });
  }, [items]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const hasSelection = selectedIds.size > 0;

  return {
    selectedIds,
    toggle,
    toggleAll,
    clear,
    isSelected,
    allSelected,
    someSelected,
    hasSelection,
    count: selectedIds.size,
  };
}

// ─── Table Pagination ────────────────────────────────────────────────────────

interface TablePaginationProps {
  page: number;
  totalPages: number;
  totalItems?: number;
  perPage?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function TablePagination({ page, totalPages, totalItems, perPage, onPageChange, className }: TablePaginationProps) {
  if (totalPages <= 1) return null;

  const startItem = totalItems ? ((page - 1) * (perPage || 20)) + 1 : undefined;
  const endItem = totalItems && perPage ? Math.min(page * perPage, totalItems) : undefined;

  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-3 border-t border-[var(--card-border)]",
      className
    )}>
      <span className="text-xs text-[var(--muted)]">
        {totalItems && startItem && endItem
          ? `${startItem}-${endItem} of ${totalItems}`
          : `Page ${page} of ${totalPages}`}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className="p-1.5 rounded-md border border-[var(--card-border)] disabled:opacity-30 hover:bg-[var(--sidebar-bg)] transition-colors"
          title="First page"
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="p-1.5 rounded-md border border-[var(--card-border)] disabled:opacity-30 hover:bg-[var(--sidebar-bg)] transition-colors"
          title="Previous page"
        >
          <ChevronLeft size={14} />
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-0.5 mx-1">
          {generatePageNumbers(page, totalPages).map((p, i) => (
            p === '...' ? (
              <span key={`dots-${i}`} className="px-1.5 text-xs text-[var(--muted)]">...</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p as number)}
                className={cn(
                  "w-7 h-7 rounded-md text-xs font-medium transition-colors",
                  page === p
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "hover:bg-[var(--sidebar-bg)] text-[var(--muted)]"
                )}
              >
                {p}
              </button>
            )
          ))}
        </div>

        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-1.5 rounded-md border border-[var(--card-border)] disabled:opacity-30 hover:bg-[var(--sidebar-bg)] transition-colors"
          title="Next page"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className="p-1.5 rounded-md border border-[var(--card-border)] disabled:opacity-30 hover:bg-[var(--sidebar-bg)] transition-colors"
          title="Last page"
        >
          <ChevronsRight size={14} />
        </button>
      </div>
    </div>
  );
}

function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | '...')[] = [];

  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('...');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('...');
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  }

  return pages;
}

// ─── Truncated Text Cell ──────────────────────────────────────────────────

interface TruncatedCellProps {
  text: string | undefined | null;
  fallback?: string;
  maxWidth?: string;
  className?: string;
}

/**
 * Table cell text that truncates with ellipsis and shows full text on hover via title attribute.
 */
export function TruncatedCell({ text, fallback = '-', maxWidth = '200px', className }: TruncatedCellProps) {
  if (!text) return <span className="text-[var(--muted)] text-xs">{fallback}</span>;
  return (
    <span
      className={cn("block truncate text-sm", className)}
      style={{ maxWidth }}
      title={text}
    >
      {text}
    </span>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

interface TableEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function TableEmptyState({ icon, title, description, action }: TableEmptyStateProps) {
  return (
    <div className="py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-[var(--sidebar-bg)] flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-[var(--muted)] mt-1">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Selection Toolbar ───────────────────────────────────────────────────────

interface SelectionToolbarProps {
  count: number;
  totalCount: number;
  children?: ReactNode;
  className?: string;
}

export function SelectionToolbar({ count, totalCount, children, className }: SelectionToolbarProps) {
  if (count === 0) return null;

  return (
    <div className={cn(
      "flex items-center justify-between gap-3 px-4 py-2 bg-[var(--primary-subtle)] border border-[var(--primary)]/20 rounded-lg animate-in slide-in-from-top-2 duration-200",
      className
    )}>
      <span className="text-sm font-medium text-[var(--primary)]">
        {count} of {totalCount} selected
      </span>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}
