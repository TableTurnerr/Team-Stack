'use client';

import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from 'lucide-react';
import type { FinTransaction, FinCategory, SupportedCurrency } from '@/lib/types';
import { CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';

interface RecentTransactionsQuickViewProps {
  transactions: FinTransaction[];
  categories: FinCategory[];
  primaryCurrency: SupportedCurrency;
}

export function RecentTransactionsQuickView({ transactions, categories, primaryCurrency }: RecentTransactionsQuickViewProps) {
  const symbol = CURRENCY_SYMBOLS[primaryCurrency];

  const categoryMap = useMemo(() => {
    const map: Record<string, FinCategory> = {};
    for (const c of categories) map[c.id] = c;
    return map;
  }, [categories]);

  const recent = useMemo(() => {
    return [...transactions]
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
      .slice(0, 8);
  }, [transactions]);

  if (recent.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-1">Recent Transactions</h3>
        <p className="text-xs text-[var(--muted)]">No transactions yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <h3 className="text-sm font-semibold mb-1">Recent Transactions</h3>
      <p className="text-xs text-[var(--muted)] mb-4">Latest activity across all accounts</p>

      <div className="space-y-2">
        {recent.map(txn => {
          const cat = txn.category ? categoryMap[txn.category] : undefined;
          const isIncome = txn.type === 'income';
          const total = txn.amount + (txn.fee_amount ?? 0);

          return (
            <div key={txn.id} className="flex items-center gap-3 py-1.5">
              {/* Icon */}
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                  isIncome ? 'bg-[var(--success-subtle)]' : 'bg-[var(--error-subtle)]',
                )}
              >
                {isIncome
                  ? <ArrowDownLeft size={13} className="text-[var(--success)]" />
                  : <ArrowUpRight size={13} className="text-[var(--error)]" />
                }
              </div>

              {/* Description + category */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium truncate">
                    {txn.description || (isIncome ? 'Income' : 'Expense')}
                  </span>
                  {txn.is_recurring && (
                    <RefreshCw size={10} className="text-[var(--muted)] shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {cat && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: cat.color ? `${cat.color}22` : 'var(--card-hover)', color: cat.color ?? 'var(--muted)' }}
                    >
                      {cat.name}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--muted)]">
                    {txn.date.split(' ')[0]}
                  </span>
                  {txn.status === 'pending' && (
                    <span className="text-[10px] text-[var(--warning)]">pending</span>
                  )}
                </div>
              </div>

              {/* Amount */}
              <span className={cn('text-xs font-semibold tabular-nums shrink-0', isIncome ? 'text-[var(--success)]' : 'text-[var(--foreground)]')}>
                {isIncome ? '+' : '-'}{CURRENCY_SYMBOLS[txn.currency]}{total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
