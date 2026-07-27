'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle, CloudOff, RefreshCw } from 'lucide-react';
import { usePbHealth } from '@/lib/pb-health';
import { pendingCount, startOutbox, subscribeOutbox } from '@/lib/offline-outbox';

/**
 * Session-page banner for the offline outbox:
 *  - PocketBase unreachable  -> amber "keep calling, everything is saved locally"
 *  - back online, queue > 0  -> blue "syncing N queued calls"
 *  - queue drained           -> brief green confirmation
 */
export function OfflineSyncBanner() {
    const pbOnline = usePbHealth();
    const queued = useSyncExternalStore(subscribeOutbox, pendingCount, () => 0);
    const [showSynced, setShowSynced] = useState(false);
    const hadQueueRef = useRef(false);

    // Ensure the outbox triggers (interval / online / pb-health) are running.
    useEffect(() => {
        startOutbox();
    }, []);

    // Brief green confirmation when the queue drains after having been non-empty.
    useEffect(() => {
        if (queued > 0) {
            hadQueueRef.current = true;
            setShowSynced(false);
            return;
        }
        if (hadQueueRef.current) {
            hadQueueRef.current = false;
            setShowSynced(true);
            const timer = setTimeout(() => setShowSynced(false), 5000);
            return () => clearTimeout(timer);
        }
    }, [queued]);

    if (!pbOnline) {
        return (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500" role="status">
                <CloudOff size={18} className="shrink-0" />
                <p className="text-sm font-medium">
                    CRM server unreachable — calls are being saved locally
                    {queued > 0 && <span className="font-semibold"> ({queued} queued)</span>}. Keep calling; recordings are safe.
                </p>
            </div>
        );
    }

    if (queued > 0) {
        return (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--info)]/40 bg-[var(--info-subtle)] text-[var(--info)]" role="status">
                <RefreshCw size={18} className="shrink-0 animate-spin" />
                <p className="text-sm font-medium">
                    Syncing {queued} queued {queued === 1 ? 'call' : 'calls'}…
                </p>
            </div>
        );
    }

    if (showSynced) {
        return (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--success)]/40 bg-[var(--success-subtle)] text-[var(--success)]" role="status">
                <CheckCircle size={18} className="shrink-0" />
                <p className="text-sm font-medium">All queued calls synced</p>
            </div>
        );
    }

    return null;
}
