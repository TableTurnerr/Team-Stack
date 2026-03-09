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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';

interface SearchResult {
  id: string;
  type: 'company' | 'note' | 'recording' | 'team' | 'follow-up' | 'cold-call' | 'page';
  title: string;
  subtitle?: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

// Static pages for feature/page search
const PAGES: SearchResult[] = [
  { id: 'p-financial', type: 'page', title: 'Financial Overview', subtitle: 'Dashboard', href: '/financial', icon: TrendingUp },
  { id: 'p-team', type: 'page', title: 'Team Overview', subtitle: 'Dashboard', href: '/team', icon: Users },
  { id: 'p-follow-ups', type: 'page', title: 'Follow-Ups', subtitle: 'Task management', href: '/follow-ups', icon: CalendarClock },
  { id: 'p-companies', type: 'page', title: 'Companies', subtitle: 'CRM', href: '/companies', icon: Building2 },
  { id: 'p-cold-calls', type: 'page', title: 'Cold Calls', subtitle: 'Calling', href: '/cold-calls', icon: Phone },
  { id: 'p-recordings', type: 'page', title: 'Recordings', subtitle: 'Call recordings', href: '/recordings', icon: Mic },
  { id: 'p-notes', type: 'page', title: 'Notes', subtitle: 'All notes', href: '/notes', icon: StickyNote },
  { id: 'p-email', type: 'page', title: 'Email Marketing', subtitle: 'Campaigns & templates', href: '/email', icon: Mail },
];

const TYPE_ICONS: Record<SearchResult['type'], React.ComponentType<{ size?: number; className?: string }>> = {
  company: Building2,
  note: StickyNote,
  recording: Mic,
  team: Users,
  'follow-up': CalendarClock,
  'cold-call': Phone,
  page: ArrowRight,
};

const TYPE_LABELS: Record<SearchResult['type'], string> = {
  company: 'Company',
  note: 'Note',
  recording: 'Recording',
  team: 'Team Member',
  'follow-up': 'Follow-Up',
  'cold-call': 'Cold Call',
  page: 'Page',
};

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
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
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

    // Search PocketBase collections in parallel
    try {
      const filter = `company_name ~ "${q.replace(/"/g, '\\"')}"`;
      const phoneFilter = `number ~ "${q.replace(/"/g, '\\"')}"`;

      const [companies, notes, recordings, users, followUps] = await Promise.all([
        pb.collection(COLLECTIONS.COMPANIES).getList(1, 5, { filter, fields: 'id,company_name,owner_name', requestKey: null }).catch(() => ({ items: [] })),
        pb.collection(COLLECTIONS.NOTES).getList(1, 5, { filter: `note_text ~ "${q.replace(/"/g, '\\"')}"`, fields: 'id,note_text,company', requestKey: null }).catch(() => ({ items: [] })),
        pb.collection(COLLECTIONS.RECORDINGS).getList(1, 5, { filter: `filename ~ "${q.replace(/"/g, '\\"')}"`, fields: 'id,filename,company', requestKey: null }).catch(() => ({ items: [] })),
        pb.collection(COLLECTIONS.USERS).getList(1, 5, { filter: `name ~ "${q.replace(/"/g, '\\"')}" || email ~ "${q.replace(/"/g, '\\"')}"`, fields: 'id,name,email', requestKey: null }).catch(() => ({ items: [] })),
        pb.collection(COLLECTIONS.FOLLOW_UPS).getList(1, 5, { filter: `title ~ "${q.replace(/"/g, '\\"')}" || description ~ "${q.replace(/"/g, '\\"')}"`, fields: 'id,title,due_date', requestKey: null }).catch(() => ({ items: [] })),
      ]);

      // Also search phone numbers
      const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList(1, 5, { filter: phoneFilter, fields: 'id,number,company,label', expand: 'company', requestKey: null }).catch(() => ({ items: [] }));

      for (const c of companies.items) {
        searchResults.push({
          id: c.id,
          type: 'company',
          title: (c as any).company_name,
          subtitle: (c as any).owner_name || undefined,
          href: `/companies/${c.id}`,
          icon: Building2,
        });
      }

      for (const p of phones.items) {
        const companyName = (p as any).expand?.company?.company_name;
        searchResults.push({
          id: p.id,
          type: 'company',
          title: (p as any).number,
          subtitle: companyName || (p as any).label || 'Phone number',
          href: (p as any).company ? `/companies/${(p as any).company}` : '/companies',
          icon: Phone,
        });
      }

      for (const n of notes.items) {
        const text = (n as any).note_text || '';
        const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
        searchResults.push({
          id: n.id,
          type: 'note',
          title: preview || 'Untitled Note',
          href: '/notes',
          icon: StickyNote,
        });
      }

      for (const r of recordings.items) {
        searchResults.push({
          id: r.id,
          type: 'recording',
          title: (r as any).filename || 'Recording',
          href: '/recordings',
          icon: Mic,
        });
      }

      for (const u of users.items) {
        searchResults.push({
          id: u.id,
          type: 'team',
          title: (u as any).name || (u as any).email,
          subtitle: (u as any).email,
          href: '/team',
          icon: Users,
        });
      }

      for (const f of followUps.items) {
        searchResults.push({
          id: f.id,
          type: 'follow-up',
          title: (f as any).title || 'Follow-up',
          subtitle: (f as any).due_date ? `Due: ${new Date((f as any).due_date).toLocaleDateString()}` : undefined,
          href: '/follow-ups',
          icon: CalendarClock,
        });
      }
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    }
  };

  if (!open) return null;

  // Group results by type
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

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
          {query && !loading && results.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}

          {!query && (
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">Quick Navigation</p>
              {PAGES.map((page, i) => {
                const Icon = page.icon;
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

          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="px-5 py-2">
              <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1 px-3">
                {TYPE_LABELS[type as SearchResult['type']] || type}
              </p>
              {items.map((result) => {
                const currentIndex = flatIndex++;
                const Icon = result.icon;
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
