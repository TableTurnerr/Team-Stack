'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type User, type ColdCallingSession } from '@/lib/types';
import { useAuth, isUserOnline } from './auth-context';

interface TeamPresenceContextType {
    /** All team members, live-updated via WebSocket */
    teamMembers: User[];
    /** Currently active call sessions (status=active), live-updated */
    activeSessions: ColdCallingSession[];
    /** Returns the active session for a given userId, or undefined */
    getSessionForUser: (userId: string) => ColdCallingSession | undefined;
    /** Heartbeat-aware online check (true if last_activity < 90s ago) */
    isOnline: (user: User) => boolean;
    isLoading: boolean;
    refresh: () => Promise<void>;
}

const TeamPresenceContext = createContext<TeamPresenceContextType | undefined>(undefined);

export function TeamPresenceProvider({ children }: { children: React.ReactNode }) {
    const { isAuthenticated } = useAuth();
    const [teamMembers, setTeamMembers] = useState<User[]>([]);
    const [activeSessions, setActiveSessions] = useState<ColdCallingSession[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const unsubUsersRef = useRef<(() => void) | null>(null);
    const unsubSessionsRef = useRef<(() => void) | null>(null);
    const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Refs so the watchdog interval always reads fresh data
    const activeSessionsRef = useRef<ColdCallingSession[]>([]);
    const teamMembersRef = useRef<User[]>([]);

    const fetchAll = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const [usersResult, sessionsResult] = await Promise.all([
                pb.collection(COLLECTIONS.USERS).getList<User>(1, 100, { sort: 'name' }),
                pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getList<ColdCallingSession>(1, 50, {
                    filter: 'status = "active"',
                    sort: '-created',
                    expand: 'user',
                }),
            ]);
            setTeamMembers(usersResult.items);
            activeSessionsRef.current = sessionsResult.items;
            setActiveSessions(sessionsResult.items);
            teamMembersRef.current = usersResult.items;
        } catch (err: any) {
            if (err?.status !== 0) console.error('[TeamPresence] fetch failed:', err);
        } finally {
            setIsLoading(false);
        }
    }, [isAuthenticated]);

    // ── Real-time subscriptions ──
    useEffect(() => {
        if (!isAuthenticated) return;

        fetchAll();

        // Subscribe to user changes (status, last_activity)
        pb.collection(COLLECTIONS.USERS).subscribe<User>('*', (e) => {
            if (e.action === 'delete') {
                setTeamMembers(prev => {
                    const next = prev.filter(u => u.id !== e.record.id);
                    teamMembersRef.current = next;
                    return next;
                });
            } else {
                setTeamMembers(prev => {
                    const idx = prev.findIndex(u => u.id === e.record.id);
                    const next = idx === -1 ? [...prev, e.record] : prev.map((u, i) => i === idx ? e.record : u);
                    teamMembersRef.current = next;
                    return next;
                });
            }
        }).then(unsub => {
            unsubUsersRef.current = unsub;
        }).catch(err => {
            console.error('[TeamPresence] users subscribe failed:', err);
        });

        // Subscribe to session changes (starts, ends, metric updates)
        pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).subscribe<ColdCallingSession>('*', async (e) => {
            const record = e.record;

            if (e.action === 'delete' || record.status !== 'active') {
                // Remove from active list
                setActiveSessions(prev => {
                    const next = prev.filter(s => s.id !== record.id);
                    activeSessionsRef.current = next;
                    return next;
                });
                return;
            }

            // For create/update of active sessions, fetch with user expand
            try {
                const full = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS)
                    .getOne<ColdCallingSession>(record.id, { expand: 'user' });
                setActiveSessions(prev => {
                    const idx = prev.findIndex(s => s.id === full.id);
                    const next = idx === -1 ? [...prev, full] : prev.map((s, i) => i === idx ? full : s);
                    activeSessionsRef.current = next;
                    return next;
                });
            } catch {
                // Record may no longer be active — remove it
                setActiveSessions(prev => {
                    const next = prev.filter(s => s.id !== record.id);
                    activeSessionsRef.current = next;
                    return next;
                });
            }
        }).then(unsub => {
            unsubSessionsRef.current = unsub;
        }).catch(err => {
            console.error('[TeamPresence] sessions subscribe failed:', err);
        });

        // ── Watchdog: auto-end sessions for users offline for 15+ minutes ──
        // Handles the case where a user's browser/tab was closed without ending their session.
        const OFFLINE_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
        const runWatchdog = async () => {
            const sessions = activeSessionsRef.current;
            const members = teamMembersRef.current;
            for (const session of sessions) {
                const owner = members.find(u => u.id === session.user);
                if (!owner?.last_activity) continue;
                const offlineDurationMs = Date.now() - new Date(owner.last_activity).getTime();
                if (offlineDurationMs < OFFLINE_SESSION_TIMEOUT_MS) continue;

                try {
                    const started = new Date(session.started_at).getTime();
                    const totalPausedSec = session.total_paused_sec ?? 0;
                    const currentPauseSec = session.paused_at
                        ? Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000)
                        : 0;
                    // Subtract the time the user has been offline so it doesn't count toward duration
                    const offlineSec = Math.floor(offlineDurationMs / 1000);
                    const elapsedSec = Math.max(0,
                        Math.floor((Date.now() - started) / 1000) - totalPausedSec - currentPauseSec - offlineSec
                    );
                    await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, {
                        ended_at: new Date().toISOString(),
                        total_duration_sec: elapsedSec,
                        status: 'completed',
                    });
                    console.log('[TeamPresence] Auto-ended stale session for offline user:', owner.id, session.id);
                } catch (err) {
                    console.error('[TeamPresence] Failed to auto-end stale session:', err);
                }
            }
        };

        watchdogRef.current = setInterval(runWatchdog, 2 * 60 * 1000); // every 2 minutes
        // Run once immediately in case there are already stale sessions
        runWatchdog();

        return () => {
            unsubUsersRef.current?.();
            unsubUsersRef.current = null;
            unsubSessionsRef.current?.();
            unsubSessionsRef.current = null;
            if (watchdogRef.current) {
                clearInterval(watchdogRef.current);
                watchdogRef.current = null;
            }
        };
    }, [isAuthenticated, fetchAll]);

    const getSessionForUser = useCallback(
        (userId: string) => activeSessions.find(s => s.user === userId),
        [activeSessions]
    );

    return (
        <TeamPresenceContext.Provider value={{
            teamMembers,
            activeSessions,
            getSessionForUser,
            isOnline: isUserOnline,
            isLoading,
            refresh: fetchAll,
        }}>
            {children}
        </TeamPresenceContext.Provider>
    );
}

export function useTeamPresence() {
    const context = useContext(TeamPresenceContext);
    if (context === undefined) {
        throw new Error('useTeamPresence must be used within a TeamPresenceProvider');
    }
    return context;
}
