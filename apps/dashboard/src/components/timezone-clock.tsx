'use client';

import { useState, useEffect } from 'react';
import { Globe, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimezoneClockProps {
  timezone: string;
  label?: string;
  onRemove?: () => void;
  className?: string;
}

export function TimezoneClock({
  timezone,
  label,
  onRemove,
  className
}: TimezoneClockProps) {
  const [time, setTime] = useState<string>('');
  const [date, setDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        const dateString = now.toLocaleDateString('en-US', {
          timeZone: timezone,
          month: 'short',
          day: 'numeric'
        });
        setTime(timeString);
        setDate(dateString);
      } catch (e) {
        setTime('Invalid TZ');
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [timezone]);

  return (
    <div className={cn(
      "group relative flex items-center justify-between p-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] hover:border-[var(--sidebar-border)] transition-all",
      className
    )}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center text-[var(--muted)]">
          <Globe size={14} />
        </div>
        <div>
          <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider leading-none mb-1">
            {label || timezone.split('/').pop()?.replace('_', ' ')}
          </p>
          <p className="text-sm font-bold tracking-tight">{time}</p>
        </div>
      </div>
      
      <div className="text-right">
        <p className="text-[10px] text-[var(--muted)]">{date}</p>
        {onRemove && (
          <button
            onClick={onRemove}
            className="absolute -top-1 -right-1 p-0.5 rounded-full bg-[var(--error-subtle)] text-[var(--error)] opacity-0 group-hover:opacity-100 transition-opacity border border-[var(--card-border)]"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
