'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import type { BankAccount, FinTransaction, SupportedCurrency } from '@/lib/types';
import { useExchangeRates, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import type { PSReward } from '@/hooks/use-partnerstack';

type ChartMode = 'cashflow' | 'balance';

const PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#84cc16',
  '#3b82f6', '#d946ef', '#0ea5e9', '#facc15', '#4ade80',
];
const PS_KEY = '__partnerstack__';

interface CashFlowChartProps {
  transactions: FinTransaction[];
  primaryCurrency: SupportedCurrency;
  psRewards?: PSReward[];
  accounts?: BankAccount[];
  period: 30 | 60 | 90;
}

function resolveCssVar(variable: string): string {
  if (typeof window === 'undefined') return '#888';
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#888';
}

export function CashFlowChart({ transactions, primaryCurrency, psRewards, accounts, period }: CashFlowChartProps) {
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

  // ── Cash Flow data (raw, with 0s) ───────────────────────────────────────────
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

  // ── Per-account Balance data (raw, with 0s) ─────────────────────────────────
  const { balanceData, accountLines } = useMemo(() => {
    const activeAccounts = (accounts ?? []).filter(a => a.is_active !== false);

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

    const psNets: number[] = days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      return (psRewards ?? [])
        .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null && format(new Date(r.created_at), 'yyyy-MM-dd') === dayStr)
        .reduce((s, r) => s + convert(r.amount / 100, r.currency as SupportedCurrency, primaryCurrency), 0);
    });

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
    lines.push({ id: PS_KEY, name: 'PartnerStack', color: PALETTE[lines.length % PALETTE.length] });

    return { balanceData: data, accountLines: lines };
  }, [days, accounts, transactions, psRewards, convert, primaryCurrency]);

  // ── Helper: keep a 0 only at the boundary of a non-zero segment ─────────────
  // Interior zeros (no non-zero neighbour) become null so no flat baseline runs.
  function boundaryZeros(vals: number[]): (number | null)[] {
    return vals.map((v, i) => {
      if (v !== 0) return v;
      const prevNZ = i > 0 && vals[i - 1] !== 0;
      const nextNZ = i < vals.length - 1 && vals[i + 1] !== 0;
      return prevNZ || nextNZ ? 0 : null;
    });
  }

  // ── Display data ─────────────────────────────────────────────────────────────
  const cashFlowDisplayData = useMemo(() => {
    const keys = ['Income', 'Expenses', 'PS Approved', 'PS Pending'] as const;
    const processed = Object.fromEntries(
      keys.map(k => [k, boundaryZeros(cashFlowData.map(d => d[k]))])
    ) as Record<typeof keys[number], (number | null)[]>;

    return cashFlowData.map((d, i) => ({
      date:          d.date,
      Income:        processed['Income'][i],
      Expenses:      processed['Expenses'][i],
      'PS Approved': processed['PS Approved'][i],
      'PS Pending':  processed['PS Pending'][i],
    }));
  }, [cashFlowData]);

  const balanceDisplayData = useMemo(() => {
    const processed: Record<string, (number | null)[]> = {};
    for (const acc of accountLines) {
      processed[acc.id] = boundaryZeros(balanceData.map(row => row[acc.id] as number));
    }
    return balanceData.map((row, i) => {
      const newRow: Record<string, string | number | null> = { date: row.date };
      for (const acc of accountLines) newRow[acc.id] = processed[acc.id][i];
      return newRow;
    });
  }, [balanceData, accountLines]);

  // ── Lookup maps for tooltip (use original data with real 0 values) ───────────
  const cfLookup = useMemo(() => {
    const m = new Map<string, typeof cashFlowData[0]>();
    for (const d of cashFlowData) m.set(d.date, d);
    return m;
  }, [cashFlowData]);

  const blLookup = useMemo(() => {
    const m = new Map<string, Record<string, string | number>>();
    for (const d of balanceData) m.set(d.date as string, d);
    return m;
  }, [balanceData]);

  const data = mode === 'cashflow' ? cashFlowDisplayData : balanceDisplayData;

  // ── Tooltip (reads from original data so 0 values still appear) ─────────────
  const CustomTooltip = ({ active, label }: { active?: boolean; label?: string }) => {
    if (!active || !label) return null;

    if (mode === 'cashflow') {
      const orig = cfLookup.get(label);
      if (!orig) return null;
      const entries = [
        { name: 'Income',       value: orig.Income,          color: colorSuccess },
        { name: 'Expenses',     value: orig.Expenses,        color: colorError },
        { name: 'PS Approved',  value: orig['PS Approved'],  color: colorPrimary },
        { name: 'PS Pending',   value: orig['PS Pending'],   color: colorWarning },
      ];
      const nonZero = entries.filter(e => e.value !== 0);
      return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 shadow-xl text-xs max-w-[200px]">
          <p className="font-medium mb-1">{label}</p>
          {(nonZero.length ? nonZero : entries).map(e => (
            <p key={e.name} style={{ color: e.color }} className="flex justify-between gap-4">
              <span className="truncate">{e.name}</span>
              <span className="font-semibold tabular-nums shrink-0">
                {symbol}{e.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </p>
          ))}
        </div>
      );
    }

    // Balance mode
    const orig = blLookup.get(label);
    if (!orig) return null;
    const entries = accountLines.map(acc => ({
      name: acc.name,
      value: orig[acc.id] as number,
      color: acc.color,
    }));
    const nonZero = entries.filter(e => e.value !== 0);
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 shadow-xl text-xs max-w-[200px]">
        <p className="font-medium mb-1">{label}</p>
        {(nonZero.length ? nonZero : entries).map(e => (
          <p key={e.name} style={{ color: e.color }} className="flex justify-between gap-4">
            <span className="truncate">{e.name}</span>
            <span className="font-semibold tabular-nums shrink-0">
              {symbol}{e.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
        </div>
      </div>

      <div style={{ outline: 'none' }} tabIndex={-1} onMouseDown={e => e.preventDefault()}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart key={mode} data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} style={{ outline: 'none' }}>
            <CartesianGrid strokeDasharray="3 3" stroke={resolveCssVar('--card-border')} strokeOpacity={0.5} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: resolveCssVar('--muted') }} tickLine={false} axisLine={false} interval={period <= 30 ? 4 : 8} />
            <YAxis tick={{ fontSize: 10, fill: resolveCssVar('--muted') }} tickLine={false} axisLine={false}
              tickFormatter={v => `${symbol}${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}K` : v}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />

            {mode === 'cashflow' ? (
              <>
                <Line type="monotone" dataKey="Income"       name="Income"       stroke={colorSuccess} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                <Line type="monotone" dataKey="Expenses"     name="Expenses"     stroke={colorError}   strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                <Line type="monotone" dataKey="PS Approved"  name="PS Approved"  stroke={colorPrimary} strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="5 2" connectNulls={false} />
                <Line type="monotone" dataKey="PS Pending"   name="PS Pending"   stroke={colorWarning} strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="2 3" connectNulls={false} />
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
                    connectNulls={false}
                  />
                ))}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
