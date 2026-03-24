'use client';

import { Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useZoomPhoneOptional } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { useSession } from '@/contexts/session-context';

/**
 * Strips a phone number string down to digits (preserving leading +).
 * e.g. "+1 (917) 675-6338" → "+19176756338"
 *      "1234567890 (Branch)" → "1234567890"
 */
export function cleanPhoneForUri(raw: string): string {
    // Take only the part before any parenthesized label like "(Branch)"
    const beforeParen = raw.split('(')[0].trim();
    // Keep leading + if present, strip everything else that isn't a digit
    const hasPlus = beforeParen.startsWith('+');
    const digits = beforeParen.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
}

/**
 * Extracts the first phone number from a comma-separated string.
 * e.g. "1234567890, 9876543210 (Branch)" → "1234567890"
 */
export function extractFirstPhone(phoneNumbers: string): string {
    const first = phoneNumbers.split(',')[0].trim();
    return first;
}

interface ZoomCallButtonProps {
    phoneNumber: string;
    size?: 'sm' | 'md';
    className?: string;
}

/**
 * A small clickable phone icon that initiates a Zoom Phone call.
 * Checks for screen share before allowing the call.
 * If no session is active, starts standalone mode.
 */
export function ZoomCallButton({
    phoneNumber,
    size = 'sm',
    className
}: ZoomCallButtonProps) {
    const router = useRouter();
    const zoomPhone = useZoomPhoneOptional();
    const { isSessionActive } = useCallRecording();
    const { session, setStandaloneMode } = useSession();
    const cleaned = cleanPhoneForUri(phoneNumber);

    if (!cleaned || cleaned.length < 7) return null;

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Check if screen share is active (recording session started)
        if (!isSessionActive) {
            // Show alert asking user to start screen share first
            const shouldNavigate = window.confirm(
                'Screen sharing is required to make and record calls.\n\n' +
                'Click OK to go to the Call Session page and start screen sharing.'
            );

            if (shouldNavigate) {
                router.push('/session');
            }
            return;
        }

        // If no active session, enable standalone mode
        if (!session) {
            setStandaloneMode(true);
        }

        // Initiate the call
        if (zoomPhone) {
            zoomPhone.dialNumber(cleaned);
        }

        // Navigate to session page to show the call
        router.push('/session');
    };

    const iconSize = size === 'sm' ? 13 : 16;

    return (
        <button
            onClick={handleClick}
            className={cn(
                "inline-flex items-center justify-center rounded-md transition-all duration-200",
                "text-[var(--muted)] hover:text-blue-400 hover:bg-blue-500/10",
                "border border-transparent hover:border-blue-500/20",
                size === 'sm' ? "p-1" : "p-1.5",
                className
            )}
            title="Call via Zoom Phone"
        >
            <Phone size={iconSize} />
        </button>
    );
}
