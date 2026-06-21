import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { openDb, SqliteKv } from "./kv";
import { SqlitePendingClipStore } from "./clips";
import type { Env } from "../index";

// Secrets the handlers actually need to do real work. ZOOM_VERIFICATION_TOKEN is
// optional (kept for parity) and AGENT_SHARED_TOKEN gates the recording upload.
const REQUIRED_SECRETS = [
  "ZOOM_SECRET_TOKEN",
  "ZOOM_CLIENT_ID",
  "ZOOM_CLIENT_SECRET",
  "ZOOM_ACCOUNT_ID",
  "GHL_MARKETPLACE_CLIENT_ID",
  "GHL_MARKETPLACE_CLIENT_SECRET",
  "GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID",
  "GHL_LOCATION_ID",
  "AGENT_SHARED_TOKEN",
] as const;

export function buildEnv(): { env: Env; kv: SqliteKv } {
  // Load a local .env if present (the deploy box may inject real env vars
  // instead). Best-effort: absence is fine, real process.env still wins.
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file — rely on the ambient environment */
  }

  const dbPath = resolve(process.env.BRIDGE_DB_PATH ?? "./data/bridge.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  const kv = new SqliteKv(db);
  const clips = new SqlitePendingClipStore(db, join(dirname(dbPath), "clips"));

  const missing = REQUIRED_SECRETS.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `[env] missing required secrets: ${missing.join(", ")} — affected routes will fail until set`,
    );
  }

  const env: Env = {
    STATE: kv,
    CLIPS: clips,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? "",
    ZOOM_SECRET_TOKEN: process.env.ZOOM_SECRET_TOKEN ?? "",
    ZOOM_VERIFICATION_TOKEN: process.env.ZOOM_VERIFICATION_TOKEN ?? "",
    ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID ?? "",
    ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET ?? "",
    ZOOM_ACCOUNT_ID: process.env.ZOOM_ACCOUNT_ID ?? "",
    GHL_MARKETPLACE_CLIENT_ID: process.env.GHL_MARKETPLACE_CLIENT_ID ?? "",
    GHL_MARKETPLACE_CLIENT_SECRET: process.env.GHL_MARKETPLACE_CLIENT_SECRET ?? "",
    GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID:
      process.env.GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID ?? "",
    GHL_LOCATION_ID: process.env.GHL_LOCATION_ID ?? "",
    AGENT_SHARED_TOKEN: process.env.AGENT_SHARED_TOKEN ?? "",
  };

  return { env, kv };
}
