import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || '';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

let cached: PocketBase | null = null;

export async function getPbAdmin(): Promise<PocketBase | null> {
  if (!PB_URL || !PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) return null;
  if (cached && cached.authStore.isValid) return cached;

  try {
    const pb = new PocketBase(PB_URL);
    await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
    cached = pb;
    return pb;
  } catch (err) {
    console.error('[pb-admin] auth failed:', err);
    return null;
  }
}
