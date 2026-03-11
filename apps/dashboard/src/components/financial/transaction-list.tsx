'use client';

import { useState, useCallback } from 'react';
import {
  ArrowUpRight, ArrowDownLeft, Clock, FileText, Tag, ExternalLink, Trash2,
  ChevronDown, ChevronUp, Loader2, Link2, RefreshCw, Copy, Check, Pencil,
  CheckCircle2, AlertCircle, Hash, RotateCcw, CopyPlus,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { FinTransaction, BankAccount, FinCategory } from '@/lib/types';
import { CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import { CurrencyTooltip } from './currency-tooltip';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface TransactionListProps {
  transactions: FinTransaction[];
  accounts: BankAccount[];
  categories: FinCategory[];
  onRefresh: () => void;
  onEdit?: (txn: FinTransaction) => void;
  onDuplicate?: (txn: FinTransaction) => void;
  onRefund?: (txn: FinTransaction) => void;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label ?? text}`}
      className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
    >
      {copied ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
      {label && <span className="text-[10px]">{copied ? 'Copied!' : label}</span>}
    </button>
  );
}

export function TransactionList({ transactions, accounts, categories, onRefresh, onEdit, onDuplicate, onRefund }: TransactionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkClearing, setBulkClearing] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  function getAccount(id: string) { return accounts.find(a => a.id === id); }
  function getCategory(id: string) { return categories.find(c => c.id === id); }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map(t => t.id)));
    }
  }

  async function handleClearPending(txn: FinTransaction, e: React.MouseEvent) {
    e.stopPropagation();
    setClearing(txn.id);
    try {
      await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).update(txn.id, { status: 'cleared' });
      const acc = accounts.find(a => a.id === txn.bank_account);
      if (acc) {
        const delta = txn.type === 'income' ? txn.amount : -(txn.amount + (txn.fee_amount ?? 0));
        await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance + delta });
      }
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setClearing(null);
    }
  }

  async function handleDelete(txn: FinTransaction) {
    if (!confirm(`Delete this ${txn.type} of ${CURRENCY_SYMBOLS[txn.currency]}${txn.amount}?`)) return;
    setDeleting(txn.id);
    try {
      if (txn.status === 'cleared') {
        const acc = accounts.find(a => a.id === txn.bank_account);
        if (acc) {
          const delta = txn.type === 'income' ? -txn.amount : (txn.amount + (txn.fee_amount ?? 0));
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance + delta });
        }
      }
      await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).delete(txn.id);
      setSelected(prev => { const next = new Set(prev); next.delete(txn.id); return next; });
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(null);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (!confirm(`Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const toDelete = transactions.filter(t => ids.includes(t.id));

      const balanceDeltas = new Map<string, number>();
      for (const txn of toDelete) {
        if (txn.status === 'cleared') {
          const delta = txn.type === 'income' ? -txn.amount : (txn.amount + (txn.fee_amount ?? 0));
          balanceDeltas.set(txn.bank_account, (balanceDeltas.get(txn.bank_account) ?? 0) + delta);
        }
      }

      for (const [accId, delta] of balanceDeltas) {
        const acc = accounts.find(a => a.id === accId);
        if (acc) {
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(accId, { balance: acc.balance + delta });
        }
      }

      await Promise.all(toDelete.map(txn => pb.collection(COLLECTIONS.FIN_TRANSACTIONS).delete(txn.id)));
      setSelected(new Set());
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleBulkClear() {
    const ids = Array.from(selected);
    const pendingTxns = transactions.filter(t => ids.includes(t.id) && t.status === 'pending');
    if (pendingTxns.length === 0) return;
    if (!confirm(`Mark ${pendingTxns.length} pending transaction${pendingTxns.length > 1 ? 's' : ''} as cleared?`)) return;
    setBulkClearing(true);
    try {
      const balanceDeltas = new Map<string, number>();
      for (const txn of pendingTxns) {
        const delta = txn.type === 'income' ? txn.amount : -(txn.amount + (txn.fee_amount ?? 0));
        balanceDeltas.set(txn.bank_account, (balanceDeltas.get(txn.bank_account) ?? 0) + delta);
      }

      for (const [accId, delta] of balanceDeltas) {
        const acc = accounts.find(a => a.id === accId);
        if (acc) {
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(accId, { balance: acc.balance + delta });
        }
      }

      await Promise.all(pendingTxns.map(txn =>
        pb.collection(COLLECTIONS.FIN_TRANSACTIONS).update(txn.id, { status: 'cleared' })
      ));
      setSelected(new Set());
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkClearing(false);
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--muted)]">
        <FileText size={32} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">No transactions found</p>
      </div>
    );
  }

  const allSelected = selected.size === transactions.length;
  const someSelected = selected.size > 0 && !allSelected;

  // Bulk selection totals
  const selectedTxns = transactions.filter(t => selected.has(t.id));
  const selectedIncome = selectedTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const selectedExpense = selectedTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount + (t.fee_amount ?? 0), 0);
  const selectedPendingCount = selectedTxns.filter(t => t.status === 'pending').length;

  return (
    <div className="space-y-1">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg sticky top-0 z-10 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-medium shrink-0">{selected.size} selected</span>
            <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
              {selectedIncome > 0 && (
                <span className="text-[var(--success)]">+{selectedIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              )}
              {selectedExpense > 0 && (
                <span className="text-[var(--error)]">-{selectedExpense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Clear
            </button>
            {selectedPendingCount > 0 && (
              <button
                onClick={handleBulkClear}
                disabled={bulkClearing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--success)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {bulkClearing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                Clear {selectedPendingCount} pending
              </button>
            )}
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--error)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {bulkDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* Select-all header */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected; }}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded accent-[var(--foreground)] cursor-pointer shrink-0"
          />
          <span className="text-[11px] text-[var(--muted)]">
            {allSelected ? 'All selected' : `${selected.size} of ${transactions.length}`}
          </span>
        </div>
      )}

      {transactions.map(txn => {
        const acc = getAccount(txn.bank_account);
        const cat = txn.category ? getCategory(txn.category) : null;
        const isExpanded = expandedId === txn.id;
        const isSelected = selected.has(txn.id);
        const isIncome = txn.type === 'income';
        const symbol = CURRENCY_SYMBOLS[txn.currency];
        const tags: string[] = Array.isArray(txn.tags) ? txn.tags : [];
        const netAmount = isIncome ? txn.amount : txn.amount + (txn.fee_amount ?? 0);
        const shortId = txn.id.slice(0, 8);

        const showCheckbox = selected.size > 0 || hoveredId === txn.id;

        return (
          <div
            key={txn.id}
            className={cn(
              'bg-[var(--card-bg)] border rounded-lg overflow-hidden transition-colors',
              isSelected ? 'border-[var(--foreground)]/40 bg-[var(--card-hover)]' : 'border-[var(--card-border)]',
            )}
            onMouseEnter={() => setHoveredId(txn.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Main row */}
            <div
              className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : txn.id)}
            >
              {/* Icon / Checkbox slot */}
              <div className="relative w-8 h-8 shrink-0 flex items-center justify-center">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-opacity absolute inset-0',
                  isIncome ? 'bg-[var(--success-subtle)]' : 'bg-[var(--error-subtle)]',
                  showCheckbox ? 'opacity-0' : 'opacity-100',
                )}>
                  {isIncome
                    ? <ArrowUpRight size={15} className="text-[var(--success)]" />
                    : <ArrowDownLeft size={15} className="text-[var(--error)]" />}
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  onClick={e => toggleSelect(txn.id, e)}
                  className={cn(
                    'w-4 h-4 rounded accent-[var(--foreground)] cursor-pointer transition-opacity absolute',
                    showCheckbox ? 'opacity-100' : 'opacity-0 pointer-events-none',
                  )}
                />
              </div>

              {/* Description + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{txn.description || (isIncome ? 'Income' : 'Expense')}</p>
                  {txn.is_recurring && (
                    <RefreshCw size={10} className="text-[var(--muted)] shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {/* Category split badges */}
                  {txn.category_splits && txn.category_splits.length > 1 ? (
                    <>
                      {txn.category_splits.map((sp, i) => {
                        const splitCat = getCategory(sp.category_id);
                        if (!splitCat) return null;
                        return (
                          <span
                            key={i}
                            className="text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-0.5"
                            style={{ borderColor: splitCat.color ? `${splitCat.color}55` : undefined, color: splitCat.color || undefined, backgroundColor: splitCat.color ? `${splitCat.color}18` : undefined }}
                          >
                            {splitCat.name}
                            <span className="opacity-60">{sp.percentage}%</span>
                          </span>
                        );
                      })}
                      <span className="text-[10px] text-[var(--muted)] flex items-center gap-0.5">
                        <Link2 size={9} />split
                      </span>
                    </>
                  ) : cat ? (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full border"
                      style={{ borderColor: cat.color ? `${cat.color}55` : undefined, color: cat.color || undefined, backgroundColor: cat.color ? `${cat.color}18` : undefined }}
                    >
                      {cat.name}
                    </span>
                  ) : null}
                  {acc && (
                    <span className="text-[11px] text-[var(--muted)]">{acc.name}</span>
                  )}
                  <span className="text-[11px] text-[var(--muted)]">·</span>
                  <span className="text-[11px] text-[var(--muted)]">{format(new Date(txn.date.split(' ')[0] + 'T12:00:00'), 'MMM d, yyyy')}</span>
                  {txn.status === 'pending' && (
                    <span className="text-[10px] flex items-center gap-0.5 text-[var(--warning)]">
                      <Clock size={10} />Pending
                    </span>
                  )}
                  {/* Short ID */}
                  <span className="text-[10px] text-[var(--muted)]/50 font-mono hidden sm:inline">#{shortId}</span>
                </div>
              </div>

              {/* Quick clear button for pending */}
              {txn.status === 'pending' && hoveredId === txn.id && (
                <button
                  onClick={e => handleClearPending(txn, e)}
                  disabled={clearing === txn.id}
                  title="Mark as cleared"
                  className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-[var(--success-subtle)] text-[var(--success)] hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                  {clearing === txn.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                  Clear
                </button>
              )}

              {/* Amount */}
              <CurrencyTooltip amount={txn.amount} currency={txn.currency}>
                <p className={cn('text-sm font-bold tabular-nums', isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                  {isIncome ? '+' : '-'}{symbol}{txn.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </CurrencyTooltip>

              {isExpanded ? <ChevronUp size={14} className="text-[var(--muted)] shrink-0" /> : <ChevronDown size={14} className="text-[var(--muted)] shrink-0" />}
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-[var(--card-border)] bg-[var(--background)]">

                {/* Full description (if meaningful) */}
                {txn.description && txn.description !== 'Income' && txn.description !== 'Expense' && (
                  <div className="px-4 pt-3 pb-0">
                    <p className="text-[10px] text-[var(--muted)] mb-0.5">Description</p>
                    <p className="text-sm font-medium leading-snug">{txn.description}</p>
                  </div>
                )}

                <div className="px-4 pb-4 pt-3 space-y-3">

                  {/* Status + amount summary row */}
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold',
                      txn.status === 'cleared' ? 'bg-[var(--success-subtle)] text-[var(--success)]' : 'bg-[var(--warning-subtle,var(--card-hover))] text-[var(--warning)]',
                    )}>
                      {txn.status === 'cleared' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                      {txn.status}
                    </div>
                    <div className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold',
                      isIncome ? 'bg-[var(--success-subtle)] text-[var(--success)]' : 'bg-[var(--error-subtle)] text-[var(--error)]',
                    )}>
                      {txn.type}
                    </div>
                    {txn.is_recurring && (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-[var(--card-hover)] text-[var(--muted)]">
                        <RefreshCw size={9} />recurring
                      </div>
                    )}
                  </div>

                  {/* Transaction ID */}
                  <div className="flex items-center gap-2 p-2.5 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
                    <Hash size={12} className="text-[var(--muted)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-[var(--muted)] mb-0.5">Transaction ID</p>
                      <p className="text-xs font-mono truncate">{txn.id}</p>
                    </div>
                    <CopyButton text={txn.id} label="Copy" />
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                    <div>
                      <p className="text-[10px] text-[var(--muted)] mb-0.5">Amount</p>
                      <p className="font-semibold tabular-nums">
                        {symbol}{txn.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] text-[var(--muted)] font-normal">{txn.currency}</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[var(--muted)] mb-0.5">Net {isIncome ? 'Received' : 'Spent'}</p>
                      <p className={cn('font-bold tabular-nums', isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                        {isIncome ? '+' : '-'}{symbol}{netAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    {txn.fee_amount != null && txn.fee_amount > 0 && (
                      <div>
                        <p className="text-[10px] text-[var(--muted)] mb-0.5">Fee / Exchange Loss</p>
                        <p className="font-medium text-[var(--error)] tabular-nums">
                          -{symbol}{txn.fee_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} {txn.currency}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] text-[var(--muted)] mb-0.5">Date</p>
                      <p className="font-medium">{format(new Date(txn.date.split(' ')[0] + 'T12:00:00'), 'MMM d, yyyy')}</p>
                    </div>
                    {acc && (
                      <div>
                        <p className="text-[10px] text-[var(--muted)] mb-0.5">Account</p>
                        <div className="flex items-center gap-1.5">
                          {acc.color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />}
                          <p className="font-medium truncate">{acc.name}</p>
                          <span className="text-[10px] text-[var(--muted)]">{acc.currency}</span>
                        </div>
                      </div>
                    )}
                    {/* Single category display */}
                    {cat && (!txn.category_splits || txn.category_splits.length <= 1) && (
                      <div>
                        <p className="text-[10px] text-[var(--muted)] mb-0.5">Category</p>
                        <div className="flex items-center gap-1.5">
                          {cat.color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />}
                          <p className="font-medium truncate">{cat.name}</p>
                        </div>
                      </div>
                    )}
                    {txn.status === 'pending' && txn.expected_clear_date && (
                      <div>
                        <p className="text-[10px] text-[var(--muted)] mb-0.5">Clears on</p>
                        <p className="font-medium">{format(new Date(txn.expected_clear_date.split(' ')[0] + 'T12:00:00'), 'MMM d, yyyy')}</p>
                      </div>
                    )}
                    {txn.is_recurring && txn.recurring_id && (
                      <div>
                        <p className="text-[10px] text-[var(--muted)] mb-0.5">Rule ID</p>
                        <div className="flex items-center gap-1">
                          <p className="font-mono text-[10px] truncate">{txn.recurring_id.slice(0, 8)}…</p>
                          <CopyButton text={txn.recurring_id} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Category splits */}
                  {txn.category_splits && txn.category_splits.length > 1 && (
                    <div className="p-2.5 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg">
                      <p className="text-[10px] text-[var(--muted)] mb-2 font-medium">Category Split</p>
                      <div className="space-y-1.5">
                        {txn.category_splits.map((sp, i) => {
                          const splitCat = getCategory(sp.category_id);
                          const splitAmt = (netAmount * sp.percentage) / 100;
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                {splitCat?.color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: splitCat.color }} />}
                                <span className="truncate">{splitCat?.name ?? 'Unknown'}</span>
                              </div>
                              <span className="text-[var(--muted)] tabular-nums shrink-0">{sp.percentage}%</span>
                              <span className={cn('tabular-nums font-medium shrink-0', isIncome ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                                {isIncome ? '+' : '-'}{symbol}{splitAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div>
                      <p className="text-[10px] text-[var(--muted)] mb-1.5">Tags</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {tags.map(tag => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 bg-[var(--card-hover)] rounded-full border border-[var(--card-border)] flex items-center gap-1">
                            <Tag size={9} className="text-[var(--muted)]" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Receipt */}
                  {txn.receipt_file && (
                    <a
                      href={pb.files.getUrl(txn, txn.receipt_file)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs px-3 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors w-fit"
                    >
                      <FileText size={12} className="text-[var(--muted)]" />
                      <span>View Receipt</span>
                      <ExternalLink size={10} className="text-[var(--muted)]" />
                    </a>
                  )}

                  {/* Refund indicator */}
                  {txn.refund_of && (
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--info,var(--primary))] bg-[var(--info-subtle,var(--card-hover))] px-2.5 py-1.5 rounded-lg">
                      <RotateCcw size={11} />
                      Refund of #{txn.refund_of.slice(0, 8)}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-[var(--card-border)]">
                    {txn.status === 'pending' ? (
                      <button
                        onClick={e => handleClearPending(txn, e)}
                        disabled={clearing === txn.id}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--success-subtle)] text-[var(--success)] rounded-lg hover:opacity-80 transition-opacity disabled:opacity-40 font-medium"
                      >
                        {clearing === txn.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                        Mark Cleared
                      </button>
                    ) : <div />}
                    <div className="flex items-center gap-2">
                      {onDuplicate && (
                        <button
                          onClick={() => onDuplicate(txn)}
                          title="Duplicate this transaction"
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-[var(--card-border)] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                        >
                          <CopyPlus size={12} />Duplicate
                        </button>
                      )}
                      {onRefund && txn.status === 'cleared' && !txn.refund_of && (
                        <button
                          onClick={() => onRefund(txn)}
                          title="Create a refund/reversal"
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-[var(--warning)]/30 rounded-lg text-[var(--warning)] hover:bg-[var(--warning-subtle,var(--card-hover))] transition-colors"
                        >
                          <RotateCcw size={12} />Refund
                        </button>
                      )}
                      {onEdit && (
                        <button
                          onClick={() => onEdit(txn)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-[var(--card-border)] rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                        >
                          <Pencil size={12} />Edit
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(txn)}
                        disabled={deleting === txn.id}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-[var(--error)]/30 rounded-lg text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors disabled:opacity-40"
                      >
                        {deleting === txn.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
