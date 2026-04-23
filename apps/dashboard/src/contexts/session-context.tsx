'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession } from '@/lib/types';
import { useAuth } from './auth-context';
import { usePhone } from './phone-context';

interface SessionContextType {
    /** The current user's active session (if any) */
    session: ColdCallingSession | null;
    setSession: (session: ColdCallingSession | null) => void;
    isLoading: boolean;
    refreshSession: () => Promise<void>;
    isStandaloneMode: boolean;
    setStandaloneMode: (enabled: boolean) => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

/**
 * Session ownership model.
 *
 * Each teammate runs their own session on their own device. On the shared
 * Zoom account, cross-device call attribution is handled by the local
 * agent's per-device UI/audio signals (see call-ownership-context), not by
 * a global lock on cold_calling_sessions. This context therefore tracks
 * ONLY the current user's session; concurrent teammate sessions are
 * surfaced via TeamPresenceContext for display, never as a blocker.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const { callStatus } = usePhone();
    const [session, setSession] = useState<ColdCallingSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isStandaloneMode, setStandaloneMode] = useState(false);

    const unsubscribeRef = useRef<(() => void) | null>(null);

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

    // ── Initial fetch ──
    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // ── Debounced refresh to avoid 429s from rapid real-time events ──
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedRefresh = useCallback(() => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            fetchSession();
        }, 500);
    }, [fetchSession]);

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
    }, [isAuthenticated, user, fetchSession]);

    // ── Sync on_call flag to PocketBase when Zoom call status changes ──
    // callStatus comes from the local agent's per-device fusion state, so
    // this flag flips ONLY when THIS teammate is the one on the call —
    // teammate-busy signals from the shared account don't set on_call.
    const prevOnCallRef = useRef<boolean>(false);
    useEffect(() => {
        if (!session || session.status !== 'active') return;
        const isOnCall = callStatus === 'ringing' || callStatus === 'connected';
        if (isOnCall === prevOnCallRef.current) return;
        prevOnCallRef.current = isOnCall;
        pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, { on_call: isOnCall }).catch(err => {
            console.error('[Session Context] Failed to sync on_call status:', err);
        });
    }, [callStatus, session]);

    return (
        <SessionContext.Provider value={{
            session, setSession, isLoading,
            refreshSession: fetchSession,
            isStandaloneMode, setStandaloneMode,
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
