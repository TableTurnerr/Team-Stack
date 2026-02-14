'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

import { DashboardSkeleton } from '@/components/dashboard-skeletons';
import { ZoomPhoneProvider } from '@/contexts/zoom-phone-context';
import { SessionProvider } from '@/contexts/session-context';
import { CallRecordingProvider } from '@/contexts/call-recording-context';
import { ActiveSessionBanner } from '@/components/active-session-banner';
import { CallPreviewBanner } from '@/components/call-preview-banner';

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
        <SessionProvider>
          <CallRecordingProvider>
            <div className="flex min-h-screen bg-[var(--background)]">
              <Sidebar />
              <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
                <ActiveSessionBanner />
                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-[var(--background)]">
                  <div className="container mx-auto px-4 py-8 lg:px-8 max-w-[1600px]">
                    {children}
                  </div>
                </main>
              </div>
              <CallPreviewBanner />
            </div>
          </CallRecordingProvider>
        </SessionProvider>
      </ZoomPhoneProvider>
    </AuthGuard>
  );
}
