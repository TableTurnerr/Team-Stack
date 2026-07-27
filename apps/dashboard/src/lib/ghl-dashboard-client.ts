'use client';

import { pb } from './pocketbase';

type CachedValue = { value: unknown; expiresAt: number };
const readCache = new Map<string, CachedValue>();
const inFlightReads = new Map<string, Promise<unknown>>();
const READ_CACHE_TTL_MS = 30_000;
let cacheVersion = 0;

function clearReadCache() {
  cacheVersion++;
  readCache.clear();
  inFlightReads.clear();
}

export class DashboardApiError extends Error {
  constructor(public code: string, message: string, public status: number, public fields?: Record<string, string>, public retryAfter?: number) {
    super(message);
  }
}

export async function dashboardApi<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET';
  const requestCacheVersion = cacheVersion;
  const cacheKey = `${requestCacheVersion}:${pb.authStore.token}:${path}`;
  const shouldCache = method === 'GET' && init?.cache !== 'reload';
  const cached = readCache.get(cacheKey);
  if (shouldCache && cached && cached.expiresAt > Date.now()) return cached.value as T;

  const pending = inFlightReads.get(cacheKey) as Promise<T> | undefined;
  if (shouldCache && pending) return pending;

  const request = fetch(`/api/ghl/dashboard${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
      Authorization: `Bearer ${pb.authStore.token}`,
    },
    // Browser HTTP caches must not retain authenticated dashboard responses;
    // this module keeps a short-lived, token-scoped in-memory cache instead.
    cache: 'no-store',
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !(response.status === 409 && data.status === 'duplicate')) {
      throw new DashboardApiError(data.code || 'request_failed', data.error || 'The request failed.', response.status, data.fields, data.retryAfter);
    }
    return data as T;
  });

  if (!shouldCache) {
    if (method !== 'GET') clearReadCache();
    return request;
  }

  inFlightReads.set(cacheKey, request);
  try {
    const data = await request;
    if (requestCacheVersion === cacheVersion) {
      readCache.set(cacheKey, { value: data, expiresAt: Date.now() + READ_CACHE_TTL_MS });
    }
    return data;
  } finally {
    inFlightReads.delete(cacheKey);
  }
}
