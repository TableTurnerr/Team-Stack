'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, RefreshCw, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import { sanitizeFilterValue } from '@/lib/utils';

export interface FilterRule {
  field: string;
  operator: string;
  value: string;
}

interface ListBuilderProps {
  filters: FilterRule[];
  onChange: (filters: FilterRule[]) => void;
  showCount?: boolean;
  className?: string;
}

const FILTER_FIELDS = [
  { key: 'status', label: 'Status', type: 'select', options: ['Cold No Reply', 'Replied', 'Warm', 'Booked', 'Paid', 'Client', 'Excluded'] },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'company_location', label: 'Location', type: 'text' },
  { key: 'email', label: 'Has Email', type: 'boolean' },
  { key: 'first_contacted', label: 'First Contacted', type: 'date' },
  { key: 'last_contacted', label: 'Last Contacted', type: 'date' },
  { key: 'do_not_contact', label: 'Do Not Contact', type: 'boolean' },
] as const;

const OPERATORS: Record<string, { key: string; label: string }[]> = {
  select: [
    { key: '=', label: 'is' },
    { key: '!=', label: 'is not' },
  ],
  text: [
    { key: '~', label: 'contains' },
    { key: '=', label: 'equals' },
    { key: '!=', label: 'does not equal' },
  ],
  boolean: [
    { key: '!=', label: 'exists' },
    { key: '=', label: 'does not exist' },
  ],
  date: [
    { key: '>=', label: 'on or after' },
    { key: '<=', label: 'on or before' },
    { key: '>', label: 'after' },
    { key: '<', label: 'before' },
  ],
};

function getFieldType(fieldKey: string): string {
  const field = FILTER_FIELDS.find(f => f.key === fieldKey);
  return field?.type ?? 'text';
}

function getFieldOptions(fieldKey: string): string[] | undefined {
  const field = FILTER_FIELDS.find(f => f.key === fieldKey);
  return field && 'options' in field ? [...field.options] : undefined;
}

export function buildPocketBaseFilter(filters: FilterRule[]): string {
  return filters
    .filter(f => f.field && f.operator)
    .map(f => {
      const type = getFieldType(f.field);
      if (type === 'boolean') {
        return f.operator === '!=' ? `${f.field} != ""` : `${f.field} = ""`;
      }
      const safeValue = sanitizeFilterValue(f.value);
      if (type === 'date') {
        return `${f.field} ${f.operator} "${safeValue}"`;
      }
      return `${f.field} ${f.operator} "${safeValue}"`;
    })
    .join(' && ');
}

export function ListBuilder({ filters, onChange, showCount = true, className }: ListBuilderProps) {
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const addFilter = () => {
    onChange([...filters, { field: 'status', operator: '=', value: '' }]);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, updates: Partial<FilterRule>) => {
    const updated = filters.map((f, i) => {
      if (i !== index) return f;
      const newFilter = { ...f, ...updates };
      // Reset operator and value when field type changes
      if (updates.field && updates.field !== f.field) {
        const newType = getFieldType(updates.field);
        const ops = OPERATORS[newType];
        newFilter.operator = ops?.[0]?.key ?? '=';
        newFilter.value = '';
      }
      return newFilter;
    });
    onChange(updated);
  };

  const fetchCount = useCallback(async () => {
    setCounting(true);
    try {
      const filterStr = buildPocketBaseFilter(filters);
      // Add base filter to exclude do_not_contact unless explicitly filtering for it
      const hasDoNotContactFilter = filters.some(f => f.field === 'do_not_contact');
      const baseFilter = hasDoNotContactFilter ? filterStr : [filterStr, 'do_not_contact != true'].filter(Boolean).join(' && ');
      const emailFilter = [baseFilter, 'email != ""'].filter(Boolean).join(' && ');
      const result = await pb.collection(COLLECTIONS.COMPANIES).getList(1, 1, { filter: emailFilter });
      setMatchCount(result.totalItems);
    } catch {
      setMatchCount(null);
    } finally {
      setCounting(false);
    }
  }, [filters]);

  useEffect(() => {
    if (showCount && filters.length > 0) {
      const timeout = setTimeout(fetchCount, 500);
      return () => clearTimeout(timeout);
    } else {
      setMatchCount(null);
    }
  }, [filters, showCount, fetchCount]);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter size={16} />
          Filter Rules
        </div>
        {showCount && (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            {counting ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : matchCount !== null ? (
              <span className="font-medium text-[var(--foreground)]">{matchCount}</span>
            ) : null}
            {matchCount !== null && !counting && ' matching companies with email'}
          </div>
        )}
      </div>

      {filters.length === 0 && (
        <p className="text-sm text-[var(--muted)] py-4 text-center border border-dashed border-[var(--card-border)] rounded-lg">
          No filters added. Click &quot;Add Filter&quot; to start building your audience.
        </p>
      )}

      {filters.map((filter, index) => {
        const fieldType = getFieldType(filter.field);
        const operators = OPERATORS[fieldType] ?? OPERATORS.text;
        const options = getFieldOptions(filter.field);

        return (
          <div key={index} className="flex items-center gap-2 flex-wrap">
            {index > 0 && (
              <span className="text-xs font-medium text-[var(--muted)] uppercase w-10">AND</span>
            )}

            {/* Field selector */}
            <select
              value={filter.field}
              onChange={(e) => updateFilter(index, { field: e.target.value })}
              className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            >
              {FILTER_FIELDS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>

            {/* Operator selector */}
            <select
              value={filter.operator}
              onChange={(e) => updateFilter(index, { operator: e.target.value })}
              className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            >
              {operators.map(op => (
                <option key={op.key} value={op.key}>{op.label}</option>
              ))}
            </select>

            {/* Value input */}
            {fieldType !== 'boolean' && (
              <>
                {options ? (
                  <select
                    value={filter.value}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-[140px]"
                  >
                    <option value="">Select...</option>
                    {options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : fieldType === 'date' ? (
                  <input
                    type="date"
                    value={filter.value}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                  />
                ) : (
                  <input
                    type="text"
                    value={filter.value}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    placeholder="Enter value..."
                    className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-[140px]"
                  />
                )}
              </>
            )}

            <button
              onClick={() => removeFilter(index)}
              className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
              title="Remove filter"
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}

      <button
        onClick={addFilter}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-dashed border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <Plus size={14} />
        Add Filter
      </button>
    </div>
  );
}
