'use client';

import { Phone, PhoneIncoming, Clock, TrendingUp, PhoneForwarded } from 'lucide-react';

interface SessionMetricsProps {
    totalDials: number;
    totalPickups: number;
    totalCallbacks: number;
    durationSec: number;
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function SessionMetrics({ totalDials, totalPickups, totalCallbacks, durationSec }: SessionMetricsProps) {
    const pickupRate = totalDials > 0 ? Math.round((totalPickups / totalDials) * 100) : 0;

    const metrics = [
        {
            label: 'Dials',
            value: totalDials,
            icon: Phone,
            color: 'var(--info)',
            bg: 'var(--info-subtle)',
        },
        {
            label: 'Pickups',
            value: totalPickups,
            icon: PhoneIncoming,
            color: 'var(--success)',
            bg: 'var(--success-subtle)',
        },
        {
            label: 'Callbacks',
            value: totalCallbacks,
            icon: PhoneForwarded,
            color: 'var(--warning)',
            bg: 'var(--warning-subtle)',
        },
        {
            label: 'Duration',
            value: formatDuration(durationSec),
            icon: Clock,
            color: 'var(--muted)',
            bg: 'var(--card-hover)',
        },
    ];

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                Session Metrics
            </h3>

            <div className="grid grid-cols-3 gap-3">
                {metrics.map(({ label, value, icon: Icon, color, bg }) => (
                    <div
                        key={label}
                        className="flex flex-col items-center gap-2 p-3 rounded-lg"
                        style={{ backgroundColor: bg }}
                    >
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)` }}
                        >
                            <Icon size={16} style={{ color }} />
                        </div>
                        <span className="text-xl font-bold tabular-nums" style={{ color }}>
                            {value}
                        </span>
                        <span className="text-xs text-[var(--muted)]">{label}</span>
                    </div>
                ))}
            </div>

            {/* Pickup Rate */}
            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5 text-[var(--muted)]">
                        <TrendingUp size={14} />
                        <span>Pickup Rate</span>
                    </div>
                    <span className="font-semibold">{pickupRate}%</span>
                </div>
                <div className="h-2 bg-[var(--card-border)] rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                            width: `${pickupRate}%`,
                            background: pickupRate >= 50 ? 'var(--success)' : pickupRate >= 25 ? 'var(--warning)' : 'var(--error)',
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
