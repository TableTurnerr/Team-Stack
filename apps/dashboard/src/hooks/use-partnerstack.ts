'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PSPayout {
  key: string;
  created_at: number; // epoch ms
  amount: number;     // cents
  currency: string;
  status: string;
  sent_at: number | null;
  withdrawal_date: number | null;
  provider: {
    key: string;
    name: string;
    external_key: string;
  } | null;
}

export interface PSReward {
  key: string;
  created_at: number; // epoch ms
  amount: number;     // cents
  currency: string;
  reward_status: string; // pending | approved | declined | paid | hold
  payment_status: string; // pending | available | withdrawn | paid_externally
  description: string | null;
  company: { key: string; name: string } | null;
  customer: { key: string; name: string; email: string } | null;
  payment_date: number | null;
  withdrawn: boolean;
}

interface PSData {
  payouts: PSPayout[];
  rewards: PSReward[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const qs = new URLSearchParams({ limit: '250' });
    if (cursor) qs.set('starting_after', cursor);
    const res = await fetch(`/api/partnerstack/${path}?${qs}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    const page: T[] = json?.data?.items ?? [];
    items.push(...page);
    hasMore = json?.data?.has_more ?? false;
    cursor = page.length > 0 ? (page[page.length - 1] as Record<string, unknown>)['key'] as string : null;
    if (!cursor) hasMore = false;
  }
  return items;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function usePartnerstack(): PSData {
  const [payouts, setPayouts] = useState<PSPayout[]>([]);
  const [rewards, setRewards] = useState<PSReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        fetchAll<PSPayout>('payouts'),
        fetchAll<PSReward>('rewards'),
      ]);
      setPayouts(p);
      setRewards(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { payouts, rewards, loading, error, refresh };
}
