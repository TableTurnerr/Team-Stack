'use client';

import { useState } from 'react';
import { Phone, PhoneIncoming, Clock, TrendingUp, PhoneForwarded, PhoneCall, Info } from 'lucide-react';

interface SessionMetricsProps {
    totalDials: number;
    totalPickups: number;
    totalCallbacks: number;
    totalIncoming: number;
    totalCallTimeSec: number;
}

function formatDuration(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function SessionMetrics({ totalDials, totalPickups, totalCallbacks, totalIncoming, totalCallTimeSec }: SessionMetricsProps) {
    const [showInfo, setShowInfo] = useState(false);
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
            label: 'Received',
            value: totalIncoming,
            icon: PhoneCall,
            color: '#a855f7',
            bg: 'color-mix(in srgb, #a855f7 10%, transparent)',
        },
        {
            label: 'Callbacks',
            value: totalCallbacks,
            icon: PhoneForwarded,
            color: 'var(--warning)',
            bg: 'var(--warning-subtle)',
        },
    ] as const;

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                Session Metrics
            </h3>

            <div className="grid grid-cols-5 gap-3">
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

                {/* Time On Call — talk time, excludes ringing */}
                <div
                    className="flex flex-col items-center gap-2 p-3 rounded-lg"
                    style={{ backgroundColor: 'var(--card-hover)' }}
                >
                    <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--muted) 20%, transparent)' }}
                    >
                        <Clock size={16} style={{ color: 'var(--muted)' }} />
                    </div>
                    <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--muted)' }}>
                        {formatDuration(totalCallTimeSec)}
                    </span>
                    <div className="relative flex items-center gap-1">
                        <span className="text-xs text-[var(--muted)]">Time on Call</span>
                        <button
                            type="button"
                            aria-label="What is Time on Call?"
                            onMouseEnter={() => setShowInfo(true)}
                            onMouseLeave={() => setShowInfo(false)}
                            onFocus={() => setShowInfo(true)}
                            onBlur={() => setShowInfo(false)}
                            className="inline-flex text-[var(--muted)] hover:text-[var(--foreground)] cursor-help transition-colors"
                        >
                            <Info size={11} strokeWidth={2} />
                        </button>
                        {showInfo && (
                            <div
                                role="tooltip"
                                className="absolute bottom-full right-0 mb-2 z-30 w-56 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--foreground)] shadow-xl"
                            >
                                Total conversation time across all calls in this session. Excludes ringing, dialing, and time between calls — only counts the time spent actually talking after a connect.
                            </div>
                        )}
                    </div>
                </div>
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
