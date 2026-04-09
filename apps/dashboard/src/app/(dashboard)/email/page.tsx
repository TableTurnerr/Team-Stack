'use client';

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import { EMAIL_COLLECTIONS, type EmailTemplate, type EmailCampaign } from '@/lib/email-types';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  Mail,
  FileText,
  Send,
  Users,
  BarChart3,
  Workflow,
  Plus,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { CardGridSkeleton } from '@/components/dashboard-skeletons';
import { PageGuard } from '@/components/page-guard';

export default function EmailHubPage() {
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    templates: 0,
    campaigns: 0,
    sentCampaigns: 0,
    totalSent: 0,
  });
  const [recentCampaigns, setRecentCampaigns] = useState<EmailCampaign[]>([]);
  const [recentTemplates, setRecentTemplates] = useState<EmailTemplate[]>([]);

  useEffect(() => {
    if (!isAuthenticated) return;
    async function load() {
      try {
        const [templates, campaigns] = await Promise.all([
          pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).getList<EmailTemplate>(1, 4, { sort: '-updated' }),
          pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).getList<EmailCampaign>(1, 5, { sort: '-updated' }),
        ]);

        setRecentTemplates(templates.items);
        setRecentCampaigns(campaigns.items);

        const sentCampaigns = campaigns.items.filter((c) => c.status === 'sent');
        const totalSent = sentCampaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);

        setStats({
          templates: templates.totalItems,
          campaigns: campaigns.totalItems,
          sentCampaigns: sentCampaigns.length,
          totalSent,
        });
      } catch (err) {
        if ((err as { status?: number })?.status !== 0) console.error('Error loading email hub:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isAuthenticated]);

  if (loading) return <CardGridSkeleton />;

  const quickLinks = [
    { href: '/email/templates', label: 'Templates', icon: FileText, desc: 'Email designs', count: stats.templates },
    { href: '/email/campaigns', label: 'Campaigns', icon: Send, desc: 'Send emails', count: stats.campaigns },
    { href: '/email/lists', label: 'Audiences', icon: Users, desc: 'Manage lists' },
    { href: '/email/sequences', label: 'Sequences', icon: Workflow, desc: 'Drip campaigns' },
    { href: '/email/analytics', label: 'Analytics', icon: BarChart3, desc: 'Performance' },
  ];

  const STATUS_COLORS: Record<string, string> = {
    draft: 'var(--muted)',
    scheduled: 'var(--warning)',
    sending: 'var(--primary)',
    sent: 'var(--success)',
    paused: 'var(--warning)',
    cancelled: 'var(--error)',
  };

  return (
    <PageGuard pageKey="email">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Marketing</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Create, send, and track email campaigns</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/email/templates/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors text-sm font-medium"
          >
            <FileText size={16} />
            New Template
          </Link>
          <Link
            href="/email/campaigns/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            New Campaign
          </Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
          <div className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">Templates</div>
          <div className="text-2xl font-bold mt-1">{stats.templates}</div>
        </div>
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
          <div className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">Campaigns</div>
          <div className="text-2xl font-bold mt-1">{stats.campaigns}</div>
        </div>
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
          <div className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">Sent</div>
          <div className="text-2xl font-bold mt-1">{stats.sentCampaigns}</div>
        </div>
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
          <div className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">Emails Sent</div>
          <div className="text-2xl font-bold mt-1">{stats.totalSent.toLocaleString()}</div>
        </div>
      </div>

      {/* Quick links grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:bg-[var(--card-hover)] transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-[var(--primary-subtle)] flex items-center justify-center mb-3">
              <link.icon size={20} className="text-[var(--primary)]" />
            </div>
            <div className="text-sm font-semibold">{link.label}</div>
            <div className="text-xs text-[var(--muted)]">{link.desc}</div>
            {link.count !== undefined && (
              <div className="text-xs text-[var(--muted)] mt-1">{link.count} total</div>
            )}
          </Link>
        ))}
      </div>

      {/* Recent campaigns */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
          <h2 className="text-sm font-semibold">Recent Campaigns</h2>
          <Link href="/email/campaigns" className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {recentCampaigns.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center mx-auto mb-3">
              <Send size={18} className="text-[var(--primary)]" />
            </div>
            <p className="text-sm text-[var(--muted)]">No campaigns yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {recentCampaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/email/campaigns/${campaign.id}`}
                className="flex items-center gap-3 p-4 hover:bg-[var(--card-hover)] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{campaign.name}</div>
                  <div className="text-xs text-[var(--muted)] truncate">{campaign.subject || 'No subject'}</div>
                </div>
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full capitalize"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${STATUS_COLORS[campaign.status] || 'var(--muted)'} 15%, transparent)`,
                    color: STATUS_COLORS[campaign.status] || 'var(--muted)',
                  }}
                >
                  {campaign.status}
                </span>
                <span className="text-xs text-[var(--muted)] shrink-0">
                  {campaign.updated ? format(new Date(campaign.updated), 'MMM d') : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent templates */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
          <h2 className="text-sm font-semibold">Recent Templates</h2>
          <Link href="/email/templates" className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        </div>
        {recentTemplates.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center mx-auto mb-3">
              <FileText size={18} className="text-[var(--primary)]" />
            </div>
            <p className="text-sm text-[var(--muted)]">No templates yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {recentTemplates.map((t) => (
              <Link
                key={t.id}
                href={`/email/templates/${t.id}`}
                className="flex items-center gap-3 p-4 hover:bg-[var(--card-hover)] transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-[var(--primary-subtle)] flex items-center justify-center shrink-0">
                  <FileText size={14} className="text-[var(--primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-xs text-[var(--muted)] truncate">{t.subject || 'No subject'}</div>
                </div>
                {t.category && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--card-hover)] text-[var(--muted)]">
                    {t.category}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
    </PageGuard>
  );
}
