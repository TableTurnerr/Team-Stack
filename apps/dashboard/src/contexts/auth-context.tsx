'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';
import { useRouter } from 'next/navigation';

interface User {
    id: string;
    email: string;
    name: string;
    avatar?: string;
    role: 'admin' | 'member';
    status: 'online' | 'offline' | 'suspended';
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    // Helper to extract user data from PB model
    const mapUser = (model: any): User => ({
        id: model.id,
        email: model.email || '',
        name: model.name || model.email?.split('@')[0] || 'User',
        avatar: model.avatar ? pb.files.getUrl(model, model.avatar) : undefined,
        role: model.role || 'member',
        status: model.status || 'offline'
    });

    // Initialize auth state from PocketBase's authStore
    useEffect(() => {
        const initAuth = async () => {
            if (pb.authStore.isValid && pb.authStore.model) {
                try {
                    // Refresh user data from server to get latest role and status
                    // This ensures admin features persist across new tabs/page refreshes
                    const freshUser = await pb.collection('users').getOne(pb.authStore.model.id);
                    setUser(mapUser(freshUser));
                } catch (error) {
                    // If refresh fails (e.g., token expired), clear auth state
                    console.error('Failed to refresh user data:', error);
                    pb.authStore.clear();
                    setUser(null);
                }
            } else {
                setUser(null);
            }
            setIsLoading(false);
        };

        initAuth();

        // Listen for auth state changes
        const unsubscribe = pb.authStore.onChange(async () => {
            if (pb.authStore.isValid && pb.authStore.model) {
                try {
                    // Refresh user data on auth changes to ensure role is current
                    const freshUser = await pb.collection('users').getOne(pb.authStore.model.id);
                    setUser(mapUser(freshUser));
                } catch (error) {
                    console.error('Failed to refresh user on auth change:', error);
                    setUser(mapUser(pb.authStore.model));
                }
            } else {
                setUser(null);
            }
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const login = async (email: string, password: string) => {
        try {
            const authData = await pb.collection('users').authWithPassword(email, password);
            const model = authData.record;

            if (model.status === 'suspended') {
                pb.authStore.clear();
                throw new Error('Your account has been suspended.');
            }

            // Update status and role if missing
            const updates: any = {
                status: 'online',
                last_activity: new Date().toISOString()
            };

            // Should not happen for password auth if seeded correctly, but good for safety
            if (!model.role) {
                updates.role = 'member';
            }

            await pb.collection('users').update(model.id, updates);

            // Refresh model to get updated role
            const updatedRecord = await pb.collection('users').getOne(model.id);
            setUser(mapUser(updatedRecord));
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    };

    const loginWithGoogle = async () => {
        try {
            const authData = await pb.collection('users').authWithOAuth2({ provider: 'google' });
            const model = authData.record;

            if (model.status === 'suspended') {
                pb.authStore.clear();
                throw new Error('Your account has been suspended.');
            }

            // Update status and default role for new users
            const updates: any = {
                status: 'online',
                last_activity: new Date().toISOString()
            };

            // Set default role for new OAuth users
            if (!model.role) {
                updates.role = 'member';
            }

            await pb.collection('users').update(model.id, updates);

            // Refresh model to get updated role/status
            const updatedRecord = await pb.collection('users').getOne(model.id);
            setUser(mapUser(updatedRecord));
        } catch (error) {
            console.error('Google login failed:', error);
            throw error;
        }
    };

    const logout = async () => {
        if (user?.id) {
            try {
                // Update status to offline
                await pb.collection('users').update(user.id, {
                    status: 'offline',
                    last_activity: new Date().toISOString()
                });
            } catch (error) {
                console.error('Failed to update logout status:', error);
            }
        }

        pb.authStore.clear();
        setUser(null);
        router.push('/login');
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                login,
                loginWithGoogle,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
