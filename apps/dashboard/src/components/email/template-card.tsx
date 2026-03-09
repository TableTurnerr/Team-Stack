'use client';

import { format } from 'date-fns';
import { FileText, Copy, Pencil, Trash2, MoreVertical } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { EmailTemplate } from '@/lib/email-types';
import type { User } from '@/lib/types';

interface TemplateCardProps {
  template: EmailTemplate;
  onEdit?: (id: string) => void;
  onClone?: (template: EmailTemplate) => void;
  onDelete?: (id: string) => void;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Welcome': { bg: 'var(--success-subtle)', text: 'var(--success)' },
  'Follow-up': { bg: 'var(--primary-subtle)', text: 'var(--primary)' },
  'Promotion': { bg: 'var(--warning-subtle)', text: 'var(--warning)' },
  'Newsletter': { bg: 'var(--info-subtle)', text: 'var(--info)' },
  'Re-engagement': { bg: 'var(--error-subtle)', text: 'var(--error)' },
};

function getCategoryStyle(category?: string) {
  if (!category) return { bg: 'var(--card-hover)', text: 'var(--muted)' };
  return CATEGORY_COLORS[category] ?? { bg: 'var(--card-hover)', text: 'var(--muted)' };
}

export function TemplateCard({ template, onEdit, onClone, onDelete }: TemplateCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const catStyle = getCategoryStyle(template.category);
  const creatorName = (template.expand?.created_by as User)?.name || 'Unknown';

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl flex flex-col h-56 card-interactive group">
      {/* Preview area */}
      <div className="flex-1 p-4 overflow-hidden">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary-subtle)] flex items-center justify-center shrink-0">
              <FileText size={16} className="text-[var(--primary)]" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm truncate">{template.name}</h3>
              {template.subject && (
                <p className="text-xs text-[var(--muted)] truncate">{template.subject}</p>
              )}
            </div>
          </div>

          {/* Actions menu */}
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1 rounded-md hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl z-20 py-1">
                {onEdit && (
                  <button
                    onClick={() => { setMenuOpen(false); onEdit(template.id); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--card-hover)] transition-colors"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                )}
                {onClone && (
                  <button
                    onClick={() => { setMenuOpen(false); onClone(template); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--card-hover)] transition-colors"
                  >
                    <Copy size={13} /> Clone
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => { setMenuOpen(false); onDelete(template.id); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Preview text */}
        {template.preview_text && (
          <p className="text-xs text-[var(--muted)] line-clamp-3 mt-2">
            {template.preview_text}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-[var(--card-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {template.category && (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: catStyle.bg, color: catStyle.text }}
            >
              {template.category}
            </span>
          )}
          <span className="text-[10px] text-[var(--muted)]">
            {creatorName}
          </span>
        </div>
        <span className="text-[10px] text-[var(--muted)]">
          {template.updated ? format(new Date(template.updated), 'MMM d') : ''}
        </span>
      </div>
    </div>
  );
}
