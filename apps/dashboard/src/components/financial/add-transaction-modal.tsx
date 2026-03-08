'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Upload, Tag } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { BankAccount, FinCategory, SupportedCurrency } from '@/lib/types';
import { SUPPORTED_CURRENCIES, CURRENCY_LABELS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';

interface AddTransactionModalProps {
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  accounts: BankAccount[];
  categories: FinCategory[];
  defaultType?: 'income' | 'expense';
}

export function AddTransactionModal({ onClose, onSaved, userId, accounts, categories, defaultType = 'expense' }: AddTransactionModalProps) {
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrency>(() => accounts[0]?.currency ?? 'USD');
  const [feeAmount, setFeeAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'pending' | 'cleared'>('cleared');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [expectedClearDate, setExpectedClearDate] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Sync currency when account changes
  useEffect(() => {
    const acc = accounts.find(a => a.id === accountId);
    if (acc) setCurrency(acc.currency);
  }, [accountId, accounts]);

  const filteredCategories = categories.filter(c => c.type === type || c.type === 'both');

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  }

  async function handleSave() {
    const amountNum = parseFloat(amount);
    if (!accountId) { setError('Select an account'); return; }
    if (isNaN(amountNum) || amountNum <= 0) { setError('Enter a valid amount'); return; }
    if (!date) { setError('Date is required'); return; }

    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('bank_account', accountId);
      formData.append('type', type);
      formData.append('amount', amountNum.toString());
      formData.append('currency', currency);
      if (feeAmount && !isNaN(parseFloat(feeAmount))) formData.append('fee_amount', feeAmount);
      if (categoryId) formData.append('category', categoryId);
      if (tags.length > 0) formData.append('tags', JSON.stringify(tags));
      if (description.trim()) formData.append('description', description.trim());
      formData.append('status', status);
      formData.append('date', date + ' 00:00:00');
      if (status === 'pending' && expectedClearDate) formData.append('expected_clear_date', expectedClearDate + ' 00:00:00');
      formData.append('created_by', userId);
      if (receiptFile) formData.append('receipt_file', receiptFile);

      const txn = await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).create(formData);

      // Update account balance if cleared
      if (status === 'cleared') {
        const acc = accounts.find(a => a.id === accountId);
        if (acc) {
          const delta = type === 'income' ? amountNum : -(amountNum + (parseFloat(feeAmount) || 0));
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(accountId, {
            balance: acc.balance + delta,
          });
        }
      }

      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save transaction');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)] shrink-0">
          <h2 className="text-base font-semibold">Log Transaction</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {error && <p className="text-xs text-[var(--error)] bg-[var(--error-subtle)] px-3 py-2 rounded-lg">{error}</p>}

          {/* Income / Expense toggle */}
          <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
            {(['income', 'expense'] as const).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  'flex-1 py-2 text-sm rounded-md font-medium capitalize transition-all',
                  type === t
                    ? t === 'income' ? 'bg-[var(--success)] text-white' : 'bg-[var(--error)] text-white'
                    : 'hover:bg-[var(--card-hover)] text-[var(--muted)]'
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Account */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Account *</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            >
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
            </select>
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-5 gap-2">
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1.5">Amount *</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium mb-1.5">Currency</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as SupportedCurrency)}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              >
                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Fee */}
          <div>
            <label className="block text-xs font-medium mb-1.5">
              Transaction Fee / Exchange Loss <span className="text-[var(--muted)] font-normal">(optional)</span>
            </label>
            <input
              type="number"
              value={feeAmount}
              onChange={e => setFeeAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Include bank cuts or exchange rate losses to match your actual bank statement.</p>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Category</label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            >
              <option value="">No category</option>
              {filteredCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What was this for?"
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Tags</label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="Add tag + Enter"
                className="flex-1 px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              />
              <button onClick={addTag} className="px-3 py-2 border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors">
                <Tag size={14} />
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-[var(--card-hover)] rounded-full">
                    {tag}
                    <button onClick={() => setTags(p => p.filter(t => t !== tag))} className="text-[var(--muted)] hover:text-[var(--error)] transition-colors">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Status + Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as 'pending' | 'cleared')}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              >
                <option value="cleared">Cleared</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5">Date *</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              />
            </div>
          </div>

          {status === 'pending' && (
            <div>
              <label className="block text-xs font-medium mb-1.5">Expected Clear Date</label>
              <input
                type="date"
                value={expectedClearDate}
                onChange={e => setExpectedClearDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
              />
              <p className="text-[11px] text-[var(--muted)] mt-1">System will auto-clear on this date.</p>
            </div>
          )}

          {/* Receipt Upload */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Receipt / Invoice</label>
            <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-[var(--card-border)] rounded-lg cursor-pointer hover:bg-[var(--card-hover)] transition-colors">
              <Upload size={14} className="text-[var(--muted)]" />
              <span className="text-sm text-[var(--muted)]">
                {receiptFile ? receiptFile.name : 'Upload PDF or image...'}
              </span>
              <input type="file" className="hidden" accept="image/*,application/pdf" onChange={e => setReceiptFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-[var(--card-border)] shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Log Transaction
          </button>
        </div>
      </div>
    </div>
  );
}
