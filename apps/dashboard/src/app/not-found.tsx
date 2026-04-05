'use client';

import Link from 'next/link';
import { Home, ArrowLeft, Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--background)] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8">

        {/* Large 404 */}
        <div className="space-y-4">
          <p className="text-[120px] font-bold leading-none tracking-tight text-[var(--card-border)] select-none">
            404
          </p>
          <div className="w-12 h-12 rounded-xl bg-[var(--primary-subtle)] flex items-center justify-center mx-auto">
            <Compass size={24} className="text-[var(--primary)]" />
          </div>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Page not found
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
            Double-check the URL or navigate back to safety.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-col sm:flex-row justify-center">
          <Link
            href="/"
            className="btn-primary flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white"
          >
            <Home size={15} />
            Go to dashboard
          </Link>
          <button
            onClick={() => window.history.back()}
            className="btn-ghost flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-[var(--card-border)]"
          >
            <ArrowLeft size={15} />
            Go back
          </button>
        </div>

      </div>
    </div>
  );
}
