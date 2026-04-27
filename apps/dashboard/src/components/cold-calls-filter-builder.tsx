'use client';

import { useState, useRef, useEffect } from 'react';
import { Filter, Plus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_OUTCOMES } from '@/lib/call-outcomes';

// ============================================================================
// Types
// ============================================================================

export type ColdCallFilterLogic = 'AND' | 'OR';

export type ColdCallFilterField =
  | 'call_outcome'
  | 'call_time'
  | 'owner_reached'
  | 'pitch_completed'
  | 'appointment_set';

export type ColdCallFilterOperator =
  | 'is'
  | 'is_not'
  | 'before'
  | 'after';

export interface ColdCallFilterCondition {
  id: string;
  field: ColdCallFilterField;
  operator: ColdCallFilterOperator;
  value: string;
}

// ============================================================================
// Config
// ============================================================================

const FIELD_CONFIG: Record<
  ColdCallFilterField,
  {
    label: string;
    type: 'enum' | 'date' | 'boolean';
    options?: readonly string[];
    operators: ColdCallFilterOperator[];
  }
> = {
  call_outcome: {
    label: 'Outcome',
    type: 'enum',
    options: DEFAULT_OUTCOMES,
    operators: ['is', 'is_not'],
  },
  call_time: {
    label: 'Date',
    type: 'date',
    operators: ['before', 'after'],
  },
  owner_reached: {
    label: 'Owner Reached',
    type: 'boolean',
    operators: ['is'],
  },
  pitch_completed: {
    label: 'Pitch Completed',
    type: 'boolean',
    operators: ['is'],
  },
  appointment_set: {
    label: 'Appointment Set',
    type: 'boolean',
    operators: ['is'],
  },
};

const OPERATOR_LABELS: Record<ColdCallFilterOperator, string> = {
  is: 'is',
  is_not: 'is not',
  before: 'before',
  after: 'after',
};

function defaultOperator(field: ColdCallFilterField): ColdCallFilterOperator {
  return FIELD_CONFIG[field].operators[0];
}

function defaultValue(field: ColdCallFilterField, operator: ColdCallFilterOperator): string {
  const cfg = FIELD_CONFIG[field];
  if (cfg.type === 'boolean') return 'true';
  if (cfg.options && cfg.options.length > 0) return cfg.options[0];
  if (cfg.type === 'date') return new Date().toISOString().split('T')[0];
  return '';
}

// ============================================================================
// PocketBase filter builder (exported for use in the page)
// ============================================================================

export function buildColdCallsFilter(
  conditions: ColdCallFilterCondition[],
  logic: ColdCallFilterLogic,
): string {
  const parts = conditions
    .map((c) => {
      const { field, operator: op, value: val } = c;
      if (!val.trim()) return null;
      const safe = val.replace(/"/g, '\\"');

      switch (field) {
        case 'call_outcome':
          return op === 'is' ? `call_outcome = "${safe}"` : `call_outcome != "${safe}"`;
        case 'call_time':
          return op === 'before'
            ? `call_time < "${safe} 00:00:00.000Z"`
            : `call_time > "${safe} 23:59:59.999Z"`;
        case 'owner_reached':
        case 'pitch_completed':
        case 'appointment_set':
          return `${field} = ${val === 'true' ? 'true' : 'false'}`;
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
  onChange,
  onRemove,
  isFirst,
  logic,
  onLogicChange,
}: {
  condition: ColdCallFilterCondition;
  onChange: (c: ColdCallFilterCondition) => void;
  onRemove: () => void;
  isFirst: boolean;
  logic: ColdCallFilterLogic;
  onLogicChange: (l: ColdCallFilterLogic) => void;
}) {
  const cfg = FIELD_CONFIG[condition.field];

  const handleFieldChange = (field: ColdCallFilterField) => {
    const op = defaultOperator(field);
    const val = defaultValue(field, op);
    onChange({ ...condition, field, operator: op, value: val });
  };

  const handleOperatorChange = (op: ColdCallFilterOperator) => {
    onChange({ ...condition, operator: op });
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
          onChange={(e) => handleFieldChange(e.target.value as ColdCallFilterField)}
          className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
        >
          {(Object.keys(FIELD_CONFIG) as ColdCallFilterField[]).map((f) => (
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
          onChange={(e) => handleOperatorChange(e.target.value as ColdCallFilterOperator)}
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
      {cfg.type === 'enum' && cfg.options && (
        <div className="relative">
          <select
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            className="appearance-none pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-36"
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

export interface ColdCallsFilterBuilderProps {
  conditions: ColdCallFilterCondition[];
  logic: ColdCallFilterLogic;
  onChange: (conditions: ColdCallFilterCondition[], logic: ColdCallFilterLogic) => void;
  onApply: () => void;
}

export function ColdCallsFilterBuilder({
  conditions,
  logic,
  onChange,
  onApply,
}: ColdCallsFilterBuilderProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeCount = conditions.filter((c) => c.value.trim() !== '').length;

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
    const field: ColdCallFilterField = 'call_outcome';
    const op = defaultOperator(field);
    const val = defaultValue(field, op);
    onChange([...conditions, { id: uid(), field, operator: op, value: val }], logic);
  };

  const updateCondition = (id: string, updated: ColdCallFilterCondition) => {
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
        <div className="absolute top-full right-0 mt-2 z-40 w-max min-w-[480px] max-w-[90vw] bg-[var(--background)] border border-[var(--card-border)] rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
            <span className="text-sm font-semibold">Filter Call Logs</span>
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
