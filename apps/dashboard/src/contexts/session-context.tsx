'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession } from '@/lib/types';
import { useAuth } from './auth-context';

interface SessionContextType {
    /** The current user's active session (if any) */
    session: ColdCallingSession | null;
    setSession: (session: ColdCallingSession | null) => void;
    isLoading: boolean;
    refreshSession: () => Promise<void>;
    isStandaloneMode: boolean;
    setStandaloneMode: (enabled: boolean) => void;
    /** True when another user (not the current user) has an active session */
    isBlockedByOtherSession: boolean;
    /** Name of the user who owns the currently active session (if blocked) */
    activeSessionUserName: string | null;
    /** The other user's active session object (for displaying elapsed time etc.) */
    otherActiveSession: ColdCallingSession | null;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [session, setSession] = useState<ColdCallingSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isStandaloneMode, setStandaloneMode] = useState(false);

    // ── Global session lock state ──
    const [otherActiveSession, setOtherActiveSession] = useState<ColdCallingSession | null>(null);
    const [activeSessionUserName, setActiveSessionUserName] = useState<string | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);

    const isBlockedByOtherSession = !!(otherActiveSession && user && otherActiveSession.user !== user.id);

    // ── Fetch the current user's session ──
    const fetchSession = useCallback(async () => {
        if (!isAuthenticated || !user) {
            setSession(null);
            setIsLoading(false);
            return;
        }

        try {
            const result = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getList<ColdCallingSession>(1, 1, {
                filter: `user = "${user.id}" && status = "active"`,
                sort: '-created',
            });
            if (result.items.length > 0) {
                setSession(result.items[0]);
            } else {
                setSession(null);
            }
        } catch (err: any) {
            if (err?.status !== 404) {
                console.error('Failed to fetch active session:', err);
            }
        } finally {
            setIsLoading(false);
        }
    }, [user, isAuthenticated]);

    // ── Fetch ANY active session (global lock check) ──
    const fetchGlobalActiveSession = useCallback(async () => {
        if (!isAuthenticated || !user) {
            setOtherActiveSession(null);
            setActiveSessionUserName(null);
            return;
        }

        try {
            const result = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getList<ColdCallingSession>(1, 1, {
                filter: `user != "${user.id}" && status = "active"`,
                sort: '-created',
                expand: 'user',
            });
            if (result.items.length > 0) {
                const otherSession = result.items[0];
                setOtherActiveSession(otherSession);
                // Extract the name from expanded user relation
                const expandedUser = otherSession.expand?.user;
                setActiveSessionUserName(expandedUser?.name || 'Another user');
            } else {
                setOtherActiveSession(null);
                setActiveSessionUserName(null);
            }
        } catch (err: any) {
            if (err?.status !== 404) {
                console.error('Failed to fetch global active session:', err);
            }
        }
    }, [user, isAuthenticated]);

    // ── Initial fetch ──
    useEffect(() => {
        fetchSession();
        fetchGlobalActiveSession();
    }, [fetchSession, fetchGlobalActiveSession]);

    // ── Debounced refresh to avoid 429s from rapid real-time events ──
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedRefresh = useCallback(() => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            fetchSession();
            fetchGlobalActiveSession();
        }, 500);
    }, [fetchSession, fetchGlobalActiveSession]);

    // Clean up debounce timer
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, []);

    // ── Real-time subscription to cold_calling_sessions for live updates ──
    useEffect(() => {
        if (!isAuthenticated || !user) return;

        // Subscribe to all changes on cold_calling_sessions
        pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).subscribe('*', (e) => {
            console.log('[Session Context] Real-time event:', e.action, e.record?.id);

            // Debounced re-fetch to prevent 429 rate limiting
            debouncedRefresh();
        }).then(unsubscribe => {
            unsubscribeRef.current = unsubscribe;
        }).catch(err => {
            console.error('Failed to subscribe to sessions:', err);
        });

        return () => {
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, user, fetchSession, fetchGlobalActiveSession]);

    return (
        <SessionContext.Provider value={{
            session, setSession, isLoading,
            refreshSession: fetchSession,
            isStandaloneMode, setStandaloneMode,
            isBlockedByOtherSession, activeSessionUserName, otherActiveSession,
        }}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (context === undefined) {
        throw new Error('useSession must be used within a SessionProvider');
    }
    return context;
}
