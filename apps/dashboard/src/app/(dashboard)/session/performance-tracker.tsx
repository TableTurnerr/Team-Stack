'use client';

import { useCallback, useEffect } from 'react';
import { Plus, Minus, UserCheck, Presentation, CalendarCheck, type LucideIcon } from 'lucide-react';

interface PerformanceTrackerProps {
    ownerReached: number;
    pitchCompleted: number;
    warmLead: number;
    onUpdate: (field: 'owner_reached' | 'pitch_completed' | 'warm_lead', value: number) => void;
}

interface CounterRowProps {
    label: string;
    value: number;
    icon: LucideIcon;
    color: string;
    onIncrement: () => void;
    onDecrement: () => void;
}

function CounterRow({ label, value, icon: Icon, color, onIncrement, onDecrement }: CounterRowProps) {
    return (
        <div className="flex items-center justify-between py-2.5">
            <div className="flex items-center gap-2.5">
                <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
                >
                    <Icon size={14} style={{ color }} />
                </div>
                <span className="text-sm font-medium">{label}</span>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={onDecrement}
                    disabled={value <= 0}
                    className="w-7 h-7 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center hover:bg-[var(--card-hover)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <Minus size={12} />
                </button>

                <span className="w-8 text-center text-lg font-bold tabular-nums">{value}</span>

                <button
                    onClick={onIncrement}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center transition-colors hover:opacity-80"
                    style={{
                        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
                        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
                        color,
                    }}
                >
                    <Plus size={12} />
                </button>
            </div>
        </div>
    );
}

export function PerformanceTracker({
    ownerReached,
    pitchCompleted,
    warmLead,
    onUpdate,
}: PerformanceTrackerProps) {
    const handleIncrement = useCallback(
        (field: 'owner_reached' | 'pitch_completed' | 'warm_lead', current: number) => {
            onUpdate(field, current + 1);
        },
        [onUpdate]
    );

    const handleDecrement = useCallback(
        (field: 'owner_reached' | 'pitch_completed' | 'warm_lead', current: number) => {
            if (current > 0) onUpdate(field, current - 1);
        },
        [onUpdate]
    );

    // Keyboard shortcuts: Ctrl+1/2/3 to increment
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!e.ctrlKey) return;
            if (e.key === '1') {
                e.preventDefault();
                handleIncrement('owner_reached', ownerReached);
            } else if (e.key === '2') {
                e.preventDefault();
                handleIncrement('pitch_completed', pitchCompleted);
            } else if (e.key === '3') {
                e.preventDefault();
                handleIncrement('warm_lead', warmLead);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [ownerReached, pitchCompleted, warmLead, handleIncrement]);

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 space-y-1">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                Performance Tracking
            </h3>

            <CounterRow
                label="Owner Reached"
                value={ownerReached}
                icon={UserCheck}
                color="var(--success)"
                onIncrement={() => handleIncrement('owner_reached', ownerReached)}
                onDecrement={() => handleDecrement('owner_reached', ownerReached)}
            />

            <div className="border-t border-[var(--card-border)]" />

            <CounterRow
                label="Pitch Completed"
                value={pitchCompleted}
                icon={Presentation}
                color="var(--info)"
                onIncrement={() => handleIncrement('pitch_completed', pitchCompleted)}
                onDecrement={() => handleDecrement('pitch_completed', pitchCompleted)}
            />

            <div className="border-t border-[var(--card-border)]" />

            <CounterRow
                label="Warm Lead"
                value={warmLead}
                icon={CalendarCheck}
                color="var(--warning)"
                onIncrement={() => handleIncrement('warm_lead', warmLead)}
                onDecrement={() => handleDecrement('warm_lead', warmLead)}
            />

            <p className="text-[10px] text-[var(--muted)] pt-2">
                Ctrl+1/2/3 to increment
            </p>
        </div>
    );
}
