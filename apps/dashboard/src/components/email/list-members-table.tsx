'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Mail, Building2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { Company } from '@/lib/types';
import { SearchInput } from '@/components/search-input';
import { buildPocketBaseFilter, type FilterRule } from './list-builder';
import { sanitizeFilterValue } from '@/lib/utils';

interface ListMembersTableProps {
  listType: 'static' | 'dynamic' | 'suppression';
  companyIds?: string[];
  filterRules?: FilterRule[];
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  'Cold No Reply': 'bg-blue-500/10 text-blue-500',
  'Replied': 'bg-emerald-500/10 text-emerald-500',
  'Warm': 'bg-orange-500/10 text-orange-500',
  'Booked': 'bg-purple-500/10 text-purple-500',
  'Paid': 'bg-green-500/10 text-green-500',
  'Client': 'bg-teal-500/10 text-teal-500',
  'Excluded': 'bg-red-500/10 text-red-500',
};

export function ListMembersTable({ listType, companyIds, filterRules, className }: ListMembersTableProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const perPage = 25;

  useEffect(() => {
    const fetchCompanies = async () => {
      setLoading(true);
      try {
        const filters: string[] = [];

        if (listType === 'static' && companyIds?.length) {
          // For static lists, filter by IDs
          const idFilters = companyIds.map(id => `id = "${sanitizeFilterValue(id)}"`).join(' || ');
          filters.push(`(${idFilters})`);
        } else if (listType === 'dynamic' && filterRules?.length) {
          const dynamicFilter = buildPocketBaseFilter(filterRules);
          if (dynamicFilter) filters.push(dynamicFilter);
          filters.push('email != ""');
        }

        if (search) {
          const safe = sanitizeFilterValue(search);
          filters.push(`(company_name ~ "${safe}" || owner_name ~ "${safe}" || email ~ "${safe}")`);
        }

        const result = await pb.collection(COLLECTIONS.COMPANIES).getList(page, perPage, {
          filter: filters.length > 0 ? filters.join(' && ') : undefined,
          sort: '-created',
        });

        setCompanies(result.items as unknown as Company[]);
        setTotalPages(result.totalPages);
        setTotalItems(result.totalItems);
      } catch (err) {
        console.error('Failed to fetch list members:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCompanies();
  }, [listType, companyIds, filterRules, search, page]);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between gap-4">
        <SearchInput
          placeholder="Search members..."
          onSearch={setSearch}
          className="flex-1 max-w-sm"
        />
        <span className="text-sm text-[var(--muted)]">
          {totalItems} {totalItems === 1 ? 'member' : 'members'}
        </span>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)] px-4 py-3">
          <div className="grid grid-cols-12 gap-4 text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
            <div className="col-span-4">Company</div>
            <div className="col-span-3">Email</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 hidden md:block">Location</div>
            <div className="col-span-1"></div>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--muted)]">
            <RefreshCw size={20} className="animate-spin mr-2" />
            Loading members...
          </div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
            <Mail size={32} className="mb-2 opacity-50" />
            <p className="text-sm">No members found</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {companies.map((company) => (
              <div key={company.id} className="px-4 py-3 hover:bg-[var(--card-hover)] transition-colors">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 flex items-center gap-2 min-w-0">
                    <Building2 size={16} className="text-[var(--muted)] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{company.company_name}</p>
                      {company.owner_name && (
                        <p className="text-xs text-[var(--muted)] truncate">{company.owner_name}</p>
                      )}
                    </div>
                  </div>

                  <div className="col-span-3 min-w-0">
                    <p className="text-sm truncate text-[var(--muted)]">
                      {company.email || '—'}
                    </p>
                  </div>

                  <div className="col-span-2">
                    {company.status && (
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[company.status] ?? 'bg-[var(--card-hover)] text-[var(--muted)]')}>
                        {company.status}
                      </span>
                    )}
                  </div>

                  <div className="col-span-2 hidden md:block">
                    <p className="text-sm text-[var(--muted)] truncate">
                      {company.company_location || '—'}
                    </p>
                  </div>

                  <div className="col-span-1 flex justify-end">
                    <a
                      href={`/companies/${company.id}`}
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                      title="View company"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
