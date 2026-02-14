'use client';

import { Zap, Phone } from 'lucide-react';

interface SessionModeSelectorProps {
    onStartSession: () => void;
    onStartStandalone: () => void;
}

export function SessionModeSelector({ onStartSession, onStartStandalone }: SessionModeSelectorProps) {
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

            <div className="mt-6 text-center">
                <p className="text-sm text-[var(--muted)]">
                    Both modes require screen share for call recording
                </p>
            </div>
        </div>
    );
}
