'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Search,
  Building2,
  Phone,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  User,
  Loader2,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { Company, PhoneNumber, User as UserType, LeadCategory } from '@/lib/types';
import { sanitizeFilterValue } from '@/lib/utils';
import { getOutcomeColors, DEFAULT_OUTCOMES } from '@/lib/call-outcomes';
import { useCustomCallOutcomes } from '@/hooks/use-custom-call-outcomes';
import {
  FilterBuilder,
  FilterChips,
  runFilterSearch,
  fetchAllMatchingIds,
  shouldConfirmSelectAll,
  useFilterSelection,
  type FilterCondition,
  type FilterFieldDef,
  type FilterLogic,
} from './filter-builder';

const COMPANY_STATUSES = ['Cold No Reply', 'Replied', 'Warm', 'Booked', 'Paid', 'Client', 'Excluded'] as const;
const CALL_DIRECTIONS = ['outbound', 'inbound'] as const;
const SOURCES = ['Cold Call', 'Google Maps', 'Manual', 'Instagram'] as const;

export interface CRMImportEntry {
    number: string;
    company?: string;
}

interface CRMImportModalProps {
    open: boolean;
    onClose: () => void;
    onImport: (entries: CRMImportEntry[]) => void;
}

function buildFilterFields(customOutcomes: readonly string[]): readonly FilterFieldDef[] {
  const statusOptions = [...DEFAULT_OUTCOMES, ...customOutcomes, ...COMPANY_STATUSES];
  const anyOutcomeOptions = [...DEFAULT_OUTCOMES, ...customOutcomes];
  return [
    // Company
    { key: 'company_name', label: 'Company Name', type: 'text', group: 'Company' },
    { key: 'owner_name', label: 'Owner Name', type: 'text', group: 'Company' },
    {
      key: 'call_outcome',
      label: 'Call Outcome',
      type: 'multi_enum',
      group: 'Calls',
      scopes: {
        last: { key: 'status', type: 'multi_enum', options: statusOptions },
        any: { key: 'call_logs_via_company.call_outcome', type: 'rel_select', options: anyOutcomeOptions },
      },
    },
    { key: 'source', label: 'Source', type: 'enum', options: SOURCES, group: 'Company' },
    { key: 'company_location', label: 'Location', type: 'text', group: 'Company' },
    { key: 'industry', label: 'Industry', type: 'text', group: 'Company' },
    { key: 'price_range', label: 'Price Range', type: 'text', group: 'Company' },
    { key: 'google_rating', label: 'Google Rating', type: 'text', group: 'Company' },
    { key: 'google_reviews_count', label: 'Google Reviews Count', type: 'text', group: 'Company' },
    { key: 'notes', label: 'Notes', type: 'text', group: 'Company' },
    { key: 'instagram_handle', label: 'Instagram Handle', type: 'text', group: 'Company' },
    { key: 'contact_source', label: 'Contact Source', type: 'text', group: 'Company' },
    { key: 'first_contacted', label: 'First Contacted', type: 'date', group: 'Company' },
    { key: 'last_contacted', label: 'Last Contacted', type: 'date', group: 'Company' },
    { key: 'email', label: 'Has Email', type: 'boolean', group: 'Company' },
    { key: 'website', label: 'Has Website', type: 'boolean', group: 'Company' },
    { key: 'instagram_handle_present', label: 'Has Instagram', type: 'boolean', realField: 'instagram_handle', group: 'Company' },
    { key: 'do_not_contact', label: 'Do Not Contact', type: 'boolean', group: 'Company' },

    // Assignment
    { key: 'assigned_to', label: 'Assignee', type: 'rel_id', relCollection: 'users', group: 'Assignment' },
    { key: 'assigned_to_present', label: 'Has Assignee', type: 'boolean', realField: 'assigned_to', group: 'Assignment' },
    { key: 'lead_category', label: 'Lead Category', type: 'rel_id', relCollection: 'lead_categories', group: 'Assignment' },
    { key: 'lead_category_present', label: 'Has Lead Category', type: 'boolean', realField: 'lead_category', group: 'Assignment' },

    // Call attributes (only "any call" scope makes sense — no last-call denorm on the company).
    { key: 'call_logs_via_company.direction', label: 'Call Direction', type: 'rel_select', options: CALL_DIRECTIONS, group: 'Calls' },
    { key: 'call_logs_via_company.status_changed_to', label: 'Call Status Changed To', type: 'rel_select', options: COMPANY_STATUSES, group: 'Calls' },
    { key: 'call_logs_via_company.caller', label: 'Called By', type: 'rel_id', relCollection: 'users', group: 'Calls' },
    { key: 'call_logs_via_company.post_call_notes', label: 'Call Notes Contain', type: 'rel_text', group: 'Calls' },
    { key: 'call_logs_via_company.owner_reached', label: 'Owner Reached', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.appointment_set', label: 'Warm Lead', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.pitch_completed', label: 'Pitch Completed', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.has_recording', label: 'Has Recording', type: 'rel_boolean', group: 'Calls' },
    { key: 'call_logs_via_company.duration', label: 'Total Duration (s)', type: 'rel_number', group: 'Calls' },
    { key: 'call_logs_via_company.call_duration', label: 'Talk Duration (s)', type: 'rel_number', group: 'Calls' },
    { key: 'call_logs_via_company.call_time', label: 'Call Date', type: 'rel_date', group: 'Calls' },

    // Notes
    { key: 'company_notes_via_company.content', label: 'Pre-Call Note Contains', type: 'rel_text', group: 'Notes' },
  ];
}

const PER_PAGE = 25;

interface CompanyWithPhones {
    company: Company;
    phones: PhoneNumber[];
    expanded: boolean;
}

async function attachPhonesToCompanies(companies: Company[]): Promise<CompanyWithPhones[]> {
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
}

async function fetchPhonesForCompanyIds(ids: string[]): Promise<{ companyId: string; companyName: string; phones: PhoneNumber[] }[]> {
    if (ids.length === 0) return [];
    const CHUNK = 50;
    const groups: { id: string; company_name: string; phones: PhoneNumber[] }[] = [];
    const companyMap = new Map<string, string>(); // id → name
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const idClause = chunk.map(id => `id = "${id}"`).join(' || ');
        const companies = await pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
            filter: `(${idClause})`,
            fields: 'id,company_name',
        });
        for (const c of companies) companyMap.set(c.id, c.company_name);
        const phoneClause = chunk.map(id => `company = "${id}"`).join(' || ');
        const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
            filter: phoneClause,
        });
        const phoneMap = new Map<string, PhoneNumber[]>();
        for (const p of phones) {
            if (p.disassociated) continue;
            const arr = phoneMap.get(p.company) ?? [];
            arr.push(p);
            phoneMap.set(p.company, arr);
        }
        for (const id of chunk) {
            groups.push({ id, company_name: companyMap.get(id) ?? '', phones: phoneMap.get(id) ?? [] });
        }
    }
    return groups.map(g => ({ companyId: g.id, companyName: g.company_name, phones: g.phones }));
}

function buildSearchClause(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) return '';
    const safe = sanitizeFilterValue(trimmed);
    if (!safe) return '';
    return `(company_name ~ "${safe}" || owner_name ~ "${safe}" || email ~ "${safe}" || instagram_handle ~ "${safe}" || website ~ "${safe}")`;
}

export function CRMImportModal({ open, onClose, onImport }: CRMImportModalProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [conditions, setConditions] = useState<FilterCondition[]>([]);
    const [logic, setLogic] = useState<FilterLogic>('AND');

    const [results, setResults] = useState<CompanyWithPhones[]>([]);
    const [matchCount, setMatchCount] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);

    const [users, setUsers] = useState<UserType[]>([]);
    const [leadCategories, setLeadCategories] = useState<LeadCategory[]>([]);
    const { customOutcomes } = useCustomCallOutcomes();
    const filterFields = useMemo(() => buildFilterFields(customOutcomes), [customOutcomes]);

    const selection = useFilterSelection();
    const [selectedDetails, setSelectedDetails] = useState<Map<string, { number: string; company: string }>>(new Map());

    const searchInputRef = useRef<HTMLInputElement>(null);
    const seqRef = useRef(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const relData = useMemo(() => ({
        users: users.map(u => ({ id: u.id, label: u.name || u.email || u.id })),
        lead_categories: leadCategories.map(c => ({ id: c.id, label: c.name })),
    }), [users, leadCategories]);

    // Load lookup data
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
        if (open) setTimeout(() => searchInputRef.current?.focus(), 100);
    }, [open]);

    // Reset on close
    useEffect(() => {
        if (open) return;
        setSearchQuery('');
        setConditions([]);
        setLogic('AND');
        setResults([]);
        setMatchCount(null);
        setPage(1);
        setTotalPages(1);
        setSelectedDetails(new Map());
        selection.clear();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const runSearch = useCallback(async (targetPage: number) => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const dncOmitted = !conditions.some(c => c.field === 'do_not_contact');
            const searchClause = buildSearchClause(searchQuery);
            const extras = [searchClause, dncOmitted ? 'do_not_contact != true' : ''].filter(Boolean).join(' && ');

            const result = await runFilterSearch<Company>({
                collection: COLLECTIONS.COMPANIES,
                fields: filterFields,
                conditions,
                logic,
                page: targetPage,
                perPage: PER_PAGE,
                sort: '-updated',
                extraFilter: extras || undefined,
            });
            if (seq !== seqRef.current) return;

            setMatchCount(result.totalItems);
            setTotalPages(result.totalPages);
            setPage(targetPage);
            const withPhones = await attachPhonesToCompanies(result.items);
            if (seq !== seqRef.current) return;
            setResults(withPhones);
        } catch (err) {
            if (seq === seqRef.current) {
                console.error('[CRM import] search failed', err);
                setResults([]);
                setMatchCount(null);
            }
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [conditions, logic, searchQuery, filterFields]);

    // Debounced search trigger — only when the user has typed a query or applied filters.
    useEffect(() => {
        if (!open) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const hasQuery = searchQuery.trim().length > 0;
        const hasFilters = conditions.length > 0;
        if (!hasQuery && !hasFilters) {
            setResults([]);
            setMatchCount(null);
            setPage(1);
            setTotalPages(1);
            return;
        }
        debounceRef.current = setTimeout(() => {
            runSearch(1);
            selection.exitAllFiltered();
        }, 350);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    // We intentionally don't depend on `selection` to avoid loops; the hook's identity is stable per-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, searchQuery, conditions, logic]);

    // Selection helpers
    const togglePhone = (phone: PhoneNumber, companyName: string) => {
        if (selection.mode === 'all_filtered') {
            selection.toggle(phone.id);
        } else {
            selection.toggle(phone.id);
            setSelectedDetails(prev => {
                const next = new Map(prev);
                if (next.has(phone.id)) next.delete(phone.id);
                else next.set(phone.id, { number: phone.phone_number, company: companyName });
                return next;
            });
        }
    };

    const selectAllPhonesForCompany = (phones: PhoneNumber[], companyName: string) => {
        const ids = phones.map(p => p.id);
        const allSelected = ids.every(id => selection.isSelected(id));
        ids.forEach(id => {
            if (allSelected ? selection.isSelected(id) : !selection.isSelected(id)) selection.toggle(id);
        });
        if (selection.mode !== 'all_filtered') {
            setSelectedDetails(prev => {
                const next = new Map(prev);
                if (allSelected) {
                    phones.forEach(p => next.delete(p.id));
                } else {
                    phones.forEach(p => next.set(p.id, { number: p.phone_number, company: companyName }));
                }
                return next;
            });
        }
    };

    const visiblePhones = useMemo(() => {
        return results.flatMap(r => r.phones.map(p => ({ phone: p, companyName: r.company.company_name })));
    }, [results]);

    const visiblePhoneIds = useMemo(() => visiblePhones.map(p => p.phone.id), [visiblePhones]);
    const allVisibleSelected = visiblePhones.length > 0 && visiblePhones.every(p => selection.isSelected(p.phone.id));

    const togglePageAll = () => {
        const ids = visiblePhones.map(p => p.phone.id);
        const allOn = visiblePhones.length > 0 && visiblePhones.every(p => selection.isSelected(p.phone.id));
        ids.forEach(id => {
            if (allOn ? selection.isSelected(id) : !selection.isSelected(id)) selection.toggle(id);
        });
        if (selection.mode !== 'all_filtered') {
            setSelectedDetails(prev => {
                const next = new Map(prev);
                if (allOn) {
                    for (const p of visiblePhones) next.delete(p.phone.id);
                } else {
                    for (const p of visiblePhones) next.set(p.phone.id, { number: p.phone.phone_number, company: p.companyName });
                }
                return next;
            });
        }
    };

    const enterAllMatching = async () => {
        if (matchCount == null || matchCount === 0) return;
        if (shouldConfirmSelectAll(matchCount)) {
            const ok = window.confirm(`This will select all phone numbers across ${matchCount} companies. Continue?`);
            if (!ok) return;
        }
        setBusy(true);
        try {
            const dncOmitted = !conditions.some(c => c.field === 'do_not_contact');
            const searchClause = buildSearchClause(searchQuery);
            const extras = [searchClause, dncOmitted ? 'do_not_contact != true' : ''].filter(Boolean).join(' && ');

            const ids = await fetchAllMatchingIds({
                collection: COLLECTIONS.COMPANIES,
                fields: filterFields,
                conditions,
                logic,
                extraFilter: extras || undefined,
            });
            const groups = await fetchPhonesForCompanyIds(ids);
            const totalPhones = groups.reduce((sum, g) => sum + g.phones.length, 0);
            if (totalPhones > 0 && shouldConfirmSelectAll(totalPhones)) {
                const ok = window.confirm(`This will select ${totalPhones} phone numbers. Continue?`);
                if (!ok) return;
            }
            const detailsMap = new Map<string, { number: string; company: string }>();
            for (const g of groups) {
                for (const p of g.phones) {
                    detailsMap.set(p.id, { number: p.phone_number, company: g.companyName });
                }
            }
            setSelectedDetails(detailsMap);
            selection.enterAllFiltered(totalPhones);
        } catch (err) {
            console.error('[CRM import] select-all-matching failed', err);
        } finally {
            setBusy(false);
        }
    };

    const exitAllMatching = () => {
        selection.exitAllFiltered();
        setSelectedDetails(new Map());
    };

    const toggleExpanded = (idx: number) => {
        setResults(prev => prev.map((r, i) => i === idx ? { ...r, expanded: !r.expanded } : r));
    };

    const handleImport = () => {
        const entries: CRMImportEntry[] = Array.from(selectedDetails.entries())
            .filter(([id]) => selection.isSelected(id))
            .map(([, v]) => ({ number: v.number, company: v.company }));
        if (entries.length === 0) return;
        onImport(entries);
        onClose();
    };

    const totalSelected = selection.selectedCount;

    if (!open) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

            <div className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
                    <div>
                        <h2 className="text-base font-semibold">Import from CRM</h2>
                        <p className="text-xs text-[var(--muted)] mt-0.5">Search and filter companies, then select phones to load into the dialer</p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Search + Filter bar */}
                <div className="px-4 pt-3 pb-2 border-b border-[var(--card-border)] space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search by name, owner, email, instagram, website…"
                                className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder:text-[var(--muted)]/50"
                            />
                        </div>
                        <FilterBuilder
                            fields={filterFields}
                            conditions={conditions}
                            logic={logic}
                            relData={relData}
                            onChange={(c, l) => { setConditions(c); setLogic(l); }}
                            title="Filter"
                        />
                    </div>
                    {conditions.length > 0 && (
                        <FilterChips
                            conditions={conditions}
                            fields={filterFields}
                            relData={relData}
                            onRemove={(id) => setConditions(conditions.filter(c => c.id !== id))}
                            onClear={() => setConditions([])}
                        />
                    )}
                </div>

                {/* Selection state banners */}
                {selection.mode === 'visible' && allVisibleSelected && matchCount != null && matchCount > visiblePhoneIds.length && totalPages > 1 && (
                    <div className="mx-4 mt-3 flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--primary-subtle)] border border-[var(--primary)]/20 text-xs">
                        <span className="text-[var(--primary)]">
                            All {visiblePhoneIds.length} phones on this page are selected.
                        </span>
                        <button
                            onClick={enterAllMatching}
                            disabled={busy}
                            className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-50"
                        >
                            {busy ? 'Loading…' : `Select all ${matchCount} matching →`}
                        </button>
                    </div>
                )}
                {selection.mode === 'all_filtered' && (
                    <div className="mx-4 mt-3 flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--primary-subtle)] border border-[var(--primary)]/20 text-xs">
                        <span className="text-[var(--primary)]">
                            All {selection.selectedCount} matching phone numbers are selected.
                        </span>
                        <button onClick={exitAllMatching} className="font-semibold text-[var(--primary)] hover:underline">
                            Clear selection
                        </button>
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {loading && (
                        <div className="flex items-center justify-center py-8 text-[var(--muted)]">
                            <Loader2 size={18} className="animate-spin mr-2" /> Searching…
                        </div>
                    )}

                    {!loading && results.length === 0 && (
                        <p className="text-sm text-[var(--muted)] text-center py-8">
                            {matchCount === 0 ? 'No companies match your filters.' : 'Type to search or add filters above.'}
                        </p>
                    )}

                    {!loading && results.length > 0 && (
                        <div className="space-y-1">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                    {matchCount != null ? `${matchCount} companies` : 'Results'}
                                    {totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ''}
                                </span>
                                <button
                                    onClick={togglePageAll}
                                    className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    {allVisibleSelected ? 'Deselect page' : 'Select page'}
                                </button>
                            </div>
                            <div className="rounded-xl border border-[var(--card-border)] divide-y divide-[var(--card-border)] overflow-hidden">
                                {results.map((item, idx) => {
                                    const hasPhones = item.phones.length > 0;
                                    const allCompanyPhonesSelected = hasPhones && item.phones.every(p => selection.isSelected(p.id));
                                    const someCompanyPhonesSelected = hasPhones && item.phones.some(p => selection.isSelected(p.id));
                                    return (
                                        <div key={item.company.id}>
                                            <div
                                                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors ${someCompanyPhonesSelected ? 'bg-[var(--success-subtle)]/10' : ''}`}
                                                onClick={() => {
                                                    if (!hasPhones) return;
                                                    if (item.phones.length === 1) togglePhone(item.phones[0], item.company.company_name);
                                                    else toggleExpanded(idx);
                                                }}
                                            >
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

                                                {item.phones.length > 1 && (
                                                    <div className="shrink-0 text-[var(--muted)]">
                                                        {item.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </div>
                                                )}
                                            </div>

                                            {item.expanded && item.phones.length > 1 && (
                                                <div className="bg-[var(--sidebar-bg)] border-t border-[var(--card-border)]">
                                                    {item.phones.map(phone => {
                                                        const isPhoneSelected = selection.isSelected(phone.id);
                                                        return (
                                                            <div
                                                                key={phone.id}
                                                                className={`flex items-center gap-3 px-3 py-2 pl-11 cursor-pointer hover:bg-[var(--card-hover)] transition-colors ${isPhoneSelected ? 'bg-[var(--success-subtle)]/20' : ''}`}
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

                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-2 pt-3">
                                    <button
                                        onClick={() => runSearch(page - 1)}
                                        disabled={page <= 1 || loading}
                                        className="px-3 py-1 text-xs rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-40 transition-all"
                                    >
                                        Previous
                                    </button>
                                    <span className="text-xs text-[var(--muted)]">Page {page} of {totalPages}</span>
                                    <button
                                        onClick={() => runSearch(page + 1)}
                                        disabled={page >= totalPages || loading}
                                        className="px-3 py-1 text-xs rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-40 transition-all"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-[var(--card-border)] px-5 py-3 flex items-center justify-between bg-[var(--card-bg)]">
                    <div className="text-xs text-[var(--muted)]">
                        {totalSelected > 0 ? (
                            <span>
                                <span className="font-semibold text-[var(--foreground)]">{totalSelected}</span> phone number{totalSelected !== 1 ? 's' : ''} selected
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
                            disabled={totalSelected === 0}
                            className="px-4 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Import {totalSelected > 0 ? `${totalSelected} Number${totalSelected !== 1 ? 's' : ''}` : ''} →
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
