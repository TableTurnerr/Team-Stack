'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import type { BankAccount, FinTransaction, SupportedCurrency } from '@/lib/types';
import { useExchangeRates, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import type { PSReward } from '@/hooks/use-partnerstack';

const PERIODS = [30, 60, 90] as const;
type ChartMode = 'cashflow' | 'balance';

// Fallback palette for accounts without a custom color
const PALETTE = [
  '#6366f1', // Indigo
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#f97316', // Orange
  '#14b8a6', // Teal
  '#84cc16', // Lime
  '#3b82f6', // Blue
  '#d946ef', // Fuchsia
  '#0ea5e9', // Sky
  '#facc15', // Yellow
  '#4ade80', // Green
];
const PS_KEY = '__partnerstack__';

interface CashFlowChartProps {
  transactions: FinTransaction[];
  primaryCurrency: SupportedCurrency;
  psRewards?: PSReward[];
  accounts?: BankAccount[];
}

function resolveCssVar(variable: string): string {
  if (typeof window === 'undefined') return '#888';
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#888';
}

export function CashFlowChart({ transactions, primaryCurrency, psRewards, accounts }: CashFlowChartProps) {
  const [period, setPeriod] = useState<typeof PERIODS[number]>(30);
  const [mode, setMode] = useState<ChartMode>('cashflow');
  const { convert } = useExchangeRates();
  const symbol = CURRENCY_SYMBOLS[primaryCurrency];

  const colorSuccess = resolveCssVar('--success');
  const colorError   = resolveCssVar('--error');
  const colorPrimary = resolveCssVar('--primary');
  const colorWarning = resolveCssVar('--warning');

  // ── Shared: day list ────────────────────────────────────────────────────────
  const days = useMemo(() => {
    const end = startOfDay(new Date());
    return eachDayOfInterval({ start: subDays(end, period - 1), end });
  }, [period]);

  // ── Cash Flow data ──────────────────────────────────────────────────────────
  const cashFlowData = useMemo(() => days.map(day => {
    const dayStr = format(day, 'yyyy-MM-dd');
    const dayTxns = transactions.filter(t => t.date.split(' ')[0] === dayStr && t.status === 'cleared');

    const income  = dayTxns.filter(t => t.type === 'income').reduce((s, t) => s + convert(t.amount, t.currency, primaryCurrency), 0);
    const expense = dayTxns.filter(t => t.type === 'expense').reduce((s, t) => s + convert(t.amount + (t.fee_amount ?? 0), t.currency, primaryCurrency), 0);

    const psApproved = (psRewards ?? [])
      .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null && format(new Date(r.created_at), 'yyyy-MM-dd') === dayStr)
      .reduce((s, r) => s + convert(r.amount / 100, r.currency as SupportedCurrency, primaryCurrency), 0);

    const psPending = (psRewards ?? [])
      .filter(r => ['pending', 'hold'].includes(r.reward_status) && r.amount != null && format(new Date(r.created_at), 'yyyy-MM-dd') === dayStr)
      .reduce((s, r) => s + convert(r.amount / 100, r.currency as SupportedCurrency, primaryCurrency), 0);

    return {
      date:          format(day, 'MMM d'),
      Income:        parseFloat(income.toFixed(2)),
      Expenses:      parseFloat(expense.toFixed(2)),
      'PS Approved': parseFloat(psApproved.toFixed(2)),
      'PS Pending':  parseFloat(psPending.toFixed(2)),
    };
  }), [days, transactions, psRewards, convert, primaryCurrency]);

  // ── Per-account Balance data ────────────────────────────────────────────────
  const { balanceData, accountLines } = useMemo(() => {
    const activeAccounts = (accounts ?? []).filter(a => a.is_active !== false);

    // Per-account daily nets (income - expense, converted to primaryCurrency)
    const accNets: Record<string, number[]> = {};
    for (const acc of activeAccounts) {
      accNets[acc.id] = days.map(day => {
        const dayStr = format(day, 'yyyy-MM-dd');
        const dayTxns = transactions.filter(t => t.bank_account === acc.id && t.date.split(' ')[0] === dayStr && t.status === 'cleared');
        return dayTxns.reduce((s, t) => {
          const amt = convert(t.amount, t.currency, primaryCurrency);
          const fee = convert(t.fee_amount ?? 0, t.currency, primaryCurrency);
          return s + (t.type === 'income' ? amt : -(amt + fee));
        }, 0);
      });
    }

    // PartnerStack approved rewards as a virtual account
    const psNets: number[] = days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      return (psRewards ?? [])
        .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null && format(new Date(r.created_at), 'yyyy-MM-dd') === dayStr)
        .reduce((s, r) => s + convert(r.amount / 100, r.currency as SupportedCurrency, primaryCurrency), 0);
    });

    // Walk backwards from current balance to reconstruct history
    const walkBack = (currentVal: number, nets: number[]): number[] => {
      const arr = new Array<number>(days.length);
      arr[days.length - 1] = currentVal;
      for (let i = days.length - 2; i >= 0; i--) arr[i] = arr[i + 1] - nets[i + 1];
      return arr;
    };

    const accountBalances: Record<string, number[]> = {};
    for (const acc of activeAccounts) {
      accountBalances[acc.id] = walkBack(convert(acc.balance, acc.currency, primaryCurrency), accNets[acc.id]);
    }

    // PS total current balance
    const psTotalNow = (psRewards ?? [])
      .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null)
      .reduce((s, r) => s + convert(r.amount / 100, r.currency as SupportedCurrency, primaryCurrency), 0);
    accountBalances[PS_KEY] = walkBack(psTotalNow, psNets);

    const data = days.map((day, i) => {
      const row: Record<string, string | number> = { date: format(day, 'MMM d') };
      for (const [key, balances] of Object.entries(accountBalances)) {
        row[key] = parseFloat(balances[i].toFixed(2));
      }
      return row;
    });

    const lines = activeAccounts.map((acc, idx) => ({
      id: acc.id,
      name: acc.name,
      color: (acc.color && /^#[0-9a-f]{3,6}$/i.test(acc.color)) ? acc.color : PALETTE[idx % PALETTE.length],
    }));

    // Add PartnerStack virtual account with a unique color from the palette
    lines.push({
      id: PS_KEY,
      name: 'PartnerStack',
      color: PALETTE[lines.length % PALETTE.length],
    });

    return {
      balanceData: data,
      accountLines: lines,
    };
  }, [days, accounts, transactions, psRewards, convert, primaryCurrency]);

  const data = mode === 'cashflow' ? cashFlowData : balanceData;

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    const nonZero = payload.filter(p => p.value !== 0);
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 shadow-xl text-xs max-w-[200px]">
        <p className="font-medium mb-1">{label}</p>
        {(nonZero.length ? nonZero : payload).map(p => (
          <p key={p.name} style={{ color: p.color }} className="flex justify-between gap-4">
            <span className="truncate">{p.name}</span>
            <span className="font-semibold tabular-nums shrink-0">
              {symbol}{p.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold">
            {mode === 'cashflow' ? 'Cash Flow' : 'Balance by Account'}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {mode === 'cashflow'
              ? 'Income, expenses & PartnerStack'
              : `${accountLines.length - 1} accounts + PartnerStack · ${primaryCurrency}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--card-bg)]">
            {(['cashflow', 'balance'] as ChartMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${mode === m ? 'bg-[var(--foreground)] text-[var(--background)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}
              >
                {m === 'cashflow' ? 'Cash Flow' : 'Balance'}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${period === p ? 'bg-[var(--foreground)] text-[var(--background)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        {/* key forces a clean remount when switching modes so Recharts picks up new Lines */}
        <LineChart key={mode} data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={resolveCssVar('--card-border')} strokeOpacity={0.5} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: resolveCssVar('--muted') }} tickLine={false} axisLine={false} interval={period <= 30 ? 4 : 8} />
          <YAxis tick={{ fontSize: 10, fill: resolveCssVar('--muted') }} tickLine={false} axisLine={false}
            tickFormatter={v => `${symbol}${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : v}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />

          {mode === 'cashflow' ? (
            <>
              <Line type="monotone" dataKey="Income"       name="Income"       stroke={colorSuccess} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="Expenses"     name="Expenses"     stroke={colorError}   strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="PS Approved"  name="PS Approved"  stroke={colorPrimary} strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="5 2" />
              <Line type="monotone" dataKey="PS Pending"   name="PS Pending"   stroke={colorWarning} strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="2 3" />
            </>
          ) : (
            <>
              {accountLines.map(acc => (
                <Line
                  key={acc.id}
                  type="monotone"
                  dataKey={acc.id}
                  name={acc.name}
                  stroke={acc.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  strokeDasharray={acc.id === PS_KEY ? '4 2' : undefined}
                />
              ))}
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
