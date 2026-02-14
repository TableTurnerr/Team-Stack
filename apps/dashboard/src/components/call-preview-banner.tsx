'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, X, Loader2 } from 'lucide-react';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { cn } from '@/lib/utils';

/**
 * Floating banner that shows when a call is initiated from clicking a phone number
 * Shows call preview and allows navigation to the session page
 */
export function CallPreviewBanner() {
    const router = useRouter();
    const { callStatus, activeCallNumber, lastDialedNumber } = useZoomPhone();
    const [dismissed, setDismissed] = useState(false);

    // Show banner when a call is in progress (ringing or connected)
    const showBanner = (callStatus === 'ringing' || callStatus === 'connected') && !dismissed;
    const phoneNumber = activeCallNumber || lastDialedNumber;

    // Reset dismissed state when call ends
    useEffect(() => {
        if (callStatus === 'idle' || callStatus === 'ended') {
            setDismissed(false);
        }
    }, [callStatus]);

    if (!showBanner || !phoneNumber) return null;

    const handleBannerClick = () => {
        router.push('/session');
    };

    const handleDismiss = (e: React.MouseEvent) => {
        e.stopPropagation();
        setDismissed(true);
    };

    const statusText = callStatus === 'ringing' ? 'Ringing...' : 'Connected';
    const statusColor = callStatus === 'ringing' ? 'text-yellow-400' : 'text-green-400';

    return (
        <div
            onClick={handleBannerClick}
            className={cn(
                "fixed bottom-6 right-6 z-[997]",
                "bg-[var(--card-bg)] border-2 border-[var(--card-border)]",
                "rounded-xl shadow-2xl overflow-hidden",
                "cursor-pointer hover:border-[var(--primary)] transition-all duration-200",
                "animate-in slide-in-from-bottom-5 fade-in"
            )}
            style={{ width: '320px' }}
        >
            {/* Header */}
            <div className="bg-[var(--sidebar-bg)] px-4 py-2.5 flex items-center justify-between border-b border-[var(--card-border)]">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-full bg-blue-500/10">
                        <Phone size={14} className="text-blue-400" />
                    </div>
                    <span className="text-xs font-semibold">Active Call</span>
                </div>
                <button
                    onClick={handleDismiss}
                    className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                    title="Dismiss"
                >
                    <X size={14} />
                </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
                {/* Phone Number */}
                <div className="flex items-center justify-center">
                    <span className="text-lg font-mono font-bold tracking-tight">
                        {phoneNumber}
                    </span>
                </div>

                {/* Status */}
                <div className="flex items-center justify-center gap-2">
                    {callStatus === 'ringing' && (
                        <Loader2 size={14} className="animate-spin text-yellow-400" />
                    )}
                    {callStatus === 'connected' && (
                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    )}
                    <span className={cn("text-sm font-medium", statusColor)}>
                        {statusText}
                    </span>
                </div>

                {/* Action Hint */}
                <div className="text-center pt-1 border-t border-[var(--card-border)]">
                    <p className="text-xs text-[var(--muted)]">
                        Click to go to Call Session
                    </p>
                </div>
            </div>
        </div>
    );
}
