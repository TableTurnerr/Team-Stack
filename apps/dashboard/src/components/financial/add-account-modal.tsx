'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { BankAccount, SupportedCurrency } from '@/lib/types';
import { SUPPORTED_CURRENCIES, CURRENCY_LABELS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';

const ACCOUNT_TYPES = ['checking', 'savings', 'wallet', 'credit', 'crypto', 'cash'] as const;

const PRESET_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#f59e0b',
  '#14b8a6', '#ec4899', '#f97316', '#6366f1', '#84cc16',
];

interface AddAccountModalProps {
  onClose: () => void;
  onSaved: () => void;
  editAccount?: BankAccount | null;
  userId: string;
}

export function AddAccountModal({ onClose, onSaved, editAccount, userId }: AddAccountModalProps) {
  const [name, setName] = useState(editAccount?.name ?? '');
  const [currency, setCurrency] = useState<SupportedCurrency>(editAccount?.currency ?? 'USD');
  const [balance, setBalance] = useState(editAccount?.balance?.toString() ?? '0');
  const [accountType, setAccountType] = useState<typeof ACCOUNT_TYPES[number]>(editAccount?.account_type ?? 'checking');
  const [color, setColor] = useState(editAccount?.color ?? PRESET_COLORS[0]);
  const [notes, setNotes] = useState(editAccount?.notes ?? '');
  const [isActive, setIsActive] = useState(editAccount?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) { setError('Account name is required'); return; }
    const balanceNum = parseFloat(balance);
    if (isNaN(balanceNum)) { setError('Balance must be a valid number'); return; }

    setSaving(true);
    setError('');
    try {
      const data = {
        name: name.trim(),
        currency,
        balance: balanceNum,
        account_type: accountType,
        color,
        notes: notes.trim(),
        is_active: isActive,
        created_by: userId,
      };
      if (editAccount) {
        await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(editAccount.id, data);
      } else {
        await pb.collection(COLLECTIONS.BANK_ACCOUNTS).create(data);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
          <h2 className="text-base font-semibold">{editAccount ? 'Edit Account' : 'Add Bank Account'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <p className="text-xs text-[var(--error)] bg-[var(--error-subtle)] px-3 py-2 rounded-lg">{error}</p>}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Account Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Meezan Bank, Payoneer"
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] transition-colors"
            />
          </div>

          {/* Type + Currency row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5">Account Type *</label>
              <select
                value={accountType}
                onChange={e => setAccountType(e.target.value as typeof ACCOUNT_TYPES[number])}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] capitalize"
              >
                {ACCOUNT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Currency *</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as SupportedCurrency)}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              >
                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c} — {CURRENCY_LABELS[c]}</option>)}
              </select>
            </div>
          </div>

          {/* Balance (only for new accounts) */}
          {!editAccount && (
            <div>
              <label className="block text-xs font-medium mb-1.5">Opening Balance</label>
              <input
                type="number"
                value={balance}
                onChange={e => setBalance(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              />
            </div>
          )}

          {/* Color */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn('w-6 h-6 rounded-full transition-all', color === c ? 'ring-2 ring-offset-2 ring-[var(--foreground)] scale-110' : 'opacity-70 hover:opacity-100')}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-6 h-6 rounded-full cursor-pointer border-0"
                title="Custom color"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Notes</label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            />
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 accent-[var(--foreground)]" />
            <span className="text-sm">Active account</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editAccount ? 'Save Changes' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
