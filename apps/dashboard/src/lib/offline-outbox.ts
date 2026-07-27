'use client';

import { pb } from './pocketbase';
import {
    executeCallSave,
    executeSessionCreate,
    executeSessionEnd,
    executeSessionIncrement,
    isPbNetworkError,
    type CallSaveHooks,
    type CallSavePayload,
    type CreateSessionPayload,
    type EndSessionPayload,
    type IncrementSessionPayload,
} from './offline-ops';
import { startPbHealthMonitor, subscribePbHealth } from './pb-health';

/**
 * Durable localStorage outbox — cold-call data must NEVER be lost when the
 * self-hosted PocketBase is unreachable.
 *
 * Ops are replayed strictly FIFO by a concurrency-guarded singleton engine,
 * triggered by a 30s interval, the browser `online` event, pb-health
 * offline→online transitions, and explicit flush() calls. A network-class
 * failure stops the loop (order preserved, retried on the next trigger);
 * a definitive server rejection dead-letters the item after MAX_ATTEMPTS so
 * one poisoned op can never wedge the queue.
 *
 * `create_session` ops carry a `tempSessionId` (`offline-<uuid>`). When one
 * replays successfully the temp→real mapping is persisted and every queued
 * op referencing the temp id is rewritten.
 */

const OUTBOX_KEY = 'crm:outbox:v1';
const IDMAP_KEY = 'crm:outbox:idmap:v1';
const DEAD_LETTER_KEY = 'crm:outbox:failed:v1';
const FLUSH_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;

export const OFFLINE_ID_PREFIX = 'offline-';

export function isOfflineTempId(id: string | null | undefined): boolean {
    return typeof id === 'string' && id.startsWith(OFFLINE_ID_PREFIX);
}

export function generateOfflineUuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutboxOpInput =
    | { type: 'create_session'; payload: CreateSessionPayload }
    | { type: 'save_call'; payload: CallSavePayload }
    | { type: 'increment_session'; payload: IncrementSessionPayload }
    | { type: 'end_session'; payload: EndSessionPayload };

export type OutboxItem = OutboxOpInput & {
    id: string;
    createdAt: string;
    attempts: number;
    lastError?: string;
};

type OutboxListener = () => void;

// ---------------------------------------------------------------------------
// localStorage helpers (SSR-guarded, corruption-tolerant)
// ---------------------------------------------------------------------------

function readJson<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        console.error(`[outbox] Failed to persist ${key}:`, err);
    }
}

function readQueue(): OutboxItem[] {
    const queue = readJson<OutboxItem[]>(OUTBOX_KEY, []);
    return Array.isArray(queue) ? queue : [];
}

function writeQueue(queue: OutboxItem[]): void {
    writeJson(OUTBOX_KEY, queue);
}

function readIdMap(): Record<string, string> {
    const map = readJson<Record<string, string>>(IDMAP_KEY, {});
    return map && typeof map === 'object' ? map : {};
}

// ---------------------------------------------------------------------------
// Subscription (UI badge / banner)
// ---------------------------------------------------------------------------

const listeners = new Set<OutboxListener>();

function notify(): void {
    for (const listener of listeners) {
        try {
            listener();
        } catch (err) {
            console.error('[outbox] listener failed:', err);
        }
    }
}

export function subscribeOutbox(listener: OutboxListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function pendingCount(): number {
    return readQueue().length;
}

// ---------------------------------------------------------------------------
// Page-injected hooks for save_call side-effects (recording linkage, UI).
// Registered by the session page while mounted; replay after a reload simply
// runs without them — recordings are never replayed from the outbox.
// ---------------------------------------------------------------------------

let saveCallHooks: CallSaveHooks | null = null;

export function setSaveCallHooks(hooks: CallSaveHooks | null): void {
    saveCallHooks = hooks;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export function enqueueOutboxOp(op: OutboxOpInput): OutboxItem {
    const item: OutboxItem = {
        ...op,
        id: generateOfflineUuid(),
        createdAt: new Date().toISOString(),
        attempts: 0,
    };
    const queue = readQueue();
    queue.push(item);
    writeQueue(queue);
    console.log(`[outbox] Queued ${op.type} (${queue.length} pending)`);
    notify();
    return item;
}

// ---------------------------------------------------------------------------
// Temp-id resolution
// ---------------------------------------------------------------------------

function resolveSessionId(sessionId: string): string {
    if (!isOfflineTempId(sessionId)) return sessionId;
    const map = readIdMap();
    return map[sessionId] ?? sessionId;
}

/** Persist tempId→realId and rewrite every queued op referencing the temp id. */
function recordSessionIdMapping(tempSessionId: string, realId: string): void {
    const map = readIdMap();
    map[tempSessionId] = realId;
    writeJson(IDMAP_KEY, map);

    const queue = readQueue();
    let changed = false;
    for (const item of queue) {
        if (item.type !== 'create_session' && item.payload.sessionId === tempSessionId) {
            item.payload.sessionId = realId;
            changed = true;
        }
    }
    if (changed) writeQueue(queue);
}

// ---------------------------------------------------------------------------
// Replay engine
// ---------------------------------------------------------------------------

async function executeItem(item: OutboxItem): Promise<void> {
    switch (item.type) {
        case 'create_session': {
            const created = await executeSessionCreate(pb, item.payload);
            recordSessionIdMapping(item.payload.tempSessionId, created.id);
            break;
        }
        case 'save_call':
            await executeCallSave(
                pb,
                { ...item.payload, sessionId: resolveSessionId(item.payload.sessionId) },
                saveCallHooks
            );
            break;
        case 'increment_session':
            await executeSessionIncrement(pb, {
                ...item.payload,
                sessionId: resolveSessionId(item.payload.sessionId),
            });
            break;
        case 'end_session':
            await executeSessionEnd(pb, {
                ...item.payload,
                sessionId: resolveSessionId(item.payload.sessionId),
            });
            break;
    }
}

function updateQueuedItem(id: string, attempts: number, lastError: string): void {
    const queue = readQueue();
    const item = queue.find(i => i.id === id);
    if (!item) return;
    item.attempts = attempts;
    item.lastError = lastError;
    writeQueue(queue);
}

function removeQueuedItem(id: string): void {
    writeQueue(readQueue().filter(i => i.id !== id));
}

function moveToDeadLetter(item: OutboxItem): void {
    removeQueuedItem(item.id);
    const failed = readJson<OutboxItem[]>(DEAD_LETTER_KEY, []);
    failed.push(item);
    writeJson(DEAD_LETTER_KEY, Array.isArray(failed) ? failed : [item]);
    console.error(`[outbox] Dead-lettered ${item.type} after ${item.attempts} attempts:`, item.lastError);
}

let flushing = false;

/**
 * Replay queued ops FIFO. Safe to call from anywhere; concurrent calls no-op.
 * Stops at the first network-class failure so order is preserved and the
 * whole queue retries on the next trigger.
 */
export async function flushOutbox(): Promise<void> {
    if (flushing || typeof window === 'undefined') return;
    if (readQueue().length === 0) return;
    flushing = true;
    try {
        for (;;) {
            const queue = readQueue();
            if (queue.length === 0) break;
            const item = queue[0];
            try {
                await executeItem(item);
                removeQueuedItem(item.id);
                console.log(`[outbox] Replayed ${item.type} (${pendingCount()} left)`);
                notify();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // Only definitive (non-network) failures count toward the
                // dead-letter limit — an hours-long outage produces endless
                // network failures and must never park an item.
                const isNetwork = isPbNetworkError(err);
                const attempts = isNetwork ? item.attempts : item.attempts + 1;
                updateQueuedItem(item.id, attempts, message);
                if (!isNetwork && attempts >= MAX_ATTEMPTS) {
                    // Definitive server rejection (e.g. PocketBase 400 with
                    // response data) that has exhausted its retries — park it
                    // so the queue can't wedge forever.
                    moveToDeadLetter({ ...item, attempts, lastError: message });
                    notify();
                    continue;
                }
                // Network-ish (or not-yet-exhausted) failure — stop the loop,
                // preserve FIFO order, retry on the next trigger.
                console.warn(`[outbox] ${item.type} failed (attempt ${attempts}), will retry:`, message);
                notify();
                break;
            }
        }
    } finally {
        flushing = false;
    }
}

// ---------------------------------------------------------------------------
// Triggers — 30s interval, browser online event, pb-health recovery
// ---------------------------------------------------------------------------

let outboxStarted = false;

export function startOutbox(): void {
    if (outboxStarted || typeof window === 'undefined') return;
    outboxStarted = true;

    startPbHealthMonitor();

    setInterval(() => {
        void flushOutbox();
    }, FLUSH_INTERVAL_MS);

    window.addEventListener('online', () => {
        void flushOutbox();
    });

    subscribePbHealth((online) => {
        if (online) void flushOutbox();
    });

    // Drain anything left over from a previous session/page load.
    void flushOutbox();
}
