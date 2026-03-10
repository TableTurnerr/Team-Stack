'use client';

import { useState, useEffect } from 'react';
import { timeAgo, formatDateTime } from '@/lib/utils';
import { formatDateTimeInTimezone, getTimezoneAbbreviation } from '@/lib/timezone-utils';
import { Tooltip } from '@/components/ui/tooltip';

interface RelativeTimeProps {
  date: string | Date;
  timezones?: { timezone: string; label: string }[];
  className?: string;
}

export function RelativeTime({ date, timezones, className }: RelativeTimeProps) {
  const [relative, setRelative] = useState(() => timeAgo(date));

  // Update relative time every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      setRelative(timeAgo(date));
    }, 30_000);
    return () => clearInterval(interval);
  }, [date]);

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localAbbr = getTimezoneAbbreviation(localTz);
  const localFormatted = formatDateTimeInTimezone(date, localTz);

  const tooltipContent = (
    <div className="flex flex-col gap-1 py-0.5 text-[11px]">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[var(--muted)]">{localAbbr}</span>
        <span className="font-medium">{localFormatted}</span>
      </div>
      {timezones?.map((tz) => {
        // Skip if same as local
        if (tz.timezone === localTz) return null;
        const formatted = formatDateTimeInTimezone(date, tz.timezone);
        const abbr = tz.label || getTimezoneAbbreviation(tz.timezone);
        return (
          <div key={tz.timezone} className="flex items-center justify-between gap-4">
            <span className="text-[var(--muted)]">{abbr}</span>
            <span>{formatted}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} className="whitespace-normal min-w-[180px]">
      <span className={className}>{relative}</span>
    </Tooltip>
  );
}
