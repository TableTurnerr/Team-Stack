'use client';

import { useCallback, useEffect, useState } from 'react';
import { pb } from '@/lib/pocketbase';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export type PushStatus =
  | 'unsupported'
  | 'unconfigured'
  | 'unregistered'
  | 'denied'
  | 'subscribed'
  | 'prompt';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

async function authedFetch(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pb.authStore.token}`,
    },
    body: JSON.stringify(body),
  });
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('unregistered');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupported()) { setStatus('unsupported'); return; }
    if (!VAPID_PUBLIC_KEY) { setStatus('unconfigured'); return; }
    if (Notification.permission === 'denied') { setStatus('denied'); return; }

    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (!reg) { setStatus('unregistered'); return; }
      const sub = await reg.pushManager.getSubscription();
      if (sub) { setStatus('subscribed'); return; }
      setStatus(Notification.permission === 'granted' ? 'unregistered' : 'prompt');
    } catch {
      setStatus('unregistered');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    if (!isSupported()) { setStatus('unsupported'); return false; }
    if (!VAPID_PUBLIC_KEY) { setStatus('unconfigured'); setError('VAPID public key missing'); return false; }

    setBusy(true);
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'prompt');
        return false;
      }

      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const json = sub.toJSON();
      const res = await authedFetch('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: navigator.userAgent,
      });
      if (!res.ok) {
        setError(`subscribe failed (${res.status})`);
        return false;
      }

      setStatus('subscribed');
      return true;
    } catch (err) {
      console.error('[push] enable failed', err);
      setError(err instanceof Error ? err.message : 'unknown error');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    if (!isSupported()) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await authedFetch('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus(Notification.permission === 'granted' ? 'unregistered' : 'prompt');
      return true;
    } catch (err) {
      console.error('[push] disable failed', err);
      setError(err instanceof Error ? err.message : 'unknown error');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, enable, disable, refresh };
}
