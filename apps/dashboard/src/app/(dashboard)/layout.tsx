'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

import { DashboardSkeleton } from '@/components/dashboard-skeletons';
import { ZoomPhoneProvider } from '@/contexts/zoom-phone-context';
import { ZoomPhoneDialer } from '@/components/zoom-phone-dialer';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Sidebar />
        <main className="lg:ml-64 min-h-screen">
          <div className="p-4 lg:p-8 pt-16 lg:pt-8">
            <DashboardSkeleton />
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ZoomPhoneProvider>
        <div className="min-h-screen">
          <Sidebar />
          <main className="lg:ml-64 min-h-screen">
            <div className="p-4 lg:p-8 pt-16 lg:pt-8">
              {children}
            </div>
          </main>
          <ZoomPhoneDialer />
        </div>
      </ZoomPhoneProvider>
    </AuthGuard>
  );
}

