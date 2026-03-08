'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import type { FinTransaction, SupportedCurrency } from '@/lib/types';
import { useExchangeRates, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import type { PSReward } from '@/hooks/use-partnerstack';

const PERIODS = [30, 60, 90] as const;

interface CashFlowChartProps {
  transactions: FinTransaction[];
  primaryCurrency: SupportedCurrency;
  psRewards?: PSReward[];
}

export function CashFlowChart({ transactions, primaryCurrency, psRewards }: CashFlowChartProps) {
  const [period, setPeriod] = useState<typeof PERIODS[number]>(30);
  const { convert } = useExchangeRates();
  const symbol = CURRENCY_SYMBOLS[primaryCurrency];

  const data = useMemo(() => {
    const end = startOfDay(new Date());
    const start = subDays(end, period - 1);
    const days = eachDayOfInterval({ start, end });

    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayTxns = transactions.filter(t => {
        const tDate = t.date.split(' ')[0];
        return tDate === dayStr && t.status === 'cleared';
      });

      const income = dayTxns
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + convert(t.amount, t.currency, primaryCurrency), 0);

      const expense = dayTxns
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + convert(t.amount + (t.fee_amount ?? 0), t.currency, primaryCurrency), 0);

      // PartnerStack approved rewards for this day
      const psEarnings = psRewards
        ? psRewards
            .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null)
            .filter(r => format(new Date(r.created_at), 'yyyy-MM-dd') === dayStr)
            .reduce((sum, r) => sum + convert(r.amount / 100, r.currency, primaryCurrency), 0)
        : 0;

      return {
        date: format(day, period <= 30 ? 'MMM d' : 'MMM d'),
        Income: parseFloat(income.toFixed(2)),
        Expenses: parseFloat(expense.toFixed(2)),
        ...(psRewards !== undefined ? { PartnerStack: parseFloat(psEarnings.toFixed(2)) } : {}),
      };
    });
  }, [transactions, psRewards, period, convert, primaryCurrency]);

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 shadow-xl text-xs">
        <p className="font-medium mb-1">{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-4">
            <span>{p.name}</span>
            <span className="font-semibold">{symbol}{p.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold">Cash Flow</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">Income vs Expenses over time</p>
        </div>
        <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs rounded-md transition-all ${period === p ? 'bg-[var(--foreground)] text-[var(--background)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" strokeOpacity={0.5} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--muted)' }}
            tickLine={false}
            axisLine={false}
            interval={period <= 30 ? 4 : 8}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--muted)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${symbol}${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="Income" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="Expenses" stroke="var(--error)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          {psRewards !== undefined && (
            <Line type="monotone" dataKey="PartnerStack" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="4 2" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
