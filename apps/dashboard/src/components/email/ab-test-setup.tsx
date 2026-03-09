'use client';

import { FlaskConical, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ABWinnerMetric } from '@/lib/email-types';

interface ABTestSetupProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  variantASubject: string;
  variantBSubject: string;
  onVariantASubjectChange: (value: string) => void;
  onVariantBSubjectChange: (value: string) => void;
  splitPct: number;
  onSplitPctChange: (value: number) => void;
  winnerMetric: ABWinnerMetric;
  onWinnerMetricChange: (value: ABWinnerMetric) => void;
  className?: string;
}

export function ABTestSetup({
  enabled,
  onToggle,
  variantASubject,
  variantBSubject,
  onVariantASubjectChange,
  onVariantBSubjectChange,
  splitPct,
  onSplitPctChange,
  winnerMetric,
  onWinnerMetricChange,
  className,
}: ABTestSetupProps) {
  const remainingPct = 100 - (splitPct * 2);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={18} />
          <div>
            <p className="text-sm font-medium">A/B Test</p>
            <p className="text-xs text-[var(--muted)]">Test two subject lines and send the winner to the rest</p>
          </div>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors',
            enabled ? 'bg-[var(--primary)]' : 'bg-[var(--card-border)]'
          )}
        >
          <span className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm',
            enabled && 'translate-x-5'
          )} />
        </button>
      </div>

      {enabled && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-4">
          {/* Variant Subjects */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--muted)] block mb-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-500 text-xs font-bold flex items-center justify-center">A</span>
                  Variant A Subject
                </span>
              </label>
              <input
                type="text"
                value={variantASubject}
                onChange={(e) => onVariantASubjectChange(e.target.value)}
                placeholder="First subject line..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted)] block mb-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-purple-500/20 text-purple-500 text-xs font-bold flex items-center justify-center">B</span>
                  Variant B Subject
                </span>
              </label>
              <input
                type="text"
                value={variantBSubject}
                onChange={(e) => onVariantBSubjectChange(e.target.value)}
                placeholder="Second subject line..."
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              />
            </div>
          </div>

          {/* Split Percentage */}
          <div>
            <label className="text-xs font-medium text-[var(--muted)] block mb-2">
              Test Split Percentage
            </label>
            <input
              type="range"
              min={5}
              max={40}
              step={5}
              value={splitPct}
              onChange={(e) => onSplitPctChange(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
            <div className="flex justify-between mt-2">
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-blue-500/30" />
                  A: {splitPct}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-purple-500/30" />
                  B: {splitPct}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm bg-[var(--card-hover)]" />
                  Winner: {remainingPct}%
                </span>
              </div>
            </div>

            {/* Visual bar */}
            <div className="flex h-2 rounded-full overflow-hidden mt-2">
              <div className="bg-blue-500/40" style={{ width: `${splitPct}%` }} />
              <div className="bg-purple-500/40" style={{ width: `${splitPct}%` }} />
              <div className="bg-[var(--card-hover)]" style={{ width: `${remainingPct}%` }} />
            </div>
          </div>

          {/* Winner Metric */}
          <div>
            <label className="text-xs font-medium text-[var(--muted)] block mb-2">
              Winner Metric
            </label>
            <div className="flex gap-2">
              {([
                { key: 'open_rate' as ABWinnerMetric, label: 'Open Rate' },
                { key: 'click_rate' as ABWinnerMetric, label: 'Click Rate' },
              ]).map(metric => (
                <button
                  key={metric.key}
                  onClick={() => onWinnerMetricChange(metric.key)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                    winnerMetric === metric.key
                      ? 'border-[var(--foreground)] bg-[var(--card-hover)] font-medium'
                      : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                  )}
                >
                  <BarChart3 size={14} />
                  {metric.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--muted)] mt-2">
              After 4 hours, the variant with the higher {winnerMetric === 'open_rate' ? 'open rate' : 'click rate'} will be sent to the remaining {remainingPct}% of your audience.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
