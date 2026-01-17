'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';
import { useRouter } from 'next/navigation';

interface User {
    id: string;
    email: string;
    name: string;
    avatar?: string;
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

    // Initialize auth state from PocketBase's authStore
    useEffect(() => {
        const initAuth = () => {
            if (pb.authStore.isValid && pb.authStore.model) {
                const model = pb.authStore.model;
                setUser({
                    id: model.id,
                    email: model.email || '',
                    name: model.name || model.email?.split('@')[0] || 'User',
                    avatar: model.avatar,
                });
            } else {
                setUser(null);
            }
            setIsLoading(false);
        };

        initAuth();

        // Listen for auth state changes
        const unsubscribe = pb.authStore.onChange(() => {
            if (pb.authStore.isValid && pb.authStore.model) {
                const model = pb.authStore.model;
                setUser({
                    id: model.id,
                    email: model.email || '',
                    name: model.name || model.email?.split('@')[0] || 'User',
                    avatar: model.avatar,
                });
            } else {
                setUser(null);
            }
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const login = async (email: string, password: string) => {
        const authData = await pb.collection('users').authWithPassword(email, password);
        const model = authData.record;
        setUser({
            id: model.id,
            email: model.email || '',
            name: model.name || model.email?.split('@')[0] || 'User',
            avatar: model.avatar,
        });
    };

    const loginWithGoogle = async () => {
        console.log('Login with Google initiated');
        console.log('PB URL:', pb.baseUrl);
        try {
            const authData = await pb.collection('users').authWithOAuth2({ provider: 'google' });
            console.log('Google auth data:', authData);
            const model = authData.record;
            setUser({
                id: model.id,
                email: model.email || '',
                name: model.name || model.email?.split('@')[0] || 'User',
                avatar: model.avatar,
            });
        } catch (error) {
            console.error('Google login failed:', error);
            throw error;
        }
    };

    const logout = () => {
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
