'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/contexts/session-context';
import { Headphones, Phone } from 'lucide-react';
import { useState, useEffect } from 'react';

export function ActiveSessionBanner() {
    const pathname = usePathname();
    const router = useRouter();
    const { session, isLoading, isStandaloneMode } = useSession();
    const [elapsed, setElapsed] = useState('');

    // Timer logic for the current user's session banner
    useEffect(() => {
        if (!session) return;

        const updateTimer = () => {
            const start = new Date(session.started_at).getTime();
            const now = Date.now();
            const totalPausedSec = session.total_paused_sec ?? 0;
            const currentPauseSec = session.paused_at
                ? Math.floor((now - new Date(session.paused_at).getTime()) / 1000)
                : 0;
            const diff = Math.floor((now - start) / 1000) - totalPausedSec - currentPauseSec;

            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            setElapsed(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [session]);

    if (isLoading) return null;

    if (pathname === '/session') return null;
    if (!session && !isStandaloneMode) return null;

    // Standalone mode banner
    if (isStandaloneMode && !session) {
        return (
            <div className="bg-[var(--warning)] text-[var(--background)] px-4 py-3 shadow-lg flex items-center justify-between animate-in slide-in-from-top duration-300 relative z-[1001]">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-full bg-[var(--background)]/20 animate-pulse">
                        <Phone size={16} className="text-[var(--background)]" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold">Standalone Mode Active</p>
                        <p className="text-xs opacity-90">Recording Enabled</p>
                    </div>
                </div>

                <button
                    onClick={() => router.push('/session')}
                    className="px-3 py-1.5 rounded-lg bg-[var(--background)] text-[var(--warning)] text-xs font-bold hover:bg-[var(--background)]/90 transition-colors"
                >
                    Return to Session
                </button>
            </div>
        );
    }

    // Session mode banner
    if (session) {
        const isPaused = !!session.paused_at;
        return (
            <div className="bg-[var(--foreground)] text-[var(--background)] px-4 py-3 shadow-lg flex items-center justify-between animate-in slide-in-from-top duration-300 relative z-[1001]">
                <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-full bg-[var(--background)]/20 ${!isPaused ? 'animate-pulse' : ''}`}>
                        <Headphones size={16} className="text-[var(--background)]" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold">{isPaused ? 'Session Paused' : 'Active Call Session'}</p>
                        <p className="text-xs opacity-90 font-mono tracking-wide">{elapsed}</p>
                    </div>
                </div>

                <button
                    onClick={() => router.push('/session')}
                    className="px-3 py-1.5 rounded-lg bg-[var(--background)] text-[var(--foreground)] text-xs font-bold hover:bg-[var(--background)]/90 transition-colors"
                >
                    Return to Session
                </button>
            </div>
        );
    }

    return null;
}
