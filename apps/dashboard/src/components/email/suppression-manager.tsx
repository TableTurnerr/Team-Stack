'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, ShieldBan, Trash2, Plus, Mail, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { Company } from '@/lib/types';
import { EMAIL_COLLECTIONS, type EmailUnsubscribe } from '@/lib/email-types';
import { SearchInput } from '@/components/search-input';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { formatDateTime, sanitizeFilterValue } from '@/lib/utils';

interface SuppressionManagerProps {
  className?: string;
}

export function SuppressionManager({ className }: SuppressionManagerProps) {
  const [unsubscribes, setUnsubscribes] = useState<EmailUnsubscribe[]>([]);
  const [doNotContactCompanies, setDoNotContactCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'unsubscribed' | 'do_not_contact'>('unsubscribed');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [removeTarget, setRemoveTarget] = useState<{ type: 'unsub'; id: string } | { type: 'dnc'; id: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addReason, setAddReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const perPage = 25;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        if (tab === 'unsubscribed') {
          const filters: string[] = [];
          if (search) {
            const safe = sanitizeFilterValue(search);
            filters.push(`(email_address ~ "${safe}" || reason ~ "${safe}")`);
          }
          const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_UNSUBSCRIBES).getList(page, perPage, {
            filter: filters.length > 0 ? filters.join(' && ') : undefined,
            sort: '-created',
            expand: 'company,campaign',
          });
          setUnsubscribes(result.items as unknown as EmailUnsubscribe[]);
          setTotalPages(result.totalPages);
        } else {
          const filters: string[] = ['do_not_contact = true'];
          if (search) {
            const safe = sanitizeFilterValue(search);
            filters.push(`(company_name ~ "${safe}" || email ~ "${safe}")`);
          }
          const result = await pb.collection(COLLECTIONS.COMPANIES).getList(page, perPage, {
            filter: filters.join(' && '),
            sort: '-updated',
          });
          setDoNotContactCompanies(result.items as unknown as Company[]);
          setTotalPages(result.totalPages);
        }
      } catch (err) {
        console.error('Failed to fetch suppression data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [tab, search, page]);

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      if (removeTarget.type === 'unsub') {
        await pb.collection(EMAIL_COLLECTIONS.EMAIL_UNSUBSCRIBES).delete(removeTarget.id);
        setUnsubscribes(prev => prev.filter(u => u.id !== removeTarget.id));
      } else {
        await pb.collection(COLLECTIONS.COMPANIES).update(removeTarget.id, { do_not_contact: false });
        setDoNotContactCompanies(prev => prev.filter(c => c.id !== removeTarget.id));
      }
    } catch (err) {
      console.error('Failed to remove suppression:', err);
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  };

  const handleAddManual = async () => {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_UNSUBSCRIBES).create({
        email_address: addEmail.trim(),
        reason: addReason.trim() || 'Manual suppression',
        source: 'manual',
      });
      setAddEmail('');
      setAddReason('');
      setShowAddForm(false);
      // Refresh
      setPage(1);
      setTab('unsubscribed');
    } catch (err) {
      console.error('Failed to add suppression:', err);
    } finally {
      setAdding(false);
    }
  };

  const tabs = [
    { key: 'unsubscribed' as const, label: 'Unsubscribed' },
    { key: 'do_not_contact' as const, label: 'Do Not Contact' },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Tabs + Actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(1); }}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                tab === t.key
                  ? 'bg-[var(--foreground)] text-[var(--background)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <SearchInput
            placeholder="Search..."
            onSearch={(v) => { setSearch(v); setPage(1); }}
            className="w-64"
          />
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg btn-primary"
          >
            <Plus size={14} />
            Add Manually
          </button>
        </div>
      </div>

      {/* Add manual form */}
      {showAddForm && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium">Add to Suppression List</h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-[var(--muted)] block mb-1">Email Address</label>
              <input
                type="email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-[var(--muted)] block mb-1">Reason (optional)</label>
              <input
                type="text"
                value={addReason}
                onChange={(e) => setAddReason(e.target.value)}
                placeholder="Manual opt-out request"
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              />
            </div>
            <button
              onClick={handleAddManual}
              disabled={!addEmail.trim() || adding}
              className="px-4 py-2 text-sm rounded-lg btn-primary disabled:opacity-50 flex items-center gap-2"
            >
              {adding && <RefreshCw size={14} className="animate-spin" />}
              Add
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--muted)]">
            <RefreshCw size={20} className="animate-spin mr-2" />
            Loading...
          </div>
        ) : tab === 'unsubscribed' ? (
          unsubscribes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
              <ShieldBan size={32} className="mb-2 opacity-50" />
              <p className="text-sm">No unsubscribes found</p>
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)] px-4 py-3">
                <div className="grid grid-cols-12 gap-4 text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
                  <div className="col-span-3">Email</div>
                  <div className="col-span-2">Source</div>
                  <div className="col-span-3">Reason</div>
                  <div className="col-span-3">Date</div>
                  <div className="col-span-1"></div>
                </div>
              </div>
              <div className="divide-y divide-[var(--card-border)]">
                {unsubscribes.map((unsub) => (
                  <div key={unsub.id} className="px-4 py-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-3 flex items-center gap-2 min-w-0">
                        <Mail size={14} className="text-[var(--muted)] shrink-0" />
                        <span className="text-sm truncate">{unsub.email_address}</span>
                      </div>
                      <div className="col-span-2">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          unsub.source === 'link_click' ? 'bg-blue-500/10 text-blue-500' :
                          unsub.source === 'bounce' ? 'bg-orange-500/10 text-orange-500' :
                          unsub.source === 'complaint' ? 'bg-red-500/10 text-red-500' :
                          'bg-[var(--card-hover)] text-[var(--muted)]'
                        )}>
                          {unsub.source}
                        </span>
                      </div>
                      <div className="col-span-3">
                        <p className="text-sm text-[var(--muted)] truncate">{unsub.reason || '—'}</p>
                      </div>
                      <div className="col-span-3">
                        <p className="text-sm text-[var(--muted)]">{formatDateTime(unsub.created)}</p>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => setRemoveTarget({ type: 'unsub', id: unsub.id })}
                          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                          title="Remove from suppression"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          doNotContactCompanies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
              <AlertTriangle size={32} className="mb-2 opacity-50" />
              <p className="text-sm">No companies flagged as Do Not Contact</p>
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)] px-4 py-3">
                <div className="grid grid-cols-12 gap-4 text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
                  <div className="col-span-4">Company</div>
                  <div className="col-span-3">Email</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-2">Updated</div>
                  <div className="col-span-1"></div>
                </div>
              </div>
              <div className="divide-y divide-[var(--card-border)]">
                {doNotContactCompanies.map((company) => (
                  <div key={company.id} className="px-4 py-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4">
                        <CompanyHoverCard company={company}>
                          <div className="cursor-default">
                            <p className="text-sm font-medium truncate">{company.company_name}</p>
                            {company.owner_name && (
                              <p className="text-xs text-[var(--muted)] truncate">{company.owner_name}</p>
                            )}
                          </div>
                        </CompanyHoverCard>
                      </div>
                      <div className="col-span-3">
                        <p className="text-sm text-[var(--muted)] truncate">{company.email || '—'}</p>
                      </div>
                      <div className="col-span-2">
                        {Array.isArray(company.status) && company.status.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {company.status.map((s) => (
                              <span key={s} className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--card-hover)] text-[var(--muted)]">
                                {s}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm text-[var(--muted)]">{formatDateTime(company.updated)}</p>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          onClick={() => setRemoveTarget({ type: 'dnc', id: company.id })}
                          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                          title="Remove Do Not Contact flag"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--muted)]">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Remove Suppression"
        message={removeTarget?.type === 'unsub'
          ? 'This will remove the unsubscribe record. The contact may receive emails again.'
          : 'This will remove the Do Not Contact flag. The company may be included in future campaigns.'}
        confirmText="Remove"
        variant="warning"
        isLoading={removing}
      />
    </div>
  );
}
