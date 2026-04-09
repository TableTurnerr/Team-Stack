'use client';

import { useEffect } from 'react';
import { Home, RefreshCw, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8">

        {/* Icon */}
        <div className="space-y-4">
          <p className="text-[120px] font-bold leading-none tracking-tight text-[var(--card-border)] select-none">
            500
          </p>
          <div className="w-12 h-12 rounded-xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto">
            <AlertTriangle size={24} className="text-[var(--error)]" />
          </div>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Something went wrong
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            An unexpected error occurred. You can try again or return to the dashboard.
          </p>
          {error.digest && (
            <p className="text-xs text-[var(--muted)] font-mono mt-2">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-col sm:flex-row justify-center">
          <button
            onClick={reset}
            className="btn-primary flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white"
          >
            <RefreshCw size={15} />
            Try again
          </button>
          <Link
            href="/"
            className="btn-ghost flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-[var(--card-border)]"
          >
            <Home size={15} />
            Go to dashboard
          </Link>
        </div>

      </div>
    </div>
  );
}
