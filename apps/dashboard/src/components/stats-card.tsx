import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  description?: string;
  trend?: {
    value: number;
    positive: boolean;
  };
}

export function StatsCard({ title, value, icon: Icon, description, trend }: StatsCardProps) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--muted)] font-medium">{title}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {description && (
            <p className="text-sm text-[var(--muted)] mt-1">{description}</p>
          )}
          {trend && (
            <p
              className={cn(
                'text-sm mt-2 font-medium',
                trend.positive ? 'text-green-500' : 'text-red-500'
              )}
            >
              {trend.positive ? '+' : ''}{trend.value}% from last week
            </p>
          )}
        </div>
        <div className="p-3 bg-[var(--primary)]/10 rounded-lg">
          <Icon size={24} className="text-[var(--primary)]" />
        </div>
      </div>
    </div>
  );
}
