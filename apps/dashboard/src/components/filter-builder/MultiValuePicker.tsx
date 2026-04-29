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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number; maxHeight: number; openUp: boolean }>({ top: 0, left: 0, width: 0, maxHeight: 256, openUp: false });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePos = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(256, Math.max(120, openUp ? spaceAbove : spaceBelow));
      setMenuStyle({
        top: openUp ? rect.top - 4 : rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 176),
        maxHeight,
        openUp,
      });
    };
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
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
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 h-8 min-w-36 max-w-72 pl-2.5 pr-7 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] relative"
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
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuStyle.openUp ? undefined : menuStyle.top,
            bottom: menuStyle.openUp ? window.innerHeight - menuStyle.top : undefined,
            left: menuStyle.left,
            minWidth: menuStyle.width,
            maxHeight: menuStyle.maxHeight,
          }}
          className="z-[60] max-w-80 overflow-y-auto bg-[var(--background)] border border-[var(--card-border)] rounded-lg shadow-xl py-1">

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
