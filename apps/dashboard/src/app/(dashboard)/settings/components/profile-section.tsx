'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { useToast } from '@/components/ui/toast';
import { Camera, Loader2, User } from 'lucide-react';
import Image from 'next/image';

export function ProfileSection() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
    });
    const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatar || null);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        if (user) {
            setFormData({ name: user.name || '', email: user.email || '' });
            setAvatarPreview(user.avatar || null);
        }
    }, [user]);

    useEffect(() => {
        const hasChanges =
            formData.name !== (user?.name || '') ||
            formData.email !== (user?.email || '') ||
            avatarFile !== null;
        setIsDirty(hasChanges);
    }, [formData, avatarFile, user]);

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            addToast('error', 'Image must be less than 2MB');
            return;
        }

        if (!file.type.startsWith('image/')) {
            addToast('error', 'Please select an image file');
            return;
        }

        setAvatarFile(file);
        setAvatarPreview(URL.createObjectURL(file));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.id) return;

        if (formData.name.length < 2 || formData.name.length > 50) {
            addToast('error', 'Name must be 2-50 characters');
            return;
        }

        setIsLoading(true);
        try {
            const updateData = new FormData();
            updateData.append('name', formData.name);

            if (formData.email !== user.email) {
                updateData.append('email', formData.email);
            }

            if (avatarFile) {
                updateData.append('avatar', avatarFile);
            }

            await pb.collection('users').update(user.id, updateData);

            setAvatarFile(null);
            addToast('success', 'Profile updated successfully');
        } catch (error: any) {
            console.error('Failed to update profile:', error);
            addToast('error', error?.message || 'Failed to update profile');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold">Profile</h2>
                <p className="text-sm text-[var(--muted)] mt-1">
                    Manage your personal information
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                    <div className="relative group">
                        <div className="w-20 h-20 rounded-full bg-[var(--primary)] flex items-center justify-center overflow-hidden border-2 border-[var(--card-border)]">
                            {avatarPreview ? (
                                <Image
                                    src={avatarPreview}
                                    alt="Avatar"
                                    fill
                                    className="object-cover"
                                />
                            ) : (
                                <User size={32} className="text-white" />
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Camera size={20} className="text-white" />
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleAvatarChange}
                            className="hidden"
                        />
                    </div>
                    <div>
                        <p className="text-sm font-medium">Profile Photo</p>
                        <p className="text-xs text-[var(--muted)]">JPG, PNG or GIF. Max 2MB.</p>
                    </div>
                </div>

                {/* Name */}
                <div className="space-y-1.5">
                    <label htmlFor="name" className="block text-sm font-medium">
                        Display Name <span className="text-[var(--error)]">*</span>
                    </label>
                    <input
                        id="name"
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        placeholder="Your name"
                        required
                        minLength={2}
                        maxLength={50}
                    />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-sm font-medium">
                        Email Address <span className="text-[var(--error)]">*</span>
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        placeholder="you@example.com"
                        required
                    />
                    <p className="text-xs text-[var(--muted)]">
                        Changing your email may require verification.
                    </p>
                </div>

                {/* Role (Read Only) */}
                <div className="space-y-1.5">
                    <label className="block text-sm font-medium">Role</label>
                    <div className="px-3 py-2 rounded-lg text-sm bg-[var(--card-hover)] border border-[var(--card-border)] capitalize">
                        {user?.role || 'Member'}
                    </div>
                </div>

                {/* Submit */}
                <div className="flex items-center gap-3 pt-4 border-t border-[var(--card-border)]">
                    <button
                        type="submit"
                        disabled={!isDirty || isLoading}
                        className="px-4 py-2 text-sm font-medium rounded-lg btn-primary disabled:opacity-50 flex items-center gap-2"
                    >
                        {isLoading && <Loader2 size={16} className="animate-spin" />}
                        Save Changes
                    </button>
                    {isDirty && (
                        <span className="text-xs text-[var(--warning)]">You have unsaved changes</span>
                    )}
                </div>
            </form>
        </div>
    );
}
