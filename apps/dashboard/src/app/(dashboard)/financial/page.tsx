'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus, Download, RefreshCw, Wallet, Search, ChevronDown, Sparkles,
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
import { BudgetProgress } from '@/components/financial/budget-progress';
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

// ─── Category Manager (inline, lightweight) ───────────────────────────────────
function CategoryManager({
  categories,
  userId,
  onRefresh,
}: {
  categories: FinCategory[];
  userId: string;
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'income' | 'expense' | 'both'>('expense');
  const [color, setColor] = useState('#6366f1');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [budgetCurrency, setBudgetCurrency] = useState<SupportedCurrency>('USD');
  const [saving, setSaving] = useState(false);

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
      onRefresh();
    } finally { setSaving(false); }
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category?')) return;
    await pb.collection(COLLECTIONS.FIN_CATEGORIES).delete(id);
    onRefresh();
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Categories</h3>
        <button onClick={() => setAdding(a => !a)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90">
          <Plus size={12} />{adding ? 'Cancel' : 'Add'}
        </button>
      </div>

      {adding && (
        <div className="mb-4 space-y-2 p-3 bg-[var(--card-hover)] rounded-lg">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Category name" className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
          <div className="grid grid-cols-3 gap-2">
            <select value={type} onChange={e => setType(e.target.value as typeof type)} className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="both">Both</option>
            </select>
            <input type="number" value={budgetLimit} onChange={e => setBudgetLimit(e.target.value)} placeholder="Budget limit" className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
            <select value={budgetCurrency} onChange={e => setBudgetCurrency(e.target.value as SupportedCurrency)} className="px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg">
              {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border-0" />
            <button onClick={save} disabled={saving || !name.trim()} className="flex-1 py-1.5 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg disabled:opacity-50">Save</button>
          </div>
        </div>
      )}

      {categories.length === 0 ? (
        <p className="text-xs text-[var(--muted)] text-center py-4">No categories yet</p>
      ) : (
        <div className="space-y-1.5">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-2 text-xs py-1.5 group">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color || 'var(--muted)' }} />
              <span className="flex-1 font-medium">{cat.name}</span>
              <span className="text-[var(--muted)] capitalize text-[10px]">{cat.type}</span>
              {cat.budget_limit && <span className="text-[var(--muted)] text-[10px]">{CURRENCY_SYMBOLS[cat.budget_currency ?? 'USD']}{cat.budget_limit}</span>}
              <button onClick={() => deleteCategory(cat.id)} className="opacity-0 group-hover:opacity-100 text-[var(--error)] hover:opacity-70 transition-opacity text-[10px]">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, trend, color }: { label: string; value: string; sub?: string; trend?: 'up' | 'down' | 'neutral'; color?: string }) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
      <p className="text-xs text-[var(--muted)] mb-2">{label}</p>
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
  const [showExport, setShowExport] = useState(false);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [txnSearch, setTxnSearch] = useState('');
  const [txnStatusFilter, setTxnStatusFilter] = useState<'all' | 'pending' | 'cleared'>('all');
  const [txnTypeFilter, setTxnTypeFilter] = useState<'all' | 'income' | 'expense'>('all');

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

  // Filtered transactions for Transactions tab
  const filteredTxns = useMemo(() => {
    return transactions.filter(t => {
      if (txnTypeFilter !== 'all' && t.type !== txnTypeFilter) return false;
      if (txnStatusFilter !== 'all' && t.status !== txnStatusFilter) return false;
      if (txnSearch) {
        const q = txnSearch.toLowerCase();
        const cat = categories.find(c => c.id === t.category);
        const acc = accounts.find(a => a.id === t.bank_account);
        if (
          !(t.description?.toLowerCase().includes(q)) &&
          !(cat?.name.toLowerCase().includes(q)) &&
          !(acc?.name.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [transactions, txnTypeFilter, txnStatusFilter, txnSearch, categories, accounts]);

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

          <button onClick={() => setShowInvoiceUpload(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--primary)] text-white rounded-lg hover:opacity-90 transition-opacity">
            <Sparkles size={14} />Upload Invoice
          </button>
          <button onClick={() => { setShowAddTxn(true); setAddTxnType('income'); }} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--success)] text-white rounded-lg hover:opacity-90 transition-opacity">
            <Plus size={14} />Income
          </button>
          <button onClick={() => { setShowAddTxn(true); setAddTxnType('expense'); }} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--error)] text-white rounded-lg hover:opacity-90 transition-opacity">
            <Plus size={14} />Expense
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
                <KpiCard
                  label="Total Balance"
                  value={`${sym}${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub={`${accounts.filter(a => a.is_active !== false).length} accounts · ${primaryCurrency}`}
                />
                <KpiCard
                  label="This Month Income"
                  value={`${sym}${monthlyIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub="Cleared transactions"
                  trend="up"
                  color="var(--success)"
                />
                <KpiCard
                  label="This Month Expenses"
                  value={`${sym}${monthlyExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub="Including fees"
                  trend="down"
                  color="var(--error)"
                />
                <KpiCard
                  label="Pending Revenue"
                  value={`${sym}${pendingRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub="Awaiting clearance"
                  color="var(--warning)"
                />
                <KpiCard
                  label="PS Earnings"
                  value={psLoading ? '…' : `${sym}${psKpis.totalEarned.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub={`Approved PartnerStack rewards · ${primaryCurrency}`}
                  color="var(--primary)"
                />
                <KpiCard
                  label="PS Pending"
                  value={psLoading ? '…' : `${sym}${psKpis.pending.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  sub={`Awaiting PartnerStack approval · ${primaryCurrency}`}
                  color="var(--warning)"
                />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <CashFlowChart transactions={transactions} primaryCurrency={primaryCurrency} psRewards={psRewards} accounts={accounts} />
                </div>
                <ExpenseBreakdownChart transactions={transactions} categories={categories} primaryCurrency={primaryCurrency} />
              </div>

              {/* Forecast + Budget row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ForecastWidget
                  accounts={accounts}
                  transactions={transactions}
                  recurringTransactions={recurring}
                  primaryCurrency={primaryCurrency}
                />
                <BudgetProgress transactions={transactions} categories={categories} primaryCurrency={primaryCurrency} />
              </div>
            </div>
          )}

          {/* ── TRANSACTIONS TAB ── */}
          {tab === 'transactions' && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-48">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    value={txnSearch}
                    onChange={e => setTxnSearch(e.target.value)}
                    placeholder="Search transactions..."
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
                <p className="text-xs text-[var(--muted)] ml-auto">{filteredTxns.length} transactions</p>
              </div>

              <TransactionList
                transactions={filteredTxns}
                accounts={accounts}
                categories={categories}
                onRefresh={fetchAll}
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
              <CategoryManager categories={categories} userId={user.id} onRefresh={fetchAll} />
            </div>
          )}

          {/* ── RECURRING TAB ── */}
          {tab === 'recurring' && (
            <RecurringManager
              recurring={recurring}
              accounts={accounts}
              categories={categories}
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
          onClose={() => setShowAddTxn(false)}
          onSaved={fetchAll}
          userId={user.id}
          accounts={accounts}
          categories={categories}
          defaultType={addTxnType}
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
