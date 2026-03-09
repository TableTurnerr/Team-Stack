'use client';

import { useState, useRef, useEffect } from 'react';
import { Variable, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface VariableDefinition {
  name: string;
  key: string;
  description: string;
  example: string;
}

export const EMAIL_VARIABLES: VariableDefinition[] = [
  { name: 'Company Name', key: 'Company_Name', description: 'The company name', example: 'Acme Corp' },
  { name: 'Owner Name', key: 'Owner_Name', description: 'The company owner/contact name', example: 'John Smith' },
  { name: 'Email', key: 'Email', description: 'The company email address', example: 'john@acme.com' },
  { name: 'Location', key: 'Location', description: 'Company location', example: 'New York, NY' },
  { name: 'Status', key: 'Status', description: 'Current CRM status', example: 'Warm' },
  { name: 'Source', key: 'Source', description: 'How the company was sourced', example: 'Instagram' },
  { name: 'Google Rating', key: 'Google_Rating', description: 'Google Maps rating', example: '4.5' },
  { name: 'Instagram Handle', key: 'Instagram_Handle', description: 'Instagram @handle', example: '@acmecorp' },
  { name: 'First Contacted', key: 'First_Contacted', description: 'Date of first contact', example: 'Mar 1, 2026' },
  { name: 'Last Contacted', key: 'Last_Contacted', description: 'Date of last contact', example: 'Mar 8, 2026' },
];

interface VariableInserterProps {
  onInsert: (variable: string) => void;
  triggerClassName?: string;
}

export function VariableInserter({ onInsert, triggerClassName }: VariableInserterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = EMAIL_VARIABLES.filter(
    (v) =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.key.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
          'text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] border border-[var(--card-border)]',
          open && 'bg-[var(--card-hover)] text-[var(--foreground)]',
          triggerClassName,
        )}
        title="Insert variable"
      >
        <Variable size={14} />
        Variables
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-[var(--card-border)]">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search variables…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-md focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--muted)]">
                No variables found
              </div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => {
                    onInsert(`{{${v.key}}}`);
                    setOpen(false);
                  }}
                  className="w-full flex items-start gap-3 px-3 py-2 rounded-md hover:bg-[var(--card-hover)] transition-colors text-left group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{v.name}</div>
                    <div className="text-xs text-[var(--muted)] mt-0.5">{v.description}</div>
                  </div>
                  <code className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[var(--muted)] group-hover:bg-[var(--background)] shrink-0 mt-0.5">
                    {`{{${v.key}}}`}
                  </code>
                </button>
              ))
            )}
          </div>
          <div className="p-2 border-t border-[var(--card-border)]">
            <p className="text-[10px] text-[var(--muted)] text-center">
              Use <code className="px-1 py-0.5 rounded bg-[var(--card-hover)]">{'{{Var|fallback}}'}</code> for fallback values
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
