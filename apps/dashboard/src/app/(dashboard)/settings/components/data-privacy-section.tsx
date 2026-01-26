'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { UserPreferences } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { PasswordInput } from '@/components/ui/password-input';
import { pb } from '@/lib/pocketbase';
import { Download, Eye, Trash2, Loader2, AlertTriangle } from 'lucide-react';

interface DataPrivacySectionProps {
    preferences: UserPreferences | null;
    updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
    isSaving: boolean;
}

export function DataPrivacySection({ preferences, updatePreferences, isSaving }: DataPrivacySectionProps) {
    const { user, logout } = useAuth();
    const { addToast } = useToast();
    const [isExporting, setIsExporting] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const privacySettings = preferences?.privacy_settings || {
        show_online_status: true,
        activity_visibility: 'team',
    };

    const updatePrivacySetting = async (key: string, value: any) => {
        await updatePreferences({
            privacy_settings: { ...privacySettings, [key]: value }
        });
    };

    const handleExportData = async () => {
        if (!user?.id) return;

        setIsExporting(true);
        try {
            // Gather user data
            const userData = {
                profile: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                },
                preferences: preferences ? {
                    theme: preferences.theme,
                    display_density: preferences.display_density,
                    timezones: preferences.timezones,
                    notification_settings: preferences.notification_settings,
                    workflow_preferences: preferences.workflow_preferences,
                    privacy_settings: preferences.privacy_settings,
                } : null,
                exported_at: new Date().toISOString(),
            };

            const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tableturnerr-my-data-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            addToast('success', 'Data exported successfully');
        } catch (error) {
            console.error('Failed to export data:', error);
            addToast('error', 'Failed to export data');
        } finally {
            setIsExporting(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!user?.id || !deletePassword) return;

        setIsDeleting(true);
        try {
            // Verify password by attempting to auth
            await pb.collection('users').authWithPassword(user.email, deletePassword);

            // Delete user account
            await pb.collection('users').delete(user.id);

            addToast('success', 'Account deleted. Goodbye!');
            logout();
        } catch (error: any) {
            console.error('Failed to delete account:', error);
            addToast('error', error?.message || 'Failed to delete account. Check your password.');
        } finally {
            setIsDeleting(false);
            setShowDeleteModal(false);
            setDeletePassword('');
        }
    };

    const isAdmin = user?.role === 'admin';

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-lg font-semibold">Data & Privacy</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Control your data and privacy settings
                </p>
            </div>

            {/* Export Data */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Download size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Export My Data</h3>
                </div>

                <p className="text-sm text-[var(--muted)]">
                    Download a copy of your personal data including profile information and preferences.
                </p>

                <button
                    onClick={handleExportData}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-primary"
                >
                    {isExporting && <Loader2 size={16} className="animate-spin" />}
                    Export My Data
                </button>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Privacy Settings */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Eye size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Privacy Settings</h3>
                </div>

                <div className="space-y-4">
                    <ToggleSwitch
                        checked={privacySettings.show_online_status ?? true}
                        onChange={(v) => updatePrivacySetting('show_online_status', v)}
                        label="Show online status"
                        description="Let others see when you're online"
                        disabled={isSaving}
                    />

                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium">Activity Visibility</label>
                        <select
                            value={privacySettings.activity_visibility || 'team'}
                            onChange={(e) => updatePrivacySetting('activity_visibility', e.target.value)}
                            disabled={isSaving}
                            className="w-48"
                        >
                            <option value="team">Team members</option>
                            <option value="admins_only">Admins only</option>
                        </select>
                        <p className="text-xs text-[var(--muted)]">
                            Who can see your activity in reports
                        </p>
                    </div>
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Danger Zone */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Trash2 size={18} className="text-[var(--error)]" />
                    <h3 className="font-medium text-[var(--error)]">Danger Zone</h3>
                </div>

                <div className="p-4 rounded-lg border-2 border-[var(--error)] bg-[var(--error-subtle)]">
                    <h4 className="font-medium mb-2">Delete Account</h4>
                    <p className="text-sm text-[var(--muted)] mb-4">
                        Permanently delete your account and all associated data. This action cannot be undone.
                    </p>

                    {isAdmin ? (
                        <p className="text-sm text-[var(--warning)] flex items-center gap-2">
                            <AlertTriangle size={16} />
                            Admin accounts cannot be deleted. Contact support if needed.
                        </p>
                    ) : (
                        <button
                            onClick={() => setShowDeleteModal(true)}
                            className="px-4 py-2 text-sm font-medium rounded-lg btn-danger"
                        >
                            Delete My Account
                        </button>
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
                    <div className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-md p-6 space-y-4">
                        <div className="flex items-center gap-3 text-[var(--error)]">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-semibold">Delete Account</h3>
                        </div>

                        <p className="text-sm text-[var(--muted)]">
                            This will permanently delete your account and all your data. Enter your password to confirm.
                        </p>

                        <PasswordInput
                            label="Confirm Password"
                            value={deletePassword}
                            onChange={(e) => setDeletePassword(e.target.value)}
                            placeholder="Enter your password"
                        />

                        <div className="flex gap-3 justify-end pt-2">
                            <button
                                onClick={() => { setShowDeleteModal(false); setDeletePassword(''); }}
                                className="px-4 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)]"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteAccount}
                                disabled={!deletePassword || isDeleting}
                                className="px-4 py-2 text-sm font-medium rounded-lg btn-danger disabled:opacity-50 flex items-center gap-2"
                            >
                                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                                Delete Forever
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
