import 'server-only';

type Entry<T> = { value: T; expiresAt: number };

// This cache is intentionally process-local: it avoids duplicate reads within a
// warm server instance without ever storing user data in a shared/public cache.
// `inFlight` also collapses simultaneous requests (for example, two mounted
// dashboard surfaces asking for the same pipeline column at once).
const values = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const scopeVersions = new Map<string, number>();
const MAX_ENTRIES = 500;

export async function cachedDashboardRead<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const scope = key.slice(0, key.indexOf(':'));
  const scopeVersion = scopeVersions.get(scope) || 0;
  const versionedKey = `${scopeVersion}:${key}`;
  const now = Date.now();
  const cached = values.get(versionedKey) as Entry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const pending = inFlight.get(versionedKey) as Promise<T> | undefined;
  if (pending) return pending;

  const request = loader().then(value => {
    if (values.size >= MAX_ENTRIES) {
      const oldest = values.keys().next().value;
      if (oldest) values.delete(oldest);
    }
    // Do not repopulate a value that became stale while its request was active.
    if ((scopeVersions.get(scope) || 0) === scopeVersion) {
      values.set(versionedKey, { value, expiresAt: Date.now() + ttlMs });
    }
    return value;
  }).finally(() => inFlight.delete(versionedKey));
  inFlight.set(versionedKey, request);
  return request;
}

export function invalidateDashboardReads(userId: string) {
  scopeVersions.set(userId, (scopeVersions.get(userId) || 0) + 1);
  for (const key of values.keys()) if (key.endsWith(`:${userId}`) || key.includes(`:${userId}:`)) values.delete(key);
}
