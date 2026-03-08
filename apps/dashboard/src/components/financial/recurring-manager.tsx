'use client';

import { useState } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, Loader2, X, ToggleLeft, ToggleRight } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { RecurringTransaction, BankAccount, FinCategory, SupportedCurrency } from '@/lib/types';
import { CURRENCY_SYMBOLS, SUPPORTED_CURRENCIES, CURRENCY_LABELS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface RecurringManagerProps {
  recurring: RecurringTransaction[];
  accounts: BankAccount[];
  categories: FinCategory[];
  userId: string;
  onRefresh: () => void;
}

interface RecurringFormProps {
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  accounts: BankAccount[];
  categories: FinCategory[];
  editItem?: RecurringTransaction | null;
}

function RecurringForm({ onClose, onSaved, userId, accounts, categories, editItem }: RecurringFormProps) {
  const [type, setType] = useState<'income' | 'expense'>(editItem?.type ?? 'expense');
  const [accountId, setAccountId] = useState(editItem?.bank_account ?? accounts[0]?.id ?? '');
  const [amount, setAmount] = useState(editItem?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState<SupportedCurrency>(editItem?.currency ?? accounts[0]?.currency ?? 'USD');
  const [feeAmount, setFeeAmount] = useState(editItem?.fee_amount?.toString() ?? '');
  const [categoryId, setCategoryId] = useState(editItem?.category ?? '');
  const [description, setDescription] = useState(editItem?.description ?? '');
  const [frequency, setFrequency] = useState<RecurringTransaction['frequency']>(editItem?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(editItem?.start_date?.split(' ')[0] ?? new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(editItem?.end_date?.split(' ')[0] ?? '');
  const [initialAmount, setInitialAmount] = useState(editItem?.initial_amount?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    const amountNum = parseFloat(amount);
    if (!description.trim()) { setError('Description is required'); return; }
    if (isNaN(amountNum) || amountNum <= 0) { setError('Enter a valid amount'); return; }

    setSaving(true);
    setError('');
    try {
      const data: Record<string, unknown> = {
        bank_account: accountId,
        type,
        amount: amountNum,
        currency,
        fee_amount: feeAmount ? parseFloat(feeAmount) : null,
        category: categoryId || null,
        description: description.trim(),
        frequency,
        start_date: startDate + ' 00:00:00',
        end_date: endDate ? endDate + ' 00:00:00' : null,
        next_run_date: startDate + ' 00:00:00',
        initial_amount: initialAmount ? parseFloat(initialAmount) : null,
        initial_applied: editItem?.initial_applied ?? false,
        is_active: true,
        created_by: userId,
      };

      if (editItem) {
        await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).update(editItem.id, data);
      } else {
        await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).create(data);
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const filteredCategories = categories.filter(c => c.type === type || c.type === 'both');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)] shrink-0">
          <h2 className="text-base font-semibold">{editItem ? 'Edit Recurring' : 'New Recurring Transaction'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)]"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {error && <p className="text-xs text-[var(--error)] bg-[var(--error-subtle)] px-3 py-2 rounded-lg">{error}</p>}

          {/* Type toggle */}
          <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
            {(['income', 'expense'] as const).map(t => (
              <button key={t} onClick={() => setType(t)} className={cn('flex-1 py-2 text-sm rounded-md font-medium capitalize transition-all', type === t ? (t === 'income' ? 'bg-[var(--success)] text-white' : 'bg-[var(--error)] text-white') : 'hover:bg-[var(--card-hover)] text-[var(--muted)]')}>{t}</button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Description *</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Notion subscription, Client retainer" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Account *</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-5 gap-2">
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1.5">Recurring Amount *</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1.5">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as SupportedCurrency)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]">
                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">
              Initial / Setup Amount <span className="text-[var(--muted)] font-normal">(optional — one-time first charge)</span>
            </label>
            <input type="number" value={initialAmount} onChange={e => setInitialAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Fee per cycle</label>
            <input type="number" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]">
              <option value="">No category</option>
              {filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Frequency *</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value as RecurringTransaction['frequency'])} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] capitalize">
              {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(f => <option key={f} value={f} className="capitalize">{f}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5">Start Date *</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">End Date <span className="text-[var(--muted)] font-normal">(optional)</span></label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-[var(--card-border)] shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editItem ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecurringManager({ recurring, accounts, categories, userId, onRefresh }: RecurringManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<RecurringTransaction | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleDelete(item: RecurringTransaction) {
    if (!confirm(`Delete recurring "${item.description}"?`)) return;
    setDeleting(item.id);
    try {
      await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).delete(item.id);
      onRefresh();
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggle(item: RecurringTransaction) {
    setToggling(item.id);
    try {
      await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).update(item.id, { is_active: !item.is_active });
      onRefresh();
    } finally {
      setToggling(null);
    }
  }

  const freqLabel: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">Recurring Transactions</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">Subscriptions & repeating income/expenses</p>
        </div>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 transition-opacity">
          <Plus size={13} />New
        </button>
      </div>

      {recurring.length === 0 ? (
        <div className="text-center py-10 text-[var(--muted)]">
          <RefreshCw size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No recurring transactions</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recurring.map(item => {
            const acc = accounts.find(a => a.id === item.bank_account);
            const cat = item.category ? categories.find(c => c.id === item.category) : null;
            const symbol = CURRENCY_SYMBOLS[item.currency];
            const isIncome = item.type === 'income';

            return (
              <div key={item.id} className={cn('flex items-center gap-3 p-3 rounded-lg border transition-colors', item.is_active ? 'bg-[var(--card-bg)] border-[var(--card-border)]' : 'bg-[var(--card-hover)] border-[var(--card-border)] opacity-60')}>
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', isIncome ? 'bg-[var(--success-subtle)]' : 'bg-[var(--error-subtle)]')}>
                  <RefreshCw size={14} className={isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]'} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] mt-0.5">
                    <span>{freqLabel[item.frequency]}</span>
                    {acc && <><span>·</span><span>{acc.name}</span></>}
                    {cat && <><span>·</span><span style={{ color: cat.color || undefined }}>{cat.name}</span></>}
                    {item.next_run_date && <><span>·</span><span>Next: {format(new Date(item.next_run_date.split(' ')[0]), 'MMM d')}</span></>}
                  </div>
                  {item.initial_amount && !item.initial_applied && (
                    <p className="text-[10px] text-[var(--warning)] mt-0.5">Setup fee {symbol}{item.initial_amount} pending</p>
                  )}
                </div>

                <p className={cn('text-sm font-bold tabular-nums shrink-0', isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                  {isIncome ? '+' : '-'}{symbol}{item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>

                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleToggle(item)} disabled={toggling === item.id} className="p-1.5 rounded-md hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors">
                    {toggling === item.id ? <Loader2 size={14} className="animate-spin" /> : item.is_active ? <ToggleRight size={14} className="text-[var(--success)]" /> : <ToggleLeft size={14} />}
                  </button>
                  <button onClick={() => { setEditItem(item); setShowForm(true); }} className="p-1.5 rounded-md hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => handleDelete(item)} disabled={deleting === item.id} className="p-1.5 rounded-md hover:bg-[var(--card-hover)] text-[var(--error)] transition-colors disabled:opacity-40">
                    {deleting === item.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <RecurringForm
          onClose={() => setShowForm(false)}
          onSaved={onRefresh}
          userId={userId}
          accounts={accounts}
          categories={categories}
          editItem={editItem}
        />
      )}
    </div>
  );
}
