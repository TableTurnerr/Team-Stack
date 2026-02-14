'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Phone, Delete } from 'lucide-react';

const DIAL_PAD: { digit: string; letters: string }[] = [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'ABC' },
    { digit: '3', letters: 'DEF' },
    { digit: '4', letters: 'GHI' },
    { digit: '5', letters: 'JKL' },
    { digit: '6', letters: 'MNO' },
    { digit: '7', letters: 'PQRS' },
    { digit: '8', letters: 'TUV' },
    { digit: '9', letters: 'WXYZ' },
    { digit: '*', letters: '' },
    { digit: '0', letters: '+' },
    { digit: '#', letters: '' },
];

interface SessionDialerProps {
    onDial: (phoneNumber: string) => void;
    disabled?: boolean;
}

/**
 * Inline dark-themed dialer for the session page.
 * Adapted from CustomDialerOverlay but styled for inline use with dark theme.
 */
export function SessionDialer({ onDial, disabled }: SessionDialerProps) {
    const [number, setNumber] = useState('+1');
    const [showKeypad, setShowKeypad] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const appendDigit = useCallback((digit: string) => {
        setNumber(prev => {
            // If somehow empty or just '+' (shouldn't happen with strict enforcement but safe to handle), reset
            if (!prev || prev === '+') return '+1' + digit;
            return prev + digit;
        });
        inputRef.current?.focus();
    }, []);

    const handleBackspace = useCallback(() => {
        setNumber(prev => {
            if (prev.length <= 2) return '+1'; // Don't delete +1
            return prev.slice(0, -1);
        });
        inputRef.current?.focus();
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;

        // Strip everything non-numeric
        let digits = val.replace(/\D/g, '');

        // Handling:
        // 1. "1203..." -> clean "1203..." -> +1203...
        // 2. "203..." -> clean "203..." -> prepend 1 -> 1203... -> +1203...
        // 3. "11203..." (double 1 from paste) -> replace leading 1s with single 1 -> 1203... -> +1203...

        // Collapse multiple leading 1s into a single 1
        digits = digits.replace(/^1+/, '1');

        // Ensure it starts with 1
        if (!digits.startsWith('1')) {
            digits = '1' + digits;
        }

        setNumber('+' + digits);
    };

    // Valid US number: +1 + 10 digits = 12 chars
    const canDial = number.length === 12 && number.startsWith('+1') && !disabled;

    const handleDial = () => {
        if (canDial) {
            onDial(number);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && canDial) {
            e.preventDefault();
            handleDial();
        }
        // Prevent deleting the +1 with backspace if specifically targeting it?
        // handleBackspace logic covers it via state update, but standard backspace in input might fight it.
        // We'll rely on handleInputChange to fix it up.
    };

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Dialer
                </h3>
                <button
                    onClick={() => setShowKeypad(!showKeypad)}
                    className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] px-2 py-1 rounded hover:bg-[var(--sidebar-bg)] transition-colors"
                >
                    {showKeypad ? 'Hide' : 'Show'} Keypad
                </button>
            </div>

            {/* Number input with inline dial button */}
            <div className="flex items-center gap-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={number}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter number..."
                    className="flex-1 text-center text-lg font-semibold tracking-wide bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 placeholder:text-[var(--muted)] placeholder:font-normal placeholder:text-base focus:outline-none focus:border-[var(--primary)] transition-colors"
                    style={{
                        caretColor: 'var(--primary)',
                        color: 'var(--foreground)',
                    }}
                    autoComplete="off"
                />
                {number.length > 2 && (
                    <button
                        onClick={handleBackspace}
                        className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-bg)] transition-colors"
                        title="Delete"
                    >
                        <Delete size={16} />
                    </button>
                )}
                <button
                    onClick={handleDial}
                    disabled={!canDial}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                        background: canDial
                            ? 'var(--success)'
                            : 'var(--card-border)',
                    }}
                    title="Call"
                >
                    <Phone size={18} className="text-white" />
                </button>
            </div>

            {/* Collapsible Keypad grid */}
            {showKeypad && (
                <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto pt-2">
                    {DIAL_PAD.map(({ digit, letters }) => (
                        <button
                            key={digit}
                            onClick={() => appendDigit(digit)}
                            className="flex flex-col items-center justify-center w-[52px] h-[52px] mx-auto rounded-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)] active:scale-95 transition-all duration-100"
                        >
                            <span className="text-base font-semibold text-[var(--foreground)] leading-none">
                                {digit}
                            </span>
                            {letters && (
                                <span className="text-[6px] tracking-[0.15em] text-[var(--muted)] mt-0.5 font-semibold uppercase">
                                    {letters}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Expose a way to clear the dialer from the parent */
export function useSessionDialerState() {
    const [dialerNumber, setDialerNumber] = useState('');
    return { dialerNumber, setDialerNumber };
}
