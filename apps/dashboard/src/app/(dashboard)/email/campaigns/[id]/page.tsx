'use client';

import { useState, useEffect, use } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import {
  EMAIL_COLLECTIONS,
  type EmailCampaign,
  type EmailRecipient,
  type CampaignStatus,
} from '@/lib/email-types';
import {
  ArrowLeft, Send, Clock, CheckCircle2, Pause, XCircle,
  Mail, RefreshCw, Users, Eye, MousePointerClick, AlertTriangle,
  Ban, Edit2, Play
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime, sanitizeFilterValue } from '@/lib/utils';
import { StatsCard } from '@/components/stats-card';
import { SearchInput } from '@/components/search-input';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { DashboardSkeleton } from '@/components/dashboard-skeletons';

const STATUS_CONFIG: Record<CampaignStatus, { icon: typeof Mail; color: string; label: string }> = {
  draft: { icon: Mail, color: 'bg-[var(--card-hover)] text-[var(--muted)]', label: 'Draft' },
  scheduled: { icon: Clock, color: 'bg-blue-500/10 text-blue-500', label: 'Scheduled' },
  sending: { icon: Send, color: 'bg-orange-500/10 text-orange-500', label: 'Sending' },
  sent: { icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-500', label: 'Sent' },
  paused: { icon: Pause, color: 'bg-[var(--warning-subtle)] text-[var(--warning)]', label: 'Paused' },
  cancelled: { icon: XCircle, color: 'bg-red-500/10 text-red-500', label: 'Cancelled' },
};

const RECIPIENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[var(--card-hover)] text-[var(--muted)]',
  sent: 'bg-blue-500/10 text-blue-500',
  delivered: 'bg-emerald-500/10 text-emerald-500',
  opened: 'bg-purple-500/10 text-purple-500',
  clicked: 'bg-teal-500/10 text-teal-500',
  bounced: 'bg-red-500/10 text-red-500',
  unsubscribed: 'bg-orange-500/10 text-orange-500',
};

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { isAuthenticated } = useAuth();
  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const perPage = 25;

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCampaign = async () => {
      try {
        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).getOne(id, {
          expand: 'template,audience_list,exclusion_list',
        });
        setCampaign(result as unknown as EmailCampaign);
      } catch (err) {
        console.error('Failed to fetch campaign:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCampaign();
  }, [isAuthenticated, id]);

  useEffect(() => {
    if (!isAuthenticated || !campaign) return;
    const fetchRecipients = async () => {
      setRecipientsLoading(true);
      try {
        const filters: string[] = [`campaign = "${sanitizeFilterValue(id)}"`];
        if (search) {
          const safe = sanitizeFilterValue(search);
          filters.push(`(email_address ~ "${safe}")`);
        }
        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_RECIPIENTS).getList(page, perPage, {
          filter: filters.join(' && '),
          sort: '-created',
          expand: 'company',
        });
        setRecipients(result.items as unknown as EmailRecipient[]);
        setTotalPages(result.totalPages);
      } catch (err) {
        console.error('Failed to fetch recipients:', err);
      } finally {
        setRecipientsLoading(false);
      }
    };
    fetchRecipients();
  }, [isAuthenticated, campaign, id, search, page]);

  const handleStatusChange = async (newStatus: CampaignStatus) => {
    if (!campaign) return;
    setActionLoading(true);
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).update(campaign.id, { status: newStatus });
      setCampaign(prev => prev ? { ...prev, status: newStatus } : null);
    } catch (err) {
      console.error('Failed to update campaign status:', err);
    } finally {
      setActionLoading(false);
      setCancelConfirm(false);
    }
  };

  if (loading) return <DashboardSkeleton />;
  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
        <p className="text-lg font-medium">Campaign not found</p>
        <a href="/email/campaigns" className="text-sm text-[var(--primary)] mt-2 hover:underline">
          Back to campaigns
        </a>
      </div>
    );
  }

  const config = STATUS_CONFIG[campaign.status] ?? STATUS_CONFIG.draft;
  const StatusIcon = config.icon;

  const openRate = campaign.sent_count && campaign.opened_count
    ? ((campaign.opened_count / campaign.sent_count) * 100).toFixed(1)
    : '0';
  const clickRate = campaign.sent_count && campaign.clicked_count
    ? ((campaign.clicked_count / campaign.sent_count) * 100).toFixed(1)
    : '0';
  const bounceRate = campaign.sent_count && campaign.bounced_count
    ? ((campaign.bounced_count / campaign.sent_count) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <a
            href="/email/campaigns"
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors mt-1"
          >
            <ArrowLeft size={20} />
          </a>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
              <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1', config.color)}>
                <StatusIcon size={12} />
                {config.label}
              </span>
              {campaign.campaign_type === 'ab_test' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-500">
                  A/B Test
                </span>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] mt-1">{campaign.subject || 'No subject'}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-[var(--muted)]">
              {campaign.expand?.template && (
                <span>Template: {campaign.expand.template.name}</span>
              )}
              {campaign.expand?.audience_list && (
                <span>Audience: {campaign.expand.audience_list.name}</span>
              )}
              {campaign.sent_at && (
                <span>Sent: {formatDateTime(campaign.sent_at)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {campaign.status === 'draft' && (
            <a
              href={`/email/campaigns/new?edit=${campaign.id}`}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg btn-ghost border border-[var(--card-border)]"
            >
              <Edit2 size={14} />
              Edit
            </a>
          )}
          {campaign.status === 'paused' && (
            <button
              onClick={() => handleStatusChange('sending')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg btn-primary disabled:opacity-50"
            >
              <Play size={14} />
              Resume
            </button>
          )}
          {campaign.status === 'sending' && (
            <button
              onClick={() => handleStatusChange('paused')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg btn-ghost border border-[var(--card-border)] disabled:opacity-50"
            >
              <Pause size={14} />
              Pause
            </button>
          )}
          {(campaign.status === 'draft' || campaign.status === 'scheduled' || campaign.status === 'paused') && (
            <button
              onClick={() => setCancelConfirm(true)}
              disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-[var(--error)] hover:bg-[var(--error-subtle)] border border-[var(--card-border)] disabled:opacity-50 transition-colors"
            >
              <Ban size={14} />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {(campaign.status === 'sent' || campaign.status === 'sending') && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
          <StatsCard title="Sent" value={campaign.sent_count ?? 0} icon={Send} variant="default" />
          <StatsCard title="Delivered" value={campaign.delivered_count ?? 0} icon={CheckCircle2} variant="primary" />
          <StatsCard title="Opened" value={`${openRate}%`} icon={Eye} description={`${campaign.opened_count ?? 0} opens`} />
          <StatsCard title="Clicked" value={`${clickRate}%`} icon={MousePointerClick} description={`${campaign.clicked_count ?? 0} clicks`} />
          <StatsCard title="Bounced" value={`${bounceRate}%`} icon={AlertTriangle} description={`${campaign.bounced_count ?? 0} bounces`} variant="accent" />
          <StatsCard title="Unsubscribed" value={campaign.unsubscribed_count ?? 0} icon={Ban} />
        </div>
      )}

      {/* Recipients Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users size={18} />
            Recipients
          </h2>
          <SearchInput
            placeholder="Search by email..."
            onSearch={(v) => { setSearch(v); setPage(1); }}
            className="w-64"
          />
        </div>

        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
          {recipientsLoading ? (
            <div className="flex items-center justify-center py-12 text-[var(--muted)]">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading recipients...
            </div>
          ) : recipients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
              <Users size={32} className="mb-2 opacity-50" />
              <p className="text-sm">
                {campaign.status === 'draft' ? 'Recipients will appear after sending' : 'No recipients found'}
              </p>
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)] px-4 py-3">
                <div className="grid grid-cols-12 gap-4 text-xs uppercase tracking-wider text-[var(--muted)] font-medium">
                  <div className="col-span-3">Email</div>
                  <div className="col-span-2">Company</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-1">Opens</div>
                  <div className="col-span-1">Clicks</div>
                  <div className="col-span-3 hidden md:block">Timestamps</div>
                </div>
              </div>

              <div className="divide-y divide-[var(--card-border)]">
                {recipients.map(recipient => (
                  <div key={recipient.id} className="px-4 py-3 hover:bg-[var(--card-hover)] transition-colors">
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-3 min-w-0">
                        <p className="text-sm truncate">{recipient.email_address}</p>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <p className="text-sm text-[var(--muted)] truncate">
                          {recipient.expand?.company?.company_name ?? '—'}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                          RECIPIENT_STATUS_COLORS[recipient.status] ?? RECIPIENT_STATUS_COLORS.pending
                        )}>
                          {recipient.status}
                        </span>
                      </div>
                      <div className="col-span-1">
                        <span className="text-sm">{recipient.open_count ?? 0}</span>
                      </div>
                      <div className="col-span-1">
                        <span className="text-sm">{recipient.click_count ?? 0}</span>
                      </div>
                      <div className="col-span-3 hidden md:block">
                        <div className="text-xs text-[var(--muted)] space-y-0.5">
                          {recipient.sent_at && <p>Sent: {formatDateTime(recipient.sent_at)}</p>}
                          {recipient.opened_at && <p>Opened: {formatDateTime(recipient.opened_at)}</p>}
                          {recipient.clicked_at && <p>Clicked: {formatDateTime(recipient.clicked_at)}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
      </div>

      <ConfirmationModal
        isOpen={cancelConfirm}
        onClose={() => setCancelConfirm(false)}
        onConfirm={() => handleStatusChange('cancelled')}
        title="Cancel Campaign"
        message="This will cancel the campaign. Any unsent emails will not be delivered. This action cannot be undone."
        confirmText="Cancel Campaign"
        variant="danger"
        isLoading={actionLoading}
      />
    </div>
  );
}
