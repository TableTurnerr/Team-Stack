'use client';

import { Send, CheckCircle2, Eye, MousePointerClick, AlertTriangle, UserMinus } from 'lucide-react';
import { StatsCard } from '@/components/stats-card';
import type { EmailCampaign } from '@/lib/email-types';

interface CampaignStatsCardsProps {
  campaign?: EmailCampaign;
  aggregated?: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    unsubscribed: number;
  };
}

export function CampaignStatsCards({ campaign, aggregated }: CampaignStatsCardsProps) {
  const sent = aggregated?.sent ?? campaign?.sent_count ?? 0;
  const delivered = aggregated?.delivered ?? campaign?.delivered_count ?? 0;
  const opened = aggregated?.opened ?? campaign?.opened_count ?? 0;
  const clicked = aggregated?.clicked ?? campaign?.clicked_count ?? 0;
  const bounced = aggregated?.bounced ?? campaign?.bounced_count ?? 0;
  const unsubscribed = aggregated?.unsubscribed ?? campaign?.unsubscribed_count ?? 0;

  const openRate = delivered > 0 ? ((opened / delivered) * 100) : 0;
  const clickRate = delivered > 0 ? ((clicked / delivered) * 100) : 0;
  const bounceRate = sent > 0 ? ((bounced / sent) * 100) : 0;

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatsCard
        title="Sent"
        value={sent.toLocaleString()}
        icon={Send}
        variant="primary"
      />
      <StatsCard
        title="Delivered"
        value={delivered.toLocaleString()}
        icon={CheckCircle2}
        description={sent > 0 ? `${((delivered / sent) * 100).toFixed(1)}% delivery rate` : undefined}
      />
      <StatsCard
        title="Opened"
        value={opened.toLocaleString()}
        icon={Eye}
        variant="primary"
        description={`${openRate.toFixed(1)}% open rate`}
      />
      <StatsCard
        title="Clicked"
        value={clicked.toLocaleString()}
        icon={MousePointerClick}
        variant="primary"
        description={`${clickRate.toFixed(1)}% click rate`}
      />
      <StatsCard
        title="Bounced"
        value={bounced.toLocaleString()}
        icon={AlertTriangle}
        variant="accent"
        description={`${bounceRate.toFixed(1)}% bounce rate`}
      />
      <StatsCard
        title="Unsubscribed"
        value={unsubscribed.toLocaleString()}
        icon={UserMinus}
        variant="accent"
      />
    </div>
  );
}
