import { DatabaseSync } from "node:sqlite";
import type { KvStore } from "./types";

// SQLite-backed replacement for Cloudflare KV. Single table, string values,
// optional per-key expiry (mirrors KV's `expirationTtl`). Expiry is enforced
// lazily on read and reclaimed in bulk by `sweep()` (called on an interval by
// the server). node:sqlite is synchronous, which is fine for this volume.

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS kv_expires_at ON kv (expires_at);
  `);
  return db;
}

export class SqliteKv implements KvStore {
  readonly #db: DatabaseSync;
  readonly #getStmt;
  readonly #putStmt;
  readonly #delStmt;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#getStmt = db.prepare("SELECT value, expires_at FROM kv WHERE key = ?");
    this.#putStmt = db.prepare(
      "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
    );
    this.#delStmt = db.prepare("DELETE FROM kv WHERE key = ?");
  }

  async get(key: string): Promise<string | null> {
    const row = this.#getStmt.get(key) as
      | { value: string; expires_at: number | null }
      | undefined;
    if (!row) return null;
    if (row.expires_at != null && row.expires_at <= Date.now()) {
      this.#delStmt.run(key);
      return null;
    }
    return row.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const expiresAt =
      opts?.expirationTtl && opts.expirationTtl > 0
        ? Date.now() + Math.floor(opts.expirationTtl) * 1000
        : null;
    this.#putStmt.run(key, value, expiresAt);
  }

  async delete(key: string): Promise<void> {
    this.#delStmt.run(key);
  }

  async list(prefix: string): Promise<string[]> {
    // LIKE with an escaped prefix; '\' escapes the LIKE wildcards in the prefix.
    const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const now = Date.now();
    const rows = this.#db
      .prepare(
        "SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\' AND (expires_at IS NULL OR expires_at > ?) ORDER BY key",
      )
      .all(pattern, now) as { key: string }[];
    return rows.map((r) => r.key);
  }

  /** Reclaim expired rows; returns how many were removed. */
  sweep(): number {
    const res = this.#db
      .prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(Date.now());
    return Number(res.changes ?? 0);
  }
}
