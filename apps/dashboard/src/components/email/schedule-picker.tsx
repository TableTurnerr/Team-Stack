'use client';

import { useState } from 'react';
import { Clock, Send, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SchedulePickerProps {
  mode: 'now' | 'scheduled';
  scheduledAt: string;
  onModeChange: (mode: 'now' | 'scheduled') => void;
  onScheduledAtChange: (value: string) => void;
  className?: string;
}

export function SchedulePicker({
  mode,
  scheduledAt,
  onModeChange,
  onScheduledAtChange,
  className,
}: SchedulePickerProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <label className="text-sm font-medium block">When to Send</label>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onModeChange('now')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center',
            mode === 'now'
              ? 'border-[var(--foreground)] bg-[var(--card-hover)] shadow-sm'
              : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'
          )}
        >
          <Send size={24} className={mode === 'now' ? 'text-[var(--primary)]' : 'text-[var(--muted)]'} />
          <div>
            <p className="text-sm font-medium">Send Now</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">Deliver immediately</p>
          </div>
        </button>

        <button
          onClick={() => onModeChange('scheduled')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center',
            mode === 'scheduled'
              ? 'border-[var(--foreground)] bg-[var(--card-hover)] shadow-sm'
              : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'
          )}
        >
          <Calendar size={24} className={mode === 'scheduled' ? 'text-[var(--primary)]' : 'text-[var(--muted)]'} />
          <div>
            <p className="text-sm font-medium">Schedule</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">Pick a date & time</p>
          </div>
        </button>
      </div>

      {mode === 'scheduled' && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Clock size={14} />
            Schedule delivery
          </div>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => onScheduledAtChange(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
          {scheduledAt && (
            <p className="text-xs text-[var(--muted)]">
              Will be sent on {new Date(scheduledAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
