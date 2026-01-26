'use client';

import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import {
    User,
    Shield,
    Palette,
    Bell,
    Settings2,
    Users,
    Plug,
    Database,
} from 'lucide-react';

export type SettingsSection =
    | 'profile'
    | 'account'
    | 'appearance'
    | 'notifications'
    | 'preferences'
    | 'team'
    | 'integrations'
    | 'data-privacy';

interface SettingsNavProps {
    activeSection: SettingsSection;
    onSectionChange: (section: SettingsSection) => void;
}

const sections = [
    { id: 'profile' as const, label: 'Profile', icon: User, adminOnly: false },
    { id: 'account' as const, label: 'Account', icon: Shield, adminOnly: false },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette, adminOnly: false },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell, adminOnly: false },
    { id: 'preferences' as const, label: 'Preferences', icon: Settings2, adminOnly: false },
    { id: 'team' as const, label: 'Team Management', icon: Users, adminOnly: true },
    { id: 'integrations' as const, label: 'Integrations', icon: Plug, adminOnly: true },
    { id: 'data-privacy' as const, label: 'Data & Privacy', icon: Database, adminOnly: false },
];

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const visibleSections = sections.filter(s => !s.adminOnly || isAdmin);

    return (
        <nav className="w-full lg:w-56 shrink-0">
            {/* Mobile dropdown */}
            <div className="lg:hidden mb-4">
                <select
                    value={activeSection}
                    onChange={(e) => onSectionChange(e.target.value as SettingsSection)}
                    className="w-full"
                >
                    {visibleSections.map((section) => (
                        <option key={section.id} value={section.id}>
                            {section.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* Desktop sidebar */}
            <ul className="hidden lg:block space-y-1">
                {visibleSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;

                    return (
                        <li key={section.id}>
                            <button
                                onClick={() => onSectionChange(section.id)}
                                className={cn(
                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                                    isActive
                                        ? 'bg-[var(--foreground)] text-[var(--background)]'
                                        : 'text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]'
                                )}
                            >
                                <Icon size={18} strokeWidth={isActive ? 2 : 1.5} />
                                <span>{section.label}</span>
                                {section.adminOnly && (
                                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary-subtle)] text-[var(--primary)]">
                                        Admin
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
