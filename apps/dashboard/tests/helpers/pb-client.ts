/**
 * pb-client.ts
 * A lightweight PocketBase client used by tests to:
 *   1. Create seed data before a test suite
 *   2. Delete test data after a test suite (cleanup)
 *
 * Uses the admin credentials from .env.test so it bypasses collection rules.
 */
import PocketBase from 'pocketbase';

let _pb: PocketBase | null = null;

/**
 * Retry a PocketBase operation with exponential backoff when a 429 is received.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 5): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.status === 429) {
        lastErr = e;
        const delayMs = Math.min(600 * Math.pow(2, attempt), 10_000);
        console.warn(`[pb-client] 429 on ${label}, retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function getAdminPb(): Promise<PocketBase> {
  if (_pb && _pb.authStore.isValid) return _pb;

  const url = process.env.TEST_POCKETBASE_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
  const adminEmail = process.env.TEST_PB_ADMIN_EMAIL;
  const adminPassword = process.env.TEST_PB_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      '❌  TEST_PB_ADMIN_EMAIL and TEST_PB_ADMIN_PASSWORD must be set in .env.test'
    );
  }

  _pb = new PocketBase(url);
  await _pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
  return _pb;
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

/** Delete all records from a collection whose field matches the given prefix. Retries on 429. */
export async function cleanupByPrefix(
  collection: string,
  field: string,
  prefix: string
): Promise<number> {
  const pb = await getAdminPb();
  const escapedPrefix = prefix
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'');
  try {
    const records = await withRetry(
      () => pb.collection(collection).getFullList({ filter: `${field} ~ '${escapedPrefix}'`, fields: 'id' }),
      `list ${collection}`,
    );
    for (const r of records) {
      await withRetry(() => pb.collection(collection).delete(r.id), `delete ${collection}`).catch((e: any) => {
        if (e?.status !== 404) console.warn(`cleanupByPrefix delete(${collection}, ${r.id}): ${e?.message}`);
      });
    }
    return records.length;
  } catch (e: any) {
    if (e?.status === 404) return 0;
    console.warn(`cleanupByPrefix(${collection}, ${field}): ${e?.message}`);
    return 0;
  }
}

/** Delete a single record by ID, silently ignoring 404. Retries on 429. */
export async function deleteRecord(collection: string, id: string): Promise<void> {
  const pb = await getAdminPb();
  try {
    await withRetry(() => pb.collection(collection).delete(id), `delete ${collection}`);
  } catch (e: any) {
    if (e?.status !== 404) console.warn(`deleteRecord(${collection}, ${id}): ${e?.message}`);
  }
}

/** Create a record and return it. Retries automatically on HTTP 429. */
export async function createRecord<T extends object>(
  collection: string,
  data: object
): Promise<T & { id: string }> {
  // Small base delay to reduce burst pressure on PocketBase
  await new Promise((resolve) => setTimeout(resolve, 100));
  const pb = await getAdminPb();
  return withRetry(
    () => pb.collection(collection).create<T & { id: string }>(data),
    `create ${collection}`,
  );
}

/** Fetch records matching a filter, return array. Retries on HTTP 429. */
export async function fetchRecords<T extends object>(
  collection: string,
  filter: string,
  fields = ''
): Promise<(T & { id: string })[]> {
  const pb = await getAdminPb();
  return withRetry(
    () =>
      pb.collection(collection).getFullList<T & { id: string }>({
        filter,
        ...(fields ? { fields } : {}),
      }),
    `fetch ${collection}`,
  );
}
