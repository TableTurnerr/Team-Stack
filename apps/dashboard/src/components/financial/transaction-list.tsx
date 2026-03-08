'use client';

import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, Clock, FileText, Tag, ExternalLink, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
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

  function getAccount(id: string) { return accounts.find(a => a.id === id); }
  function getCategory(id: string) { return categories.find(c => c.id === id); }

  async function handleDelete(txn: FinTransaction) {
    if (!confirm(`Delete this ${txn.type} of ${CURRENCY_SYMBOLS[txn.currency]}${txn.amount}?`)) return;
    setDeleting(txn.id);
    try {
      // Reverse balance impact if cleared
      if (txn.status === 'cleared') {
        const acc = accounts.find(a => a.id === txn.bank_account);
        if (acc) {
          const delta = txn.type === 'income'
            ? -txn.amount
            : (txn.amount + (txn.fee_amount ?? 0));
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(acc.id, { balance: acc.balance + delta });
        }
      }
      await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).delete(txn.id);
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(null);
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

  return (
    <div className="space-y-1">
      {transactions.map(txn => {
        const acc = getAccount(txn.bank_account);
        const cat = txn.category ? getCategory(txn.category) : null;
        const isExpanded = expandedId === txn.id;
        const isIncome = txn.type === 'income';
        const symbol = CURRENCY_SYMBOLS[txn.currency];
        const tags: string[] = Array.isArray(txn.tags) ? txn.tags : [];

        return (
          <div key={txn.id} className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg overflow-hidden">
            {/* Main row */}
            <div
              className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
              onClick={() => setExpandedId(isExpanded ? null : txn.id)}
            >
              {/* Icon */}
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                isIncome ? 'bg-[var(--success-subtle)]' : 'bg-[var(--error-subtle)]')}>
                {isIncome
                  ? <ArrowUpRight size={15} className="text-[var(--success)]" />
                  : <ArrowDownLeft size={15} className="text-[var(--error)]" />}
              </div>

              {/* Description + meta */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{txn.description || (isIncome ? 'Income' : 'Expense')}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {cat && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--card-border)] text-[var(--muted)]" style={{ borderColor: cat.color || undefined, color: cat.color || undefined }}>
                      {cat.name}
                    </span>
                  )}
                  <span className="text-[11px] text-[var(--muted)]">{acc?.name}</span>
                  <span className="text-[11px] text-[var(--muted)]">·</span>
                  <span className="text-[11px] text-[var(--muted)]">{format(new Date(txn.date), 'MMM d, yyyy')}</span>
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
                    <Trash2 size={12} />Delete
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
