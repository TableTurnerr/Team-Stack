'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  Building2,
  Phone,
  StickyNote,
  Mic,
  Users,
  Mail,
  CalendarClock,
  TrendingUp,
  Loader2,
  ArrowRight,
  Headphones,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { runGlobalSearch, flattenResults, type SearchResult } from '@/lib/global-search';

// Static pages for feature/page search
const PAGES: SearchResult[] = [
  { id: 'p-cold-calls', type: 'page', title: 'Cold Calls', subtitle: 'Calling', href: '/cold-calls' },
  { id: 'p-session', type: 'page', title: 'Call Session', subtitle: 'Active calling', href: '/session' },
  { id: 'p-recordings', type: 'page', title: 'Recordings', subtitle: 'Call recordings', href: '/recordings' },
  { id: 'p-notes', type: 'page', title: 'Notes', subtitle: 'All notes', href: '/notes' },
  { id: 'p-financial', type: 'page', title: 'Financial Overview', subtitle: 'Dashboard', href: '/financial' },
  { id: 'p-team', type: 'page', title: 'Team Overview', subtitle: 'Dashboard', href: '/team' },
  { id: 'p-follow-ups', type: 'page', title: 'Follow-Ups', subtitle: 'Task management', href: '/follow-ups' },
  { id: 'p-companies', type: 'page', title: 'Companies', subtitle: 'CRM', href: '/companies' },
  { id: 'p-email', type: 'page', title: 'Email Marketing', subtitle: 'Campaigns & templates', href: '/email' },
];

const PAGE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'p-cold-calls': Phone,
  'p-session': Headphones,
  'p-recordings': Mic,
  'p-notes': StickyNote,
  'p-financial': TrendingUp,
  'p-team': Users,
  'p-follow-ups': CalendarClock,
  'p-companies': Building2,
  'p-email': Mail,
};

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Building2,
  StickyNote,
  Mic,
  Users,
  CalendarClock,
  Phone,
};

function getIcon(result: SearchResult): React.ComponentType<{ size?: number; className?: string }> {
  if (result.type === 'page') return PAGE_ICONS[result.id] || ArrowRight;
  return (result.iconName && ICON_MAP[result.iconName]) || ArrowRight;
}

const TYPE_LABELS: Record<SearchResult['type'], string> = {
  company: 'Company',
  note: 'Note',
  recording: 'Recording',
  team: 'Team Member',
  'follow-up': 'Follow-Up',
  'cold-call': 'Cold Call',
  page: 'Page',
};

// How many results to show per type in the dropdown. Remaining results are
// reachable via the "View all" button.
const DROPDOWN_PER_TYPE_LIMIT = 3;
// Per-type fetch size — needs to be larger than the display limit so we can
// tell whether the "View all" affordance is needed.
const DROPDOWN_FETCH_LIMIT = 8;

interface MasterSearchProps {
  open: boolean;
  onClose: () => void;
}

export function MasterSearch({ open, onClose }: MasterSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        if (!open) onClose(); // This triggers the parent to open
      }
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    setLoading(true);
    const searchResults: SearchResult[] = [];

    // Search pages first (instant, no API call)
    const lowerQ = q.toLowerCase();
    const matchingPages = PAGES.filter(
      (p) => p.title.toLowerCase().includes(lowerQ) || p.subtitle?.toLowerCase().includes(lowerQ)
    );
    searchResults.push(...matchingPages);

    try {
      const grouped = await runGlobalSearch(q, DROPDOWN_FETCH_LIMIT);
      searchResults.push(...flattenResults(grouped));
    } catch (err) {
      console.error('[MasterSearch] search error:', err);
    }

    setResults(searchResults);
    setSelectedIndex(0);
    setLoading(false);
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 250);
  };

  const handleSelect = (result: SearchResult) => {
    router.push(result.href);
    onClose();
  };

  const viewAll = useCallback(() => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
    onClose();
  }, [query, router, onClose]);

  // Group, then truncate each group to the display limit. We keep a
  // parallel count of how many were hidden so we can decide whether to
  // render the "View all" affordance.
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});
  const truncated: Record<string, SearchResult[]> = {};
  let hiddenCount = 0;
  for (const [type, items] of Object.entries(grouped)) {
    const limit = type === 'page' ? items.length : DROPDOWN_PER_TYPE_LIMIT;
    truncated[type] = items.slice(0, limit);
    if (items.length > limit) hiddenCount += items.length - limit;
  }
  const visibleResults = Object.values(truncated).flat();
  // "View all" is a selectable row appended after results.
  const hasViewAll = query.trim().length > 0 && (hiddenCount > 0 || visibleResults.length >= DROPDOWN_PER_TYPE_LIMIT);
  const selectableCount = query ? visibleResults.length + (hasViewAll ? 1 : 0) : PAGES.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, selectableCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      if (query) {
        if (hasViewAll && selectedIndex === visibleResults.length) {
          viewAll();
        } else if (visibleResults[selectedIndex]) {
          handleSelect(visibleResults[selectedIndex]);
        }
      } else if (PAGES[selectedIndex]) {
        handleSelect(PAGES[selectedIndex]);
      }
    }
  };

  if (!open) return null;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Search panel */}
      <div className="relative w-full max-w-xl mx-4 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--card-border)]">
          <Search size={18} className="text-[var(--muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search companies, notes, recordings, team..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
          {loading && <Loader2 size={16} className="animate-spin text-[var(--muted)]" />}
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {query && !loading && visibleResults.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}

          {!query && (
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">Quick Navigation</p>
              {PAGES.map((page, i) => {
                const Icon = getIcon(page);
                return (
                  <button
                    key={page.id}
                    onClick={() => handleSelect(page)}
                    className={cn(
                      'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-colors',
                      i === selectedIndex
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]',
                    )}
                  >
                    <Icon size={16} />
                    <span className="text-sm font-medium">{page.title}</span>
                    {page.subtitle && (
                      <span className={cn('ml-auto text-xs', i === selectedIndex ? 'text-[var(--background)]/60' : 'text-[var(--muted)]')}>
                        {page.subtitle}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {Object.entries(truncated).map(([type, items]) => (
            <div key={type} className="px-5 py-2">
              <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1 px-3">
                {TYPE_LABELS[type as SearchResult['type']] || type}
              </p>
              {items.map((result) => {
                const currentIndex = flatIndex++;
                const Icon = getIcon(result);
                const isSelected = currentIndex === selectedIndex;
                return (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className={cn(
                      'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-colors',
                      isSelected
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]',
                    )}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{result.title}</span>
                    {result.subtitle && (
                      <span className={cn('ml-auto text-xs flex-shrink-0', isSelected ? 'text-[var(--background)]/60' : 'text-[var(--muted)]')}>
                        {result.subtitle}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {hasViewAll && (() => {
            const isSelected = selectedIndex === visibleResults.length;
            return (
              <div className="px-5 py-2 border-t border-[var(--card-border)]">
                <button
                  onClick={viewAll}
                  className={cn(
                    'flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-left transition-colors',
                    isSelected
                      ? 'bg-[var(--foreground)] text-[var(--background)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]',
                  )}
                >
                  <span className="text-sm font-medium">View all results</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            );
          })()}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 border-t border-[var(--card-border)] flex items-center gap-4 text-[10px] text-[var(--muted)]">
          <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--sidebar-hover)] border border-[var(--card-border)] font-mono text-[10px]">&uarr;&darr;</kbd> Navigate</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--sidebar-hover)] border border-[var(--card-border)] font-mono text-[10px]">Enter</kbd> Open</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-[var(--sidebar-hover)] border border-[var(--card-border)] font-mono text-[10px]">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
