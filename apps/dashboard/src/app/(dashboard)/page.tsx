'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Phone, PhoneCall, CalendarCheck, Activity, RefreshCw, BarChart3,
  Building2, Headphones, Mic, History, StickyNote, TrendingUp,
  Users, Mail, Trash2, Settings, ArrowRight, Compass,
} from 'lucide-react';
import { StatsCard } from '@/components/stats-card';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { EventLog } from '@/lib/types';
import { timeAgo, formatSessionDuration } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

const PAGE_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  '/cold-calls': { label: 'Cold Calls', icon: Phone },
  '/session': { label: 'Call Session', icon: Headphones },
  '/recordings': { label: 'Recordings', icon: Mic },
  '/session-logs': { label: 'Session Logs', icon: History },
  '/notes': { label: 'Notes', icon: StickyNote },
  '/financial': { label: 'Financial', icon: TrendingUp },
  '/team': { label: 'Team', icon: Users },
  '/follow-ups': { label: 'Follow-Ups', icon: CalendarCheck },
  '/companies': { label: 'Companies', icon: Building2 },
  '/email': { label: 'Email Marketing', icon: Mail },
  '/recycle-bin': { label: 'Recycle Bin', icon: Trash2 },
  '/settings': { label: 'Settings', icon: Settings },
};

const DEFAULT_QUICK_ACCESS = [
  '/session', '/companies', '/cold-calls', '/follow-ups', '/notes', '/team',
];

function getQuickAccessPages(): { href: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] {
  try {
    const raw = localStorage.getItem('tt_page_visits');
    const visits: Record<string, { count: number; last: number }> = raw ? JSON.parse(raw) : {};
    const tracked = Object.entries(visits)
      .filter(([path]) => PAGE_META[path])
      .sort(([, a], [, b]) => {
        const scoreA = a.count * 2 + a.last / 1e10;
        const scoreB = b.count * 2 + b.last / 1e10;
        return scoreB - scoreA;
      })
      .slice(0, 6)
      .map(([path]) => path);

    // Fill remaining slots with defaults the user hasn't visited yet
    const result = [...tracked];
    for (const path of DEFAULT_QUICK_ACCESS) {
      if (result.length >= 6) break;
      if (!result.includes(path)) result.push(path);
    }

    return result.map((path) => ({
      href: path,
      label: PAGE_META[path].label,
      icon: PAGE_META[path].icon,
    }));
  } catch {
    return DEFAULT_QUICK_ACCESS.map((path) => ({
      href: path,
      label: PAGE_META[path].label,
      icon: PAGE_META[path].icon,
    }));
  }
}

interface Stats {
  myCalls: number;
  mySessions: number;
  myFollowUps: number;
  myDials: number;
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  source?: string;
  created: string;
}

function getEventDescription(event: EventLog): string {
  const user = event.expand?.user?.name || 'Unknown';
  const actor = event.expand?.actor?.username || '';
  const targetName = event.expand?.company?.company_name || 'Unknown';

  switch (event.event_type) {
    case 'Outreach':
      return `${actor || user} sent outreach to ${targetName}`;
    case 'Cold Call':
      return `${user} made a cold call to ${targetName}`;
    case 'User':
      return event.details || `${user} performed an action`;
    case 'System':
      return event.details || 'System event';
    case 'Change in Tar Info':
      return `${user} updated info for ${targetName}`;
    case 'Tar Exception Toggle':
      return `${user} toggled exception for ${targetName}`;
    default:
      return event.details || 'Activity logged';
  }
}

function getActivityBadge(type: string): { bg: string; text: string } {
  switch (type) {
    case 'Outreach':
      return { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' };
    case 'Cold Call':
      return { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' };
    case 'User':
      return { bg: 'bg-[var(--primary-subtle)]', text: 'text-[var(--primary)]' };
    case 'System':
      return { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' };
    case 'Session':
      return { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' };
    case 'Lead':
      return { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' };
    case 'Call':
      return { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' };
    case 'Follow-Up':
      return { bg: 'bg-[var(--primary-subtle)]', text: 'text-[var(--primary)]' };
    default:
      return { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--foreground)]' };
  }
}

export default function OverviewPage() {
  const { isAuthenticated, user } = useAuth();
  const [stats, setStats] = useState<Stats>({
    myCalls: 0,
    mySessions: 0,
    myFollowUps: 0,
    myDials: 0,
  });
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [quickAccess, setQuickAccess] = useState<{ href: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[]>([]);

  useEffect(() => {
    setQuickAccess(getQuickAccessPages());
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const userId = user.id;

        const getCount = async (collection: string, filter?: string) => {
          try {
            const result = await pb.collection(collection).getList(1, 1, filter ? { filter } : undefined);
            return result.totalItems;
          } catch (e: any) {
            if (e.status !== 0) {
              console.error(`Failed to fetch count for ${collection}:`, e);
            }
            return 0;
          }
        };

        const safeList = async (collection: string, page: number, perPage: number, options?: Record<string, string>) => {
          try {
            return await pb.collection(collection).getList(page, perPage, options);
          } catch {
            return { items: [] };
          }
        };

        const [
          myCalls,
          mySessions,
          myFollowUps,
          mySessionsForDials,
          eventLogsResult,
          sessionsResult,
          companiesResult,
          callLogsResult,
          followUpsResult,
        ] = await Promise.all([
          getCount(COLLECTIONS.CALL_LOGS, `caller = "${userId}"`),
          getCount(COLLECTIONS.COLD_CALLING_SESSIONS, `user = "${userId}"`),
          getCount(COLLECTIONS.FOLLOW_UPS, `created_by = "${userId}" || assigned_to = "${userId}"`),
          safeList(COLLECTIONS.COLD_CALLING_SESSIONS, 1, 200, {
            filter: `user = "${userId}"`,
            fields: 'total_dials',
          }),
          safeList(COLLECTIONS.EVENT_LOGS, 1, 10, {
            sort: '-created',
            expand: 'user,actor,cold_call,company',
          }),
          safeList(COLLECTIONS.COLD_CALLING_SESSIONS, 1, 8, {
            sort: '-created',
            expand: 'user',
          }),
          safeList(COLLECTIONS.COMPANIES, 1, 8, {
            sort: '-created',
          }),
          safeList(COLLECTIONS.CALL_LOGS, 1, 8, {
            sort: '-created',
            expand: 'company,caller',
          }),
          safeList(COLLECTIONS.FOLLOW_UPS, 1, 8, {
            sort: '-created',
            expand: 'company,created_by',
          }),
        ]);

        const totalDials = mySessionsForDials.items.reduce((sum: number, s: any) => sum + (s.total_dials || 0), 0);

        setStats({
          myCalls,
          mySessions,
          myFollowUps,
          myDials: totalDials,
        });

        // Build unified activity feed
        const activities: ActivityItem[] = [];

        // Event logs
        for (const event of eventLogsResult.items as EventLog[]) {
          activities.push({
            id: `event-${event.id}`,
            type: event.event_type,
            description: getEventDescription(event),
            source: event.source,
            created: event.created,
          });
        }

        // Sessions
        for (const session of sessionsResult.items) {
          const userName = session.expand?.user?.name || 'Someone';
          const durationStr = session.total_duration_sec ? ` (${formatSessionDuration(session.total_duration_sec)})` : '';
          const dials = session.total_dials || 0;
          const desc = session.status === 'completed'
            ? `${userName} completed a calling session — ${dials} dials${durationStr}`
            : `${userName} started a calling session`;
          activities.push({
            id: `session-${session.id}`,
            type: 'Session',
            description: desc,
            created: session.created,
          });
        }

        // Companies added
        for (const company of companiesResult.items) {
          activities.push({
            id: `company-${company.id}`,
            type: 'Lead',
            description: `${company.company_name || 'Unknown company'} was added${company.source ? ` from ${company.source}` : ''}`,
            created: company.created,
          });
        }

        // Call logs
        for (const call of callLogsResult.items) {
          const callerName = call.expand?.caller?.name || 'Someone';
          const companyName = call.expand?.company?.company_name || 'a company';
          const outcome = call.call_outcome?.length ? ` — ${call.call_outcome[0]}` : '';
          activities.push({
            id: `call-${call.id}`,
            type: 'Call',
            description: `${callerName} called ${companyName}${outcome}`,
            created: call.created,
          });
        }

        // Follow-ups
        for (const followUp of followUpsResult.items) {
          const creatorName = followUp.expand?.created_by?.name || 'Someone';
          const companyName = followUp.expand?.company?.company_name || 'a company';
          activities.push({
            id: `followup-${followUp.id}`,
            type: 'Follow-Up',
            description: `${creatorName} scheduled a follow-up with ${companyName}`,
            created: followUp.created,
          });
        }

        // Sort by created date (newest first) and take top 15
        activities.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
        setRecentActivity(activities.slice(0, 15));
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw size={32} className="animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-[var(--muted)] mt-1">Welcome to your CRM dashboard</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="My Calls"
          value={stats.myCalls}
          icon={Phone}
          description="Calls you've made"
          variant="default"
        />
        <StatsCard
          title="My Sessions"
          value={stats.mySessions}
          icon={PhoneCall}
          description="Calling sessions"
          variant="accent"
        />
        <StatsCard
          title="Total Dials"
          value={stats.myDials}
          icon={BarChart3}
          description="Across all sessions"
          variant="default"
        />
        <StatsCard
          title="Follow-Ups"
          value={stats.myFollowUps}
          icon={CalendarCheck}
          description="Assigned to you"
          variant="accent"
        />
      </div>

      {/* Quick Access */}
      {quickAccess.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Compass size={16} strokeWidth={1.5} className="text-[var(--muted)]" />
            <h2 className="font-semibold text-sm">Quick Access</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {quickAccess.map((page) => {
              const Icon = page.icon;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover)] hover:border-[var(--primary)] transition-colors min-w-0"
                >
                  <Icon size={16} className="text-[var(--muted)] group-hover:text-[var(--primary)] transition-colors shrink-0" />
                  <span className="text-sm font-medium truncate">{page.label}</span>
                  <ArrowRight size={14} className="text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden min-w-0">
        <div className="px-5 py-4 border-b border-[var(--card-border)] flex items-center gap-2">
          <Activity size={18} strokeWidth={1.5} className="text-[var(--muted)]" />
          <h2 className="font-semibold text-sm">Recent Activity</h2>
        </div>
        <div className="overflow-hidden">
          {recentActivity.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--card-hover)] flex items-center justify-center mx-auto mb-4">
                <Activity size={24} className="text-[var(--muted)]" />
              </div>
              <p className="text-sm font-medium">No recent activity</p>
              <p className="text-xs text-[var(--muted)] mt-1">Activity will appear here as events are logged</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--card-border)]">
              {recentActivity.map((item) => {
                const badge = getActivityBadge(item.type);
                return (
                  <div key={item.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-[var(--card-hover)] transition-colors min-w-0">
                    <div className="shrink-0 w-[72px]">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider whitespace-nowrap ${badge.bg} ${badge.text}`}>
                        {item.type}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="text-sm truncate">{item.description}</p>
                      {item.source && (
                        <span className="text-xs text-[var(--muted)] truncate block">via {item.source}</span>
                      )}
                    </div>
                    <span className="text-xs text-[var(--muted)] shrink-0 whitespace-nowrap">
                      {timeAgo(item.created)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
