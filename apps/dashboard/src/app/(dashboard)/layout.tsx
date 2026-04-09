'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';
import { SidebarProvider, useSidebar } from '@/contexts/sidebar-context';

import { DashboardSkeleton } from '@/components/dashboard-skeletons';
import { PhoneProvider } from '@/contexts/phone-context';
import { SessionProvider } from '@/contexts/session-context';
import { CallRecordingProvider } from '@/contexts/call-recording-context';
import { ToastProvider } from '@/components/ui/toast';
import { UnsavedChangesProvider } from '@/contexts/unsaved-changes-context';
import { FollowUpProvider } from '@/contexts/follow-up-context';
import { FloatingSaveBar } from '@/components/floating-save-bar';
import { ActiveSessionBanner } from '@/components/active-session-banner';
import { PhoneDialer } from '@/components/phone-dialer';
import { RecycleBinProvider } from '@/contexts/recycle-bin-context';
import { UndoDeleteToast } from '@/components/undo-delete-toast';
import { TeamPresenceProvider } from '@/contexts/team-presence-context';
import { IncomingCallHandler } from '@/components/incoming-call-handler';
import { LocalAgentProvider } from '@/contexts/local-agent-context';
import { RolePermissionProvider } from '@/contexts/role-permission-context';
import { RolePreviewBanner } from '@/components/role-preview-banner';

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

  // Track page visits for quick access on overview
  useEffect(() => {
    if (pathname === '/') return; // don't track overview itself
    try {
      const key = 'tt_page_visits';
      const raw = localStorage.getItem(key);
      const visits: Record<string, { count: number; last: number }> = raw ? JSON.parse(raw) : {};
      const basePath = '/' + pathname.split('/').filter(Boolean)[0]; // normalize to top-level route
      const entry = visits[basePath] || { count: 0, last: 0 };
      entry.count += 1;
      entry.last = Date.now();
      visits[basePath] = entry;
      localStorage.setItem(key, JSON.stringify(visits));
    } catch { /* ignore storage errors */ }
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <RolePreviewBanner />
        <FloatingSaveBar />
        <ActiveSessionBanner />
        <IncomingCallHandler />
        <UndoDeleteToast />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-[var(--background)]">
          <div className="container mx-auto px-4 py-8 lg:px-8 max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
      {/* Floating dialer — always mounted for persistence, hidden on session page */}
      <PhoneDialer hidden={isSessionPage} />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AuthGuard>
        <ToastProvider>
          <LocalAgentProvider>
          <PhoneProvider>
            <SessionProvider>
              <TeamPresenceProvider>
              <RolePermissionProvider>
                <CallRecordingProvider>
                  <UnsavedChangesProvider>
                    <FollowUpProvider>
                      <RecycleBinProvider>
                        <DashboardLayoutContent>{children}</DashboardLayoutContent>
                      </RecycleBinProvider>
                    </FollowUpProvider>
                  </UnsavedChangesProvider>
                </CallRecordingProvider>
              </RolePermissionProvider>
              </TeamPresenceProvider>
            </SessionProvider>
          </PhoneProvider>
          </LocalAgentProvider>
        </ToastProvider>
      </AuthGuard>
    </SidebarProvider>
  );
}
