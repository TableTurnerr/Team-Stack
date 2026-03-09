'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Phone,
  Building2,
  StickyNote,
  Settings,
  Target,
  Instagram,
  Menu,
  X,
  Zap,
  LogOut,
  Loader2,
  Mic,
  Plus,
  Headphones,
  History,
  CalendarClock,
  TrendingUp,
  Mail,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  LayoutDashboard,
  Search,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useAuth, isUserOnline } from '@/contexts/auth-context';
import { TimezoneClock } from './timezone-clock';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { TimezoneSearch } from './timezone-search';
import { useSidebar } from '@/contexts/sidebar-context';
import { useTeamPresenceOptional } from '@/contexts/team-presence-context';
import { MasterSearch } from './master-search';
import { pb } from '@/lib/pocketbase';
import type { User } from '@/lib/types';
import dashboardPkg from '../../package.json';
import rootPkg from '../../../../package.json';

/* ─── Collapsed timezone: show live time ─── */
function CollapsedTimezoneTime({ timezone, label }: { timezone: string; label?: string }) {
  const [time, setTime] = useState('');
  const [abbr, setAbbr] = useState('');

  useEffect(() => {
    const update = () => {
      try {
        const now = new Date();
        // Shortest time: e.g. "2:05p"
        const t = now.toLocaleTimeString('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        // "2:05 PM" -> "2:05p"
        const short = t.replace(/\s?(AM|PM)/i, (_, m) => m[0].toLowerCase());
        setTime(short);

        // Shortest timezone abbreviation
        const parts = now.toLocaleDateString('en-US', {
          timeZone: timezone,
          timeZoneName: 'short',
        }).split(', ');
        const tzAbbr = parts.length > 1 ? parts[parts.length - 1].trim() : (label || timezone.split('/').pop() || '').slice(0, 3).toUpperCase();
        setAbbr(tzAbbr);
      } catch {
        setTime('--');
        setAbbr('??');
      }
    };
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, [timezone, label]);

  return (
    <div
      className="w-full rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] flex flex-col items-center justify-center py-1.5 px-1 text-center"
      title={label || timezone}
    >
      <span className="text-[11px] font-bold leading-tight">{time}</span>
      <span className="text-[8px] text-[var(--muted)] font-medium uppercase tracking-wider leading-tight">{abbr}</span>
    </div>
  );
}

/* ─── Team avatars with status lights ─── */
function TeamAvatars({ collapsed }: { collapsed: boolean }) {
  const presence = useTeamPresenceOptional();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!presence) return null;
  const { teamMembers, isOnline, getSessionForUser } = presence;

  if (teamMembers.length === 0) return null;

  const getAvatarUrl = (member: User) => {
    if (!member.avatar) return null;
    return pb.files.getUrl(member, member.avatar);
  };

  const getStatusColor = (member: User) => {
    if (member.status === 'suspended') return 'bg-[var(--muted)]';
    if (isOnline(member)) return 'bg-[var(--success)]';
    return 'bg-[var(--muted-foreground)]';
  };

  const getStatusLabel = (member: User) => {
    if (member.status === 'suspended') return 'Suspended';
    if (isOnline(member)) {
      const session = getSessionForUser(member.id);
      return session ? 'In a call session' : 'Online';
    }
    return 'Offline';
  };

  if (collapsed) {
    return (
      <div className="px-2 py-2 border-t border-[var(--sidebar-border)]">
        <div className="flex flex-col items-center gap-1">
          <div className="flex justify-center -space-y-0" style={{ flexDirection: 'column', alignItems: 'center' }}>
            {teamMembers.slice(0, 4).map((member, i) => {
              const avatarUrl = getAvatarUrl(member);
              const online = isOnline(member);
              return (
                <div
                  key={member.id}
                  className="relative group/avatar"
                  style={{ marginTop: i > 0 ? '-6px' : 0, zIndex: hoveredId === member.id ? 50 : teamMembers.length - i }}
                  onMouseEnter={() => setHoveredId(member.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-full border-2 border-[var(--sidebar-bg)] flex items-center justify-center overflow-hidden relative transition-transform duration-150 flex-shrink-0',
                    hoveredId === member.id && 'scale-125 ring-2 ring-[var(--primary)]',
                  )}>
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt={member.name} fill sizes="32px" className="object-cover" />
                    ) : (
                      <div className="w-full h-full bg-[var(--primary)] flex items-center justify-center">
                        <span className="text-white text-[10px] font-bold">{member.name?.charAt(0).toUpperCase() || '?'}</span>
                      </div>
                    )}
                  </div>
                  {/* Status dot */}
                  <div className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--sidebar-bg)]', getStatusColor(member))} />

                  {/* Hover tooltip */}
                  {hoveredId === member.id && (
                    <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[60] min-w-[180px] p-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg">
                      <p className="text-sm font-semibold truncate">{member.name}</p>
                      <p className="text-[11px] text-[var(--muted)] truncate">{member.email}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div className={cn('w-2 h-2 rounded-full', getStatusColor(member))} />
                        <span className="text-[11px] text-[var(--muted)]">{getStatusLabel(member)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-[var(--sidebar-border)]">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Team</span>
        <span className="text-[10px] text-[var(--muted)]">{teamMembers.filter(m => isOnline(m)).length} online</span>
      </div>
      <div className="flex items-center pl-1">
        {teamMembers.map((member, i) => {
          const avatarUrl = getAvatarUrl(member);
          return (
            <div
              key={member.id}
              className="relative group/avatar"
              style={{ marginLeft: i > 0 ? '-8px' : 0, zIndex: hoveredId === member.id ? 50 : teamMembers.length - i }}
              onMouseEnter={() => setHoveredId(member.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className={cn(
                'w-9 h-9 rounded-full border-2 border-[var(--sidebar-bg)] flex items-center justify-center overflow-hidden relative transition-all duration-150 flex-shrink-0',
                hoveredId === member.id && 'scale-125 ring-2 ring-[var(--primary)] z-50',
              )}>
                {avatarUrl ? (
                  <Image src={avatarUrl} alt={member.name} fill sizes="36px" className="object-cover" />
                ) : (
                  <div className="w-full h-full bg-[var(--primary)] flex items-center justify-center">
                    <span className="text-white text-xs font-bold">{member.name?.charAt(0).toUpperCase() || '?'}</span>
                  </div>
                )}
              </div>
              {/* Status dot */}
              <div className={cn('absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--sidebar-bg)]', getStatusColor(member))} />

              {/* Hover card */}
              {hoveredId === member.id && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-[60] min-w-[200px] p-3 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden relative flex-shrink-0">
                      {avatarUrl ? (
                        <Image src={avatarUrl} alt={member.name} fill sizes="40px" className="object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[var(--primary)] flex items-center justify-center">
                          <span className="text-white text-sm font-bold">{member.name?.charAt(0).toUpperCase() || '?'}</span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{member.name}</p>
                      <p className="text-[11px] text-[var(--muted)] truncate">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[var(--card-border)]">
                    <div className={cn('w-2 h-2 rounded-full', getStatusColor(member))} />
                    <span className="text-[11px] text-[var(--muted)]">{getStatusLabel(member)}</span>
                  </div>
                  <p className="text-[10px] text-[var(--muted)] mt-1 capitalize">{member.role}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Navigation structure ─── */

interface NavChild {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

interface NavCategory {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  href?: string;            // direct link for non-expandable items
  children?: NavChild[];    // sub-items for expandable categories
  comingSoon?: boolean;
}

const navCategories: NavCategory[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    children: [
      { href: '/financial', label: 'Financial Overview', icon: TrendingUp },
      { href: '/team', label: 'Team Overview', icon: Users },
    ],
  },
  {
    key: 'follow-ups',
    label: 'Follow-Ups',
    icon: CalendarClock,
    href: '/follow-ups',
  },
  {
    key: 'companies',
    label: 'Companies',
    icon: Building2,
    href: '/companies',
  },
  {
    key: 'cold-calls',
    label: 'Cold Calls',
    icon: Phone,
    children: [
      { href: '/cold-calls', label: 'Cold Calls', icon: Phone },
      { href: '/session', label: 'Call Session', icon: Headphones },
      { href: '/recordings', label: 'Recordings', icon: Mic },
      { href: '/session-logs', label: 'Session Logs', icon: History },
    ],
  },
  {
    key: 'email',
    label: 'Email Marketing',
    icon: Mail,
    href: '/email',
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: StickyNote,
    href: '/notes',
  },
];

const comingSoonItems: NavCategory[] = [
  { key: 'actors', label: 'Actors', icon: Instagram, href: '/actors', comingSoon: true },
  { key: 'goals', label: 'Goals', icon: Target, href: '/goals', comingSoon: true },
];

/* ─── Sidebar component ─── */

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const { user, logout } = useAuth();
  const { preferences, updatePreferences } = useUserPreferences();
  const [showTzSelector, setShowTzSelector] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const timezones = preferences?.timezones || [];
  const coldCallingTimezone = preferences?.workflow_preferences?.cold_calling_timezone;

  // Auto-expand categories that contain the active route
  useEffect(() => {
    const active: Record<string, boolean> = {};
    for (const cat of navCategories) {
      if (cat.children?.some((c) => pathname === c.href || pathname.startsWith(c.href + '/'))) {
        active[cat.key] = true;
      }
    }
    setExpandedCategories((prev) => ({ ...prev, ...active }));
  }, [pathname]);

  useEffect(() => {
    setLoadingPath(null);
  }, [pathname]);

  // Global "/" shortcut to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const toggleCategory = (key: string) => {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setStarTimezone = async (tz: string) => {
    await updatePreferences({
      workflow_preferences: {
        ...preferences?.workflow_preferences,
        cold_calling_timezone: tz,
      },
    });
  };

  const addTimezone = async (tz: { timezone: string; label: string }) => {
    if (timezones.length >= 4) return;
    if (timezones.find((t) => t.timezone === tz.timezone)) return;
    const newTimezones = [...timezones, tz];
    await updatePreferences({ timezones: newTimezones });
    setShowTzSelector(false);
  };

  const removeTimezone = async (tz: string) => {
    const next = timezones.filter((t) => t.timezone !== tz);
    await updatePreferences({ timezones: next });
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleNav = (href: string) => {
    if (pathname !== href) setLoadingPath(href);
    setMobileOpen(false);
  };

  /* ─── Render helpers ─── */

  const renderNavLink = (
    item: { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> },
    indent = false,
  ) => {
    const active = isActive(item.href);
    const loading = loadingPath === item.href;
    const Icon = loading ? Loader2 : item.icon;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => handleNav(item.href)}
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex items-center gap-3 rounded-xl transition-all duration-150 group/link',
          indent && !collapsed ? 'pl-10 pr-3 py-2' : 'px-3 py-2.5',
          active
            ? 'bg-[var(--foreground)] text-[var(--background)] shadow-sm'
            : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]',
          collapsed && 'justify-center px-0 py-2.5',
        )}
      >
        <Icon
          size={18}
          strokeWidth={active ? 2 : 1.5}
          className={cn(loading && 'animate-spin', collapsed && 'mx-auto')}
        />
        {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
      </Link>
    );
  };

  const renderCategory = (cat: NavCategory) => {
    const hasChildren = !!cat.children;
    const expanded = expandedCategories[cat.key];
    const Icon = cat.icon;
    const isCategoryActive = hasChildren
      ? cat.children!.some((c) => isActive(c.href))
      : isActive(cat.href!);

    // Direct link items
    if (!hasChildren) {
      return (
        <div key={cat.key}>
          {renderNavLink({ href: cat.href!, label: cat.label, icon: cat.icon })}
        </div>
      );
    }

    // Collapsed: show icon with hover popover
    if (collapsed) {
      return (
        <div
          key={cat.key}
          className="relative"
          onMouseEnter={() => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            setHoveredCategory(cat.key);
          }}
          onMouseLeave={() => {
            hoverTimeout.current = setTimeout(() => setHoveredCategory(null), 150);
          }}
        >
          <button
            className={cn(
              'flex items-center justify-center w-full rounded-xl py-2.5 transition-all duration-150',
              isCategoryActive
                ? 'bg-[var(--foreground)] text-[var(--background)] shadow-sm'
                : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]',
            )}
            title={cat.label}
          >
            <Icon size={18} strokeWidth={isCategoryActive ? 2 : 1.5} />
          </button>

          {/* Popover */}
          {hoveredCategory === cat.key && (
            <div className="absolute left-full top-0 ml-2 z-50 min-w-[180px] py-2 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg">
              {cat.children!.map((child) => {
                const childActive = isActive(child.href);
                const childLoading = loadingPath === child.href;
                const ChildIcon = childLoading ? Loader2 : child.icon;
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    onClick={() => handleNav(child.href)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 transition-colors',
                      childActive
                        ? 'bg-[var(--foreground)] text-[var(--background)] font-medium'
                        : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]',
                    )}
                  >
                    <ChildIcon size={16} strokeWidth={childActive ? 2 : 1.5} className={cn(childLoading && 'animate-spin')} />
                    <span className="text-sm">{child.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Expanded sidebar: collapsible category
    return (
      <div key={cat.key}>
        <button
          onClick={() => toggleCategory(cat.key)}
          className={cn(
            'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all duration-150',
            isCategoryActive
              ? 'text-[var(--foreground)]'
              : 'text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]',
          )}
        >
          <Icon size={18} strokeWidth={isCategoryActive ? 2 : 1.5} />
          <span className="text-sm font-medium flex-1 text-left">{cat.label}</span>
          <ChevronDown
            size={14}
            className={cn('transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>

        {expanded && (
          <div className="mt-0.5 space-y-0.5">
            {cat.children!.map((child) => renderNavLink(child, true))}
          </div>
        )}
      </div>
    );
  };

  const renderComingSoon = (cat: NavCategory) => {
    const Icon = cat.icon;

    if (collapsed) {
      return (
        <div
          key={cat.key}
          className="flex items-center justify-center py-2.5 text-[var(--muted-foreground)] cursor-not-allowed opacity-50"
          title={`${cat.label} — Coming Soon`}
        >
          <Icon size={18} strokeWidth={1.5} />
        </div>
      );
    }

    return (
      <div
        key={cat.key}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[var(--muted-foreground)] cursor-not-allowed"
        title="Coming Soon"
      >
        <Icon size={18} strokeWidth={1.5} />
        <span className="text-sm">{cat.label}</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-md bg-[var(--card-hover)] text-[var(--muted)] font-medium uppercase tracking-wider">
          Soon
        </span>
      </div>
    );
  };

  /* ─── Main render ─── */

  const sidebarContent = (
    <aside
      className={cn(
        'fixed top-0 left-0 z-40 h-screen bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] transition-all duration-300 flex flex-col',
        'lg:translate-x-0 lg:sticky lg:top-0 lg:self-start',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        collapsed ? 'w-[72px]' : 'w-64',
      )}
    >
      {/* Header — Logo + Collapse Toggle */}
      <div className={cn(
        'flex items-center border-b border-[var(--sidebar-border)]',
        collapsed ? 'flex-col gap-2 px-2 py-4' : 'justify-between px-4 py-4',
      )}>
        <div className={cn('flex items-center gap-3', collapsed && 'flex-col')}>
          <div className="w-9 h-9 rounded-xl bg-[var(--foreground)] flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-[var(--background)]" />
          </div>
          {!collapsed && (
            <div>
              <span className="font-semibold text-base tracking-tight">Tableturnerr</span>
              <p className="text-[9px] text-[var(--muted)] font-mono">
                v{dashboardPkg.version}
              </p>
            </div>
          )}
        </div>
        <button
          onClick={toggle}
          className={cn(
            'p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)] transition-colors hidden lg:flex items-center justify-center',
            collapsed && 'mt-1',
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Search — opens master search modal */}
      {!collapsed && (
        <div className="px-3 py-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)] transition-colors"
          >
            <Search size={15} />
            <span className="text-xs">Search everything...</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--sidebar-hover)] border border-[var(--card-border)] font-mono">
              /
            </span>
          </button>
        </div>
      )}
      {collapsed && (
        <div className="px-2 py-3 flex justify-center">
          <button
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)] transition-colors"
            title="Search (press /)"
          >
            <Search size={16} />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn('flex-1 overflow-y-auto', collapsed ? 'px-2 py-2' : 'px-3 py-2')}>
        {/* MAIN label */}
        {!collapsed && (
          <div className="mb-2 px-3">
            <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
              Main
            </span>
          </div>
        )}
        {collapsed && (
          <div className="mb-2 text-center">
            <span className="text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wider">
              Main
            </span>
          </div>
        )}

        <div className="space-y-0.5">
          {navCategories.map(renderCategory)}
        </div>

        {/* Coming Soon */}
        <div className="mt-6">
          {!collapsed && (
            <div className="mb-2 px-3">
              <span className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Coming Soon
              </span>
            </div>
          )}
          {collapsed && (
            <div className="mb-2 text-center">
              <span className="text-[9px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Soon
              </span>
            </div>
          )}
          <div className="space-y-0.5">
            {comingSoonItems.map(renderComingSoon)}
          </div>
        </div>
      </nav>

      {/* Timezones */}
      <div className={cn(
        'border-t border-[var(--sidebar-border)] relative',
        collapsed ? 'px-2 py-3' : 'px-4 py-4 space-y-3',
      )}>
        <div className={cn(
          'flex items-center',
          collapsed ? 'justify-center' : 'justify-between px-1',
        )}>
          {!collapsed && (
            <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
              Time Zones
            </span>
          )}
          {timezones.length < 4 && (
            <button
              onClick={() => setShowTzSelector(!showTzSelector)}
              className="p-1 rounded-md hover:bg-[var(--sidebar-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              title="Add timezone"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {showTzSelector && (
          <div className={cn(
            'absolute bottom-full mb-2 z-50',
            collapsed ? 'left-full ml-2 w-64' : 'left-0 w-full',
          )}>
            <TimezoneSearch
              onSelect={addTimezone}
              onCancel={() => setShowTzSelector(false)}
              existingTimezones={timezones.map((t) => t.timezone)}
            />
          </div>
        )}

        {!collapsed && (
          <div className="space-y-2">
            {timezones.map((tz) => (
              <TimezoneClock
                key={tz.timezone}
                timezone={tz.timezone}
                label={tz.label}
                onRemove={() => removeTimezone(tz.timezone)}
                isStarred={coldCallingTimezone === tz.timezone}
                onStar={() => setStarTimezone(tz.timezone)}
              />
            ))}
          </div>
        )}
        {collapsed && timezones.length > 0 && (
          <div className="flex flex-col items-center gap-1.5 mt-2">
            {timezones.slice(0, 2).map((tz) => (
              <CollapsedTimezoneTime key={tz.timezone} timezone={tz.timezone} label={tz.label} />
            ))}
          </div>
        )}
      </div>

      {/* Team */}
      <TeamAvatars collapsed={collapsed} />

      {/* Settings */}
      <div className={cn(
        'border-t border-[var(--sidebar-border)]',
        collapsed ? 'px-2 py-2' : 'px-3 py-2',
      )}>
        {renderNavLink({ href: '/settings', label: 'Settings', icon: Settings })}
      </div>

      {/* User Profile */}
      <div className={cn(
        'border-t border-[var(--sidebar-border)]',
        collapsed ? 'px-2 py-3' : 'px-4 py-4',
      )}>
        <div className={cn(
          'flex items-center rounded-xl',
          collapsed ? 'justify-center' : 'gap-3 px-2 py-2',
        )}>
          <div className="w-9 h-9 rounded-full bg-[var(--primary)] flex items-center justify-center overflow-hidden relative flex-shrink-0">
            {user?.avatar ? (
              <Image
                src={user.avatar}
                alt={user.name || 'User'}
                fill
                sizes="36px"
                className="object-cover"
              />
            ) : (
              <span className="text-white text-xs font-semibold">
                {user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
              </span>
            )}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
                <p className="text-[11px] text-[var(--muted)] truncate">{user?.email || ''}</p>
              </div>
              <button
                onClick={logout}
                className="p-2 rounded-lg text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--error)] transition-colors"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-[var(--card-bg)] border border-[var(--card-border)] lg:hidden hover:bg-[var(--card-hover)] transition-colors"
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

      {sidebarContent}

      {/* Master search modal */}
      <MasterSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
