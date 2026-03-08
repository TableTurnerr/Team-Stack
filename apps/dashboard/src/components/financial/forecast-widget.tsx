'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, CalendarCheck, RefreshCw } from 'lucide-react';
import { endOfMonth, isAfter, isBefore, parseISO } from 'date-fns';
import type { BankAccount, FinTransaction, RecurringTransaction, SupportedCurrency } from '@/lib/types';
import { useExchangeRates, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';

interface ForecastWidgetProps {
  accounts: BankAccount[];
  transactions: FinTransaction[];
  recurringTransactions: RecurringTransaction[];
  primaryCurrency: SupportedCurrency;
}

export function ForecastWidget({ accounts, transactions, recurringTransactions, primaryCurrency }: ForecastWidgetProps) {
  const { convert } = useExchangeRates();
  const symbol = CURRENCY_SYMBOLS[primaryCurrency];

  const forecast = useMemo(() => {
    const now = new Date();
    const eom = endOfMonth(now);
    // 1. Current total balance across all active accounts
    const currentBalance = accounts
      .filter(a => a.is_active !== false)
      .reduce((sum, a) => sum + convert(a.balance, a.currency, primaryCurrency), 0);

    // 2. Pending transactions that are expected to clear before end of month
    const pendingClearing = transactions
      .filter(t => {
        if (t.status !== 'pending' || !t.expected_clear_date) return false;
        const clearDate = parseISO(t.expected_clear_date.split(' ')[0]);
        return !isAfter(clearDate, eom);
      })
      .reduce((sum, t) => {
        const converted = convert(t.amount, t.currency, primaryCurrency);
        return sum + (t.type === 'income' ? converted : -converted);
      }, 0);

    // 3. Recurring transactions scheduled before end of month
    const recurringImpact = recurringTransactions
      .filter(r => {
        if (!r.is_active) return false;
        if (!r.next_run_date) return false;
        const nextRun = parseISO(r.next_run_date.split(' ')[0]);
        return !isAfter(nextRun, eom) && !isBefore(nextRun, now);
      })
      .reduce((sum, r) => {
        const converted = convert(r.amount + (r.fee_amount ?? 0), r.currency, primaryCurrency);
        return sum + (r.type === 'income' ? converted : -converted);
      }, 0);

    const projectedBalance = currentBalance + pendingClearing + recurringImpact;

    return {
      currentBalance,
      pendingClearing,
      recurringImpact,
      projectedBalance,
      netChange: projectedBalance - currentBalance,
    };
  }, [accounts, transactions, recurringTransactions, convert, primaryCurrency]);

  const isPositive = forecast.netChange >= 0;

  function fmt(n: number) {
    const abs = Math.abs(n);
    return `${n < 0 ? '-' : ''}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">End-of-Month Forecast</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">Based on current balance + pending items</p>
        </div>
        <CalendarCheck size={16} className="text-[var(--muted)] mt-0.5" />
      </div>

      {/* Projected balance — big number */}
      <div className="mb-5">
        <p className="text-[11px] text-[var(--muted)] uppercase tracking-wider mb-1">Projected Balance</p>
        <p className={cn('text-3xl font-bold tracking-tight', forecast.projectedBalance < 0 && 'text-[var(--error)]')}>
          {fmt(forecast.projectedBalance)}
        </p>
        <div className={cn('flex items-center gap-1 mt-1 text-xs', isPositive ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
          {isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          <span>{isPositive ? '+' : ''}{fmt(forecast.netChange)} from today</span>
        </div>
      </div>

      {/* Breakdown */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs py-2 border-t border-[var(--card-border)]">
          <span className="text-[var(--muted)]">Current Balance</span>
          <span className="font-semibold">{fmt(forecast.currentBalance)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-[var(--muted)]">
            <CalendarCheck size={11} />Pending Revenue Clearing
          </span>
          <span className={cn('font-medium', forecast.pendingClearing >= 0 ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
            {forecast.pendingClearing >= 0 ? '+' : ''}{fmt(forecast.pendingClearing)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-[var(--muted)]">
            <RefreshCw size={11} />Scheduled Recurring
          </span>
          <span className={cn('font-medium', forecast.recurringImpact >= 0 ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
            {forecast.recurringImpact >= 0 ? '+' : ''}{fmt(forecast.recurringImpact)}
          </span>
        </div>
      </div>
    </div>
  );
}
