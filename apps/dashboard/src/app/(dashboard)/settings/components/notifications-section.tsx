'use client';

import { useState, useEffect } from 'react';
import { UserPreferences } from '@/lib/types';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useAuth } from '@/contexts/auth-context';
import { Bell, Mail, Volume2, Moon, MessageSquare, Eye, EyeOff, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { sendDiscordWebhook, buildTestEmbed } from '@/lib/discord';
import { useToast } from '@/components/ui/toast';

interface NotificationsSectionProps {
    preferences: UserPreferences | null;
    updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
    isSaving: boolean;
}

export function NotificationsSection({ preferences, updatePreferences, isSaving }: NotificationsSectionProps) {
    const { user } = useAuth();
    const { addToast } = useToast();
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
        discord_webhook_url: '',
        discord_follow_up_reminders: true,
        discord_overdue_alerts: true,
        discord_crm_alerts: false,
    });

    const [showWebhookUrl, setShowWebhookUrl] = useState(false);
    const [webhookInput, setWebhookInput] = useState(settings.discord_webhook_url || '');
    const [isTesting, setIsTesting] = useState(false);
    const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        if (preferences?.notification_settings) {
            setSettings(preferences.notification_settings);
            setWebhookInput(preferences.notification_settings.discord_webhook_url || '');
        }
    }, [preferences]);

    const updateSetting = async (key: string, value: boolean | string) => {
        const newSettings = { ...settings, [key]: value };
        setSettings(newSettings);
        await updatePreferences({ notification_settings: newSettings });
    };

    const saveWebhookUrl = async () => {
        const trimmed = webhookInput.trim();
        if (trimmed && !trimmed.startsWith('https://discord.com/api/webhooks/')) {
            addToast('error', 'Invalid webhook URL — must start with https://discord.com/api/webhooks/');
            return;
        }
        await updateSetting('discord_webhook_url', trimmed);
        addToast('success', trimmed ? 'Discord webhook URL saved' : 'Discord webhook URL removed');
        setTestStatus('idle');
    };

    const testWebhook = async () => {
        const url = webhookInput.trim();
        if (!url) {
            addToast('error', 'Enter a webhook URL first');
            return;
        }
        setIsTesting(true);
        setTestStatus('idle');
        const result = await sendDiscordWebhook(url, buildTestEmbed());
        setIsTesting(false);
        if (result.ok) {
            setTestStatus('success');
            addToast('success', 'Test message sent to Discord!');
        } else {
            setTestStatus('error');
            addToast('error', `Webhook test failed: ${result.error || 'Unknown error'}`);
        }
    };

    const discordConfigured = !!(settings.discord_webhook_url);

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

            {/* Discord Notifications */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <MessageSquare size={18} className="text-[#5865F2]" />
                    <h3 className="font-medium">Discord Notifications</h3>
                    {discordConfigured && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#5865F2]/15 text-[#5865F2] font-medium">
                            Connected
                        </span>
                    )}
                </div>

                <p className="text-sm text-[var(--muted)] pl-0">
                    Receive personal CRM notifications in your own Discord channel.{' '}
                    <a
                        href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-[var(--foreground)] transition-colors"
                    >
                        How to create a webhook →
                    </a>
                </p>

                <div className="p-4 rounded-lg border border-[var(--card-border)] space-y-4">
                    {/* Webhook URL input */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Webhook URL</label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    type={showWebhookUrl ? 'text' : 'password'}
                                    value={webhookInput}
                                    onChange={(e) => {
                                        setWebhookInput(e.target.value);
                                        setTestStatus('idle');
                                    }}
                                    placeholder="https://discord.com/api/webhooks/..."
                                    className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:border-[var(--primary)] font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowWebhookUrl((v) => !v)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                                    title={showWebhookUrl ? 'Hide URL' : 'Show URL'}
                                >
                                    {showWebhookUrl ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                            <button
                                onClick={saveWebhookUrl}
                                disabled={isSaving}
                                className="px-3 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)] whitespace-nowrap"
                            >
                                Save
                            </button>
                            <button
                                onClick={testWebhook}
                                disabled={isTesting || !webhookInput.trim()}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)] whitespace-nowrap disabled:opacity-50"
                            >
                                {isTesting ? (
                                    <Loader2 size={13} className="animate-spin" />
                                ) : testStatus === 'success' ? (
                                    <CheckCircle size={13} className="text-[var(--success)]" />
                                ) : testStatus === 'error' ? (
                                    <XCircle size={13} className="text-[var(--error)]" />
                                ) : null}
                                Test
                            </button>
                        </div>
                        <p className="text-xs text-[var(--muted)]">
                            Create a webhook in your Discord server (or a private channel) and paste the URL above. Your webhook URL is stored securely in your account.
                        </p>
                    </div>

                    {/* Event toggles — only shown when a URL is saved */}
                    {discordConfigured && (
                        <>
                            <hr className="border-[var(--card-border)]" />
                            <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Send to Discord when…</p>
                            <div className="space-y-3">
                                <ToggleSwitch
                                    checked={settings.discord_follow_up_reminders ?? true}
                                    onChange={(v) => updateSetting('discord_follow_up_reminders', v)}
                                    label="Follow-up is due"
                                    description="Get a Discord message when one of your follow-ups is due"
                                    disabled={isSaving}
                                />
                                <ToggleSwitch
                                    checked={settings.discord_overdue_alerts ?? true}
                                    onChange={(v) => updateSetting('discord_overdue_alerts', v)}
                                    label="Follow-up is overdue"
                                    description="Reminder when a follow-up has passed its scheduled time"
                                    disabled={isSaving}
                                />
                                <ToggleSwitch
                                    checked={settings.discord_crm_alerts ?? false}
                                    onChange={(v) => updateSetting('discord_crm_alerts', v)}
                                    label="CRM alerts sent to you"
                                    description="When a team member creates a manual alert targeting you"
                                    disabled={isSaving}
                                />
                            </div>
                        </>
                    )}
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
