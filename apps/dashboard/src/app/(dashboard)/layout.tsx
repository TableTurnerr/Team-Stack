'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

import { DashboardSkeleton } from '@/components/dashboard-skeletons';
import { ZoomPhoneProvider } from '@/contexts/zoom-phone-context';
import { SessionProvider } from '@/contexts/session-context';
import { CallRecordingProvider } from '@/contexts/call-recording-context';
import { ToastProvider } from '@/components/ui/toast';
import { UnsavedChangesProvider } from '@/contexts/unsaved-changes-context';
import { FollowUpProvider } from '@/contexts/follow-up-context';
import { FloatingSaveBar } from '@/components/floating-save-bar';
import { ActiveSessionBanner } from '@/components/active-session-banner';
import { ZoomPhoneDialer } from '@/components/zoom-phone-dialer';
import { AdminModeProvider, useAdminModeOptional } from '@/contexts/admin-mode-context';
import { AdminModeBanner } from '@/components/admin-mode-banner';
import { TeamPresenceProvider } from '@/contexts/team-presence-context';

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

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSessionPage = pathname === '/session';
  const adminMode = useAdminModeOptional();
  const isAdminMode = adminMode?.isAdminMode ?? false;

  return (
    <div className={isAdminMode
      ? "flex min-h-screen bg-[var(--background)] ring-4 ring-red-500 ring-inset"
      : "flex min-h-screen bg-[var(--background)]"
    }>
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <FloatingSaveBar />
        <ActiveSessionBanner />
        <AdminModeBanner />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-[var(--background)]">
          <div className="container mx-auto px-4 py-8 lg:px-8 max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
      {/* Floating dialer — always mounted for persistence, hidden on session page */}
      <ZoomPhoneDialer hidden={isSessionPage} />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ToastProvider>
        <ZoomPhoneProvider>
          <SessionProvider>
            <TeamPresenceProvider>
              <CallRecordingProvider>
                <UnsavedChangesProvider>
                  <FollowUpProvider>
                    <AdminModeProvider>
                      <DashboardLayoutContent>{children}</DashboardLayoutContent>
                    </AdminModeProvider>
                  </FollowUpProvider>
                </UnsavedChangesProvider>
              </CallRecordingProvider>
            </TeamPresenceProvider>
          </SessionProvider>
        </ZoomPhoneProvider>
      </ToastProvider>
    </AuthGuard>
  );
}
