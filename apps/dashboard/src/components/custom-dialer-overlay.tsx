'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Phone, Delete } from 'lucide-react';
import { useZoomPhone } from '@/contexts/zoom-phone-context';

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

/**
 * Custom dialer overlay — near-identical replica of Zoom's native dialer.
 * Replaces the Zoom logo area with "Custom Dialer" branding and
 * adds an explanatory note at the bottom.
 */
export function CustomDialerOverlay({ onDial, onFocusChange, visible = true }: {
    onDial: (phoneNumber: string) => void;
    onFocusChange?: (focused: boolean) => void;
    visible?: boolean;
}) {
    const { lastDialedNumber, setCustomDialerNumber } = useZoomPhone();
    const [number, setNumber] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-fill from CRM call buttons
    useEffect(() => {
        if (lastDialedNumber) {
            setNumber(lastDialedNumber);
        }
    }, [lastDialedNumber]);

    // Focus input when becoming visible
    useEffect(() => {
        if (visible) {
            inputRef.current?.focus();
        }
    }, [visible]);

    const appendDigit = useCallback((digit: string) => {
        setNumber(prev => {
            const next = prev + digit;
            // Defer context update to avoid setState-during-render
            queueMicrotask(() => setCustomDialerNumber(next));
            return next;
        });
        inputRef.current?.focus();
    }, [setCustomDialerNumber]);

    const handleBackspace = useCallback(() => {
        setNumber(prev => {
            const next = prev.slice(0, -1);
            queueMicrotask(() => setCustomDialerNumber(next));
            return next;
        });
        inputRef.current?.focus();
    }, [setCustomDialerNumber]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const cleaned = e.target.value.replace(/[^0-9+*#]/g, '');
        setNumber(cleaned);
        setCustomDialerNumber(cleaned);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && number.replace(/\D/g, '').length >= 3) {
            e.preventDefault();
            onDial(number);
        }
    };

    const handleDial = () => {
        if (number.replace(/\D/g, '').length >= 3) {
            onDial(number);
        }
    };

    const canDial = number.replace(/\D/g, '').length >= 3;

    return (
        <div className="absolute inset-0 z-10 flex flex-col bg-white">


            {/* ── Number input ── */}
            <div className="flex items-center px-5 pt-5 pb-2">
                <div className="flex items-center gap-2 flex-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={number}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => onFocusChange?.(true)}
                        onBlur={() => onFocusChange?.(false)}
                        placeholder="Enter a name or number..."
                        className="flex-1 text-center text-[22px] font-semibold tracking-wide bg-transparent placeholder:text-[#c0c0cc] placeholder:font-normal placeholder:text-[18px]"
                        style={{
                            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
                            border: 'none',
                            outline: 'none',
                            boxShadow: 'none',
                            caretColor: '#2d8cff',
                            color: '#232333',
                            fontWeight: 600,
                        }}
                        autoComplete="off"
                    />
                    {number && (
                        <button
                            onClick={handleBackspace}
                            className="p-1 rounded-full text-[#b8b8c8] hover:text-[#777] transition-colors"
                            title="Delete"
                        >
                            <Delete size={18} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── Keypad grid ── */}
            <div className="flex-1 flex items-center justify-center px-7">
                <div className="grid grid-cols-3 gap-x-5 gap-y-2.5 w-full max-w-[280px]">
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
                                className="flex flex-col items-center justify-center w-[68px] h-[68px] mx-auto rounded-full bg-[#ededf3] hover:bg-[#e2e2ea] active:bg-[#d6d6e0] transition-colors duration-100"
                            >
                                <span
                                    className="text-[22px] font-semibold text-[#232333] leading-none"
                                    style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
                                >
                                    {digit}
                                </span>
                                {letters && (
                                    <span className="text-[8px] tracking-[0.2em] text-[#8a8a9a] mt-0.5 font-semibold uppercase">
                                        {letters}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Dial button ── */}
            <div className="flex justify-center pt-1 pb-2">
                <button
                    onClick={handleDial}
                    disabled={!canDial}
                    className="w-[56px] h-[56px] rounded-full flex items-center justify-center transition-all duration-150 active:scale-90"
                    style={{
                        background: canDial ? '#2d8cff' : '#d3d3dd',
                        cursor: canDial ? 'pointer' : 'not-allowed',
                    }}
                    title="Dial"
                >
                    <Phone size={22} className="text-white" />
                </button>
            </div>

            {/* ── Bottom note ── */}
            <div className="px-5 pb-6 pt-1 text-center">
                <p className="text-[11px] leading-tight text-[#a0a0b0]"
                    style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
                >
                    Custom dialer is used to capture phone numbers for call recordings.
                    Numbers entered here are sent to Zoom for dialing.
                </p>
            </div>
        </div>
    );
}
