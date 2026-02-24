'use client';

import { useState } from 'react';
import { Zap, ChevronDown, ChevronUp, Play, Pause, Square, Check, RotateCcw } from 'lucide-react';

interface PowerDialerPanelProps {
    queue: string[];
    currentIndex: number;
    active: boolean;
    paused: boolean;
    delay: number; // seconds, negative = start next call before submitting current form
    onStart: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onDelayChange: (delay: number) => void;
    onQueueLoad: (numbers: string[]) => void;
    disabled?: boolean;
    canStart?: boolean;
}

function parsePhoneNumbers(input: string): string[] {
    return input
        .split(/[\n,;]+/)
        .map(s => s.trim())
        .filter(s => s.replace(/\D/g, '').length >= 7);
}

function formatDelay(d: number): string {
    if (d === 0) return 'Immediate';
    if (d < 0) return `${Math.abs(d)}s early`;
    return `+${d}s`;
}

export function PowerDialerPanel({
    queue,
    currentIndex,
    active,
    paused,
    delay,
    onStart,
    onPause,
    onResume,
    onStop,
    onDelayChange,
    onQueueLoad,
    disabled = false,
    canStart = true,
}: PowerDialerPanelProps) {
    const [expanded, setExpanded] = useState(true);
    const [inputMode, setInputMode] = useState(queue.length === 0);
    const [rawInput, setRawInput] = useState('');
    const [parsedPreview, setParsedPreview] = useState<string[]>([]);

    const remaining = Math.max(0, queue.length - currentIndex);
    const isComplete = queue.length > 0 && currentIndex >= queue.length;

    const handleParseInput = () => {
        const numbers = parsePhoneNumbers(rawInput);
        setParsedPreview(numbers);
    };

    const handleLoadQueue = () => {
        const numbers = parsePhoneNumbers(rawInput);
        if (numbers.length > 0) {
            onQueueLoad(numbers);
            setInputMode(false);
            setRawInput('');
            setParsedPreview([]);
        }
    };

    const handleNewList = () => {
        onStop();
        setInputMode(true);
        setParsedPreview([]);
    };

    const delayColorClass =
        delay < 0 ? 'text-[var(--warning)]' :
        delay === 0 ? 'text-[var(--success)]' :
        'text-[var(--muted)]';

    return (
        <div className={`bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden transition-opacity ${disabled ? 'opacity-60' : ''}`}>
            {/* Header — always visible */}
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-[var(--card-hover)] transition-colors"
                onClick={() => setExpanded(e => !e)}
            >
                <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        active && !paused ? 'bg-[var(--success-subtle)]' :
                        paused ? 'bg-[var(--warning-subtle)]' :
                        'bg-[var(--sidebar-bg)]'
                    }`}>
                        <Zap size={15} className={
                            active && !paused ? 'text-[var(--success)]' :
                            paused ? 'text-[var(--warning)]' :
                            'text-[var(--muted)]'
                        } />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">Power Dialer</span>
                            {active && !paused && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--success-subtle)] text-[var(--success)] uppercase tracking-wider">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                                    Active
                                </span>
                            )}
                            {paused && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--warning-subtle)] text-[var(--warning)] uppercase tracking-wider">
                                    Paused
                                </span>
                            )}
                            {isComplete && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border border-[var(--card-border)] text-[var(--muted)] uppercase tracking-wider">
                                    <Check size={9} /> Done
                                </span>
                            )}
                        </div>
                        {queue.length > 0 && !isComplete && (
                            <p className="text-[11px] text-[var(--muted)] mt-0.5">
                                {currentIndex} of {queue.length} called &middot; {remaining} remaining
                            </p>
                        )}
                        {isComplete && (
                            <p className="text-[11px] text-[var(--muted)] mt-0.5">All {queue.length} calls completed</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {/* Quick controls when collapsed */}
                    {!expanded && active && !paused && (
                        <button
                            onClick={e => { e.stopPropagation(); onPause(); }}
                            disabled={disabled}
                            className="p-1.5 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] hover:bg-[var(--warning)] hover:text-white transition-all disabled:opacity-50"
                            title="Pause Power Dialer"
                        >
                            <Pause size={13} />
                        </button>
                    )}
                    {!expanded && paused && (
                        <button
                            onClick={e => { e.stopPropagation(); onResume(); }}
                            disabled={disabled}
                            className="p-1.5 rounded-lg bg-[var(--success-subtle)] text-[var(--success)] hover:bg-[var(--success)] hover:text-white transition-all disabled:opacity-50"
                            title="Resume Power Dialer"
                        >
                            <Play size={13} />
                        </button>
                    )}
                    {expanded
                        ? <ChevronUp size={15} className="text-[var(--muted)]" />
                        : <ChevronDown size={15} className="text-[var(--muted)]" />
                    }
                </div>
            </div>

            {/* Body */}
            {expanded && (
                <div className="border-t border-[var(--card-border)] p-4 space-y-4">

                    {/* ── INPUT MODE ── */}
                    {inputMode ? (
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                                    Paste Phone Numbers
                                </label>
                                <textarea
                                    value={rawInput}
                                    onChange={e => { setRawInput(e.target.value); setParsedPreview([]); }}
                                    placeholder={`One per line:\n+1 (555) 123-4567\n+1 (555) 987-6543\n5551112222`}
                                    rows={5}
                                    className="w-full p-3 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 placeholder:text-[var(--muted)]/40"
                                />
                            </div>

                            {parsedPreview.length > 0 && (
                                <div className="bg-[var(--sidebar-bg)] rounded-xl p-3 border border-[var(--card-border)]">
                                    <p className="text-[11px] font-semibold text-[var(--muted)] mb-2">
                                        {parsedPreview.length} number{parsedPreview.length !== 1 ? 's' : ''} found:
                                    </p>
                                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                                        {parsedPreview.map((num, i) => (
                                            <p key={i} className="text-xs font-mono text-[var(--foreground)]">
                                                <span className="text-[var(--muted)] mr-1.5">{i + 1}.</span>{num}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2">
                                {parsedPreview.length === 0 ? (
                                    <button
                                        onClick={handleParseInput}
                                        disabled={!rawInput.trim()}
                                        className="flex-1 py-2.5 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--card-hover)] disabled:opacity-50 transition-all"
                                    >
                                        Preview Numbers
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => setParsedPreview([])}
                                            className="px-4 py-2.5 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--card-hover)] transition-all"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={handleLoadQueue}
                                            className="flex-1 py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
                                        >
                                            Load {parsedPreview.length} Numbers →
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                    ) : (
                    /* ── QUEUE MODE ── */
                        <div className="space-y-4">
                            {/* Queue list */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                        Queue &mdash; {remaining} remaining
                                    </label>
                                    {!active && (
                                        <button
                                            onClick={handleNewList}
                                            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                                        >
                                            <RotateCcw size={11} /> New list
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-44 overflow-y-auto rounded-xl border border-[var(--card-border)] divide-y divide-[var(--card-border)]">
                                    {queue.map((num, i) => {
                                        const isDone = i < currentIndex;
                                        const isCurrent = i === currentIndex;
                                        return (
                                            <div
                                                key={i}
                                                className={`flex items-center gap-2 px-3 py-2 text-xs font-mono ${
                                                    isDone ? 'opacity-40' :
                                                    isCurrent ? 'bg-[var(--success-subtle)]/20' :
                                                    ''
                                                }`}
                                            >
                                                <span className="w-5 text-right text-[var(--muted)]/60 shrink-0 text-[10px]">{i + 1}.</span>
                                                <span className={`flex-1 ${isDone ? 'line-through text-[var(--muted)]' : isCurrent ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--muted)]'}`}>
                                                    {num}
                                                </span>
                                                {isDone && <Check size={10} className="text-[var(--success)] shrink-0" />}
                                                {isCurrent && (
                                                    <span className="text-[9px] font-bold text-[var(--success)] uppercase tracking-wider shrink-0">
                                                        {active && !paused ? 'Next' : 'Start here'}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Delay config */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                        Call Gap
                                    </label>
                                    <span className={`text-xs font-semibold tabular-nums ${delayColorClass}`}>
                                        {formatDelay(delay)}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={-15}
                                    max={30}
                                    step={1}
                                    value={delay}
                                    onChange={e => onDelayChange(parseInt(e.target.value))}
                                    className="w-full cursor-pointer accent-blue-500"
                                />
                                <div className="flex justify-between text-[10px] text-[var(--muted)] mt-1 mb-2">
                                    <span>−15s early</span>
                                    <span>0</span>
                                    <span>+30s wait</span>
                                </div>
                                <p className="text-[10px] text-[var(--muted)] leading-relaxed">
                                    {delay < 0 && (
                                        <>
                                            <span className="text-[var(--warning)] font-medium">Early dial:</span>{' '}
                                            Next call starts {Math.abs(delay)}s after the current call ends — before you submit the form.
                                            Lets you fill out the previous call while the new one is already ringing.
                                        </>
                                    )}
                                    {delay === 0 && 'Next call dials immediately when you submit the form.'}
                                    {delay > 0 && `Waits ${delay}s after you submit before dialing the next number.`}
                                </p>
                            </div>

                            {/* Controls */}
                            {isComplete ? (
                                <div className="flex gap-2">
                                    <div className="flex-1 flex items-center justify-center py-2.5 px-3 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm text-[var(--muted)]">
                                        <Check size={14} className="text-[var(--success)] mr-2" />
                                        All {queue.length} calls done!
                                    </div>
                                    <button
                                        onClick={handleNewList}
                                        className="px-4 py-2.5 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--card-hover)] transition-all"
                                    >
                                        New List
                                    </button>
                                </div>
                            ) : active && !paused ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={onPause}
                                        disabled={disabled}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--warning-subtle)] text-[var(--warning)] text-sm font-medium border border-[var(--warning)]/20 hover:bg-[var(--warning)] hover:text-white transition-all disabled:opacity-50"
                                    >
                                        <Pause size={14} /> Pause
                                    </button>
                                    <button
                                        onClick={onStop}
                                        disabled={disabled}
                                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--error-subtle)] text-[var(--error)] text-sm font-medium border border-[var(--error)]/20 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                                    >
                                        <Square size={14} /> Stop
                                    </button>
                                </div>
                            ) : paused ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={onResume}
                                        disabled={disabled}
                                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--success-subtle)] text-[var(--success)] text-sm font-medium border border-[var(--success)]/20 hover:bg-[var(--success)] hover:text-white transition-all disabled:opacity-50"
                                    >
                                        <Play size={14} /> Resume
                                    </button>
                                    <button
                                        onClick={onStop}
                                        disabled={disabled}
                                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--error-subtle)] text-[var(--error)] text-sm font-medium border border-[var(--error)]/20 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                                    >
                                        <Square size={14} /> Stop
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={onStart}
                                    disabled={disabled || !canStart || queue.length === 0}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                    <Zap size={14} />
                                    Start Power Dialer
                                </button>
                            )}

                            {!canStart && !active && !isComplete && (
                                <p className="text-[10px] text-[var(--muted)] text-center -mt-1">
                                    Submit or discard the current call first
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
