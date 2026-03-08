'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { startOfMonth } from 'date-fns';
import type { FinTransaction, FinCategory, SupportedCurrency } from '@/lib/types';
import { useExchangeRates, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';

interface BudgetProgressProps {
  transactions: FinTransaction[];
  categories: FinCategory[];
  primaryCurrency: SupportedCurrency;
}

export function BudgetProgress({ transactions, categories, primaryCurrency }: BudgetProgressProps) {
  const { convert } = useExchangeRates();
  const symbol = CURRENCY_SYMBOLS[primaryCurrency];

  const categoriesWithBudget = categories.filter(c => c.budget_limit && c.budget_limit > 0 && (c.type === 'expense' || c.type === 'both'));

  const monthStart = startOfMonth(new Date());

  const spending = useMemo(() => {
    const result: Record<string, number> = {};
    const monthTxns = transactions.filter(t => {
      const d = new Date(t.date.split(' ')[0]);
      return d >= monthStart && t.type === 'expense' && t.status === 'cleared';
    });
    for (const txn of monthTxns) {
      if (!txn.category) continue;
      const converted = convert(txn.amount + (txn.fee_amount ?? 0), txn.currency, primaryCurrency);
      result[txn.category] = (result[txn.category] ?? 0) + converted;
    }
    return result;
  }, [transactions, convert, primaryCurrency, monthStart]);

  if (categoriesWithBudget.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-1">Budget Limits</h3>
        <p className="text-xs text-[var(--muted)]">No budget limits set. Add limits to categories to track spending.</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Budget Limits</h3>
      <p className="text-xs text-[var(--muted)] mb-4">Current month spending vs limits</p>

      <div className="space-y-4">
        {categoriesWithBudget.map(cat => {
          const spent = spending[cat.id] ?? 0;
          const limit = convert(cat.budget_limit!, cat.budget_currency ?? primaryCurrency, primaryCurrency);
          const pct = Math.min((spent / limit) * 100, 100);
          const isOver = spent > limit;
          const isWarning = pct >= 80 && !isOver;

          const barColor = isOver
            ? 'var(--error)'
            : isWarning
            ? 'var(--warning)'
            : cat.color ?? 'var(--success)';

          return (
            <div key={cat.id}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color ?? 'var(--muted)' }} />
                  <span className="text-xs font-medium">{cat.name}</span>
                  {isOver && <AlertTriangle size={11} className="text-[var(--error)]" />}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  <span className={cn(isOver && 'text-[var(--error)] font-semibold', isWarning && 'text-[var(--warning)] font-semibold')}>
                    {symbol}{spent.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                  <span> / {symbol}{limit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
              </div>
              <div className="h-1.5 bg-[var(--card-hover)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: barColor }}
                />
              </div>
              {isOver && (
                <p className="text-[10px] text-[var(--error)] mt-0.5">
                  Over by {symbol}{(spent - limit).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
