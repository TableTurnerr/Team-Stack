'use client';

import { useEffect, useRef } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'default';
    isLoading?: boolean;
}

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'default',
    isLoading = false,
}: ConfirmationModalProps) {
    const modalRef = useRef<HTMLDivElement>(null);
    const cancelButtonRef = useRef<HTMLButtonElement>(null);

    // Focus trap and escape key handling
    useEffect(() => {
        if (!isOpen) return;

        // Focus the cancel button when modal opens
        cancelButtonRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isLoading) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose, isLoading]);

    if (!isOpen) return null;

    const iconColors = {
        danger: 'bg-[var(--error-subtle)] text-[var(--error)]',
        warning: 'bg-[var(--warning-subtle)] text-[var(--warning)]',
        default: 'bg-[var(--info-subtle)] text-[var(--info)]',
    };

    const confirmButtonStyles = {
        danger: 'btn-danger',
        warning: 'bg-[var(--warning)] hover:bg-[var(--warning)]/90 text-white',
        default: 'btn-primary',
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => !isLoading && onClose()}
            />

            {/* Modal */}
            <div
                ref={modalRef}
                className={cn(
                    'relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl',
                    'w-full max-w-md p-6',
                    'animate-in fade-in zoom-in-95 duration-200'
                )}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    disabled={isLoading}
                    className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                    aria-label="Close"
                >
                    <X size={18} />
                </button>

                {/* Icon */}
                <div className={cn('w-12 h-12 rounded-full flex items-center justify-center mb-4', iconColors[variant])}>
                    <AlertTriangle size={24} />
                </div>

                {/* Content */}
                <h2 id="modal-title" className="text-lg font-semibold mb-2">
                    {title}
                </h2>
                <p className="text-sm text-[var(--muted)] mb-6">{message}</p>

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                    <button
                        ref={cancelButtonRef}
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-4 py-2 text-sm font-medium rounded-lg btn-ghost border border-[var(--card-border)] disabled:opacity-50"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className={cn(
                            'px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-2',
                            confirmButtonStyles[variant]
                        )}
                    >
                        {isLoading && (
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        )}
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
