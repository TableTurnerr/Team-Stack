'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { SignUpPage } from '@/components/ui/sign-up';

export default function RegisterPage() {
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { register, loginWithGoogle, isAuthenticated, isLoading: isAuthLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!isAuthLoading && isAuthenticated) {
            router.push('/');
        }
    }, [isAuthLoading, isAuthenticated, router]);

    const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError('');

        const formData = new FormData(event.currentTarget);
        const name = formData.get('name') as string;
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;
        const passwordConfirm = formData.get('passwordConfirm') as string;

        if (password !== passwordConfirm) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setIsLoading(true);

        try {
            await register(name, email, password, passwordConfirm);
            router.push('/');
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message || 'Failed to create account');
            } else {
                setError('Failed to create account');
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
            router.push('/');
        } catch (err: unknown) {
            if (err instanceof Error) {
                setError(err.message || 'Failed to sign in with Google');
            } else {
                setError('Failed to sign in with Google');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignIn = () => {
        router.push('/login');
    };

    if (isAuthLoading || isAuthenticated) {
        return null;
    }

    return (
        <SignUpPage
            title={<span className="font-light tracking-tighter">Tableturnerr <span className="font-semibold">CRM</span></span>}
            description="Create your account to get started"
            onSignUp={handleSignUp}
            onGoogleSignIn={handleGoogleSignIn}
            onSignIn={handleSignIn}
            isLoading={isLoading}
            error={error}
        />
    );
}
