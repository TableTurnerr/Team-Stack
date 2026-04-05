'use client';

import { useState, useEffect, use } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailList } from '@/lib/email-types';
import { RefreshCw, ArrowLeft, Save, Users, Filter as FilterIcon, Database, ShieldBan } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ListBuilder, type FilterRule } from '@/components/email/list-builder';
import { ListMembersTable } from '@/components/email/list-members-table';
import { SuppressionManager } from '@/components/email/suppression-manager';
import { DashboardSkeleton } from '@/components/dashboard-skeletons';
import Link from 'next/link';
import { PageGuard } from '@/components/page-guard';

export default function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isAuthenticated } = useAuth();
  const [list, setList] = useState<EmailList | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchList = async () => {
      setLoading(true);
      try {
        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).getOne(id);
        const emailList = result as unknown as EmailList;
        setList(emailList);
        setName(emailList.name);
        // Parse filter_json into FilterRule[]
        if (emailList.list_type === 'dynamic' && emailList.filter_json) {
          const parsed = emailList.filter_json as unknown;
          if (Array.isArray(parsed)) {
            setFilters(parsed as FilterRule[]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch list:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchList();
  }, [isAuthenticated, id]);

  const handleSave = async () => {
    if (!list) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = { name };
      if (list.list_type === 'dynamic') {
        updates.filter_json = filters;
      }
      const updated = await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).update(list.id, updates);
      setList(updated as unknown as EmailList);
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save list:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <DashboardSkeleton />;
  if (!list) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
        <p className="text-lg font-medium">List not found</p>
        <Link
          href="/email/lists"
          className="text-sm text-[var(--primary)] mt-2 hover:underline"
        >
          Back to lists
        </Link>
      </div>
    );
  }

  const typeIcons = { static: Database, dynamic: FilterIcon, suppression: ShieldBan };
  const TypeIcon = typeIcons[list.list_type] ?? Users;

  return (
    <PageGuard pageKey="email">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/email/lists"
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2.5 rounded-lg',
              list.list_type === 'dynamic' ? 'bg-purple-500/10 text-purple-500' :
              list.list_type === 'static' ? 'bg-blue-500/10 text-blue-500' :
              'bg-red-500/10 text-red-500'
            )}>
              <TypeIcon size={20} />
            </div>
            <div>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setHasChanges(true); }}
                className="text-2xl font-bold tracking-tight bg-transparent border-none outline-none focus:ring-0 w-full"
              />
              <p className="text-sm text-[var(--muted)] capitalize">{list.list_type} list</p>
            </div>
          </div>
        </div>

        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-primary disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Save Changes
          </button>
        )}
      </div>

      {/* Dynamic list: filter builder */}
      {list.list_type === 'dynamic' && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5">
          <ListBuilder
            filters={filters}
            onChange={(f) => { setFilters(f); setHasChanges(true); }}
          />
        </div>
      )}

      {/* Members or Suppression */}
      {list.list_type === 'suppression' ? (
        <SuppressionManager />
      ) : (
        <ListMembersTable
          listType={list.list_type}
          companyIds={list.list_type === 'static' ? list.company_ids : undefined}
          filterRules={list.list_type === 'dynamic' ? filters : undefined}
        />
      )}
    </div>
    </PageGuard>
  );
}
