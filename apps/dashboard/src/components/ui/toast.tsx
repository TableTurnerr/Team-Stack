'use client';

import { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
}

interface ToastContextType {
    toasts: Toast[];
    addToast: (type: ToastType, message: string, duration?: number) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setToasts((prev) => [...prev, { id, type, message, duration }]);
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

const TOAST_ICONS = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
};

const TOAST_STYLES = {
    success: 'bg-[var(--success-subtle)] border-[var(--success)] text-[var(--success)]',
    error: 'bg-[var(--error-subtle)] border-[var(--error)] text-[var(--error)]',
    warning: 'bg-[var(--warning-subtle)] border-[var(--warning)] text-[var(--warning)]',
    info: 'bg-[var(--info-subtle)] border-[var(--info)] text-[var(--info)]',
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
    const [isVisible, setIsVisible] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);
    const Icon = TOAST_ICONS[toast.type];

    useEffect(() => {
        // Trigger enter animation
        requestAnimationFrame(() => setIsVisible(true));

        // Auto dismiss
        if (toast.duration && toast.duration > 0) {
            const timer = setTimeout(() => {
                setIsLeaving(true);
                setTimeout(onRemove, 200);
            }, toast.duration);
            return () => clearTimeout(timer);
        }
    }, [toast.duration, onRemove]);

    const handleClose = () => {
        setIsLeaving(true);
        setTimeout(onRemove, 200);
    };

    return (
        <div
            className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm',
                'transition-all duration-200 ease-out',
                TOAST_STYLES[toast.type],
                isVisible && !isLeaving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            )}
            role="alert"
        >
            <Icon size={18} className="shrink-0" />
            <p className="text-sm font-medium text-[var(--foreground)] flex-1">{toast.message}</p>
            <button
                onClick={handleClose}
                className="p-1 rounded hover:bg-[var(--card-hover)] transition-colors"
                aria-label="Dismiss"
            >
                <X size={14} />
            </button>
        </div>
    );
}

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                    <ToastItem toast={toast} onRemove={() => removeToast(toast.id)} />
                </div>
            ))}
        </div>
    );
}
