import type { FilterCondition, FilterFieldDef, FilterLogic, FilterScope, OperatorKey } from './types';
import { isValuelessOp } from './operators';

const ARRAY_REL_FIELDS = new Set(['call_outcome', 'objections', 'pain_points']);

export function resolveScopedField(
  field: FilterFieldDef,
  scope: FilterScope | undefined,
): FilterFieldDef {
  if (!field.scopes) return field;
  const variant = field.scopes[scope ?? 'last'];
  return {
    key: variant.key,
    label: field.label,
    type: variant.type,
    group: field.group,
    options: variant.options,
    relCollection: variant.relCollection,
    realField: variant.realField,
  };
}

export function resolveCondition(
  condition: FilterCondition,
  field: FilterFieldDef,
): { def: FilterFieldDef; condition: FilterCondition } {
  if (!field.scopes) return { def: field, condition };
  const def = resolveScopedField(field, condition.scope);
  return { def, condition: { ...condition, field: def.key } };
}

export function escapeFilterString(value: string): string {
  if (!value) return '';
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function isRelFilterField(key: string): boolean {
  return key.includes('_via_');
}

function quotedTokenClause(field: string, op: 'has_any_of' | 'has_none_of' | 'has_all_of', values: string[]): string {
  const parts = values
    .filter(v => v !== '')
    .map(v => {
      const inner = escapeFilterString(`"${v}"`);
      return op === 'has_none_of'
        ? `${field} !~ "${inner}"`
        : `${field} ~ "${inner}"`;
    });
  if (parts.length === 0) return '';
  if (op === 'has_all_of' || op === 'has_none_of') return `(${parts.join(' && ')})`;
  return `(${parts.join(' || ')})`;
}

function dateBoundary(value: string, end: boolean): string {
  return `${value} ${end ? '23:59:59.999Z' : '00:00:00.000Z'}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function realKey(field: FilterFieldDef): string {
  return field.realField ?? field.key;
}

function buildBoolean(field: FilterFieldDef, op: OperatorKey): string {
  const k = realKey(field);
  if (field.type === 'rel_boolean') return op === 'is_true' ? `${k} = true` : `${k} != true`;
  if (op === 'is_true') return `${k} = true`;
  return `${k} = false`;
}

function buildEmpty(field: FilterFieldDef, op: OperatorKey): string {
  const k = realKey(field);
  return op === 'is_empty' ? `${k} = ""` : `${k} != ""`;
}

function buildEnumLike(field: FilterFieldDef, op: OperatorKey, values: string[]): string {
  const k = realKey(field);
  const safe = values.filter(v => v !== '').map(escapeFilterString);
  if (safe.length === 0) return '';
  if (op === 'is') return `${k} = "${safe[0]}"`;
  if (op === 'is_not') return `${k} != "${safe[0]}"`;
  if (op === 'is_any_of') return `(${safe.map(v => `${k} = "${v}"`).join(' || ')})`;
  if (op === 'is_none_of') return `(${safe.map(v => `${k} != "${v}"`).join(' && ')})`;
  return '';
}

function buildText(field: FilterFieldDef, op: OperatorKey, values: string[]): string {
  const k = realKey(field);
  const v = escapeFilterString(values[0] ?? '');
  if (!v) return '';
  if (op === 'contains') return `${k} ~ "${v}"`;
  if (op === 'not_contains') return `${k} !~ "${v}"`;
  if (op === 'equals') return `${k} = "${v}"`;
  if (op === 'not_equals') return `${k} != "${v}"`;
  return '';
}

function buildNumber(field: FilterFieldDef, op: OperatorKey, values: string[]): string {
  const k = realKey(field);
  const a = values[0];
  if (op === 'between') {
    const b = values[1];
    if (a === '' || b === '' || a == null || b == null || isNaN(Number(a)) || isNaN(Number(b))) return '';
    return `(${k} >= ${Number(a)} && ${k} <= ${Number(b)})`;
  }
  if (a === '' || a == null || isNaN(Number(a))) return '';
  if (op === 'equals') return `${k} = ${Number(a)}`;
  if (op === 'at_least') return `${k} >= ${Number(a)}`;
  if (op === 'at_most') return `${k} <= ${Number(a)}`;
  return '';
}

function buildDate(field: FilterFieldDef, op: OperatorKey, values: string[]): string {
  const k = realKey(field);
  const a = values[0];
  if (op === 'in_last_days') {
    const n = Number(a);
    if (!Number.isFinite(n) || n < 0) return '';
    return `${k} >= "${isoDaysAgo(n)}"`;
  }
  if (op === 'more_than_days_ago') {
    const n = Number(a);
    if (!Number.isFinite(n) || n < 0) return '';
    return `${k} < "${isoDaysAgo(n)}"`;
  }
  if (op === 'between') {
    const b = values[1];
    if (!a || !b) return '';
    return `(${k} >= "${dateBoundary(escapeFilterString(a), false)}" && ${k} <= "${dateBoundary(escapeFilterString(b), true)}")`;
  }
  if (!a) return '';
  const safe = escapeFilterString(a);
  if (op === 'before') return `${k} < "${dateBoundary(safe, false)}"`;
  if (op === 'after') return `${k} > "${dateBoundary(safe, true)}"`;
  if (op === 'on_or_before') return `${k} <= "${dateBoundary(safe, true)}"`;
  if (op === 'on_or_after') return `${k} >= "${dateBoundary(safe, false)}"`;
  return '';
}

function buildJsonArray(field: FilterFieldDef, op: OperatorKey, values: string[]): string {
  const k = realKey(field);
  const cleaned = values.filter(v => v !== '');
  if (op === 'has_any_of' || op === 'has_none_of' || op === 'has_all_of') {
    if (cleaned.length === 0) return '';
    return quotedTokenClause(k, op, cleaned);
  }
  return '';
}

function buildRelId(field: FilterFieldDef, op: OperatorKey, values: string[]): string {
  const k = realKey(field);
  const safe = values.filter(v => v !== '').map(escapeFilterString);
  if (op === 'is_any_of') {
    if (safe.length === 0) return '';
    return `(${safe.map(v => `${k} = "${v}"`).join(' || ')})`;
  }
  if (op === 'is_none_of') {
    if (safe.length === 0) return '';
    return `(${safe.map(v => `${k} != "${v}"`).join(' && ')})`;
  }
  return '';
}

export function buildClause(condition: FilterCondition, field: FilterFieldDef): string {
  const { operator: op, values } = condition;

  if (isValuelessOp(op)) {
    if (op === 'is_true' || op === 'is_false') return buildBoolean(field, op);
    return buildEmpty(field, op);
  }

  switch (field.type) {
    case 'text':
      return buildText(field, op, values);
    case 'number':
      return buildNumber(field, op, values);
    case 'date':
      return buildDate(field, op, values);
    case 'enum':
      return buildEnumLike(field, op, values);
    case 'multi_enum':
    case 'json_array':
      return buildJsonArray(field, op, values);
    case 'rel_id':
      return buildRelId(field, op, values);
    case 'boolean':
    case 'rel_boolean':
      return buildBoolean(field, op);
    default:
      return '';
  }
}

export function buildDirectFilter(
  conditions: FilterCondition[],
  logic: FilterLogic,
  fields: readonly FilterFieldDef[],
): string {
  const parts: string[] = [];
  for (const c of conditions) {
    const rawDef = fields.find(f => f.key === c.field);
    if (!rawDef) continue;
    const { def, condition } = resolveCondition(c, rawDef);
    if (isRelFilterField(def.key)) continue;
    const clause = buildClause(condition, def);
    if (clause) parts.push(clause);
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const sep = logic === 'AND' ? ' && ' : ' || ';
  return parts.map(p => `(${p})`).join(sep);
}

export function relFieldParts(fieldKey: string): { collection: string; relField: string } {
  const [back, ...rest] = fieldKey.split('.');
  return {
    collection: back.replace('_via_company', ''),
    relField: rest.join('.'),
  };
}

export function isJsonArrayRelField(relField: string): boolean {
  return ARRAY_REL_FIELDS.has(relField);
}
