'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
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

  const categoriesWithBudget = categories.filter(
    c => c.budget_limit && c.budget_limit > 0 && (c.type === 'expense' || c.type === 'both'),
  );

  // Use string-based month start comparison (avoids timezone Date-parsing issues)
  const now = new Date();
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const spending = useMemo(() => {
    const result: Record<string, number> = {};

    const monthExpenses = transactions.filter(t => {
      const dateStr = t.date.split(' ')[0]; // "YYYY-MM-DD"
      return dateStr >= monthStartStr && t.type === 'expense' && t.status === 'cleared';
    });

    for (const txn of monthExpenses) {
      const baseAmount = convert(txn.amount + (txn.fee_amount ?? 0), txn.currency, primaryCurrency);

      // Multi-category splits — distribute proportionally
      const splits = txn.category_splits;
      if (splits && splits.length > 1) {
        for (const sp of splits) {
          if (!sp.category_id) continue;
          const share = baseAmount * (sp.percentage / 100);
          result[sp.category_id] = (result[sp.category_id] ?? 0) + share;
        }
      } else if (txn.category) {
        result[txn.category] = (result[txn.category] ?? 0) + baseAmount;
      }
    }

    return result;
  }, [transactions, convert, primaryCurrency, monthStartStr]);

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
          const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
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
              {spent === 0 && (
                <p className="text-[10px] text-[var(--muted)] mt-0.5">No cleared expenses this month</p>
              )}
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
