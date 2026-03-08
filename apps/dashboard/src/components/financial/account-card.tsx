'use client';

import { Wallet, CreditCard, PiggyBank, Banknote, Bitcoin, MoreVertical, Pencil, SlidersHorizontal, Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import { CurrencyTooltip } from './currency-tooltip';
import type { BankAccount, SupportedCurrency } from '@/lib/types';

const ACCOUNT_ICONS: Record<string, React.FC<{ size?: number; style?: React.CSSProperties; className?: string }>> = {
  checking: Banknote,
  savings: PiggyBank,
  wallet: Wallet,
  credit: CreditCard,
  crypto: Bitcoin,
  cash: Banknote,
};

const ACCOUNT_COLORS: Record<string, string> = {
  checking: '#3b82f6',
  savings: '#22c55e',
  wallet: '#a855f7',
  credit: '#ef4444',
  crypto: '#f59e0b',
  cash: '#14b8a6',
};

interface AccountCardProps {
  account: BankAccount;
  primaryCurrency: SupportedCurrency;
  convertedBalance: number;
  onEdit: (account: BankAccount) => void;
  onAdjust: (account: BankAccount) => void;
  onDelete: (account: BankAccount) => void;
}

export function AccountCard({ account, primaryCurrency, convertedBalance, onEdit, onAdjust, onDelete }: AccountCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = ACCOUNT_ICONS[account.account_type] ?? Wallet;
  const color = account.color || ACCOUNT_COLORS[account.account_type] || '#6366f1';
  const isNegative = account.balance < 0;

  return (
    <div className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-[var(--card-hover)] transition-all group">
      {/* Color strip */}
      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl" style={{ backgroundColor: color }} />

      <div className="flex items-start justify-between mt-1">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
            <Icon size={18} style={{ color }} />
          </div>
          <div>
            <p className="text-sm font-semibold">{account.name}</p>
            <p className="text-[11px] text-[var(--muted)] capitalize">{account.account_type}</p>
          </div>
        </div>

        {/* Menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[var(--card-hover)] text-[var(--muted)] transition-all"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl py-1"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button onClick={() => { onAdjust(account); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-[var(--card-hover)] transition-colors">
                <SlidersHorizontal size={13} /> Adjust Balance
              </button>
              <button onClick={() => { onEdit(account); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-[var(--card-hover)] transition-colors">
                <Pencil size={13} /> Edit Account
              </button>
              <div className="my-1 border-t border-[var(--card-border)]" />
              <button onClick={() => { onDelete(account); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-[var(--card-hover)] text-[var(--error)] transition-colors">
                <Trash2 size={13} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Balance */}
      <div className="mt-4">
        <CurrencyTooltip amount={account.balance} currency={account.currency}>
          <p className={cn('text-2xl font-bold tracking-tight', isNegative && 'text-[var(--error)]')}>
            {CURRENCY_SYMBOLS[account.currency]}{Math.abs(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </CurrencyTooltip>
        <p className="text-[11px] text-[var(--muted)] mt-0.5">
          {account.currency}
          {account.currency !== primaryCurrency && (
            <span className="ml-1">
              ≈ {CURRENCY_SYMBOLS[primaryCurrency]}{convertedBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {primaryCurrency}
            </span>
          )}
        </p>
      </div>

      {!account.is_active && (
        <span className="absolute top-3 right-8 text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[var(--muted)]">Inactive</span>
      )}
    </div>
  );
}
