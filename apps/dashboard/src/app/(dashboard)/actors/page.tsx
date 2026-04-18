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
import {
  TableContainer,
  IndexCell,
  HeaderIndexCell,
  ResizableTh,
  useResizableColumns,
  useTableSelection,
  TableEmptyState,
} from '@/components/ui/data-table';

// Column definitions for actors table
const ACTORS_COLUMNS: ColumnDefinition[] = [
  { key: 'username', label: 'Account', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'owner', label: 'Owner', defaultVisible: true },
  { key: 'activity', label: 'Activity', defaultVisible: true },
  { key: 'last_activity', label: 'Last Active', defaultVisible: true },
];

const RESIZABLE_COLUMNS = [
  { key: 'index', initialWidth: 48, minWidth: 40 },
  { key: 'username', initialWidth: 220, minWidth: 140 },
  { key: 'status', initialWidth: 140, minWidth: 100 },
  { key: 'owner', initialWidth: 160, minWidth: 100 },
  { key: 'activity', initialWidth: 160, minWidth: 100 },
  { key: 'last_activity', initialWidth: 160, minWidth: 100 },
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
  const { visibleColumns, toggleColumn, isColumnVisible, columns, resetToDefault } = useColumnVisibility('actors', ACTORS_COLUMNS);

  // Row selection
  const selection = useTableSelection(actors);

  // Resizable columns
  const { resize, getWidth } = useResizableColumns('actors', RESIZABLE_COLUMNS);

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
            onReset={resetToDefault}
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
      <TableContainer>
        {actors.length === 0 ? (
          <TableEmptyState
            icon={<Instagram size={24} className="text-[var(--accent-red)]" />}
            title="No actors found"
            description="Add Instagram accounts to start outreach"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                <tr>
                  <HeaderIndexCell
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggleAll={selection.toggleAll}
                  />
                  {isColumnVisible('username') && (
                    <ResizableTh
                      width={getWidth('username')}
                      onResize={(w) => resize('username', w)}
                      minWidth={140}
                    >
                      Account
                    </ResizableTh>
                  )}
                  {isColumnVisible('status') && (
                    <ResizableTh
                      width={getWidth('status')}
                      onResize={(w) => resize('status', w)}
                      minWidth={100}
                    >
                      Status
                    </ResizableTh>
                  )}
                  {isColumnVisible('owner') && (
                    <ResizableTh
                      width={getWidth('owner')}
                      onResize={(w) => resize('owner', w)}
                      minWidth={100}
                    >
                      Owner
                    </ResizableTh>
                  )}
                  {isColumnVisible('activity') && (
                    <ResizableTh
                      width={getWidth('activity')}
                      onResize={(w) => resize('activity', w)}
                      minWidth={100}
                    >
                      Activity
                    </ResizableTh>
                  )}
                  {isColumnVisible('last_activity') && (
                    <ResizableTh
                      width={getWidth('last_activity')}
                      onResize={(w) => resize('last_activity', w)}
                      minWidth={100}
                    >
                      Last Active
                    </ResizableTh>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)]">
                {actors.map((actor, idx) => {
                  const statusStyle = getStatusStyle(actor.status || 'Active');
                  return (
                    <tr key={actor.id} className="border-b border-[var(--card-border)] hover:bg-[var(--table-row-hover)] transition-colors">
                      <IndexCell
                        index={idx + 1}
                        selected={selection.isSelected(actor.id)}
                        onSelect={() => selection.toggle(actor.id)}
                        forceCheckbox={selection.hasSelection}
                      />
                      {isColumnVisible('username') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-[var(--accent-red-subtle)] flex items-center justify-center shrink-0">
                              <Instagram size={18} className="text-[var(--accent-red)]" />
                            </div>
                            <span className="text-sm font-medium truncate">@{actor.username}</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('status') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          <span className={cn(
                            'px-2 py-1 rounded text-xs font-medium whitespace-nowrap',
                            statusStyle.bg,
                            statusStyle.text
                          )}>
                            {actor.status}
                          </span>
                        </td>
                      )}
                      {isColumnVisible('owner') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          <div className="flex items-center gap-1.5 text-sm text-[var(--muted)] min-w-0">
                            <UserIcon size={14} className="shrink-0" />
                            <span className="truncate">{actor.ownerName}</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('activity') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          <div className="flex items-center gap-1.5 text-sm min-w-0">
                            <Activity size={14} className="text-[var(--primary)] shrink-0" />
                            <span className="font-medium">{actor.stats.dmsSent}</span>
                            <span className="text-[var(--muted)] truncate">DMs sent</span>
                          </div>
                        </td>
                      )}
                      {isColumnVisible('last_activity') && (
                        <td className="py-3.5 px-4 overflow-hidden">
                          <span className="text-sm text-[var(--muted)] block truncate">
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
      </TableContainer>
    </div>
  );
}
