'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Phone,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  Search,
  Eye,
  X,
  RefreshCw
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCall, type Company, type User } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { ColdCallsTableSkeleton } from '@/components/dashboard-skeletons';

// Outcome badge colors
const OUTCOME_COLORS: Record<string, { bg: string; text: string }> = {
  'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
  'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
  'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Wrong Number': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
  'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
};

// Interest level bar component
function InterestBar({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[var(--card-border)] rounded-full overflow-hidden max-w-[80px]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            level >= 7 ? "bg-[var(--success)]" :
              level >= 4 ? "bg-[var(--warning)]" : "bg-[var(--error)]"
          )}
          style={{ width: `${level * 10}%` }}
        />
      </div>
      <span className="text-sm text-[var(--muted)]">{level}/10</span>
    </div>
  );
}

// Sortable header component
function SortHeader({
  label,
  field,
  currentSort,
  onSort
}: {
  label: string;
  field: string;
  currentSort: { field: string; dir: 'asc' | 'desc' };
  onSort: (field: string) => void;
}) {
  const isActive = currentSort.field === field;
  return (
    <th
      className="text-left py-3 px-4 font-medium text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)] transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (
          currentSort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
        )}
      </div>
    </th>
  );
}

export default function ColdCallsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [calls, setCalls] = useState<ColdCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<string[]>([]);
  const [minInterest, setMinInterest] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Sorting
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({
    field: 'created',
    dir: 'desc'
  });

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 20;

  const fetchCalls = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      // Build filter string
      const filters: string[] = [];

      if (searchTerm) {
        filters.push(`(expand.company.company_name ~ "${searchTerm}" || phone_number ~ "${searchTerm}" || owner_name ~ "${searchTerm}")`);
      }

      if (outcomeFilter.length > 0) {
        const outcomeConditions = outcomeFilter.map(o => `call_outcome = "${o}"`).join(' || ');
        filters.push(`(${outcomeConditions})`);
      }

      if (minInterest > 0) {
        filters.push(`interest_level >= ${minInterest}`);
      }

      const result = await pb.collection(COLLECTIONS.COLD_CALLS).getList<ColdCall>(page, perPage, {
        sort: `${sort.dir === 'desc' ? '-' : ''}${sort.field}`,
        expand: 'company,claimed_by',
        ...(filters.length > 0 && { filter: filters.join(' && ') }),
      });

      setCalls(result.items);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch cold calls:', err);
        setError(`Failed to load cold calls: ${err.message} ${err.data ? JSON.stringify(err.data) : ''}`);
      }
    } finally {
      setLoading(false);
    }
  }, [page, sort, searchTerm, outcomeFilter, minInterest, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCalls();
    }
  }, [isAuthenticated, fetchCalls]);

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const toggleOutcomeFilter = (outcome: string) => {
    setOutcomeFilter(prev =>
      prev.includes(outcome)
        ? prev.filter(o => o !== outcome)
        : [...prev, outcome]
    );
  };

  const clearFilters = () => {
    setSearchTerm('');
    setOutcomeFilter([]);
    setMinInterest(0);
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Company', 'Phone', 'Recipient', 'Outcome', 'Interest Level', 'Claimed By'];
    const rows = calls.map(call => [
      formatDate(call.created),
      call.expand?.company?.company_name || 'Unknown',
      call.phone_number || '',
      call.recipients || '',
      call.call_outcome || '',
      call.interest_level?.toString() || '',
      call.expand?.claimed_by?.name || ''
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cold-calls-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasActiveFilters = searchTerm || outcomeFilter.length > 0 || minInterest > 0;

  if (loading || authLoading) {
    return <ColdCallsTableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cold Calls</h1>
          <p className="text-[var(--muted)] mt-1">View and manage call recordings and transcripts</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
              showFilters || hasActiveFilters
                ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                : "border-[var(--card-border)] hover:bg-[var(--card-bg)]"
            )}
          >
            <Filter size={16} />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 w-5 h-5 rounded-full bg-white/20 text-xs flex items-center justify-center">
                {(searchTerm ? 1 : 0) + outcomeFilter.length + (minInterest > 0 ? 1 : 0)}
              </span>
            )}
          </button>

          <button
            onClick={exportToCSV}
            disabled={calls.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors disabled:opacity-50"
          >
            <Download size={16} />
            Export CSV
          </button>

          <button
            onClick={fetchCalls}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Filters</h3>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-[var(--primary)] hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Search</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Company, phone, or name..."
                  className="w-full pl-9 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
              </div>
            </div>

            {/* Outcome Filter */}
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Outcome</label>
              <div className="flex flex-wrap gap-1">
                {Object.keys(OUTCOME_COLORS).map(outcome => (
                  <button
                    key={outcome}
                    onClick={() => toggleOutcomeFilter(outcome)}
                    className={cn(
                      "px-2 py-1 rounded-md text-xs transition-all",
                      outcomeFilter.includes(outcome)
                        ? `${OUTCOME_COLORS[outcome].bg} ${OUTCOME_COLORS[outcome].text}`
                        : "bg-[var(--sidebar-bg)] text-[var(--muted)] hover:bg-[var(--card-border)]"
                    )}
                  >
                    {outcome}
                  </button>
                ))}
              </div>
            </div>

            {/* Interest Level */}
            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">
                Min Interest Level: {minInterest || 'Any'}
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={minInterest}
                onChange={(e) => setMinInterest(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {calls.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--info-subtle)] flex items-center justify-center mx-auto mb-4">
              <Phone size={24} className="text-[var(--info)]" />
            </div>
            <p className="text-sm font-medium">No cold calls found</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {hasActiveFilters
                ? 'Try adjusting your filters'
                : 'Transcribe some call recordings to see them here'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                  <tr>
                    <SortHeader label="Date" field="created" currentSort={sort} onSort={handleSort} />
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Company</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Recipient</th>
                    <SortHeader label="Outcome" field="call_outcome" currentSort={sort} onSort={handleSort} />
                    <SortHeader label="Interest" field="interest_level" currentSort={sort} onSort={handleSort} />
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Claimed By</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr
                      key={call.id}
                      className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="text-sm">{call.created ? formatDate(call.created) : '-'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium">
                          {call.expand?.company?.company_name || 'Unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm font-mono">
                          {call.phone_number || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm">
                          {call.recipients || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {call.call_outcome && (
                          <span className={cn(
                            "px-2 py-1 rounded-md text-xs font-medium",
                            OUTCOME_COLORS[call.call_outcome]?.bg || 'bg-gray-500/20',
                            OUTCOME_COLORS[call.call_outcome]?.text || 'text-gray-400'
                          )}>
                            {call.call_outcome}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {call.interest_level !== undefined && (
                          <InterestBar level={call.interest_level} />
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm">
                          {call.expand?.claimed_by?.name || '-'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/cold-calls/${call.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-white text-[var(--background)] border border-[var(--card-border)] text-sm hover:bg-gray-100 transition-colors"
                        >
                          <Eye size={14} />
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-[var(--card-border)]">
                <span className="text-sm text-[var(--muted)]">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
