'use client';

import { useEffect, useState } from 'react';
import { Loader2, UserMinus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailSequenceEnrollment, type EnrollmentStatus } from '@/lib/email-types';
import { cn } from '@/lib/utils';

interface EnrollmentTableProps {
  sequenceId: string;
}

const STATUS_COLORS: Record<EnrollmentStatus, string> = {
  active: 'bg-[var(--success)]/10 text-[var(--success)]',
  completed: 'bg-[var(--primary)]/10 text-[var(--primary)]',
  stopped_reply: 'bg-[var(--warning)]/10 text-[var(--warning)]',
  stopped_status: 'bg-[var(--muted)]/20 text-[var(--muted)]',
  stopped_manual: 'bg-[var(--error)]/10 text-[var(--error)]',
};

const STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  stopped_reply: 'Stopped (Reply)',
  stopped_status: 'Stopped (Status)',
  stopped_manual: 'Stopped (Manual)',
};

export function EnrollmentTable({ sequenceId }: EnrollmentTableProps) {
  const [enrollments, setEnrollments] = useState<EmailSequenceEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatus | 'all'>('all');
  const perPage = 20;

  useEffect(() => {
    const fetchEnrollments = async () => {
      setLoading(true);
      try {
        let filter = `sequence = "${sequenceId}"`;
        if (statusFilter !== 'all') {
          filter += ` && status = "${statusFilter}"`;
        }
        if (search) {
          filter += ` && company.company_name ~ "${search}"`;
        }

        const data = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_ENROLLMENTS).getList<EmailSequenceEnrollment>(
          page, perPage,
          {
            filter,
            sort: '-enrolled_at',
            expand: 'company',
          }
        );

        setEnrollments(data.items);
        setTotalPages(data.totalPages);
      } catch (error) {
        console.error('Failed to fetch enrollments:', error);
        setEnrollments([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEnrollments();
  }, [sequenceId, page, statusFilter, search]);

  const handleStopEnrollment = async (enrollmentId: string) => {
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_ENROLLMENTS).update(enrollmentId, {
        status: 'stopped_manual',
      });
      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'stopped_manual' as EnrollmentStatus } : e)
      );
    } catch (error) {
      console.error('Failed to stop enrollment:', error);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search companies..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as EnrollmentStatus | 'all'); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
        >
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
        </div>
      ) : enrollments.length === 0 ? (
        <div className="text-center py-12 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl">
          <p className="text-sm text-[var(--muted)]">No enrollments found</p>
        </div>
      ) : (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--card-border)]">
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Step</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Enrolled</th>
                  <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Next Send</th>
                  <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => (
                  <tr key={enrollment.id} className="border-b border-[var(--card-border)] last:border-0 hover:bg-[var(--card-hover)] transition-colors">
                    <td className="px-4 py-3 font-medium">
                      {enrollment.expand?.company?.company_name || 'Unknown'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', STATUS_COLORS[enrollment.status])}>
                        {STATUS_LABELS[enrollment.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      Step {enrollment.current_step || 1}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {formatDate(enrollment.enrolled_at)}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {enrollment.status === 'active' ? formatDate(enrollment.next_send_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {enrollment.status === 'active' && (
                        <button
                          onClick={() => handleStopEnrollment(enrollment.id)}
                          className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                          title="Stop enrollment"
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--card-border)]">
              <p className="text-xs text-[var(--muted)]">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
