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
    const [number, setNumber] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const appendDigit = useCallback((digit: string) => {
        setNumber(prev => prev + digit);
        inputRef.current?.focus();
    }, []);

    const handleBackspace = useCallback(() => {
        setNumber(prev => prev.slice(0, -1));
        inputRef.current?.focus();
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const cleaned = e.target.value.replace(/[^0-9+*#]/g, '');
        setNumber(cleaned);
    };

    const canDial = number.replace(/\D/g, '').length >= 3 && !disabled;

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
    };

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                Dialer
            </h3>

            {/* Number input */}
            <div className="flex items-center gap-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={number}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter number..."
                    className="flex-1 text-center text-xl font-semibold tracking-wide bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2.5 placeholder:text-[var(--muted)] placeholder:font-normal placeholder:text-base focus:outline-none focus:border-[var(--primary)] transition-colors"
                    style={{
                        caretColor: 'var(--primary)',
                        color: 'var(--foreground)',
                    }}
                    autoComplete="off"
                />
                {number && (
                    <button
                        onClick={handleBackspace}
                        className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--sidebar-bg)] transition-colors"
                        title="Delete"
                    >
                        <Delete size={18} />
                    </button>
                )}
            </div>

            {/* Keypad grid */}
            <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto">
                {DIAL_PAD.map(({ digit, letters }) => {
                    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

                    return (
                        <button
                            key={digit}
                            onClick={() => appendDigit(digit)}
                            onMouseDown={() => {
                                if (digit === '0') {
                                    longPressTimer = setTimeout(() => {
                                        setNumber(prev => prev + '+');
                                        longPressTimer = null;
                                    }, 500);
                                }
                            }}
                            onMouseUp={() => {
                                if (longPressTimer) {
                                    clearTimeout(longPressTimer);
                                    longPressTimer = null;
                                }
                            }}
                            onMouseLeave={() => {
                                if (longPressTimer) {
                                    clearTimeout(longPressTimer);
                                    longPressTimer = null;
                                }
                            }}
                            className="flex flex-col items-center justify-center w-[60px] h-[60px] mx-auto rounded-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] hover:bg-[var(--card-hover)] active:scale-95 transition-all duration-100"
                        >
                            <span className="text-lg font-semibold text-[var(--foreground)] leading-none">
                                {digit}
                            </span>
                            {letters && (
                                <span className="text-[7px] tracking-[0.15em] text-[var(--muted)] mt-0.5 font-semibold uppercase">
                                    {letters}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Call button */}
            <div className="flex justify-center pt-1">
                <button
                    onClick={handleDial}
                    disabled={!canDial}
                    className="w-14 h-14 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                        background: canDial
                            ? 'var(--success)'
                            : 'var(--card-border)',
                    }}
                    title="Call"
                >
                    <Phone size={22} className="text-white" />
                </button>
            </div>
        </div>
    );
}

/** Expose a way to clear the dialer from the parent */
export function useSessionDialerState() {
    const [dialerNumber, setDialerNumber] = useState('');
    return { dialerNumber, setDialerNumber };
}
