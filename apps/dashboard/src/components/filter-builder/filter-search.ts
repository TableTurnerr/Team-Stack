import { pb } from '@/lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import type { FilterCondition, FilterFieldDef, FilterLogic } from './types';
import { buildDirectFilter, isRelFilterField } from './build-filter';
import { fetchIdsForRelCondition } from './build-rel-filter';
import { isValuelessOp } from './operators';

export interface FilterSearchInput {
  collection: string;
  fields: readonly FilterFieldDef[];
  conditions: FilterCondition[];
  logic: FilterLogic;
  page: number;
  perPage: number;
  sort?: string;
  expand?: string;
  extraFilter?: string;
}

export interface FilterSearchResult<T extends RecordModel> {
  items: T[];
  totalItems: number;
  totalPages: number;
  filterString: string;
}

function isConditionReady(c: FilterCondition, fields: readonly FilterFieldDef[]): boolean {
  if (isValuelessOp(c.operator)) return true;
  const def = fields.find(f => f.key === c.field);
  if (!def) return false;
  if (c.operator === 'between') return c.values.length >= 2 && c.values[0] !== '' && c.values[1] !== '';
  return c.values.length > 0 && c.values.some(v => v !== '');
}

export function readyConditions(conditions: FilterCondition[], fields: readonly FilterFieldDef[]): FilterCondition[] {
  return conditions.filter(c => isConditionReady(c, fields));
}

function combineFilters(parts: string[]): string {
  return parts.filter(Boolean).join(' && ');
}

export async function runFilterSearch<T extends RecordModel>(input: FilterSearchInput): Promise<FilterSearchResult<T>> {
  const { collection, fields, conditions, logic, page, perPage, sort, expand, extraFilter } = input;
  const ready = readyConditions(conditions, fields);

  const directConditions = ready.filter(c => !isRelFilterField(c.field));
  const relConditions = ready.filter(c => isRelFilterField(c.field));

  const directFilterStr = buildDirectFilter(directConditions, logic, fields);

  const relIdSets = await Promise.all(relConditions.map(rc => {
    const def = fields.find(f => f.key === rc.field);
    if (!def) return Promise.resolve(null);
    return fetchIdsForRelCondition(rc, def);
  }));
  const validRelIdSets = relIdSets.filter((s): s is Set<string> => s !== null);

  let allowedIds: Set<string> | null = null;
  if (validRelIdSets.length > 0) {
    if (logic === 'AND') {
      allowedIds = validRelIdSets.reduce<Set<string> | null>((acc, s) => {
        if (acc === null) return new Set(s);
        const next = new Set<string>();
        for (const id of acc) if (s.has(id)) next.add(id);
        return next;
      }, null);
    } else {
      allowedIds = new Set<string>();
      for (const s of validRelIdSets) for (const id of s) allowedIds.add(id);
    }
  }

  if (logic === 'AND' && allowedIds !== null && allowedIds.size === 0) {
    return { items: [], totalItems: 0, totalPages: 1, filterString: '' };
  }

  if (validRelIdSets.length === 0) {
    const filterStr = combineFilters([directFilterStr, extraFilter ?? '']);
    const result = await pb.collection(collection).getList<T>(page, perPage, {
      filter: filterStr || undefined,
      sort: sort ?? '-updated',
      ...(expand ? { expand } : {}),
    });
    return {
      items: result.items,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
      filterString: filterStr,
    };
  }

  const idList = allowedIds ? [...allowedIds] : [];
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < idList.length; i += CHUNK) chunks.push(idList.slice(i, i + CHUNK));

  const queries: Promise<T[]>[] = [];

  if (logic === 'AND') {
    if (chunks.length === 0) {
      return { items: [], totalItems: 0, totalPages: 1, filterString: '' };
    }
    for (const chunk of chunks) {
      const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
      const inner = combineFilters([directFilterStr, idClause ? `(${idClause})` : '']);
      const filterStr = combineFilters([inner, extraFilter ?? '']);
      queries.push(pb.collection(collection).getFullList<T>({
        filter: filterStr || undefined,
        sort: sort ?? '-updated',
        ...(expand ? { expand } : {}),
      }));
    }
  } else {
    if (directFilterStr) {
      const filterStr = combineFilters([directFilterStr, extraFilter ?? '']);
      queries.push(pb.collection(collection).getFullList<T>({
        filter: filterStr || undefined,
        sort: sort ?? '-updated',
        ...(expand ? { expand } : {}),
      }));
    }
    if (chunks.length === 0 && !directFilterStr) {
      return { items: [], totalItems: 0, totalPages: 1, filterString: '' };
    }
    for (const chunk of chunks) {
      const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
      const filterStr = combineFilters([`(${idClause})`, extraFilter ?? '']);
      queries.push(pb.collection(collection).getFullList<T>({
        filter: filterStr || undefined,
        sort: sort ?? '-updated',
        ...(expand ? { expand } : {}),
      }));
    }
  }

  const chunkResults = await Promise.all(queries);
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const list of chunkResults) {
    for (const c of list) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      unique.push(c);
    }
  }
  unique.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
  const total = unique.length;
  const items = unique.slice((page - 1) * perPage, page * perPage);
  return {
    items,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    filterString: '',
  };
}

export async function fetchAllMatchingIds(input: Omit<FilterSearchInput, 'page' | 'perPage' | 'sort' | 'expand'>): Promise<string[]> {
  const { collection, fields, conditions, logic, extraFilter } = input;
  const ready = readyConditions(conditions, fields);
  const directConditions = ready.filter(c => !isRelFilterField(c.field));
  const relConditions = ready.filter(c => isRelFilterField(c.field));
  const directFilterStr = buildDirectFilter(directConditions, logic, fields);

  const relIdSets = await Promise.all(relConditions.map(rc => {
    const def = fields.find(f => f.key === rc.field);
    if (!def) return Promise.resolve(null);
    return fetchIdsForRelCondition(rc, def);
  }));
  const validRelIdSets = relIdSets.filter((s): s is Set<string> => s !== null);

  let allowedIds: Set<string> | null = null;
  if (validRelIdSets.length > 0) {
    if (logic === 'AND') {
      allowedIds = validRelIdSets.reduce<Set<string> | null>((acc, s) => {
        if (acc === null) return new Set(s);
        const next = new Set<string>();
        for (const id of acc) if (s.has(id)) next.add(id);
        return next;
      }, null);
    } else {
      allowedIds = new Set<string>();
      for (const s of validRelIdSets) for (const id of s) allowedIds.add(id);
    }
  }

  if (logic === 'AND' && allowedIds !== null && allowedIds.size === 0) return [];

  if (validRelIdSets.length === 0) {
    const filterStr = combineFilters([directFilterStr, extraFilter ?? '']);
    const records = await pb.collection(collection).getFullList<{ id: string }>({
      filter: filterStr || undefined,
      fields: 'id',
      batch: 500,
    });
    return records.map(r => r.id);
  }

  const idList = allowedIds ? [...allowedIds] : [];
  const CHUNK = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < idList.length; i += CHUNK) chunks.push(idList.slice(i, i + CHUNK));
  const seen = new Set<string>();
  const queries: Promise<{ id: string }[]>[] = [];

  if (logic === 'AND') {
    for (const chunk of chunks) {
      const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
      const inner = combineFilters([directFilterStr, idClause ? `(${idClause})` : '']);
      const filterStr = combineFilters([inner, extraFilter ?? '']);
      queries.push(pb.collection(collection).getFullList<{ id: string }>({ filter: filterStr || undefined, fields: 'id', batch: 500 }));
    }
  } else {
    if (directFilterStr) {
      const filterStr = combineFilters([directFilterStr, extraFilter ?? '']);
      queries.push(pb.collection(collection).getFullList<{ id: string }>({ filter: filterStr || undefined, fields: 'id', batch: 500 }));
    }
    for (const chunk of chunks) {
      const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
      const filterStr = combineFilters([`(${idClause})`, extraFilter ?? '']);
      queries.push(pb.collection(collection).getFullList<{ id: string }>({ filter: filterStr || undefined, fields: 'id', batch: 500 }));
    }
  }

  const results = await Promise.all(queries);
  for (const list of results) for (const r of list) seen.add(r.id);
  return [...seen];
}
