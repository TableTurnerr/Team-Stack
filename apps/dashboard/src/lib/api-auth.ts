import PocketBase from 'pocketbase';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;

/**
 * Validates a PocketBase auth token from the Authorization header.
 * Returns the authenticated user record or null if invalid.
 */
export async function authenticateRequest(request: Request): Promise<{ id: string; email: string } | null> {
  if (!PB_URL) return null;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!token) return null;

  try {
    const serverPb = new PocketBase(PB_URL);
    serverPb.authStore.save(token, { id: '' });
    const result = await serverPb.collection('users').authRefresh();
    return { id: result.record.id, email: result.record.email };
  } catch {
    return null;
  }
}
