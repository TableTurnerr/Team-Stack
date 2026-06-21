import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PendingClipMeta, PendingClipStore, StoredClip } from "./types";

// On-disk + SQLite store for recorded clips awaiting correlation to a Zoom call.
// The audio bytes are written to a clips/ dir; one row per clip is queryable by
// real Zoom call_id (exact) and by phone + connect time (fallback) so the
// call-log handler can reverse-attach.

function extFor(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  return "mp3";
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

type Row = {
  client_call_id: string;
  zoom_call_id: string | null;
  phone_e164: string;
  connect_ts_ms: number;
  end_ts_ms: number;
  channel: string;
  rep_key: string;
  direction: string | null;
  content_type: string;
  file_path: string;
  created_at: number;
};

function toClip(r: Row): StoredClip {
  return {
    clientCallId: r.client_call_id,
    zoomCallId: r.zoom_call_id,
    phoneE164: r.phone_e164,
    connectTsMs: r.connect_ts_ms,
    endTsMs: r.end_ts_ms,
    channel: r.channel,
    repKey: r.rep_key,
    direction: r.direction,
    contentType: r.content_type,
    filePath: r.file_path,
    createdAt: r.created_at,
  };
}

export class SqlitePendingClipStore implements PendingClipStore {
  readonly #db: DatabaseSync;
  readonly #dir: string;

  constructor(db: DatabaseSync, clipsDir: string) {
    this.#db = db;
    this.#dir = clipsDir;
    mkdirSync(clipsDir, { recursive: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_clips (
        client_call_id TEXT PRIMARY KEY,
        zoom_call_id   TEXT,
        phone_e164     TEXT NOT NULL,
        connect_ts_ms  INTEGER NOT NULL,
        end_ts_ms      INTEGER NOT NULL,
        channel        TEXT NOT NULL,
        rep_key        TEXT NOT NULL,
        direction      TEXT,
        content_type   TEXT NOT NULL,
        file_path      TEXT NOT NULL,
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pending_clips_phone ON pending_clips (phone_e164, connect_ts_ms);
    `);
    // Idempotent migration for tables created before zoom_call_id existed; the
    // index must come AFTER the column exists on those older tables.
    try {
      db.exec("ALTER TABLE pending_clips ADD COLUMN zoom_call_id TEXT");
    } catch {
      /* column already present */
    }
    db.exec("CREATE INDEX IF NOT EXISTS pending_clips_zoom ON pending_clips (zoom_call_id)");
  }

  async save(meta: PendingClipMeta, bytes: Uint8Array): Promise<StoredClip> {
    const filePath = join(this.#dir, `${safeName(meta.clientCallId)}.${extFor(meta.contentType)}`);
    writeFileSync(filePath, bytes);
    const createdAt = Date.now();
    this.#db
      .prepare(
        `INSERT INTO pending_clips
           (client_call_id, zoom_call_id, phone_e164, connect_ts_ms, end_ts_ms, channel, rep_key, direction, content_type, file_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_call_id) DO UPDATE SET
           zoom_call_id=excluded.zoom_call_id, phone_e164=excluded.phone_e164,
           connect_ts_ms=excluded.connect_ts_ms, end_ts_ms=excluded.end_ts_ms,
           channel=excluded.channel, rep_key=excluded.rep_key, direction=excluded.direction,
           content_type=excluded.content_type, file_path=excluded.file_path`,
      )
      .run(
        meta.clientCallId,
        meta.zoomCallId,
        meta.phoneE164,
        meta.connectTsMs,
        meta.endTsMs,
        meta.channel,
        meta.repKey,
        meta.direction,
        meta.contentType,
        filePath,
        createdAt,
      );
    return { ...meta, filePath, createdAt };
  }

  async get(clientCallId: string): Promise<StoredClip | null> {
    const row = this.#db
      .prepare("SELECT * FROM pending_clips WHERE client_call_id = ?")
      .get(clientCallId) as Row | undefined;
    return row ? toClip(row) : null;
  }

  async findByZoomCallId(zoomCallId: string): Promise<StoredClip[]> {
    if (!zoomCallId) return [];
    const rows = this.#db
      .prepare("SELECT * FROM pending_clips WHERE zoom_call_id = ?")
      .all(zoomCallId) as Row[];
    return rows.map(toClip);
  }

  async findMatches(phoneE164: string, aroundTsMs: number, windowMs: number): Promise<StoredClip[]> {
    const rows = this.#db
      .prepare(
        "SELECT * FROM pending_clips WHERE phone_e164 = ? AND ABS(connect_ts_ms - ?) <= ? ORDER BY ABS(connect_ts_ms - ?) ASC",
      )
      .all(phoneE164, aroundTsMs, windowMs, aroundTsMs) as Row[];
    return rows.map(toClip);
  }

  async readBytes(clip: StoredClip): Promise<Uint8Array> {
    return readFileSync(clip.filePath);
  }

  async remove(clientCallId: string): Promise<void> {
    const clip = await this.get(clientCallId);
    this.#db.prepare("DELETE FROM pending_clips WHERE client_call_id = ?").run(clientCallId);
    if (clip) {
      try {
        rmSync(clip.filePath, { force: true });
      } catch {
        /* best-effort file cleanup */
      }
    }
  }

  async listStale(olderThanMs: number): Promise<StoredClip[]> {
    const cutoff = Date.now() - olderThanMs;
    const rows = this.#db
      .prepare("SELECT * FROM pending_clips WHERE created_at <= ?")
      .all(cutoff) as Row[];
    return rows.map(toClip);
  }
}
