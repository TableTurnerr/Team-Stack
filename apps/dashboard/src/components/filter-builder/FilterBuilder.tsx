'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Plus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FilterCondition, FilterFieldDef, FilterLogic, FilterRelData, FilterScope, OperatorKey } from './types';
import {
  defaultOperatorForType,
  isMultiValueOp,
  isNumberValueOp,
  isRangeOp,
  isValuelessOp,
  operatorsForType,
  OPERATOR_LABELS,
} from './operators';
import { resolveScopedField } from './build-filter';
import { MultiValuePicker } from './MultiValuePicker';

let _uid = 0;
function uid() {
  return `c${++_uid}`;
}

function effectiveDef(field: FilterFieldDef, scope?: FilterScope): FilterFieldDef {
  return field.scopes ? resolveScopedField(field, scope) : field;
}

function defaultValuesFor(field: FilterFieldDef, operator: OperatorKey, relData: FilterRelData): string[] {
  if (isValuelessOp(operator)) return [];
  if (isMultiValueOp(operator)) return [];
  if (isRangeOp(operator)) return ['', ''];
  if (isNumberValueOp(operator)) return ['7'];
  if (field.type === 'boolean' || field.type === 'rel_boolean') return [];
  if (field.type === 'rel_id' && field.relCollection) {
    const list = relData[field.relCollection] ?? [];
    return list.length > 0 ? [list[0].id] : [''];
  }
  if (field.options && field.options.length > 0) return [field.options[0]];
  if (field.type === 'date' || field.type === 'rel_date') return [new Date().toISOString().split('T')[0]];
  return [''];
}

function isFieldDef(fields: readonly FilterFieldDef[], key: string): FilterFieldDef | undefined {
  return fields.find(f => f.key === key);
}

function activeConditionCount(conditions: FilterCondition[], fields: readonly FilterFieldDef[]): number {
  let count = 0;
  for (const c of conditions) {
    if (isValuelessOp(c.operator)) { count++; continue; }
    if (isRangeOp(c.operator)) {
      if (c.values[0] && c.values[1]) count++;
      continue;
    }
    if (isMultiValueOp(c.operator)) {
      if (c.values.some(v => v !== '')) count++;
      continue;
    }
    if (c.values.some(v => v !== '')) count++;
  }
  return count;
}

export function makeCondition(field: FilterFieldDef, relData: FilterRelData = {}): FilterCondition {
  const scope: FilterScope | undefined = field.scopes ? 'last' : undefined;
  const eff = effectiveDef(field, scope);
  const op = defaultOperatorForType(eff.type);
  return {
    id: uid(),
    field: field.key,
    operator: op,
    values: defaultValuesFor(eff, op, relData),
    ...(scope ? { scope } : {}),
  };
}

interface ConditionRowProps {
  condition: FilterCondition;
  fields: readonly FilterFieldDef[];
  relData: FilterRelData;
  onChange: (c: FilterCondition) => void;
  onRemove: () => void;
}

function ConditionRow({ condition, fields, relData, onChange, onRemove }: ConditionRowProps) {
  const rawDef = isFieldDef(fields, condition.field) ?? fields[0];
  const def = effectiveDef(rawDef, condition.scope);
  const ops = operatorsForType(def.type);
  const op = condition.operator;

  const handleFieldChange = (fieldKey: string) => {
    const newRaw = isFieldDef(fields, fieldKey);
    if (!newRaw) return;
    const scope: FilterScope | undefined = newRaw.scopes ? 'last' : undefined;
    const newDef = effectiveDef(newRaw, scope);
    const newOp = defaultOperatorForType(newDef.type);
    onChange({
      ...condition,
      field: fieldKey,
      operator: newOp,
      values: defaultValuesFor(newDef, newOp, relData),
      ...(scope ? { scope } : { scope: undefined }),
    });
  };

  const handleScopeChange = (newScope: FilterScope) => {
    if (!rawDef.scopes || condition.scope === newScope) return;
    const newDef = effectiveDef(rawDef, newScope);
    const stillValid = operatorsForType(newDef.type).includes(op);
    const newOp = stillValid ? op : defaultOperatorForType(newDef.type);
    onChange({
      ...condition,
      scope: newScope,
      operator: newOp,
      values: stillValid ? condition.values : defaultValuesFor(newDef, newOp, relData),
    });
  };

  const handleOperatorChange = (newOp: OperatorKey) => {
    const sameKind =
      (isValuelessOp(op) === isValuelessOp(newOp)) &&
      (isMultiValueOp(op) === isMultiValueOp(newOp)) &&
      (isRangeOp(op) === isRangeOp(newOp)) &&
      (isNumberValueOp(op) === isNumberValueOp(newOp));
    onChange({
      ...condition,
      operator: newOp,
      values: sameKind ? condition.values : defaultValuesFor(def, newOp, relData),
    });
  };

  const groups = ['Company', 'Assignment', 'Calls', 'Notes', 'Other'] as const;
  const grouped = groups.map(g => ({
    label: g,
    items: fields.filter(f => (f.group ?? 'Other') === g),
  })).filter(g => g.items.length > 0);
  const showGroups = grouped.length > 1;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="relative">
        <select
          value={condition.field}
          onChange={(e) => handleFieldChange(e.target.value)}
          className="appearance-none h-8 pl-2.5 pr-7 text-xs leading-none rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] max-w-48"
        >
          {showGroups
            ? grouped.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </optgroup>
              ))
            : fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)
          }
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </div>

      {rawDef.scopes && (
        <div className="inline-flex h-8 rounded-lg border border-[var(--card-border)] overflow-hidden text-[10px]">
          <button
            type="button"
            onClick={() => handleScopeChange('last')}
            className={cn(
              'px-2 font-semibold transition-colors',
              (condition.scope ?? 'last') === 'last'
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'text-[var(--muted)] hover:bg-[var(--card-hover)]',
            )}
            title="Match the most recent call only"
          >
            Last call
          </button>
          <button
            type="button"
            onClick={() => handleScopeChange('any')}
            className={cn(
              'px-2 font-semibold transition-colors border-l border-[var(--card-border)]',
              condition.scope === 'any'
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'text-[var(--muted)] hover:bg-[var(--card-hover)]',
            )}
            title="Match if any call to this company satisfies the filter"
          >
            Any call
          </button>
        </div>
      )}

      <div className="relative">
        <select
          value={op}
          onChange={(e) => handleOperatorChange(e.target.value as OperatorKey)}
          className="appearance-none h-8 pl-2.5 pr-7 text-xs leading-none rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
        >
          {ops.map(o => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </div>

      <ValueInput condition={condition} field={def} relData={relData} onChange={onChange} />

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

interface ValueInputProps {
  condition: FilterCondition;
  field: FilterFieldDef;
  relData: FilterRelData;
  onChange: (c: FilterCondition) => void;
}

function ValueInput({ condition, field, relData, onChange }: ValueInputProps) {
  const op = condition.operator;
  if (isValuelessOp(op)) return null;

  const setValues = (values: string[]) => onChange({ ...condition, values });
  const setValueAt = (i: number, v: string) => {
    const next = condition.values.slice();
    while (next.length <= i) next.push('');
    next[i] = v;
    setValues(next);
  };

  if (isRangeOp(op)) {
    const inputType = field.type === 'date' || field.type === 'rel_date' ? 'date' : 'number';
    return (
      <span className="flex items-center gap-1">
        <input
          type={inputType}
          value={condition.values[0] ?? ''}
          onChange={(e) => setValueAt(0, e.target.value)}
          className="h-8 px-2.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-32"
        />
        <span className="text-[10px] text-[var(--muted)]">and</span>
        <input
          type={inputType}
          value={condition.values[1] ?? ''}
          onChange={(e) => setValueAt(1, e.target.value)}
          className="h-8 px-2.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-32"
        />
      </span>
    );
  }

  if (isNumberValueOp(op)) {
    return (
      <input
        type="number"
        min={1}
        value={condition.values[0] ?? ''}
        onChange={(e) => setValueAt(0, e.target.value)}
        placeholder="days"
        className="h-8 px-2.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-20"
      />
    );
  }

  if (isMultiValueOp(op)) {
    let options: { value: string; label: string }[] = [];
    if (field.type === 'rel_id' && field.relCollection) {
      options = (relData[field.relCollection] ?? []).map(o => ({ value: o.id, label: o.label }));
    } else if (field.options) {
      options = field.options.map(o => ({ value: o, label: o }));
    }
    return <MultiValuePicker options={options} values={condition.values} onChange={setValues} />;
  }

  // single value
  if (field.type === 'rel_id' && field.relCollection) {
    const opts = relData[field.relCollection] ?? [];
    return (
      <div className="relative">
        <select
          value={condition.values[0] ?? ''}
          onChange={(e) => setValueAt(0, e.target.value)}
          className="appearance-none h-8 pl-2.5 pr-7 text-xs leading-none rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-36"
        >
          {opts.length === 0 && <option value="">Select…</option>}
          {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </div>
    );
  }

  if (field.options && field.options.length > 0) {
    return (
      <div className="relative">
        <select
          value={condition.values[0] ?? ''}
          onChange={(e) => setValueAt(0, e.target.value)}
          className="appearance-none h-8 pl-2.5 pr-7 text-xs leading-none rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-36"
        >
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </div>
    );
  }

  if (field.type === 'date' || field.type === 'rel_date') {
    return (
      <input
        type="date"
        value={condition.values[0] ?? ''}
        onChange={(e) => setValueAt(0, e.target.value)}
        className="h-8 px-2.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
      />
    );
  }

  if (field.type === 'number' || field.type === 'rel_number') {
    return (
      <input
        type="number"
        value={condition.values[0] ?? ''}
        onChange={(e) => setValueAt(0, e.target.value)}
        placeholder="0"
        className="h-8 px-2.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-24"
      />
    );
  }

  return (
    <input
      type="text"
      value={condition.values[0] ?? ''}
      onChange={(e) => setValueAt(0, e.target.value)}
      placeholder="Value…"
      className="h-8 px-2.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-36"
    />
  );
}

export interface FilterBuilderProps {
  fields: readonly FilterFieldDef[];
  conditions: FilterCondition[];
  logic: FilterLogic;
  relData?: FilterRelData;
  onChange: (conditions: FilterCondition[], logic: FilterLogic) => void;
  title?: string;
  matchCountLabel?: string;
}

export function FilterBuilder({
  fields,
  conditions,
  logic,
  relData = {},
  onChange,
  title = 'Filter',
}: FilterBuilderProps) {
  const [open, setOpen] = useState(false);
  const [draftConditions, setDraftConditions] = useState<FilterCondition[]>(conditions);
  const [draftLogic, setDraftLogic] = useState<FilterLogic>(logic);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; openUp: boolean }>({ top: 0, left: 0, maxHeight: 480, openUp: false });
  const activeCount = activeConditionCount(conditions, fields);
  const draftActiveCount = activeConditionCount(draftConditions, fields);
  const isDirty =
    draftLogic !== logic ||
    JSON.stringify(draftConditions) !== JSON.stringify(conditions);

  // Fork applied → draft each time the dropdown opens.
  useEffect(() => {
    if (open) {
      setDraftConditions(conditions);
      setDraftLogic(logic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePos = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const desired = 480;
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(desired, Math.max(200, openUp ? spaceAbove : spaceBelow));
      const minWidth = 560;
      const left = Math.min(
        Math.max(8, rect.right - minWidth),
        window.innerWidth - minWidth - 8,
      );
      setPos({
        top: openUp ? rect.top - 8 : rect.bottom + 8,
        left,
        maxHeight,
        openUp,
      });
    };
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open]);

  const addCondition = () => {
    const c = makeCondition(fields[0], relData);
    setDraftConditions(prev => [...prev, c]);
  };
  const updateCondition = (id: string, updated: FilterCondition) => {
    setDraftConditions(prev => prev.map(c => (c.id === id ? updated : c)));
  };
  const removeCondition = (id: string) => {
    setDraftConditions(prev => prev.filter(c => c.id !== id));
  };
  const clearAll = () => setDraftConditions([]);

  const apply = () => {
    onChange(draftConditions, draftLogic);
    setOpen(false);
  };
  const cancel = () => {
    setDraftConditions(conditions);
    setDraftLogic(logic);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors',
          activeCount > 0
            ? 'border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary)]'
            : 'border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)]',
        )}
        title={title}
      >
        <Filter size={16} />
        {title}
        {activeCount > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--primary)] text-[var(--background)]">
            {activeCount}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            maxHeight: pos.maxHeight,
          }}
          className="z-[10000] w-max min-w-[560px] max-w-[92vw] bg-[var(--background)] border border-[var(--card-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)] gap-3">
            <span className="text-sm font-semibold">{title}</span>
            <div className="flex items-center gap-2">
              {draftConditions.length > 1 && (
                <div className="inline-flex rounded-lg border border-[var(--card-border)] overflow-hidden text-xs">
                  <button
                    onClick={() => setDraftLogic('AND')}
                    className={cn('px-2.5 py-0.5 font-semibold transition-colors', draftLogic === 'AND' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]')}
                    title="Match all conditions"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setDraftLogic('OR')}
                    className={cn('px-2.5 py-0.5 font-semibold transition-colors border-l border-[var(--card-border)]', draftLogic === 'OR' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]')}
                    title="Match any condition"
                  >
                    Any
                  </button>
                </div>
              )}
              {draftActiveCount > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="p-4 space-y-2.5 overflow-y-auto flex-1 min-h-0">
            {draftConditions.length === 0 ? (
              <p className="text-xs text-[var(--muted)] text-center py-2">
                No filters. Add a condition below to narrow down results.
              </p>
            ) : (
              draftConditions.map(c => (
                <ConditionRow
                  key={c.id}
                  condition={c}
                  fields={fields}
                  relData={relData}
                  onChange={(u) => updateCondition(c.id, u)}
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

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--card-border)]">
            <button
              onClick={cancel}
              className="h-8 px-3 text-xs rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={apply}
              disabled={!isDirty}
              className="h-8 px-3 text-xs rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply{isDirty ? ' changes' : ''}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export { activeConditionCount };
