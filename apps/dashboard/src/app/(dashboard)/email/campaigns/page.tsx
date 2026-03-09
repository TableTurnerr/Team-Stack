'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailCampaign, type CampaignStatus } from '@/lib/email-types';
import {
  RefreshCw, Plus, Send, Mail, Clock, CheckCircle2,
  Pause, XCircle, BarChart3, Users, MousePointerClick, Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime, sanitizeFilterValue } from '@/lib/utils';
import { SearchInput } from '@/components/search-input';
import { TableSkeleton } from '@/components/dashboard-skeletons';

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'sending', label: 'Sending' },
  { key: 'sent', label: 'Sent' },
];

const STATUS_CONFIG: Record<CampaignStatus, { icon: typeof Mail; color: string; label: string }> = {
  draft: { icon: Mail, color: 'bg-[var(--card-hover)] text-[var(--muted)]', label: 'Draft' },
  scheduled: { icon: Clock, color: 'bg-blue-500/10 text-blue-500', label: 'Scheduled' },
  sending: { icon: Send, color: 'bg-orange-500/10 text-orange-500', label: 'Sending' },
  sent: { icon: CheckCircle2, color: 'bg-emerald-500/10 text-emerald-500', label: 'Sent' },
  paused: { icon: Pause, color: 'bg-[var(--warning-subtle)] text-[var(--warning)]', label: 'Paused' },
  cancelled: { icon: XCircle, color: 'bg-red-500/10 text-red-500', label: 'Cancelled' },
};

export default function CampaignsPage() {
  const { isAuthenticated } = useAuth();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCampaigns = async () => {
      setLoading(true);
      try {
        const filters: string[] = [];
        if (search) {
          filters.push(`(name ~ "${sanitizeFilterValue(search)}" || subject ~ "${sanitizeFilterValue(search)}")`);
        }
        if (statusFilter !== 'all') {
          filters.push(`status = "${sanitizeFilterValue(statusFilter)}"`);
        }
        // Exclude A/B child variants from the main list
        filters.push('ab_parent = ""');

        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).getFullList({
          filter: filters.join(' && '),
          sort: '-created',
          expand: 'template,audience_list',
        });
        setCampaigns(result as unknown as EmailCampaign[]);
      } catch (err) {
        console.error('Failed to fetch campaigns:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCampaigns();
  }, [isAuthenticated, search, statusFilter]);

  if (loading && campaigns.length === 0) return <TableSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Send size={24} />
            Campaigns
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Create and manage your email campaigns
          </p>
        </div>
        <a
          href="/email/campaigns/new"
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-primary"
        >
          <Plus size={16} />
          New Campaign
        </a>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          placeholder="Search campaigns..."
          onSearch={setSearch}
          className="flex-1 max-w-sm"
        />
        <div className="flex gap-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors',
                statusFilter === tab.key
                  ? 'bg-[var(--foreground)] text-[var(--background)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-[var(--muted)]" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
          <Mail size={48} className="mb-3 opacity-50" />
          <p className="text-lg font-medium">No campaigns found</p>
          <p className="text-sm mt-1">Create your first campaign to start reaching your audience</p>
          <a
            href="/email/campaigns/new"
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-primary"
          >
            <Plus size={16} />
            Create Campaign
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(campaign => {
            const config = STATUS_CONFIG[campaign.status] ?? STATUS_CONFIG.draft;
            const StatusIcon = config.icon;
            const openRate = campaign.sent_count && campaign.opened_count
              ? Math.round((campaign.opened_count / campaign.sent_count) * 100)
              : null;
            const clickRate = campaign.sent_count && campaign.clicked_count
              ? Math.round((campaign.clicked_count / campaign.sent_count) * 100)
              : null;

            return (
              <a
                key={campaign.id}
                href={`/email/campaigns/${campaign.id}`}
                className="block bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 card-interactive"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-sm">{campaign.name}</h3>
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1', config.color)}>
                        <StatusIcon size={12} />
                        {config.label}
                      </span>
                      {campaign.campaign_type === 'ab_test' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-500">
                          A/B Test
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--muted)] mt-1 truncate">
                      {campaign.subject || 'No subject'}
                    </p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-[var(--muted)]">
                      {campaign.expand?.audience_list && (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {campaign.expand.audience_list.name}
                        </span>
                      )}
                      {campaign.expand?.template && (
                        <span className="flex items-center gap-1">
                          <Mail size={12} />
                          {campaign.expand.template.name}
                        </span>
                      )}
                      <span>{formatDateTime(campaign.created)}</span>
                    </div>
                  </div>

                  {/* Stats (only for sent campaigns) */}
                  {campaign.status === 'sent' && campaign.sent_count ? (
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-center">
                        <p className="text-lg font-bold">{campaign.sent_count}</p>
                        <p className="text-xs text-[var(--muted)]">Sent</p>
                      </div>
                      {openRate !== null && (
                        <div className="text-center">
                          <p className="text-lg font-bold flex items-center gap-1">
                            <Eye size={14} className="text-blue-500" />
                            {openRate}%
                          </p>
                          <p className="text-xs text-[var(--muted)]">Opens</p>
                        </div>
                      )}
                      {clickRate !== null && (
                        <div className="text-center">
                          <p className="text-lg font-bold flex items-center gap-1">
                            <MousePointerClick size={14} className="text-emerald-500" />
                            {clickRate}%
                          </p>
                          <p className="text-xs text-[var(--muted)]">Clicks</p>
                        </div>
                      )}
                    </div>
                  ) : campaign.status === 'scheduled' && campaign.scheduled_at ? (
                    <div className="text-right shrink-0">
                      <p className="text-xs text-[var(--muted)]">Scheduled for</p>
                      <p className="text-sm font-medium">{formatDateTime(campaign.scheduled_at)}</p>
                    </div>
                  ) : null}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
