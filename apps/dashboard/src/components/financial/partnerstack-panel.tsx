'use client';

import { useMemo } from 'react';
import { RefreshCw, TrendingUp, DollarSign, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { usePartnerstack, type PSPayout, type PSReward } from '@/hooks/use-partnerstack';
import { cn } from '@/lib/utils';

// ── Helpers ────────────────────────────────────────────────────────────────────

function cents(v: number) { return v / 100; }

function fmtMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(epochMs: number) {
  return new Date(epochMs).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ── Status badges ──────────────────────────────────────────────────────────────

const REWARD_STATUS_STYLES: Record<string, string> = {
  approved: 'bg-[var(--success-subtle)] text-[var(--success)]',
  paid:     'bg-[var(--success-subtle)] text-[var(--success)]',
  pending:  'bg-[var(--warning-subtle)] text-[var(--warning)]',
  hold:     'bg-[var(--warning-subtle)] text-[var(--warning)]',
  declined: 'bg-[var(--error-subtle)] text-[var(--error)]',
};

const PAYOUT_STATUS_STYLES: Record<string, string> = {
  successful: 'bg-[var(--success-subtle)] text-[var(--success)]',
  pending:    'bg-[var(--warning-subtle)] text-[var(--warning)]',
  ready:      'bg-[var(--warning-subtle)] text-[var(--warning)]',
  failed:     'bg-[var(--error-subtle)] text-[var(--error)]',
  cancelled:  'bg-[var(--error-subtle)] text-[var(--error)]',
  new:        'bg-[var(--muted)]/20 text-[var(--muted)]',
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const cls = map[status] ?? 'bg-[var(--muted)]/20 text-[var(--muted)]';
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize whitespace-nowrap', cls)}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string;
}) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color }} />
        <p className="text-xs text-[var(--muted)]">{label}</p>
      </div>
      <p className="text-xl font-bold tracking-tight" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );
}

// ── Rewards Table ─────────────────────────────────────────────────────────────

function RewardsTable({ rewards }: { rewards: PSReward[] }) {
  const sorted = useMemo(
    () => [...rewards].sort((a, b) => b.created_at - a.created_at).slice(0, 50),
    [rewards],
  );

  if (sorted.length === 0) {
    return <p className="text-xs text-[var(--muted)] text-center py-8">No rewards found</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
            <th className="text-left pb-2 pr-4 font-medium">Date</th>
            <th className="text-left pb-2 pr-4 font-medium">Description</th>
            <th className="text-left pb-2 pr-4 font-medium">Customer</th>
            <th className="text-right pb-2 pr-4 font-medium">Amount</th>
            <th className="text-left pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.key} className="border-b border-[var(--card-border)]/50 hover:bg-[var(--card-hover)] transition-colors">
              <td className="py-2.5 pr-4 text-[var(--muted)] whitespace-nowrap">{fmtDate(r.created_at)}</td>
              <td className="py-2.5 pr-4 max-w-[200px] truncate">
                {r.description ?? r.company?.name ?? '—'}
              </td>
              <td className="py-2.5 pr-4 text-[var(--muted)] max-w-[160px] truncate">
                {r.customer?.name ?? r.customer?.email ?? '—'}
              </td>
              <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">
                {r.amount != null ? fmtMoney(cents(r.amount), r.currency) : '—'}
              </td>
              <td className="py-2.5">
                <StatusBadge status={r.reward_status} map={REWARD_STATUS_STYLES} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rewards.length > 50 && (
        <p className="text-[11px] text-[var(--muted)] text-center pt-3">
          Showing 50 of {rewards.length} rewards
        </p>
      )}
    </div>
  );
}

// ── Payouts Table ─────────────────────────────────────────────────────────────

function PayoutsTable({ payouts }: { payouts: PSPayout[] }) {
  const sorted = useMemo(
    () => [...payouts].sort((a, b) => b.created_at - a.created_at),
    [payouts],
  );

  if (sorted.length === 0) {
    return <p className="text-xs text-[var(--muted)] text-center py-8">No payouts found</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
            <th className="text-left pb-2 pr-4 font-medium">Date</th>
            <th className="text-right pb-2 pr-4 font-medium">Amount</th>
            <th className="text-left pb-2 pr-4 font-medium">Provider</th>
            <th className="text-left pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.key} className="border-b border-[var(--card-border)]/50 hover:bg-[var(--card-hover)] transition-colors">
              <td className="py-2.5 pr-4 text-[var(--muted)] whitespace-nowrap">{fmtDate(p.created_at)}</td>
              <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">
                {fmtMoney(cents(p.amount), p.currency)}
              </td>
              <td className="py-2.5 pr-4 capitalize">{p.provider?.name ?? '—'}</td>
              <td className="py-2.5">
                <StatusBadge status={p.status} map={PAYOUT_STATUS_STYLES} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function PartnerStackPanel() {
  const { payouts, rewards, loading, error, refresh } = usePartnerstack();

  // KPI calculations (all amounts are in cents from API)
  const kpis = useMemo(() => {
    // Pick the dominant currency from rewards (first reward's currency, default USD)
    const currency = rewards[0]?.currency ?? payouts[0]?.currency ?? 'USD';

    const totalEarned = rewards
      .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.currency === currency)
      .reduce((s, r) => s + cents(r.amount ?? 0), 0);

    const pending = rewards
      .filter(r => ['pending', 'hold'].includes(r.reward_status) && r.currency === currency)
      .reduce((s, r) => s + cents(r.amount ?? 0), 0);

    const totalPaidOut = payouts
      .filter(p => p.status === 'successful' && p.currency === currency)
      .reduce((s, p) => s + cents(p.amount), 0);

    return { totalEarned, pending, totalPaidOut, currency };
  }, [rewards, payouts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--muted)]">
        <RefreshCw size={20} className="animate-spin mr-2" />
        Loading PartnerStack data...
      </div>
    );
  }

  if (error) {
    const isUnconfigured = error.includes('not configured');
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
        <AlertCircle size={32} className="text-[var(--error)] opacity-60" />
        <div>
          <p className="text-sm font-medium text-[var(--error)]">
            {isUnconfigured ? 'API key not configured' : 'Failed to load PartnerStack data'}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {isUnconfigured
              ? 'Add PARTNERSTACK_API_KEY to your .env.local file and restart the server.'
              : error}
          </p>
        </div>
        {!isUnconfigured && (
          <button onClick={refresh} className="px-4 py-2 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90">
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Total Earnings"
          value={fmtMoney(kpis.totalEarned, kpis.currency)}
          sub="Approved & paid rewards"
          icon={TrendingUp}
          color="var(--success)"
        />
        <KpiCard
          label="Total Paid Out"
          value={fmtMoney(kpis.totalPaidOut, kpis.currency)}
          sub={`${payouts.filter(p => p.status === 'successful').length} successful payouts`}
          icon={CheckCircle}
          color="var(--primary)"
        />
        <KpiCard
          label="Pending Rewards"
          value={fmtMoney(kpis.pending, kpis.currency)}
          sub={`${rewards.filter(r => ['pending', 'hold'].includes(r.reward_status)).length} rewards awaiting approval`}
          icon={Clock}
          color="var(--warning)"
        />
      </div>

      {/* Rewards */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Rewards</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">{rewards.length} total</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1">
              <CheckCircle size={11} className="text-[var(--success)]" />
              {rewards.filter(r => ['approved', 'paid'].includes(r.reward_status)).length} approved
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-[var(--warning)]" />
              {rewards.filter(r => ['pending', 'hold'].includes(r.reward_status)).length} pending
            </span>
            <span className="flex items-center gap-1">
              <XCircle size={11} className="text-[var(--error)]" />
              {rewards.filter(r => r.reward_status === 'declined').length} declined
            </span>
          </div>
        </div>
        <RewardsTable rewards={rewards} />
      </div>

      {/* Payouts */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Payout History</h3>
            <p className="text-xs text-[var(--muted)] mt-0.5">{payouts.length} total</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1">
              <CheckCircle size={11} className="text-[var(--success)]" />
              {payouts.filter(p => p.status === 'successful').length} successful
            </span>
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-[var(--warning)]" />
              {payouts.filter(p => ['pending', 'ready'].includes(p.status)).length} pending
            </span>
          </div>
        </div>
        <PayoutsTable payouts={payouts} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <DollarSign size={11} />
          Data from PartnerStack Partner API · amounts in {kpis.currency}
        </span>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 hover:text-[var(--foreground)] transition-colors"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>
    </div>
  );
}
