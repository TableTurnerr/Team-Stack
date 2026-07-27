'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { useAuth } from '@/contexts/auth-context';
import { SidebarProvider } from '@/contexts/sidebar-context';
import { DashboardSkeleton } from '@/components/dashboard-skeletons';
import { ToastProvider } from '@/components/ui/toast';
import { RolePermissionProvider } from '@/contexts/role-permission-context';
import { RolePreviewBanner } from '@/components/role-preview-banner';
import { GhlIdentityAlert } from '@/components/ghl-identity-alert';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isLoading, isAuthenticated, router]);
  if (isLoading) return <div className="min-h-screen p-8"><DashboardSkeleton /></div>;
  return isAuthenticated ? <>{children}</> : null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AuthGuard>
        <ToastProvider>
          <RolePermissionProvider>
            <div className="flex min-h-screen bg-[var(--background)]">
              <Sidebar />
              <div className="flex-1 min-w-0">
                <RolePreviewBanner />
                <GhlIdentityAlert />
                <main className="w-full px-4 py-8 lg:px-8">{children}</main>
              </div>
            </div>
          </RolePermissionProvider>
        </ToastProvider>
      </AuthGuard>
    </SidebarProvider>
  );
}
