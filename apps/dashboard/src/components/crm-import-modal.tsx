'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Filter, Building2, Phone, Check, ChevronDown, ChevronUp, Plus, Trash2, MapPin, User, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { Company, PhoneNumber, User as UserType, LeadCategory } from '@/lib/types';
import { sanitizeFilterValue } from '@/lib/utils';
import { getOutcomeColors, DEFAULT_OUTCOMES } from '@/lib/call-outcomes';

const COMPANY_STATUSES = ['Cold No Reply', 'Replied', 'Warm', 'Booked', 'Paid', 'Client', 'Excluded'] as const;
const CALL_DIRECTIONS = ['outbound', 'inbound'] as const;
const SOURCES = ['Cold Call', 'Google Maps', 'Manual', 'Instagram'] as const;

type FilterLogic = 'AND' | 'OR';

export interface CRMImportEntry {
    number: string;
    company?: string;
}

interface CRMImportModalProps {
    open: boolean;
    onClose: () => void;
    onImport: (entries: CRMImportEntry[]) => void;
}

// ── Filter types (matching email marketing pattern) ──

interface FilterRule {
    field: string;
    operator: string;
    value: string;
}

type FilterField = {
    key: string;
    label: string;
    type: 'text' | 'boolean' | 'date' | 'select' | 'json_array' | 'number' | 'rel_id' | 'rel_select' | 'rel_text' | 'rel_boolean' | 'rel_number' | 'rel_date';
    options?: readonly string[];
    relCollection?: 'users' | 'lead_categories';
    group?: string;
};

const FILTER_FIELDS: readonly FilterField[] = [
    // ── Company info ──
    { key: 'company_name', label: 'Company Name', type: 'text', group: 'Company' },
    { key: 'owner_name', label: 'Owner Name', type: 'text', group: 'Company' },
    { key: 'status', label: 'Status', type: 'json_array', options: COMPANY_STATUSES, group: 'Company' },
    { key: 'source', label: 'Source', type: 'select', options: SOURCES, group: 'Company' },
    { key: 'company_location', label: 'Location', type: 'text', group: 'Company' },
    { key: 'industry', label: 'Industry', type: 'text', group: 'Company' },
    { key: 'price_range', label: 'Price Range', type: 'text', group: 'Company' },
    { key: 'google_rating', label: 'Google Rating', type: 'text', group: 'Company' },
    { key: 'google_reviews_count', label: 'Google Reviews Count', type: 'text', group: 'Company' },
    { key: 'notes', label: 'Notes Include', type: 'text', group: 'Company' },
    { key: 'instagram_handle', label: 'Instagram Handle', type: 'text', group: 'Company' },
    { key: 'contact_source', label: 'Contact Source', type: 'text', group: 'Company' },
    { key: 'first_contacted', label: 'First Contacted', type: 'date', group: 'Company' },
    { key: 'last_contacted', label: 'Last Contacted', type: 'date', group: 'Company' },
    { key: 'email', label: 'Has Email', type: 'boolean', group: 'Company' },
    { key: 'website', label: 'Has Website', type: 'boolean', group: 'Company' },
    { key: 'instagram_handle_present', label: 'Has Instagram', type: 'boolean', group: 'Company' },
    { key: 'do_not_contact', label: 'Do Not Contact', type: 'boolean', group: 'Company' },

    // ── Assignment / categorization ──
    { key: 'assigned_to', label: 'Assignee', type: 'rel_id', relCollection: 'users', group: 'Assignment' },
    { key: 'assigned_to_present', label: 'Has Assignee', type: 'boolean', group: 'Assignment' },
    { key: 'lead_category', label: 'Lead Category', type: 'rel_id', relCollection: 'lead_categories', group: 'Assignment' },
    { key: 'lead_category_present', label: 'Has Lead Category', type: 'boolean', group: 'Assignment' },

    // ── Call history (any call) ──
    { key: 'call_logs_via_company.call_outcome', label: 'Call Outcome Includes', type: 'rel_select', options: [...DEFAULT_OUTCOMES, 'Other'], group: 'Calls' },
    { key: 'call_logs_via_company.direction', label: 'Call Direction', type: 'rel_select', options: CALL_DIRECTIONS, group: 'Calls' },
    { key: 'call_logs_via_company.status_changed_to', label: 'Call Status Changed To', type: 'rel_select', options: COMPANY_STATUSES, group: 'Calls' },
    { key: 'call_logs_via_company.caller', label: 'Called By', type: 'rel_id', relCollection: 'users', group: 'Calls' },
    { key: 'call_logs_via_company.post_call_notes', label: 'Post-Call Notes Include', type: 'rel_text', group: 'Calls' },
    { key: 'call_logs_via_company.owner_reached', label: 'Owner Reached On Call', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.appointment_set', label: 'Appointment Set', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.pitch_completed', label: 'Pitch Completed', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.has_recording', label: 'Has Recording', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.duration', label: 'Total Call Duration (s)', type: 'rel_number', group: 'Calls' },
    { key: 'call_logs_via_company.call_duration', label: 'Talk Duration (s)', type: 'rel_number', group: 'Calls' },
    { key: 'call_logs_via_company.call_time', label: 'Call Date', type: 'rel_date', group: 'Calls' },

    // ── Company notes (pre-call / research) ──
    { key: 'company_notes_via_company.content', label: 'Pre-Call Note Includes', type: 'rel_text', group: 'Notes' },
];

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
    number: [
        { key: '>=', label: 'at least' },
        { key: '<=', label: 'at most' },
        { key: '=', label: 'equals' },
    ],
    json_array: [
        { key: '?=', label: 'includes' },
        { key: '?!=', label: 'excludes' },
    ],
    rel_id: [
        { key: '=', label: 'is' },
        { key: '!=', label: 'is not' },
    ],
    rel_select: [
        { key: '?=', label: 'includes' },
        { key: '?!=', label: 'excludes' },
    ],
    rel_text: [
        { key: '?~', label: 'contains' },
        { key: '?=', label: 'equals' },
    ],
    rel_boolean: [
        { key: '?=', label: 'is true' },
        { key: '?!=', label: 'is false or missing' },
    ],
    rel_number: [
        { key: '?>=', label: 'at least' },
        { key: '?<=', label: 'at most' },
        { key: '?=', label: 'equals' },
    ],
    rel_date: [
        { key: '?>=', label: 'on or after' },
        { key: '?<=', label: 'on or before' },
        { key: '?>', label: 'after' },
        { key: '?<', label: 'before' },
    ],
};

function getFieldType(fieldKey: string): FilterField['type'] {
    const field = FILTER_FIELDS.find(f => f.key === fieldKey);
    return field?.type ?? 'text';
}

function getFieldOptions(fieldKey: string): string[] | undefined {
    const field = FILTER_FIELDS.find(f => f.key === fieldKey);
    return field?.options ? [...field.options] : undefined;
}

function getFieldDef(fieldKey: string): FilterField | undefined {
    return FILTER_FIELDS.find(f => f.key === fieldKey);
}

function isRelFilter(f: FilterRule): boolean {
    return f.field.includes('_via_');
}

// Map "virtual" presence-style fields back to their underlying column.
const PRESENCE_FIELD_MAP: Record<string, string> = {
    instagram_handle_present: 'instagram_handle',
    assigned_to_present: 'assigned_to',
    lead_category_present: 'lead_category',
};

// Build a "quoted JSON token" filter clause for a field stored as a JSON array.
// PB's `?=` isn't supported on this server, so we fall back to substring-matching
// the JSON-encoded value (with surrounding quotes) to get exact-token semantics.
function buildJsonArrayClause(field: string, op: string, value: string): string {
    const wrapped = `"${value}"`;
    const safeValue = sanitizeFilterValue(wrapped);
    const likeOp = op === '?=' || op === '=' ? '~' : op === '?!=' || op === '!=' ? '!~' : op;
    return `${field} ${likeOp} "${safeValue}"`;
}

function buildDirectClause(f: FilterRule): string {
    const type = getFieldType(f.field);
    const realField = PRESENCE_FIELD_MAP[f.field] ?? f.field;
    if (type === 'boolean') {
        return f.operator === '!=' ? `${realField} != ""` : `${realField} = ""`;
    }
    if (type === 'json_array') {
        if (!f.value) return '';
        return buildJsonArrayClause(realField, f.operator, f.value);
    }
    if (type === 'rel_id') {
        if (!f.value) return '';
        const safeValue = sanitizeFilterValue(f.value);
        return `${realField} ${f.operator} "${safeValue}"`;
    }
    if (type === 'number') {
        if (f.value === '' || isNaN(Number(f.value))) return '';
        return `${realField} ${f.operator} ${Number(f.value)}`;
    }
    if (!f.value) return '';
    const safeValue = sanitizeFilterValue(f.value);
    return `${realField} ${f.operator} "${safeValue}"`;
}

function buildDirectFilter(filters: FilterRule[], logic: FilterLogic): string {
    const parts = filters
        .filter(f => f.field && f.operator && !isRelFilter(f))
        .map(buildDirectClause)
        .filter(Boolean);
    if (parts.length === 0) return '';
    const joiner = logic === 'OR' ? ' || ' : ' && ';
    return parts.map(p => `(${p})`).join(joiner);
}

// Fields on related collections stored as JSON arrays (multi-select).
// PB's `?=` is unreliable here, so we match the JSON-encoded token via `~`.
const ARRAY_REL_FIELDS = new Set(['call_outcome', 'objections', 'pain_points']);

// Fetch the set of company IDs matching a single cross-table filter rule.
async function fetchCompanyIdsForRelFilter(f: FilterRule): Promise<Set<string>> {
    const [backRelName, ...rest] = f.field.split('.');
    const relField = rest.join('.');
    const collectionName = backRelName.replace('_via_company', '');

    const type = getFieldType(f.field);
    const directOp = f.operator.startsWith('?') ? f.operator.slice(1) : f.operator;

    let filterStr: string;
    if (type === 'rel_boolean') {
        filterStr = directOp === '=' ? `${relField} = true` : `${relField} != true`;
    } else if (type === 'rel_number') {
        if (f.value === '' || isNaN(Number(f.value))) return new Set();
        filterStr = `${relField} ${directOp} ${Number(f.value)}`;
    } else if (type === 'rel_date') {
        if (!f.value) return new Set();
        filterStr = `${relField} ${directOp} "${sanitizeFilterValue(f.value)}"`;
    } else {
        if (!f.value) return new Set();
        if (type === 'rel_select' && ARRAY_REL_FIELDS.has(relField)) {
            filterStr = buildJsonArrayClause(relField, f.operator, f.value);
        } else {
            const safeValue = sanitizeFilterValue(f.value);
            filterStr = `${relField} ${directOp} "${safeValue}"`;
        }
    }

    // Scope "Pre-Call Note Includes" to note_type = "pre_call"
    if (f.field === 'company_notes_via_company.content') {
        filterStr = `(${filterStr}) && note_type = "pre_call"`;
    }

    try {
        const records = await pb.collection(collectionName).getFullList<{ id: string; company: string }>({
            filter: filterStr,
            batch: 500,
        });
        return new Set(records.map(r => r.company).filter(Boolean));
    } catch (err) {
        console.error('[CRM filter] query failed', { filterStr, collectionName, err });
        return new Set();
    }
}

// ── Types for internal state ──

interface CompanyWithPhones {
    company: Company;
    phones: PhoneNumber[];
    expanded: boolean;
}

type TabType = 'search' | 'filters';

// ── Component ──

export function CRMImportModal({ open, onClose, onImport }: CRMImportModalProps) {
    const [tab, setTab] = useState<TabType>('search');

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<CompanyWithPhones[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    // Filter state
    const [filters, setFilters] = useState<FilterRule[]>([]);
    const [filterLogic, setFilterLogic] = useState<FilterLogic>('AND');
    const [filterResults, setFilterResults] = useState<CompanyWithPhones[]>([]);
    const [filterLoading, setFilterLoading] = useState(false);
    const [filterMatchCount, setFilterMatchCount] = useState<number | null>(null);
    const [filterPage, setFilterPage] = useState(1);
    const [filterTotalPages, setFilterTotalPages] = useState(1);

    // Lookup data for relation-based filters
    const [users, setUsers] = useState<UserType[]>([]);
    const [leadCategories, setLeadCategories] = useState<LeadCategory[]>([]);

    // Selection state — map of phoneNumber.id → { number, companyName }
    const [selected, setSelected] = useState<Map<string, { number: string; company: string }>>(new Map());

    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchSeqRef = useRef(0);
    const filterSeqRef = useRef(0);
    const PER_PAGE = 25;

    // Load lookup data once when the modal first opens
    useEffect(() => {
        if (!open) return;
        if (users.length > 0 && leadCategories.length > 0) return;
        (async () => {
            try {
                const [u, c] = await Promise.all([
                    pb.collection(COLLECTIONS.USERS).getFullList<UserType>({ fields: 'id,name,email', sort: 'name' }),
                    pb.collection(COLLECTIONS.LEAD_CATEGORIES).getFullList<LeadCategory>({ sort: 'name' }),
                ]);
                setUsers(u);
                setLeadCategories(c);
            } catch (err) {
                console.error('[CRM import] failed to load lookups', err);
            }
        })();
    }, [open, users.length, leadCategories.length]);

    // Focus search input on open
    useEffect(() => {
        if (open && tab === 'search') {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [open, tab]);

    // Reset on close
    useEffect(() => {
        if (!open) {
            setSearchQuery('');
            setSearchResults([]);
            setFilterResults([]);
            setFilters([]);
            setFilterLogic('AND');
            setSelected(new Map());
            setFilterMatchCount(null);
            setFilterPage(1);
        }
    }, [open]);

    // ── Search logic ──

    const doSearch = useCallback(async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) {
            setSearchResults([]);
            setSearchLoading(false);
            return;
        }
        const seq = ++searchSeqRef.current;
        setSearchLoading(true);
        try {
            const safeQ = sanitizeFilterValue(trimmed);
            const companyFilter = `(company_name ~ "${safeQ}" || owner_name ~ "${safeQ}" || email ~ "${safeQ}" || instagram_handle ~ "${safeQ}" || website ~ "${safeQ}") && do_not_contact != true`;

            // Look up companies matching by their own fields, plus companies whose phone numbers match
            const [byCompany, byPhone] = await Promise.all([
                pb.collection(COLLECTIONS.COMPANIES).getList<Company>(1, 30, {
                    filter: companyFilter,
                    sort: '-updated',
                }),
                pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
                    filter: `phone_number ~ "${safeQ}" && disassociated != true`,
                    batch: 100,
                    fields: 'id,company,phone_number,label,location_name,disassociated',
                }).catch(() => [] as PhoneNumber[]),
            ]);

            if (seq !== searchSeqRef.current) return; // a newer search has superseded this one

            const companyMap = new Map<string, Company>();
            byCompany.items.forEach(c => companyMap.set(c.id, c));

            // Fetch the additional companies referenced by matching phone numbers
            const extraIds = Array.from(new Set(byPhone.map(p => p.company).filter(id => id && !companyMap.has(id))));
            if (extraIds.length > 0) {
                const idClause = extraIds.map(id => `id = "${id}"`).join(' || ');
                const extra = await pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
                    filter: `(${idClause}) && do_not_contact != true`,
                });
                if (seq !== searchSeqRef.current) return;
                extra.forEach(c => companyMap.set(c.id, c));
            }

            const companies = Array.from(companyMap.values()).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
            if (companies.length === 0) {
                setSearchResults([]);
                return;
            }

            const companyIds = companies.map(c => c.id);
            const phoneFilter = companyIds.map(id => `company = "${id}"`).join(' || ');
            const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({ filter: phoneFilter });
            if (seq !== searchSeqRef.current) return;

            const phoneMap = new Map<string, PhoneNumber[]>();
            for (const p of phones) {
                if (p.disassociated) continue;
                const arr = phoneMap.get(p.company) ?? [];
                arr.push(p);
                phoneMap.set(p.company, arr);
            }
            setSearchResults(companies.map(c => ({
                company: c,
                phones: phoneMap.get(c.id) ?? [],
                expanded: false,
            })));
        } catch (err) {
            if (seq === searchSeqRef.current) {
                console.error('[CRM search] failed', err);
                setSearchResults([]);
            }
        } finally {
            if (seq === searchSeqRef.current) setSearchLoading(false);
        }
    }, []);

    // Debounced search
    useEffect(() => {
        if (tab !== 'search') return;
        const timeout = setTimeout(() => doSearch(searchQuery), 350);
        return () => clearTimeout(timeout);
    }, [searchQuery, tab, doSearch]);

    // ── Filter logic ──

    const attachPhones = useCallback(async (companies: Company[]): Promise<CompanyWithPhones[]> => {
        if (companies.length === 0) return [];
        const phoneFilter = companies.map(c => `company = "${c.id}"`).join(' || ');
        const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({ filter: phoneFilter });
        const phoneMap = new Map<string, PhoneNumber[]>();
        for (const p of phones) {
            if (p.disassociated) continue;
            const arr = phoneMap.get(p.company) ?? [];
            arr.push(p);
            phoneMap.set(p.company, arr);
        }
        return companies.map(c => ({ company: c, phones: phoneMap.get(c.id) ?? [], expanded: false }));
    }, []);

    const doFilterSearch = useCallback(async (page: number) => {
        const seq = ++filterSeqRef.current;
        setFilterLoading(true);
        try {
            const relFilters = filters.filter(isRelFilter);
            const directFilters = filters.filter(f => f.field && f.operator && !isRelFilter(f));

            // Resolve every cross-table rule independently to its set of company IDs
            const relIdSets = await Promise.all(relFilters.map(async rf => {
                const type = getFieldType(rf.field);
                if (type !== 'rel_boolean' && !rf.value) return null;
                return await fetchCompanyIdsForRelFilter(rf);
            }));
            if (seq !== filterSeqRef.current) return;

            const validRelIdSets = relIdSets.filter((s): s is Set<string> => s !== null);

            const directFilterStr = buildDirectFilter(directFilters, filterLogic);
            const hasDoNotContactFilter = filters.some(f => f.field === 'do_not_contact');
            const dncClause = hasDoNotContactFilter ? '' : 'do_not_contact != true';

            // ── Combine the rel-filter ID sets with the direct PB filter according to logic ──
            // AND mode → intersect all rel ID sets; query is (direct) && id IN intersection
            // OR mode  → union all rel ID sets; query is (direct) || id IN union
            let allowedIds: Set<string> | null = null;
            if (validRelIdSets.length > 0) {
                if (filterLogic === 'AND') {
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

            // In AND mode an empty intersection means zero results, regardless of direct filters.
            if (filterLogic === 'AND' && allowedIds !== null && allowedIds.size === 0) {
                setFilterMatchCount(0);
                setFilterTotalPages(1);
                setFilterResults([]);
                return;
            }

            // ── Fast path: no rel filters → single paginated PB query ──
            if (validRelIdSets.length === 0) {
                const baseFilter = [directFilterStr, dncClause].filter(Boolean).join(' && ');
                const companies = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(page, PER_PAGE, {
                    filter: baseFilter || undefined,
                    sort: '-updated',
                });
                if (seq !== filterSeqRef.current) return;
                setFilterMatchCount(companies.totalItems);
                setFilterTotalPages(companies.totalPages);
                const withPhones = await attachPhones(companies.items);
                if (seq !== filterSeqRef.current) return;
                setFilterResults(withPhones);
                return;
            }

            // ── Slow path: rel filters present → fetch matching companies in chunks ──
            const idList = allowedIds ? [...allowedIds] : [];
            const CHUNK = 50;
            const chunks: string[][] = [];
            for (let i = 0; i < idList.length; i += CHUNK) chunks.push(idList.slice(i, i + CHUNK));

            // Build a closure that combines the direct filter with an id clause for a chunk.
            const buildChunkFilter = (idClause: string) => {
                let combined: string;
                if (filterLogic === 'AND') {
                    combined = [directFilterStr, idClause ? `(${idClause})` : ''].filter(Boolean).join(' && ');
                } else {
                    // OR: direct OR id
                    const parts = [directFilterStr, idClause].filter(Boolean);
                    combined = parts.length === 0 ? '' : parts.length === 1 ? parts[0] : `(${parts.join(') || (')})`;
                }
                return [combined, dncClause].filter(Boolean).join(' && ');
            };

            const queries: Promise<Company[]>[] = [];

            if (filterLogic === 'AND') {
                // We must restrict to the intersection of IDs.
                if (chunks.length === 0) {
                    setFilterMatchCount(0);
                    setFilterTotalPages(1);
                    setFilterResults([]);
                    return;
                }
                for (const chunk of chunks) {
                    const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
                    queries.push(pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
                        filter: buildChunkFilter(idClause),
                        sort: '-updated',
                    }));
                }
            } else {
                // OR mode: a company matches if it's in the rel-id union OR satisfies the direct filter.
                // Run direct filter as one query, plus chunked id queries; then union results.
                if (directFilterStr) {
                    queries.push(pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
                        filter: [directFilterStr, dncClause].filter(Boolean).join(' && '),
                        sort: '-updated',
                    }));
                }
                if (chunks.length === 0 && !directFilterStr) {
                    setFilterMatchCount(0);
                    setFilterTotalPages(1);
                    setFilterResults([]);
                    return;
                }
                for (const chunk of chunks) {
                    const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
                    queries.push(pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
                        filter: [`(${idClause})`, dncClause].filter(Boolean).join(' && '),
                        sort: '-updated',
                    }));
                }
            }

            const chunkResults = await Promise.all(queries);
            if (seq !== filterSeqRef.current) return;
            const seen = new Set<string>();
            const unique: Company[] = [];
            for (const list of chunkResults) {
                for (const c of list) {
                    if (seen.has(c.id)) continue;
                    seen.add(c.id);
                    unique.push(c);
                }
            }
            unique.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
            const total = unique.length;
            const pageItems = unique.slice((page - 1) * PER_PAGE, page * PER_PAGE);
            setFilterMatchCount(total);
            setFilterTotalPages(Math.max(1, Math.ceil(total / PER_PAGE)));
            const withPhones = await attachPhones(pageItems);
            if (seq !== filterSeqRef.current) return;
            setFilterResults(withPhones);
        } catch (err) {
            if (seq === filterSeqRef.current) {
                console.error('[CRM filter] search failed', err);
                setFilterResults([]);
                setFilterMatchCount(null);
            }
        } finally {
            if (seq === filterSeqRef.current) setFilterLoading(false);
        }
    }, [filters, filterLogic, attachPhones]);

    // A filter rule is "ready" if it has a value — or is a value-less boolean type
    const filterIsReady = (f: FilterRule) => {
        const t = getFieldType(f.field);
        if (t === 'boolean' || t === 'rel_boolean') return true;
        return f.value.trim() !== '';
    };
    const allFiltersReady = filters.length > 0 && filters.every(filterIsReady);

    // Auto-count when filters change — only when every rule has a value
    useEffect(() => {
        if (tab !== 'filters' || filters.length === 0 || !allFiltersReady) {
            setFilterMatchCount(null);
            return;
        }
        const timeout = setTimeout(() => doFilterSearch(1), 500);
        return () => clearTimeout(timeout);
    }, [filters, filterLogic, tab, doFilterSearch, allFiltersReady]);

    // ── Selection helpers ──

    const togglePhone = (phone: PhoneNumber, companyName: string) => {
        setSelected(prev => {
            const next = new Map(prev);
            if (next.has(phone.id)) {
                next.delete(phone.id);
            } else {
                next.set(phone.id, { number: phone.phone_number, company: companyName });
            }
            return next;
        });
    };

    const selectAllPhonesForCompany = (phones: PhoneNumber[], companyName: string) => {
        setSelected(prev => {
            const next = new Map(prev);
            const allSelected = phones.every(p => next.has(p.id));
            if (allSelected) {
                phones.forEach(p => next.delete(p.id));
            } else {
                phones.forEach(p => next.set(p.id, { number: p.phone_number, company: companyName }));
            }
            return next;
        });
    };

    const selectAllFromResults = (results: CompanyWithPhones[]) => {
        setSelected(prev => {
            const next = new Map(prev);
            const allPhones = results.flatMap(r => r.phones.map(p => ({ phone: p, companyName: r.company.company_name })));
            const allSelected = allPhones.length > 0 && allPhones.every(({ phone }) => next.has(phone.id));
            if (allSelected) {
                allPhones.forEach(({ phone }) => next.delete(phone.id));
            } else {
                allPhones.forEach(({ phone, companyName }) => next.set(phone.id, { number: phone.phone_number, company: companyName }));
            }
            return next;
        });
    };

    const toggleExpanded = (results: CompanyWithPhones[], setResults: (r: CompanyWithPhones[]) => void, index: number) => {
        setResults(results.map((r, i) => i === index ? { ...r, expanded: !r.expanded } : r));
    };

    // ── Import handler ──

    const handleImport = () => {
        const entries: CRMImportEntry[] = Array.from(selected.values()).map(v => ({
            number: v.number,
            company: v.company,
        }));
        if (entries.length > 0) {
            onImport(entries);
            onClose();
        }
    };

    // ── Filter UI helpers ──

    const addFilter = () => {
        setFilters([...filters, { field: 'company_name', operator: '~', value: '' }]);
    };

    const removeFilter = (index: number) => {
        setFilters(filters.filter((_, i) => i !== index));
    };

    const updateFilter = (index: number, updates: Partial<FilterRule>) => {
        setFilters(filters.map((f, i) => {
            if (i !== index) return f;
            const newFilter = { ...f, ...updates };
            if (updates.field && updates.field !== f.field) {
                const newType = getFieldType(updates.field);
                const ops = OPERATORS[newType];
                newFilter.operator = ops?.[0]?.key ?? '=';
                const def = getFieldDef(updates.field);
                if (newType === 'rel_id' && def?.relCollection === 'users') {
                    newFilter.value = users[0]?.id ?? '';
                } else if (newType === 'rel_id' && def?.relCollection === 'lead_categories') {
                    newFilter.value = leadCategories[0]?.id ?? '';
                } else {
                    newFilter.value = '';
                }
            }
            return newFilter;
        }));
    };

    if (!open) return null;
    if (typeof document === 'undefined') return null;

    const currentResults = tab === 'search' ? searchResults : filterResults;
    const totalPhones = currentResults.reduce((sum, r) => sum + r.phones.length, 0);
    const allResultPhonesSelected = totalPhones > 0 && currentResults.every(r => r.phones.every(p => selected.has(p.id)));

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
                    <div>
                        <h2 className="text-base font-semibold">Import from CRM</h2>
                        <p className="text-xs text-[var(--muted)] mt-0.5">Select companies and phone numbers to load into the dialer</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[var(--card-border)]">
                    <button
                        onClick={() => setTab('search')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                            tab === 'search'
                                ? 'text-[var(--foreground)] border-b-2 border-[var(--foreground)]'
                                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                        }`}
                    >
                        <Search size={14} /> Search
                    </button>
                    <button
                        onClick={() => setTab('filters')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                            tab === 'filters'
                                ? 'text-[var(--foreground)] border-b-2 border-[var(--foreground)]'
                                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                        }`}
                    >
                        <Filter size={14} /> Filters
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">

                    {/* ── Search Tab ── */}
                    {tab === 'search' && (
                        <>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Search by company name or owner..."
                                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder:text-[var(--muted)]/50"
                                />
                            </div>
                            {searchLoading && (
                                <div className="flex items-center justify-center py-8 text-[var(--muted)]">
                                    <Loader2 size={18} className="animate-spin mr-2" /> Searching...
                                </div>
                            )}
                            {!searchLoading && searchQuery && searchResults.length === 0 && (
                                <p className="text-sm text-[var(--muted)] text-center py-8">No companies found matching &quot;{searchQuery}&quot;</p>
                            )}
                            {!searchLoading && !searchQuery && (
                                <p className="text-sm text-[var(--muted)] text-center py-8">Type to search for companies in your CRM</p>
                            )}
                        </>
                    )}

                    {/* ── Filters Tab ── */}
                    {tab === 'filters' && (
                        <>
                            {/* AND / OR mode toggle */}
                            <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                                <div className="text-xs text-[var(--muted)]">
                                    Match {filterLogic === 'AND' ? (
                                        <span className="font-semibold text-[var(--foreground)]">all conditions</span>
                                    ) : (
                                        <span className="font-semibold text-[var(--foreground)]">any condition</span>
                                    )}
                                </div>
                                <div className="inline-flex rounded-lg border border-[var(--card-border)] overflow-hidden text-xs">
                                    <button
                                        onClick={() => setFilterLogic('AND')}
                                        className={`px-3 py-1 font-semibold transition-colors ${filterLogic === 'AND' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}
                                    >
                                        AND
                                    </button>
                                    <button
                                        onClick={() => setFilterLogic('OR')}
                                        className={`px-3 py-1 font-semibold transition-colors border-l border-[var(--card-border)] ${filterLogic === 'OR' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}
                                    >
                                        OR
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {filters.length === 0 && (
                                    <p className="text-sm text-[var(--muted)] py-3 text-center border border-dashed border-[var(--card-border)] rounded-lg">
                                        No filters added. Click &quot;Add Filter&quot; to start.
                                    </p>
                                )}
                                {filters.map((filter, index) => {
                                    const fieldType = getFieldType(filter.field);
                                    const operators = OPERATORS[fieldType] ?? OPERATORS.text;
                                    const options = getFieldOptions(filter.field);
                                    const def = getFieldDef(filter.field);
                                    const isRelId = fieldType === 'rel_id';
                                    const isDateLike = fieldType === 'date' || fieldType === 'rel_date';
                                    const isNumberLike = fieldType === 'number' || fieldType === 'rel_number';
                                    const valuelessTypes = fieldType === 'boolean' || fieldType === 'rel_boolean';
                                    const relOptions: { value: string; label: string }[] = isRelId
                                        ? def?.relCollection === 'users'
                                            ? users.map(u => ({ value: u.id, label: u.name || u.email || u.id }))
                                            : def?.relCollection === 'lead_categories'
                                                ? leadCategories.map(c => ({ value: c.id, label: c.name }))
                                                : []
                                        : [];
                                    return (
                                        <div key={index} className="flex items-center gap-2 flex-wrap">
                                            {index > 0 && (
                                                <span className="text-[10px] font-semibold text-[var(--muted)] uppercase w-8">{filterLogic}</span>
                                            )}
                                            <select
                                                value={filter.field}
                                                onChange={e => updateFilter(index, { field: e.target.value })}
                                                className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] max-w-[180px]"
                                            >
                                                {['Company', 'Assignment', 'Calls', 'Notes'].map(group => {
                                                    const items = FILTER_FIELDS.filter(f => (f.group ?? 'Other') === group);
                                                    if (items.length === 0) return null;
                                                    return (
                                                        <optgroup key={group} label={group}>
                                                            {items.map(f => (
                                                                <option key={f.key} value={f.key}>{f.label}</option>
                                                            ))}
                                                        </optgroup>
                                                    );
                                                })}
                                            </select>
                                            <select
                                                value={filter.operator}
                                                onChange={e => updateFilter(index, { operator: e.target.value })}
                                                className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                                            >
                                                {operators.map(op => (
                                                    <option key={op.key} value={op.key}>{op.label}</option>
                                                ))}
                                            </select>
                                            {!valuelessTypes && (
                                                <>
                                                    {isRelId ? (
                                                        <select
                                                            value={filter.value}
                                                            onChange={e => updateFilter(index, { value: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-[140px]"
                                                        >
                                                            <option value="">Select...</option>
                                                            {relOptions.map(opt => (
                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                            ))}
                                                        </select>
                                                    ) : options ? (
                                                        <select
                                                            value={filter.value}
                                                            onChange={e => updateFilter(index, { value: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-[120px]"
                                                        >
                                                            <option value="">Select...</option>
                                                            {options.map(opt => (
                                                                <option key={opt} value={opt}>{opt}</option>
                                                            ))}
                                                        </select>
                                                    ) : isDateLike ? (
                                                        <input
                                                            type="date"
                                                            value={filter.value}
                                                            onChange={e => updateFilter(index, { value: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                                                        />
                                                    ) : isNumberLike ? (
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={filter.value}
                                                            onChange={e => updateFilter(index, { value: e.target.value })}
                                                            placeholder="0"
                                                            className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-24"
                                                        />
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={filter.value}
                                                            onChange={e => updateFilter(index, { value: e.target.value })}
                                                            placeholder="Enter value..."
                                                            className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] min-w-[120px]"
                                                        />
                                                    )}
                                                </>
                                            )}
                                            <button
                                                onClick={() => removeFilter(index)}
                                                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    );
                                })}
                                <button
                                    onClick={addFilter}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors text-[var(--muted)] hover:text-[var(--foreground)]"
                                >
                                    <Plus size={12} /> Add Filter
                                </button>
                            </div>

                            {/* Filter match count & apply */}
                            {filters.length > 0 && (
                                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                                    <span className="text-xs text-[var(--muted)]">
                                        {filterLoading ? (
                                            <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Counting...</span>
                                        ) : filterMatchCount !== null ? (
                                            <><span className="font-semibold text-[var(--foreground)]">{filterMatchCount}</span> companies match</>
                                        ) : !allFiltersReady ? (
                                            'Fill in all filter values to search'
                                        ) : (
                                            'Add filters to find companies'
                                        )}
                                    </span>
                                    {!filterLoading && filterMatchCount !== null && filterMatchCount > 0 && (
                                        <button
                                            onClick={() => { setFilterPage(1); doFilterSearch(1); }}
                                            className="px-3 py-1 text-xs font-medium rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-all"
                                        >
                                            Show Results
                                        </button>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* ── Results List (shared for both tabs) ── */}
                    {currentResults.length > 0 && (
                        <div className="space-y-1">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                    {tab === 'search' ? 'Search Results' : `Results (Page ${filterPage} of ${filterTotalPages})`}
                                </span>
                                {totalPhones > 0 && (
                                    <button
                                        onClick={() => selectAllFromResults(currentResults)}
                                        className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                        {allResultPhonesSelected ? 'Deselect all' : 'Select all'}
                                    </button>
                                )}
                            </div>
                            <div className="rounded-xl border border-[var(--card-border)] divide-y divide-[var(--card-border)] overflow-hidden">
                                {currentResults.map((item, idx) => {
                                    const hasPhones = item.phones.length > 0;
                                    const allCompanyPhonesSelected = hasPhones && item.phones.every(p => selected.has(p.id));
                                    const someCompanyPhonesSelected = hasPhones && item.phones.some(p => selected.has(p.id));
                                    return (
                                        <div key={item.company.id}>
                                            {/* Company row */}
                                            <div
                                                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors ${
                                                    someCompanyPhonesSelected ? 'bg-[var(--success-subtle)]/10' : ''
                                                }`}
                                                onClick={() => {
                                                    if (hasPhones) {
                                                        if (item.phones.length === 1) {
                                                            togglePhone(item.phones[0], item.company.company_name);
                                                        } else {
                                                            toggleExpanded(
                                                                tab === 'search' ? searchResults : filterResults,
                                                                tab === 'search' ? setSearchResults : setFilterResults,
                                                                idx
                                                            );
                                                        }
                                                    }
                                                }}
                                            >
                                                {/* Checkbox */}
                                                <button
                                                    onClick={e => { e.stopPropagation(); if (hasPhones) selectAllPhonesForCompany(item.phones, item.company.company_name); }}
                                                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                                                        allCompanyPhonesSelected
                                                            ? 'bg-[var(--success)] border-[var(--success)] text-white'
                                                            : someCompanyPhonesSelected
                                                            ? 'bg-[var(--success)]/30 border-[var(--success)]'
                                                            : 'border-[var(--card-border)] hover:border-[var(--muted)]'
                                                    } ${!hasPhones ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                    disabled={!hasPhones}
                                                >
                                                    {allCompanyPhonesSelected && <Check size={12} />}
                                                </button>

                                                {/* Company info */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <Building2 size={13} className="text-[var(--muted)] shrink-0" />
                                                        <span className="text-sm font-medium truncate">{item.company.company_name}</span>
                                                        {Array.isArray(item.company.status) && item.company.status.length > 0 && (
                                                            <span className="flex gap-0.5 flex-wrap">
                                                                {item.company.status.map(s => {
                                                                    const colors = getOutcomeColors(s);
                                                                    return (
                                                                        <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors.bg} ${colors.text}`}>
                                                                            {s}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-0.5">
                                                        {item.company.owner_name && (
                                                            <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                                                                <User size={10} /> {item.company.owner_name}
                                                            </span>
                                                        )}
                                                        {item.company.company_location && (
                                                            <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                                                                <MapPin size={10} /> {item.company.company_location}
                                                            </span>
                                                        )}
                                                        <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                                                            <Phone size={10} /> {item.phones.length} number{item.phones.length !== 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Expand toggle (multi-phone) */}
                                                {item.phones.length > 1 && (
                                                    <div className="shrink-0 text-[var(--muted)]">
                                                        {item.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Expanded phone list */}
                                            {item.expanded && item.phones.length > 1 && (
                                                <div className="bg-[var(--sidebar-bg)] border-t border-[var(--card-border)]">
                                                    {item.phones.map(phone => {
                                                        const isPhoneSelected = selected.has(phone.id);
                                                        return (
                                                            <div
                                                                key={phone.id}
                                                                className={`flex items-center gap-3 px-3 py-2 pl-11 cursor-pointer hover:bg-[var(--card-hover)] transition-colors ${
                                                                    isPhoneSelected ? 'bg-[var(--success-subtle)]/20' : ''
                                                                }`}
                                                                onClick={() => togglePhone(phone, item.company.company_name)}
                                                            >
                                                                <button
                                                                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                                                        isPhoneSelected
                                                                            ? 'bg-[var(--success)] border-[var(--success)] text-white'
                                                                            : 'border-[var(--card-border)] hover:border-[var(--muted)]'
                                                                    }`}
                                                                >
                                                                    {isPhoneSelected && <Check size={10} />}
                                                                </button>
                                                                <Phone size={11} className="text-[var(--muted)] shrink-0" />
                                                                <span className="text-xs font-mono">{phone.phone_number}</span>
                                                                {phone.label && (
                                                                    <span className="text-[10px] text-[var(--muted)] bg-[var(--card-bg)] px-1.5 py-0.5 rounded">
                                                                        {phone.label}
                                                                    </span>
                                                                )}
                                                                {phone.location_name && (
                                                                    <span className="text-[10px] text-[var(--muted)]">{phone.location_name}</span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Filter pagination */}
                            {tab === 'filters' && filterTotalPages > 1 && (
                                <div className="flex items-center justify-center gap-2 pt-2">
                                    <button
                                        onClick={() => { const p = filterPage - 1; setFilterPage(p); doFilterSearch(p); }}
                                        disabled={filterPage <= 1 || filterLoading}
                                        className="px-3 py-1 text-xs rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-40 transition-all"
                                    >
                                        Previous
                                    </button>
                                    <span className="text-xs text-[var(--muted)]">Page {filterPage} of {filterTotalPages}</span>
                                    <button
                                        onClick={() => { const p = filterPage + 1; setFilterPage(p); doFilterSearch(p); }}
                                        disabled={filterPage >= filterTotalPages || filterLoading}
                                        className="px-3 py-1 text-xs rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-40 transition-all"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer — selection summary + import button */}
                <div className="border-t border-[var(--card-border)] px-5 py-3 flex items-center justify-between bg-[var(--card-bg)]">
                    <div className="text-xs text-[var(--muted)]">
                        {selected.size > 0 ? (
                            <span>
                                <span className="font-semibold text-[var(--foreground)]">{selected.size}</span> phone number{selected.size !== 1 ? 's' : ''} selected
                            </span>
                        ) : (
                            'Select phone numbers to import'
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-xl text-sm font-medium border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={selected.size === 0}
                            className="px-4 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Import {selected.size > 0 ? `${selected.size} Number${selected.size !== 1 ? 's' : ''}` : ''} →
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
