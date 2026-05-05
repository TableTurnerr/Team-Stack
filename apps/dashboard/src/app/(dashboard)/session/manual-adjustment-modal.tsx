'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type ManualAdjustment } from '@/lib/types';

interface ManualAdjustmentModalProps {
    session: ColdCallingSession;
    onApplied: (updatedSession: ColdCallingSession) => void;
    onClose: () => void;
}

interface CounterField {
    key: string;
    label: string;
    sessionKey: keyof ColdCallingSession;
    color: string;
}

const COUNTER_FIELDS: CounterField[] = [
    { key: 'total_dials', label: 'Total Dials', sessionKey: 'total_dials', color: 'var(--info)' },
    { key: 'total_pickups', label: 'Total Pickups', sessionKey: 'total_pickups', color: 'var(--success)' },
    { key: 'total_incoming', label: 'Received / Incoming', sessionKey: 'total_incoming', color: '#a855f7' },
    { key: 'total_callbacks', label: 'Total Callbacks', sessionKey: 'total_callbacks', color: 'var(--warning)' },
    { key: 'owner_reached', label: 'Owner Reached', sessionKey: 'owner_reached', color: 'var(--success)' },
    { key: 'pitch_completed', label: 'Pitch Completed', sessionKey: 'pitch_completed', color: 'var(--info)' },
    { key: 'warm_lead', label: 'Warm Lead', sessionKey: 'warm_lead', color: 'var(--warning)' },
];

export function ManualAdjustmentModal({ session, onApplied, onClose }: ManualAdjustmentModalProps) {
    const [values, setValues] = useState<Record<string, number>>({});
    const [minimums, setMinimums] = useState<Record<string, number>>({});
    // baseline = the clamped starting values (max of session value, minimum from logs)
    // This is what we compare against for "was X" and hasChanges
    const baselineRef = useRef<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [reason, setReason] = useState('');

    // Fetch call logs to compute minimums, then initialize values in one shot
    useEffect(() => {
        const fetchAndInit = async () => {
            let mins: Record<string, number> = {};

            try {
                const logs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                    filter: `session = "${session.id}"`,
                });

                const loggedDials = logs.filter(l => l.direction !== 'inbound').length;
                const loggedIncoming = logs.filter(l => l.direction === 'inbound').length;
                const loggedPickups = logs.filter(l => {
                    const outcomes: string[] = Array.isArray(l.call_outcome) ? l.call_outcome : (l.call_outcome ? [l.call_outcome] : []);
                    return !outcomes.includes('No Answer') && !outcomes.includes('Missed Call') && outcomes.length > 0;
                }).length;
                const loggedCallbacks = logs.filter(l => {
                    const events = l.callback_events;
                    return Array.isArray(events) && events.length > 0;
                }).length;
                const loggedOwnerReached = logs.filter(l => l.owner_reached).length;
                const loggedPitchCompleted = logs.filter(l => l.pitch_completed).length;
                const loggedWarmLead = logs.filter(l => l.warm_lead).length;

                mins = {
                    total_dials: loggedDials,
                    total_pickups: loggedPickups,
                    total_incoming: loggedIncoming,
                    total_callbacks: loggedCallbacks,
                    owner_reached: loggedOwnerReached,
                    pitch_completed: loggedPitchCompleted,
                    warm_lead: loggedWarmLead,
                };
            } catch (err) {
                console.error('Failed to fetch call logs for minimums:', err);
                COUNTER_FIELDS.forEach(f => { mins[f.key] = 0; });
            }

            setMinimums(mins);

            // Initialize values clamped to minimums — this is the clean baseline
            const initial: Record<string, number> = {};
            COUNTER_FIELDS.forEach(f => {
                const sessionVal = (session[f.sessionKey] as number) || 0;
                const min = mins[f.key] ?? 0;
                initial[f.key] = Math.max(sessionVal, min);
            });

            baselineRef.current = initial;
            setValues(initial);
            setLoading(false);
        };

        fetchAndInit();
    }, [session]);

    const getValidationError = useCallback((field: string, value: number): string | null => {
        const min = minimums[field] ?? 0;
        if (value < min) {
            return `Cannot go below ${min} (${min} logged in call records)`;
        }
        if (value < 0) return 'Cannot be negative';

        // Cross-field validation
        const dials = field === 'total_dials' ? value : values.total_dials;
        const pickups = field === 'total_pickups' ? value : values.total_pickups;

        if (field === 'total_pickups' && value > dials) {
            return `Cannot exceed total dials (${dials})`;
        }
        if (field === 'total_dials' && value < pickups) {
            return `Cannot be less than pickups (${pickups})`;
        }

        return null;
    }, [minimums, values]);

    const handleValueChange = (field: string, newValue: number) => {
        const min = minimums[field] ?? 0;
        const clamped = Math.max(min, Math.max(0, newValue));
        setValues(prev => ({ ...prev, [field]: clamped }));
        setError('');
    };

    const hasChanges = COUNTER_FIELDS.some(f => {
        const baseline = baselineRef.current[f.key] ?? 0;
        return values[f.key] !== baseline;
    });

    const handleApply = async () => {
        if (!hasChanges) return;

        // Validate all fields
        for (const f of COUNTER_FIELDS) {
            const err = getValidationError(f.key, values[f.key]);
            if (err) {
                setError(`${f.label}: ${err}`);
                return;
            }
        }

        // Cross-validation: pickups <= dials
        if (values.total_pickups > values.total_dials) {
            setError('Total pickups cannot exceed total dials');
            return;
        }

        setSaving(true);
        setError('');

        try {
            // Build the changes array — compare against session values for the audit log
            const changes = COUNTER_FIELDS
                .filter(f => {
                    const current = (session[f.sessionKey] as number) || 0;
                    return values[f.key] !== current;
                })
                .map(f => ({
                    field: f.label,
                    from: (session[f.sessionKey] as number) || 0,
                    to: values[f.key],
                }));

            if (changes.length === 0) {
                // All values match what's already in the session — nothing to save
                onClose();
                return;
            }

            const adjustment: ManualAdjustment = {
                timestamp: new Date().toISOString(),
                changes,
                reason: reason.trim() || undefined,
            };

            const existingAdjustments: ManualAdjustment[] = Array.isArray(session.manual_adjustments)
                ? session.manual_adjustments
                : [];

            const updateData: Record<string, unknown> = {
                manual_adjustments: [...existingAdjustments, adjustment],
            };
            COUNTER_FIELDS.forEach(f => {
                if (values[f.key] !== ((session[f.sessionKey] as number) || 0)) {
                    updateData[f.key] = values[f.key];
                }
            });

            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                session.id,
                updateData
            );

            onApplied(updatedSession);
        } catch (err: any) {
            console.error('Failed to apply manual adjustment:', err);
            setError(err?.message || 'Failed to save adjustment');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl w-full max-w-lg"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--card-border)]">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-[var(--info-subtle)] flex items-center justify-center">
                            <SlidersHorizontal size={18} className="text-[var(--info)]" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold">Manual Adjustment</h2>
                            <p className="text-xs text-[var(--muted)]">Override session counters</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                    {loading ? (
                        <div className="text-center py-8 text-[var(--muted)] text-sm">
                            Loading call log data...
                        </div>
                    ) : (
                        <>
                            {/* Info banner */}
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning-subtle)] border border-[var(--warning)]/20">
                                <AlertTriangle size={14} className="text-[var(--warning)] mt-0.5 shrink-0" />
                                <p className="text-xs text-[var(--warning)]">
                                    Values cannot be set below what&apos;s already logged in call records. Delete individual calls first if needed.
                                </p>
                            </div>

                            {/* Counter fields */}
                            <div className="space-y-2">
                                {COUNTER_FIELDS.map(f => {
                                    const baseline = baselineRef.current[f.key] ?? 0;
                                    const value = values[f.key] ?? baseline;
                                    const min = minimums[f.key] ?? 0;
                                    const changed = value !== baseline;
                                    const validationErr = getValidationError(f.key, value);

                                    return (
                                        <div key={f.key}>
                                            <div className="flex items-center justify-between py-2">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-2 h-2 rounded-full"
                                                        style={{ backgroundColor: f.color }}
                                                    />
                                                    <span className="text-sm font-medium">{f.label}</span>
                                                    {changed && (
                                                        <span className="text-[10px] text-[var(--muted)] tabular-nums">
                                                            was {baseline}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-[var(--muted)]">
                                                        min: {min}
                                                    </span>
                                                    <button
                                                        onClick={() => handleValueChange(f.key, value - 1)}
                                                        disabled={value <= min}
                                                        className="w-7 h-7 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center hover:bg-[var(--card-hover)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    >
                                                        <Minus size={12} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        value={value}
                                                        onChange={e => {
                                                            const parsed = parseInt(e.target.value, 10);
                                                            if (!isNaN(parsed)) handleValueChange(f.key, parsed);
                                                        }}
                                                        min={min}
                                                        className={`w-16 text-center text-sm font-bold tabular-nums rounded-lg border px-2 py-1.5 bg-[var(--sidebar-bg)] focus:outline-none focus:ring-1 transition-colors ${
                                                            changed
                                                                ? 'border-[var(--primary)] focus:ring-[var(--primary)] text-[var(--primary)]'
                                                                : 'border-[var(--card-border)] focus:ring-[var(--card-border)]'
                                                        }`}
                                                    />
                                                    <button
                                                        onClick={() => handleValueChange(f.key, value + 1)}
                                                        className="w-7 h-7 rounded-lg border flex items-center justify-center transition-colors hover:opacity-80"
                                                        style={{
                                                            backgroundColor: `color-mix(in srgb, ${f.color} 15%, transparent)`,
                                                            borderColor: `color-mix(in srgb, ${f.color} 30%, transparent)`,
                                                            color: f.color,
                                                        }}
                                                    >
                                                        <Plus size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                            {validationErr && (
                                                <p className="text-[11px] text-[var(--error)] ml-4 -mt-1 mb-1">{validationErr}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Reason field */}
                            <div>
                                <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">
                                    Reason (optional)
                                </label>
                                <input
                                    type="text"
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                    placeholder="e.g. Missed logging 3 calls earlier"
                                    maxLength={200}
                                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] placeholder:text-[var(--muted)]/50"
                                />
                            </div>

                            {error && (
                                <p className="text-xs text-[var(--error)] bg-[var(--error-subtle)] rounded-lg p-2.5">
                                    {error}
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {!loading && (
                    <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--card-border)]">
                        <button
                            onClick={onClose}
                            className="px-4 py-2.5 text-sm font-medium rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={!hasChanges || saving}
                            className="px-4 py-2.5 text-sm font-medium rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Applying...' : 'Apply Adjustment'}
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
