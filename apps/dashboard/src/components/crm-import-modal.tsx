'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Filter, Building2, Phone, Check, ChevronDown, ChevronUp, Plus, Trash2, MapPin, User, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { Company, PhoneNumber } from '@/lib/types';
import { sanitizeFilterValue } from '@/lib/utils';
import { getOutcomeColors, DEFAULT_OUTCOMES } from '@/lib/call-outcomes';

const COMPANY_STATUSES = ['Cold No Reply', 'Replied', 'Warm', 'Booked', 'Paid', 'Client', 'Excluded'] as const;

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
    type: 'text' | 'boolean' | 'date' | 'select' | 'json_array' | 'rel_select' | 'rel_text' | 'rel_boolean';
    options?: readonly string[];
    group?: string;
};

const FILTER_FIELDS: readonly FilterField[] = [
    // ── Company info ──
    { key: 'company_name', label: 'Company Name', type: 'text', group: 'Company' },
    { key: 'owner_name', label: 'Owner Name', type: 'text', group: 'Company' },
    { key: 'status', label: 'Status', type: 'json_array', options: COMPANY_STATUSES, group: 'Company' },
    { key: 'source', label: 'Source', type: 'text', group: 'Company' },
    { key: 'company_location', label: 'Location', type: 'text', group: 'Company' },
    { key: 'industry', label: 'Industry', type: 'text', group: 'Company' },
    { key: 'price_range', label: 'Price Range', type: 'text', group: 'Company' },
    { key: 'google_rating', label: 'Google Rating', type: 'text', group: 'Company' },
    { key: 'notes', label: 'Notes Include', type: 'text', group: 'Company' },
    { key: 'first_contacted', label: 'First Contacted', type: 'date', group: 'Company' },
    { key: 'last_contacted', label: 'Last Contacted', type: 'date', group: 'Company' },
    { key: 'email', label: 'Has Email', type: 'boolean', group: 'Company' },
    { key: 'website', label: 'Has Website', type: 'boolean', group: 'Company' },
    { key: 'do_not_contact', label: 'Do Not Contact', type: 'boolean', group: 'Company' },

    // ── Call history (any call) ──
    { key: 'call_logs_via_company.call_outcome', label: 'Call Outcome Includes', type: 'rel_select', options: [...DEFAULT_OUTCOMES, 'Other'], group: 'Calls' },
    { key: 'call_logs_via_company.post_call_notes', label: 'Post-Call Notes Include', type: 'rel_text', group: 'Calls' },
    { key: 'call_logs_via_company.status_changed_to', label: 'Call Status Changed To', type: 'rel_select', options: COMPANY_STATUSES, group: 'Calls' },
    { key: 'call_logs_via_company.owner_reached', label: 'Owner Reached On Call', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.appointment_set', label: 'Appointment Set', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.call_time', label: 'Last Call Date', type: 'date', group: 'Calls' },

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
    json_array: [
        { key: '?=', label: 'includes' },
        { key: '?!=', label: 'excludes' },
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
};

function getFieldType(fieldKey: string): FilterField['type'] {
    const field = FILTER_FIELDS.find(f => f.key === fieldKey);
    return field?.type ?? 'text';
}

function getFieldOptions(fieldKey: string): string[] | undefined {
    const field = FILTER_FIELDS.find(f => f.key === fieldKey);
    return field?.options ? [...field.options] : undefined;
}

function isRelFilter(f: FilterRule): boolean {
    return f.field.includes('_via_');
}

// Build a "quoted JSON token" filter clause for a field stored as a JSON array.
// PB's `?=` isn't supported on this server, so we fall back to substring-matching
// the JSON-encoded value (with surrounding quotes) to get exact-token semantics.
function buildJsonArrayClause(field: string, op: string, value: string): string {
    const wrapped = `"${value}"`;
    const safeValue = sanitizeFilterValue(wrapped);
    const likeOp = op === '?=' || op === '=' ? '~' : op === '?!=' || op === '!=' ? '!~' : op;
    return `${field} ${likeOp} "${safeValue}"`;
}

function buildDirectFilter(filters: FilterRule[]): string {
    return filters
        .filter(f => f.field && f.operator && !isRelFilter(f))
        .map(f => {
            const type = getFieldType(f.field);
            if (type === 'boolean') {
                return f.operator === '!=' ? `${f.field} != ""` : `${f.field} = ""`;
            }
            if (type === 'json_array') {
                if (!f.value) return '';
                return buildJsonArrayClause(f.field, f.operator, f.value);
            }
            const safeValue = sanitizeFilterValue(f.value);
            return `${f.field} ${f.operator} "${safeValue}"`;
        })
        .filter(Boolean)
        .join(' && ');
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
    const [filterResults, setFilterResults] = useState<CompanyWithPhones[]>([]);
    const [filterLoading, setFilterLoading] = useState(false);
    const [filterMatchCount, setFilterMatchCount] = useState<number | null>(null);
    const [filterPage, setFilterPage] = useState(1);
    const [filterTotalPages, setFilterTotalPages] = useState(1);

    // Selection state — map of phoneNumber.id → { number, companyName }
    const [selected, setSelected] = useState<Map<string, { number: string; company: string }>>(new Map());

    const searchInputRef = useRef<HTMLInputElement>(null);
    const PER_PAGE = 25;

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
            setSelected(new Map());
            setFilterMatchCount(null);
            setFilterPage(1);
        }
    }, [open]);

    // ── Search logic ──

    const doSearch = useCallback(async (query: string) => {
        if (!query.trim()) {
            setSearchResults([]);
            return;
        }
        setSearchLoading(true);
        try {
            const safeQ = sanitizeFilterValue(query.trim());
            const filter = `(company_name ~ "${safeQ}" || owner_name ~ "${safeQ}") && do_not_contact != true`;
            const companies = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(1, 30, {
                filter,
                sort: '-updated',
            });
            // Fetch phone numbers for matching companies
            if (companies.items.length > 0) {
                const companyIds = companies.items.map(c => c.id);
                const phoneFilter = companyIds.map(id => `company = "${id}"`).join(' || ');
                const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
                    filter: phoneFilter,
                });
                const phoneMap = new Map<string, PhoneNumber[]>();
                for (const p of phones) {
                    if (p.disassociated) continue;
                    const arr = phoneMap.get(p.company) ?? [];
                    arr.push(p);
                    phoneMap.set(p.company, arr);
                }
                setSearchResults(companies.items.map(c => ({
                    company: c,
                    phones: phoneMap.get(c.id) ?? [],
                    expanded: false,
                })));
            } else {
                setSearchResults([]);
            }
        } catch {
            setSearchResults([]);
        } finally {
            setSearchLoading(false);
        }
    }, []);

    // Debounced search
    useEffect(() => {
        if (tab !== 'search') return;
        const timeout = setTimeout(() => doSearch(searchQuery), 350);
        return () => clearTimeout(timeout);
    }, [searchQuery, tab, doSearch]);

    // ── Filter logic ──

    const doFilterSearch = useCallback(async (page: number) => {
        setFilterLoading(true);
        try {
            // 1. Resolve any cross-table filters to company IDs
            const relFilters = filters.filter(isRelFilter);
            let allowedIds: Set<string> | null = null;
            for (const rf of relFilters) {
                const type = getFieldType(rf.field);
                if (type !== 'rel_boolean' && !rf.value) continue; // skip empty rules
                const ids = await fetchCompanyIdsForRelFilter(rf);
                if (allowedIds === null) {
                    allowedIds = ids;
                } else {
                    const prev: Set<string> = allowedIds;
                    allowedIds = new Set(Array.from(prev).filter(id => ids.has(id)));
                }
                if (allowedIds.size === 0) break; // short-circuit
            }

            // 2. Build direct filter
            const filterStr = buildDirectFilter(filters);
            const hasDoNotContactFilter = filters.some(f => f.field === 'do_not_contact');
            const baseParts = [filterStr];
            if (!hasDoNotContactFilter) baseParts.push('do_not_contact != true');
            const baseFilter = baseParts.filter(Boolean).join(' && ');

            // 3. When cross-table filters resolved to a finite set of IDs, fetch
            //    companies in chunks to avoid URL-length limits with large id lists.
            if (allowedIds !== null) {
                if (allowedIds.size === 0) {
                    setFilterMatchCount(0);
                    setFilterTotalPages(1);
                    setFilterResults([]);
                    return;
                }
                const idList = [...allowedIds];
                const CHUNK = 50;
                const chunks: string[][] = [];
                for (let i = 0; i < idList.length; i += CHUNK) chunks.push(idList.slice(i, i + CHUNK));

                const chunkResults = await Promise.all(chunks.map(chunk => {
                    const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
                    const chunkFilter = [baseFilter, `(${idClause})`].filter(Boolean).join(' && ');
                    return pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
                        filter: chunkFilter,
                        sort: '-updated',
                    });
                }));
                const allCompanies = chunkResults.flat();
                // De-dupe + sort (already sorted within chunks, merge-sort by updated desc)
                const seen = new Set<string>();
                const unique = allCompanies.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
                unique.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
                const total = unique.length;
                const pageItems = unique.slice((page - 1) * PER_PAGE, page * PER_PAGE);
                setFilterMatchCount(total);
                setFilterTotalPages(Math.max(1, Math.ceil(total / PER_PAGE)));

                if (pageItems.length === 0) {
                    setFilterResults([]);
                    return;
                }
                const companyIds = pageItems.map(c => c.id);
                const phoneFilter = companyIds.map(id => `company = "${id}"`).join(' || ');
                const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({ filter: phoneFilter });
                const phoneMap = new Map<string, PhoneNumber[]>();
                for (const p of phones) {
                    if (p.disassociated) continue;
                    const arr = phoneMap.get(p.company) ?? [];
                    arr.push(p);
                    phoneMap.set(p.company, arr);
                }
                setFilterResults(pageItems.map(c => ({ company: c, phones: phoneMap.get(c.id) ?? [], expanded: false })));
                return;
            }

            // 4. No cross-table filters — standard paginated query
            const companies = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(page, PER_PAGE, {
                filter: baseFilter || undefined,
                sort: '-updated',
            });
            setFilterMatchCount(companies.totalItems);
            setFilterTotalPages(companies.totalPages);

            if (companies.items.length > 0) {
                const companyIds = companies.items.map(c => c.id);
                const phoneFilter = companyIds.map(id => `company = "${id}"`).join(' || ');
                const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
                    filter: phoneFilter,
                });
                const phoneMap = new Map<string, PhoneNumber[]>();
                for (const p of phones) {
                    if (p.disassociated) continue;
                    const arr = phoneMap.get(p.company) ?? [];
                    arr.push(p);
                    phoneMap.set(p.company, arr);
                }
                setFilterResults(companies.items.map(c => ({
                    company: c,
                    phones: phoneMap.get(c.id) ?? [],
                    expanded: false,
                })));
            } else {
                setFilterResults([]);
            }
        } catch {
            setFilterResults([]);
            setFilterMatchCount(null);
        } finally {
            setFilterLoading(false);
        }
    }, [filters]);

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
    }, [filters, tab, doFilterSearch, allFiltersReady]);

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
                newFilter.value = '';
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
                                    return (
                                        <div key={index} className="flex items-center gap-2 flex-wrap">
                                            {index > 0 && (
                                                <span className="text-[10px] font-medium text-[var(--muted)] uppercase w-8">AND</span>
                                            )}
                                            <select
                                                value={filter.field}
                                                onChange={e => updateFilter(index, { field: e.target.value })}
                                                className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] max-w-[180px]"
                                            >
                                                {['Company', 'Calls', 'Notes'].map(group => {
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
                                            {fieldType !== 'boolean' && fieldType !== 'rel_boolean' && (
                                                <>
                                                    {options ? (
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
                                                    ) : fieldType === 'date' ? (
                                                        <input
                                                            type="date"
                                                            value={filter.value}
                                                            onChange={e => updateFilter(index, { value: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
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
