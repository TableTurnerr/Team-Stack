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
  await _pb.admins.authWithPassword(adminEmail, adminPassword);
  return _pb;
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

/** Delete all records from a collection whose field matches the given prefix. */
export async function cleanupByPrefix(
  collection: string,
  field: string,
  prefix: string
): Promise<number> {
  const pb = await getAdminPb();
  const escapedPrefix = prefix.replace(/'/g, "\\'");
  try {
    const records = await pb.collection(collection).getFullList({
      filter: `${field} ~ '${escapedPrefix}'`,
      fields: 'id',
    });
    for (const r of records) {
      await pb.collection(collection).delete(r.id);
    }
    return records.length;
  } catch (e: any) {
    // Collection may not exist or no records — not an error
    if (e?.status === 404) return 0;
    console.warn(`cleanupByPrefix(${collection}, ${field}): ${e?.message}`);
    return 0;
  }
}

/** Delete a single record by ID, silently ignoring 404. */
export async function deleteRecord(collection: string, id: string): Promise<void> {
  const pb = await getAdminPb();
  try {
    await pb.collection(collection).delete(id);
  } catch (e: any) {
    if (e?.status !== 404) console.warn(`deleteRecord(${collection}, ${id}): ${e?.message}`);
  }
}

/** Create a record and return it. */
export async function createRecord<T extends object>(
  collection: string,
  data: object
): Promise<T & { id: string }> {
  const pb = await getAdminPb();
  return pb.collection(collection).create<T & { id: string }>(data);
}

/** Fetch records matching a filter, return array. */
export async function fetchRecords<T extends object>(
  collection: string,
  filter: string,
  fields = ''
): Promise<(T & { id: string })[]> {
  const pb = await getAdminPb();
  return pb.collection(collection).getFullList<T & { id: string }>({
    filter,
    ...(fields ? { fields } : {}),
  });
}
