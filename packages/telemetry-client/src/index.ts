/**
 * CRM-Tableturnerr Telemetry Client
 *
 * Dependency-free client for pushing structured logs and heartbeats to a
 * central ingest API. Designed to never crash or block its host service:
 * every public method swallows its own errors and degrades to a no-op when
 * telemetry is not configured or `fetch` is unavailable.
 *
 * Requires a runtime with a global `fetch` (Node 18+, modern browsers/workers).
 * NOTE: the token is a server-side secret. Only run this where env secrets are
 * safe; never ship it to a browser bundle.
 */

// ============================================================================
// Public Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type HeartbeatStatus = 'ok' | 'degraded' | 'down';

export interface TelemetryOptions {
    /** Base URL of the ingest API, e.g. "https://ingest.example.com". */
    url: string;
    /** Bearer token (server-side secret). */
    token: string;
    /** Stable identifier for the calling service. */
    serviceKey: string;
    /** Auto-flush interval in ms (default 15000). */
    flushIntervalMs?: number;
    /** Flush automatically once the queue reaches this size (default 50, capped at 100). */
    maxBatch?: number;
    /** Context merged into every log entry. */
    defaultContext?: Record<string, unknown>;
    /** Error sink. Defaults to console.warn. Must never throw. */
    onError?: (e: unknown) => void;
}

/** Options accepted by `log` and the level convenience methods. */
export interface LogOptions {
    event?: string;
    context?: Record<string, unknown>;
}

/** Options accepted by `heartbeat` / `startHeartbeat`. */
export interface HeartbeatOptions {
    version?: string;
    status?: HeartbeatStatus;
    meta?: Record<string, unknown>;
}

/** A single queued log entry, shaped to match the ingest contract. */
interface LogEntry {
    level: LogLevel;
    message: string;
    event?: string;
    context?: Record<string, unknown>;
    ts: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FLUSH_INTERVAL_MS = 15000;
const DEFAULT_MAX_BATCH = 50;
/** Hard cap on entries per request enforced by the ingest contract. */
const MAX_ENTRIES_PER_REQUEST = 100;

// ============================================================================
// Telemetry Client
// ============================================================================

export class TelemetryClient {
    private readonly url: string;
    private readonly token: string;
    private readonly serviceKey: string;
    private readonly flushIntervalMs: number;
    private readonly maxBatch: number;
    private readonly defaultContext?: Record<string, unknown>;
    private readonly onError: (e: unknown) => void;

    /** When true every method is a no-op (missing url/token). */
    private readonly disabled: boolean;

    private queue: LogEntry[] = [];

    private flushTimer?: ReturnType<typeof setInterval>;
    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private heartbeatOpts?: HeartbeatOptions;

    constructor(opts: TelemetryOptions) {
        this.url = (opts.url ?? '').replace(/\/+$/, '');
        this.token = opts.token ?? '';
        this.serviceKey = opts.serviceKey;
        this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
        this.maxBatch = clampBatch(opts.maxBatch ?? DEFAULT_MAX_BATCH);
        this.defaultContext = opts.defaultContext;
        this.onError =
            opts.onError ??
            ((e: unknown): void => {
                // eslint-disable-next-line no-console
                console.warn('[telemetry] error:', e);
            });

        this.disabled = this.url === '' || this.token === '';
        if (this.disabled) {
            // eslint-disable-next-line no-console
            console.warn(
                '[telemetry] disabled: missing url or token. Logs and heartbeats will be dropped.'
            );
        }
    }

    /** True when the client is configured and able to send. */
    get enabled(): boolean {
        return !this.disabled;
    }

    // -------------------------------------------------------------------------
    // Logging
    // -------------------------------------------------------------------------

    /**
     * Queue a log entry. Never throws. Auto-flushes (fire-and-forget) once the
     * queue reaches `maxBatch`.
     */
    log(level: LogLevel, message: string, opts?: LogOptions): void {
        if (this.disabled) {
            return;
        }
        try {
            const context = mergeContext(this.defaultContext, opts?.context);
            const entry: LogEntry = {
                level,
                message,
                ts: new Date().toISOString(),
            };
            if (opts?.event !== undefined) {
                entry.event = opts.event;
            }
            if (context !== undefined) {
                entry.context = context;
            }
            this.queue.push(entry);

            if (this.queue.length >= this.maxBatch) {
                // Fire-and-forget; flush handles its own errors.
                void this.flush();
            }
        } catch (e) {
            this.onError(e);
        }
    }

    debug(message: string, opts?: LogOptions): void {
        this.log('debug', message, opts);
    }

    info(message: string, opts?: LogOptions): void {
        this.log('info', message, opts);
    }

    warn(message: string, opts?: LogOptions): void {
        this.log('warn', message, opts);
    }

    error(message: string, opts?: LogOptions): void {
        this.log('error', message, opts);
    }

    fatal(message: string, opts?: LogOptions): void {
        this.log('fatal', message, opts);
    }

    /**
     * Drain the queue to the ingest API. The queue is always cleared on attempt;
     * batches are dropped (not retried) on failure to avoid unbounded memory.
     * Never throws.
     */
    async flush(): Promise<void> {
        if (this.disabled || this.queue.length === 0) {
            return;
        }

        // Take everything and clear the queue immediately ("clear on attempt").
        const drained = this.queue;
        this.queue = [];

        const sendFn = getFetch();
        if (sendFn === undefined) {
            this.onError(new Error('[telemetry] global fetch is not available; dropping logs'));
            return;
        }

        for (let i = 0; i < drained.length; i += MAX_ENTRIES_PER_REQUEST) {
            const entries = drained.slice(i, i + MAX_ENTRIES_PER_REQUEST);
            try {
                const res = await sendFn(`${this.url}/api/telemetry/logs`, {
                    method: 'POST',
                    headers: this.headers(),
                    body: JSON.stringify({
                        service_key: this.serviceKey,
                        entries,
                    }),
                });
                // 207 = partial success (some entries rejected); treat as error
                // for reporting purposes but still drop the batch.
                if (!res.ok || res.status === 207) {
                    this.onError(
                        new Error(`[telemetry] logs ingest returned status ${res.status}`)
                    );
                }
            } catch (e) {
                // Network/other failure: report and drop this chunk.
                this.onError(e);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Auto-flush timer
    // -------------------------------------------------------------------------

    /** Start periodic flushing. Idempotent. */
    startAutoFlush(): void {
        if (this.disabled || this.flushTimer !== undefined) {
            return;
        }
        const timer = setInterval(() => {
            void this.flush();
        }, this.flushIntervalMs);
        unref(timer);
        this.flushTimer = timer;
    }

    stopAutoFlush(): void {
        if (this.flushTimer !== undefined) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    // -------------------------------------------------------------------------
    // Heartbeats
    // -------------------------------------------------------------------------

    /** Send a single heartbeat. Never throws; errors go to `onError`. */
    async heartbeat(opts?: HeartbeatOptions): Promise<void> {
        if (this.disabled) {
            return;
        }

        const sendFn = getFetch();
        if (sendFn === undefined) {
            this.onError(new Error('[telemetry] global fetch is not available; dropping heartbeat'));
            return;
        }

        const body: {
            service_key: string;
            version?: string;
            status?: HeartbeatStatus;
            meta?: Record<string, unknown>;
        } = { service_key: this.serviceKey };
        if (opts?.version !== undefined) {
            body.version = opts.version;
        }
        if (opts?.status !== undefined) {
            body.status = opts.status;
        }
        if (opts?.meta !== undefined) {
            body.meta = opts.meta;
        }

        try {
            const res = await sendFn(`${this.url}/api/telemetry/heartbeat`, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                this.onError(
                    new Error(`[telemetry] heartbeat ingest returned status ${res.status}`)
                );
            }
        } catch (e) {
            this.onError(e);
        }
    }

    /** Start periodic heartbeats and send one immediately. Idempotent. */
    startHeartbeat(intervalMs: number, opts?: HeartbeatOptions): void {
        if (this.disabled || this.heartbeatTimer !== undefined) {
            return;
        }
        this.heartbeatOpts = opts;
        // Send one immediately on start (fire-and-forget).
        void this.heartbeat(this.heartbeatOpts);

        const timer = setInterval(() => {
            void this.heartbeat(this.heartbeatOpts);
        }, intervalMs);
        unref(timer);
        this.heartbeatTimer = timer;
    }

    stopHeartbeat(): void {
        if (this.heartbeatTimer !== undefined) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /** Stop all timers and perform a final flush. Never throws. */
    async close(): Promise<void> {
        this.stopAutoFlush();
        this.stopHeartbeat();
        await this.flush();
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private headers(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
        };
    }
}

// ============================================================================
// Helpers
// ============================================================================

function clampBatch(n: number): number {
    if (!Number.isFinite(n) || n < 1) {
        return 1;
    }
    return Math.min(Math.floor(n), MAX_ENTRIES_PER_REQUEST);
}

function mergeContext(
    base: Record<string, unknown> | undefined,
    extra: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
    if (base === undefined && extra === undefined) {
        return undefined;
    }
    return { ...base, ...extra };
}

/** Resolve the global fetch, or undefined if it is unavailable. */
function getFetch(): typeof fetch | undefined {
    return typeof fetch === 'function' ? fetch : undefined;
}

/** Best-effort unref so a timer never keeps the process alive. */
function unref(timer: ReturnType<typeof setInterval>): void {
    const maybe = timer as unknown as { unref?: () => void };
    if (typeof maybe.unref === 'function') {
        maybe.unref();
    }
}

// ============================================================================
// Factories
// ============================================================================

/** Create a telemetry client from explicit options. */
export function createTelemetry(opts: TelemetryOptions): TelemetryClient {
    return new TelemetryClient(opts);
}

/**
 * Create a telemetry client from an environment bag. Reads `TELEMETRY_URL` and
 * `TELEMETRY_TOKEN`. If either is absent the returned client is a no-op, so a
 * service without telemetry configured still runs fine.
 */
export function telemetryFromEnv(
    env: Record<string, string | undefined>,
    serviceKey: string
): TelemetryClient {
    return new TelemetryClient({
        url: env.TELEMETRY_URL ?? '',
        token: env.TELEMETRY_TOKEN ?? '',
        serviceKey,
    });
}
