'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Building2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  CalendarClock,
  CalendarCheck,
  StickyNote,
  Instagram,
  Mail,
  Send,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { getOutcomeColors } from '@/lib/call-outcomes';
import type {
  Company,
  CallLog,
  FollowUp,
  CompanyNote,
  Interaction,
  ColdCall,
} from '@/lib/types';

// ============================================================================
// Timeline item types
// ============================================================================

interface TimelineItem {
  id: string;
  type: 'company_created' | 'call' | 'follow_up_scheduled' | 'follow_up_completed' | 'follow_up_dismissed' | 'note_added' | 'interaction' | 'email_sent';
  timestamp: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
}

interface CompanyTimelineProps {
  company: Company;
  callLogs: CallLog[];
  followUps: FollowUp[];
  notes: CompanyNote[];
  interactions: Interaction[];
}

export function CompanyTimeline({ company, callLogs, followUps, notes, interactions }: CompanyTimelineProps) {
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];

    // 1. Company created
    items.push({
      id: `company-created-${company.id}`,
      type: 'company_created',
      timestamp: company.created,
      icon: <Building2 size={14} />,
      iconBg: 'bg-[var(--primary-subtle)] text-[var(--primary)]',
      title: 'Company added to CRM',
      description: company.source ? `Source: ${company.source}` : undefined,
    });

    // 2. Call logs
    for (const call of callLogs) {
      const outcomes = Array.isArray(call.call_outcome) ? call.call_outcome : call.call_outcome ? [call.call_outcome] : [];
      const coldCall = call.expand?.cold_call as ColdCall | undefined;
      const callerName = call.expand?.caller?.name;
      const phoneName = call.expand?.phone_number_record?.label || call.expand?.phone_number_record?.phone_number;
      const isInbound = call.direction === 'inbound';
      const duration = call.call_duration ?? call.duration;

      items.push({
        id: `call-${call.id}`,
        type: 'call',
        timestamp: call.call_time,
        icon: isInbound ? <PhoneIncoming size={14} /> : <PhoneOutgoing size={14} />,
        iconBg: outcomes.some(o => o === 'Interested' || o === 'Callback')
          ? 'bg-[var(--success-subtle)] text-[var(--success)]'
          : outcomes.some(o => o === 'Not Interested' || o === 'Hung Up (Rude Recep)' || o === 'Hung Up (Other)' || o === 'Bad Lead')
            ? 'bg-[var(--error-subtle)] text-[var(--error)]'
            : 'bg-blue-500/10 text-blue-500',
        title: `${isInbound ? 'Incoming' : 'Outbound'} call${phoneName ? ` — ${phoneName}` : ''}`,
        description: call.post_call_notes || undefined,
        meta: (
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {outcomes.map(oc => {
              const colors = getOutcomeColors(oc);
              return (
                <span key={oc} className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold", colors.bg, colors.text)}>
                  {oc}
                </span>
              );
            })}
            {duration != null && duration > 0 && (
              <span className="text-[10px] text-[var(--muted)] font-medium">
                {Math.floor(duration / 60) > 0 ? `${Math.floor(duration / 60)}m ` : ''}{duration % 60}s
              </span>
            )}
            {callerName && (
              <span className="text-[10px] text-[var(--muted)]">by <span className="font-bold text-[var(--foreground)]">{callerName}</span></span>
            )}
            {coldCall && (
              <Link
                href={`/cold-calls/${coldCall.id}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--info-subtle)] text-[var(--info)] text-[10px] font-medium hover:opacity-80"
              >
                <Zap size={9} /> AI
              </Link>
            )}
          </div>
        ),
      });
    }

    // 3. Follow-ups
    for (const fu of followUps) {
      const createdByName = fu.expand?.created_by?.name;
      const assignedToName = fu.expand?.assigned_to?.name;

      // Follow-up scheduled event
      items.push({
        id: `fu-scheduled-${fu.id}`,
        type: 'follow_up_scheduled',
        timestamp: fu.created,
        icon: <CalendarClock size={14} />,
        iconBg: 'bg-orange-500/10 text-orange-500',
        title: `Follow-up scheduled for ${formatDateTime(fu.scheduled_time)}`,
        description: fu.notes || undefined,
        meta: (
          <div className="flex items-center gap-2 mt-1">
            {createdByName && (
              <span className="text-[10px] text-[var(--muted)]">by <span className="font-bold text-[var(--foreground)]">{createdByName}</span></span>
            )}
            {assignedToName && (
              <span className="text-[10px] text-[var(--muted)]">assigned to <span className="font-bold text-[var(--foreground)]">{assignedToName}</span></span>
            )}
          </div>
        ),
      });

      // Follow-up completed/dismissed event
      if (fu.status === 'completed' && fu.completed_at) {
        items.push({
          id: `fu-completed-${fu.id}`,
          type: 'follow_up_completed',
          timestamp: fu.completed_at,
          icon: <CheckCircle2 size={14} />,
          iconBg: 'bg-[var(--success-subtle)] text-[var(--success)]',
          title: 'Follow-up completed',
          description: fu.notes || undefined,
        });
      } else if (fu.status === 'dismissed') {
        items.push({
          id: `fu-dismissed-${fu.id}`,
          type: 'follow_up_dismissed',
          timestamp: fu.updated,
          icon: <XCircle size={14} />,
          iconBg: 'bg-[var(--error-subtle)] text-[var(--error)]',
          title: 'Follow-up dismissed',
          description: fu.notes || undefined,
        });
      }
    }

    // 4. Notes
    for (const note of notes) {
      const authorName = note.expand?.created_by?.name;
      items.push({
        id: `note-${note.id}`,
        type: 'note_added',
        timestamp: note.created,
        icon: <StickyNote size={14} />,
        iconBg: 'bg-yellow-500/10 text-yellow-500',
        title: `${note.note_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} note added`,
        description: note.content.length > 120 ? note.content.substring(0, 120) + '...' : note.content,
        meta: authorName ? (
          <span className="text-[10px] text-[var(--muted)] mt-1 block">by <span className="font-bold text-[var(--foreground)]">{authorName}</span></span>
        ) : undefined,
      });
    }

    // 5. Interactions (non-phone ones — phone interactions are already covered by call logs)
    for (const interaction of interactions) {
      // Skip phone interactions since call logs already cover those
      if (interaction.channel === 'phone') continue;

      const userName = interaction.expand?.user?.name;
      const isEmail = interaction.channel === 'email';
      const isInstagram = interaction.channel === 'instagram';

      items.push({
        id: `interaction-${interaction.id}`,
        type: isEmail ? 'email_sent' : 'interaction',
        timestamp: interaction.timestamp,
        icon: isEmail ? <Mail size={14} /> : isInstagram ? <Instagram size={14} /> : <Send size={14} />,
        iconBg: isEmail
          ? 'bg-violet-500/10 text-violet-500'
          : isInstagram
            ? 'bg-pink-500/10 text-pink-500'
            : 'bg-[var(--info-subtle)] text-[var(--info)]',
        title: `${interaction.channel.charAt(0).toUpperCase() + interaction.channel.slice(1)} ${interaction.direction}`,
        description: interaction.summary || undefined,
        meta: userName ? (
          <span className="text-[10px] text-[var(--muted)] mt-1 block">by <span className="font-bold text-[var(--foreground)]">{userName}</span></span>
        ) : undefined,
      });
    }

    // Sort by timestamp descending (newest first)
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return items;
  }, [company, callLogs, followUps, notes, interactions]);

  // Group items by date
  const groupedItems = useMemo(() => {
    const groups: { date: string; label: string; items: TimelineItem[] }[] = [];
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const item of timelineItems) {
      const itemDate = new Date(item.timestamp);
      const dateKey = itemDate.toISOString().split('T')[0];

      let label: string;
      if (dateKey === today.toISOString().split('T')[0]) {
        label = 'Today';
      } else if (dateKey === yesterday.toISOString().split('T')[0]) {
        label = 'Yesterday';
      } else {
        label = itemDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      }

      const existing = groups.find(g => g.date === dateKey);
      if (existing) {
        existing.items.push(item);
      } else {
        groups.push({ date: dateKey, label, items: [item] });
      }
    }

    return groups;
  }, [timelineItems]);

  if (timelineItems.length === 0) {
    return (
      <div className="py-24 text-center">
        <Clock size={48} className="mx-auto text-[var(--card-border)] mb-4" />
        <p className="text-[var(--muted)] font-medium">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Stats bar */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Total Events', value: timelineItems.length, color: 'var(--foreground)' },
          { label: 'Calls', value: callLogs.length, color: 'var(--info)' },
          { label: 'Follow-Ups', value: followUps.length, color: 'orange' },
          { label: 'Notes', value: notes.length, color: 'rgb(234 179 8)' },
          { label: 'Interactions', value: interactions.filter(i => i.channel !== 'phone').length, color: 'var(--primary)' },
        ].map(stat => (
          <div key={stat.label} className="px-3 py-1.5 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-xs">
            <span className="text-[var(--muted)]">{stat.label}: </span>
            <span className="font-bold">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Grouped timeline */}
      {groupedItems.map((group) => (
        <div key={group.date}>
          <div className="sticky top-0 z-10 flex items-center gap-3 mb-4">
            <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest bg-[var(--background)] pr-3">{group.label}</span>
            <div className="flex-1 h-px bg-[var(--card-border)]" />
            <span className="text-[10px] text-[var(--muted)] bg-[var(--background)] pl-3">{group.items.length} event{group.items.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="space-y-0 relative ml-5 md:ml-8 border-l-2 border-[var(--card-border)]">
            {group.items.map((item) => (
              <div key={item.id} className="relative pl-8 pb-6 last:pb-0 group">
                {/* Dot on the line */}
                <div className={cn(
                  "absolute -left-[13px] top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 border-[var(--background)]",
                  item.iconBg
                )}>
                  {item.icon}
                </div>

                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 hover:border-[var(--sidebar-border)] transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <time className="text-[10px] text-[var(--muted)] font-medium whitespace-nowrap">
                        {new Date(item.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </time>
                      <span className="text-[9px] text-[var(--muted)]">{timeAgo(item.timestamp)}</span>
                    </div>
                  </div>
                  {item.description && (
                    <p className="text-xs text-[var(--muted)] mt-1.5 leading-relaxed">{item.description}</p>
                  )}
                  {item.meta}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
