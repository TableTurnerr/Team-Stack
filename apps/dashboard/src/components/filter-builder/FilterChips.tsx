'use client';

import { X } from 'lucide-react';
import type { FilterCondition, FilterFieldDef, FilterRelData } from './types';
import { OPERATOR_LABELS, isMultiValueOp, isRangeOp, isValuelessOp } from './operators';

interface FilterChipsProps {
  conditions: FilterCondition[];
  fields: readonly FilterFieldDef[];
  relData?: FilterRelData;
  onRemove: (id: string) => void;
  onClear?: () => void;
}

function relLabel(field: FilterFieldDef, id: string, relData: FilterRelData): string {
  if (field.type !== 'rel_id' || !field.relCollection) return id;
  const list = relData[field.relCollection] ?? [];
  return list.find(o => o.id === id)?.label ?? id;
}

function summarize(c: FilterCondition, field: FilterFieldDef, relData: FilterRelData): string {
  const opLabel = OPERATOR_LABELS[c.operator];
  if (isValuelessOp(c.operator)) return `${field.label} ${opLabel}`;
  if (isRangeOp(c.operator)) {
    const a = c.values[0] ?? '';
    const b = c.values[1] ?? '';
    if (!a || !b) return `${field.label} ${opLabel}…`;
    return `${field.label} ${opLabel} ${a} → ${b}`;
  }
  if (isMultiValueOp(c.operator)) {
    const values = c.values
      .filter(v => v !== '')
      .map(v => relLabel(field, v, relData));
    if (values.length === 0) return `${field.label} ${opLabel}…`;
    if (values.length === 1) return `${field.label} ${opLabel} ${values[0]}`;
    return `${field.label} ${opLabel} ${values[0]} +${values.length - 1}`;
  }
  const v = c.values[0] ?? '';
  if (!v) return `${field.label} ${opLabel}…`;
  return `${field.label} ${opLabel} ${relLabel(field, v, relData)}`;
}

export function FilterChips({ conditions, fields, relData = {}, onRemove, onClear }: FilterChipsProps) {
  if (conditions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conditions.map(c => {
        const def = fields.find(f => f.key === c.field);
        if (!def) return null;
        return (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--primary-subtle)] text-[var(--primary)] text-[11px] font-medium"
          >
            {summarize(c, def, relData)}
            <button
              onClick={() => onRemove(c.id)}
              className="hover:text-[var(--error)] transition-colors"
              aria-label="Remove filter"
            >
              <X size={11} />
            </button>
          </span>
        );
      })}
      {onClear && conditions.length > 1 && (
        <button
          onClick={onClear}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--error)] transition-colors px-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
