'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Banknote, ChevronLeft, ChevronRight, KanbanSquare, LockKeyhole,
  LogOut, Menu, Send, Users, X, Zap,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useSidebar } from '@/contexts/sidebar-context';
import type { PageKey } from '@/lib/types';
import { usePermissionsOptional } from '@/contexts/role-permission-context';
import dashboardPkg from '../../package.json';

const ACTIVE_ITEMS: Array<{
  href: string;
  label: string;
  pageKey: PageKey;
  icon: typeof Send;
}> = [
  { href: '/lead-submission', label: 'Lead Submission', pageKey: 'lead-submission', icon: Send },
  { href: '/pipeline', label: 'Pipeline', pageKey: 'pipeline', icon: KanbanSquare },
  { href: '/financial', label: 'Financial Overview', pageKey: 'financial', icon: Banknote },
  { href: '/team', label: 'Team Overview', pageKey: 'team', icon: Users },
];

const LOCKED_DASHBOARD_ITEMS = [
  'Overview', 'Cold Calls', 'Call Session', 'Recordings', 'Session Logs',
  'Companies', 'Leads', 'Notes', 'Follow-Ups', 'Email Marketing',
  'Recycle Bin', 'Roles', 'Actors', 'Goals', 'Settings',
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const { user, logout } = useAuth();
  const permissions = usePermissionsOptional();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = ACTIVE_ITEMS.filter((item) =>
    !permissions || permissions.canAccessPage(item.pageKey),
  );

  const content = (
    <aside className={cn(
      'fixed top-0 left-0 z-40 h-screen bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] flex flex-col transition-all lg:translate-x-0 lg:sticky lg:self-start',
      mobileOpen ? 'translate-x-0' : '-translate-x-full',
      collapsed ? 'w-[72px]' : 'w-64',
    )}>
      <div className={cn('flex items-center border-b border-[var(--sidebar-border)] p-4', collapsed ? 'flex-col gap-3' : 'justify-between')}>
        <Link href="/lead-submission" className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[var(--foreground)] flex items-center justify-center">
            <Zap size={18} className="text-[var(--background)]" />
          </span>
          {!collapsed && <span><span className="font-semibold">Tableturnerr</span><span className="block text-[9px] text-[var(--muted)]">v{dashboardPkg.version}</span></span>}
        </Link>
        <button onClick={toggle} className="hidden lg:block p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--sidebar-hover)]" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')} aria-label="Dashboard navigation">
        {!collapsed && <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Workspace</p>}
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} title={collapsed ? item.label : undefined}
                className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium', collapsed && 'justify-center px-0', active ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]')}>
                <Icon size={18} strokeWidth={active ? 2 : 1.5} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </div>

        <div className="hidden" aria-hidden="true">
          {!collapsed && <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Locked</p>}
          <div className="space-y-0.5">
            {LOCKED_DASHBOARD_ITEMS.map((label) => (
              <div key={label} aria-disabled="true" title={`${label} — Locked`}
                className={cn('flex items-center gap-3 px-3 py-2 text-[var(--muted)] opacity-55 cursor-not-allowed', collapsed && 'justify-center px-0')}>
                <LockKeyhole size={16} aria-hidden="true" />
                {!collapsed && <>
                  <span className="text-xs truncate">{label}</span>
                  <span className="ml-auto text-[9px] rounded px-1.5 py-0.5 bg-[var(--card-hover)] uppercase">Locked</span>
                </>}
              </div>
            ))}
          </div>
        </div>
      </nav>

      <div className={cn('border-t border-[var(--sidebar-border)] p-4 flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
        <span className="w-9 h-9 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-xs font-semibold">
          {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
        </span>
        {!collapsed && <>
          <span className="min-w-0 flex-1"><span className="block text-sm truncate">{user?.name || 'User'}</span><span className="block text-[11px] text-[var(--muted)] truncate">{user?.email}</span></span>
          <button onClick={logout} className="p-2 text-[var(--muted)] hover:text-[var(--error)]" aria-label="Log out"><LogOut size={16} /></button>
        </>}
      </div>
    </aside>
  );

  return <>
    <button onClick={() => setMobileOpen(!mobileOpen)} className="fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] lg:hidden" aria-label="Toggle menu">
      {mobileOpen ? <X size={18} /> : <Menu size={18} />}
    </button>
    {mobileOpen && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
    {content}
  </>;
}
