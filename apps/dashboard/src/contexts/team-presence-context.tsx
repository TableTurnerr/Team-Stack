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
            setActiveSessions(sessionsResult.items);
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
                setTeamMembers(prev => prev.filter(u => u.id !== e.record.id));
            } else {
                setTeamMembers(prev => {
                    const idx = prev.findIndex(u => u.id === e.record.id);
                    if (idx === -1) return [...prev, e.record];
                    const next = [...prev];
                    next[idx] = e.record;
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
                setActiveSessions(prev => prev.filter(s => s.id !== record.id));
                return;
            }

            // For create/update of active sessions, fetch with user expand
            try {
                const full = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS)
                    .getOne<ColdCallingSession>(record.id, { expand: 'user' });
                setActiveSessions(prev => {
                    const idx = prev.findIndex(s => s.id === full.id);
                    if (idx === -1) return [...prev, full];
                    const next = [...prev];
                    next[idx] = full;
                    return next;
                });
            } catch {
                // Record may no longer be active — remove it
                setActiveSessions(prev => prev.filter(s => s.id !== record.id));
            }
        }).then(unsub => {
            unsubSessionsRef.current = unsub;
        }).catch(err => {
            console.error('[TeamPresence] sessions subscribe failed:', err);
        });

        return () => {
            unsubUsersRef.current?.();
            unsubUsersRef.current = null;
            unsubSessionsRef.current?.();
            unsubSessionsRef.current = null;
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
