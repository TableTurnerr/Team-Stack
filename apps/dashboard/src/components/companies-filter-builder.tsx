'use client';

import { useState, useRef, useEffect } from 'react';
import { Filter, Plus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeadCategory } from '@/lib/types';
import { DEFAULT_OUTCOMES } from '@/lib/call-outcomes';

// ============================================================================
// Types
// ============================================================================

export type FilterLogic = 'AND' | 'OR';

export type FilterField =
  | 'lead_category'
  | 'status'
  | 'source'
  | 'company_location'
  | 'email'
  | 'website'
  | 'instagram_handle'
  | 'last_contacted'
  | 'do_not_contact';

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after';

export interface FilterCondition {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
}

// ============================================================================
// Config
// ============================================================================

const FIELD_CONFIG: Record<
  FilterField,
  {
    label: string;
    type: 'category' | 'multi_enum' | 'enum' | 'text' | 'date' | 'boolean';
    options?: readonly string[];
    operators: FilterOperator[];
  }
> = {
  lead_category: {
    label: 'Lead Category',
    type: 'category',
    operators: ['is', 'is_not', 'is_empty', 'is_not_empty'],
  },
  status: {
    label: 'Status',
    type: 'multi_enum',
    options: DEFAULT_OUTCOMES,
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  },
  source: {
    label: 'Source',
    type: 'enum',
    options: ['Cold Call', 'Google Maps', 'Manual', 'Instagram'],
    operators: ['is', 'is_not'],
  },
  company_location: {
    label: 'Location',
    type: 'text',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  },
  email: {
    label: 'Email',
    type: 'text',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  },
  website: {
    label: 'Website',
    type: 'text',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  },
  instagram_handle: {
    label: 'Instagram',
    type: 'text',
    operators: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  },
  last_contacted: {
    label: 'Last Contacted',
    type: 'date',
    operators: ['before', 'after', 'is_empty', 'is_not_empty'],
  },
  do_not_contact: {
    label: 'Do Not Contact',
    type: 'boolean',
    operators: ['is'],
  },
};

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: "doesn't contain",
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  before: 'before',
  after: 'after',
};

function needsValue(operator: FilterOperator): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty';
}

function defaultOperator(field: FilterField): FilterOperator {
  return FIELD_CONFIG[field].operators[0];
}

function defaultValue(field: FilterField, operator: FilterOperator, categories: LeadCategory[]): string {
  if (!needsValue(operator)) return '';
  const cfg = FIELD_CONFIG[field];
  if (cfg.type === 'boolean') return 'true';
  if (cfg.type === 'category') return categories[0]?.id ?? '';
  if (cfg.options && cfg.options.length > 0) return cfg.options[0];
  if (cfg.type === 'date') return new Date().toISOString().split('T')[0];
  return '';
}

// ============================================================================
// PocketBase filter builder (exported for use in the page)
// ============================================================================

export function buildCompaniesFilter(conditions: FilterCondition[], logic: FilterLogic): string {
  const parts = conditions
    .map((c) => {
      const { field, operator: op, value: val } = c;

      if (op === 'is_empty') {
        if (field === 'last_contacted') return `last_contacted = ""`;
        if (field === 'lead_category') return `lead_category = ""`;
        return `${field} = ""`;
      }
      if (op === 'is_not_empty') {
        if (field === 'last_contacted') return `last_contacted != ""`;
        if (field === 'lead_category') return `lead_category != ""`;
        return `${field} != ""`;
      }

      if (!val.trim()) return null;
      const safe = val.replace(/"/g, '\\"');

      switch (field) {
        case 'lead_category':
          return op === 'is' ? `lead_category = "${safe}"` : `lead_category != "${safe}"`;
        case 'status':
          return op === 'contains' ? `status ~ "${safe}"` : `status !~ "${safe}"`;
        case 'source':
          return op === 'is' ? `source = "${safe}"` : `source != "${safe}"`;
        case 'email':
        case 'website':
        case 'instagram_handle':
        case 'company_location':
          return op === 'contains' ? `${field} ~ "${safe}"` : `${field} !~ "${safe}"`;
        case 'last_contacted':
          return op === 'before'
            ? `last_contacted < "${safe} 00:00:00.000Z"`
            : `last_contacted > "${safe} 23:59:59.999Z"`;
        case 'do_not_contact':
          return `do_not_contact = ${val === 'true' ? 'true' : 'false'}`;
        default:
          return null;
      }
    })
    .filter(Boolean) as string[];

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const sep = logic === 'AND' ? ' && ' : ' || ';
  return parts.map((p) => `(${p})`).join(sep);
}

// ============================================================================
// Condition row
// ============================================================================

function ConditionRow({
  condition,
  categories,
  onChange,
  onRemove,
  isFirst,
  logic,
  onLogicChange,
}: {
  condition: FilterCondition;
  categories: LeadCategory[];
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
  isFirst: boolean;
  logic: FilterLogic;
  onLogicChange: (l: FilterLogic) => void;
}) {
  const cfg = FIELD_CONFIG[condition.field];
  const showValue = needsValue(condition.operator);

  const handleFieldChange = (field: FilterField) => {
    const op = defaultOperator(field);
    const val = defaultValue(field, op, categories);
    onChange({ ...condition, field, operator: op, value: val });
  };

  const handleOperatorChange = (op: FilterOperator) => {
    const val = needsValue(op) ? (condition.value || defaultValue(condition.field, op, categories)) : '';
    onChange({ ...condition, operator: op, value: val });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Logic badge / label */}
      <div className="w-14 shrink-0 flex justify-end">
        {isFirst ? (
          <span className="text-xs text-[var(--muted)] font-medium">Where</span>
        ) : (
          <button
            onClick={() => onLogicChange(logic === 'AND' ? 'OR' : 'AND')}
            className="text-xs font-semibold px-2 py-0.5 rounded border border-[var(--card-border)] hover:bg-[var(--card-hover)] text-[var(--foreground)] transition-colors"
            title="Click to toggle AND / OR"
          >
            {logic}
          </button>
        )}
      </div>

      {/* Field selector */}
      <div className="relative">
        <select
          value={condition.field}
          onChange={(e) => handleFieldChange(e.target.value as FilterField)}
          className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
        >
          {(Object.keys(FIELD_CONFIG) as FilterField[]).map((f) => (
            <option key={f} value={f}>
              {FIELD_CONFIG[f].label}
            </option>
          ))}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </div>

      {/* Operator selector */}
      <div className="relative">
        <select
          value={condition.operator}
          onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)}
          className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
        >
          {cfg.operators.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </div>

      {/* Value input */}
      {showValue && (
        <>
          {cfg.type === 'category' && (
            <div className="relative">
              <select
                value={condition.value}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
                className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-32"
              >
                {categories.length === 0 && (
                  <option value="">No categories</option>
                )}
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
            </div>
          )}

          {(cfg.type === 'enum' || cfg.type === 'multi_enum') && cfg.options && (
            <div className="relative">
              <select
                value={condition.value}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
                className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-32"
              >
                {cfg.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
            </div>
          )}

          {cfg.type === 'text' && (
            <input
              type="text"
              value={condition.value}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              placeholder="Value..."
              className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-32 w-40"
            />
          )}

          {cfg.type === 'date' && (
            <input
              type="date"
              value={condition.value}
              onChange={(e) => onChange({ ...condition, value: e.target.value })}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          )}

          {cfg.type === 'boolean' && (
            <div className="relative">
              <select
                value={condition.value}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
                className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
            </div>
          )}
        </>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-[var(--error-subtle)] hover:text-[var(--error)] text-[var(--muted)] transition-colors"
        title="Remove condition"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

let _uid = 0;
function uid() {
  return String(++_uid);
}

export interface CompaniesFilterBuilderProps {
  conditions: FilterCondition[];
  logic: FilterLogic;
  categories: LeadCategory[];
  onChange: (conditions: FilterCondition[], logic: FilterLogic) => void;
  onApply: () => void;
}

export function CompaniesFilterBuilder({
  conditions,
  logic,
  categories,
  onChange,
  onApply,
}: CompaniesFilterBuilderProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeCount = conditions.filter((c) => {
    if (!needsValue(c.operator)) return true;
    return c.value.trim() !== '';
  }).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const addCondition = () => {
    const field: FilterField = 'lead_category';
    const op = defaultOperator(field);
    const val = defaultValue(field, op, categories);
    onChange([...conditions, { id: uid(), field, operator: op, value: val }], logic);
  };

  const updateCondition = (id: string, updated: FilterCondition) => {
    onChange(conditions.map((c) => (c.id === id ? updated : c)), logic);
  };

  const removeCondition = (id: string) => {
    const next = conditions.filter((c) => c.id !== id);
    onChange(next, logic);
    if (next.length === 0) onApply();
  };

  const clearAll = () => {
    onChange([], logic);
    onApply();
  };

  const handleApply = () => {
    onApply();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors',
          activeCount > 0
            ? 'border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary)]'
            : 'border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)]',
        )}
        title="Filter"
      >
        <Filter size={14} />
        Filter
        {activeCount > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--primary)] text-[var(--background)]">
            {activeCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full right-0 mt-2 z-40 w-max min-w-[520px] max-w-[90vw] bg-[var(--background)] border border-[var(--card-border)] rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
            <span className="text-sm font-semibold">Filter Companies</span>
            {activeCount > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-[var(--muted)] hover:text-[var(--error)] transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Conditions */}
          <div className="p-4 space-y-2.5">
            {conditions.length === 0 ? (
              <p className="text-xs text-[var(--muted)] text-center py-2">
                No filters. Add a condition below to narrow down results.
              </p>
            ) : (
              conditions.map((c, i) => (
                <ConditionRow
                  key={c.id}
                  condition={c}
                  categories={categories}
                  isFirst={i === 0}
                  logic={logic}
                  onLogicChange={(l) => onChange(conditions, l)}
                  onChange={(updated) => updateCondition(c.id, updated)}
                  onRemove={() => removeCondition(c.id)}
                />
              ))
            )}

            <button
              onClick={addCondition}
              className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors mt-1"
            >
              <Plus size={13} />
              Add condition
            </button>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--card-border)]">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors"
            >
              Apply{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
