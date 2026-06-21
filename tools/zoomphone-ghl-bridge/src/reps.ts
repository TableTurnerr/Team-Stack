import type { Env } from "./index";

// Rep mapping: repKey (device-provisioned rep identity) → GHL userId.
//
// DECISION (see docs/selfhost-and-responsibility-split-plan.md §"shared Zoom
// account"): repKey IS the rep's GoHighLevel userId by default (passthrough), so
// this store is an OPTIONAL translation layer — never required. A mapping is only
// needed when a rep's device-provisioned key differs from their GHL userId.
//
// Mappings live in the SQLite KV under `rep:map:{repKey}` with NO TTL, so they
// survive restarts. They're set via the admin endpoints in index.ts.

const REP_MAP_PREFIX = "rep:map:";

function mapKey(repKey: string): string {
  return `${REP_MAP_PREFIX}${repKey}`;
}

/**
 * Resolve a device-provisioned repKey to the GHL userId used for call/clip
 * attribution. Returns the mapped userId when one is stored, else the repKey
 * verbatim (passthrough default). Empty/whitespace repKey → null (no rep).
 */
export async function resolveRepUserId(
  env: Env,
  repKey: string | null | undefined,
): Promise<string | null> {
  const key = repKey?.trim();
  if (!key) return null;
  const mapped = await env.STATE.get(mapKey(key));
  if (mapped) {
    try {
      const parsed = JSON.parse(mapped) as { ghl_user_id?: string };
      if (parsed.ghl_user_id?.trim()) return parsed.ghl_user_id.trim();
    } catch {
      // A legacy/plain value: treat the raw string as the userId.
      if (mapped.trim()) return mapped.trim();
    }
  }
  // Passthrough: repKey is the GHL userId.
  return key;
}

export type RepMapping = { repKey: string; ghlUserId: string };

/** Store (or overwrite) a repKey → GHL userId mapping. No TTL. */
export async function setRepMapping(env: Env, repKey: string, ghlUserId: string): Promise<void> {
  const key = repKey.trim();
  const value = ghlUserId.trim();
  await env.STATE.put(mapKey(key), JSON.stringify({ ghl_user_id: value }));
}

/** Read a single mapping, or null if none is stored for this repKey. */
export async function getRepMapping(env: Env, repKey: string): Promise<RepMapping | null> {
  const key = repKey.trim();
  if (!key) return null;
  const raw = await env.STATE.get(mapKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ghl_user_id?: string };
    if (parsed.ghl_user_id) return { repKey: key, ghlUserId: parsed.ghl_user_id };
  } catch {
    if (raw.trim()) return { repKey: key, ghlUserId: raw.trim() };
  }
  return null;
}

/** Remove a mapping. Idempotent. */
export async function deleteRepMapping(env: Env, repKey: string): Promise<void> {
  await env.STATE.delete(mapKey(repKey.trim()));
}

/** List every stored mapping (for the admin GET endpoint). */
export async function listRepMappings(env: Env): Promise<RepMapping[]> {
  const keys = await env.STATE.list(REP_MAP_PREFIX);
  const out: RepMapping[] = [];
  for (const fullKey of keys) {
    const repKey = fullKey.slice(REP_MAP_PREFIX.length);
    const mapping = await getRepMapping(env, repKey);
    if (mapping) out.push(mapping);
  }
  return out;
}
