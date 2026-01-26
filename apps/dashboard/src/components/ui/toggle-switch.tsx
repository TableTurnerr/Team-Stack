'use client';

import { cn } from '@/lib/utils';

interface ToggleSwitchProps {
    id?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: string;
    description?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
    badge?: string;
}

export function ToggleSwitch({
    id,
    checked,
    onChange,
    label,
    description,
    disabled = false,
    size = 'md',
    badge,
}: ToggleSwitchProps) {
    const switchId = id || `toggle-${Math.random().toString(36).slice(2)}`;

    const sizes = {
        sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' },
        md: { track: 'w-11 h-6', thumb: 'w-5 h-5', translate: 'translate-x-5' },
    };

    return (
        <div className="flex items-start gap-3">
            <button
                id={switchId}
                type="button"
                role="switch"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => !disabled && onChange(!checked)}
                className={cn(
                    'relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none',
                    sizes[size].track,
                    checked ? 'bg-[var(--primary)]' : 'bg-[var(--card-border)]',
                    disabled && 'opacity-50 cursor-not-allowed'
                )}
            >
                <span
                    className={cn(
                        'pointer-events-none inline-block rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out',
                        sizes[size].thumb,
                        checked ? sizes[size].translate : 'translate-x-0'
                    )}
                />
            </button>
            {(label || description) && (
                <div className="flex flex-col">
                    {label && (
                        <div className="flex items-center gap-2">
                            <label
                                htmlFor={switchId}
                                className={cn(
                                    'text-sm font-medium cursor-pointer',
                                    disabled && 'opacity-50 cursor-not-allowed'
                                )}
                            >
                                {label}
                            </label>
                            {badge && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--muted)]/20 text-[var(--muted)] font-medium">
                                    {badge}
                                </span>
                            )}
                        </div>
                    )}
                    {description && (
                        <p className="text-xs text-[var(--muted)] mt-0.5">{description}</p>
                    )}
                </div>
            )}
        </div>
    );
}
