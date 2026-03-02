'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';
import { useRouter } from 'next/navigation';

interface User {
    id: string;
    email: string;
    name: string;
    avatar?: string;
    role: 'admin' | 'member';
    status: 'online' | 'offline' | 'suspended';
    last_activity?: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    register: (name: string, email: string, password: string, passwordConfirm: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Returns true if the user has been active within the last 90 seconds */
export function isUserOnline(user: { status: string; last_activity?: string }): boolean {
    if (user.status === 'suspended') return false;
    if (!user.last_activity) return user.status === 'online';
    return Date.now() - new Date(user.last_activity).getTime() < 90_000;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const userRef = useRef<User | null>(null);

    // Keep userRef in sync so event handlers always see the latest user
    useEffect(() => {
        userRef.current = user;
    }, [user]);

    // Helper to extract user data from PB model
    const mapUser = (model: any): User => ({
        id: model.id,
        email: model.email || '',
        name: model.name || model.email?.split('@')[0] || 'User',
        avatar: model.avatar ? pb.files.getUrl(model, model.avatar) : undefined,
        role: model.role || 'member',
        status: model.status || 'offline',
        last_activity: model.last_activity,
    });

    // ── Heartbeat: update last_activity every 30s ──
    const startHeartbeat = (userId: string) => {
        stopHeartbeat();
        heartbeatRef.current = setInterval(async () => {
            try {
                await pb.collection('users').update(userId, {
                    last_activity: new Date().toISOString(),
                });
            } catch {
                // silently ignore — network blip
            }
        }, HEARTBEAT_INTERVAL_MS);
    };

    const stopHeartbeat = () => {
        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }
    };

    // ── beforeunload: mark offline via sendBeacon so it survives tab close ──
    useEffect(() => {
        const handleUnload = () => {
            const currentUser = userRef.current;
            if (!currentUser?.id) return;
            const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
            if (!pbUrl) return;

            // sendBeacon is fire-and-forget and survives page unload
            const payload = JSON.stringify({
                status: 'offline',
                last_activity: new Date().toISOString(),
            });
            navigator.sendBeacon(
                `${pbUrl}/api/collections/users/records/${currentUser.id}`,
                new Blob([payload], { type: 'application/json' })
            );
        };

        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);

    // ── visibilitychange: update last_activity when tab becomes visible again ──
    useEffect(() => {
        const handleVisibility = async () => {
            const currentUser = userRef.current;
            if (!currentUser?.id) return;
            if (document.visibilityState === 'visible') {
                try {
                    await pb.collection('users').update(currentUser.id, {
                        status: 'online',
                        last_activity: new Date().toISOString(),
                    });
                } catch { /* ignore */ }
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

    // Initialize auth state from PocketBase's authStore
    useEffect(() => {
        const initAuth = async () => {
            if (pb.authStore.isValid && pb.authStore.model) {
                try {
                    // Refresh user data from server to get latest role and status
                    const freshUser = await pb.collection('users').getOne(pb.authStore.model.id);
                    const mapped = mapUser(freshUser);
                    setUser(mapped);
                    startHeartbeat(mapped.id);
                } catch (error) {
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
                    const freshUser = await pb.collection('users').getOne(pb.authStore.model.id);
                    const mapped = mapUser(freshUser);
                    setUser(mapped);
                    startHeartbeat(mapped.id);
                } catch (error) {
                    console.error('Failed to refresh user on auth change:', error);
                    const mapped = mapUser(pb.authStore.model);
                    setUser(mapped);
                    startHeartbeat(mapped.id);
                }
            } else {
                setUser(null);
                stopHeartbeat();
            }
        });

        return () => {
            unsubscribe();
            stopHeartbeat();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const login = async (email: string, password: string) => {
        try {
            const authData = await pb.collection('users').authWithPassword(email, password);
            const model = authData.record;

            if (model.status === 'suspended') {
                pb.authStore.clear();
                throw new Error('Your account has been suspended.');
            }

            const updates: any = {
                status: 'online',
                last_activity: new Date().toISOString()
            };

            if (!model.role) {
                updates.role = 'member';
            }

            await pb.collection('users').update(model.id, updates);

            const updatedRecord = await pb.collection('users').getOne(model.id);
            const mapped = mapUser(updatedRecord);
            setUser(mapped);
            startHeartbeat(mapped.id);
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    };

    const register = async (name: string, email: string, password: string, passwordConfirm: string) => {
        try {
            await pb.collection('users').create({
                name,
                email,
                password,
                passwordConfirm,
                role: 'member',
                status: 'offline',
            });
            await login(email, password);
        } catch (error) {
            console.error('Registration failed:', error);
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

            const updates: any = {
                status: 'online',
                last_activity: new Date().toISOString()
            };

            if (!model.role) {
                updates.role = 'member';
            }

            await pb.collection('users').update(model.id, updates);

            const updatedRecord = await pb.collection('users').getOne(model.id);
            const mapped = mapUser(updatedRecord);
            setUser(mapped);
            startHeartbeat(mapped.id);
        } catch (error) {
            console.error('Google login failed:', error);
            throw error;
        }
    };

    const logout = async () => {
        stopHeartbeat();
        if (user?.id) {
            try {
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
                register,
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
