'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { pb } from './pocketbase';

/**
 * PocketBase reachability monitor.
 *
 * The CRM's PocketBase runs on a self-hosted home server, so "internet up but
 * PB down" is a routine failure mode that `navigator.onLine` cannot detect.
 * This module polls `pb.health.check()` while the tab is visible and tracks a
 * debounced `isPbOnline` flag:
 *
 *   - assume online until proven otherwise
 *   - 2 consecutive failures  -> offline (tolerates a single flaky request)
 *   - 1 success               -> online
 *
 * Listeners are notified on every transition; the offline outbox subscribes
 * to trigger a replay the moment the server comes back.
 */

const POLL_INTERVAL_MS = 20_000;
const HEALTH_TIMEOUT_MS = 8_000;
const FAILURES_TO_GO_OFFLINE = 2;

type PbHealthListener = (isOnline: boolean) => void;

let isPbOnline = true;
let consecutiveFailures = 0;
let checkInFlight: Promise<boolean> | null = null;
let monitorStarted = false;
const listeners = new Set<PbHealthListener>();

export function getPbOnline(): boolean {
    return isPbOnline;
}

/** Subscribe to online/offline transitions. Returns an unsubscribe function. */
export function subscribePbHealth(listener: PbHealthListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function setPbOnline(next: boolean) {
    if (next === isPbOnline) return;
    isPbOnline = next;
    console.log(`[pb-health] PocketBase is ${next ? 'reachable' : 'UNREACHABLE'}`);
    for (const listener of listeners) {
        try {
            listener(next);
        } catch (err) {
            console.error('[pb-health] listener failed:', err);
        }
    }
}

/**
 * Run a health check now. Deduplicates concurrent calls.
 * Resolves with the (possibly updated) online status.
 */
export function checkPbHealth(): Promise<boolean> {
    if (typeof window === 'undefined') return Promise.resolve(true);
    if (checkInFlight) return checkInFlight;

    checkInFlight = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
        try {
            await pb.health.check({ requestKey: null, signal: controller.signal });
            consecutiveFailures = 0;
            setPbOnline(true);
            return true;
        } catch (err) {
            // Any HTTP response (status > 0) means the server is reachable —
            // only a network-level failure (status 0 / abort) counts as down.
            const status = (err as { status?: number } | null)?.status ?? 0;
            if (status > 0) {
                consecutiveFailures = 0;
                setPbOnline(true);
                return true;
            }
            consecutiveFailures += 1;
            if (consecutiveFailures >= FAILURES_TO_GO_OFFLINE) {
                setPbOnline(false);
            }
            return false;
        } finally {
            clearTimeout(timeout);
            checkInFlight = null;
        }
    })();

    return checkInFlight;
}

/**
 * Start the background monitor (idempotent). Polls while the tab is visible,
 * and re-checks immediately on the browser `online` event and when the tab
 * becomes visible again.
 */
export function startPbHealthMonitor(): void {
    if (monitorStarted || typeof window === 'undefined') return;
    monitorStarted = true;

    setInterval(() => {
        if (document.visibilityState === 'visible') {
            void checkPbHealth();
        }
    }, POLL_INTERVAL_MS);

    window.addEventListener('online', () => {
        void checkPbHealth();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            void checkPbHealth();
        }
    });
}

function subscribeForStore(onStoreChange: () => void): () => void {
    return subscribePbHealth(() => onStoreChange());
}

/** React hook: current PocketBase reachability (SSR-safe, defaults to online). */
export function usePbHealth(): boolean {
    const online = useSyncExternalStore(subscribeForStore, getPbOnline, () => true);
    useEffect(() => {
        startPbHealthMonitor();
    }, []);
    return online;
}
