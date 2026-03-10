'use client';

import { useState, useEffect } from 'react';
import { UserPreferences } from '@/lib/types';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useAuth } from '@/contexts/auth-context';
import { Bell, Mail, Volume2, Moon } from 'lucide-react';

interface NotificationsSectionProps {
    preferences: UserPreferences | null;
    updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
    isSaving: boolean;
}

export function NotificationsSection({ preferences, updatePreferences, isSaving }: NotificationsSectionProps) {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [settings, setSettings] = useState(preferences?.notification_settings || {
        follow_up_reminders: true,
        team_activity: true,
        new_recordings: true,
        system_announcements: true,
        daily_digest: false,
        weekly_summary: false,
        new_team_member: true,
        important_updates: true,
        sound_enabled: true,
        dnd_enabled: false,
        dnd_start: '22:00',
        dnd_end: '08:00',
    });

    useEffect(() => {
        if (preferences?.notification_settings) {
            setSettings(preferences.notification_settings);
        }
    }, [preferences]);

    const updateSetting = async (key: string, value: boolean | string) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        await updatePreferences({ notification_settings: newSettings });
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-lg font-semibold">Notifications</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Choose what notifications you receive
                </p>
            </div>

            {/* In-App Notifications */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Bell size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">In-App Notifications</h3>
                </div>

                <div className="space-y-4 pl-6">
                    <ToggleSwitch
                        checked={settings.follow_up_reminders ?? true}
                        onChange={(v) => updateSetting('follow_up_reminders', v)}
                        label="Follow-up reminders"
                        description="Get notified when follow-ups are due"
                        disabled={isSaving}
                    />
                    <ToggleSwitch
                        checked={settings.team_activity ?? true}
                        onChange={(v) => updateSetting('team_activity', v)}
                        label="Team activity updates"
                        description="Activity from your team members"
                        disabled={isSaving}
                    />
                    <ToggleSwitch
                        checked={settings.new_recordings ?? true}
                        onChange={(v) => updateSetting('new_recordings', v)}
                        label="New recording alerts"
                        description="When new call recordings are processed"
                        disabled={isSaving}
                    />
                    <ToggleSwitch
                        checked={settings.system_announcements ?? true}
                        onChange={(v) => updateSetting('system_announcements', v)}
                        label="System announcements"
                        description="Important platform updates"
                        disabled={isSaving}
                    />
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Email Notifications */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Mail size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Email Notifications</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--muted)]/20 text-[var(--muted)] font-medium">
                        Coming Soon
                    </span>
                </div>

                <div className="space-y-4 pl-6">
                    <ToggleSwitch
                        checked={settings.daily_digest ?? false}
                        onChange={() => { }}
                        label="Daily follow-up digest"
                        description="Summary of upcoming follow-ups each morning"
                        disabled={true}
                    />
                    <ToggleSwitch
                        checked={settings.weekly_summary ?? false}
                        onChange={() => { }}
                        label="Weekly performance summary"
                        description="Your stats and achievements each week"
                        disabled={true}
                    />
                    {isAdmin && (
                        <ToggleSwitch
                            checked={settings.new_team_member ?? true}
                            onChange={() => { }}
                            label="New team member joined"
                            description="When someone joins your team"
                            disabled={true}
                        />
                    )}
                    <ToggleSwitch
                        checked={settings.important_updates ?? true}
                        onChange={() => { }}
                        label="Important system updates"
                        description="Critical security and feature updates"
                        disabled={true}
                    />
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Sound */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Volume2 size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Sound</h3>
                </div>

                <div className="pl-6">
                    <ToggleSwitch
                        checked={settings.sound_enabled ?? true}
                        onChange={() => { }}
                        label="Notification sounds"
                        description="Play sound when notifications arrive"
                        disabled={true}
                        badge="Coming Soon"
                    />
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Do Not Disturb */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Moon size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Do Not Disturb</h3>
                </div>

                <div className="space-y-4 pl-6">
                    <ToggleSwitch
                        checked={settings.dnd_enabled ?? false}
                        onChange={(v) => updateSetting('dnd_enabled', v)}
                        label="Enable quiet hours"
                        description="Mute notifications during specified times"
                        disabled={isSaving}
                    />

                    {settings.dnd_enabled && (
                        <div className="flex items-center gap-4">
                            <div className="space-y-1">
                                <label className="text-xs text-[var(--muted)]">Start</label>
                                <input
                                    type="time"
                                    value={settings.dnd_start || '22:00'}
                                    onChange={(e) => updateSetting('dnd_start', e.target.value)}
                                    className="px-3 py-1.5 rounded-lg text-sm"
                                    disabled={isSaving}
                                />
                            </div>
                            <span className="text-[var(--muted)] mt-5">to</span>
                            <div className="space-y-1">
                                <label className="text-xs text-[var(--muted)]">End</label>
                                <input
                                    type="time"
                                    value={settings.dnd_end || '08:00'}
                                    onChange={(e) => updateSetting('dnd_end', e.target.value)}
                                    className="px-3 py-1.5 rounded-lg text-sm"
                                    disabled={isSaving}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
