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
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/cold-calls', label: 'Cold Calls', icon: Phone },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/actors', label: 'Actors', icon: Instagram },
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/team', label: 'Team', icon: UserCog },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/goals', label: 'Goals', icon: Target, comingSoon: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--sidebar-border)] lg:hidden"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen w-64 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] transition-transform duration-200',
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-2 px-6 py-5 border-b border-[var(--sidebar-border)]">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">TT</span>
            </div>
            <span className="font-semibold text-lg">Tableturnerr</span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 overflow-y-auto">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    {item.comingSoon ? (
                      <div
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--muted)] cursor-not-allowed opacity-60"
                        title="Coming Soon"
                      >
                        <Icon size={20} />
                        <span>{item.label}</span>
                        <span className="ml-auto text-xs bg-[var(--sidebar-border)] px-2 py-0.5 rounded">
                          Soon
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                          isActive
                            ? 'bg-[var(--primary)] text-white'
                            : 'text-[var(--muted)] hover:bg-[var(--sidebar-border)] hover:text-[var(--foreground)]'
                        )}
                      >
                        <Icon size={20} />
                        <span>{item.label}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[var(--sidebar-border)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center">
                <span className="text-white text-sm font-medium">U</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">User</p>
                <p className="text-xs text-[var(--muted)] truncate">Operator</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
