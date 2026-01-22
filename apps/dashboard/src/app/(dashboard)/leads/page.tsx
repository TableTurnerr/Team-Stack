'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LeadsPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to companies page - leads are now part of companies
    router.replace('/companies');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <p className="text-[var(--muted)]">Redirecting to Companies...</p>
        <p className="text-sm text-[var(--muted)] mt-2">
          Leads have been unified with Companies.
        </p>
      </div>
    </div>
  );
}
