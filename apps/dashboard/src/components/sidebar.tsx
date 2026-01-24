'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Phone,
  Users,
  Building2,
  StickyNote,
  UserCog,
  Settings,
  Target,
  Instagram,
  Menu,
  X,
  Zap,
  LogOut,
  Loader2,
  Mic,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/cold-calls', label: 'Cold Calls', icon: Phone },
  { href: '/recordings', label: 'Recordings', icon: Mic },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/actors', label: 'Actors', icon: Instagram },
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/team', label: 'Team', icon: UserCog },
  { href: '/goals', label: 'Goals', icon: Target, comingSoon: true },
];

const bottomNavItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const { user, logout } = useAuth();

  useEffect(() => {
    setLoadingPath(null);
  }, [pathname]);

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 p-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] lg:hidden hover:bg-[var(--card-hover)] transition-colors"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen w-64 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] transition-transform duration-200 flex flex-col',
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--sidebar-border)]">
          <div className="w-9 h-9 rounded-lg bg-[var(--foreground)] flex items-center justify-center">
            <Zap size={18} className="text-[var(--background)]" />
          </div>
          <div>
            <span className="font-semibold text-base tracking-tight">Tableturnerr</span>
            <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider">CRM Platform</p>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="mb-2 px-3">
            <span className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider">
              Main Menu
            </span>
          </div>
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const isLoading = loadingPath === item.href;
              const Icon = isLoading ? Loader2 : item.icon;

              return (
                <li key={item.href}>
                  {item.comingSoon ? (
                    <div
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--muted-foreground)] cursor-not-allowed"
                      title="Coming Soon"
                    >
                      <Icon size={18} strokeWidth={1.5} />
                      <span className="text-sm">{item.label}</span>
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-hover)] text-[var(--muted)]">
                        Soon
                      </span>
                    </div>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={() => {
                        if (pathname !== item.href) setLoadingPath(item.href);
                        setMobileOpen(false);
                      }}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
                        isActive
                          ? 'bg-[var(--foreground)] text-[var(--background)]'
                          : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]'
                      )}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2 : 1.5} className={cn(isLoading && "animate-spin")} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom Navigation */}
        <div className="px-3 py-3 border-t border-[var(--sidebar-border)]">
          <ul className="space-y-0.5">
            {bottomNavItems.map((item) => {
              const isActive = pathname === item.href;
              const isLoading = loadingPath === item.href;
              const Icon = isLoading ? Loader2 : item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      if (pathname !== item.href) setLoadingPath(item.href);
                      setMobileOpen(false);
                    }}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
                      isActive
                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                        : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]'
                    )}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2 : 1.5} className={cn(isLoading && "animate-spin")} />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* User Profile */}
        <div className="px-4 py-4 border-t border-[var(--sidebar-border)]">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center overflow-hidden relative">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name || 'User'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-white text-xs font-semibold">
                  {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
              <p className="text-xs text-[var(--muted)] truncate">{user?.email || ''}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--error)] transition-colors"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
