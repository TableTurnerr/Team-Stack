'use client';

import { useState, useMemo } from 'react';
import { Plus, RefreshCw, Pencil, Trash2, Loader2, X, ToggleLeft, ToggleRight, Link2, TrendingDown } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { RecurringTransaction, BankAccount, FinCategory, SupportedCurrency, CategorySplit, FinTransaction } from '@/lib/types';
import { CURRENCY_SYMBOLS, SUPPORTED_CURRENCIES, useExchangeRates } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface RecurringManagerProps {
  recurring: RecurringTransaction[];
  accounts: BankAccount[];
  categories: FinCategory[];
  transactions?: FinTransaction[];
  primaryCurrency?: SupportedCurrency;
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

// ─── Category Split Editor (inline) ──────────────────────────────────────────
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
    onChange(splits.map((sp, idx) =>
      idx === i ? { ...sp, [field]: field === 'percentage' ? Number(value) : value } : sp,
    ));
  }

  function add() {
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
          <span className={cn(
            'text-[10px] font-semibold tabular-nums',
            isValid ? 'text-[var(--success)]' : total > 100 ? 'text-[var(--error)]' : 'text-[var(--warning)]',
          )}>
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
              <button onClick={() => remove(i)} className="p-1.5 text-[var(--muted)] hover:text-[var(--error)] transition-colors shrink-0">
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

// ─── Recurring Form ───────────────────────────────────────────────────────────
function RecurringForm({ onClose, onSaved, userId, accounts, categories, editItem }: RecurringFormProps) {
  const [type, setType] = useState<'income' | 'expense'>(editItem?.type ?? 'expense');
  const [accountId, setAccountId] = useState(editItem?.bank_account ?? accounts[0]?.id ?? '');
  const [amount, setAmount] = useState(editItem?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState<SupportedCurrency>(editItem?.currency ?? accounts[0]?.currency ?? 'USD');
  const [feeAmount, setFeeAmount] = useState(editItem?.fee_amount?.toString() ?? '');

  // Initialise splits from editItem
  const initialSplits: CategorySplit[] = editItem?.category_splits && editItem.category_splits.length > 0
    ? editItem.category_splits
    : editItem?.category
      ? [{ category_id: editItem.category, percentage: 100 }]
      : [{ category_id: '', percentage: 100 }];
  const [splits, setSplits] = useState<CategorySplit[]>(initialSplits);

  const [description, setDescription] = useState(editItem?.description ?? '');
  const [frequency, setFrequency] = useState<RecurringTransaction['frequency']>(editItem?.frequency ?? 'monthly');
  const [startDate, setStartDate] = useState(editItem?.start_date?.split(' ')[0] ?? new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(editItem?.end_date?.split(' ')[0] ?? '');
  const [initialAmount, setInitialAmount] = useState(editItem?.initial_amount?.toString() ?? '');
  const [renewalAmount, setRenewalAmount] = useState(editItem?.renewal_amount?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredCategories = categories.filter(c => c.type === type || c.type === 'both');

  function isSplitsValid() {
    const meaningful = splits.filter(sp => sp.category_id);
    if (meaningful.length <= 1) return true;
    const total = splits.reduce((s, sp) => s + (sp.percentage || 0), 0);
    return Math.abs(total - 100) < 0.01;
  }

  async function handleSave() {
    const amountNum = parseFloat(amount);
    if (!description.trim()) { setError('Description is required'); return; }
    if (isNaN(amountNum) || amountNum <= 0) { setError('Enter a valid amount'); return; }
    if (!isSplitsValid()) { setError('Category percentages must add up to 100%'); return; }

    setSaving(true);
    setError('');
    try {
      const meaningfulSplits = splits.filter(sp => sp.category_id);
      const primaryCategory = meaningfulSplits[0]?.category_id ?? null;
      const categorySplitsPayload = meaningfulSplits.length > 1 ? meaningfulSplits : null;

      const data: Record<string, unknown> = {
        bank_account: accountId,
        type,
        amount: amountNum,
        currency,
        fee_amount: feeAmount ? parseFloat(feeAmount) : null,
        category: primaryCategory,
        category_splits: categorySplitsPayload,
        description: description.trim(),
        frequency,
        start_date: startDate + ' 00:00:00',
        end_date: endDate ? endDate + ' 00:00:00' : null,
        next_run_date: editItem
          ? editItem.next_run_date ?? startDate + ' 00:00:00'
          : startDate + ' 00:00:00',
        initial_amount: initialAmount ? parseFloat(initialAmount) : null,
        renewal_amount: renewalAmount ? parseFloat(renewalAmount) : null,
        initial_applied: editItem?.initial_applied ?? false,
        is_active: true,
        created_by: userId,
      };

      if (editItem) {
        await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).update(editItem.id, data);
        // Retroactively sync category to all already-generated transactions from this subscription
        try {
          const linked = await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).getFullList<FinTransaction>({
            filter: `recurring_id = "${editItem.id}"`,
          });
          await Promise.all(linked.map(txn =>
            pb.collection(COLLECTIONS.FIN_TRANSACTIONS).update(txn.id, {
              category: primaryCategory,
              category_splits: categorySplitsPayload,
            }),
          ));
        } catch { /* silently skip — non-critical */ }
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
              <button key={t} onClick={() => { setType(t); setSplits([{ category_id: '', percentage: 100 }]); }} className={cn('flex-1 py-2 text-sm rounded-md font-medium capitalize transition-all', type === t ? (t === 'income' ? 'bg-[var(--success)] text-white' : 'bg-[var(--error)] text-white') : 'hover:bg-[var(--card-hover)] text-[var(--muted)]')}>{t}</button>
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
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={initialAmount} onChange={e => setInitialAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
              <div>
                <input type="number" value={renewalAmount} onChange={e => setRenewalAmount(e.target.value)} placeholder={initialAmount ? `Renews at ${initialAmount}` : 'Renewed at'} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
                <p className="text-[10px] text-[var(--muted)] mt-1">Renewed at — leave empty to keep same</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Fee per cycle</label>
            <input type="number" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} placeholder="0.00" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
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
                Splits propagate to every generated transaction — e.g. 60% SaaS Tools, 40% Marketing.
              </p>
            )}
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

// ─── Main Manager ─────────────────────────────────────────────────────────────
export function RecurringManager({ recurring, accounts, categories, transactions = [], primaryCurrency = 'USD', userId, onRefresh }: RecurringManagerProps) {
  const { convert } = useExchangeRates();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<RecurringTransaction | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleDelete(item: RecurringTransaction) {
    if (!confirm(`Delete recurring "${item.description}"? Generated transactions will remain.`)) return;
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
  const sym = CURRENCY_SYMBOLS[primaryCurrency];

  // Monthly spend per recurring rule (from generated transactions this month)
  const monthStartStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);

  const monthlySpendByRule = useMemo(() => {
    const result: Record<string, number> = {};
    for (const txn of transactions) {
      if (!txn.recurring_id || !txn.is_recurring) continue;
      const dateStr = txn.date.split(' ')[0];
      if (dateStr < monthStartStr) continue;
      const base = convert(txn.amount + (txn.fee_amount ?? 0), txn.currency, primaryCurrency);
      result[txn.recurring_id] = (result[txn.recurring_id] ?? 0) + base;
    }
    return result;
  }, [transactions, convert, primaryCurrency, monthStartStr]);

  // Monthly totals summary
  const monthlyExpenseTotal = useMemo(() =>
    recurring.filter(r => r.type === 'expense' && r.is_active).reduce((s, r) => {
      const multiplier = r.frequency === 'daily' ? 30 : r.frequency === 'weekly' ? 4.33 : r.frequency === 'yearly' ? 1 / 12 : 1;
      return s + convert(r.amount, r.currency, primaryCurrency) * multiplier;
    }, 0),
    [recurring, convert, primaryCurrency],
  );

  // Group by income/expense for clarity
  const incomeRecs = recurring.filter(r => r.type === 'income');
  const expenseRecs = recurring.filter(r => r.type === 'expense');

  function RecurringGroup({ items, label }: { items: RecurringTransaction[]; label: string }) {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">{label}</p>
        <div className="space-y-2">
          {items.map(item => {
            const acc = accounts.find(a => a.id === item.bank_account);
            const symbol = CURRENCY_SYMBOLS[item.currency];
            const isIncome = item.type === 'income';
            const thisMonthSpend = monthlySpendByRule[item.id] ?? 0;

            // Resolve category labels (handle splits)
            const splitsData = item.category_splits && item.category_splits.length > 1
              ? item.category_splits
              : item.category
                ? [{ category_id: item.category, percentage: 100 }]
                : [];

            const categoryLabels = splitsData
              .map(sp => {
                const cat = categories.find(c => c.id === sp.category_id);
                if (!cat) return null;
                return { cat, pct: splitsData.length > 1 ? sp.percentage : null };
              })
              .filter(Boolean) as Array<{ cat: FinCategory; pct: number | null }>;

            return (
              <div key={item.id} className={cn('flex items-start gap-3 p-3 rounded-lg border transition-colors', item.is_active ? 'bg-[var(--card-bg)] border-[var(--card-border)]' : 'bg-[var(--card-hover)] border-[var(--card-border)] opacity-60')}>
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5', isIncome ? 'bg-[var(--success-subtle)]' : 'bg-[var(--error-subtle)]')}>
                  <RefreshCw size={14} className={isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]'} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] mt-0.5 flex-wrap">
                    <span>{freqLabel[item.frequency]}</span>
                    {acc && <><span>·</span><span>{acc.name}</span></>}
                    {item.next_run_date && (
                      <><span>·</span><span>Next: {format(new Date(item.next_run_date.split(' ')[0] + 'T12:00:00'), 'MMM d')}</span></>
                    )}
                    {thisMonthSpend > 0 && (
                      <>
                        <span>·</span>
                        <span className={cn('flex items-center gap-0.5 font-medium', isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                          <TrendingDown size={9} />
                          {sym}{thisMonthSpend.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} this month
                        </span>
                      </>
                    )}
                  </div>

                  {/* Category badges */}
                  {categoryLabels.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {categoryLabels.map(({ cat, pct }, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1"
                          style={{
                            borderColor: cat.color ? `${cat.color}55` : undefined,
                            color: cat.color || 'var(--muted)',
                            backgroundColor: cat.color ? `${cat.color}18` : undefined,
                          }}
                        >
                          {cat.name}
                          {pct !== null && <span className="opacity-70">{pct}%</span>}
                        </span>
                      ))}
                      {categoryLabels.length > 1 && (
                        <span className="text-[10px] text-[var(--muted)] flex items-center gap-0.5">
                          <Link2 size={9} />split
                        </span>
                      )}
                    </div>
                  )}

                  {item.initial_amount && !item.initial_applied && (
                    <p className="text-[10px] text-[var(--warning)] mt-0.5">Setup fee {symbol}{item.initial_amount} pending</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="text-right">
                    <p className={cn('text-sm font-bold tabular-nums', isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                      {isIncome ? '+' : '-'}{symbol}{item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {item.amount === 0 && (item.initial_amount || item.renewal_amount) && (
                      <p className="text-[10px] text-[var(--warning)]">amount not set</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
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
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">Recurring Transactions</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Subscriptions & repeating income/expenses
            {recurring.length > 0 && ` · ${recurring.filter(r => r.is_active).length} active, ${recurring.filter(r => !r.is_active).length} paused`}
          </p>
        </div>
        <button onClick={() => { setEditItem(null); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 transition-opacity">
          <Plus size={13} />New
        </button>
      </div>

      {/* Monthly cost summary bar */}
      {recurring.length > 0 && monthlyExpenseTotal > 0 && (
        <div className="flex items-center justify-between px-3 py-2 mb-4 rounded-lg bg-[var(--error-subtle)] border border-[var(--error)]/20">
          <span className="text-[11px] text-[var(--muted)]">Est. monthly recurring cost</span>
          <span className="text-sm font-bold text-[var(--error)] tabular-nums">
            -{sym}{monthlyExpenseTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} /mo
          </span>
        </div>
      )}

      {recurring.length === 0 ? (
        <div className="text-center py-10 text-[var(--muted)]">
          <RefreshCw size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No recurring transactions</p>
        </div>
      ) : (
        <div className="space-y-5">
          <RecurringGroup items={incomeRecs} label="Income" />
          <RecurringGroup items={expenseRecs} label="Expenses" />
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
