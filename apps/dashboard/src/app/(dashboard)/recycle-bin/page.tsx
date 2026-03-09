'use client';

import { useEffect, useState, useCallback } from 'react';
import { Trash2, RotateCcw, Clock, Loader2, AlertTriangle, Building2, Phone, FileText, Headphones, X } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type RecycleBinItem, type RecycleBinItemType } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useRecycleBin } from '@/contexts/recycle-bin-context';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const TYPE_CONFIG: Record<RecycleBinItemType, { icon: typeof Building2; label: string; color: string }> = {
  company: { icon: Building2, label: 'Company', color: 'text-purple-400 bg-purple-500/10' },
  phone_number: { icon: Phone, label: 'Phone Number', color: 'text-blue-400 bg-blue-500/10' },
  call_log: { icon: FileText, label: 'Call Log', color: 'text-orange-400 bg-orange-500/10' },
  session: { icon: Headphones, label: 'Session', color: 'text-green-400 bg-green-500/10' },
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function daysUntilExpiry(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
}

export default function RecycleBinPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { restoreItem, permanentlyDelete } = useRecycleBin();
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RecycleBinItemType | 'all'>('all');
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      let filterStr = '';
      if (filter !== 'all') {
        filterStr = `item_type = "${filter}"`;
      }
      const result = await pb.collection(COLLECTIONS.RECYCLE_BIN).getFullList<RecycleBinItem>({
        filter: filterStr,
        sort: '-deleted_at',
        expand: 'deleted_by',
      });
      setItems(result);
    } catch (err) {
      console.error('Failed to fetch recycle bin:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/');
      return;
    }
    fetchItems();
  }, [isAdmin, router, fetchItems]);

  const handleRestore = async (item: RecycleBinItem) => {
    setActionId(item.id);
    try {
      await restoreItem(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (err) {
      console.error('Restore failed:', err);
    } finally {
      setActionId(null);
    }
  };

  const handlePermanentDelete = async (item: RecycleBinItem) => {
    setActionId(item.id);
    try {
      await permanentlyDelete(item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Permanent delete failed:', err);
    } finally {
      setActionId(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
              <Trash2 size={20} className="text-red-400" />
            </div>
            Recycle Bin
          </h1>
          <p className="text-[var(--muted)] mt-1">
            Deleted items are kept for 30 days before permanent removal
          </p>
        </div>
        <div className="text-sm text-[var(--muted)]">
          {items.length} item{items.length !== 1 ? 's' : ''} in trash
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'company', 'phone_number', 'call_log', 'session'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              filter === f
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)]'
            )}
          >
            {f === 'all' ? 'All' : TYPE_CONFIG[f].label + 's'}
          </button>
        ))}
      </div>

      {/* Items */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-12">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[var(--muted)]/10 flex items-center justify-center mx-auto">
              <Trash2 size={32} className="text-[var(--muted)]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-1">Recycle bin is empty</h3>
              <p className="text-sm text-[var(--muted)]">
                Deleted items will appear here for 30 days.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            const config = TYPE_CONFIG[item.item_type as RecycleBinItemType];
            const Icon = config?.icon || FileText;
            const daysLeft = daysUntilExpiry(item.expires_at);
            const isActing = actionId === item.id;

            return (
              <div
                key={item.id}
                className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 flex items-center gap-4 hover:border-[var(--sidebar-border)] transition-colors"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', config?.color)}>
                  <Icon size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{item.item_label || 'Unnamed'}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide',
                      config?.color
                    )}>
                      {config?.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                    <span>Deleted {formatTimeAgo(item.deleted_at)}</span>
                    {item.expand?.deleted_by && (
                      <span>by {item.expand.deleted_by.name}</span>
                    )}
                    <span className={cn(
                      'flex items-center gap-1',
                      daysLeft <= 3 ? 'text-[var(--error)]' : 'text-[var(--muted)]'
                    )}>
                      <Clock size={11} />
                      {daysLeft}d left
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleRestore(item)}
                    disabled={isActing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--success-subtle)] text-[var(--success)] border border-[var(--success)]/20 hover:bg-[var(--success)]/20 transition-colors disabled:opacity-50"
                  >
                    {isActing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Restore
                  </button>

                  {confirmDeleteId === item.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handlePermanentDelete(item)}
                        disabled={isActing}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                      >
                        {isActing ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(item.id)}
                      disabled={isActing}
                      className="p-1.5 rounded-lg text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Permanently delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--info-subtle)] border border-[var(--info)]/20">
        <AlertTriangle size={16} className="text-[var(--info)] mt-0.5 flex-shrink-0" />
        <div className="text-xs text-[var(--info)] space-y-1">
          <p className="font-semibold">Automatic cleanup</p>
          <p>Items in the recycle bin are automatically and permanently deleted after 30 days. Restoring an item will put it back in its original location with all its data intact.</p>
        </div>
      </div>
    </div>
  );
}
