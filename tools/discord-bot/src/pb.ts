import PocketBase from 'pocketbase';
import 'dotenv/config';

const POCKETBASE_URL = process.env.POCKETBASE_URL!;
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL!;
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD!;

if (!POCKETBASE_URL || !POCKETBASE_ADMIN_EMAIL || !POCKETBASE_ADMIN_PASSWORD) {
  throw new Error('Missing required PocketBase environment variables.');
}

export const pb = new PocketBase(POCKETBASE_URL);

// Disable auto-cancellation so concurrent requests don't cancel each other
pb.autoCancellation(false);

export async function authAdmin(): Promise<void> {
  await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
  console.log('[PocketBase] Admin authenticated.');
}

/**
 * Wraps a PocketBase API call and re-authenticates on 401 errors before retrying once.
 */
export async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) {
      console.warn('[PocketBase] Token expired — re-authenticating...');
      await authAdmin();
      return await fn();
    }
    throw err;
  }
}
