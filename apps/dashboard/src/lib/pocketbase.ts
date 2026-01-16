import PocketBase from 'pocketbase';

export const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);

// Disable auto-cancellation for SSR compatibility
pb.autoCancellation(false);

// Server-side auth helper
export async function getServerPb() {
  const serverPb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);
  serverPb.autoCancellation(false);
  return serverPb;
}
