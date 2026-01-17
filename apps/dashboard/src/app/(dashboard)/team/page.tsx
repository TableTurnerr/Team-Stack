"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { User, COLLECTIONS } from '@/lib/types';
import { Plus, Phone, MessageSquare, Clock, RefreshCw, Users } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { CardGridSkeleton } from '@/components/dashboard-skeletons';

interface UserStats {
  calls: number;
  dms: number;
}

interface UserWithStats extends User {
  stats: UserStats;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'online': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'offline': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'away': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
};

export default function TeamPage() {
  const { isAuthenticated } = useAuth();
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated) fetchUsersAndStats();
  }, [isAuthenticated]);

  async function fetchUsersAndStats() {
    setLoading(true);
    try {
      const usersResult = await pb.collection(COLLECTIONS.USERS).getList<User>(1, 50, { sort: 'name' });

      const usersWithStats = await Promise.all(usersResult.items.map(async (user) => {
        let calls = 0;
        let lastCallTime = null;
        try {
          const callsResult = await pb.collection(COLLECTIONS.COLD_CALLS).getList(1, 1, {
            filter: `claimed_by = "${user.id}"`,
            sort: '-created',
            fields: 'id,created'
          });
          calls = callsResult.totalItems;
          if (callsResult.items.length > 0) {
            lastCallTime = callsResult.items[0].created;
          }
        } catch (e) { console.error(e); }

        let dms = 0;
        let lastDmTime = null;
        try {
          const dmsResult = await pb.collection(COLLECTIONS.EVENT_LOGS).getList(1, 1, {
            filter: `user = "${user.id}" && event_type = "Outreach"`,
            sort: '-created',
            fields: 'id,created'
          });
          dms = dmsResult.totalItems;

          // Get latest event of ANY type for last active time
          const latestEventResult = await pb.collection(COLLECTIONS.EVENT_LOGS).getList(1, 1, {
            filter: `user = "${user.id}"`,
            sort: '-created',
            fields: 'created'
          });
          if (latestEventResult.items.length > 0) {
            lastDmTime = latestEventResult.items[0].created;
          }

        } catch (e) { console.error(e); }

        // Calculate most recent activity
        const times = [user.updated, user.created, lastCallTime, lastDmTime].filter(Boolean) as string[];
        // Sort effectively by converting to dates
        times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        const last_activity = times.length > 0 ? times[0] : undefined;

        console.log(`[TeamPage] User ${user.email} activity:`, {
          updated: user.updated,
          created: user.created,
          lastCallTime,
          lastDmTime,
          calculated: last_activity
        });

        return {
          ...user,
          last_activity,
          stats: { calls, dms }
        };
      }));

      setUsers(usersWithStats);
    } catch (error: any) {
      if (error.status !== 0) console.error("Error fetching team:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMember() {
    const email = prompt("Enter email for new member:");
    if (!email) return;
    const password = prompt("Enter temporary password:");
    if (!password) return;
    const name = prompt("Enter name:");

    try {
      await pb.collection(COLLECTIONS.USERS).create({
        email,
        password,
        passwordConfirm: password,
        name,
        role: 'member',
        status: 'offline'
      });
      alert("User created!");
      fetchUsersAndStats();
    } catch (e) {
      alert("Failed to create user: " + e);
    }
  }

  const getStatusStyle = (status: string) => {
    return STATUS_STYLES[status] || STATUS_STYLES['offline'];
  };

  if (loading) {
    return <CardGridSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage your team and view performance</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsersAndStats}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleAddMember}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100 transition-colors"
          >
            <Plus size={16} />
            Add Member
          </button>
        </div>
      </div>

      {/* Team Grid */}
      <div className={cn(users.length === 0 && "bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden")}>
        {users.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-[var(--primary)]" />
            </div>
            <p className="text-sm font-medium">No team members found</p>
            <p className="text-xs text-[var(--muted)] mt-1">Add team members to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {users.map((user) => {
              const statusStyle = getStatusStyle(user.status || 'offline');
              return (
                <div
                  key={user.id}
                  className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 card-interactive"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[var(--primary)] flex items-center justify-center">
                        <span className="text-white text-sm font-semibold">
                          {user.name?.charAt(0).toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{user.name}</h3>
                        <p className="text-xs text-[var(--muted)]">{user.email}</p>
                      </div>
                    </div>
                    <span className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
                      statusStyle.bg,
                      statusStyle.text
                    )}>
                      {user.status}
                    </span>
                  </div>

                  <div className="text-xs text-[var(--muted)] mb-4 px-1">
                    <span className="capitalize">{user.role}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--card-border)]">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-[var(--muted)] mb-1">
                        <Phone size={12} />
                        <span className="text-[10px] uppercase tracking-wider">Calls</span>
                      </div>
                      <div className="text-xl font-bold">{user.stats.calls}</div>
                    </div>
                    <div className="text-center border-l border-[var(--card-border)]">
                      <div className="flex items-center justify-center gap-1 text-[var(--muted)] mb-1">
                        <MessageSquare size={12} />
                        <span className="text-[10px] uppercase tracking-wider">DMs</span>
                      </div>
                      <div className="text-xl font-bold">{user.stats.dms}</div>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-[var(--card-border)] flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <Clock size={12} />
                    Last active: {user.last_activity ? format(new Date(user.last_activity), 'PP p') : 'Never'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
