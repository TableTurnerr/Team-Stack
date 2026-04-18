import { Client, Receiver } from '@upstash/qstash';

const QSTASH_TOKEN = process.env.QSTASH_TOKEN || '';
const QSTASH_URL = process.env.QSTASH_URL || '';
const QSTASH_CURRENT_SIGNING_KEY = process.env.QSTASH_CURRENT_SIGNING_KEY || '';
const QSTASH_NEXT_SIGNING_KEY = process.env.QSTASH_NEXT_SIGNING_KEY || '';

function resolveAppUrl(): string {
  const explicit = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

export function isQstashConfigured(): boolean {
  return Boolean(QSTASH_TOKEN && resolveAppUrl());
}

let client: Client | null = null;
function getClient(): Client | null {
  if (!QSTASH_TOKEN) return null;
  if (!client) {
    client = new Client({
      token: QSTASH_TOKEN,
      ...(QSTASH_URL ? { baseUrl: QSTASH_URL } : {}),
    });
  }
  return client;
}

let receiver: Receiver | null = null;
export function getReceiver(): Receiver | null {
  if (!QSTASH_CURRENT_SIGNING_KEY || !QSTASH_NEXT_SIGNING_KEY) return null;
  if (!receiver) {
    receiver = new Receiver({
      currentSigningKey: QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: QSTASH_NEXT_SIGNING_KEY,
    });
  }
  return receiver;
}

// QStash caps `notBefore` at 7 days in the future.
const MAX_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export async function scheduleFollowUpPush(
  followUpId: string,
  scheduledTimeIso: string
): Promise<{ messageId: string } | { skipped: string }> {
  const c = getClient();
  const appUrl = resolveAppUrl();
  if (!c || !appUrl) return { skipped: 'qstash_unconfigured' };

  const scheduledMs = new Date(scheduledTimeIso).getTime();
  if (!Number.isFinite(scheduledMs)) return { skipped: 'invalid_time' };

  const delayMs = scheduledMs - Date.now();
  if (delayMs > MAX_DELAY_MS) return { skipped: 'too_far_in_future' };

  const url = `${appUrl}/api/qstash/push-followup`;
  const body = { followUpId };

  const res = await c.publishJSON({
    url,
    body,
    // `notBefore` is unix seconds; QStash delivers immediately for past values.
    notBefore: Math.max(0, Math.floor(scheduledMs / 1000)),
    retries: 3,
  });

  return { messageId: res.messageId };
}

export async function cancelFollowUpPush(messageId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.messages.delete(messageId);
    return true;
  } catch (err) {
    // 404 means it already fired or was already deleted — fine.
    const status = (err as { status?: number })?.status;
    if (status === 404) return true;
    console.error('[qstash] cancel failed', err);
    return false;
  }
}
