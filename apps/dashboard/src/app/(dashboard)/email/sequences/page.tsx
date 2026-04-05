'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2, Play, Pause, Mail, Search, MoreVertical, Trash2, Copy, ArrowLeft } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailSequence, type SequenceStatus } from '@/lib/email-types';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { PageGuard } from '@/components/page-guard';

const STATUS_COLORS: Record<SequenceStatus, string> = {
  active: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20',
  paused: 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/20',
  draft: 'bg-[var(--card-hover)] text-[var(--muted)] border-[var(--card-border)]',
  archived: 'bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--card-border)]',
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  status_change: 'Status Change',
  new_company: 'New Company',
  tag_added: 'Tag Added',
};

export default function SequencesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SequenceStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  useEffect(() => {
    const fetchSequences = async () => {
      try {
        let filter = '';
        if (statusFilter !== 'all') {
          filter = `status = "${statusFilter}"`;
        }
        if (search) {
          const searchFilter = `name ~ "${search}"`;
          filter = filter ? `${filter} && ${searchFilter}` : searchFilter;
        }

        const data = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).getFullList<EmailSequence>({
          filter: filter || undefined,
          sort: '-created',
        });
        setSequences(data);
      } catch {
        setSequences([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSequences();
  }, [statusFilter, search]);

  const handleCreateSequence = async () => {
    setCreating(true);
    try {
      const newSeq = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).create<EmailSequence>({
        name: 'Untitled Sequence',
        status: 'draft',
        trigger_type: 'manual',
        stop_on_reply: true,
        stop_on_status_change: false,
        created_by: user?.id,
      });
      router.push(`/email/sequences/${newSeq.id}`);
    } catch (error) {
      console.error('Failed to create sequence:', error);
      setCreating(false);
    }
  };

  const handleDuplicate = async (seq: EmailSequence) => {
    try {
      const newSeq = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).create<EmailSequence>({
        name: `${seq.name} (Copy)`,
        status: 'draft',
        trigger_type: seq.trigger_type,
        trigger_config: seq.trigger_config,
        stop_on_reply: seq.stop_on_reply,
        stop_on_status_change: seq.stop_on_status_change,
        stop_statuses: seq.stop_statuses,
        created_by: user?.id,
      });
      setSequences(prev => [newSeq, ...prev]);
      setMenuOpen(null);
    } catch (error) {
      console.error('Failed to duplicate sequence:', error);
    }
  };

  const handleDelete = async (seqId: string) => {
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).delete(seqId);
      setSequences(prev => prev.filter(s => s.id !== seqId));
      setMenuOpen(null);
    } catch (error) {
      console.error('Failed to delete sequence:', error);
    }
  };

  const handleToggleStatus = async (seq: EmailSequence) => {
    const newStatus: SequenceStatus = seq.status === 'active' ? 'paused' : 'active';
    try {
      const updated = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).update<EmailSequence>(seq.id, { status: newStatus });
      setSequences(prev => prev.map(s => s.id === seq.id ? updated : s));
    } catch (error) {
      console.error('Failed to toggle sequence status:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <PageGuard pageKey="email">
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <a
            href="/email"
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors mt-1"
          >
            <ArrowLeft size={20} />
          </a>
          <div>
            <h1 className="text-3xl font-black tracking-tight">Sequences</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Automated drip campaigns that send emails over time</p>
          </div>
        </div>
        <button
          onClick={handleCreateSequence}
          disabled={creating}
          className="px-5 py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-bold hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50 shrink-0"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          New Sequence
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sequences..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
          />
        </div>
        <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--card-bg)]">
          {(['all', 'active', 'paused', 'draft'] as const).map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-md transition-all font-medium capitalize',
                statusFilter === status
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'
              )}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Sequences List */}
      {sequences.length === 0 ? (
        <div className="bg-[var(--card-bg)] border border-dashed border-[var(--card-border)] rounded-xl p-12 text-center">
          <Mail size={32} className="mx-auto text-[var(--muted)] mb-3" />
          <p className="text-sm text-[var(--muted)] font-medium">No sequences found</p>
          <p className="text-xs text-[var(--muted)] mt-1">Create your first automated email sequence</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sequences.map(seq => (
            <div
              key={seq.id}
              className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:bg-[var(--card-hover)] transition-colors cursor-pointer group relative"
              onClick={() => router.push(`/email/sequences/${seq.id}`)}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--primary-subtle)] text-[var(--primary)] flex items-center justify-center shrink-0">
                  <Mail size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold truncate">{seq.name}</h3>
                    <span className={cn('px-2 py-0.5 text-[10px] font-bold rounded-full border', STATUS_COLORS[seq.status])}>
                      {seq.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    Trigger: {TRIGGER_LABELS[seq.trigger_type] || seq.trigger_type}
                    {seq.stop_on_reply && ' · Stops on reply'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {seq.status !== 'draft' && (
                    <button
                      onClick={() => handleToggleStatus(seq)}
                      className={cn(
                        'p-2 rounded-lg transition-colors',
                        seq.status === 'active'
                          ? 'text-[var(--warning)] hover:bg-[var(--warning)]/10'
                          : 'text-[var(--success)] hover:bg-[var(--success)]/10'
                      )}
                      title={seq.status === 'active' ? 'Pause' : 'Activate'}
                    >
                      {seq.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                  )}

                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === seq.id ? null : seq.id)}
                      className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                    >
                      <MoreVertical size={14} />
                    </button>

                    {menuOpen === seq.id && (
                      <div className="absolute right-0 top-full mt-1 w-40 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl z-10 py-1">
                        <button
                          onClick={() => handleDuplicate(seq)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--card-hover)] transition-colors"
                        >
                          <Copy size={14} />
                          Duplicate
                        </button>
                        <button
                          onClick={() => handleDelete(seq.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </PageGuard>
  );
}
