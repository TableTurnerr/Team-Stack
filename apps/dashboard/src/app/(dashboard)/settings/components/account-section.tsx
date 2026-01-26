'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { useToast } from '@/components/ui/toast';
import { PasswordInput } from '@/components/ui/password-input';
import { Loader2, CheckCircle, Shield, Key, ExternalLink } from 'lucide-react';

export function AccountSection() {
    const { user } = useAuth();
    const { addToast } = useToast();

    const [passwords, setPasswords] = useState({
        current: '',
        new: '',
        confirm: '',
    });
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    const validatePassword = (password: string): string | null => {
        if (password.length < 8) return 'Password must be at least 8 characters';
        if (!/\d/.test(password)) return 'Password must contain at least one number';
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return 'Password must contain at least one special character';
        return null;
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.id) return;

        const validationError = validatePassword(passwords.new);
        if (validationError) {
            addToast('error', validationError);
            return;
        }

        if (passwords.new !== passwords.confirm) {
            addToast('error', 'New passwords do not match');
            return;
        }

        setIsChangingPassword(true);
        try {
            await pb.collection('users').update(user.id, {
                oldPassword: passwords.current,
                password: passwords.new,
                passwordConfirm: passwords.confirm,
            });

            setPasswords({ current: '', new: '', confirm: '' });
            addToast('success', 'Password changed successfully');
        } catch (error: any) {
            console.error('Failed to change password:', error);
            addToast('error', error?.message || 'Failed to change password. Check your current password.');
        } finally {
            setIsChangingPassword(false);
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-lg font-semibold">Account Security</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Manage your password and security settings
                </p>
            </div>

            {/* Password Change */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Key size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Change Password</h3>
                </div>

                <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
                    <PasswordInput
                        label="Current Password"
                        value={passwords.current}
                        onChange={(e) => setPasswords(prev => ({ ...prev, current: e.target.value }))}
                        placeholder="Enter current password"
                        required
                    />

                    <PasswordInput
                        label="New Password"
                        value={passwords.new}
                        onChange={(e) => setPasswords(prev => ({ ...prev, new: e.target.value }))}
                        placeholder="Enter new password"
                        showStrength
                        required
                    />

                    <PasswordInput
                        label="Confirm New Password"
                        value={passwords.confirm}
                        onChange={(e) => setPasswords(prev => ({ ...prev, confirm: e.target.value }))}
                        placeholder="Confirm new password"
                        error={passwords.confirm && passwords.new !== passwords.confirm ? 'Passwords do not match' : undefined}
                        required
                    />

                    <button
                        type="submit"
                        disabled={isChangingPassword || !passwords.current || !passwords.new || !passwords.confirm}
                        className="px-4 py-2 text-sm font-medium rounded-lg btn-primary disabled:opacity-50 flex items-center gap-2"
                    >
                        {isChangingPassword && <Loader2 size={16} className="animate-spin" />}
                        Update Password
                    </button>
                </form>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* Connected Accounts */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <ExternalLink size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Connected Accounts</h3>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-hover)]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                            <svg viewBox="0 0 24 24" className="w-5 h-5">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-sm font-medium">Google</p>
                            <p className="text-xs text-[var(--muted)]">Sign in with Google</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-[var(--success)]">
                        <CheckCircle size={16} />
                        <span className="text-sm">Connected</span>
                    </div>
                </div>
            </div>

            <hr className="border-[var(--card-border)]" />

            {/* 2FA Placeholder */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Shield size={18} className="text-[var(--muted)]" />
                    <h3 className="font-medium">Two-Factor Authentication</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--info-subtle)] text-[var(--info)] font-medium">
                        Coming Soon
                    </span>
                </div>

                <p className="text-sm text-[var(--muted)]">
                    Add an extra layer of security to your account by requiring a verification code in addition to your password.
                </p>
            </div>
        </div>
    );
}
