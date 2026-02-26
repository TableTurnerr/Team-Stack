'use client'

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Eye, EyeOff, Zap } from 'lucide-react';

// Dynamically import shader to avoid SSR issues
const DotScreenShader = dynamic(
    () => import('./dot-shader-background').then(mod => mod.DotScreenShader),
    { ssr: false }
);

// --- TYPE DEFINITIONS ---

interface SignUpPageProps {
    title?: React.ReactNode;
    description?: React.ReactNode;
    onSignUp?: (event: React.FormEvent<HTMLFormElement>) => void;
    onGoogleSignIn?: () => void;
    onSignIn?: () => void;
    isLoading?: boolean;
    error?: string;
}

// --- HELPER COMPONENTS ---

const GlassInputWrapper = ({ children }: { children: React.ReactNode }) => (
    <div className="mt-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--foreground)]/5 backdrop-blur-sm transition-all duration-200 focus-within:border-[var(--foreground)]/40 focus-within:bg-[var(--foreground)]/10">
        {children}
    </div>
);

const GoogleIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
    </svg>
);

// --- MAIN COMPONENT ---

export const SignUpPage: React.FC<SignUpPageProps> = ({
    title = <span className="text-[var(--foreground)]">Create Account</span>,
    description = "Join us today and start managing your business",
    onSignUp,
    onGoogleSignIn,
    onSignIn,
    isLoading = false,
    error,
}) => {
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    return (
        <div className="min-h-[100dvh] flex flex-col lg:flex-row w-full overflow-hidden">
            {/* Left column: sign-up form */}
            <section className="flex-1 flex items-center justify-center px-6 py-12 sm:px-8 lg:px-12 bg-[var(--background)]">
                <div className="w-full max-w-[420px]">
                    {/* Logo/Brand */}
                    <div className="animate-element animate-delay-100 flex items-center gap-3 mb-8">
                        <div className="w-10 h-10 rounded-xl bg-[var(--foreground)] flex items-center justify-center">
                            <Zap size={20} className="text-[var(--background)]" />
                        </div>
                    </div>

                    {/* Header */}
                    <div className="mb-8">
                        <h1 className="animate-element animate-delay-100 text-3xl sm:text-4xl font-semibold leading-tight tracking-tight">
                            {title}
                        </h1>
                        <p className="animate-element animate-delay-200 text-[var(--muted)] mt-2 text-base">
                            {description}
                        </p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="animate-element mb-6 p-4 rounded-xl bg-[var(--error-subtle)] border border-[var(--error)]/20 text-[var(--error)] text-sm">
                            {error}
                        </div>
                    )}

                    {/* Form */}
                    <form className="space-y-5" onSubmit={onSignUp}>
                        <div className="animate-element animate-delay-300">
                            <label htmlFor="name" className="block text-sm font-medium text-[var(--foreground)]">
                                Full Name
                            </label>
                            <GlassInputWrapper>
                                <input
                                    id="name"
                                    name="name"
                                    type="text"
                                    placeholder="John Doe"
                                    autoComplete="name"
                                    className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--muted)]"
                                    required
                                />
                            </GlassInputWrapper>
                        </div>

                        <div className="animate-element animate-delay-400">
                            <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)]">
                                Email Address
                            </label>
                            <GlassInputWrapper>
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    className="w-full bg-transparent text-sm px-4 py-3.5 rounded-xl focus:outline-none placeholder:text-[var(--muted)]"
                                    required
                                />
                            </GlassInputWrapper>
                        </div>

                        <div className="animate-element animate-delay-500">
                            <label htmlFor="password" className="block text-sm font-medium text-[var(--foreground)]">
                                Password
                            </label>
                            <GlassInputWrapper>
                                <div className="relative">
                                    <input
                                        id="password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="Create a password"
                                        autoComplete="new-password"
                                        className="w-full bg-transparent text-sm px-4 py-3.5 pr-12 rounded-xl focus:outline-none placeholder:text-[var(--muted)]"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 px-4 flex items-center hover:bg-[var(--foreground)]/5 rounded-r-xl transition-colors"
                                        tabIndex={-1}
                                    >
                                        {showPassword
                                            ? <EyeOff className="w-4 h-4 text-[var(--muted)]" />
                                            : <Eye className="w-4 h-4 text-[var(--muted)]" />
                                        }
                                    </button>
                                </div>
                            </GlassInputWrapper>
                        </div>

                        <div className="animate-element animate-delay-600">
                            <label htmlFor="passwordConfirm" className="block text-sm font-medium text-[var(--foreground)]">
                                Confirm Password
                            </label>
                            <GlassInputWrapper>
                                <div className="relative">
                                    <input
                                        id="passwordConfirm"
                                        name="passwordConfirm"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        placeholder="Confirm your password"
                                        autoComplete="new-password"
                                        className="w-full bg-transparent text-sm px-4 py-3.5 pr-12 rounded-xl focus:outline-none placeholder:text-[var(--muted)]"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute inset-y-0 right-0 px-4 flex items-center hover:bg-[var(--foreground)]/5 rounded-r-xl transition-colors"
                                        tabIndex={-1}
                                    >
                                        {showConfirmPassword
                                            ? <EyeOff className="w-4 h-4 text-[var(--muted)]" />
                                            : <Eye className="w-4 h-4 text-[var(--muted)]" />
                                        }
                                    </button>
                                </div>
                            </GlassInputWrapper>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="animate-element animate-delay-700 w-full rounded-xl bg-[var(--foreground)] py-3.5 font-medium text-[var(--background)] hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] cursor-pointer"
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Creating account...
                                </span>
                            ) : 'Create Account'}
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="animate-element animate-delay-800 relative flex items-center my-6">
                        <span className="flex-1 border-t border-[var(--card-border)]"></span>
                        <span className="px-4 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Or</span>
                        <span className="flex-1 border-t border-[var(--card-border)]"></span>
                    </div>

                    {/* Google Button */}
                    <button
                        type="button"
                        onClick={onGoogleSignIn}
                        disabled={isLoading}
                        className="animate-element animate-delay-900 w-full flex items-center justify-center gap-3 border border-[var(--card-border)] rounded-xl py-3.5 font-medium hover:bg-[var(--card-hover)] hover:border-[var(--muted)]/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] cursor-pointer"
                    >
                        <GoogleIcon />
                        <span>Continue with Google</span>
                    </button>

                    {/* Sign in link */}
                    <p className="animate-element animate-delay-900 text-center text-sm text-[var(--muted)] mt-8">
                        Already have an account?{' '}
                        <button
                            type="button"
                            onClick={onSignIn}
                            className="text-[var(--foreground)] hover:text-[var(--muted)] font-medium transition-colors underline underline-offset-2 cursor-pointer"
                        >
                            Sign in
                        </button>
                    </p>
                </div>
            </section>

            {/* Right column: animated shader background */}
            <section className="hidden lg:block lg:flex-1 relative m-3">
                <div className="animate-slide-right animate-delay-300 absolute inset-0 rounded-2xl overflow-hidden">
                    <DotScreenShader />
                </div>
            </section>
        </div>
    );
};

export default SignUpPage;
