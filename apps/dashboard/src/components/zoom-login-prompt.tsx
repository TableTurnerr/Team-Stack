'use client';

import { useEffect, useState } from 'react';
import { X, LogIn, Monitor, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useZoomPhone } from '@/contexts/zoom-phone-context';

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';

/**
 * Full-screen modal that prompts the user to:
 * 1. Sign into Zoom Smart Embed
 * 2. Verify the audio device is set to the current computer (where CRM agent runs)
 *
 * Also shown after a device mismatch is detected (call routed to wrong device)
 * with a prominent warning banner explaining what happened.
 */
export function ZoomLoginPrompt() {
    const {
        showZoomLoginPrompt, zoomEmbedLoggedIn,
        confirmZoomLoggedIn, dismissZoomLoginPrompt,
        deviceMismatchDetected,
    } = useZoomPhone();
    const [deviceConfirmed, setDeviceConfirmed] = useState(false);

    // Reset device confirmation when modal opens
    useEffect(() => {
        if (showZoomLoginPrompt) {
            setDeviceConfirmed(false);
        }
    }, [showZoomLoginPrompt]);

    // Auto-close when login is detected via postMessage (but NOT during device mismatch)
    useEffect(() => {
        if (zoomEmbedLoggedIn && showZoomLoginPrompt && !deviceMismatchDetected) {
            dismissZoomLoginPrompt();
        }
    }, [zoomEmbedLoggedIn, showZoomLoginPrompt, dismissZoomLoginPrompt, deviceMismatchDetected]);

    if (!showZoomLoginPrompt) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl w-[520px] max-h-[90vh] flex flex-col overflow-hidden">
                {/* Device mismatch warning banner */}
                {deviceMismatchDetected && (
                    <div className="bg-[var(--error)] text-white px-4 py-3 flex items-start gap-3">
                        <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold">Call routed to a different device</p>
                            <p className="text-xs mt-0.5 text-white/90">
                                Your last call was automatically ended because Zoom sent it to another device
                                instead of this computer. Change the device setting below to &quot;This Device&quot;
                                before trying again.
                            </p>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            deviceMismatchDetected ? 'bg-[var(--error-subtle)]' : 'bg-blue-500/10'
                        }`}>
                            {deviceMismatchDetected
                                ? <Monitor size={20} className="text-[var(--error)]" />
                                : <LogIn size={20} className="text-blue-500" />
                            }
                        </div>
                        <div>
                            <h2 className="text-lg font-bold">
                                {deviceMismatchDetected ? 'Fix Zoom Device Setting' : 'Zoom Phone Setup'}
                            </h2>
                            <p className="text-xs text-[var(--muted)]">
                                {deviceMismatchDetected
                                    ? 'Switch Zoom to use this computer'
                                    : 'Sign in and verify device before making calls'
                                }
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={dismissZoomLoginPrompt}
                        className="p-2 rounded-lg hover:bg-[var(--sidebar-bg)] transition-colors"
                    >
                        <X size={18} className="text-[var(--muted)]" />
                    </button>
                </div>

                {/* Zoom iframe for login / device settings */}
                <div className="flex-1 min-h-[420px] relative bg-white">
                    <iframe
                        src={ZOOM_EMBED_URL}
                        className="w-full h-full border-0"
                        style={{ minHeight: 420 }}
                        allow="microphone; camera; autoplay; clipboard-read; clipboard-write"
                        title="Zoom Phone Login"
                    />
                </div>

                {/* Footer with verification checklist */}
                <div className="p-4 border-t border-[var(--card-border)] space-y-3">
                    <div className="bg-[var(--sidebar-bg)] rounded-xl p-3 space-y-2 text-sm border border-[var(--card-border)]">
                        {/* Step 1: Sign in (skip emphasis when mismatch — user is already signed in) */}
                        {!deviceMismatchDetected && (
                            <div className="flex items-start gap-2">
                                <span className="text-blue-500 font-bold text-xs mt-0.5">1</span>
                                <p className="text-[var(--foreground)] font-medium text-xs">
                                    Sign in to Zoom Phone above. If you see the dial pad, you&apos;re already signed in.
                                </p>
                            </div>
                        )}

                        {/* Step 2: Device verification */}
                        <div className="flex items-start gap-2">
                            <span className={`font-bold text-xs mt-0.5 ${deviceMismatchDetected ? 'text-[var(--error)]' : 'text-blue-500'}`}>
                                {deviceMismatchDetected ? '!' : '2'}
                            </span>
                            <div className="flex-1">
                                <p className={`font-medium text-xs ${deviceMismatchDetected ? 'text-[var(--error)]' : 'text-[var(--foreground)]'}`}>
                                    {deviceMismatchDetected
                                        ? 'Change Zoom device to this computer:'
                                        : <>Verify Zoom is set to use <span className="text-blue-500">this computer</span> for calls:</>
                                    }
                                </p>
                                <ul className="mt-1 space-y-0.5 text-[var(--muted)] text-xs">
                                    <li>Look for a device/speaker icon in the Zoom dial pad above</li>
                                    <li>Make sure it says <span className="font-semibold text-[var(--foreground)]">This Device</span> or your computer name</li>
                                    <li>If it shows a different device (e.g. your phone), switch it to this computer</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    {/* Device confirmation checkbox */}
                    <label className="flex items-center gap-2.5 cursor-pointer group px-1">
                        <div className="relative flex items-center justify-center">
                            <input
                                type="checkbox"
                                checked={deviceConfirmed}
                                onChange={(e) => setDeviceConfirmed(e.target.checked)}
                                className="sr-only peer"
                            />
                            <div className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${
                                deviceConfirmed
                                    ? 'border-blue-500 bg-blue-500'
                                    : deviceMismatchDetected
                                        ? 'border-[var(--error)]/50'
                                        : 'border-[var(--card-border)]'
                            }`}>
                                {deviceConfirmed && <CheckCircle2 size={14} className="text-white" />}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Monitor size={14} className="text-[var(--muted)]" />
                            <span className="text-xs font-medium text-[var(--foreground)] group-hover:text-blue-500 transition-colors">
                                {deviceMismatchDetected
                                    ? "I've switched Zoom to use this computer"
                                    : "I'm signed in and Zoom is set to use this computer"
                                }
                            </span>
                        </div>
                    </label>

                    <div className="flex gap-3">
                        <button
                            onClick={dismissZoomLoginPrompt}
                            className="flex-1 py-2.5 rounded-xl bg-[var(--sidebar-bg)] text-[var(--foreground)] font-medium text-sm border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmZoomLoggedIn}
                            disabled={!deviceConfirmed}
                            className="flex-[2] py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Continue
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
