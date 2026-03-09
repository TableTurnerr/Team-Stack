'use client';

import { useEffect, useState, useMemo } from 'react';
import { Loader2, ArrowLeft } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailCampaign, type EmailEvent } from '@/lib/email-types';
import { cn } from '@/lib/utils';
import { CampaignStatsCards } from '@/components/email/campaign-stats-cards';
import { CampaignChart } from '@/components/email/campaign-chart';

type PeriodOption = 7 | 14 | 30;

export default function EmailAnalyticsPage() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodOption>(30);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - period);
        const cutoff = cutoffDate.toISOString().replace('T', ' ').split('.')[0];

        const [campaignsData, eventsData] = await Promise.all([
          pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).getFullList<EmailCampaign>({
            filter: `status = "sent" && sent_at >= "${cutoff}"`,
            sort: '-sent_at',
          }),
          pb.collection(EMAIL_COLLECTIONS.EMAIL_EVENTS).getFullList<EmailEvent>({
            filter: `created >= "${cutoff}"`,
            sort: '-created',
          }),
        ]);

        setCampaigns(campaignsData);
        setEvents(eventsData);
      } catch {
        setCampaigns([]);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [period]);

  const aggregatedStats = useMemo(() => {
    return campaigns.reduce(
      (acc, c) => ({
        sent: acc.sent + (c.sent_count || 0),
        delivered: acc.delivered + (c.delivered_count || 0),
        opened: acc.opened + (c.opened_count || 0),
        clicked: acc.clicked + (c.clicked_count || 0),
        bounced: acc.bounced + (c.bounced_count || 0),
        unsubscribed: acc.unsubscribed + (c.unsubscribed_count || 0),
      }),
      { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 }
    );
  }, [campaigns]);

  // Top campaigns by open rate
  const topCampaigns = useMemo(() => {
    return campaigns
      .filter(c => (c.sent_count || 0) > 0)
      .map(c => {
        const delivered = c.delivered_count || 0;
        return {
          ...c,
          openRate: delivered > 0 ? ((c.opened_count || 0) / delivered) * 100 : 0,
          clickRate: delivered > 0 ? ((c.clicked_count || 0) / delivered) * 100 : 0,
        };
      })
      .sort((a, b) => b.openRate - a.openRate)
      .slice(0, 5);
  }, [campaigns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
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
            <h1 className="text-3xl font-black tracking-tight">Email Analytics</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} sent in the last {period} days
            </p>
          </div>
        </div>
        <div className="flex rounded-lg border border-[var(--card-border)] p-0.5 gap-0.5 bg-[var(--card-bg)]">
          {([7, 14, 30] as PeriodOption[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-md transition-all font-medium',
                period === p
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : 'text-[var(--muted)] hover:bg-[var(--card-hover)]'
              )}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Aggregate Stats */}
      <CampaignStatsCards aggregated={aggregatedStats} />

      {/* Chart */}
      <CampaignChart events={events} period={period} />

      {/* Top Campaigns */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--card-border)]">
          <h3 className="text-sm font-semibold">Top Campaigns by Open Rate</h3>
        </div>
        {topCampaigns.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-[var(--muted)]">No sent campaigns in this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--card-border)]">
                  <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Campaign</th>
                  <th className="text-right px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Sent</th>
                  <th className="text-right px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Open Rate</th>
                  <th className="text-right px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Click Rate</th>
                  <th className="text-right px-5 py-3 text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Bounced</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--card-border)] last:border-0 hover:bg-[var(--card-hover)] transition-colors">
                    <td className="px-5 py-3 font-medium">{c.name}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--muted)]">{(c.sent_count || 0).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={c.openRate > 20 ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>
                        {c.openRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={c.clickRate > 3 ? 'text-[var(--success)]' : 'text-[var(--muted)]'}>
                        {c.clickRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-[var(--muted)]">
                      {(c.bounced_count || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
