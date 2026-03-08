'use client';

import { useState, useRef, useCallback } from 'react';
import {
  X, Upload, Loader2, CheckCircle, AlertCircle, FileText,
  RefreshCw, ChevronDown, ChevronUp, Sparkles, CircleCheck,
  CircleX, Pencil, RotateCcw,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { BankAccount, FinCategory, SupportedCurrency } from '@/lib/types';
import { SUPPORTED_CURRENCIES, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import { cn } from '@/lib/utils';
import type { InvoiceParseResult, ParsedTransaction } from '@/app/api/invoice-parse/route';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'processing' | 'review' | 'saving' | 'done';

interface ReviewTransaction extends ParsedTransaction {
  _id: string;
  approved: boolean;
  editing: boolean;
  // user-overridable fields
  accountId: string;
  resolvedCategoryId: string;
  // editable overrides
  editAmount: string;
  editDescription: string;
  editDate: string;
  editCurrency: SupportedCurrency;
  editType: 'income' | 'expense';
  editIsRecurring: boolean;
  editRecurringFreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  editFee: string;
}

interface InvoiceUploadModalProps {
  onClose: () => void;
  onSaved: () => void;
  userId: string;
  accounts: BankAccount[];
  categories: FinCategory[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guessCategory(hint: string | undefined, categories: FinCategory[], type: 'income' | 'expense'): string {
  if (!hint) return '';
  const lower = hint.toLowerCase();
  const match = categories.find(c => {
    if (c.type !== 'both' && c.type !== type) return false;
    return c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase());
  });
  return match?.id ?? '';
}

function confidenceBadge(conf: string) {
  if (conf === 'high') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)]">High confidence</span>;
  if (conf === 'medium') return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--warning-subtle)] text-[var(--warning)]">Medium confidence</span>;
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--error-subtle)] text-[var(--error)]">Low confidence</span>;
}

// ─── Inline edit form ─────────────────────────────────────────────────────────

function EditForm({
  txn,
  accounts,
  categories,
  onChange,
  onDone,
}: {
  txn: ReviewTransaction;
  accounts: BankAccount[];
  categories: FinCategory[];
  onChange: (patch: Partial<ReviewTransaction>) => void;
  onDone: () => void;
}) {
  const filteredCats = categories.filter(c => c.type === txn.editType || c.type === 'both');

  return (
    <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-3">
      {/* Type toggle */}
      <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
        {(['income', 'expense'] as const).map(t => (
          <button
            key={t}
            onClick={() => onChange({ editType: t })}
            className={cn(
              'flex-1 py-1.5 text-xs rounded-md font-medium capitalize transition-all',
              txn.editType === t
                ? t === 'income' ? 'bg-[var(--success)] text-white' : 'bg-[var(--error)] text-white'
                : 'hover:bg-[var(--card-hover)] text-[var(--muted)]',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium mb-1">Amount</label>
          <input
            type="number"
            value={txn.editAmount}
            onChange={e => onChange({ editAmount: e.target.value })}
            className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1">Currency</label>
          <select
            value={txn.editCurrency}
            onChange={e => onChange({ editCurrency: e.target.value as SupportedCurrency })}
            className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
          >
            {SUPPORTED_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-medium mb-1">Description</label>
        <input
          value={txn.editDescription}
          onChange={e => onChange({ editDescription: e.target.value })}
          className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium mb-1">Date</label>
          <input
            type="date"
            value={txn.editDate}
            onChange={e => onChange({ editDate: e.target.value })}
            className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1">Account</label>
          <select
            value={txn.accountId}
            onChange={e => onChange({ accountId: e.target.value })}
            className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium mb-1">Category</label>
          <select
            value={txn.resolvedCategoryId}
            onChange={e => onChange({ resolvedCategoryId: e.target.value })}
            className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
          >
            <option value="">No category</option>
            {filteredCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium mb-1">Fee (optional)</label>
          <input
            type="number"
            value={txn.editFee}
            onChange={e => onChange({ editFee: e.target.value })}
            placeholder="0.00"
            className="w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
          />
        </div>
      </div>

      {/* Recurring */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={txn.editIsRecurring}
            onChange={e => onChange({ editIsRecurring: e.target.checked })}
            className="rounded"
          />
          <span className="text-xs font-medium">Recurring transaction</span>
        </label>
        {txn.editIsRecurring && (
          <select
            value={txn.editRecurringFreq}
            onChange={e => onChange({ editRecurringFreq: e.target.value as ReviewTransaction['editRecurringFreq'] })}
            className="mt-2 w-full px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] capitalize"
          >
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(f => (
              <option key={f} value={f} className="capitalize">{f}</option>
            ))}
          </select>
        )}
      </div>

      <button
        onClick={onDone}
        className="w-full py-1.5 text-xs bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 transition-opacity"
      >
        Done editing
      </button>
    </div>
  );
}

// ─── Transaction review card ──────────────────────────────────────────────────

function TransactionCard({
  txn,
  accounts,
  categories,
  onChange,
}: {
  txn: ReviewTransaction;
  accounts: BankAccount[];
  categories: FinCategory[];
  onChange: (patch: Partial<ReviewTransaction>) => void;
}) {
  const sym = CURRENCY_SYMBOLS[txn.editCurrency] ?? txn.editCurrency;
  const acc = accounts.find(a => a.id === txn.accountId);
  const cat = categories.find(c => c.id === txn.resolvedCategoryId);

  return (
    <div className={cn(
      'rounded-xl border transition-all duration-150',
      txn.approved
        ? 'bg-[var(--card-bg)] border-[var(--card-border)]'
        : 'bg-[var(--card-hover)] border-[var(--card-border)] opacity-60',
    )}>
      <div className="flex items-start gap-3 p-4">
        {/* Approve toggle */}
        <button
          onClick={() => onChange({ approved: !txn.approved })}
          className="mt-0.5 shrink-0"
          title={txn.approved ? 'Exclude this transaction' : 'Include this transaction'}
        >
          {txn.approved
            ? <CircleCheck size={18} className="text-[var(--success)]" />
            : <CircleX size={18} className="text-[var(--muted)]" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{txn.editDescription}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {confidenceBadge(txn.confidence)}
                {txn.editIsRecurring && (
                  <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                    <RefreshCw size={9} />
                    Recurring · {txn.editRecurringFreq}
                  </span>
                )}
                {cat && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--card-border)]" style={{ color: cat.color || undefined }}>
                    {cat.name}
                  </span>
                )}
                {txn.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--card-hover)] text-[var(--muted)]">{tag}</span>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--muted)] mt-1">
                <span>{txn.editDate}</span>
                {acc && <><span>·</span><span>{acc.name}</span></>}
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className={cn('text-base font-bold tabular-nums', txn.editType === 'income' ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                {txn.editType === 'income' ? '+' : '-'}{sym}{Number(txn.editAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              {txn.editFee && Number(txn.editFee) > 0 && (
                <p className="text-[10px] text-[var(--muted)]">+{sym}{Number(txn.editFee).toFixed(2)} fee</p>
              )}
            </div>
          </div>

          {/* Edit form */}
          {txn.editing && (
            <EditForm
              txn={txn}
              accounts={accounts}
              categories={categories}
              onChange={onChange}
              onDone={() => onChange({ editing: false })}
            />
          )}
        </div>

        {/* Edit button */}
        <button
          onClick={() => onChange({ editing: !txn.editing })}
          className="mt-0.5 p-1.5 rounded-md hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors shrink-0"
          title="Edit"
        >
          {txn.editing ? <ChevronUp size={14} /> : <Pencil size={13} />}
        </button>
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function InvoiceUploadModal({ onClose, onSaved, userId, accounts, categories }: InvoiceUploadModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [parseResult, setParseResult] = useState<InvoiceParseResult | null>(null);
  const [txns, setTxns] = useState<ReviewTransaction[]>([]);
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultAccountId = accounts[0]?.id ?? '';

  // ── File handling ──────────────────────────────────────────────────────────

  const buildReviewTxns = useCallback((parsed: InvoiceParseResult): ReviewTransaction[] => {
    return parsed.transactions.map((t, i) => ({
      ...t,
      _id: `${i}`,
      approved: true,
      editing: false,
      accountId: defaultAccountId,
      resolvedCategoryId: guessCategory(t.category_hint, categories, t.type === 'income' ? 'income' : 'expense'),
      editAmount: String(t.amount),
      editDescription: t.description,
      editDate: t.date,
      editCurrency: (t.currency as SupportedCurrency) || 'USD',
      editType: t.type === 'income' ? 'income' : 'expense',
      editIsRecurring: Boolean(t.is_recurring),
      editRecurringFreq: t.recurring_frequency ?? 'monthly',
      editFee: t.fee_amount ? String(t.fee_amount) : '',
    }));
  }, [categories, defaultAccountId]);

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setError('');
    setStep('processing');

    const form = new FormData();
    form.append('file', f);

    try {
      const res = await fetch('/api/invoice-parse', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        // Try to extract a meaningful message from the Gemini detail
        let msg = data.error ?? 'Failed to parse invoice';
        if (data.detail) {
          try {
            const detail = typeof data.detail === 'string' ? JSON.parse(data.detail) : data.detail;
            const geminiMsg = detail?.error?.message ?? detail?.message;
            if (geminiMsg) msg = geminiMsg;
          } catch { /* keep original msg */ }
        }
        setError(msg);
        setStep('upload');
        return;
      }

      const result = data as InvoiceParseResult;
      setParseResult(result);
      setTxns(buildReviewTxns(result));
      setStep('review');
    } catch {
      setError('Network error — could not reach the AI service');
      setStep('upload');
    }
  }, [buildReviewTxns]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }

  // ── Transaction mutation ───────────────────────────────────────────────────

  function updateTxn(id: string, patch: Partial<ReviewTransaction>) {
    setTxns(prev => prev.map(t => t._id === id ? { ...t, ...patch } : t));
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleConfirm() {
    const approved = txns.filter(t => t.approved);
    if (approved.length === 0) { setError('Select at least one transaction to import.'); return; }

    setStep('saving');
    setSaveProgress({ done: 0, total: approved.length });
    setError('');

    let done = 0;
    for (const txn of approved) {
      try {
        const amountNum = parseFloat(txn.editAmount) || 0;
        const feeNum = txn.editFee ? parseFloat(txn.editFee) : 0;

        // If recurring → create a recurring_transaction record
        if (txn.editIsRecurring) {
          await pb.collection(COLLECTIONS.RECURRING_TRANSACTIONS).create({
            bank_account: txn.accountId,
            type: txn.editType,
            amount: amountNum,
            currency: txn.editCurrency,
            fee_amount: feeNum || null,
            category: txn.resolvedCategoryId || null,
            description: txn.editDescription,
            frequency: txn.editRecurringFreq,
            start_date: txn.editDate + ' 00:00:00',
            next_run_date: txn.editDate + ' 00:00:00',
            is_active: true,
            created_by: userId,
          });
        }

        // Always create the one-time transaction record as well
        const formData = new FormData();
        formData.append('bank_account', txn.accountId);
        formData.append('type', txn.editType);
        formData.append('amount', String(amountNum));
        formData.append('currency', txn.editCurrency);
        if (feeNum) formData.append('fee_amount', String(feeNum));
        if (txn.resolvedCategoryId) formData.append('category', txn.resolvedCategoryId);
        if (txn.tags.length) formData.append('tags', JSON.stringify(txn.tags));
        formData.append('description', txn.editDescription);
        formData.append('status', 'cleared');
        formData.append('date', txn.editDate + ' 00:00:00');
        formData.append('created_by', userId);
        if (txn.editIsRecurring) formData.append('is_recurring', 'true');

        await pb.collection(COLLECTIONS.FIN_TRANSACTIONS).create(formData);

        // Update account balance
        const acc = accounts.find(a => a.id === txn.accountId);
        if (acc) {
          const delta = txn.editType === 'income' ? amountNum : -(amountNum + feeNum);
          await pb.collection(COLLECTIONS.BANK_ACCOUNTS).update(txn.accountId, {
            balance: acc.balance + delta,
          });
          // mutate in memory so subsequent txns in same account get correct balance
          acc.balance += delta;
        }
      } catch (e) {
        console.error('Failed to save transaction', txn._id, e);
      }

      done++;
      setSaveProgress({ done, total: approved.length });
    }

    setStep('done');
    onSaved();
  }

  // ── UI: Upload step ────────────────────────────────────────────────────────

  const approvedCount = txns.filter(t => t.approved).length;
  const recurringCount = txns.filter(t => t.approved && t.editIsRecurring).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)] shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--primary)]" />
            <h2 className="text-base font-semibold">AI Invoice Import</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── UPLOAD ── */}
          {step === 'upload' && (
            <div className="p-6 space-y-4">
              <p className="text-sm text-[var(--muted)]">
                Upload an invoice, receipt, or bank statement. Gemini AI will extract transactions and detect recurring ones automatically.
              </p>

              {error && (
                <div className="flex items-center gap-2 text-sm text-[var(--error)] bg-[var(--error-subtle)] px-3 py-2.5 rounded-lg">
                  <AlertCircle size={14} className="shrink-0" />
                  {error}
                </div>
              )}

              <div
                className={cn(
                  'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
                  dragging
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--card-border)] hover:border-[var(--foreground)]/30 hover:bg-[var(--card-hover)]',
                )}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={32} className="mx-auto mb-3 text-[var(--muted)]" />
                <p className="text-sm font-medium mb-1">Drop your document here or click to browse</p>
                <p className="text-xs text-[var(--muted)]">PDF, JPG, PNG, WebP · max 20MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={handleFileInput}
                />
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: 'Invoices', sub: 'PDF & images' },
                  { label: 'Receipts', sub: 'Point of sale' },
                  { label: 'Statements', sub: 'Bank exports' },
                ].map(({ label, sub }) => (
                  <div key={label} className="p-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-hover)]">
                    <FileText size={16} className="mx-auto mb-1 text-[var(--muted)]" />
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[10px] text-[var(--muted)]">{sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PROCESSING ── */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center p-12 gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-[var(--primary)]/20 flex items-center justify-center">
                  <Sparkles size={24} className="text-[var(--primary)]" />
                </div>
                <Loader2 size={64} className="animate-spin text-[var(--primary)]/30 absolute inset-0" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">Analyzing with Gemini AI</p>
                <p className="text-xs text-[var(--muted)] mt-1">{file?.name}</p>
                <p className="text-xs text-[var(--muted)] mt-1">Detecting transactions, amounts, currencies & recurring patterns…</p>
              </div>
            </div>
          )}

          {/* ── REVIEW ── */}
          {step === 'review' && parseResult && (
            <div className="p-5 space-y-4">
              {/* Summary banner */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--primary)]/5 border border-[var(--primary)]/20">
                <Sparkles size={14} className="text-[var(--primary)] shrink-0" />
                <div className="flex-1 text-xs text-[var(--muted)]">
                  <span className="font-semibold text-[var(--foreground)]">
                    {parseResult.transactions.length} transaction{parseResult.transactions.length !== 1 ? 's' : ''} found
                  </span>
                  {parseResult.vendor && <> from <span className="font-medium">{parseResult.vendor}</span></>}
                  {recurringCount > 0 && (
                    <> · <span className="text-[var(--primary)] font-semibold">{recurringCount} recurring</span> detected</>
                  )}
                </div>
                <button
                  onClick={() => { setStep('upload'); setFile(null); }}
                  className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  <RotateCcw size={11} />Re-upload
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-[var(--error)] bg-[var(--error-subtle)] px-3 py-2 rounded-lg">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              {/* Bulk controls */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)] flex-1">{approvedCount} of {txns.length} selected</span>
                <button
                  onClick={() => setTxns(p => p.map(t => ({ ...t, approved: true })))}
                  className="text-xs px-2.5 py-1 border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                >
                  Select all
                </button>
                <button
                  onClick={() => setTxns(p => p.map(t => ({ ...t, approved: false })))}
                  className="text-xs px-2.5 py-1 border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                >
                  Deselect all
                </button>
              </div>

              {/* Default account selector */}
              {accounts.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--muted)] shrink-0">Default account:</span>
                  <select
                    className="flex-1 px-2 py-1.5 text-xs bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
                    onChange={e => setTxns(p => p.map(t => ({ ...t, accountId: e.target.value })))}
                    defaultValue={defaultAccountId}
                  >
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                  </select>
                </div>
              )}

              {/* Transaction cards */}
              <div className="space-y-2">
                {txns.map(txn => (
                  <TransactionCard
                    key={txn._id}
                    txn={txn}
                    accounts={accounts}
                    categories={categories}
                    onChange={patch => updateTxn(txn._id, patch)}
                  />
                ))}
              </div>

              {parseResult.notes && (
                <p className="text-xs text-[var(--muted)] px-1 flex items-start gap-1.5">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  {parseResult.notes}
                </p>
              )}
            </div>
          )}

          {/* ── SAVING ── */}
          {step === 'saving' && (
            <div className="flex flex-col items-center justify-center p-12 gap-4">
              <Loader2 size={36} className="animate-spin text-[var(--primary)]" />
              <div className="text-center">
                <p className="text-sm font-semibold">Saving transactions…</p>
                <p className="text-xs text-[var(--muted)] mt-1">{saveProgress.done} / {saveProgress.total}</p>
                <div className="mt-3 w-48 h-1.5 bg-[var(--card-hover)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--primary)] transition-all"
                    style={{ width: `${saveProgress.total ? (saveProgress.done / saveProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center p-12 gap-4">
              <CheckCircle size={48} className="text-[var(--success)]" />
              <div className="text-center">
                <p className="text-sm font-semibold">Import complete</p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {saveProgress.total} transaction{saveProgress.total !== 1 ? 's' : ''} saved
                  {recurringCount > 0 && ` · ${recurringCount} recurring rule${recurringCount !== 1 ? 's' : ''} created`}
                </p>
              </div>
              <button onClick={onClose} className="px-6 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90">
                Close
              </button>
            </div>
          )}
        </div>

        {/* Footer — only shown during review */}
        {step === 'review' && (
          <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-[var(--card-border)] shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={approvedCount === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-40 transition-all"
            >
              <CheckCircle size={14} />
              Import {approvedCount} transaction{approvedCount !== 1 ? 's' : ''}
              {recurringCount > 0 && ` + ${recurringCount} recurring`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
