import webpush, { type PushSubscription, type SendResult } from 'web-push';
import type PocketBase from 'pocketbase';
import { getPbAdmin } from './pb-admin';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@tableturnerr.com';

let configured = false;

function configure(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  renotify?: boolean;
}

export interface StoredSubscription {
  id: string;
  user: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPushToSubscription(
  sub: StoredSubscription,
  payload: PushPayload,
  pb?: PocketBase
): Promise<{ ok: boolean; gone: boolean }> {
  if (!configure()) return { ok: false, gone: false };

  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    const result: SendResult = await webpush.sendNotification(subscription, JSON.stringify(payload));
    if (pb && result && typeof result.statusCode === 'number' && result.statusCode >= 200 && result.statusCode < 300) {
      try {
        await pb.collection('push_subscriptions').update(sub.id, { last_success: new Date().toISOString() });
      } catch (_err) { /* non-fatal */ }
    }
    return { ok: true, gone: false };
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    const gone = status === 404 || status === 410;
    if (gone) {
      const admin = pb ?? (await getPbAdmin());
      if (admin) {
        try { await admin.collection('push_subscriptions').delete(sub.id); } catch (_err) { /* ignore */ }
      }
    } else {
      console.error('[push-server] send failed', status, err);
    }
    return { ok: false, gone };
  }
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}
