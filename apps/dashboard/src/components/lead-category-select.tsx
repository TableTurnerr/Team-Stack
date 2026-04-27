'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeadCategory } from '@/lib/types';

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Owner.com': { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  'ChowNow': { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  'Uncategorized': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
};

export function getCategoryColors(name: string) {
  return CATEGORY_COLORS[name] ?? { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' };
}

export function LeadCategorySelect({
  value,
  categories,
  onChange,
  onAddCategory,
}: {
  value: string;
  categories: LeadCategory[];
  onChange: (id: string) => void;
  onAddCategory: (name: string) => Promise<LeadCategory | null>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected = categories.find(c => c.id === value);

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = await onAddCategory(trimmed);
    if (created) {
      onChange(created.id);
      setNewName('');
      setAdding(false);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity',
          selected ? getCategoryColors(selected.name).bg : 'bg-[var(--card-hover)]',
          selected ? getCategoryColors(selected.name).text : 'text-[var(--muted)]',
        )}
      >
        {selected?.name ?? 'Uncategorized'}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-[160px] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg py-1">
          {selected && (
            <>
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--sidebar-hover)] transition-colors flex items-center gap-2"
              >
                <XCircle size={12} className="shrink-0" />
                Remove category
              </button>
              <div className="border-t border-[var(--card-border)] my-1" />
            </>
          )}
          {categories.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => { onChange(cat.id); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--sidebar-hover)] transition-colors flex items-center gap-2',
                value === cat.id && 'font-semibold',
              )}
            >
              <span className={cn('w-2 h-2 rounded-full shrink-0', getCategoryColors(cat.name).bg.replace('/15', ''))} />
              {cat.name}
            </button>
          ))}
          <div className="border-t border-[var(--card-border)] mt-1 pt-1">
            {adding ? (
              <div className="px-2 py-1 flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') { setAdding(false); setNewName(''); }
                  }}
                  placeholder="Category name..."
                  className="flex-1 px-1.5 py-1 text-xs rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                />
                <button type="button" onClick={handleAdd} className="p-1 rounded text-[var(--success)] hover:bg-[var(--success-subtle)]">
                  <Check size={12} />
                </button>
                <button type="button" onClick={() => { setAdding(false); setNewName(''); }} className="p-1 rounded text-[var(--muted)] hover:bg-[var(--card-hover)]">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--primary)] hover:bg-[var(--sidebar-hover)] transition-colors flex items-center gap-1"
              >
                <Plus size={11} /> Add +
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
