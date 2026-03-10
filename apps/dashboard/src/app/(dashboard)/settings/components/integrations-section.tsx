'use client';

import { useState, useEffect } from 'react';
import { UserPreferences } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { Plug, Instagram, Database, CheckCircle, XCircle, RefreshCw, Loader2, Phone } from 'lucide-react';
import Link from 'next/link';

const ZOOM_AUTODIAL_KEY = 'zoom-phone-autodial';
const ZOOM_AUTORECORD_KEY = 'call-recorder-auto-mode';
const ZOOM_SHOW_NATIVE_KEY = 'zoom-show-native-dialer';


interface IntegrationsSectionProps {
    preferences: UserPreferences | null;
    updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
    isSaving: boolean;
}

export function IntegrationsSection({ preferences, updatePreferences, isSaving }: IntegrationsSectionProps) {
    const { addToast } = useToast();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [isTesting, setIsTesting] = useState(false);
    const [pbStatus, setPbStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
    const [autoDial, setAutoDial] = useState(false);
    const [autoRecord, setAutoRecord] = useState(true);
    const [showNativeDialer, setShowNativeDialer] = useState(false);

    // Load settings from localStorage on mount
    useEffect(() => {
        try {
            const savedAutoDial = localStorage.getItem(ZOOM_AUTODIAL_KEY);
            if (savedAutoDial !== null) setAutoDial(JSON.parse(savedAutoDial));

            const savedAutoRecord = localStorage.getItem(ZOOM_AUTORECORD_KEY);
            if (savedAutoRecord !== null) setAutoRecord(JSON.parse(savedAutoRecord));

            const savedNative = localStorage.getItem(ZOOM_SHOW_NATIVE_KEY);
            if (savedNative !== null) setShowNativeDialer(JSON.parse(savedNative));

        } catch {
            // ignore
        }
    }, []);

    const handleAutoDialToggle = (enabled: boolean) => {
        setAutoDial(enabled);
        try {
            localStorage.setItem(ZOOM_AUTODIAL_KEY, JSON.stringify(enabled));
        } catch {
            // ignore
        }
        addToast('success', enabled
            ? 'Auto-dial enabled — calls will be routed through the Zoom desktop app'
            : 'Auto-dial disabled — numbers will populate in the web dialer'
        );
    };

    const handleAutoRecordToggle = (enabled: boolean) => {
        setAutoRecord(enabled);
        try {
            localStorage.setItem(ZOOM_AUTORECORD_KEY, JSON.stringify(enabled));
        } catch {
            // ignore
        }
        addToast('success', enabled
            ? 'Auto-record enabled — calls will be recorded automatically'
            : 'Auto-record disabled — you will need to start recordings manually'
        );
    };

    const handleShowNativeDialerToggle = (enabled: boolean) => {
        setShowNativeDialer(enabled);
        try {
            localStorage.setItem(ZOOM_SHOW_NATIVE_KEY, JSON.stringify(enabled));
        } catch {
            // ignore
        }
        addToast('success', enabled
            ? 'Zoom native dialer toggle enabled in the dialer header'
            : 'Zoom native dialer toggle hidden'
        );
    };

    const testPocketBaseConnection = async () => {
        setIsTesting(true);
        try {
            await pb.health.check();
            setPbStatus('connected');
            addToast('success', 'PocketBase connection successful');
        } catch (error) {
            setPbStatus('error');
            addToast('error', 'Failed to connect to PocketBase');
        } finally {
            setIsTesting(false);
        }
    };

    const exportSettings = () => {
        if (!preferences) return;

        const data = {
            theme: preferences.theme,
            display_density: preferences.display_density,
            timezones: preferences.timezones,
            notification_settings: preferences.notification_settings,
            workflow_preferences: preferences.workflow_preferences,
            privacy_settings: preferences.privacy_settings,
            exported_at: new Date().toISOString(),
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tableturnerr-settings-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        addToast('success', 'Settings exported');
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-lg font-semibold">Integrations</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Manage external services and connections
                </p>
            </div>

            {/* Zoom Phone */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Phone size={18} className="text-blue-400" />
                    <h3 className="font-medium">Zoom Phone</h3>
                </div>

                <div className="p-4 rounded-lg border border-[var(--card-border)] space-y-4">
                    {/* Auto-Dial */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Auto-Dial <span className="text-[10px] font-normal text-[var(--muted)] ml-1">(Default: Off)</span></p>
                            <p className="text-xs text-[var(--muted)] max-w-md">
                                When enabled, clicking a phone button will automatically populate the
                                number in the Zoom dialer. When disabled, the number will only be
                                populated in the custom dialer for you to confirm manually.
                            </p>
                        </div>
                        <button
                            onClick={() => handleAutoDialToggle(!autoDial)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${autoDial ? 'bg-blue-500' : 'bg-[var(--card-border)]'
                                }`}
                            role="switch"
                            aria-checked={autoDial}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoDial ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                    </div>

                    <hr className="border-[var(--card-border)]" />

                    {/* Auto-Record */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Auto-Record Calls <span className="text-[10px] font-normal text-[var(--muted)] ml-1">(Default: On)</span></p>
                            <p className="text-xs text-[var(--muted)] max-w-md">
                                When enabled, recording starts automatically when a call connects
                                and stops when the call ends. When disabled, you must start and stop
                                recordings manually from the dialer.
                            </p>
                        </div>
                        <button
                            onClick={() => handleAutoRecordToggle(!autoRecord)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${autoRecord ? 'bg-blue-500' : 'bg-[var(--card-border)]'
                                }`}
                            role="switch"
                            aria-checked={autoRecord}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoRecord ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                    </div>

                    <hr className="border-[var(--card-border)]" />

                    {/* Show Native Dialer */}
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Show Zoom Native Dialer Toggle <span className="text-[10px] font-normal text-[var(--muted)] ml-1">(Default: Off)</span></p>
                            <p className="text-xs text-[var(--muted)] max-w-md">
                                When enabled, a swap button appears in the dialer header to switch
                                between the custom dialer (which captures phone numbers for recordings)
                                and the Zoom native dialer. Keep disabled unless needed.
                            </p>
                        </div>
                        <button
                            onClick={() => handleShowNativeDialerToggle(!showNativeDialer)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${showNativeDialer ? 'bg-blue-500' : 'bg-[var(--card-border)]'
                                }`}
                            role="switch"
                            aria-checked={showNativeDialer}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${showNativeDialer ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Instagram Actors */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Instagram size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Instagram Actors</h3>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border border-[var(--card-border)]">
                    <div>
                        <p className="text-sm font-medium">Manage Instagram Accounts</p>
                        <p className="text-xs text-[var(--muted)]">Configure actors for outreach automation</p>
                    </div>
                    <Link
                        href="/actors"
                        className="px-4 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)]"
                    >
                        Go to Actors
                    </Link>
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* PocketBase Connection */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Database size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Database Connection</h3>
                </div>

                <div className="p-4 rounded-lg border border-[var(--card-border)] space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">PocketBase</p>
                            <p className="text-xs text-[var(--muted)] break-all">
                                {process.env.NEXT_PUBLIC_POCKETBASE_URL || 'Not configured'}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {pbStatus === 'connected' && (
                                <span className="flex items-center gap-1.5 text-sm text-[var(--success)]">
                                    <CheckCircle size={16} />
                                    Connected
                                </span>
                            )}
                            {pbStatus === 'error' && (
                                <span className="flex items-center gap-1.5 text-sm text-[var(--error)]">
                                    <XCircle size={16} />
                                    Error
                                </span>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={testPocketBaseConnection}
                        disabled={isTesting}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)]"
                    >
                        {isTesting ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <RefreshCw size={14} />
                        )}
                        Test Connection
                    </button>
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Export/Import */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Plug size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Settings Backup</h3>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={exportSettings}
                        className="px-4 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)]"
                    >
                        Export Settings
                    </button>
                    <button
                        disabled={true}
                        className="px-4 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)] opacity-50 cursor-not-allowed flex items-center gap-2"
                    >
                        Import Settings
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--muted)]/20 text-[var(--muted)] font-medium">
                            Coming Soon
                        </span>
                    </button>
                </div>

                <p className="text-xs text-[var(--muted)]">
                    Export your settings as a JSON file for backup or transfer to another account.
                </p>
            </div>
        </div>
    );
}
