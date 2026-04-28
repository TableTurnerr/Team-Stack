'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
}

interface MultiValuePickerProps {
  options: readonly Option[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiValuePicker({ options, values, onChange, placeholder = 'Select…', className }: MultiValuePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const valueSet = new Set(values);
  const selectedLabels = options.filter(o => valueSet.has(o.value)).map(o => o.label);

  const toggle = (v: string) => {
    if (valueSet.has(v)) onChange(values.filter(x => x !== v));
    else onChange([...values, v]);
  };

  const remove = (v: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(values.filter(x => x !== v));
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 min-w-36 max-w-72 pl-2.5 pr-7 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] relative"
      >
        {selectedLabels.length === 0 ? (
          <span className="text-[var(--muted)]">{placeholder}</span>
        ) : (
          <span className="flex flex-wrap gap-1 items-center">
            {selectedLabels.slice(0, 3).map((label, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[10px]"
              >
                {label}
                <X
                  size={10}
                  className="cursor-pointer hover:text-[var(--error)]"
                  onClick={(e) => remove(options.find(o => o.label === label)!.value, e)}
                />
              </span>
            ))}
            {selectedLabels.length > 3 && (
              <span className="text-[10px] text-[var(--muted)]">+{selectedLabels.length - 3}</span>
            )}
          </span>
        )}
        <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--muted)]" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-44 max-w-80 max-h-64 overflow-y-auto bg-[var(--background)] border border-[var(--card-border)] rounded-lg shadow-xl py-1">
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-[var(--muted)]">No options</div>
          )}
          {options.map(opt => {
            const selected = valueSet.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-[var(--card-hover)] text-left"
              >
                <span className={cn(
                  'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                  selected
                    ? 'bg-[var(--foreground)] border-[var(--foreground)]'
                    : 'border-[var(--card-border)]'
                )}>
                  {selected && <Check size={10} className="text-[var(--background)]" />}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
