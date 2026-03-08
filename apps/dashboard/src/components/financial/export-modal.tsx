'use client';

import { useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { format, subDays, subMonths } from 'date-fns';
import type { FinTransaction, BankAccount, FinCategory } from '@/lib/types';
import { CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';

const PRESETS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 60 days', days: 60 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'Last year', days: 365 },
  { label: 'Custom', days: 0 },
];

interface ExportModalProps {
  onClose: () => void;
  transactions: FinTransaction[];
  accounts: BankAccount[];
  categories: FinCategory[];
}

export function ExportModal({ onClose, transactions, accounts, categories }: ExportModalProps) {
  const [preset, setPreset] = useState(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [exporting, setExporting] = useState(false);

  function getDateRange(): { from: Date; to: Date } {
    const to = new Date();
    if (preset === 0) {
      return {
        from: customFrom ? new Date(customFrom) : subMonths(to, 1),
        to: customTo ? new Date(customTo) : to,
      };
    }
    return { from: subDays(to, preset), to };
  }

  function getAccount(id: string) { return accounts.find(a => a.id === id); }
  function getCategory(id: string) { return categories.find(c => c.id === id); }

  function handleExport() {
    setExporting(true);
    const { from, to } = getDateRange();

    const filtered = transactions.filter(t => {
      const d = new Date(t.date.split(' ')[0]);
      if (d < from || d > to) return false;
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      return true;
    });

    // Build CSV
    const headers = ['Date', 'Type', 'Description', 'Category', 'Account', 'Currency', 'Amount', 'Fee', 'Net Amount', 'Status', 'Tags'];
    const rows = filtered.map(t => {
      const acc = getAccount(t.bank_account);
      const cat = t.category ? getCategory(t.category) : null;
      const net = t.type === 'income' ? t.amount : -(t.amount + (t.fee_amount ?? 0));
      const tags: string[] = Array.isArray(t.tags) ? t.tags : [];
      return [
        format(new Date(t.date.split(' ')[0]), 'yyyy-MM-dd'),
        t.type,
        t.description || '',
        cat?.name || '',
        acc?.name || '',
        t.currency,
        t.amount.toFixed(2),
        (t.fee_amount ?? 0).toFixed(2),
        net.toFixed(2),
        t.status,
        tags.join('; '),
      ];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions_${format(from, 'yyyy-MM-dd')}_to_${format(to, 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExporting(false);
    onClose();
  }

  const { from, to } = getDateRange();
  const previewCount = transactions.filter(t => {
    const d = new Date(t.date.split(' ')[0]);
    if (d < from || d > to) return false;
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;
    return true;
  }).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
          <h2 className="text-base font-semibold">Export Transactions</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)]"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Period */}
          <div>
            <label className="block text-xs font-medium mb-2">Time Period</label>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.days}
                  onClick={() => setPreset(p.days)}
                  className={`px-3 py-2 text-xs rounded-lg border transition-colors ${preset === p.days ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {preset === 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1.5">From</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">To</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]" />
              </div>
            </div>
          )}

          {/* Type */}
          <div>
            <label className="block text-xs font-medium mb-2">Transaction Type</label>
            <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5">
              {(['all', 'income', 'expense'] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)} className={`flex-1 py-1.5 text-xs rounded-md font-medium capitalize transition-all ${typeFilter === t ? 'bg-[var(--foreground)] text-[var(--background)]' : 'hover:bg-[var(--card-hover)] text-[var(--muted)]'}`}>{t}</button>
              ))}
            </div>
          </div>

          {/* Preview count */}
          <div className="bg-[var(--card-hover)] rounded-lg px-4 py-3 text-center">
            <p className="text-2xl font-bold">{previewCount}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">transactions will be exported as CSV</p>
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm border border-[var(--card-border)] rounded-lg hover:bg-[var(--card-hover)]">Cancel</button>
          <button onClick={handleExport} disabled={exporting || previewCount === 0} className="flex-1 px-4 py-2.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
