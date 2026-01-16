import { Building2, Phone, Users, UserCog, Activity } from 'lucide-react';
import { StatsCard } from '@/components/stats-card';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { EventLog, User, Lead, ColdCall } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

async function getStats() {
  try {
    const [companies, coldCalls, leads, users] = await Promise.all([
      pb.collection(COLLECTIONS.COMPANIES).getList(1, 1),
      pb.collection(COLLECTIONS.COLD_CALLS).getList(1, 1),
      pb.collection(COLLECTIONS.LEADS).getList(1, 1),
      pb.collection(COLLECTIONS.USERS).getList(1, 1, { filter: 'status != "suspended"' }),
    ]);

    return {
      totalCompanies: companies.totalItems,
      totalColdCalls: coldCalls.totalItems,
      totalLeads: leads.totalItems,
      activeMembers: users.totalItems,
    };
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return {
      totalCompanies: 0,
      totalColdCalls: 0,
      totalLeads: 0,
      activeMembers: 0,
    };
  }
}

async function getRecentActivity() {
  try {
    const result = await pb.collection(COLLECTIONS.EVENT_LOGS).getList<EventLog>(1, 10, {
      sort: '-created',
      expand: 'user,actor,target,cold_call',
    });
    return result.items;
  } catch (error) {
    console.error('Failed to fetch recent activity:', error);
    return [];
  }
}

function getEventDescription(event: EventLog): string {
  const user = event.expand?.user?.name || 'Unknown';
  const actor = event.expand?.actor?.username || '';
  const target = event.expand?.target?.username || '';

  switch (event.event_type) {
    case 'Outreach':
      return `${actor || user} sent outreach to ${target}`;
    case 'Cold Call':
      return `${user} made a cold call`;
    case 'User':
      return event.details || `${user} performed an action`;
    case 'System':
      return event.details || 'System event';
    case 'Change in Tar Info':
      return `${user} updated target info for ${target}`;
    case 'Tar Exception Toggle':
      return `${user} toggled exception for ${target}`;
    default:
      return event.details || 'Activity logged';
  }
}

function getEventIcon(eventType: string): string {
  switch (eventType) {
    case 'Outreach':
      return 'bg-blue-500';
    case 'Cold Call':
      return 'bg-green-500';
    case 'User':
      return 'bg-purple-500';
    case 'System':
      return 'bg-gray-500';
    default:
      return 'bg-[var(--primary)]';
  }
}

export default async function OverviewPage() {
  const [stats, recentActivity] = await Promise.all([
    getStats(),
    getRecentActivity(),
  ]);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-[var(--muted)] mt-1">Welcome to your CRM dashboard</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Total Companies"
          value={stats.totalCompanies}
          icon={Building2}
          description="Businesses in database"
        />
        <StatsCard
          title="Total Cold Calls"
          value={stats.totalColdCalls}
          icon={Phone}
          description="Calls recorded"
        />
        <StatsCard
          title="Total Leads"
          value={stats.totalLeads}
          icon={Users}
          description="Prospects tracked"
        />
        <StatsCard
          title="Active Team Members"
          value={stats.activeMembers}
          icon={UserCog}
          description="Online users"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl">
        <div className="px-6 py-4 border-b border-[var(--card-border)] flex items-center gap-2">
          <Activity size={20} className="text-[var(--primary)]" />
          <h2 className="font-semibold">Recent Activity</h2>
        </div>
        <div className="divide-y divide-[var(--card-border)]">
          {recentActivity.length === 0 ? (
            <div className="px-6 py-12 text-center text-[var(--muted)]">
              <Activity size={48} className="mx-auto mb-4 opacity-50" />
              <p>No recent activity</p>
              <p className="text-sm mt-1">Activity will appear here as events are logged</p>
            </div>
          ) : (
            recentActivity.map((event) => (
              <div key={event.id} className="px-6 py-4 flex items-start gap-4">
                <div className={`w-2 h-2 mt-2 rounded-full ${getEventIcon(event.event_type)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{getEventDescription(event)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-[var(--muted)]">{event.event_type}</span>
                    {event.source && (
                      <>
                        <span className="text-xs text-[var(--muted)]">•</span>
                        <span className="text-xs text-[var(--muted)]">{event.source}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-xs text-[var(--muted)] shrink-0">
                  {timeAgo(event.created)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
