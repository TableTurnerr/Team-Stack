'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  Loader2,
  Building2,
  StickyNote,
  Mic,
  Users,
  CalendarClock,
  Phone,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  runGlobalSearch,
  flattenResults,
  type SearchResult,
  type SearchResults,
} from '@/lib/global-search';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Building2,
  StickyNote,
  Mic,
  Users,
  CalendarClock,
  Phone,
};

const TYPE_LABELS: Record<SearchResult['type'], string> = {
  company: 'Companies',
  note: 'Notes',
  recording: 'Recordings',
  team: 'Team Members',
  'follow-up': 'Follow-Ups',
  'cold-call': 'Cold Calls',
  page: 'Pages',
};

const SECTION_ORDER: SearchResult['type'][] = [
  'company',
  'cold-call',
  'recording',
  'note',
  'follow-up',
  'team',
];

// Fetched page size per collection on the full search page. Large enough to
// surface the long tail without unbounded queries.
const FULL_FETCH_LIMIT = 50;

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  // Keep the URL in sync so the query is shareable / reloadable.
  useEffect(() => {
    const trimmed = query.trim();
    const current = searchParams.get('q') || '';
    if (trimmed === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    router.replace(`/search${params.toString() ? `?${params}` : ''}`);
  }, [query, router, searchParams]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    runGlobalSearch(q, FULL_FETCH_LIMIT)
      .then((r) => { if (!cancelled) setResults(r); })
      .catch((err) => console.error('[SearchPage] search error:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query]);

  const totalCount = useMemo(() => (results ? flattenResults(results).length : 0), [results]);

  const sections: { type: SearchResult['type']; items: SearchResult[] }[] = results
    ? SECTION_ORDER.map((type) => ({
        type,
        items:
          type === 'company' ? results.companies
          : type === 'cold-call' ? results.callLogs
          : type === 'recording' ? results.recordings
          : type === 'note' ? results.notes
          : type === 'follow-up' ? results.followUps
          : results.users,
      })).filter((s) => s.items.length > 0)
    : [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        {query && !loading && (
          <p className="text-sm text-[var(--muted)] mt-1">
            {totalCount} result{totalCount === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)]">
        <Search size={18} className="text-[var(--muted)] flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Search companies, notes, recordings, team..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
        />
        {loading && <Loader2 size={16} className="animate-spin text-[var(--muted)]" />}
      </div>

      {!query && (
        <p className="text-sm text-[var(--muted)]">Type to start searching.</p>
      )}

      {query && !loading && results && totalCount === 0 && (
        <p className="text-sm text-[var(--muted)]">No results found for &ldquo;{query}&rdquo;.</p>
      )}

      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.type}>
            <h2 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
              {TYPE_LABELS[section.type]} · {section.items.length}
            </h2>
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] divide-y divide-[var(--card-border)]">
              {section.items.map((result) => {
                const Icon = (result.iconName && ICON_MAP[result.iconName]) || ArrowRight;
                return (
                  <Link
                    key={result.id}
                    href={result.href}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 transition-colors',
                      'hover:bg-[var(--sidebar-hover)]',
                    )}
                  >
                    <Icon size={16} className="flex-shrink-0 text-[var(--muted)]" />
                    <span className="text-sm font-medium truncate">{result.title}</span>
                    {result.subtitle && (
                      <span className="ml-auto text-xs text-[var(--muted)] flex-shrink-0 truncate max-w-[40%]">
                        {result.subtitle}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-6 py-8"><Loader2 size={20} className="animate-spin text-[var(--muted)]" /></div>}>
      <SearchPageInner />
    </Suspense>
  );
}
