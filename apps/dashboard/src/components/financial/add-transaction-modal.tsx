'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Upload, Tag, Plus, Trash2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { BankAccount, FinCategory, SupportedCurrency, CategorySplit } from '@/lib/types';
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

// ─── Category Split Editor ────────────────────────────────────────────────────
function CategorySplitEditor({
  splits,
  onChange,
  filteredCategories,
}: {
  splits: CategorySplit[];
  onChange: (s: CategorySplit[]) => void;
  filteredCategories: FinCategory[];
}) {
  const total = splits.reduce((s, sp) => s + (sp.percentage || 0), 0);
  const isValid = splits.length === 0 || Math.abs(total - 100) < 0.01;

  function update(i: number, field: keyof CategorySplit, value: string | number) {
    const next = splits.map((sp, idx) =>
      idx === i ? { ...sp, [field]: field === 'percentage' ? Number(value) : value } : sp,
    );
    onChange(next);
  }

  function add() {
    // auto-fill remaining percentage
    const remaining = Math.max(0, 100 - total);
    onChange([...splits, { category_id: '', percentage: remaining }]);
  }

  function remove(i: number) {
    onChange(splits.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium">
          {splits.length > 1 ? 'Category Splits' : 'Category'}
        </label>
        {splits.length > 1 && (
          <span
            className={cn(
              'text-[10px] font-semibold tabular-nums',
              isValid ? 'text-[var(--success)]' : total > 100 ? 'text-[var(--error)]' : 'text-[var(--warning)]',
            )}
          >
            {total.toFixed(0)}% / 100%
          </span>
        )}
      </div>

      <div className="space-y-2">
        {splits.map((sp, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={sp.category_id}
              onChange={e => update(i, 'category_id', e.target.value)}
              className="flex-1 px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            >
              <option value="">No category</option>
              {filteredCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {splits.length > 1 && (
              <div className="relative w-20 shrink-0">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={sp.percentage}
                  onChange={e => update(i, 'percentage', e.target.value)}
                  className="w-full pl-2 pr-5 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] tabular-nums"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] pointer-events-none">%</span>
              </div>
            )}

            {splits.length > 1 && (
              <button
                onClick={() => remove(i)}
                className="p-1.5 text-[var(--muted)] hover:text-[var(--error)] transition-colors shrink-0"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      {splits.length > 0 && !isValid && (
        <p className="text-[10px] text-[var(--warning)] mt-1">
          Percentages must add up to 100% (currently {total.toFixed(0)}%).
        </p>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-2 flex items-center gap-1 text-xs text-[var(--primary)] hover:opacity-80 transition-opacity"
      >
        <Plus size={11} />
        {splits.length === 0 ? 'Add category' : 'Add another category split'}
      </button>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export function AddTransactionModal({ onClose, onSaved, userId, accounts, categories, defaultType = 'expense' }: AddTransactionModalProps) {
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrency>(() => accounts[0]?.currency ?? 'USD');
  const [feeAmount, setFeeAmount] = useState('');
  // Category splits — start with one empty split slot
  const [splits, setSplits] = useState<CategorySplit[]>([{ category_id: '', percentage: 100 }]);
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

  // Reset splits to one empty slot when type changes (category list changes)
  useEffect(() => {
    setSplits([{ category_id: '', percentage: 100 }]);
  }, [type]);

  const filteredCategories = categories.filter(c => c.type === type || c.type === 'both');

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  }

  function getSplitsTotal() {
    return splits.reduce((s, sp) => s + (sp.percentage || 0), 0);
  }

  function isSplitsValid() {
    const meaningful = splits.filter(sp => sp.category_id);
    if (meaningful.length <= 1) return true; // single/no category — no % constraint
    return Math.abs(getSplitsTotal() - 100) < 0.01;
  }

  async function handleSave() {
    const amountNum = parseFloat(amount);
    if (!accountId) { setError('Select an account'); return; }
    if (isNaN(amountNum) || amountNum <= 0) { setError('Enter a valid amount'); return; }
    if (!date) { setError('Date is required'); return; }
    if (!isSplitsValid()) { setError('Category percentages must add up to 100%'); return; }

    setSaving(true);
    setError('');
    try {
      // Determine primary category (first non-empty split)
      const meaningfulSplits = splits.filter(sp => sp.category_id);
      const primaryCategory = meaningfulSplits[0]?.category_id ?? '';

      // Build category_splits payload only when more than one meaningful split
      const categorySplitsPayload = meaningfulSplits.length > 1
        ? JSON.stringify(meaningfulSplits)
        : null;

      const formData = new FormData();
      formData.append('bank_account', accountId);
      formData.append('type', type);
      formData.append('amount', amountNum.toString());
      formData.append('currency', currency);
      if (feeAmount && !isNaN(parseFloat(feeAmount))) formData.append('fee_amount', feeAmount);
      if (primaryCategory) formData.append('category', primaryCategory);
      if (categorySplitsPayload) formData.append('category_splits', categorySplitsPayload);
      if (tags.length > 0) formData.append('tags', JSON.stringify(tags));
      if (description.trim()) formData.append('description', description.trim());
      formData.append('status', status);
      formData.append('date', date + ' 00:00:00');
      if (status === 'pending' && expectedClearDate) formData.append('expected_clear_date', expectedClearDate + ' 00:00:00');
      formData.append('created_by', userId);
      if (receiptFile) formData.append('receipt_file', receiptFile);

      await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).create(formData);

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

          {/* Category with splits */}
          <div className="p-3 bg-[var(--card-hover)] rounded-lg">
            <CategorySplitEditor
              splits={splits}
              onChange={setSplits}
              filteredCategories={filteredCategories}
            />
            {splits.length > 1 && (
              <p className="text-[10px] text-[var(--muted)] mt-2">
                Splits let you attribute this {type} across multiple categories by percentage. E.g. 60% SaaS Tools, 40% Marketing.
              </p>
            )}
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
