// Runtime interfaces that decouple the request handlers from Cloudflare. The
// handlers were written against the Workers runtime (KV + ExecutionContext);
// these minimal interfaces are the only surface they need, so the same `src/`
// code runs on self-hosted Node with a SQLite-backed store and a no-op
// waitUntil. See `selfhost-and-responsibility-split-plan.md` §0.

/** Key/value surface used by the handlers — the subset of the old KVNamespace. */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * List non-expired keys that start with `prefix`. Used by admin endpoints
   * (e.g. listing rep mappings). The old Workers KV had `list({ prefix })`; this
   * is the minimal equivalent the handlers need.
   */
  list(prefix: string): Promise<string[]>;
}

/**
 * Stand-in for the Workers `ExecutionContext`. On Workers, `waitUntil` extends
 * the request's lifetime so async work survives the response. A long-running
 * Node process doesn't need that — the work just runs in the background and we
 * log failures.
 */
export interface ExecCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/** Metadata for a recorded call clip awaiting correlation to a Zoom call. */
export interface PendingClipMeta {
  clientCallId: string;
  /** Real Zoom call_id, when the agent resolved it (device-IP match against
   *  call_history). Enables exact correlation; null falls back to phone+time. */
  zoomCallId: string | null;
  phoneE164: string;
  connectTsMs: number;
  endTsMs: number;
  channel: string;
  /** Device-provisioned rep identity (maps to a GHL userId). NOT a Zoom user_id. */
  repKey: string;
  /** Agent's local direction guess — advisory; the correlated Zoom call wins. */
  direction: string | null;
  contentType: string;
}

/** A pending clip plus where its bytes live on disk and when it arrived. */
export interface StoredClip extends PendingClipMeta {
  filePath: string;
  createdAt: number;
}

/**
 * Holds recorded clips that arrived before (or without) the matching Zoom call
 * webhook, so the call-log handler can attach them once the call is logged. The
 * bytes live on disk; rows are queryable by phone + time for reverse-attach.
 */
export interface PendingClipStore {
  save(meta: PendingClipMeta, bytes: Uint8Array): Promise<StoredClip>;
  get(clientCallId: string): Promise<StoredClip | null>;
  findByZoomCallId(zoomCallId: string): Promise<StoredClip[]>;
  findMatches(phoneE164: string, aroundTsMs: number, windowMs: number): Promise<StoredClip[]>;
  readBytes(clip: StoredClip): Promise<Uint8Array>;
  remove(clientCallId: string): Promise<void>;
  listStale(olderThanMs: number): Promise<StoredClip[]>;
}
