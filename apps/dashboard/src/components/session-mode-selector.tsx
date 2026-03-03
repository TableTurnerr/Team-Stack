'use client';

import { Zap, Phone, RotateCcw, Loader2 } from 'lucide-react';
import type { ColdCallingSession } from '@/lib/types';

interface SessionModeSelectorProps {
    onStartSession: () => void;
    onStartStandalone: () => void;
    onStartTestSession: () => void;
    lastCompletedSession?: ColdCallingSession | null;
    onResumeSession?: () => void;
    resuming?: boolean;
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRelativeTime(isoDate: string): string {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
}

export function SessionModeSelector({ onStartSession, onStartStandalone, onStartTestSession, lastCompletedSession, onResumeSession, resuming }: SessionModeSelectorProps) {
    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold mb-2">Call Session</h1>
                <p className="text-[var(--muted)]">Choose how you want to make calls</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Start Session Card */}
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-8 hover:border-[var(--foreground)] transition-colors">
                    <div className="flex flex-col items-center text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center">
                            <Zap className="w-8 h-8 text-[var(--primary)]" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold mb-2">Start Cold Calling Session</h2>
                            <p className="text-[var(--muted)] text-sm mb-4">
                                Track your performance metrics, manage multiple calls, and monitor your progress in real-time.
                            </p>
                            <ul className="text-sm text-[var(--muted)] space-y-2 text-left mb-6">
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>Track dials, pickups, and performance</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>Monitor session duration and metrics</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>Auto-record all calls in the session</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>View session history and analytics</span>
                                </li>
                            </ul>
                        </div>
                        <button
                            onClick={onStartSession}
                            className="w-full px-6 py-3 bg-[var(--foreground)] text-[var(--background)] rounded-lg font-medium hover:opacity-90 transition-opacity"
                        >
                            Start Session
                        </button>
                    </div>
                </div>

                {/* Make Standalone Call Card */}
                <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-8 hover:border-[var(--foreground)] transition-colors">
                    <div className="flex flex-col items-center text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-[var(--info-subtle)] flex items-center justify-center">
                            <Phone className="w-8 h-8 text-[var(--info)]" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold mb-2">Make Standalone Call</h2>
                            <p className="text-[var(--muted)] text-sm mb-4">
                                Make quick individual calls without starting a full session. Perfect for follow-ups or one-off calls.
                            </p>
                            <ul className="text-sm text-[var(--muted)] space-y-2 text-left mb-6">
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>No session tracking or metrics</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>Quick and simple call interface</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>Auto-record calls for documentation</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="text-[var(--success)] mr-2">✓</span>
                                    <span>Logged separately from sessions</span>
                                </li>
                            </ul>
                        </div>
                        <button
                            onClick={onStartStandalone}
                            className="w-full px-6 py-3 border border-[var(--card-border)] rounded-lg font-medium hover:bg-[var(--card-bg)] transition-colors"
                        >
                            Make Quick Call
                        </button>
                    </div>
                </div>
            </div>

            {/* Resume Last Session banner */}
            {lastCompletedSession && onResumeSession && (
                <div className="mt-6 bg-[var(--card-bg)] border border-[var(--success)]/30 rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-[var(--success-subtle)] flex items-center justify-center flex-shrink-0">
                            <RotateCcw className="w-4 h-4 text-[var(--success)]" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">Resume Last Session</p>
                            <p className="text-xs text-[var(--muted)] mt-0.5">
                                {formatDuration(lastCompletedSession.total_duration_sec ?? 0)} recorded
                                {' · '}
                                {lastCompletedSession.total_dials ?? 0} dials
                                {' · '}
                                ended {lastCompletedSession.ended_at ? formatRelativeTime(lastCompletedSession.ended_at) : '—'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onResumeSession}
                        disabled={resuming}
                        className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--success-subtle)] text-[var(--success)] font-medium text-sm border border-[var(--success)]/30 hover:bg-[var(--success)] hover:text-white transition-all disabled:opacity-50"
                    >
                        {resuming ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        {resuming ? 'Resuming…' : 'Resume'}
                    </button>
                </div>
            )}

            <div className="mt-6 text-center space-y-1.5">
                <p className="text-sm text-[var(--muted)]">
                    Both modes require screen share for call recording
                </p>
                <p className="text-xs text-[var(--muted)]/60">
                    Just testing things out?{' '}
                    <button
                        onClick={onStartTestSession}
                        className="underline hover:text-[var(--foreground)] transition-colors"
                    >
                        Start a test session
                    </button>
                </p>
            </div>
        </div>
    );
}
