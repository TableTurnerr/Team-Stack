'use client';

import { GripVertical, Clock, Mail, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { EmailSequenceStep, EmailTemplate } from '@/lib/email-types';

interface SequenceStepCardProps {
  step: EmailSequenceStep;
  index: number;
  templates: EmailTemplate[];
  onUpdate: (stepId: string, data: Partial<EmailSequenceStep>) => void;
  onDelete: (stepId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst: boolean;
  isLast: boolean;
  readOnly?: boolean;
}

export function SequenceStepCard({
  step,
  index,
  templates,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  readOnly = false,
}: SequenceStepCardProps) {
  const [expanded, setExpanded] = useState(false);

  const templateName = step.expand?.template?.name || templates.find(t => t.id === step.template)?.name || 'No template selected';

  const delayText = () => {
    const days = step.delay_days || 0;
    const hours = step.delay_hours || 0;
    if (days === 0 && hours === 0) return 'Immediately';
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    return `Wait ${parts.join(' ')}`;
  };

  const sendWindowText = () => {
    if (!step.send_window_start || !step.send_window_end) return null;
    return `${step.send_window_start} – ${step.send_window_end}`;
  };

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden group">
      {/* Delay indicator (between steps) */}
      {!isFirst && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--card-hover)] border-b border-[var(--card-border)] text-xs text-[var(--muted)]">
          <Clock size={12} />
          <span>{delayText()}</span>
          {sendWindowText() && (
            <span className="ml-auto">Send window: {sendWindowText()}</span>
          )}
        </div>
      )}

      {/* Main card content */}
      <div className="flex items-center gap-3 px-4 py-3">
        {!readOnly && (
          <div className="flex flex-col gap-0.5 text-[var(--muted)] cursor-grab">
            <button
              onClick={onMoveUp}
              disabled={isFirst}
              className="p-0.5 hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={isLast}
              className="p-0.5 hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        <div className="w-8 h-8 rounded-lg bg-[var(--primary-subtle)] text-[var(--primary)] flex items-center justify-center text-sm font-bold shrink-0">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Mail size={14} className="text-[var(--muted)] shrink-0" />
            <span className="text-sm font-medium truncate">{step.subject_override || templateName}</span>
          </div>
          {step.subject_override && (
            <p className="text-xs text-[var(--muted)] mt-0.5 truncate">Template: {templateName}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!readOnly && (
            <button
              onClick={() => onDelete(step.id)}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded edit section */}
      {expanded && !readOnly && (
        <div className="px-4 pb-4 pt-1 border-t border-[var(--card-border)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Template</label>
              <select
                value={step.template || ''}
                onChange={(e) => onUpdate(step.id, { template: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              >
                <option value="">Select template...</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Subject Override</label>
              <input
                type="text"
                value={step.subject_override || ''}
                onChange={(e) => onUpdate(step.id, { subject_override: e.target.value })}
                placeholder="Leave empty to use template subject"
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Delay Days</label>
              <input
                type="number"
                min={0}
                value={step.delay_days || 0}
                onChange={(e) => onUpdate(step.id, { delay_days: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Delay Hours</label>
              <input
                type="number"
                min={0}
                max={23}
                value={step.delay_hours || 0}
                onChange={(e) => onUpdate(step.id, { delay_hours: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Window Start</label>
              <input
                type="time"
                value={step.send_window_start || ''}
                onChange={(e) => onUpdate(step.id, { send_window_start: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Window End</label>
              <input
                type="time"
                value={step.send_window_end || ''}
                onChange={(e) => onUpdate(step.id, { send_window_end: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
