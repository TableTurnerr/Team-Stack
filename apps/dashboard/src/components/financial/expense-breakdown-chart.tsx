'use client';

import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { FinTransaction, FinCategory, SupportedCurrency } from '@/lib/types';
import { useExchangeRates, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';

const DEFAULT_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b',
  '#14b8a6', '#ec4899', '#f97316', '#6366f1', '#84cc16',
];

interface ExpenseBreakdownChartProps {
  transactions: FinTransaction[];
  categories: FinCategory[];
  primaryCurrency: SupportedCurrency;
}

export function ExpenseBreakdownChart({ transactions, categories, primaryCurrency }: ExpenseBreakdownChartProps) {
  const { convert } = useExchangeRates();
  const symbol = CURRENCY_SYMBOLS[primaryCurrency];

  const data = useMemo(() => {
    const expenses = transactions.filter(t => t.type === 'expense' && t.status === 'cleared');
    const byCategory: Record<string, number> = {};

    for (const txn of expenses) {
      const key = txn.category || '__uncategorized__';
      const converted = convert(txn.amount + (txn.fee_amount ?? 0), txn.currency, primaryCurrency);
      byCategory[key] = (byCategory[key] ?? 0) + converted;
    }

    return Object.entries(byCategory)
      .map(([catId, value], i) => {
        const cat = categories.find(c => c.id === catId);
        return {
          name: cat?.name ?? 'Uncategorized',
          value: parseFloat(value.toFixed(2)),
          color: cat?.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10
  }, [transactions, categories, convert, primaryCurrency]);

  const total = data.reduce((s, d) => s + d.value, 0);

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { color: string } }> }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0];
    const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 shadow-xl text-xs">
        <p className="font-medium" style={{ color: item.payload.color }}>{item.name}</p>
        <p className="mt-0.5">{symbol}{item.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        <p className="text-[var(--muted)]">{pct}% of expenses</p>
      </div>
    );
  };

  if (data.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-1">Expense Breakdown</h3>
        <p className="text-xs text-[var(--muted)] mb-6">By category</p>
        <div className="flex items-center justify-center h-40 text-[var(--muted)] text-sm">No expense data</div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-0.5">Expense Breakdown</h3>
      <p className="text-xs text-[var(--muted)] mb-4">By category — {symbol}{total.toLocaleString('en-US', { minimumFractionDigits: 2 })} total</p>

      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
              <span className="truncate max-w-[120px]">{d.name}</span>
            </div>
            <div className="flex items-center gap-2 text-[var(--muted)]">
              <span>{symbol}{d.value.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
              <span className="w-8 text-right">{total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
