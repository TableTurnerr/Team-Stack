'use client';

import { useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { BankAccount } from '@/lib/types';
import { CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';

interface AdjustBalanceModalProps {
  account: BankAccount;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AdjustBalanceModal({ account, userId, onClose, onSaved }: AdjustBalanceModalProps) {
  const [newBalance, setNewBalance] = useState(account.balance.toString());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const newBalanceNum = parseFloat(newBalance);
  const diff = isNaN(newBalanceNum) ? 0 : newBalanceNum - account.balance;
  const symbol = CURRENCY_SYMBOLS[account.currency];

  async function handleSave() {
    if (isNaN(newBalanceNum)) { setError('Enter a valid balance'); return; }
    if (!reason.trim() || reason.trim().length < 5) { setError('Please enter a meaningful reason (min 5 chars)'); return; }

    setSaving(true);
    setError('');
    try {
      // 1. Log the adjustment (audit trail)
      await pb.collection(COLLECTIONS.BALANCE_ADJUSTMENTS).create({
        bank_account: account.id,
        old_balance: account.balance,
        new_balance: newBalanceNum,
        reason: reason.trim(),
        adjusted_by: userId,
      });

      // 2. Update the account balance
      await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(account.id, {
        balance: newBalanceNum,
      });

      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to adjust balance');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
          <h2 className="text-base font-semibold">Adjust Balance</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <p className="text-xs text-[var(--error)] bg-[var(--error-subtle)] px-3 py-2 rounded-lg">{error}</p>}

          <div className="bg-[var(--card-hover)] rounded-lg px-4 py-3">
            <p className="text-xs text-[var(--muted)]">{account.name}</p>
            <p className="text-lg font-bold">
              {symbol}{account.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} {account.currency}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">New Balance *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">{symbol}</span>
              <input
                type="number"
                value={newBalance}
                onChange={e => setNewBalance(e.target.value)}
                className="w-full pl-7 pr-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              />
            </div>
            {!isNaN(newBalanceNum) && newBalanceNum !== account.balance && (
              <p className={`text-xs mt-1 ${diff > 0 ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                {diff > 0 ? '+' : ''}{symbol}{diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {account.currency}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Reason for Adjustment * <span className="text-[var(--muted)] font-normal">(required for audit)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Monthly bank reconciliation, correcting data entry error..."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] resize-none"
            />
          </div>

          <div className="flex items-start gap-2 text-xs text-[var(--muted)] bg-[var(--warning-subtle)] border border-[var(--warning)] border-opacity-30 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="text-[var(--warning)] mt-0.5 shrink-0" />
            <span>This adjustment will be permanently logged with your name, date, old balance, new balance, and reason.</span>
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || isNaN(newBalanceNum) || !reason.trim()}
            className="flex-1 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Confirm Adjustment
          </button>
        </div>
      </div>
    </div>
  );
}
