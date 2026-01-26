'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { UserPreferences } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { Sun, Moon, Monitor, Plus, X, GripVertical, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppearanceSectionProps {
    preferences: UserPreferences | null;
    updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
    isSaving: boolean;
}

const POPULAR_TIMEZONES = [
    { timezone: 'America/New_York', label: 'EST (New York)' },
    { timezone: 'America/Chicago', label: 'CST (Chicago)' },
    { timezone: 'America/Denver', label: 'MST (Denver)' },
    { timezone: 'America/Los_Angeles', label: 'PST (Los Angeles)' },
    { timezone: 'UTC', label: 'UTC' },
    { timezone: 'Europe/London', label: 'GMT (London)' },
    { timezone: 'Europe/Paris', label: 'CET (Paris)' },
    { timezone: 'Asia/Tokyo', label: 'JST (Tokyo)' },
    { timezone: 'Asia/Shanghai', label: 'CST (Shanghai)' },
    { timezone: 'Australia/Sydney', label: 'AEST (Sydney)' },
];

export function AppearanceSection({ preferences, updatePreferences, isSaving }: AppearanceSectionProps) {
    const { theme, setTheme } = useTheme();
    const { addToast } = useToast();
    const [mounted, setMounted] = useState(false);
    const [timezones, setTimezones] = useState<{ timezone: string; label: string }[]>(
        preferences?.timezones || []
    );
    const [showTimezoneSelector, setShowTimezoneSelector] = useState(false);
    const [density, setDensity] = useState<'comfortable' | 'compact'>(
        preferences?.display_density || 'comfortable'
    );

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (preferences?.timezones) {
            setTimezones(preferences.timezones);
        }
        if (preferences?.display_density) {
            setDensity(preferences.display_density);
        }
    }, [preferences]);

    // Sync theme to PocketBase when it changes
    const handleThemeChange = async (newTheme: string) => {
        setTheme(newTheme);
        await updatePreferences({ theme: newTheme as 'light' | 'dark' | 'system' });
    };

    const handleDensityChange = async (newDensity: 'comfortable' | 'compact') => {
        setDensity(newDensity);
        await updatePreferences({ display_density: newDensity });
        // Also update localStorage for sidebar
        localStorage.setItem('display_density', newDensity);
    };

    const addTimezone = async (tz: { timezone: string; label: string }) => {
        if (timezones.length >= 4) {
            addToast('warning', 'Maximum 4 timezones allowed');
            return;
        }
        if (timezones.find(t => t.timezone === tz.timezone)) {
            addToast('warning', 'Timezone already added');
            return;
        }

        const newTimezones = [...timezones, tz];
        setTimezones(newTimezones);
        setShowTimezoneSelector(false);
        await updatePreferences({ timezones: newTimezones });
        // Also update localStorage for sidebar
        localStorage.setItem('sidebar_timezones', JSON.stringify(newTimezones));
    };

    const removeTimezone = async (tzToRemove: string) => {
        const newTimezones = timezones.filter(t => t.timezone !== tzToRemove);
        setTimezones(newTimezones);
        await updatePreferences({ timezones: newTimezones });
        localStorage.setItem('sidebar_timezones', JSON.stringify(newTimezones));
    };

    if (!mounted) return null;

    const themeOptions = [
        { value: 'light', label: 'Light', icon: Sun },
        { value: 'dark', label: 'Dark', icon: Moon },
        { value: 'system', label: 'System', icon: Monitor },
    ];

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-lg font-semibold">Appearance</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Customize how the app looks and feels
                </p>
            </div>

            {/* Theme */}
            <div className="space-y-3">
                <h3 className="text-sm font-medium">Theme</h3>
                <div className="flex gap-3">
                    {themeOptions.map((option) => {
                        const Icon = option.icon;
                        const isActive = theme === option.value;

                        return (
                            <button
                                key={option.value}
                                onClick={() => handleThemeChange(option.value)}
                                disabled={isSaving}
                                className={cn(
                                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                                    'hover:border-[var(--foreground)]',
                                    isActive
                                        ? 'border-[var(--foreground)] bg-[var(--card-hover)]'
                                        : 'border-[var(--card-border)]'
                                )}
                            >
                                <Icon size={24} strokeWidth={1.5} />
                                <span className="text-sm font-medium">{option.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Display Density */}
            <div className="space-y-3">
                <h3 className="text-sm font-medium">Display Density</h3>
                <div className="flex gap-3">
                    {(['comfortable', 'compact'] as const).map((option) => (
                        <button
                            key={option}
                            onClick={() => handleDensityChange(option)}
                            disabled={isSaving}
                            className={cn(
                                'flex-1 p-3 rounded-lg border-2 transition-all text-sm font-medium capitalize',
                                'hover:border-[var(--foreground)]',
                                density === option
                                    ? 'border-[var(--foreground)] bg-[var(--card-hover)]'
                                    : 'border-[var(--card-border)]'
                            )}
                        >
                            {option}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-[var(--muted)]">
                    {density === 'comfortable'
                        ? 'Standard spacing for easier reading'
                        : 'Reduced padding to show more content'}
                </p>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Timezone Clocks */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-medium">Sidebar Timezone Clocks</h3>
                        <p className="text-xs text-[var(--muted)]">Up to 4 timezones shown in sidebar</p>
                    </div>
                    {timezones.length < 4 && (
                        <button
                            onClick={() => setShowTimezoneSelector(!showTimezoneSelector)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)]"
                        >
                            <Plus size={16} />
                            Add
                        </button>
                    )}
                </div>

                {/* Current timezones */}
                <div className="space-y-2">
                    {timezones.map((tz) => (
                        <div
                            key={tz.timezone}
                            className="flex items-center justify-between p-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-hover)]"
                        >
                            <div className="flex items-center gap-3">
                                <GripVertical size={16} className="text-[var(--muted)]" />
                                <Globe size={16} className="text-[var(--muted)]" />
                                <div>
                                    <span className="text-sm font-medium">{tz.label}</span>
                                    <span className="text-xs text-[var(--muted)] ml-2">({tz.timezone})</span>
                                </div>
                            </div>
                            <button
                                onClick={() => removeTimezone(tz.timezone)}
                                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Timezone selector */}
                {showTimezoneSelector && (
                    <div className="p-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] space-y-2">
                        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                            Popular Timezones
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {POPULAR_TIMEZONES.filter(tz => !timezones.find(t => t.timezone === tz.timezone))
                                .map((tz) => (
                                    <button
                                        key={tz.timezone}
                                        onClick={() => addTimezone(tz)}
                                        className="text-left p-2 text-sm rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                                    >
                                        {tz.label}
                                    </button>
                                ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
