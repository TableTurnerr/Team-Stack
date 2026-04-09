'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/contexts/role-permission-context';
import { useAuth } from '@/contexts/auth-context';
import { PageKey } from '@/lib/types';
import { ShieldX } from 'lucide-react';

interface PageGuardProps {
  pageKey: PageKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

function AccessDenied() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-16 h-16 rounded-full bg-[var(--error-subtle)] flex items-center justify-center">
        <ShieldX size={32} className="text-[var(--error)]" />
      </div>
      <h2 className="text-xl font-semibold">Access Denied</h2>
      <p className="text-[var(--muted)] text-center max-w-md">
        You don&apos;t have permission to access this page. Contact an administrator to request access.
      </p>
      <button
        onClick={() => router.push('/')}
        className="mt-2 px-4 py-2 text-sm font-medium rounded-lg btn-primary"
      >
        Go to Dashboard
      </button>
    </div>
  );
}

export function PageGuard({ pageKey, children, fallback }: PageGuardProps) {
  const { canAccessPage, isLoading } = usePermissions();
  const { user } = useAuth();

  // While roles are loading, show nothing (the auth guard already shows skeleton)
  if (isLoading) return null;

  // If user is not loaded yet, show nothing
  if (!user) return null;

  // Check access
  if (!canAccessPage(pageKey)) {
    return fallback ? <>{fallback}</> : <AccessDenied />;
  }

  return <>{children}</>;
}
