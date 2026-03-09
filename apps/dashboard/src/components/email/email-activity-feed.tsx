'use client';

import { useEffect, useState } from 'react';
import { Send, Eye, MousePointerClick, AlertTriangle, UserMinus, Mail, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailEvent } from '@/lib/email-types';
import { cn } from '@/lib/utils';

interface EmailActivityFeedProps {
  companyId: string;
}

const EVENT_CONFIG: Record<string, { icon: typeof Send; color: string; label: string }> = {
  sent: { icon: Send, color: 'text-[var(--primary)]', label: 'Email sent' },
  delivered: { icon: Mail, color: 'text-[var(--success)]', label: 'Email delivered' },
  opened: { icon: Eye, color: 'text-[var(--info)]', label: 'Email opened' },
  clicked: { icon: MousePointerClick, color: 'text-[var(--primary)]', label: 'Link clicked' },
  bounced: { icon: AlertTriangle, color: 'text-[var(--error)]', label: 'Email bounced' },
  unsubscribed: { icon: UserMinus, color: 'text-[var(--warning)]', label: 'Unsubscribed' },
  complained: { icon: AlertTriangle, color: 'text-[var(--error)]', label: 'Spam complaint' },
};

function formatEventTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function EmailActivityFeed({ companyId }: EmailActivityFeedProps) {
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const data = await pb.collection(EMAIL_COLLECTIONS.EMAIL_EVENTS).getList<EmailEvent>(1, 50, {
          filter: `company = "${companyId}"`,
          sort: '-created',
          expand: 'recipient,recipient.campaign',
        });
        setEvents(data.items);
      } catch {
        // Collection may not exist yet
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [companyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <Mail size={32} className="mx-auto text-[var(--muted)] mb-3" />
        <p className="text-sm text-[var(--muted)] font-medium">No email activity yet</p>
        <p className="text-xs text-[var(--muted)] mt-1">Email sends, opens, and clicks will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event, i) => {
        const config = EVENT_CONFIG[event.event_type] || EVENT_CONFIG.sent;
        const Icon = config.icon;
        const campaignName = (event.expand?.recipient?.expand as Record<string, { name?: string }> | undefined)?.campaign?.name;

        return (
          <div key={event.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--card-hover)] transition-colors">
            <div className={cn('mt-0.5 shrink-0', config.color)}>
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{config.label}</p>
              {campaignName && (
                <p className="text-xs text-[var(--muted)] truncate">{campaignName}</p>
              )}
              {event.event_type === 'clicked' && event.event_data && (
                <p className="text-xs text-[var(--muted)] truncate mt-0.5">
                  {typeof event.event_data === 'object' ? (event.event_data as Record<string, string>).url : ''}
                </p>
              )}
            </div>
            <span className="text-xs text-[var(--muted)] shrink-0 tabular-nums">
              {formatEventTime(event.created)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
