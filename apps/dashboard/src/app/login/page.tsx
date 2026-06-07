'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { SignInPage } from '@/components/ui/sign-in';

export default function LoginPage() {
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login, loginWithGoogle, isAuthenticated, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();

    // Honor a ?redirect=/path param (used by the extension connect flow) so we
    // can return to where the user came from instead of always the dashboard.
    const getRedirect = () => {
        if (typeof window === 'undefined') return '/';
        const r = new URLSearchParams(window.location.search).get('redirect');
        return r && r.startsWith('/') ? r : '/';
    };

    useEffect(() => {
        if (!isAuthLoading && isAuthenticated) {
            router.push(getRedirect());
        }
    }, [isAuthLoading, isAuthenticated, router]);

    const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError('');
        setIsLoading(true);

        const formData = new FormData(event.currentTarget);
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;

        try {
            await login(email, password);
            router.push(getRedirect());
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message || 'Invalid email or password');
            } else {
                setError('Invalid email or password');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setIsLoading(true);

        try {
            await loginWithGoogle();
            router.push(getRedirect());
        } catch (err: unknown) {
            console.error('Google Sign In Error Page Log:', err);
            if (err instanceof Error) {
                setError(err.message || 'Failed to sign in with Google');
            } else {
                setError('Failed to sign in with Google');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = () => {
        // TODO: Implement password reset flow
        alert('Password reset functionality coming soon!');
    };

    const handleCreateAccount = () => {
        router.push('/register');
    };

    if (isAuthLoading || isAuthenticated) {
        return null;
    }

    return (
        <SignInPage
            title={<span className="font-light tracking-tighter">Tableturnerr <span className="font-semibold">CRM</span></span>}
            description="Sign in to access your dashboard and manage your business"
            onSignIn={handleSignIn}
            onGoogleSignIn={handleGoogleSignIn}
            onResetPassword={handleResetPassword}
            onCreateAccount={handleCreateAccount}
            isLoading={isLoading}
            error={error}
        />
    );
}
