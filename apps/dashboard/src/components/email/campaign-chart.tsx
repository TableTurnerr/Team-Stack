'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { EmailEvent } from '@/lib/email-types';

interface CampaignChartProps {
  events: EmailEvent[];
  period?: 7 | 14 | 30;
}

function resolveCssVar(variable: string): string {
  if (typeof window === 'undefined') return '#888';
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#888';
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CampaignChart({ events, period = 30 }: CampaignChartProps) {
  const colorPrimary = resolveCssVar('--primary');
  const colorSuccess = resolveCssVar('--success');
  const colorWarning = resolveCssVar('--warning');
  const colorError = resolveCssVar('--error');

  const data = useMemo(() => {
    const now = new Date();
    const days: { date: string; dateKey: string }[] = [];

    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      days.push({ date: formatDate(d), dateKey });
    }

    // Group events by day
    const eventsByDay: Record<string, Record<string, number>> = {};
    for (const day of days) {
      eventsByDay[day.dateKey] = { sent: 0, opened: 0, clicked: 0, bounced: 0 };
    }

    for (const event of events) {
      const dateKey = event.created.split(' ')[0];
      if (eventsByDay[dateKey]) {
        const type = event.event_type;
        if (type in eventsByDay[dateKey]) {
          eventsByDay[dateKey][type]++;
        }
      }
    }

    return days.map(day => ({
      date: day.date,
      Sent: eventsByDay[day.dateKey]?.sent || 0,
      Opened: eventsByDay[day.dateKey]?.opened || 0,
      Clicked: eventsByDay[day.dateKey]?.clicked || 0,
      Bounced: eventsByDay[day.dateKey]?.bounced || 0,
    }));
  }, [events, period]);

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (!active || !payload || !label) return null;
    const nonZero = payload.filter(p => p.value > 0);
    const entries = nonZero.length > 0 ? nonZero : payload;
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 shadow-xl text-xs max-w-[200px]">
        <p className="font-medium mb-1">{label}</p>
        {entries.map(entry => (
          <p key={entry.name} style={{ color: entry.color }} className="flex justify-between gap-4">
            <span>{entry.name}</span>
            <span className="font-semibold tabular-nums">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <div className="mb-5">
        <h3 className="text-sm font-semibold">Email Performance</h3>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Send volume and engagement over the last {period} days
        </p>
      </div>

      <div style={{ outline: 'none' }} tabIndex={-1} onMouseDown={e => e.preventDefault()}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={resolveCssVar('--card-border')} strokeOpacity={0.5} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: resolveCssVar('--muted') }}
              tickLine={false}
              axisLine={false}
              interval={period <= 7 ? 0 : period <= 14 ? 1 : 4}
            />
            <YAxis
              tick={{ fontSize: 10, fill: resolveCssVar('--muted') }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Sent" fill={colorPrimary} radius={[2, 2, 0, 0]} />
            <Bar dataKey="Opened" fill={colorSuccess} radius={[2, 2, 0, 0]} />
            <Bar dataKey="Clicked" fill={colorWarning} radius={[2, 2, 0, 0]} />
            <Bar dataKey="Bounced" fill={colorError} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
