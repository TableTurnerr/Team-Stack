'use client';

import { useState, useEffect } from 'react';
import { UserPreferences } from '@/lib/types';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { Table, Calendar, Phone, Building2 } from 'lucide-react';

interface PreferencesSectionProps {
    preferences: UserPreferences | null;
    updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
    isSaving: boolean;
}

export function PreferencesSection({ preferences, updatePreferences, isSaving }: PreferencesSectionProps) {
    const [settings, setSettings] = useState<NonNullable<UserPreferences['workflow_preferences']>>(
        preferences?.workflow_preferences || {
            default_page_size: 25,
            default_sort_order: 'newest' as const,
            remember_columns: true,
            default_follow_up_interval: '3_days' as const,
            auto_follow_up_callback: true,
            auto_start_recording: false,
            show_transcript_panel: true,
            expanded_view: false,
        }
    );

    useEffect(() => {
        if (preferences?.workflow_preferences) {
            setSettings(preferences.workflow_preferences);
        }
    }, [preferences]);

    const updateSetting = async (key: string, value: any) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        await updatePreferences({ workflow_preferences: newSettings });
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-lg font-semibold">Preferences</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Customize your workflow defaults
                </p>
            </div>

            {/* Table Defaults */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Table size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Table Defaults</h3>
                </div>

                <div className="space-y-4 pl-6">
                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium">Default Page Size</label>
                        <select
                            value={settings.default_page_size || 25}
                            onChange={(e) => updateSetting('default_page_size', Number(e.target.value))}
                            disabled={isSaving}
                            className="w-48"
                        >
                            <option value={10}>10 rows</option>
                            <option value={25}>25 rows</option>
                            <option value={50}>50 rows</option>
                            <option value={100}>100 rows</option>
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium">Default Sort Order</label>
                        <select
                            value={settings.default_sort_order || 'newest'}
                            onChange={(e) => updateSetting('default_sort_order', e.target.value)}
                            disabled={isSaving}
                            className="w-48"
                        >
                            <option value="newest">Newest first</option>
                            <option value="oldest">Oldest first</option>
                            <option value="alphabetical">Alphabetical</option>
                        </select>
                    </div>

                    <ToggleSwitch
                        checked={settings.remember_columns ?? true}
                        onChange={(v) => updateSetting('remember_columns', v)}
                        label="Remember column visibility"
                        description="Save your column preferences for each table"
                        disabled={isSaving}
                    />
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Follow-Up Defaults */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Calendar size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Follow-Up Defaults</h3>
                </div>

                <div className="space-y-4 pl-6">
                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium">Default Follow-Up Interval</label>
                        <select
                            value={settings.default_follow_up_interval || '3_days'}
                            onChange={(e) => updateSetting('default_follow_up_interval', e.target.value)}
                            disabled={isSaving}
                            className="w-48"
                        >
                            <option value="1_day">1 day</option>
                            <option value="3_days">3 days</option>
                            <option value="1_week">1 week</option>
                        </select>
                    </div>

                    <ToggleSwitch
                        checked={settings.auto_follow_up_callback ?? true}
                        onChange={(v) => updateSetting('auto_follow_up_callback', v)}
                        label="Auto-create follow-up on 'Callback'"
                        description="Automatically schedule follow-up when call outcome is 'Callback'"
                        disabled={isSaving}
                    />
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Cold Call Defaults */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Phone size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Cold Call Defaults</h3>
                </div>

                <div className="space-y-4 pl-6">
                    <ToggleSwitch
                        checked={settings.auto_start_recording ?? false}
                        onChange={(v) => updateSetting('auto_start_recording', v)}
                        label="Auto-start recording"
                        description="Automatically start recording when you begin a call"
                        disabled={isSaving}
                    />

                    <ToggleSwitch
                        checked={settings.show_transcript_panel ?? true}
                        onChange={(v) => updateSetting('show_transcript_panel', v)}
                        label="Show transcript panel by default"
                        description="Display the transcript panel when viewing call details"
                        disabled={isSaving}
                    />
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Company View Defaults */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Building2 size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Company View Defaults</h3>
                </div>

                <div className="pl-6">
                    <ToggleSwitch
                        checked={settings.expanded_view ?? false}
                        onChange={(v) => updateSetting('expanded_view', v)}
                        label="Expanded view by default"
                        description="Show expanded company cards instead of collapsed"
                        disabled={isSaving}
                    />
                </div>
            </div>
        </div>
    );
}
