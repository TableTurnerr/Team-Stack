'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { dashboardApi } from '@/lib/ghl-dashboard-client';
import type { LeadFormConfig } from '@/server/ghl-dashboard/models';

export function GhlIdentityAlert() {
  const { user } = useAuth();
  const [missing, setMissing] = useState(false);
  const missingRef = useRef(false);
  const recheckTimer = useRef<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [ghlUserId, setGhlUserId] = useState('');
  const [candidate, setCandidate] = useState<{ ghlUserId: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checkIdentity = useCallback(async (reloadWhenResolved = false, confirmMissing = false) => {
    if (!user?.id) return;
    setChecking(true);
    try {
      const config = await dashboardApi<LeadFormConfig>('/config');
      const isMissing = !config.currentUser.matched;
      // The GHL user list can briefly be stale immediately after dashboard
      // startup. Confirm an unmatched result once before showing a warning.
      if (isMissing && !confirmMissing) {
        recheckTimer.current = window.setTimeout(() => {
          recheckTimer.current = null;
          void checkIdentity(reloadWhenResolved, true);
        }, 750);
        return;
      }
      const wasMissing = missingRef.current;
      missingRef.current = isMissing;
      setMissing(isMissing);
      if (!isMissing && wasMissing && reloadWhenResolved) window.location.reload();
    } catch {
      // Configuration/API failures have their own page-level errors. Do not
      // incorrectly label the signed-in user as unmatched.
    } finally {
      setChecking(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void checkIdentity();
    const interval = window.setInterval(() => {
      if (missingRef.current) void checkIdentity(true);
    }, 30_000);
    return () => {
      window.clearInterval(interval);
      if (recheckTimer.current) window.clearTimeout(recheckTimer.current);
    };
  }, [checkIdentity]);

  if (!missing) return null;

  async function lookup() {
    setLoading(true); setError(''); setCandidate(null);
    try {
      setCandidate(await dashboardApi('/identity/lookup', {
        method: 'POST',
        body: JSON.stringify({ ghlUserId }),
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not verify that GHL user.');
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!candidate) return;
    setLoading(true); setError('');
    try {
      await dashboardApi('/identity/confirm', {
        method: 'POST',
        body: JSON.stringify({ ghlUserId: candidate.ghlUserId }),
      });
      window.location.reload();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save the GHL user mapping.');
      setLoading(false);
    }
  }

  return (
    <div role="alert" className="sticky top-0 z-30 flex items-start gap-3 border-b border-[var(--warning)] bg-[var(--warning-subtle)] px-4 py-3 text-sm">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-2">
        <p>
          <strong>GoHighLevel user setup required.</strong>{' '}
          Your Tableturnerr email ({user?.email}) was not found in this GHL sub-account.
          Ask an administrator to add the same email in GHL, contact the Tableturnerr support team,
          or link your existing GHL user ID below.
        </p>
        <button disabled={checking} onClick={() => void checkIdentity(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--warning)] px-2.5 py-1.5 text-xs font-medium disabled:opacity-50">
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          Recheck GHL user
        </button>
        {!candidate ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="GHL user ID"
              value={ghlUserId}
              onChange={event => setGhlUserId(event.target.value)}
              placeholder="Paste your GHL user ID"
              className="min-w-64 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm"
            />
            <button disabled={loading || !ghlUserId.trim()} onClick={lookup} className="rounded-lg bg-[var(--foreground)] px-3 py-2 text-[var(--background)] disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : 'Verify user ID'}
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--warning)] bg-[var(--card-bg)] p-3">
            <p className="font-medium">Is your name {candidate.name}?</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Confirm only if this is your own GHL account.</p>
            <div className="mt-2 flex gap-2">
              <button disabled={loading} onClick={confirm} className="rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-[var(--background)] disabled:opacity-50">
                {loading ? 'Saving…' : `Yes, I’m ${candidate.name}`}
              </button>
              <button disabled={loading} onClick={() => { setCandidate(null); setError(''); }} className="rounded-lg border border-[var(--card-border)] px-3 py-1.5">
                No, try another ID
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-xs font-medium text-[var(--error)]">{error}</p>}
      </div>
    </div>
  );
}
