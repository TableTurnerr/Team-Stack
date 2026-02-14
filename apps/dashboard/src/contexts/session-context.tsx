'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession } from '@/lib/types';
import { useAuth } from './auth-context';

interface SessionContextType {
    session: ColdCallingSession | null;
    setSession: (session: ColdCallingSession | null) => void;
    isLoading: boolean;
    refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [session, setSession] = useState<ColdCallingSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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

    useEffect(() => {
        fetchSession();
    }, [fetchSession]);

    // Real-time subscription could go here, but for now manual updates are fine

    return (
        <SessionContext.Provider value={{ session, setSession, isLoading, refreshSession: fetchSession }}>
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
