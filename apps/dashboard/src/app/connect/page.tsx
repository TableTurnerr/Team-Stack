'use client';

// Standalone connect surface opened by the Lead Scraper Chrome extension.
// It (1) ensures the user is logged into the CRM, (2) lets them authorize their
// GoHighLevel sub-accounts via OAuth (one install per sub-account), and (3)
// writes a `tt_session` blob to localStorage that the extension reads to call
// the /api/ghl/* proxy.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';

interface GhlStatus {
  connected: boolean;
  agencyName: string;
  email: string;
}

interface SubAccount {
  id: string;
  name: string;
}

export default function ConnectPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<GhlStatus | null>(null);
  const [locations, setLocations] = useState<SubAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  // Mirror the live dashboard session into localStorage for the extension.
  const writeSession = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!pb.authStore.isValid || !pb.authStore.token) return;
    const blob = {
      token: pb.authStore.token,
      email: user?.email || '',
      agency: status?.agencyName || '',
      apiBase: `${window.location.origin}/api`,
    };
    try { localStorage.setItem('tt_session', JSON.stringify(blob)); } catch { /* ignore */ }
  }, [user?.email, status?.agencyName]);

  const authedFetch = useCallback((path: string, init?: RequestInit) => {
    return fetch(path, {
      ...init,
      headers: { ...(init?.headers || {}), Authorization: `Bearer ${pb.authStore.token}` },
    });
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        authedFetch('/api/ghl/status'),
        authedFetch('/api/ghl/locations'),
      ]);
      if (s.ok) setStatus(await s.json());
      if (l.ok) setLocations(await l.json());
    } catch { /* ignore */ }
  }, [authedFetch]);

  // Redirect to login (returning here afterwards) when signed out.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login?redirect=/connect');
    }
  }, [isLoading, isAuthenticated, router]);

  // Surface ?ghl=connected|error feedback from the OAuth callback.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const ghl = p.get('ghl');
    if (ghl === 'connected') setFlash('Sub-account connected. Connect another, or return to the extension.');
    else if (ghl === 'error') setError(`Connection failed: ${p.get('reason') || 'unknown error'}`);
  }, []);

  // Once authenticated: publish the session, load status, keep session fresh.
  useEffect(() => {
    if (!isAuthenticated) return;
    writeSession();
    loadStatus();
    const id = setInterval(writeSession, 60_000);
    return () => clearInterval(id);
  }, [isAuthenticated, writeSession, loadStatus]);

  useEffect(() => { writeSession(); }, [status, writeSession]);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authedFetch('/api/hl/oauth/start');
      const data = await res.json();
      if (!res.ok || !data.authorizeUrl) throw new Error(data.error || 'Could not start connection');
      window.location.href = data.authorizeUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start connection');
      setBusy(false);
    }
  };

  // Remove a single sub-account, or all of them when no id is given.
  const handleDisconnect = async (locationId?: string) => {
    setBusy(true);
    setError('');
    try {
      const qs = locationId ? `?location=${encodeURIComponent(locationId)}` : '';
      await authedFetch(`/api/ghl/disconnect${qs}`, { method: 'POST' });
      setFlash(locationId ? 'Sub-account removed.' : 'Disconnected all sub-accounts.');
      await loadStatus();
    } catch {
      setError('Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const hasConnections = locations.length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">Connect GoHighLevel</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Authorize each GoHighLevel sub-account you want the Lead Scraper to send
          leads into. You can connect as many as you like, one at a time.
        </p>

        <div className="mt-6 flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${hasConnections ? 'bg-green-500' : 'bg-gray-400'}`}
          />
          <span className="font-medium text-foreground">
            {hasConnections
              ? `${locations.length} sub-account${locations.length > 1 ? 's' : ''} connected`
              : 'No sub-accounts connected'}
          </span>
        </div>

        {hasConnections ? (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {locations.map((loc) => (
              <li key={loc.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate text-foreground">{loc.name}</span>
                <button
                  onClick={() => handleDisconnect(loc.id)}
                  disabled={busy}
                  className="ml-3 shrink-0 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {flash ? <p className="mt-4 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600">{flash}</p> : null}
        {error ? <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={handleConnect}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Opening…' : hasConnections ? 'Connect another sub-account' : 'Connect a sub-account'}
          </button>
          {hasConnections ? (
            <button
              onClick={() => handleDisconnect()}
              disabled={busy}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              Disconnect all
            </button>
          ) : null}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Signed in as {user?.email}. Keep this tab open while the extension finishes connecting.
        </p>
      </div>
    </div>
  );
}
