import { pb } from '@/lib/pocketbase';
import type { FilterCondition, FilterFieldDef, OperatorKey } from './types';
import { buildClause, isJsonArrayRelField, relFieldParts } from './build-filter';

function rebuildClauseAsDirect(condition: FilterCondition, field: FilterFieldDef, relField: string): string {
  const directType = field.type.startsWith('rel_')
    ? (field.type.slice(4) as FilterFieldDef['type'])
    : field.type;
  const directField: FilterFieldDef = {
    ...field,
    key: relField,
    realField: relField,
    type: directType,
  };
  return buildClause(condition, directField);
}

export async function fetchIdsForRelCondition(
  condition: FilterCondition,
  field: FilterFieldDef,
): Promise<Set<string>> {
  const { collection, relField } = relFieldParts(condition.field);
  if (!collection || !relField) return new Set();

  let filterStr: string;
  if (field.type === 'rel_select' && isJsonArrayRelField(relField)) {
    const tempField: FilterFieldDef = { ...field, key: relField, realField: relField, type: 'json_array' };
    const remap: Record<string, OperatorKey> = { has_any_of: 'has_any_of', has_none_of: 'has_none_of', has_all_of: 'has_all_of' };
    const op = remap[condition.operator] ?? 'has_any_of';
    filterStr = buildClause({ ...condition, operator: op }, tempField);
  } else {
    filterStr = rebuildClauseAsDirect(condition, field, relField);
  }

  if (!filterStr) return new Set();

  if (condition.field === 'company_notes_via_company.content') {
    filterStr = `(${filterStr}) && note_type = "pre_call"`;
  }

  try {
    const records = await pb.collection(collection).getFullList<{ id: string; company: string }>({
      filter: filterStr,
      batch: 500,
    });
    const ids = new Set<string>();
    for (const r of records) if (r.company) ids.add(r.company);
    return ids;
  } catch (err) {
    console.error('[filter-builder] rel filter query failed', { filterStr, collection, err });
    return new Set();
  }
}
