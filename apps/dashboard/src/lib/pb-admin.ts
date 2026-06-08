import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || '';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

let cached: PocketBase | null = null;
// Coalesce concurrent auths onto one promise. The extension fires a burst of
// /api/ghl/* calls at once (e.g. 15 duplicate checks + sends). On a cold
// serverless instance `cached` is null, so without this every call in the burst
// would run its own `_superusers` authWithPassword simultaneously — a thundering
// herd that PocketBase can rate-limit or that fails transiently under load,
// surfacing to the user as pb_unavailable/503. One shared in-flight auth means a
// single round-trip for the whole herd. (Mirrors `refreshInFlight` in lib/ghl.ts.)
let authInFlight: Promise<PocketBase | null> | null = null;

export async function getPbAdmin(): Promise<PocketBase | null> {
  if (!PB_URL || !PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) return null;
  if (cached && cached.authStore.isValid) return cached;
  if (authInFlight) return authInFlight;

  authInFlight = (async () => {
    try {
      const pb = new PocketBase(PB_URL);
      await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
      cached = pb;
      return pb;
    } catch (err) {
      console.error('[pb-admin] auth failed:', err);
      return null;
    } finally {
      // Release the lock once settled so the next expiry/cold-start re-auths.
      authInFlight = null;
    }
  })();

  return authInFlight;
}
