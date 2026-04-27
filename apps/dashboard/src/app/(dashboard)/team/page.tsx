"use client";

import { useEffect, useState, useCallback } from 'react';
import { Plus, Phone, MessageSquare, Clock, RefreshCw, Users, Radio, PhoneCall, Trophy, Power, Loader2 } from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useTeamPresence } from '@/contexts/team-presence-context';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type User, type ColdCallingSession } from '@/lib/types';
import { CardGridSkeleton } from '@/components/dashboard-skeletons';
import { PageGuard } from '@/components/page-guard';
import { UserRoleBadges } from '@/components/user-role-badges';

interface UserStats {
  calls: number;
  dms: number;
}

interface UserWithStats extends User {
  stats: UserStats;
}

// Elapsed seconds since a given ISO timestamp
function elapsedSeconds(isoString: string): number {
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Clock that ticks every second — only rendered for active sessions
function LiveClock({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() => elapsedSeconds(startedAt));
  useEffect(() => {
    const t = setInterval(() => setElapsed(elapsedSeconds(startedAt)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return <>{formatElapsed(elapsed)}</>;
}

// Confirmation dialog for ending another user's session
function EndSessionConfirmDialog({
  userName,
  onConfirm,
  onCancel,
  isEnding,
}: {
  userName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isEnding: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-base font-semibold mb-2">End Session</h3>
        <p className="text-sm text-[var(--muted)] mb-5">
          Are you sure you want to end <span className="font-semibold text-[var(--foreground)]">{userName}</span>&apos;s session? This will mark it as completed immediately.
        </p>
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isEnding}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isEnding}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--error)] text-white hover:bg-[var(--error)]/90 transition-colors disabled:opacity-50"
          >
            {isEnding ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
            {isEnding ? 'Ending...' : 'End Session'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { isAuthenticated } = useAuth();
  const { teamMembers, getSessionForUser, isOnline, isLoading, refresh } = useTeamPresence();
  const [statsMap, setStatsMap] = useState<Record<string, UserStats>>({});
  const [statsLoading, setStatsLoading] = useState(true);

  // State for ending another user's session
  const [endingSessionFor, setEndingSessionFor] = useState<{ userId: string; userName: string; session: ColdCallingSession } | null>(null);
  const [isEndingSession, setIsEndingSession] = useState(false);

  const handleEndOtherSession = useCallback(async () => {
    if (!endingSessionFor) return;
    const { session } = endingSessionFor;
    try {
      setIsEndingSession(true);
      const started = new Date(session.started_at).getTime();
      const totalPausedSec = session.total_paused_sec ?? 0;
      const currentPauseSec = session.paused_at
        ? Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000)
        : 0;
      const elapsedSec = Math.max(0,
        Math.floor((Date.now() - started) / 1000) - totalPausedSec - currentPauseSec
      );
      await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, {
        ended_at: new Date().toISOString(),
        total_duration_sec: elapsedSec,
        status: 'completed',
        on_call: false,
      });
      setEndingSessionFor(null);
    } catch (err) {
      console.error('Failed to end session:', err);
      alert('Failed to end session. Please try again.');
    } finally {
      setIsEndingSession(false);
    }
  }, [endingSessionFor]);

  // Fetch supplemental stats (all-time calls, DMs) once — these aren't real-time critical
  useEffect(() => {
    if (!isAuthenticated || teamMembers.length === 0) return;

    const fetchStats = async () => {
      setStatsLoading(true);
      const entries = await Promise.all(
        teamMembers.map(async (user) => {
          let calls = 0;
          let dms = 0;
          try {
            const [callsRes, dmsRes] = await Promise.all([
              pb.collection(COLLECTIONS.CALL_LOGS).getList(1, 1, {
                filter: `caller = "${user.id}"`,
                fields: 'id',
              }),
              pb.collection(COLLECTIONS.EVENT_LOGS).getList(1, 1, {
                filter: `user = "${user.id}" && event_type = "Outreach"`,
                fields: 'id',
              }),
            ]);
            calls = callsRes.totalItems;
            dms = dmsRes.totalItems;
          } catch { /* ignore */ }
          return [user.id, { calls, dms }] as const;
        })
      );
      setStatsMap(Object.fromEntries(entries));
      setStatsLoading(false);
    };

    fetchStats();
  }, [isAuthenticated, teamMembers]);

  async function handleAddMember() {
    const email = prompt('Enter email for new member:');
    if (!email) return;
    const password = prompt('Enter temporary password:');
    if (!password) return;
    const name = prompt('Enter name:');

    try {
      const newUser = await pb.collection(COLLECTIONS.USERS).create<{ id: string }>({
        email,
        password,
        passwordConfirm: password,
        name,
        role: 'member',
        status: 'offline',
      });

      // Auto-add new user to every role flagged is_default (e.g. Member).
      try {
        const defaultRoles = await pb.collection(COLLECTIONS.ROLES).getFullList<{ id: string; members?: string[] }>({
          filter: 'is_default = true',
        });
        await Promise.all(
          defaultRoles.map(r =>
            pb.collection(COLLECTIONS.ROLES).update(r.id, {
              members: Array.from(new Set([...(r.members || []), newUser.id])),
            })
          )
        );
      } catch (e) {
        console.warn('Failed to auto-assign default role(s):', e);
      }

      alert('User created!');
      await refresh();
    } catch (e) {
      alert('Failed to create user: ' + e);
    }
  }

  if (isLoading) return <CardGridSkeleton />;

  return (
    <PageGuard pageKey="team">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Live presence & performance</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
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

      {/* End Session Confirmation Dialog */}
      {endingSessionFor && (
        <EndSessionConfirmDialog
          userName={endingSessionFor.userName}
          onConfirm={handleEndOtherSession}
          onCancel={() => setEndingSessionFor(null)}
          isEnding={isEndingSession}
        />
      )}

      {/* Team Grid */}
      <div className={cn(teamMembers.length === 0 && 'bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden')}>
        {teamMembers.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-[var(--primary)]" />
            </div>
            <p className="text-sm font-medium">No team members found</p>
            <p className="text-xs text-[var(--muted)] mt-1">Add team members to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamMembers.map((user) => {
              const online = isOnline(user);
              const activeSession = getSessionForUser(user.id);
              const isCalling = !!activeSession;
              const stats = statsMap[user.id] ?? { calls: 0, dms: 0 };

              return (
                <div
                  key={user.id}
                  className={cn(
                    'bg-[var(--card-bg)] border rounded-xl p-5 card-interactive transition-colors',
                    isCalling
                      ? 'border-[var(--success)] ring-1 ring-[var(--success)]/30'
                      : 'border-[var(--card-border)]'
                  )}
                >
                  {/* Card header */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      {/* Avatar with online dot */}
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-[var(--primary)] flex items-center justify-center">
                          <span className="text-white text-sm font-semibold">
                            {user.name?.charAt(0).toUpperCase() || 'U'}
                          </span>
                        </div>
                        {/* Presence dot */}
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--card-bg)]',
                            isCalling
                              ? 'bg-[var(--success)] animate-pulse'
                              : online
                              ? 'bg-[var(--success)]'
                              : 'bg-[var(--muted)]'
                          )}
                        />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">{user.name}</h3>
                        <p className="text-xs text-[var(--muted)]">{user.email}</p>
                      </div>
                    </div>

                    {/* Status badge */}
                    {isCalling ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-[var(--success-subtle)] text-[var(--success)]">
                        <Radio size={9} className="animate-pulse" />
                        Live
                      </span>
                    ) : (
                      <span className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
                        online
                          ? 'bg-[var(--success-subtle)] text-[var(--success)]'
                          : 'bg-[var(--card-hover)] text-[var(--muted)]'
                      )}>
                        {online ? 'Online' : 'Offline'}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-[var(--muted)] mb-1 px-1 flex flex-wrap items-center gap-2">
                    <span className="capitalize">{user.role}</span>
                    <UserRoleBadges userId={user.id} maxVisible={2} size="xs" />
                  </div>

                  {/* Live session panel */}
                  {activeSession && (
                    <div className="mb-3 rounded-lg bg-[var(--success-subtle)]/40 border border-[var(--success)]/20 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--success)]">
                          <PhoneCall size={10} />
                          Active Session
                        </span>
                        <span className="text-xs font-mono text-[var(--success)] tabular-nums">
                          <LiveClock startedAt={activeSession.started_at} />
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-base font-bold">{activeSession.total_dials}</div>
                          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Dials</div>
                        </div>
                        <div>
                          <div className="text-base font-bold">{activeSession.total_pickups}</div>
                          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">Pickups</div>
                        </div>
                        <div>
                          <div className="text-base font-bold">{activeSession.appointment_set}</div>
                          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider flex items-center justify-center gap-0.5">
                            <Trophy size={8} />
                            Appts
                          </div>
                        </div>
                      </div>
                      {/* End Session button */}
                      <button
                        onClick={() => setEndingSessionFor({ userId: user.id, userName: user.name || 'this user', session: activeSession })}
                        disabled={!!activeSession.on_call}
                        className={cn(
                          "w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all mt-1",
                          activeSession.on_call
                            ? "bg-[var(--card-hover)] text-[var(--muted)] cursor-not-allowed opacity-60"
                            : "bg-[var(--error-subtle)] text-[var(--error)] border border-[var(--error)]/30 hover:bg-[var(--error)] hover:text-white"
                        )}
                        title={activeSession.on_call ? `${user.name || 'User'} is currently on a call` : 'End this session'}
                      >
                        <Power size={11} />
                        {activeSession.on_call ? 'On Call — Cannot End' : 'End Session'}
                      </button>
                    </div>
                  )}

                  {/* All-time stats */}
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[var(--card-border)]">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-[var(--muted)] mb-1">
                        <Phone size={12} />
                        <span className="text-[10px] uppercase tracking-wider">Calls</span>
                      </div>
                      <div className="text-xl font-bold">{statsLoading ? '—' : stats.calls}</div>
                    </div>
                    <div className="text-center border-l border-[var(--card-border)]">
                      <div className="flex items-center justify-center gap-1 text-[var(--muted)] mb-1">
                        <MessageSquare size={12} />
                        <span className="text-[10px] uppercase tracking-wider">DMs</span>
                      </div>
                      <div className="text-xl font-bold">{statsLoading ? '—' : stats.dms}</div>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[var(--card-border)] flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <Clock size={12} />
                    {user.last_activity
                      ? `Active ${formatDistanceToNowStrict(new Date(user.last_activity), { addSuffix: true })}`
                      : 'Never active'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </PageGuard>
  );
}
