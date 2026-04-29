'use client';

import { useEffect, useState, useCallback } from 'react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CustomCallOutcome } from '@/lib/types';

// ---------------------------------------------------------------------------
// Custom call outcomes are global — when any user creates one, every other
// user sees it (for selection during a call AND in filter dropdowns).
// We share a single in-memory list across all hook instances via a module-
// level pub/sub so a creation in one component reaches every mounted listener
// without a round-trip.
//
// Each `custom_call_outcomes` create also widens the `call_logs.call_outcome`
// select-field enum server-side (see widen_call_outcome_enum.pb.js). The
// call form must wait for any in-flight create to complete before it saves
// a call_log that references the new name, otherwise PB will reject the
// value as not in the enum. `flushPendingOutcomes()` exposes that wait.
// ---------------------------------------------------------------------------

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;
const listeners = new Set<(outcomes: string[]) => void>();
const pendingWrites = new Set<Promise<unknown>>();

function notify(outcomes: string[]) {
  cache = outcomes;
  listeners.forEach(fn => fn(outcomes));
}

async function loadFromServer(): Promise<string[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = pb.collection(COLLECTIONS.CUSTOM_CALL_OUTCOMES)
    .getFullList<CustomCallOutcome>({ sort: 'name' })
    .then(records => {
      const list = records.map(r => r.name);
      notify(list);
      return list;
    })
    .catch(() => {
      const list: string[] = [];
      notify(list);
      return list;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * Add a custom outcome to the global list.
 *
 * Optimistically broadcasts the new name to every subscriber, then issues the
 * server create (which the PB hook uses to widen the call_logs enum). Tracks
 * the in-flight Promise on a module-level set so callers can `await
 * flushPendingOutcomes()` before saving anything that references the name.
 *
 * Returns the trimmed name so callers can immediately reference it, or null
 * if the input was empty.
 */
async function addOutcome(rawName: string): Promise<string | null> {
  const name = rawName.trim();
  if (!name) return null;
  const current = cache ?? [];
  if (!current.includes(name)) {
    notify([...current, name].sort((a, b) => a.localeCompare(b)));
  }
  const write = pb.collection(COLLECTIONS.CUSTOM_CALL_OUTCOMES)
    .create({ name })
    .catch(() => {
      // Most likely a unique-index collision (another teammate added the
      // same name). The optimistic update above is correct.
    });
  pendingWrites.add(write);
  void write.finally(() => { pendingWrites.delete(write); });
  await write;
  return name;
}

/**
 * Resolve once every in-flight `custom_call_outcomes` create has settled.
 * Call this from a save handler before persisting a record that references
 * a freshly-typed custom outcome — guarantees the server-side enum widen
 * has run, so the subsequent write won't be rejected.
 */
export async function flushPendingOutcomes(): Promise<void> {
  if (!pendingWrites.size) return;
  await Promise.allSettled([...pendingWrites]);
}

export function useCustomCallOutcomes() {
  const [outcomes, setOutcomes] = useState<string[]>(cache ?? []);

  useEffect(() => {
    listeners.add(setOutcomes);
    if (!cache) loadFromServer();
    return () => { listeners.delete(setOutcomes); };
  }, []);

  const addCustomOutcome = useCallback((name: string) => addOutcome(name), []);

  return { customOutcomes: outcomes, addCustomOutcome };
}
