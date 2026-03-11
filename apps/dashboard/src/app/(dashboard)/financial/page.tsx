'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus, Download, RefreshCw, Wallet, Search, ChevronDown, Sparkles, Trash2, Pencil, Check, X,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import {
  COLLECTIONS,
  type BankAccount,
  type FinTransaction,
  type FinCategory,
  type RecurringTransaction,
  type SupportedCurrency,
} from '@/lib/types';
import { useExchangeRates, SUPPORTED_CURRENCIES, CURRENCY_SYMBOLS, CURRENCY_LABELS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';

// Components
import { AccountCard } from '@/components/financial/account-card';
import { AddAccountModal } from '@/components/financial/add-account-modal';
import { AdjustBalanceModal } from '@/components/financial/adjust-balance-modal';
import { AddTransactionModal } from '@/components/financial/add-transaction-modal';
import { TransactionList } from '@/components/financial/transaction-list';
import { CurrencyTooltip } from '@/components/financial/currency-tooltip';
import { CashFlowChart } from '@/components/financial/cash-flow-chart';
import { ExpenseBreakdownChart } from '@/components/financial/expense-breakdown-chart';
import { ForecastWidget } from '@/components/financial/forecast-widget';
import { RecentTransactionsQuickView } from '@/components/financial/recent-transactions-quick-view';
import { RecurringManager } from '@/components/financial/recurring-manager';
import { ExportModal } from '@/components/financial/export-modal';
import { PartnerStackPanel } from '@/components/financial/partnerstack-panel';
import { InvoiceUploadModal } from '@/components/financial/invoice-upload-modal';
import { usePartnerstack } from '@/hooks/use-partnerstack';

type Tab = 'overview' | 'transactions' | 'accounts' | 'recurring' | 'partnerstack';

// ─── Recurring helpers ────────────────────────────────────────────────────────
function addFrequency(date: Date, frequency: RecurringTransaction['frequency']): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'daily':   d.setDate(d.getDate() + 1); break;
    case 'weekly':  d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly':  d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

// ─── Category colour palettes ─────────────────────────────────────────────────
const EXPENSE_COLORS = [
  '#dc2626', '#b91c1c', '#991b1b', // reds
  '#9f1239', '#be123c', '#e11d48', // roses
  '#c026d3', '#a21caf', '#86198f', // fuchsias
  '#7e22ce', '#6b21a8', '#4c1d95', // purples
];
const INCOME_COLORS = [
  '#16a34a', '#15803d', '#166534', // greens
  '#22c55e', '#4ade80', '#86efac', // light greens
  '#10b981', '#059669', '#047857', // emeralds
  '#14b8a6', '#0d9488', '#0f766e', // teals
];
const BOTH_COLORS = [
  '#6366f1', '#3b82f6', '#0ea5e9', // indigo/blue/sky
  '#f59e0b', '#f97316', '#fb923c', // ambers/oranges
  '#8b5cf6', '#a855f7', '#ec4899', // violet/purple/pink
  '#84cc16', '#06b6d4', '#10b981', // lime/cyan/emerald
];

function defaultColorForType(t: 'income' | 'expense' | 'both') {
  if (t === 'expense') return EXPENSE_COLORS[0];
  if (t === 'income') return INCOME_COLORS[0];
  return BOTH_COLORS[0];
}

// ─── Inline colour picker used in CategoryManager ─────────────────────────────
function CategoryColorPicker({
  color, onChange, type,
}: {
  color: string;
  onChange: (c: string) => void;
  type: 'income' | 'expense' | 'both';
}) {
  const palette = type === 'expense' ? EXPENSE_COLORS : type === 'income' ? INCOME_COLORS : BOTH_COLORS;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {palette.map(c => (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            className={cn(
              'w-5 h-5 rounded-full transition-all border-2',
              color === c ? 'border-[var(--foreground)] scale-110' : 'border-transparent opacity-75 hover:opacity-100 hover:scale-105',
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <label className="w-5 h-5 rounded-full border-2 border-dashed border-[var(--card-border)] cursor-pointer flex items-center justify-center hover:border-[var(--foreground)] transition-colors" title="Custom colour">
          <span className="text-[8px] text-[var(--muted)]">+</span>
          <input type="color" value={color} onChange={e => onChange(e.target.value)} className="hidden" />
        </label>
      </div>
      {color && (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-[10px] text-[var(--muted)] font-mono">{color}</span>
        </div>
      )}
    </div>
  );
}

// ─── Category Manager (inline, lightweight) ───────────────────────────────────
function CategoryManager({
  categories,
  transactions,
  primaryCurrency,
  userId,
  onRefresh,
}: {
  categories: FinCategory[];
  transactions: FinTransaction[];
  primaryCurrency: SupportedCurrency;
  userId: string;
  onRefresh: () => void;
}) {
  const { convert } = useExchangeRates();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense' | 'both'>('expense');
  const [color, setColor] = useState(defaultColorForType('expense'));
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState<SupportedCurrency>('USD');
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<'income' | 'expense' | 'both'>('expense');
  const [editColor, setEditColor] = useState('');
  const [editBudgetLimit, setEditBudgetLimit] = useState('');
  const [editBudgetCurrency, setEditBudgetCurrency] = useState<SupportedCurrency>('USD');
  const [editSaving, setEditSaving] = useState(false);

  // ── Spending per category (current month, cleared expenses) ──────────────
  const catSym = CURRENCY_SYMBOLS[primaryCurrency];
  const monthStartStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);

  const spendingByCategory = useMemo(() => {
    const result: Record<string, number> = {};
    for (const txn of transactions) {
      const dateStr = txn.date.split(' ')[0];
      if (dateStr < monthStartStr || txn.type !== 'expense' || txn.status !== 'cleared') continue;
      const base = convert(txn.amount + (txn.fee_amount ?? 0), txn.currency, primaryCurrency);
      const splits = txn.category_splits;
      if (splits && splits.length > 1) {
        for (const sp of splits) {
          if (!sp.category_id) continue;
          result[sp.category_id] = (result[sp.category_id] ?? 0) + base * (sp.percentage / 100);
        }
      } else if (txn.category) {
        result[txn.category] = (result[txn.category] ?? 0) + base;
      }
    }
    return result;
  }, [transactions, convert, primaryCurrency, monthStartStr]);

  // ── Group categories by prefix before " - " ───────────────────────────────
  const groupedCategories = useMemo(() => {
    const grouped: Record<string, FinCategory[]> = {};
    const order: string[] = [];
    for (const cat of categories) {
      const dashIdx = cat.name.indexOf(' - ');
      const group = dashIdx > 0 ? cat.name.slice(0, dashIdx) : '';
      if (!grouped[group]) { grouped[group] = []; order.push(group); }
      grouped[group].push(cat);
    }
    return order.map(g => ({ groupName: g, cats: grouped[g] }));
  }, [categories]);

  function startEdit(cat: FinCategory) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditType(cat.type as 'income' | 'expense' | 'both');
    setEditColor(cat.color || defaultColorForType(cat.type as 'income' | 'expense' | 'both'));
    setEditBudgetLimit(cat.budget_limit ? String(cat.budget_limit) : '');
    setEditBudgetCurrency((cat.budget_currency as SupportedCurrency) || 'USD');
    setAdding(false); // close add form if open
  }

  function cancelEdit() { setEditingId(null); }

  function handleTypeChange(t: 'income' | 'expense' | 'both') {
    setType(t);
    setColor(prev => {
      const expDefault = EXPENSE_COLORS.includes(prev);
      const incDefault = INCOME_COLORS.includes(prev);
      const bothDefault = BOTH_COLORS.includes(prev);
      if (expDefault || incDefault || bothDefault) return defaultColorForType(t);
      return prev;
    });
  }

  function handleEditTypeChange(t: 'income' | 'expense' | 'both') {
    setEditType(t);
    setEditColor(prev => {
      const expDefault = EXPENSE_COLORS.includes(prev);
      const incDefault = INCOME_COLORS.includes(prev);
      const bothDefault = BOTH_COLORS.includes(prev);
      if (expDefault || incDefault || bothDefault) return defaultColorForType(t);
      return prev;
    });
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await pb.collection(COLLECTIONS.FIN_CATEGORIES).create({
        name: name.trim(), type, color,
        budget_limit: budgetLimit ? parseFloat(budgetLimit) : null,
        budget_currency: budgetCurrency,
        created_by: userId,
      });
      setName(''); setBudgetLimit(''); setAdding(false);
      setColor(defaultColorForType(type));
      onRefresh();
    } finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!editName.trim() || !editingId) return;
    setEditSaving(true);
    try {
      await pb.collection(COLLECTIONS.FIN_CATEGORIES).update(editingId, {
        name: editName.trim(),
        type: editType,
        color: editColor,
        budget_limit: editBudgetLimit ? parseFloat(editBudgetLimit) : null,
        budget_currency: editBudgetCurrency,
      });
      setEditingId(null);
      onRefresh();
    } finally { setEditSaving(false); }
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category?')) return;
    await pb.collection(COLLECTIONS.FIN_CATEGORIES).delete(id);
    onRefresh();
  }

  const typeLabel: Record<string, string> = { expense: 'Expense', income: 'Income', both: 'Both' };

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Categories</h3>
        <button
          onClick={() => { setAdding(a => !a); setEditingId(null); }}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90"
        >
          <Plus size={12} />{adding ? 'Cancel' : 'Add'}
        </button>
      </div>

      {adding && (
        <div className="mb-4 space-y-3 p-3 bg-[var(--card-hover)] rounded-lg">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
          <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--background)]">
            {(['expense', 'income', 'both'] as const).map(t => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={cn(
                  'flex-1 py-1.5 text-xs rounded-md font-medium capitalize transition-all',
                  type === t
                    ? t === 'income' ? 'bg-[var(--success)] text-white'
                    : t === 'expense' ? 'bg-[var(--error)] text-white'
                    : 'bg-[var(--foreground)] text-[var(--background)]'
                    : 'text-[var(--muted)] hover:bg-[var(--card-hover)]',
                )}
              >
                {typeLabel[t]}
              </button>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-medium text-[var(--muted)] mb-1.5">
              {type === 'expense' ? 'Suggested colours — dark & red tones' : type === 'income' ? 'Suggested colours — green & bright tones' : 'Suggested colours'}
            </p>
            <CategoryColorPicker color={color} onChange={setColor} type={type} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={budgetLimit} onChange={e => setBudgetLimit(e.target.value)} placeholder="Budget limit (optional)" className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
            <select value={budgetCurrency} onChange={e => setBudgetCurrency(e.target.value as SupportedCurrency)} className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg">
              {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={save} disabled={saving || !name.trim()} className="w-full py-2 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg disabled:opacity-50 font-medium">
            {saving ? 'Saving…' : 'Save Category'}
          </button>
        </div>
      )}

      {categories.length === 0 ? (
        <p className="text-xs text-[var(--muted)] text-center py-4">No categories yet</p>
      ) : (
        <div className="space-y-3">
          {groupedCategories.map(({ groupName, cats }) => {
            const groupSpend = cats.reduce((s, c) => s + (spendingByCategory[c.id] ?? 0), 0);
            const isGroup = groupName !== '' && cats.length > 1;
            return (
              <div key={groupName || '__root__'}>
                {/* Group header */}
                {isGroup && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider shrink-0">{groupName}</p>
                    <div className="flex-1 h-px bg-[var(--card-border)]" />
                    {groupSpend > 0 && (
                      <span className="text-[10px] font-semibold text-[var(--error)] tabular-nums shrink-0">
                        {catSym}{groupSpend.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} this month
                      </span>
                    )}
                  </div>
                )}

                <div className={cn('space-y-1', isGroup && 'pl-2.5 border-l-2 border-[var(--card-border)]')}>
                  {cats.map(cat => {
                    const spent = spendingByCategory[cat.id] ?? 0;
                    const displayName = isGroup ? cat.name.slice(groupName.length + 3) : cat.name;
                    return (
                      <div key={cat.id}>
                        {editingId === cat.id ? (
                          /* ── Inline edit form ── */
                          <div className="space-y-3 p-3 bg-[var(--card-hover)] rounded-lg border border-[var(--card-border)]">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wide">Edit Category</span>
                              <button onClick={cancelEdit} className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-border)] transition-all">
                                <X size={12} />
                              </button>
                            </div>
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              placeholder="Category name"
                              autoFocus
                              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                            />
                            <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--background)]">
                              {(['expense', 'income', 'both'] as const).map(t => (
                                <button
                                  key={t}
                                  onClick={() => handleEditTypeChange(t)}
                                  className={cn(
                                    'flex-1 py-1.5 text-xs rounded-md font-medium capitalize transition-all',
                                    editType === t
                                      ? t === 'income' ? 'bg-[var(--success)] text-white'
                                      : t === 'expense' ? 'bg-[var(--error)] text-white'
                                      : 'bg-[var(--foreground)] text-[var(--background)]'
                                      : 'text-[var(--muted)] hover:bg-[var(--card-hover)]',
                                  )}
                                >
                                  {typeLabel[t]}
                                </button>
                              ))}
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-[var(--muted)] mb-1.5">
                                {editType === 'expense' ? 'Suggested colours — dark & red tones' : editType === 'income' ? 'Suggested colours — green & bright tones' : 'Suggested colours'}
                              </p>
                              <CategoryColorPicker color={editColor} onChange={setEditColor} type={editType} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                value={editBudgetLimit}
                                onChange={e => setEditBudgetLimit(e.target.value)}
                                placeholder="Budget limit (optional)"
                                className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                              />
                              <select
                                value={editBudgetCurrency}
                                onChange={e => setEditBudgetCurrency(e.target.value as SupportedCurrency)}
                                className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg"
                              >
                                {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={saveEdit}
                                disabled={editSaving || !editName.trim()}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg disabled:opacity-50 font-medium"
                              >
                                <Check size={11} />{editSaving ? 'Saving…' : 'Save Changes'}
                              </button>
                              <button onClick={cancelEdit} className="px-3 py-2 text-xs border border-[var(--card-border)] rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Read-only row ── */
                          <div className="flex items-center gap-2 text-xs py-1">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || 'var(--muted)' }} />
                            <span className="flex-1 font-medium min-w-0 truncate">{displayName}</span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full border capitalize shrink-0"
                              style={{
                                borderColor: cat.color ? `${cat.color}55` : undefined,
                                color: cat.color || 'var(--muted)',
                                backgroundColor: cat.color ? `${cat.color}18` : undefined,
                              }}
                            >
                              {cat.type}
                            </span>
                            {/* Spending this month */}
                            <span className="text-[10px] tabular-nums shrink-0" style={{ color: spent > 0 ? 'var(--error)' : 'var(--muted)' }}>
                              {catSym}{spent.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                              {cat.budget_limit && (
                                <span className="opacity-50"> /{CURRENCY_SYMBOLS[cat.budget_currency ?? 'USD']}{cat.budget_limit}</span>
                              )}
                            </span>
                            <button
                              onClick={() => startEdit(cat)}
                              className="shrink-0 p-1 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-border)] transition-all duration-150"
                              title="Edit category"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => deleteCategory(cat.id)}
                              className="shrink-0 p-1 rounded-md text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-all duration-150"
                              title="Delete category"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, badge }: { label: string; value: string; sub?: string; color?: string; badge?: { label: string; color: string } }) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[var(--muted)]">{label}</p>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: badge.color, backgroundColor: `${badge.color}18` }}>
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FinancialPage() {
  const { user } = useAuth();
  const { convert, lastUpdated } = useExchangeRates();

  const [tab, setTab] = useState<Tab>('overview');
  const [primaryCurrency, setPrimaryCurrency] = useState<SupportedCurrency>('USD');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showMoreCurrencies, setShowMoreCurrencies] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<30 | 60 | 90>(30);
  const [balanceTags, setBalanceTags] = useState({ bank: true, approvedPS: true, pendingPS: true });
  const [incomeTags, setIncomeTags] = useState({ bank: true, approvedPS: true, pendingPS: true });

  // Data
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<FinTransaction[]>([]);
  const [categories, setCategories] = useState<FinCategory[]>([]);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  // PartnerStack
  const { rewards: psRewards, payouts: psPayouts, loading: psLoading } = usePartnerstack();

  const psKpis = useMemo(() => {
    const totalEarned = psRewards
      .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null)
      .reduce((s, r) => s + convert((r.amount ?? 0) / 100, r.currency as SupportedCurrency, primaryCurrency), 0);
    const pending = psRewards
      .filter(r => ['pending', 'hold'].includes(r.reward_status) && r.amount != null)
      .reduce((s, r) => s + convert((r.amount ?? 0) / 100, r.currency as SupportedCurrency, primaryCurrency), 0);
    return { totalEarned, pending };
  }, [psRewards, convert, primaryCurrency]);

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [adjustAccount, setAdjustAccount] = useState<BankAccount | null>(null);
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [addTxnType, setAddTxnType] = useState<'income' | 'expense'>('expense');
  const [editTransaction, setEditTransaction] = useState<FinTransaction | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [txnSearch, setTxnSearch] = useState('');
  const [txnStatusFilter, setTxnStatusFilter] = useState<'all' | 'pending' | 'cleared'>('all');
  const [txnTypeFilter, setTxnTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [txnAccountFilter, setTxnAccountFilter] = useState<string>('all');
  const [txnCategoryFilter, setTxnCategoryFilter] = useState<string>('all');
  const [txnSortBy, setTxnSortBy] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc');
  const [txnDateFrom, setTxnDateFrom] = useState('');
  const [txnDateTo, setTxnDateTo] = useState('');

  const fetchAll = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [accs, txns, cats, recs] = await Promise.all([
        pb.collection(COLLECTIONS.BANK_ACCOUNTS).getFullList<BankAccount>({ sort: '-created' }),
        pb.collection(COLLECTIONS.FIN_TRANSACTIONS).getFullList<FinTransaction>({ sort: '-date', expand: 'category' }),
        pb.collection(COLLECTIONS.FIN_CATEGORIES).getFullList<FinCategory>({ sort: 'name' }),
        pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).getFullList<RecurringTransaction>({ sort: '-created', expand: 'category' }),
      ]);
      // Auto-generate transactions for due recurring subscriptions
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const todayStr = todayDate.toISOString().split('T')[0];
      let didGenerate = false;

      for (const rec of recs) {
        if (!rec.is_active || !rec.next_run_date) continue;

        const endDate = rec.end_date ? new Date(rec.end_date.split(' ')[0]) : null;
        let nextRun = new Date(rec.next_run_date.split(' ')[0]);
        nextRun.setHours(0, 0, 0, 0);

        let initialApplied = rec.initial_applied ?? false;
        let advanced = false;

        while (nextRun <= todayDate) {
          if (endDate && nextRun > endDate) break;

          const dateStr = nextRun.toISOString().split('T')[0];

          // One-time setup fee on first occurrence
          if (!initialApplied && rec.initial_amount) {
            try {
              await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).create({
                bank_account: rec.bank_account,
                type: rec.type,
                amount: rec.initial_amount,
                currency: rec.currency,
                fee_amount: null,
                category: rec.category || null,
                category_splits: rec.category_splits && rec.category_splits.length > 1 ? rec.category_splits : null,
                description: `${rec.description} (Setup Fee)`,
                status: 'cleared',
                date: dateStr + ' 00:00:00',
                is_recurring: true,
                recurring_id: rec.id,
                created_by: rec.created_by,
              });
              const acc = accs.find(a => a.id === rec.bank_account);
              if (acc) {
                const delta = rec.type === 'income' ? rec.initial_amount : -rec.initial_amount;
                acc.balance += delta;
                await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance });
              }
              initialApplied = true;
            } catch { /* silently skip */ }
          }

          // Regular recurring transaction
          try {
            await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).create({
              bank_account: rec.bank_account,
              type: rec.type,
              amount: rec.amount,
              currency: rec.currency,
              fee_amount: rec.fee_amount || null,
              category: rec.category || null,
              category_splits: rec.category_splits && rec.category_splits.length > 1 ? rec.category_splits : null,
              description: rec.description,
              status: 'cleared',
              date: dateStr + ' 00:00:00',
              is_recurring: true,
              recurring_id: rec.id,
              created_by: rec.created_by,
            });
            const acc = accs.find(a => a.id === rec.bank_account);
            if (acc) {
              const delta = rec.type === 'income' ? rec.amount : -(rec.amount + (rec.fee_amount ?? 0));
              acc.balance += delta;
              await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance });
            }
          } catch { /* silently skip */ }

          nextRun = addFrequency(nextRun, rec.frequency);
          advanced = true;
        }

        // Persist updated next_run_date and initial_applied
        if (advanced || initialApplied !== (rec.initial_applied ?? false)) {
          try {
            const updates: Record<string, unknown> = {};
            if (advanced) updates.next_run_date = nextRun.toISOString().split('T')[0] + ' 00:00:00';
            if (initialApplied !== (rec.initial_applied ?? false)) updates.initial_applied = true;
            await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).update(rec.id, updates);
            didGenerate = true;
          } catch { /* silently skip */ }
        }
      }

      // If we generated any transactions, re-fetch fresh data so UI reflects them
      if (didGenerate) {
        const [freshAccs, freshTxns, freshRecs] = await Promise.all([
          pb.collection(COLLECTIONS.BANK_ACCOUNTS).getFullList<BankAccount>({ sort: '-created' }),
          pb.collection(COLLECTIONS.FIN_TRANSACTIONS).getFullList<FinTransaction>({ sort: '-date', expand: 'category' }),
          pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).getFullList<RecurringTransaction>({ sort: '-created', expand: 'category' }),
        ]);
        setAccounts(freshAccs);
        setTransactions(freshTxns);
        setRecurring(freshRecs);
        setCategories(cats);
        return;
      }

      setAccounts(accs);
      setCategories(cats);
      setRecurring(recs);
      setTransactions(txns);

      // Auto-clear pending transactions whose expected_clear_date has passed
      const toApprove = txns.filter(t =>
        t.status === 'pending' && t.expected_clear_date && t.expected_clear_date.split(' ')[0] <= todayStr
      );
      for (const txn of toApprove) {
        const acc = accs.find(a => a.id === txn.bank_account);
        try {
          await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).update(txn.id, { status: 'cleared' });
          if (acc) {
            const delta = txn.type === 'income' ? txn.amount : -(txn.amount + (txn.fee_amount ?? 0));
            await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance + delta });
          }
        } catch { /* silently skip */ }
      }
    } catch (e) {
      console.error('Financial fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Computed KPIs
  const totalBalance = useMemo(() =>
    accounts.filter(a => a.is_active !== false)
      .reduce((sum, a) => sum + convert(a.balance, a.currency, primaryCurrency), 0),
    [accounts, convert, primaryCurrency]
  );

  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const monthlyIncome = useMemo(() =>
    transactions
      .filter(t => t.type === 'income' && t.status === 'cleared' && t.date.split(' ')[0] >= thisMonthStart)
      .reduce((sum, t) => sum + convert(t.amount, t.currency, primaryCurrency), 0),
    [transactions, convert, primaryCurrency, thisMonthStart]
  );

  const monthlyExpenses = useMemo(() =>
    transactions
      .filter(t => t.type === 'expense' && t.status === 'cleared' && t.date.split(' ')[0] >= thisMonthStart)
      .reduce((sum, t) => sum + convert(t.amount + (t.fee_amount ?? 0), t.currency, primaryCurrency), 0),
    [transactions, convert, primaryCurrency, thisMonthStart]
  );

  const pendingRevenue = useMemo(() =>
    transactions
      .filter(t => t.type === 'income' && t.status === 'pending')
      .reduce((sum, t) => sum + convert(t.amount, t.currency, primaryCurrency), 0),
    [transactions, convert, primaryCurrency]
  );

  const monthlyApprovedPS = useMemo(() =>
    psRewards
      .filter(r => ['approved', 'paid'].includes(r.reward_status) && r.amount != null &&
        new Date(r.created_at).toISOString().split('T')[0] >= thisMonthStart)
      .reduce((s, r) => s + convert((r.amount ?? 0) / 100, r.currency as SupportedCurrency, primaryCurrency), 0),
    [psRewards, convert, primaryCurrency, thisMonthStart]
  );

  const monthlyPendingPS = useMemo(() =>
    psRewards
      .filter(r => ['pending', 'hold'].includes(r.reward_status) && r.amount != null &&
        new Date(r.created_at).toISOString().split('T')[0] >= thisMonthStart)
      .reduce((s, r) => s + convert((r.amount ?? 0) / 100, r.currency as SupportedCurrency, primaryCurrency), 0),
    [psRewards, convert, primaryCurrency, thisMonthStart]
  );

  const displayedTotalBalance =
    (balanceTags.bank ? totalBalance : 0) +
    (balanceTags.approvedPS ? psKpis.totalEarned : 0) +
    (balanceTags.pendingPS ? psKpis.pending : 0);

  const displayedMonthlyIncome =
    (incomeTags.bank ? monthlyIncome : 0) +
    (incomeTags.approvedPS ? monthlyApprovedPS : 0) +
    (incomeTags.pendingPS ? monthlyPendingPS : 0);

  const savingsRate = useMemo(() => {
    if (monthlyIncome <= 0) return null;
    const net = monthlyIncome - monthlyExpenses;
    return Math.round((net / monthlyIncome) * 100);
  }, [monthlyIncome, monthlyExpenses]);

  // Filtered + sorted transactions for Transactions tab
  const filteredTxns = useMemo(() => {
    const base = transactions.filter(t => {
      if (txnTypeFilter !== 'all' && t.type !== txnTypeFilter) return false;
      if (txnStatusFilter !== 'all' && t.status !== txnStatusFilter) return false;
      if (txnAccountFilter !== 'all' && t.bank_account !== txnAccountFilter) return false;
      if (txnCategoryFilter !== 'all') {
        const matchesPrimary = t.category === txnCategoryFilter;
        const matchesSplit = t.category_splits?.some(sp => sp.category_id === txnCategoryFilter);
        if (!matchesPrimary && !matchesSplit) return false;
      }
      // Date range filter
      const txnDate = t.date.split(' ')[0];
      if (txnDateFrom && txnDate < txnDateFrom) return false;
      if (txnDateTo && txnDate > txnDateTo) return false;
      if (txnSearch) {
        const q = txnSearch.toLowerCase();
        const cat = categories.find(c => c.id === t.category);
        const acc = accounts.find(a => a.id === t.bank_account);
        const splitCatNames = t.category_splits
          ? t.category_splits.map(sp => categories.find(c => c.id === sp.category_id)?.name ?? '').join(' ').toLowerCase()
          : '';
        // Also allow searching by ID prefix and amount
        const amountStr = t.amount.toString();
        if (
          !(t.description?.toLowerCase().includes(q)) &&
          !(cat?.name.toLowerCase().includes(q)) &&
          !(acc?.name.toLowerCase().includes(q)) &&
          !splitCatNames.includes(q) &&
          !t.id.toLowerCase().startsWith(q) &&
          !amountStr.startsWith(q) &&
          !(Array.isArray(t.tags) && t.tags.some(tag => tag.toLowerCase().includes(q)))
        ) return false;
      }
      return true;
    });

    return base.sort((a, b) => {
      switch (txnSortBy) {
        case 'date-asc':  return a.date.localeCompare(b.date);
        case 'amount-desc': return b.amount - a.amount;
        case 'amount-asc':  return a.amount - b.amount;
        default: return b.date.localeCompare(a.date); // date-desc
      }
    });
  }, [transactions, txnTypeFilter, txnStatusFilter, txnAccountFilter, txnCategoryFilter, txnSearch, txnSortBy, txnDateFrom, txnDateTo, categories, accounts]);

  // Aggregated stats for the filtered set (converted to primary currency)
  const filteredStats = useMemo(() => {
    const income = filteredTxns
      .filter(t => t.type === 'income' && t.status === 'cleared')
      .reduce((s, t) => s + convert(t.amount, t.currency, primaryCurrency), 0);
    const expense = filteredTxns
      .filter(t => t.type === 'expense' && t.status === 'cleared')
      .reduce((s, t) => s + convert(t.amount + (t.fee_amount ?? 0), t.currency, primaryCurrency), 0);
    const pending = filteredTxns.filter(t => t.status === 'pending').length;
    return { income, expense, net: income - expense, pending };
  }, [filteredTxns, convert, primaryCurrency]);

  const sym = CURRENCY_SYMBOLS[primaryCurrency];

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'recurring', label: 'Recurring' },
    { id: 'partnerstack', label: 'PartnerStack' },
  ];

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[var(--background)] p-6">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Financial Overview</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            {accounts.filter(a => a.is_active !== false).length} active accounts
            {lastUpdated && <span className="ml-1">· Rates updated {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Global chart period selector */}
          <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
            {([30, 60, 90] as const).map(p => (
              <button key={p} onClick={() => setChartPeriod(p)}
                className={`px-2.5 py-1.5 text-xs rounded-md transition-all ${chartPeriod === p ? 'bg-[var(--foreground)] text-[var(--background)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'}`}
              >
                {p}d
              </button>
            ))}
          </div>
          {/* Primary currency selector */}
          <div className="relative flex items-center gap-1">
            {(['USD', 'PKR'] as SupportedCurrency[]).map(c => (
              <button
                key={c}
                onClick={() => { setPrimaryCurrency(c); setShowCurrencyPicker(false); setShowMoreCurrencies(false); }}
                className={cn(
                  'px-3 py-2 text-xs font-medium border rounded-lg transition-colors',
                  primaryCurrency === c
                    ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]'
                    : 'bg-[var(--card-bg)] border-[var(--card-border)] hover:bg-[var(--card-hover)]',
                )}
              >
                {c}
              </button>
            ))}
            <button
              onClick={() => { setShowCurrencyPicker(p => !p); setShowMoreCurrencies(true); }}
              className={cn(
                'flex items-center gap-1 px-3 py-2 text-xs border rounded-lg transition-colors',
                !['USD', 'PKR'].includes(primaryCurrency)
                  ? 'bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)]'
                  : 'bg-[var(--card-bg)] border-[var(--card-border)] hover:bg-[var(--card-hover)]',
              )}
            >
              {!['USD', 'PKR'].includes(primaryCurrency) ? primaryCurrency : 'More'}
              <ChevronDown size={12} />
            </button>
            {showCurrencyPicker && showMoreCurrencies && (
              <div className="absolute right-0 top-10 z-20 w-52 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl py-1 max-h-64 overflow-y-auto">
                {SUPPORTED_CURRENCIES.filter(c => !['USD', 'PKR'].includes(c)).map(c => (
                  <button
                    key={c}
                    onClick={() => { setPrimaryCurrency(c); setShowCurrencyPicker(false); }}
                    className={cn('w-full text-left px-3 py-2 text-xs hover:bg-[var(--card-hover)] flex justify-between', c === primaryCurrency && 'font-semibold')}
                  >
                    <span>{c}</span><span className="text-[var(--muted)]">{CURRENCY_LABELS[c]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowInvoiceUpload(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, #080e1f 0%, #0b1428 100%)',
              borderColor: '#1a3060',
              color: '#5aabff',
              boxShadow: '0 0 12px rgba(77,159,255,0.18), inset 0 1px 0 rgba(90,171,255,0.08)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 22px rgba(77,159,255,0.38), inset 0 1px 0 rgba(90,171,255,0.12)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a4e9a';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 12px rgba(77,159,255,0.18), inset 0 1px 0 rgba(90,171,255,0.08)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#1a3060';
            }}
          >
            <Sparkles size={14} style={{ color: '#5aabff', filter: 'drop-shadow(0 0 4px rgba(90,171,255,0.7))' }} />
            Upload Invoice
          </button>
          <button
            onClick={() => { setShowAddTxn(true); setAddTxnType('income'); }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, #071408 0%, #0a1c0c 100%)',
              borderColor: '#1a4020',
              color: '#2dde6e',
              boxShadow: '0 0 12px rgba(34,197,94,0.18), inset 0 1px 0 rgba(45,222,110,0.08)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 22px rgba(34,197,94,0.38), inset 0 1px 0 rgba(45,222,110,0.12)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a6030';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 12px rgba(34,197,94,0.18), inset 0 1px 0 rgba(45,222,110,0.08)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#1a4020';
            }}
          >
            <Plus size={14} style={{ color: '#2dde6e', filter: 'drop-shadow(0 0 4px rgba(45,222,110,0.7))' }} />
            Income
          </button>
          <button
            onClick={() => { setShowAddTxn(true); setAddTxnType('expense'); }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, #130608 0%, #1c0a0d 100%)',
              borderColor: '#4a1420',
              color: '#ff4d6a',
              boxShadow: '0 0 12px rgba(255,77,106,0.18), inset 0 1px 0 rgba(255,77,106,0.08)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 22px rgba(255,77,106,0.38), inset 0 1px 0 rgba(255,77,106,0.12)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#6e1e30';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 12px rgba(255,77,106,0.18), inset 0 1px 0 rgba(255,77,106,0.08)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#4a1420';
            }}
          >
            <Plus size={14} style={{ color: '#ff4d6a', filter: 'drop-shadow(0 0 4px rgba(255,77,106,0.7))' }} />
            Expense
          </button>
          <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors bg-[var(--card-bg)]">
            <Download size={14} />Export
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--card-border)]">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
              tab === t.id
                ? 'border-[var(--foreground)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-[var(--muted)]">
          <RefreshCw size={20} className="animate-spin mr-2" />Loading financial data...
        </div>
      ) : (
        <>
          {/* ── OVERVIEW TAB ── */}
          {tab === 'overview' && (
            <div className="space-y-6">
              {/* KPI row */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Total Balance — with toggleable source tags */}
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                    <p className="text-xs text-[var(--muted)]">Total Balance</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {([
                        { key: 'bank' as const, label: 'Bank Accounts' },
                        { key: 'approvedPS' as const, label: 'Approved PS' },
                        { key: 'pendingPS' as const, label: 'Pending PS' },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setBalanceTags(prev => ({ ...prev, [key]: !prev[key] }))}
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-all"
                          style={balanceTags[key]
                            ? { color: key === 'pendingPS' ? 'var(--warning)' : key === 'approvedPS' ? 'var(--primary)' : 'var(--foreground)', borderColor: key === 'pendingPS' ? 'var(--warning)' : key === 'approvedPS' ? 'var(--primary)' : 'var(--card-border)', backgroundColor: key === 'pendingPS' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : key === 'approvedPS' ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'var(--card-hover)' }
                            : { color: 'var(--muted)', borderColor: 'var(--card-border)', opacity: 0.5 }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-2xl font-bold tracking-tight">{sym}{displayedTotalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-1">{accounts.filter(a => a.is_active !== false).length} active accounts · {primaryCurrency}</p>
                </div>

                {/* This Month Income — with toggleable source tags */}
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                    <p className="text-xs text-[var(--muted)]">This Month Income</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {([
                        { key: 'bank' as const, label: 'Bank Accounts' },
                        { key: 'approvedPS' as const, label: 'Approved PS' },
                        { key: 'pendingPS' as const, label: 'Pending PS' },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setIncomeTags(prev => ({ ...prev, [key]: !prev[key] }))}
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-all"
                          style={incomeTags[key]
                            ? { color: key === 'pendingPS' ? 'var(--warning)' : key === 'approvedPS' ? 'var(--primary)' : 'var(--success)', borderColor: key === 'pendingPS' ? 'var(--warning)' : key === 'approvedPS' ? 'var(--primary)' : 'var(--success)', backgroundColor: key === 'pendingPS' ? 'color-mix(in srgb, var(--warning) 15%, transparent)' : key === 'approvedPS' ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'color-mix(in srgb, var(--success) 15%, transparent)' }
                            : { color: 'var(--muted)', borderColor: 'var(--card-border)', opacity: 0.5 }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-2xl font-bold tracking-tight" style={{ color: 'var(--success)' }}>{sym}{displayedMonthlyIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-[11px] text-[var(--muted)] mt-1">Cleared + selected sources</p>
                </div>

                <KpiCard
                  label="This Month Expenses"
                  value={`${sym}${monthlyExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub="Including fees"
                  color="var(--error)"
                />
                <KpiCard
                  label="Savings Rate"
                  value={savingsRate === null ? '—' : `${savingsRate}%`}
                  sub={savingsRate === null ? 'No income this month' : savingsRate >= 0 ? 'Of income saved this month' : 'Spending exceeds income'}
                  color={savingsRate === null ? undefined : savingsRate >= 20 ? 'var(--success)' : savingsRate >= 0 ? 'var(--warning)' : 'var(--error)'}
                  badge={savingsRate !== null ? {
                    label: savingsRate >= 20 ? 'Healthy' : savingsRate >= 0 ? 'Watch' : 'Deficit',
                    color: savingsRate >= 20 ? 'var(--success)' : savingsRate >= 0 ? 'var(--warning)' : 'var(--error)',
                  } : undefined}
                />

                {/* Pending Revenue — split 50/50: PS Pending | Other Pending */}
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 col-span-2 lg:col-span-2">
                  <p className="text-xs text-[var(--muted)] mb-3">Pending Revenue</p>
                  <div className="grid grid-cols-2 gap-4 divide-x divide-[var(--card-border)]">
                    <div>
                      <p className="text-[10px] text-[var(--muted)] mb-1 font-medium uppercase tracking-wide">PS Pending Approval</p>
                      <p className="text-xl font-bold tracking-tight" style={{ color: 'var(--warning)' }}>
                        {psLoading ? '…' : `${sym}${psKpis.pending.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </p>
                      <p className="text-[11px] text-[var(--muted)] mt-1">PartnerStack awaiting approval</p>
                    </div>
                    <div className="pl-4">
                      <p className="text-[10px] text-[var(--muted)] mb-1 font-medium uppercase tracking-wide">Other Pending Income</p>
                      <p className="text-xl font-bold tracking-tight" style={{ color: 'var(--warning)' }}>
                        {sym}{pendingRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-[11px] text-[var(--muted)] mt-1">Transactions awaiting clearance</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <CashFlowChart transactions={transactions} primaryCurrency={primaryCurrency} psRewards={psRewards} accounts={accounts} period={chartPeriod} />
                </div>
                <ExpenseBreakdownChart transactions={transactions} categories={categories} primaryCurrency={primaryCurrency} period={chartPeriod} />
              </div>

              {/* Forecast + Budget row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ForecastWidget
                  accounts={accounts}
                  transactions={transactions}
                  recurringTransactions={recurring}
                  primaryCurrency={primaryCurrency}
                />
                <RecentTransactionsQuickView transactions={transactions} categories={categories} primaryCurrency={primaryCurrency} />
              </div>
            </div>
          )}

          {/* ── TRANSACTIONS TAB ── */}
          {tab === 'transactions' && (
            <div className="space-y-4">
              {/* Filter row 1: Search + Type + Status */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-48">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    value={txnSearch}
                    onChange={e => setTxnSearch(e.target.value)}
                    placeholder="Search by description, category, account, tag, or ID…"
                    className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                  />
                </div>
                <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--card-bg)]">
                  {(['all', 'income', 'expense'] as const).map(f => (
                    <button key={f} onClick={() => setTxnTypeFilter(f)} className={cn('px-3 py-1.5 text-xs rounded-md capitalize transition-all', txnTypeFilter === f ? 'bg-[var(--foreground)] text-[var(--background)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]')}>{f}</button>
                  ))}
                </div>
                <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--card-bg)]">
                  {(['all', 'cleared', 'pending'] as const).map(f => (
                    <button key={f} onClick={() => setTxnStatusFilter(f)} className={cn('px-3 py-1.5 text-xs rounded-md capitalize transition-all', txnStatusFilter === f ? 'bg-[var(--foreground)] text-[var(--background)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--card-hover)]')}>{f}</button>
                  ))}
                </div>
              </div>

              {/* Filter row 2: Account + Category + Date Range + Sort */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={txnAccountFilter}
                  onChange={e => setTxnAccountFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                >
                  <option value="all">All accounts</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select
                  value={txnCategoryFilter}
                  onChange={e => setTxnCategoryFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                >
                  <option value="all">All categories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={txnDateFrom}
                    onChange={e => setTxnDateFrom(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                    title="From date"
                  />
                  <span className="text-[10px] text-[var(--muted)]">to</span>
                  <input
                    type="date"
                    value={txnDateTo}
                    onChange={e => setTxnDateTo(e.target.value)}
                    className="px-2 py-1.5 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                    title="To date"
                  />
                </div>
                <select
                  value={txnSortBy}
                  onChange={e => setTxnSortBy(e.target.value as typeof txnSortBy)}
                  className="px-3 py-1.5 text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="amount-desc">Highest amount</option>
                  <option value="amount-asc">Lowest amount</option>
                </select>
                {(txnAccountFilter !== 'all' || txnCategoryFilter !== 'all' || txnTypeFilter !== 'all' || txnStatusFilter !== 'all' || txnSearch || txnDateFrom || txnDateTo) && (
                  <button
                    onClick={() => { setTxnAccountFilter('all'); setTxnCategoryFilter('all'); setTxnTypeFilter('all'); setTxnStatusFilter('all'); setTxnSearch(''); setTxnSortBy('date-desc'); setTxnDateFrom(''); setTxnDateTo(''); }}
                    className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors px-2 py-1.5 border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)]"
                  >
                    Clear filters
                  </button>
                )}
                <p className="text-xs text-[var(--muted)] ml-auto">{filteredTxns.length} transactions</p>
              </div>

              {/* Stats row for filtered results */}
              {filteredTxns.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-4 py-3">
                    <p className="text-[11px] text-[var(--muted)] mb-1">Cleared Income</p>
                    <p className="text-sm font-bold text-[var(--success)]">
                      +{sym}{filteredStats.income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-4 py-3">
                    <p className="text-[11px] text-[var(--muted)] mb-1">Cleared Expenses</p>
                    <p className="text-sm font-bold text-[var(--error)]">
                      -{sym}{filteredStats.expense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-4 py-3">
                    <p className="text-[11px] text-[var(--muted)] mb-1">
                      Net · {filteredStats.pending > 0 ? `${filteredStats.pending} pending` : 'cleared only'}
                    </p>
                    <p className={cn('text-sm font-bold', filteredStats.net >= 0 ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                      {filteredStats.net >= 0 ? '+' : ''}{sym}{Math.abs(filteredStats.net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              )}

              <TransactionList
                transactions={filteredTxns}
                accounts={accounts}
                categories={categories}
                onRefresh={fetchAll}
                onEdit={txn => { setEditTransaction(txn); setShowAddTxn(true); }}
                onDuplicate={txn => {
                  // Create a duplicate pre-filled with today's date
                  const dup = {
                    ...txn,
                    id: '',
                    date: new Date().toISOString().split('T')[0] + ' 00:00:00',
                    status: 'cleared' as const,
                    is_recurring: false,
                    recurring_id: undefined,
                    refund_of: undefined,
                    receipt_file: undefined,
                  };
                  setEditTransaction(dup as FinTransaction);
                  setShowAddTxn(true);
                }}
                onRefund={async (txn) => {
                  if (!confirm(`Create a refund for this ${txn.type === 'income' ? 'income' : 'expense'} of ${CURRENCY_SYMBOLS[txn.currency]}${txn.amount}?`)) return;
                  try {
                    const refundType = txn.type === 'income' ? 'expense' : 'income';
                    await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).create({
                      bank_account: txn.bank_account,
                      type: refundType,
                      amount: txn.amount,
                      currency: txn.currency,
                      fee_amount: null,
                      category: txn.category || null,
                      category_splits: txn.category_splits && txn.category_splits.length > 1 ? txn.category_splits : null,
                      tags: txn.tags ? JSON.stringify(txn.tags) : null,
                      description: `Refund: ${txn.description || txn.type}`,
                      status: 'cleared',
                      date: new Date().toISOString().split('T')[0] + ' 00:00:00',
                      created_by: user.id,
                      refund_of: txn.id,
                    });
                    // Update balance
                    const acc = accounts.find(a => a.id === txn.bank_account);
                    if (acc) {
                      const delta = refundType === 'income' ? txn.amount : -(txn.amount);
                      await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance + delta });
                    }
                    fetchAll();
                  } catch (e) {
                    console.error('Refund failed:', e);
                  }
                }}
              />

              {/* PartnerStack rewards inline */}
              {txnTypeFilter !== 'expense' && (() => {
                const q = txnSearch.toLowerCase();
                const filtered = psRewards.filter(r => {
                  if (txnStatusFilter === 'cleared' && !['approved', 'paid'].includes(r.reward_status)) return false;
                  if (txnStatusFilter === 'pending' && !['pending', 'hold'].includes(r.reward_status)) return false;
                  if (q) {
                    const text = [r.description, r.company?.name, r.customer?.name, r.customer?.email].join(' ').toLowerCase();
                    if (!text.includes(q)) return false;
                  }
                  return true;
                }).sort((a, b) => b.created_at - a.created_at);

                if (filtered.length === 0 && !psLoading) return null;

                return (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-1 pt-2">
                      <div className="h-px flex-1 bg-[var(--card-border)]" />
                      <span className="text-[11px] font-medium text-[var(--muted)] px-1">
                        PartnerStack Rewards{psLoading ? ' · loading…' : ` · ${filtered.length}`}
                      </span>
                      <div className="h-px flex-1 bg-[var(--card-border)]" />
                    </div>
                    {filtered.map(r => {
                      const isApproved = ['approved', 'paid'].includes(r.reward_status);
                      const amt = r.amount != null
                        ? (r.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—';
                      const currencySymbol = r.currency
                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: r.currency })
                            .formatToParts(0).find(p => p.type === 'currency')?.value ?? r.currency
                        : '';
                      return (
                        <div key={r.key} className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg flex items-center gap-3 px-4 py-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-[var(--primary)]/10">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {r.description ?? r.company?.name ?? 'PartnerStack Reward'}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--primary)]/30 text-[var(--primary)]">
                                PartnerStack
                              </span>
                              {r.customer?.name && (
                                <span className="text-[11px] text-[var(--muted)] truncate">{r.customer.name}</span>
                              )}
                              <span className="text-[11px] text-[var(--muted)]">·</span>
                              <span className="text-[11px] text-[var(--muted)]">
                                {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-[var(--success)]">+{currencySymbol}{amt}</p>
                            <span className={cn(
                              'text-[10px] font-semibold capitalize',
                              isApproved ? 'text-[var(--success)]' : 'text-[var(--warning)]',
                            )}>
                              {r.reward_status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── ACCOUNTS TAB ── */}
          {tab === 'accounts' && (
            <div className="space-y-6">
              {/* Total balance summary */}
              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Combined Total ({primaryCurrency})</p>
                  <CurrencyTooltip amount={totalBalance} currency={primaryCurrency}>
                    <p className="text-3xl font-bold tracking-tight">
                      {sym}{totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </CurrencyTooltip>
                </div>
                <button
                  onClick={() => { setEditAccount(null); setShowAddAccount(true); }}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 transition-opacity"
                >
                  <Plus size={14} />Add Account
                </button>
              </div>

              {accounts.length === 0 ? (
                <div className="text-center py-16 text-[var(--muted)]">
                  <Wallet size={36} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm mb-3">No accounts yet</p>
                  <button onClick={() => setShowAddAccount(true)} className="px-4 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90">
                    Add your first account
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {accounts.map(acc => (
                    <AccountCard
                      key={acc.id}
                      account={acc}
                      primaryCurrency={primaryCurrency}
                      convertedBalance={convert(acc.balance, acc.currency, primaryCurrency)}
                      onEdit={a => { setEditAccount(a); setShowAddAccount(true); }}
                      onAdjust={setAdjustAccount}
                      onDelete={async (a) => {
                        if (!confirm(`Delete "${a.name}"? This cannot be undone.`)) return;
                        await pb.collection(COLLECTIONS.BANK_ACCOUNTS).delete(a.id);
                        fetchAll();
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Category manager */}
              <CategoryManager categories={categories} transactions={transactions} primaryCurrency={primaryCurrency} userId={user.id} onRefresh={fetchAll} />
            </div>
          )}

          {/* ── RECURRING TAB ── */}
          {tab === 'recurring' && (
            <RecurringManager
              recurring={recurring}
              accounts={accounts}
              categories={categories}
              transactions={transactions}
              primaryCurrency={primaryCurrency}
              userId={user.id}
              onRefresh={fetchAll}
            />
          )}

          {/* ── PARTNERSTACK TAB ── */}
          {tab === 'partnerstack' && (
            <PartnerStackPanel
              rewards={psRewards}
              payouts={psPayouts}
              loading={psLoading}
              onRefresh={() => { /* hook auto-manages */ }}
            />
          )}
        </>
      )}

      {/* Modals */}
      {showAddAccount && (
        <AddAccountModal
          onClose={() => { setShowAddAccount(false); setEditAccount(null); }}
          onSaved={fetchAll}
          editAccount={editAccount}
          userId={user.id}
        />
      )}
      {adjustAccount && (
        <AdjustBalanceModal
          account={adjustAccount}
          userId={user.id}
          onClose={() => setAdjustAccount(null)}
          onSaved={fetchAll}
        />
      )}
      {showAddTxn && (
        <AddTransactionModal
          onClose={() => { setShowAddTxn(false); setEditTransaction(null); }}
          onSaved={fetchAll}
          userId={user.id}
          accounts={accounts}
          categories={categories}
          defaultType={addTxnType}
          editTransaction={editTransaction ?? undefined}
        />
      )}
      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          transactions={transactions}
          accounts={accounts}
          categories={categories}
        />
      )}
      {showInvoiceUpload && (
        <InvoiceUploadModal
          onClose={() => setShowInvoiceUpload(false)}
          onSaved={fetchAll}
          userId={user.id}
          accounts={accounts}
          categories={categories}
        />
      )}
    </div>
  );
}
