"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { InstaActor, COLLECTIONS, User } from '@/lib/types';
import { format } from 'date-fns';
import { Instagram, Activity, User as UserIcon, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { TableSkeleton } from '@/components/dashboard-skeletons';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';

// Column definitions for actors table
const ACTORS_COLUMNS: ColumnDefinition[] = [
  { key: 'username', label: 'Account', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'owner', label: 'Owner', defaultVisible: true },
  { key: 'activity', label: 'Activity', defaultVisible: true },
  { key: 'last_activity', label: 'Last Active', defaultVisible: true },
];

interface ActorStats {
  dmsSent: number;
}

interface ActorWithStats extends InstaActor {
  stats: ActorStats;
  ownerName?: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Active': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Suspended': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
  'Paused': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]' },
};

export default function ActorsPage() {
  const { isAuthenticated } = useAuth();
  const [actors, setActors] = useState<ActorWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  // Column visibility
  const { visibleColumns, toggleColumn, isColumnVisible, columns } = useColumnVisibility('actors', ACTORS_COLUMNS);

  useEffect(() => {
    if (isAuthenticated) fetchActors();
  }, [isAuthenticated]);

  async function fetchActors() {
    setLoading(true);
    try {
      const result = await pb.collection(COLLECTIONS.INSTA_ACTORS).getList<InstaActor>(1, 100, {
        sort: '-last_activity',
        expand: 'owner'
      });

      const actorsData = await Promise.all(result.items.map(async (actor) => {
        let dmsSent = 0;
        try {
          const dmsResult = await pb.collection(COLLECTIONS.EVENT_LOGS).getList(1, 1, {
            filter: `actor = "${actor.id}" && event_type = "Outreach" && company != ""`,
            fields: 'id'
          });
          dmsSent = dmsResult.totalItems;
        } catch (e) { console.error(e); }

        const owner = actor.expand?.owner as User | undefined;

        return {
          ...actor,
          ownerName: owner?.name || 'Unassigned',
          stats: { dmsSent }
        };
      }));

      setActors(actorsData);
    } catch (error: any) {
      if (error.status !== 0) console.error("Error fetching actors:", error);
    } finally {
      setLoading(false);
    }
  }

  const getStatusStyle = (status: string) => {
    if (status.includes('Suspended')) return STATUS_STYLES['Suspended'];
    return STATUS_STYLES[status] || { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' };
  };

  if (loading) {
    return <TableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Instagram Actors</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage your Instagram outreach accounts</p>
        </div>

        <div className="flex items-center gap-2">
          <ColumnSelector
            columns={columns}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
          />

          <button
            onClick={fetchActors}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {actors.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--accent-red-subtle)] flex items-center justify-center mx-auto mb-4">
              <Instagram size={24} className="text-[var(--accent-red)]" />
            </div>
            <p className="text-sm font-medium">No actors found</p>
            <p className="text-xs text-[var(--muted)] mt-1">Add Instagram accounts to start outreach</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--table-header)] border-b border-[var(--table-border)]">
                <tr>
                  {isColumnVisible('username') && <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Account</th>}
                  {isColumnVisible('status') && <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Status</th>}
                  {isColumnVisible('owner') && <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Owner</th>}
                  {isColumnVisible('activity') && <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Activity</th>}
                  {isColumnVisible('last_activity') && <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Last Active</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--table-border)]">
                {actors.map((actor) => {
                  const statusStyle = getStatusStyle(actor.status || 'Active');
                  return (
                    <tr key={actor.id} className="hover:bg-[var(--table-row-hover)] transition-colors">
                      {isColumnVisible('username') && (
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[var(--accent-red-subtle)] flex items-center justify-center">
                              <Instagram size={18} className="text-[var(--accent-red)]" />
                            </div>
                            <span className="text-sm font-medium">@{actor.username}</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('status') && (
                        <td className="py-3.5 px-5">
                          <span className={cn(
                            'px-2 py-1 rounded text-xs font-medium',
                            statusStyle.bg,
                            statusStyle.text
                          )}>
                            {actor.status}
                          </span>
                        </td>
                      )}
                      {isColumnVisible('owner') && (
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                            <UserIcon size={14} />
                            {actor.ownerName}
                          </div>
                        </td>
                      )}
                      {isColumnVisible('activity') && (
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-1.5 text-sm">
                            <Activity size={14} className="text-[var(--primary)]" />
                            <span className="font-medium">{actor.stats.dmsSent}</span>
                            <span className="text-[var(--muted)]">DMs sent</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('last_activity') && (
                        <td className="py-3.5 px-5">
                          <span className="text-sm text-[var(--muted)]">
                            {actor.last_activity ? format(new Date(actor.last_activity), 'MMM d, HH:mm') : '-'}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
