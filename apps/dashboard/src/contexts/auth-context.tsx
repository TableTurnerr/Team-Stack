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
    discord_user_id?: string;
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
const TOKEN_REFRESH_INTERVAL_MS = 5 * 60_000; // Refresh JWT every 5 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tokenRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

    // ── Token refresh: keep JWT alive ──
    const refreshToken = async () => {
        if (!pb.authStore.isValid) return false;
        try {
            await pb.collection('users').authRefresh();
            return true;
        } catch {
            // Token is expired/invalid — force logout
            pb.authStore.clear();
            setUser(null);
            stopHeartbeat();
            return false;
        }
    };

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

        // Periodic token refresh to prevent JWT expiry
        tokenRefreshRef.current = setInterval(refreshToken, TOKEN_REFRESH_INTERVAL_MS);
    };

    const stopHeartbeat = () => {
        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }
        if (tokenRefreshRef.current) {
            clearInterval(tokenRefreshRef.current);
            tokenRefreshRef.current = null;
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

    // ── visibilitychange: refresh token + update last_activity when tab becomes visible ──
    useEffect(() => {
        const handleVisibility = async () => {
            const currentUser = userRef.current;
            if (!currentUser?.id) return;
            if (document.visibilityState === 'visible') {
                // Refresh token first — it may have expired while tab was hidden
                const tokenValid = await refreshToken();
                if (!tokenValid) return;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Initialize auth state from PocketBase's authStore
    useEffect(() => {
        const initAuth = async () => {
            if (pb.authStore.isValid && pb.authStore.model) {
                try {
                    // Refresh the token on init to get a fresh JWT + latest user data
                    const authData = await pb.collection('users').authRefresh();
                    const mapped = mapUser(authData.record);
                    setUser(mapped);
                    startHeartbeat(mapped.id);
                } catch (error) {
                    console.error('Failed to refresh auth on init:', error);
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

            const isNewUser = !model.role;
            if (isNewUser) {
                updates.role = 'member';
            }

            await pb.collection('users').update(model.id, updates);

            if (isNewUser) {
                try {
                    const defaultRoles = await pb.collection('roles').getFullList<{ id: string; members?: string[] }>({
                        filter: 'is_default = true',
                    });
                    await Promise.all(
                        defaultRoles.map(r =>
                            pb.collection('roles').update(r.id, {
                                members: Array.from(new Set([...(r.members || []), model.id])),
                            })
                        )
                    );
                } catch (e) {
                    console.warn('Failed to auto-assign default role(s):', e);
                }
            }

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
            const created = await pb.collection('users').create<{ id: string }>({
                name,
                email,
                password,
                passwordConfirm,
                role: 'member',
                status: 'offline',
            });

            // Auto-add the new user to every role flagged is_default.
            try {
                const defaultRoles = await pb.collection('roles').getFullList<{ id: string; members?: string[] }>({
                    filter: 'is_default = true',
                });
                await Promise.all(
                    defaultRoles.map(r =>
                        pb.collection('roles').update(r.id, {
                            members: Array.from(new Set([...(r.members || []), created.id])),
                        })
                    )
                );
            } catch (e) {
                console.warn('Failed to auto-assign default role(s):', e);
            }

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

            const isNewUser = !model.role;
            if (isNewUser) {
                updates.role = 'member';
            }

            await pb.collection('users').update(model.id, updates);

            if (isNewUser) {
                try {
                    const defaultRoles = await pb.collection('roles').getFullList<{ id: string; members?: string[] }>({
                        filter: 'is_default = true',
                    });
                    await Promise.all(
                        defaultRoles.map(r =>
                            pb.collection('roles').update(r.id, {
                                members: Array.from(new Set([...(r.members || []), model.id])),
                            })
                        )
                    );
                } catch (e) {
                    console.warn('Failed to auto-assign default role(s):', e);
                }
            }

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
        if (user?.id && pb.authStore.isValid) {
            try {
                await pb.collection('users').update(user.id, {
                    status: 'offline',
                    last_activity: new Date().toISOString()
                });
            } catch (error) {
                console.warn('Failed to update logout status (continuing anyway):', error);
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
