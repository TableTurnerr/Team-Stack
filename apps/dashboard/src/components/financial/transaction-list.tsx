'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Clock, FileText, Tag, ExternalLink, Trash2, ChevronDown, ChevronUp, Loader2, Link2, RefreshCw } from 'lucide-react';
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
}

export function TransactionList({ transactions, accounts, categories, onRefresh }: TransactionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
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

      // Group balance reversals by account to avoid stale reads
      const balanceDeltas = new Map<string, number>();
      for (const txn of toDelete) {
        if (txn.status === 'cleared') {
          const delta = txn.type === 'income' ? -txn.amount : (txn.amount + (txn.fee_amount ?? 0));
          balanceDeltas.set(txn.bank_account, (balanceDeltas.get(txn.bank_account) ?? 0) + delta);
        }
      }

      // Apply balance reversals
      for (const [accId, delta] of balanceDeltas) {
        const acc = accounts.find(a => a.id === accId);
        if (acc) {
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(accId, { balance: acc.balance + delta });
        }
      }

      // Delete all selected transactions
      await Promise.all(toDelete.map(txn => pb.collection(COLLECTIONS.FIN_TRANSACTIONS).delete(txn.id)));
      setSelected(new Set());
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBulkDeleting(false);
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--muted)]">
        <FileText size={32} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">No transactions yet</p>
      </div>
    );
  }

  const allSelected = selected.size === transactions.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="space-y-1">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg sticky top-0 z-10">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Clear
            </button>
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

      {/* Select-all header — only visible when something is selected */}
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
              {/* Icon / Checkbox slot — checkbox replaces icon on hover or selection */}
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
                  <span className="text-[11px] text-[var(--muted)]">{acc?.name}</span>
                  <span className="text-[11px] text-[var(--muted)]">·</span>
                  <span className="text-[11px] text-[var(--muted)]">{format(new Date(txn.date.split(' ')[0] + 'T12:00:00'), 'MMM d, yyyy')}</span>
                  {txn.status === 'pending' && (
                    <span className="text-[10px] flex items-center gap-0.5 text-[var(--warning)]">
                      <Clock size={10} />Pending
                    </span>
                  )}
                </div>
              </div>

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
              <div className="px-4 pb-3 border-t border-[var(--card-border)] bg-[var(--background)] space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2 text-xs text-[var(--muted)]">
                  {txn.fee_amount && txn.fee_amount > 0 && (
                    <>
                      <span>Fee / Exchange Loss</span>
                      <span className="font-medium text-[var(--error)]">-{symbol}{txn.fee_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </>
                  )}
                  {txn.status === 'pending' && txn.expected_clear_date && (
                    <>
                      <span>Expected Clear</span>
                      <span className="font-medium">{format(new Date(txn.expected_clear_date), 'MMM d, yyyy')}</span>
                    </>
                  )}
                  {txn.is_recurring && (
                    <>
                      <span>Type</span>
                      <span className="font-medium">Recurring</span>
                    </>
                  )}
                </div>

                {tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag size={11} className="text-[var(--muted)]" />
                    {tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-[var(--card-hover)] rounded-full">{tag}</span>
                    ))}
                  </div>
                )}

                {txn.receipt_file && (
                  <a
                    href={pb.files.getUrl(txn, txn.receipt_file)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-[var(--primary)] hover:underline"
                  >
                    <FileText size={12} />View Receipt <ExternalLink size={11} />
                  </a>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => handleDelete(txn)}
                    disabled={deleting === txn.id}
                    className="flex items-center gap-1.5 text-xs text-[var(--error)] hover:opacity-70 transition-opacity disabled:opacity-40"
                  >
                    {deleting === txn.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
