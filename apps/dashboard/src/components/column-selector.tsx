'use client';

import { useState, useRef, useEffect } from 'react';
import { Columns3, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ColumnDefinition } from '@/hooks/use-column-visibility';

interface ColumnSelectorProps {
    columns: ColumnDefinition[];
    visibleColumns: Set<string>;
    onToggle: (key: string) => void;
}

export function ColumnSelector({ columns, visibleColumns, onToggle }: ColumnSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Filter out always-visible columns from the toggle list
    const toggleableColumns = columns.filter((col) => !col.alwaysVisible);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                    isOpen
                        ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                        : "border-[var(--card-border)] hover:bg-[var(--card-bg)]"
                )}
            >
                <Columns3 size={16} />
                Columns
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--card-border)]">
                        <p className="text-sm font-medium">Toggle columns</p>
                        <p className="text-xs text-[var(--muted)] mt-0.5">Choose which columns to display</p>
                    </div>

                    <div className="py-2 max-h-64 overflow-y-auto">
                        {toggleableColumns.map((column) => {
                            const isVisible = visibleColumns.has(column.key);
                            return (
                                <button
                                    key={column.key}
                                    onClick={() => onToggle(column.key)}
                                    className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--card-hover)] transition-colors text-left"
                                >
                                    <div
                                        className={cn(
                                            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                            isVisible
                                                ? "bg-[var(--primary)] border-[var(--primary)]"
                                                : "border-[var(--card-border)]"
                                        )}
                                    >
                                        {isVisible && <Check size={12} className="text-white" />}
                                    </div>
                                    <span className="text-sm">{column.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
