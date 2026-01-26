'use client';

import { useState, InputHTMLAttributes, forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    showStrength?: boolean;
    label?: string;
    error?: string;
}

function calculateStrength(password: string): { score: number; label: string; color: string } {
    let score = 0;

    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: 'var(--error)' };
    if (score <= 2) return { score: 2, label: 'Fair', color: 'var(--warning)' };
    if (score <= 3) return { score: 3, label: 'Good', color: 'var(--info)' };
    if (score <= 4) return { score: 4, label: 'Strong', color: 'var(--success)' };
    return { score: 5, label: 'Very Strong', color: 'var(--success)' };
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
    ({ className, showStrength = false, label, error, id, value, ...props }, ref) => {
        const [isVisible, setIsVisible] = useState(false);
        const inputId = id || `password-${Math.random().toString(36).slice(2)}`;

        const passwordValue = typeof value === 'string' ? value : '';
        const strength = showStrength && passwordValue ? calculateStrength(passwordValue) : null;

        return (
            <div className="space-y-1.5">
                {label && (
                    <label htmlFor={inputId} className="block text-sm font-medium">
                        {label}
                    </label>
                )}
                <div className="relative">
                    <input
                        ref={ref}
                        id={inputId}
                        type={isVisible ? 'text' : 'password'}
                        value={value}
                        className={cn(
                            'w-full px-3 py-2 pr-10 rounded-lg text-sm',
                            'border border-[var(--card-border)] bg-transparent',
                            'focus:outline-none focus:border-[var(--foreground)]',
                            'transition-colors duration-150',
                            error && 'border-[var(--error)]',
                            className
                        )}
                        {...props}
                    />
                    <button
                        type="button"
                        onClick={() => setIsVisible(!isVisible)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                        aria-label={isVisible ? 'Hide password' : 'Show password'}
                    >
                        {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                </div>

                {/* Strength indicator */}
                {strength && (
                    <div className="space-y-1">
                        <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((level) => (
                                <div
                                    key={level}
                                    className="h-1 flex-1 rounded-full transition-colors"
                                    style={{
                                        backgroundColor: level <= strength.score ? strength.color : 'var(--card-border)',
                                    }}
                                />
                            ))}
                        </div>
                        <p className="text-xs" style={{ color: strength.color }}>
                            {strength.label}
                        </p>
                    </div>
                )}

                {error && <p className="text-xs text-[var(--error)]">{error}</p>}
            </div>
        );
    }
);

PasswordInput.displayName = 'PasswordInput';
