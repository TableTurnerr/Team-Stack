'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Headphones,
    Power,
    Loader2,
    Zap,
    AlertTriangle,
    Phone,
    Square,
    Pause,
    Play,
    Copy,
    Check,
    ExternalLink,
    SlidersHorizontal,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCallingSession, type CallLog, type PhoneNumber, type Recording, type FollowUp, type UserPreferences } from '@/lib/types';
import { computeCompanyStatuses } from '@/lib/call-outcomes';
import { useAuth } from '@/contexts/auth-context';
import { useZoomPhone } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { SessionMetrics } from './session-metrics';
import { PerformanceTracker } from './performance-tracker';
import { CurrentCallForm, type CallFormData, type CallFormDraft, type CallbackReason } from './current-call-form';
import { LastCallPreview } from './last-call-preview';
import { ManualAdjustmentModal } from './manual-adjustment-modal';
import { SessionModeSelector } from '@/components/session-mode-selector';
import { StandaloneCallInterface } from './standalone-call-interface';
import { ZoomPhoneDialer } from '@/components/zoom-phone-dialer';
import { PowerDialerPanel, type DialerEntry } from './power-dialer-panel';
import { SessionFollowUps } from './session-followups';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useFollowUpNotifications, type FollowUpNotification } from '@/hooks/use-followup-notifications';
import { FollowUpNotificationContainer } from '@/components/followup-notification-toast';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocalAgent } from '@/contexts/local-agent-context';

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

import { useSession } from '@/contexts/session-context';

// ... other imports

const ZOOM_EMBED_URL = 'https://applications.zoom.us/integration/phone/embeddablephone/home';
const UNSAVED_CALL_STORAGE_KEY = 'crm:session:unsaved-call:v1';
const SESSION_TAB_LOCK_KEY = 'crm:session:tab-lock';
const SESSION_TAB_LOCK_TTL = 8000; // ms — another tab is considered active if heartbeat is this fresh
const SESSION_TAB_LOCK_HEARTBEAT = 4000; // ms — heartbeat interval

interface UnsavedCallStoragePayload {
    phoneNumber: string;
    hasUnsavedCall: boolean;
    draft: CallFormDraft | null;
}

const hasDraftContent = (draft: CallFormDraft | null) => {
    if (!draft) return false;

    return (
        draft.companySearch.trim().length > 0 ||
        !!draft.selectedCompany ||
        draft.receptionistName.trim().length > 0 ||
        draft.ownerName.trim().length > 0 ||
        (draft.callOutcome?.length ?? 0) > 0 ||
        draft.postCallNotes.trim().length > 0 ||
        draft.ownerReached ||
        draft.pitchCompleted ||
        draft.appointmentSet ||
        draft.showFollowUp ||
        !!draft.followUpData
    );
};

export default function SessionPage() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { dialNumber, callStatus, callDirection, isDialing, iframeRef, setIframeReady, refreshDialer, activeCallNumber, setAutoHangup, isAudioDisconnected } = useZoomPhone();
    const { session, setSession, isLoading: sessionLoading, isStandaloneMode, setStandaloneMode, isBlockedByOtherSession, activeSessionUserName, otherActiveSession } = useSession();
    const { createFollowUp, completeFollowUp } = useFollowUps();
    const { addToast } = useToast();
    const { isConnected: agentConnected, launchAgent, zoomDetected: agentZoomDetected, launchZoom, zoomLaunching } = useLocalAgent();

    // Loading combined
    const loading = sessionLoading;

    // Local UI state
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const [pausing, setPausing] = useState(false);
    const [collectionMissing, setCollectionMissing] = useState(false);
    // Virtual dialer test mode: auto-confirm Zoom detection
    const isVirtualDialerMode = typeof window !== 'undefined' && !!(window as any).__TEST_VIRTUAL_DIALER;
    const [zoomAppConfirmed, setZoomAppConfirmed] = useState(isVirtualDialerMode);
    const [zoomDetecting, setZoomDetecting] = useState(false);
    const [zoomDetected, setZoomDetected] = useState<boolean | null>(isVirtualDialerMode ? true : null);
    const [awaitingAudioConnect, setAwaitingAudioConnect] = useState(false);

    // Recording state
    const {
        isSessionActive,
        status: recorderStatus,
        duration: recorderDuration,
        startSession: startAudioSession,
        endSession: endAudioSession,
        startRecording,
        stopRecording,
        discardRecording,
        enterDeferredMode,
        submitOldestDeferredRecording,
        submitDeferredRecording,
        discardOldestDeferredRecording,
        discardDeferredRecording,
        error: recorderError,
        setPhoneNumber: setContextPhoneNumber,
        deferredSegments,
    } = useCallRecording();

    // Timer
    const [elapsedSec, setElapsedSec] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Current call
    const [currentPhoneNumber, setCurrentPhoneNumber] = useState('');
    const [savingCall, setSavingCall] = useState(false);

    // Last call
    const [lastCallLog, setLastCallLog] = useState<CallLog | null>(null);
    const [lastCallCompanyName, setLastCallCompanyName] = useState('');

    // Call timing state
    const [ringStartTime, setRingStartTime] = useState<number | null>(null);
    const [connectTime, setConnectTime] = useState<number | null>(null);
    const [currentCallDuration, setCurrentCallDuration] = useState(0);
    const [dialCountIncremented, setDialCountIncremented] = useState(false);
    const [pickupCountIncremented, setPickupCountIncremented] = useState(false);
    const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Tracks the exact moment the call ended so duration calculation uses real end time,
    // not the (possibly much later) form submission time.
    const callEndTimeRef = useRef<number | null>(null);

    // Track unsaved call state — true when call ended but form not yet submitted
    const [hasUnsavedCall, setHasUnsavedCall] = useState(false);
    const [callDraft, setCallDraft] = useState<CallFormDraft | null>(null);
    const didHydrateFromStorage = useRef(false);

    // Multi-tab prevention
    const [otherTabActive, setOtherTabActive] = useState(false);
    const tabId = useRef(Math.random().toString(36).slice(2));

    // Callback tracking for the current call
    const [callbackEvents, setCallbackEvents] = useState<Array<{ reason: string; timestamp: string }>>([]);

    // Offline auto-end timer
    const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const offlineStartRef = useRef<number | null>(null);
    const endSessionRef = useRef<((offlineSubtractSec?: number) => Promise<void>) | null>(null);

    // Last completed session (for resume)
    const [lastCompletedSession, setLastCompletedSession] = useState<ColdCallingSession | null>(null);
    const [resuming, setResuming] = useState(false);

    // Test session state
    const [pendingTestSession, setPendingTestSession] = useState(false);
    const [showTestCleanupModal, setShowTestCleanupModal] = useState(false);
    const [testSessionCleanupId, setTestSessionCleanupId] = useState<string | null>(null);
    const [cleaningUp, setCleaningUp] = useState(false);
    const [cleanupError, setCleanupError] = useState('');
    const [showManualAdjustment, setShowManualAdjustment] = useState(false);
    const [testNumbersCopied, setTestNumbersCopied] = useState(false);

    const TEST_CALL_NUMBER_POOL = [
        '18042221111, Richmond VA - Echo & DTMF',
        '19093900003, Ontario CA - Instant Echo',
        '18004444444, Toll-Free - Reads Caller ID',
        '16317918378, New York NY - Audio Clarity',
        '12064560649, Seattle WA - Echo & Hold Music',
        '14086474636, San Jose CA - Echo, DTMF & Frequency Sweep',
        '18023599100, Vermont - Latency Echo Test',
        '18004377950, Toll-Free - ANI Caller ID Readback',
        '19252590082, East Bay CA - Echo Test',
    ];

    const handleCopyTestNumbers = () => {
        const shuffled = [...TEST_CALL_NUMBER_POOL].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, 5).join('\n');
        navigator.clipboard.writeText(picked).then(() => {
            setTestNumbersCopied(true);
            setTimeout(() => setTestNumbersCopied(false), 2000);
        });
    };

    // ---------------------------------------------------------------------------
    // Zoom detection — agent-based (process scan + launch) when agent is
    // connected, falls back to zoommtg:// protocol handler hack otherwise.
    // ---------------------------------------------------------------------------
    const verifyZoomRunning = useCallback(() => {
        // If agent is connected, ask it to launch/verify Zoom
        if (agentConnected) {
            setZoomDetecting(true);
            setZoomDetected(null);
            launchZoom();
            return;
        }

        // Fallback: protocol handler blur detection (no agent)
        if (!document.hasFocus()) window.focus();
        setZoomDetecting(true);
        setZoomDetected(null);

        let resolved = false;
        const resolve = (detected: boolean) => {
            if (resolved) return;
            resolved = true;
            window.removeEventListener('blur', onBlur);
            setZoomDetecting(false);
            setZoomDetected(detected);
            if (detected) {
                setZoomAppConfirmed(true);
                refreshDialer();
            }
        };
        const onBlur = () => resolve(true);
        window.addEventListener('blur', onBlur);

        const a = document.createElement('a');
        a.href = 'zoommtg://zoom.us/';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => resolve(false), 2000);
    }, [agentConnected, launchZoom, refreshDialer]);

    // Auto-launch Zoom when connect-audio screen appears and Zoom is not running.
    // The agent will find and start Zoom automatically — the session cannot proceed
    // until Zoom is verified running (zoomAppConfirmed gate on the Start button).
    const autoLaunchAttemptedRef = useRef(false);
    useEffect(() => {
        if (awaitingAudioConnect && agentConnected && !agentZoomDetected && !zoomAppConfirmed && !zoomDetecting && !autoLaunchAttemptedRef.current) {
            autoLaunchAttemptedRef.current = true;
            verifyZoomRunning();
        }
        // Reset the flag when leaving the connect-audio screen so it works again next time
        if (!awaitingAudioConnect) {
            autoLaunchAttemptedRef.current = false;
        }
    }, [awaitingAudioConnect, agentConnected, agentZoomDetected, zoomAppConfirmed, zoomDetecting, verifyZoomRunning]);

    // Auto-launch Local Agent when the "Reconnect Audio" screen appears and agent is offline.
    // Uses a ref to avoid launching more than once per screen appearance.
    const reconnectAgentLaunchAttemptedRef = useRef(false);
    useEffect(() => {
        const isReconnectScreen = !!session && !isSessionActive && !isVirtualDialerMode;
        if (isReconnectScreen && !agentConnected && !reconnectAgentLaunchAttemptedRef.current) {
            reconnectAgentLaunchAttemptedRef.current = true;
            launchAgent();
        }
        if (!isReconnectScreen) {
            reconnectAgentLaunchAttemptedRef.current = false;
        }
    }, [session, isSessionActive, isVirtualDialerMode, agentConnected, launchAgent]);

    // Auto-confirm Zoom when agent reports it is running (via heartbeat)
    useEffect(() => {
        if (agentConnected && agentZoomDetected) {
            setZoomDetected(true);
            setZoomAppConfirmed(true);
        }
    }, [agentConnected, agentZoomDetected]);

    // Handle agent's zoomAction response (after launchZoom command)
    useEffect(() => {
        if (!zoomLaunching && agentConnected && zoomDetecting) {
            // Agent responded — check if zoom is now detected
            if (agentZoomDetected) {
                setZoomDetecting(false);
                setZoomDetected(true);
                setZoomAppConfirmed(true);
                refreshDialer();
            } else {
                setZoomDetecting(false);
                setZoomDetected(false);
            }
        }
    }, [zoomLaunching, agentConnected, agentZoomDetected, zoomDetecting, refreshDialer]);

    // ---------------------------------------------------------------------------
    // Mid-session Zoom recovery — when Zoom disappears during an active session,
    // show a warning. When it comes back, refresh only the dialer section.
    // ---------------------------------------------------------------------------
    const [zoomLostDuringSession, setZoomLostDuringSession] = useState(false);
    const prevAgentZoomDetectedRef = useRef<boolean | null>(null);

    useEffect(() => {
        // Only care about active sessions
        if (!session || session.status !== 'active') {
            setZoomLostDuringSession(false);
            prevAgentZoomDetectedRef.current = null;
            return;
        }

        if (!agentConnected) return;

        const prev = prevAgentZoomDetectedRef.current;
        prevAgentZoomDetectedRef.current = agentZoomDetected;

        if (prev === null) return; // first heartbeat — skip transition check

        if (prev && !agentZoomDetected) {
            // Zoom just disappeared mid-session — auto-pause
            setZoomLostDuringSession(true);
            if (!session.paused_at) {
                pauseSessionRef.current();
                addToast('warning', 'Session auto-paused — Zoom not detected');
            }
        } else if (!prev && agentZoomDetected) {
            // Zoom recovered — refresh the dialer and clear the warning (no auto-resume)
            setZoomLostDuringSession(false);
            refreshDialer();
            addToast('success', 'Zoom detected — dialer refreshed. Resume session when ready.');
        }
    }, [agentConnected, agentZoomDetected, session, refreshDialer, addToast]);

    // ---------------------------------------------------------------------------
    // Mid-session agent loss — block calls when the local agent disconnects
    // during an active session.
    // ---------------------------------------------------------------------------
    const [agentLostDuringSession, setAgentLostDuringSession] = useState(false);
    const prevAgentConnectedRef = useRef<boolean | null>(null);

    useEffect(() => {
        if (!session || session.status !== 'active') {
            setAgentLostDuringSession(false);
            prevAgentConnectedRef.current = null;
            return;
        }

        const prev = prevAgentConnectedRef.current;
        prevAgentConnectedRef.current = agentConnected;

        if (prev === null) return; // first render — skip transition check

        if (prev && !agentConnected) {
            // Agent disconnected mid-session — auto-pause
            setAgentLostDuringSession(true);
            if (!session.paused_at) {
                pauseSessionRef.current();
                addToast('warning', 'Session auto-paused — CRM Agent disconnected');
            }
        } else if (!prev && agentConnected) {
            // Agent reconnected (no auto-resume)
            setAgentLostDuringSession(false);
            addToast('success', 'CRM Agent reconnected. Resume session when ready.');
        }
    }, [agentConnected, session, addToast]);

    // ---------------------------------------------------------------------------
    // Audio disconnect (Reconnect Audio screen) — auto-pause when Zoom reports
    // audio disconnection while NOT on an active call. If on a call, skip the
    // pause so the call and recording can continue uninterrupted.
    // ---------------------------------------------------------------------------
    const prevAudioDisconnectedRef = useRef(false);

    useEffect(() => {
        if (!session || session.status !== 'active') {
            prevAudioDisconnectedRef.current = false;
            return;
        }

        const prev = prevAudioDisconnectedRef.current;
        prevAudioDisconnectedRef.current = isAudioDisconnected;

        const isOnCall = callStatus === 'ringing' || callStatus === 'connected';

        if (!prev && isAudioDisconnected) {
            if (isOnCall) {
                // On a call — don't pause, let call and recording continue
                addToast('warning', 'Reconnect Audio detected — call still active, session not paused');
            } else if (!session.paused_at) {
                // Not on a call — auto-pause
                pauseSessionRef.current();
                addToast('warning', 'Session auto-paused — Reconnect Audio detected');
            }
        } else if (prev && !isAudioDisconnected && !isOnCall) {
            // Audio reconnected outside a call (no auto-resume)
            addToast('success', 'Audio reconnected. Resume session when ready.');
        }
    }, [isAudioDisconnected, session, callStatus, addToast]);

    // ---------------------------------------------------------------------------
    // Power Dialer state
    // ---------------------------------------------------------------------------
    const [powerDialerQueue, setPowerDialerQueue] = useState<DialerEntry[]>([]);
    const [powerDialerIndex, setPowerDialerIndex] = useState(0);
    const [powerDialerActive, setPowerDialerActive] = useState(false);
    const [powerDialerPaused, setPowerDialerPaused] = useState(false);
    const [powerDialerDelay, setPowerDialerDelay] = useState(0); // seconds; negative = start next call before submit
    // Pins the old call's phone number in the form during a negative-delay overlap
    const [pinnedFormPhoneNumber, setPinnedFormPhoneNumber] = useState('');
    // Company name suggested from power dialer queue for the current call
    const [suggestedCompanyName, setSuggestedCompanyName] = useState('');
    // Auto-hangup: ON by default when power dialer is active
    const [autoHangupEnabled, setAutoHangupEnabled] = useState(false);
    const [autoHangupSeconds, setAutoHangupSeconds] = useState(15);
    const powerDialerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Tracks whether the power dialer was auto-paused by a session pause
    const powerDialerAutoPausedRef = useRef(false);
    // Counts form submissions in negative-delay mode to detect when all calls are logged
    const powerDialerNegSubmitCountRef = useRef(0);

    // Refs for reading power dialer state inside effects/timers without stale closures
    const powerDialerQueueRef = useRef<DialerEntry[]>(powerDialerQueue);
    const powerDialerIndexRef = useRef(powerDialerIndex);
    const powerDialerActiveRef = useRef(powerDialerActive);
    const powerDialerPausedRef = useRef(powerDialerPaused);
    const powerDialerDelayRef = useRef(powerDialerDelay);
    // Keep refs in sync every render
    powerDialerQueueRef.current = powerDialerQueue;
    powerDialerIndexRef.current = powerDialerIndex;
    powerDialerActiveRef.current = powerDialerActive;
    powerDialerPausedRef.current = powerDialerPaused;
    powerDialerDelayRef.current = powerDialerDelay;

    // ---------------------------------------------------------------------------
    // Follow-up Notifications state
    // ---------------------------------------------------------------------------
    const [activeNotifications, setActiveNotifications] = useState<FollowUpNotification[]>([]);
    const isInCallForNotifications = callStatus === 'ringing' || callStatus === 'connected';

    const handleFollowUpNotification = useCallback((notification: FollowUpNotification) => {
        setActiveNotifications(prev => {
            // Avoid duplicates
            if (prev.some(n => n.id === notification.id)) return prev;
            return [...prev, notification];
        });
    }, []);

    const handleDismissNotification = useCallback((id: string) => {
        setActiveNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    // Use the follow-up notifications hook
    useFollowUpNotifications({
        isOnCall: isInCallForNotifications,
        enabled: !!session && session.status === 'active',
        onNotification: handleFollowUpNotification,
    });

    // Add follow-up to power dialer queue
    const handleAddFollowUpToDialer = useCallback((entry: DialerEntry) => {
        // Check for duplicates first (outside state updater to avoid side effects during render)
        const isDuplicate = powerDialerQueue.some(e => e.number === entry.number);
        if (isDuplicate) {
            addToast('info', `${entry.company || entry.number} is already in the dialer queue`);
            return;
        }
        setPowerDialerQueue(prev => [...prev, entry]);
        addToast('success', `Added ${entry.company || entry.number} to power dialer`);
    }, [powerDialerQueue, addToast]);

    // Dial a follow-up immediately
    const handleDialFollowUp = useCallback((phoneNumber: string, companyName?: string) => {
        // Check if we can dial
        if (isDialing || callStatus === 'ringing' || callStatus === 'connected') {
            addToast('warning', 'A call is already in progress');
            return;
        }
        if (hasUnsavedCall) {
            addToast('warning', 'Save or discard the current call first');
            return;
        }
        if (session?.paused_at) {
            addToast('warning', 'Resume the session to make calls');
            return;
        }
        // Set the suggested company name for the form
        if (companyName) {
            setSuggestedCompanyName(companyName);
        }
        setCurrentPhoneNumber(phoneNumber);
        // Dial the number
        dialNumber(phoneNumber);
    }, [isDialing, callStatus, hasUnsavedCall, session?.paused_at, dialNumber, addToast]);

    // Pre-fill call form with follow-up company (only if form is empty)
    const handleSelectFollowUpCompany = useCallback((companyId: string, companyName: string, phoneNumber?: string) => {
        if (hasUnsavedCall) return;
        setSuggestedCompanyName(companyName);
        if (phoneNumber) {
            setCurrentPhoneNumber(phoneNumber);
        }
        addToast('info', `Selected ${companyName} for next call`);
    }, [hasUnsavedCall, addToast]);

    // Auto-enable hangup when power dialer activates; disable when it stops
    useEffect(() => {
        if (powerDialerActive) {
            setAutoHangupEnabled(true);
            setAutoHangup(true, autoHangupSeconds);
        } else {
            setAutoHangup(false);
        }
    }, [powerDialerActive]); // eslint-disable-line react-hooks/exhaustive-deps

    // ---------------------------------------------------------------------------
    // Power dialer persistence — stored in user_preferences.power_dialer_state
    // so progress is shared across devices and survives across CRM sessions.
    // ---------------------------------------------------------------------------
    const didHydrateDialerRef = useRef(false);
    const [dialerHydrated, setDialerHydrated] = useState(false);
    const powerDialerPrefsRecordIdRef = useRef<string | null>(null);

    // Load from PocketBase on mount
    useEffect(() => {
        if (!user || didHydrateDialerRef.current) return;
        didHydrateDialerRef.current = true;

        pb.collection(COLLECTIONS.USER_PREFERENCES).getList<UserPreferences>(1, 1, {
            filter: `user = "${user.id}"`,
        }).then(result => {
            if (result.items.length > 0) {
                powerDialerPrefsRecordIdRef.current = result.items[0].id;
                const saved = result.items[0].power_dialer_state;
                if (saved && Array.isArray(saved.queue) && saved.queue.length > 0) {
                    setPowerDialerQueue(saved.queue);
                    setPowerDialerIndex(typeof saved.currentIndex === 'number' ? saved.currentIndex : 0);
                    if (typeof saved.delay === 'number') setPowerDialerDelay(saved.delay);
                    if (typeof saved.autoHangupEnabled === 'boolean') setAutoHangupEnabled(saved.autoHangupEnabled);
                    if (typeof saved.autoHangupSeconds === 'number') setAutoHangupSeconds(saved.autoHangupSeconds);
                }
            }
        }).catch(err => {
            console.error('Failed to load power dialer state:', err);
        }).finally(() => {
            setDialerHydrated(true);
        });
    }, [user]);

    // Persist to PocketBase (debounced 1.5s) whenever state changes — only after hydration
    const savePowerDialerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!user || !dialerHydrated) return;

        if (savePowerDialerTimerRef.current) clearTimeout(savePowerDialerTimerRef.current);
        savePowerDialerTimerRef.current = setTimeout(async () => {
            const stateToSave = powerDialerQueue.length === 0 ? null : {
                queue: powerDialerQueue,
                currentIndex: powerDialerIndex,
                delay: powerDialerDelay,
                autoHangupEnabled,
                autoHangupSeconds,
            };
            try {
                if (powerDialerPrefsRecordIdRef.current) {
                    await pb.collection(COLLECTIONS.USER_PREFERENCES).update(
                        powerDialerPrefsRecordIdRef.current,
                        { power_dialer_state: stateToSave }
                    );
                } else {
                    // Record not yet cached — look it up first
                    const result = await pb.collection(COLLECTIONS.USER_PREFERENCES).getList<UserPreferences>(1, 1, {
                        filter: `user = "${user.id}"`,
                    });
                    if (result.items.length > 0) {
                        powerDialerPrefsRecordIdRef.current = result.items[0].id;
                        await pb.collection(COLLECTIONS.USER_PREFERENCES).update(
                            result.items[0].id,
                            { power_dialer_state: stateToSave }
                        );
                    } else {
                        // First-time user with no preferences record yet — create one
                        const created = await pb.collection(COLLECTIONS.USER_PREFERENCES).create<UserPreferences>({
                            user: user.id,
                            power_dialer_state: stateToSave,
                        });
                        powerDialerPrefsRecordIdRef.current = created.id;
                    }
                }
            } catch (err) {
                console.error('Failed to save power dialer state:', err);
            }
        }, 1500);

        return () => {
            if (savePowerDialerTimerRef.current) clearTimeout(savePowerDialerTimerRef.current);
        };
    }, [user, dialerHydrated, powerDialerQueue, powerDialerIndex, powerDialerDelay, autoHangupEnabled, autoHangupSeconds]);

    // ---------------------------------------------------------------------------
    // Multi-tab prevention — claim a tab lock and warn if another tab owns it
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const myTabId = tabId.current;

        const checkAndClaim = () => {
            try {
                const raw = localStorage.getItem(SESSION_TAB_LOCK_KEY);
                if (raw) {
                    const lock = JSON.parse(raw) as { tabId: string; ts: number };
                    if (lock.tabId !== myTabId && Date.now() - lock.ts < SESSION_TAB_LOCK_TTL) {
                        setOtherTabActive(true);
                        return false; // Another tab owns the lock
                    }
                }
            } catch { /* ignore */ }
            setOtherTabActive(false);
            localStorage.setItem(SESSION_TAB_LOCK_KEY, JSON.stringify({ tabId: myTabId, ts: Date.now() }));
            return true;
        };

        checkAndClaim();

        const heartbeat = setInterval(checkAndClaim, SESSION_TAB_LOCK_HEARTBEAT);

        return () => {
            clearInterval(heartbeat);
            try {
                const raw = localStorage.getItem(SESSION_TAB_LOCK_KEY);
                if (raw) {
                    const lock = JSON.parse(raw) as { tabId: string; ts: number };
                    if (lock.tabId === myTabId) {
                        localStorage.removeItem(SESSION_TAB_LOCK_KEY);
                    }
                }
            } catch { /* ignore */ }
        };
    }, []);

    // ---------------------------------------------------------------------------
    // Restore unsaved call + draft from localStorage
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (didHydrateFromStorage.current) return;
        didHydrateFromStorage.current = true;

        try {
            const raw = window.localStorage.getItem(UNSAVED_CALL_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw) as UnsavedCallStoragePayload;
            if (parsed && typeof parsed.phoneNumber === 'string') {
                if (parsed.phoneNumber) {
                    setCurrentPhoneNumber(parsed.phoneNumber);
                    setContextPhoneNumber(parsed.phoneNumber);
                }
                setHasUnsavedCall(!!parsed.hasUnsavedCall);
                setCallDraft(parsed.draft ?? null);
            }
        } catch {
            // Ignore malformed storage payloads
        }
    }, [setContextPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Persist unsaved call + draft to localStorage
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const shouldPersist = hasUnsavedCall || (!!currentPhoneNumber && hasDraftContent(callDraft));

        if (!shouldPersist) {
            window.localStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);
            return;
        }

        const payload: UnsavedCallStoragePayload = {
            phoneNumber: currentPhoneNumber,
            hasUnsavedCall,
            draft: callDraft,
        };

        window.localStorage.setItem(UNSAVED_CALL_STORAGE_KEY, JSON.stringify(payload));
    }, [hasUnsavedCall, currentPhoneNumber, callDraft]);

    // ---------------------------------------------------------------------------
    // Timer logic
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (session && session.status === 'active') {
            const started = new Date(session.started_at).getTime();
            const totalPausedSec = session.total_paused_sec ?? 0;
            const updateElapsed = () => {
                const now = Date.now();
                // Subtract accumulated pause time and current pause duration so
                // the timer only counts active calling time.
                // When paused, (now - started) - totalPausedSec - (now - paused_at)
                // simplifies to a constant, naturally freezing the display.
                const currentPauseSec = session.paused_at
                    ? Math.floor((now - new Date(session.paused_at).getTime()) / 1000)
                    : 0;
                setElapsedSec(Math.floor((now - started) / 1000) - totalPausedSec - currentPauseSec);
            };
            updateElapsed();
            timerRef.current = setInterval(updateElapsed, 1000);
            return () => {
                if (timerRef.current) clearInterval(timerRef.current);
            };
        } else {
            setElapsedSec(0);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    }, [session]);

    // ---------------------------------------------------------------------------
    // Track call status and timing
    // ---------------------------------------------------------------------------
    useEffect(() => {
        // Inbound calls are handled exclusively by IncomingCallHandler — skip here
        if (callDirection === 'inbound') return;

        if (callStatus === 'ringing') {
            // Call is ringing - start ring timer
            if (!ringStartTime) {
                const now = Date.now();
                setRingStartTime(now);
                setConnectTime(null);
                setCurrentCallDuration(0);
                callEndTimeRef.current = null; // new call starting

                // Increment dial count only once when ringing starts (and only for session mode)
                // Uses PocketBase atomic increment to prevent race conditions with concurrent updates
                if (session && !dialCountIncremented) {
                    console.log('[Session Page] Incrementing dial count for session:', session.id);
                    setDialCountIncremented(true);
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                        'total_dials+': 1
                    } as any).then(updatedSession => {
                        console.log('[Session Page] Dial count updated:', updatedSession.total_dials);
                        setSession(updatedSession);
                    }).catch(err => console.error('Failed to increment dial count:', err));
                } else if (!session) {
                    console.log('[Session Page] No active session, dial count not incremented');
                } else if (dialCountIncremented) {
                    console.log('[Session Page] Dial already counted for this call');
                }
            }
        } else if (callStatus === 'connected') {
            // Call connected - mark connect time.
            // Also set ringStartTime if the call skipped the ringing phase entirely
            // (some carriers answer immediately without a ringing event).
            if (!ringStartTime) {
                setRingStartTime(Date.now());
                callEndTimeRef.current = null;
            }
            if (!connectTime) {
                setConnectTime(Date.now());

                // If the call skipped the ringing phase, increment dial count now
                // Uses PocketBase atomic increment to prevent race conditions
                if (session && !dialCountIncremented) {
                    console.log('[Session Page] Incrementing dial count at connect (no ringing phase):', session.id);
                    setDialCountIncremented(true);
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                        'total_dials+': 1
                    } as any).then(updatedSession => {
                        console.log('[Session Page] Dial count updated at connect:', updatedSession.total_dials);
                        setSession(updatedSession);
                    }).catch(err => console.error('Failed to increment dial count at connect:', err));
                }

                // Increment pickup count when call is connected (only for session mode)
                // Uses PocketBase atomic increment to prevent race conditions
                if (session && !pickupCountIncremented) {
                    setPickupCountIncremented(true);
                    pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                        'total_pickups+': 1
                    } as any).then(updatedSession => {
                        setSession(updatedSession);
                    }).catch(err => console.error('Failed to increment pickup count:', err));
                }
            }
        } else if (callStatus === 'ended') {
            // Record the exact call-end time so duration calculations are accurate
            // regardless of when the user actually submits the form.
            callEndTimeRef.current = Date.now();

            if (currentPhoneNumber) {
                setHasUnsavedCall(true);
                // Pin the phone number so the form keeps showing the old number
                // even if the power dialer auto-dials a new call (negative-delay overlap)
                setPinnedFormPhoneNumber(currentPhoneNumber);
            }

            // Automatically stop the current recording so it gets queued in deferredSegments
            if (isSessionActive && recorderStatus === 'recording') {
                console.log('[Session Page] Call ended — auto-stopping recording');
                stopRecording();
            }
        }
    }, [callStatus, callDirection, ringStartTime, connectTime, session, dialCountIncremented, pickupCountIncremented, setSession, currentPhoneNumber, isSessionActive, recorderStatus, stopRecording]);

    // ---------------------------------------------------------------------------
    // Call duration timer — separate effect so its lifecycle is tied only to
    // connectTime. The main callStatus effect sets callTimerRef but the cleanup
    // was firing when connectTime changed (batched with ringStartTime in the same
    // render cycle), clearing the interval before it could tick.
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!connectTime) {
            // Reset display when call ends/resets
            setCurrentCallDuration(0);
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
                callTimerRef.current = null;
            }
            return;
        }

        // connectTime is now set — start the live call-duration counter.
        // Capture connectTime in the closure; it won't change until reset.
        if (callTimerRef.current) clearInterval(callTimerRef.current);
        callTimerRef.current = setInterval(() => {
            setCurrentCallDuration(Math.floor((Date.now() - connectTime) / 1000));
        }, 1000);

        return () => {
            if (callTimerRef.current) {
                clearInterval(callTimerRef.current);
                callTimerRef.current = null;
            }
        };
    }, [connectTime]);

    // ---------------------------------------------------------------------------
    // Power dialer — negative delay: auto-dial next number N seconds after call ends
    // Runs independently of form submission so the user can fill the old form while
    // the next call is already ringing (overlap mode).
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (callStatus !== 'ended') return;
        if (!powerDialerActiveRef.current || powerDialerPausedRef.current) return;
        if (powerDialerDelayRef.current >= 0) return; // positive/zero delay is handled in handleSaveCall
        if (session?.paused_at) return;

        // Don't stack more than 2 unsubmitted calls — wait for the user to submit one
        if (deferredSegments.length >= 2) return;

        const nextIdx = powerDialerIndexRef.current + 1;
        if (nextIdx >= powerDialerQueueRef.current.length) {
            // Queue exhausted after this call; will be marked done when user submits the last form
            return;
        }

        if (powerDialerTimerRef.current) clearTimeout(powerDialerTimerRef.current);
        const delayMs = Math.abs(powerDialerDelayRef.current) * 1000;
        powerDialerTimerRef.current = setTimeout(() => {
            if (!powerDialerActiveRef.current || powerDialerPausedRef.current) return;
            setPowerDialerIndex(nextIdx);
            const entry = powerDialerQueueRef.current[nextIdx];
            // handleDial is captured via ref to always use the latest version
            handleDialRef.current(entry.number, entry.company);
        }, delayMs);
    }, [callStatus, session?.paused_at, deferredSegments.length]);

    // Cleanup power dialer timer on unmount
    useEffect(() => {
        return () => {
            if (powerDialerTimerRef.current) clearTimeout(powerDialerTimerRef.current);
        };
    }, []);

    // NOTE: dialCountIncremented / pickupCountIncremented are reset in
    // handleSaveCall, handleSkipCall, and handleCallback — the only places
    // where a new call cycle truly begins. Do NOT reset them on
    // currentPhoneNumber changes, as that causes double-counting when the
    // phone number syncs mid-call (e.g. from activeCallNumber).

    // Sync currentPhoneNumber from zoom context when a call is initiated from docked dialer.
    // Handles both ringing and instantly-answered calls that skip straight to 'connected'.
    useEffect(() => {
        if (activeCallNumber && (callStatus === 'ringing' || callStatus === 'connected')) {
            // Check if this is a new call (different number or no current number)
            if (!currentPhoneNumber || activeCallNumber !== currentPhoneNumber) {
                console.log('[Session Page] New call detected from dialer:', activeCallNumber);
                setCurrentPhoneNumber(activeCallNumber);
                setContextPhoneNumber(activeCallNumber);

                // Enter deferred mode + start recording if session is active
                if (isSessionActive) {
                    console.log('[Session Page] Starting recording for call:', activeCallNumber);
                    enterDeferredMode();
                    startRecording();
                }
            }
        }
    }, [activeCallNumber, currentPhoneNumber, callStatus, setContextPhoneNumber, isSessionActive, startRecording, enterDeferredMode]);

    // Ensure recording always starts when a call connects during an active session.
    // This guarantees callback legs are recorded even if the user has disabled
    // auto-record in the call-recorder-controls panel (manual mode).
    const prevCallStatusForRecordingRef = useRef(callStatus);
    useEffect(() => {
        const prev = prevCallStatusForRecordingRef.current;
        prevCallStatusForRecordingRef.current = callStatus;

        if (!isSessionActive) return;
        // Start recording on connect (or ringing) if not already recording.
        // Ringing handles immediately-answered calls where 'ringing' fires first;
        // connected handles the fallback for calls that skip directly to 'connected'.
        // enterDeferredMode() is always called here so that instantly-answered calls
        // (which skip ringing and may bypass the activeCallNumber effect) are still
        // queued properly and linked to the call log on form submission.
        if (
            (callStatus === 'ringing' || callStatus === 'connected') &&
            prev !== callStatus &&
            recorderStatus === 'idle'
        ) {
            console.log('[Session Page] Auto-starting recording on', callStatus);
            enterDeferredMode();
            startRecording();
        }
    }, [callStatus, isSessionActive, recorderStatus, startRecording, enterDeferredMode]);

    // Fallback: if audio session becomes active WHILE a call is already connected,
    // start recording immediately (covers the race where screen share is granted
    // after Zoom fires the connected event).
    const prevIsSessionActiveRef = useRef(isSessionActive);
    useEffect(() => {
        const wasActive = prevIsSessionActiveRef.current;
        prevIsSessionActiveRef.current = isSessionActive;

        if (!wasActive && isSessionActive && (callStatus === 'ringing' || callStatus === 'connected') && recorderStatus === 'idle') {
            console.log('[Session Page] Audio session became active mid-call — starting recording');
            enterDeferredMode();
            startRecording();
        }
    }, [isSessionActive, callStatus, recorderStatus, startRecording, enterDeferredMode]);

    // Warn user before closing tab if session is active
    useEffect(() => {
        if (!session || session.status !== 'active') return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Your active session will end if you close this tab. Are you sure you want to leave?';
            return e.returnValue;
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [session]);

    // ---------------------------------------------------------------------------
    // Auto-end session after 15 minutes offline (network down while tab is open)
    // ---------------------------------------------------------------------------
    const OFFLINE_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
    useEffect(() => {
        if (!session || session.status !== 'active') {
            if (offlineTimerRef.current) {
                clearTimeout(offlineTimerRef.current);
                offlineTimerRef.current = null;
            }
            return;
        }

        const scheduleOfflineEnd = () => {
            if (offlineTimerRef.current) return; // already scheduled
            offlineStartRef.current = Date.now();
            offlineTimerRef.current = setTimeout(() => {
                offlineTimerRef.current = null;
                const offlineSec = offlineStartRef.current
                    ? Math.floor((Date.now() - offlineStartRef.current) / 1000)
                    : 0;
                offlineStartRef.current = null;
                endSessionRef.current?.(offlineSec);
            }, OFFLINE_SESSION_TIMEOUT_MS);
        };

        const cancelOfflineEnd = () => {
            if (offlineTimerRef.current) {
                clearTimeout(offlineTimerRef.current);
                offlineTimerRef.current = null;
            }
            offlineStartRef.current = null;
        };

        window.addEventListener('offline', scheduleOfflineEnd);
        window.addEventListener('online', cancelOfflineEnd);

        // If already offline when session becomes active, start the timer immediately
        if (!navigator.onLine) {
            scheduleOfflineEnd();
        }

        return () => {
            window.removeEventListener('offline', scheduleOfflineEnd);
            window.removeEventListener('online', cancelOfflineEnd);
            cancelOfflineEnd();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    // ---------------------------------------------------------------------------
    // Start session — step 1: show "Connect Audio" screen
    // ---------------------------------------------------------------------------
    const startSession = useCallback(() => {
        setPendingTestSession(false);
        setAwaitingAudioConnect(true);
    }, []);

    // ---------------------------------------------------------------------------
    // Start test session — same flow but marks session as is_test
    // ---------------------------------------------------------------------------
    const startTestSession = useCallback(() => {
        setPendingTestSession(true);
        setAwaitingAudioConnect(true);
    }, []);

    // ---------------------------------------------------------------------------
    // Connect audio & create PB session — step 2
    // ---------------------------------------------------------------------------
    const handleConnectAudioAndStart = useCallback(async () => {
        if (!user) return;
        try {
            setStarting(true);

            // In virtual dialer test mode, skip real audio session entirely.
            // The mock getDisplayMedia stream ends immediately in Playwright's
            // Chromium, which triggers handleStreamEnded → isSessionActive=false
            // and cascades into session cleanup. Tests don't need real recording.
            // Check window directly to avoid stale useCallback closure issues.
            const isTestMode = typeof window !== 'undefined' && !!(window as any).__TEST_VIRTUAL_DIALER;
            if (!isTestMode) {
                // 1. Start audio session (screen share) first
                const audioStarted = await startAudioSession();
                if (!audioStarted) {
                    // User cancelled or failed - stay on Connect Audio screen
                    return;
                }
            }

            // 2. Create the session in PocketBase only after screen share is secured
            const newSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).create<ColdCallingSession>({
                user: user.id,
                started_at: new Date().toISOString(),
                total_dials: 0,
                total_pickups: 0,
                total_duration_sec: 0,
                owner_reached: 0,
                pitch_completed: 0,
                appointment_set: 0,
                status: 'active',
                paused_at: null,
                total_paused_sec: 0,
                is_test: pendingTestSession,
            });
            setPendingTestSession(false);
            setSession(newSession);
            setAwaitingAudioConnect(false);
        } catch (err: any) {
            if (err?.status === 404) {
                setCollectionMissing(true);
            } else {
                console.error('Failed to start session:', err);
            }
        } finally {
            setStarting(false);
        }
    }, [user, setSession, startAudioSession, pendingTestSession]);

    // ---------------------------------------------------------------------------
    // End session
    // offlineSubtractSec: seconds to subtract from elapsed (used when auto-ending due to offline)
    // ---------------------------------------------------------------------------
    const endSession = useCallback(async (offlineSubtractSec = 0) => {
        if (!session) return;
        const wasTestSession = session.is_test;
        const sessionId = session.id;
        try {
            setEnding(true);
            const finalDuration = Math.max(0, elapsedSec - offlineSubtractSec);
            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, {
                ended_at: new Date().toISOString(),
                total_duration_sec: finalDuration,
                status: 'completed',
                on_call: false,
            });
            setSession(null);
            setLastCallLog(null);
            setLastCallCompanyName('');
            setCurrentPhoneNumber('');
            setHasUnsavedCall(false);
            setCallDraft(null);
            setCallbackEvents([]);
            setContextPhoneNumber(''); // Clear phone number in context
            window.localStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);
            window.localStorage.removeItem('crm:session:last-call:v1');

            // Stop screenshare / audio session when call session ends
            endAudioSession();

            // Stop power dialer automation — keep queue & progress so they persist
            // into the next session. Index and queue are intentionally NOT reset here.
            setPowerDialerActive(false);
            setPowerDialerPaused(false);
            setPinnedFormPhoneNumber('');
            if (powerDialerTimerRef.current) {
                clearTimeout(powerDialerTimerRef.current);
                powerDialerTimerRef.current = null;
            }

            // For test sessions, offer cleanup
            if (wasTestSession) {
                setTestSessionCleanupId(sessionId);
                setCleanupError('');
                setShowTestCleanupModal(true);
            }
        } catch (err) {
            console.error('Failed to end session:', err);
        } finally {
            setEnding(false);
        }
    }, [session, elapsedSec, setSession, setContextPhoneNumber, endAudioSession]);

    // Keep endSessionRef in sync so the offline watchdog can always call the
    // latest version without a stale closure (declared here, after endSession).
    useEffect(() => { endSessionRef.current = endSession; }, [endSession]);

    // ---------------------------------------------------------------------------
    // Fetch last completed session (for resume feature)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!user || session) {
            setLastCompletedSession(null);
            return;
        }
        pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getList<ColdCallingSession>(1, 1, {
            filter: `user = "${user.id}" && status = "completed" && is_test = false`,
            sort: '-ended_at',
        }).then(result => {
            setLastCompletedSession(result.items[0] ?? null);
        }).catch(() => setLastCompletedSession(null));
    }, [user, session]);

    // ---------------------------------------------------------------------------
    // Resume last completed session
    // The gap between ended_at and now is added to total_paused_sec so the
    // elapsed timer continues from exactly where it stopped.
    // ---------------------------------------------------------------------------
    const resumeLastSession = useCallback(async () => {
        if (!lastCompletedSession?.ended_at) return;
        try {
            setResuming(true);
            const gapSec = Math.floor(
                (Date.now() - new Date(lastCompletedSession.ended_at).getTime()) / 1000
            );
            const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                lastCompletedSession.id,
                {
                    status: 'active',
                    ended_at: null,
                    total_paused_sec: (lastCompletedSession.total_paused_sec ?? 0) + gapSec,
                }
            );
            setSession(updated);
            setLastCompletedSession(null);
        } catch (err) {
            console.error('Failed to resume session:', err);
        } finally {
            setResuming(false);
        }
    }, [lastCompletedSession, setSession]);

    // ---------------------------------------------------------------------------
    // Test session cleanup — delete all data created during the test session
    // ---------------------------------------------------------------------------
    const handleDeleteTestData = useCallback(async () => {
        if (!testSessionCleanupId) return;
        setCleaningUp(true);
        setCleanupError('');
        try {
            // 1. Get all call logs for this session
            const callLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                filter: `session = "${testSessionCleanupId}"`,
            });
            const callLogIds = callLogs.map(l => l.id);

            // 2. Delete recordings linked to those call logs
            if (callLogIds.length > 0) {
                const recordings = await pb.collection(COLLECTIONS.RECORDINGS).getFullList<Recording>({
                    filter: callLogIds.map(id => `call_log = "${id}"`).join(' || '),
                });
                await Promise.allSettled(recordings.map(r => pb.collection(COLLECTIONS.RECORDINGS).delete(r.id)));
            }

            // 3. Delete follow-ups linked to those call logs
            if (callLogIds.length > 0) {
                const followUps = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
                    filter: callLogIds.map(id => `call_log = "${id}"`).join(' || '),
                });
                await Promise.allSettled(followUps.map(f => pb.collection(COLLECTIONS.FOLLOW_UPS).delete(f.id)));
            }

            // 4. Delete all call logs
            await Promise.allSettled(callLogs.map(l => pb.collection(COLLECTIONS.CALL_LOGS).delete(l.id)));

            // 5. Delete companies that were created solely during this test session
            //    (i.e. they have no call logs outside this session)
            const companyIds = [...new Set(callLogs.map(l => l.company).filter(Boolean))];
            if (companyIds.length > 0) {
                const companiesOnlyInSession: string[] = [];
                await Promise.allSettled(
                    companyIds.map(async (companyId) => {
                        try {
                            const otherLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getList(1, 1, {
                                filter: `company = "${companyId}" && session != "${testSessionCleanupId}"`,
                            });
                            if (otherLogs.totalItems === 0) {
                                companiesOnlyInSession.push(companyId);
                            }
                        } catch { /* skip if check fails */ }
                    })
                );
                // Delete phone number records and then the companies themselves
                for (const companyId of companiesOnlyInSession) {
                    try {
                        const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList({
                            filter: `company = "${companyId}"`,
                        });
                        await Promise.allSettled(phones.map(p => pb.collection(COLLECTIONS.PHONE_NUMBERS).delete(p.id)));
                        await pb.collection(COLLECTIONS.COMPANIES).delete(companyId);
                    } catch { /* skip if delete fails */ }
                }
            }

            // 6. Delete the session record
            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).delete(testSessionCleanupId);

            setShowTestCleanupModal(false);
            setTestSessionCleanupId(null);
        } catch (err) {
            console.error('Failed to delete test session data:', err);
            setCleanupError('Some items could not be deleted. You can delete this session from Session Logs later.');
        } finally {
            setCleaningUp(false);
        }
    }, [testSessionCleanupId]);

    const handleKeepTestData = useCallback(() => {
        setShowTestCleanupModal(false);
        setTestSessionCleanupId(null);
    }, []);

    // ---------------------------------------------------------------------------
    // Pause session
    // ---------------------------------------------------------------------------
    const isInCall = callStatus === 'ringing' || callStatus === 'connected';

    const pauseSession = useCallback(async () => {
        if (!session || session.paused_at) return;
        if (callStatus === 'ringing' || callStatus === 'connected') return;
        try {
            setPausing(true);
            const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                paused_at: new Date().toISOString(),
            });
            setSession(updated);
            // Auto-pause the power dialer when session is paused
            if (powerDialerActiveRef.current && !powerDialerPausedRef.current) {
                setPowerDialerPaused(true);
                powerDialerAutoPausedRef.current = true;
                if (powerDialerTimerRef.current) {
                    clearTimeout(powerDialerTimerRef.current);
                    powerDialerTimerRef.current = null;
                }
            }
        } catch (err) {
            console.error('Failed to pause session:', err);
        } finally {
            setPausing(false);
        }
    }, [session, setSession, callStatus]);

    // ---------------------------------------------------------------------------
    // Resume session
    // ---------------------------------------------------------------------------
    const resumeSession = useCallback(async () => {
        if (!session || !session.paused_at) return;
        try {
            setPausing(true);
            const pausedDuration = Math.floor((Date.now() - new Date(session.paused_at).getTime()) / 1000);
            const updated = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(session.id, {
                paused_at: null,
                total_paused_sec: (session.total_paused_sec ?? 0) + pausedDuration,
            });
            setSession(updated);
            // Keep the power dialer paused — user must manually resume it
            powerDialerAutoPausedRef.current = false;
        } catch (err) {
            console.error('Failed to resume session:', err);
        } finally {
            setPausing(false);
        }
    }, [session, setSession]);

    // Ref so effects defined earlier in the file can call the latest pauseSession
    const pauseSessionRef = useRef(pauseSession);
    pauseSessionRef.current = pauseSession;

    // ---------------------------------------------------------------------------
    // Start standalone mode
    // ---------------------------------------------------------------------------
    const startStandalone = useCallback(() => {
        setStandaloneMode(true);
    }, [setStandaloneMode]);

    // ---------------------------------------------------------------------------
    // Exit standalone mode
    // ---------------------------------------------------------------------------
    const exitStandalone = useCallback(() => {
        setStandaloneMode(false);
        setLastCallLog(null);
        setLastCallCompanyName('');
        setCurrentPhoneNumber('');
    }, [setStandaloneMode]);

    // ---------------------------------------------------------------------------
    // Handle dial
    // ---------------------------------------------------------------------------
    const handleDial = useCallback((phoneNumber: string, companyName?: string) => {
        // Prevent double dialing
        if (isDialing || callStatus === 'ringing' || callStatus === 'connected') {
            console.log('Call already in progress, ignoring dial request');
            return;
        }

        // Prevent dialing while session is paused
        if (session?.paused_at) {
            console.log('Session is paused, ignoring dial request');
            return;
        }

        // Prevent dialing when agent is not connected
        if (!agentConnected) {
            console.log('Agent not connected, blocking dial request');
            addToast('error', 'CRM Agent is not running — launch the agent to make calls');
            return;
        }

        // Prevent dialing when Zoom is not detected (agent reports no Zoom process)
        if (!agentZoomDetected) {
            console.log('Zoom not detected, blocking dial request');
            addToast('error', 'Zoom is not running — open Zoom to make calls');
            return;
        }

        setCurrentPhoneNumber(phoneNumber);
        setContextPhoneNumber(phoneNumber); // Update phone number in context
        // Pass company suggestion from power dialer to the form
        setSuggestedCompanyName(companyName || '');

        // NOTE: Do NOT start recording here — recording will begin automatically
        // when Zoom confirms the call is ringing/connected (via callStatus effects).
        // Starting recording before Zoom confirms causes false recording states
        // when the iframe fails to process the dial command.

        dialNumber(phoneNumber);
    }, [dialNumber, setContextPhoneNumber, isDialing, callStatus, session?.paused_at, agentConnected, agentZoomDetected, addToast]);

    // Ref so power dialer timers always call the latest handleDial (avoids stale closures)
    const handleDialRef = useRef(handleDial);
    handleDialRef.current = handleDial;

    // ---------------------------------------------------------------------------
    // Handle callback — dial same number, create a separate queued recording segment
    // ---------------------------------------------------------------------------
    const handleCallback = useCallback((reason: string) => {
        if (!currentPhoneNumber) return;

        // Log this callback event
        const event = { reason, timestamp: new Date().toISOString() };
        setCallbackEvents(prev => [...prev, event]);

        // Reset timing for the new call leg
        setRingStartTime(null);
        setConnectTime(null);
        setCurrentCallDuration(0);
        setDialCountIncremented(false);
        setPickupCountIncremented(false);
        callEndTimeRef.current = null;

        // The previous leg's recording is already queued (added in onstop when the call ended).
        // Deferred mode remains active so the new leg will also be queued.
        // Recording for this leg will start automatically when the call connects
        // via the prevCallStatusForRecordingRef effect above (session-wide connect handler),
        // which fires regardless of the auto-record setting in call-recorder-controls.
        dialNumber(currentPhoneNumber);
    }, [currentPhoneNumber, dialNumber]);

    // ---------------------------------------------------------------------------
    // Save call
    // ---------------------------------------------------------------------------
    const handleSaveCall = useCallback((data: CallFormData) => {
        if (!session || !user) return;

        // Capture timing values before clearing state.
        // Use callEndTimeRef for the end time so we measure when the call actually
        // ended, not when the user happened to submit the form (which could be minutes later).
        const capturedRingStart = ringStartTime;
        const capturedConnectTime = connectTime;
        const capturedEndTime = callEndTimeRef.current ?? Date.now();
        const capturedPickupIncremented = pickupCountIncremented;

        // Determine if this call involved callbacks
        const hasCallbacks = (data.callbackEvents?.length ?? 0) > 0;

        // For No Answer, discard recording(s) immediately.
        // For calls with callback legs, discard ALL segments (not just oldest)
        // to prevent orphaned callback recordings from attaching to the next call.
        if (data.callOutcome.includes('No Answer')) {
            if (hasCallbacks) {
                discardDeferredRecording();
            } else {
                discardOldestDeferredRecording();
            }
            setContextPhoneNumber('');
        }

        // ── INSTANT UI RESET ── user can start the next call right away
        setLastCallCompanyName(data.companyName);
        // Use functional update to preserve the NEXT call's phone number.
        // In negative-delay power dialer mode, handleDial already set
        // currentPhoneNumber to the next call's number before the user
        // submitted this form. Clearing it unconditionally loses that number,
        // and the activeCallNumber sync effect won't restore it because
        // callStatus has already transitioned to 'idle'.
        const savedDigits = data.phoneNumber.replace(/\D/g, '').slice(-10);
        setCurrentPhoneNumber(prev => {
            const prevDigits = prev?.replace(/\D/g, '').slice(-10) || '';
            if (!prev || prevDigits === savedDigits) return '';
            // Phone number belongs to a different (newer) call — preserve it
            return prev;
        });
        setHasUnsavedCall(false);
        setCallDraft(null);
        setCallbackEvents([]);
        setPinnedFormPhoneNumber('');
        setRingStartTime(null);
        setConnectTime(null);
        setCurrentCallDuration(0);
        setDialCountIncremented(false);
        setPickupCountIncremented(false);
        callEndTimeRef.current = null;
        window.localStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);

        // Advance power dialer immediately (before background API calls).
        // Always advance the index even when paused — the call is done regardless.
        // Only schedule the next dial when not paused.
        if (powerDialerActiveRef.current && powerDialerDelayRef.current >= 0) {
            const nextIdx = powerDialerIndexRef.current + 1;
            setPowerDialerIndex(nextIdx);
            if (nextIdx >= powerDialerQueueRef.current.length) {
                setPowerDialerActive(false);
            } else if (!powerDialerPausedRef.current) {
                if (powerDialerTimerRef.current) clearTimeout(powerDialerTimerRef.current);
                const delayMs = powerDialerDelayRef.current * 1000;
                const nextEntry = powerDialerQueueRef.current[nextIdx];
                powerDialerTimerRef.current = setTimeout(() => {
                    handleDialRef.current(nextEntry.number, nextEntry.company);
                }, delayMs);
            }
        }
        if (powerDialerActiveRef.current && !powerDialerPausedRef.current && powerDialerDelayRef.current < 0) {
            powerDialerNegSubmitCountRef.current += 1;
            if (powerDialerNegSubmitCountRef.current >= powerDialerQueueRef.current.length) {
                setPowerDialerIndex(powerDialerQueueRef.current.length);
                setPowerDialerActive(false);
                powerDialerNegSubmitCountRef.current = 0;
            }
        }

        // ── BACKGROUND SAVE ── fire-and-forget API work
        void (async () => {
            try {
                // Find or create phone number record
                let phoneNumberRecordId = '';
                try {
                    const digits = data.phoneNumber.replace(/\D/g, '');
                    const last10 = digits.slice(-10);
                    const filterParts = [`phone_number = "${data.phoneNumber}"`];
                    if (digits !== data.phoneNumber) filterParts.push(`phone_number ~ "${digits}"`);
                    if (last10 !== digits && last10.length >= 7) filterParts.push(`phone_number ~ "${last10}"`);

                    const phoneRecords = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
                        filter: `company = "${data.companyId}" && (${filterParts.join(' || ')})`,
                    });
                    if (phoneRecords.items.length > 0) {
                        phoneNumberRecordId = phoneRecords.items[0].id;
                    } else {
                        const newPhone = await pb.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                            company: data.companyId,
                            phone_number: data.phoneNumber,
                            receptionist_name: data.receptionistName || undefined,
                            last_called: new Date().toISOString(),
                        });
                        phoneNumberRecordId = newPhone.id;
                    }
                } catch { /* ignore — still log the call */ }

                // Calculate call durations from captured values.
                // capturedEndTime is set when callStatus became 'ended', so it reflects
                // the real call-end moment even if the user submits the form much later.
                let ringDuration = 0, callDuration = 0, totalDuration = 0;
                if (capturedRingStart) {
                    if (capturedConnectTime) {
                        ringDuration = Math.floor((capturedConnectTime - capturedRingStart) / 1000);
                        callDuration = Math.floor((capturedEndTime - capturedConnectTime) / 1000);
                        totalDuration = ringDuration + callDuration;
                    } else {
                        // Call rang but never connected (no answer)
                        ringDuration = Math.floor((capturedEndTime - capturedRingStart) / 1000);
                        totalDuration = ringDuration;
                    }
                }

                // Create call log
                const callLog = await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
                    company: data.companyId,
                    phone_number_record: phoneNumberRecordId || undefined,
                    caller: user.id,
                    call_time: new Date().toISOString(),
                    duration: totalDuration > 0 ? totalDuration : undefined,
                    ring_duration: ringDuration > 0 ? ringDuration : undefined,
                    call_duration: callDuration > 0 ? callDuration : undefined,
                    call_outcome: data.callOutcome,
                    post_call_notes: data.postCallNotes || undefined,
                    receptionist_name: data.receptionistName || undefined,
                    owner_name_found: data.ownerName || undefined,
                    session: session.id,
                    owner_reached: data.ownerReached,
                    pitch_completed: data.pitchCompleted,
                    appointment_set: data.appointmentSet,
                    callback_events: data.callbackEvents?.length ? data.callbackEvents : undefined,
                    is_callback: hasCallbacks ? true : undefined,
                }, { expand: 'company,phone_number_record' });
                // Submit this call's recording.
                // For calls with callback legs, merge ALL queued segments into one recording
                // (each callback re-dial creates a separate segment). For normal calls,
                // pop only the oldest segment so other calls' recordings stay in the queue.
                if (!data.callOutcome.includes('No Answer')) {
                    const submitFn = hasCallbacks
                        ? submitDeferredRecording    // merge all segments (callback legs)
                        : submitOldestDeferredRecording; // pop one segment (normal call)
                    submitFn(callLog.id).then(recordingId => {
                        if (recordingId) {
                            pb.collection(COLLECTIONS.CALL_LOGS).update(callLog.id, {
                                has_recording: true,
                            }).catch(err => console.error('Failed to mark has_recording:', err));
                        }
                    }).catch(err => console.error('Failed to submit recording:', err));
                    setContextPhoneNumber('');
                }

                // Save additional phone number found during call
                if (data.additionalPhoneNumber) {
                    pb.collection(COLLECTIONS.PHONE_NUMBERS).create<PhoneNumber>({
                        company: data.companyId,
                        phone_number: data.additionalPhoneNumber,
                        receptionist_name: data.additionalPhoneNote || undefined,
                        last_called: new Date().toISOString(),
                    }).catch(err => console.error('Failed to save additional phone number:', err));
                }

                // Show last call preview
                setLastCallLog(callLog);

                // Background: session perf + company metadata + follow-up + session refresh
                void Promise.allSettled([
                    (async () => {
                        // Use PocketBase atomic increment/decrement operators to prevent
                        // race conditions when multiple calls update the session concurrently.
                        const sessionUpdates: Record<string, number> = {};
                        if (data.ownerReached) sessionUpdates['owner_reached+'] = 1;
                        if (data.pitchCompleted) sessionUpdates['pitch_completed+'] = 1;
                        if (data.appointmentSet) sessionUpdates['appointment_set+'] = 1;
                        if (hasCallbacks) sessionUpdates['total_callbacks+'] = 1;
                        if (data.callOutcome.includes('No Answer') && capturedPickupIncremented) {
                            // Atomically decrement — PB's min:0 constraint prevents going negative
                            sessionUpdates['total_pickups-'] = 1;
                        } else if (!data.callOutcome.includes('No Answer') && !capturedPickupIncremented) {
                            // Fallback: if the call was NOT marked "No Answer" but the
                            // connected-state pickup detection missed it, count it now.
                            // This ensures pickups = dials − no-answer calls.
                            sessionUpdates['total_pickups+'] = 1;
                        }
                        if (Object.keys(sessionUpdates).length > 0) {
                            await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update(session.id, sessionUpdates);
                        }
                        const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).getOne<ColdCallingSession>(session.id);
                        setSession(updatedSession);
                    })(),
                    (async () => {
                        try {
                            const companyUpdates: Record<string, unknown> = { last_contacted: new Date().toISOString() };
                            const existingCompany = await pb.collection(COLLECTIONS.COMPANIES).getOne(data.companyId);
                            if (!existingCompany.source) companyUpdates.source = 'Cold Call';
                            if (!existingCompany.first_contacted) companyUpdates.first_contacted = new Date().toISOString();
                            if (data.ownerReached && data.ownerName && !existingCompany.owner_name) {
                                companyUpdates.owner_name = data.ownerName;
                            }
                            if (data.email && !existingCompany.email) {
                                companyUpdates.email = data.email;
                            }
                            // Compute company status from last call per phone number
                            try {
                                const allLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
                                    filter: `company = "${data.companyId}"`,
                                    sort: '-call_time',
                                    fields: 'phone_number_record,call_time,call_outcome',
                                });
                                const statuses = computeCompanyStatuses(allLogs);
                                companyUpdates.status = statuses;
                            } catch { /* non-critical */ }
                            await pb.collection(COLLECTIONS.COMPANIES).update(data.companyId, companyUpdates);
                        } catch { /* non-critical */ }
                    })(),
                    data.followUp ? (async () => {
                        try {
                            await createFollowUp({
                                company: data.companyId,
                                phone_number_record: phoneNumberRecordId || undefined,
                                call_log: callLog.id,
                                scheduled_time: data.followUp!.scheduledTime,
                                client_timezone: data.followUp!.timezone,
                                notes: data.followUp!.notes || undefined,
                            });
                        } catch (err) { console.error('Failed to create follow-up:', err); }
                    })() : Promise.resolve(),
                    // Complete follow-ups the user chose to resolve in the call form
                    data.completeFollowUpIds?.length ? (async () => {
                        try {
                            for (const fuId of data.completeFollowUpIds!) {
                                await completeFollowUp(fuId);
                            }
                            addToast('success', `Completed ${data.completeFollowUpIds!.length} follow-up${data.completeFollowUpIds!.length > 1 ? 's' : ''} for ${data.companyName}`);
                        } catch { /* non-critical */ }
                    })() : Promise.resolve(),
                ]);
            } catch (err) {
                console.error('Failed to save call:', err);
            }
        })();
    }, [session, user, discardOldestDeferredRecording, discardDeferredRecording, submitOldestDeferredRecording, submitDeferredRecording, setSession, setContextPhoneNumber, ringStartTime, connectTime, pickupCountIncremented, createFollowUp, completeFollowUp, addToast]);

    const handleDiscardCall = useCallback(() => {
        // Discard ALL segments if callbacks exist (multiple recording segments queued),
        // otherwise just discard the oldest one
        if (callbackEvents.length > 0) {
            discardDeferredRecording();
        } else {
            discardOldestDeferredRecording();
        }
        setContextPhoneNumber('');

        setHasUnsavedCall(false);
        setCallDraft(null);
        setCallbackEvents([]);
        // Use functional update to preserve the NEXT call's phone number.
        // In negative-delay power dialer mode, handleDial already set
        // currentPhoneNumber to the next call's number before the user
        // discarded this form. Clearing it unconditionally loses that number.
        const discardedDigits = currentPhoneNumber?.replace(/\D/g, '').slice(-10) || '';
        setCurrentPhoneNumber(prev => {
            const prevDigits = prev?.replace(/\D/g, '').slice(-10) || '';
            if (!prev || prevDigits === discardedDigits) return '';
            return prev;
        });
        setPinnedFormPhoneNumber('');
        setRingStartTime(null);
        setConnectTime(null);
        setCurrentCallDuration(0);
        setDialCountIncremented(false);
        setPickupCountIncremented(false);
        callEndTimeRef.current = null;
        window.localStorage.removeItem(UNSAVED_CALL_STORAGE_KEY);

        // Cancel any pending power dialer auto-dial
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }

        // Advance power dialer to the next entry (same logic as save, but no API call)
        if (powerDialerActiveRef.current && powerDialerDelayRef.current >= 0) {
            const nextIdx = powerDialerIndexRef.current + 1;
            setPowerDialerIndex(nextIdx);
            if (nextIdx >= powerDialerQueueRef.current.length) {
                setPowerDialerActive(false);
            } else if (!powerDialerPausedRef.current) {
                const delayMs = powerDialerDelayRef.current * 1000;
                const nextEntry = powerDialerQueueRef.current[nextIdx];
                powerDialerTimerRef.current = setTimeout(() => {
                    handleDialRef.current(nextEntry.number, nextEntry.company);
                }, delayMs);
            }
        }
        if (powerDialerActiveRef.current && !powerDialerPausedRef.current && powerDialerDelayRef.current < 0) {
            powerDialerNegSubmitCountRef.current += 1;
            if (powerDialerNegSubmitCountRef.current >= powerDialerQueueRef.current.length) {
                setPowerDialerIndex(powerDialerQueueRef.current.length);
                setPowerDialerActive(false);
                powerDialerNegSubmitCountRef.current = 0;
            }
        }
    }, [callbackEvents, currentPhoneNumber, discardOldestDeferredRecording, discardDeferredRecording, setContextPhoneNumber]);

    // ---------------------------------------------------------------------------
    // Power dialer handlers
    // ---------------------------------------------------------------------------
    const handlePowerDialerStart = useCallback(() => {
        if (powerDialerQueue.length === 0 || hasUnsavedCall) return;
        if (callStatus === 'ringing' || callStatus === 'connected') return;
        powerDialerNegSubmitCountRef.current = 0;
        setPowerDialerActive(true);
        setPowerDialerPaused(false);
        handleDial(powerDialerQueue[powerDialerIndex].number, powerDialerQueue[powerDialerIndex].company);
    }, [powerDialerQueue, powerDialerIndex, hasUnsavedCall, callStatus, handleDial]);

    const handlePowerDialerStartFrom = useCallback((index: number) => {
        if (powerDialerQueue.length === 0 || hasUnsavedCall) return;
        if (callStatus === 'ringing' || callStatus === 'connected') return;
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
        powerDialerNegSubmitCountRef.current = 0;
        setPowerDialerIndex(index);
        setPowerDialerActive(true);
        setPowerDialerPaused(false);
        handleDial(powerDialerQueue[index].number, powerDialerQueue[index].company);
    }, [powerDialerQueue, hasUnsavedCall, callStatus, handleDial]);

    const handlePowerDialerPause = useCallback(() => {
        setPowerDialerPaused(true);
        powerDialerAutoPausedRef.current = false; // Manual pause clears auto-pause flag
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, []);

    const handlePowerDialerResume = useCallback(() => {
        setPowerDialerPaused(false);
        powerDialerAutoPausedRef.current = false; // Manual resume clears auto-pause flag
        // Next dial fires naturally on the next form-submit (positive delay) or call-end (negative delay)
    }, []);

    const handlePowerDialerStop = useCallback(() => {
        setPowerDialerActive(false);
        setPowerDialerPaused(false);
        setPowerDialerIndex(0);
        powerDialerNegSubmitCountRef.current = 0;
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, []);

    const handlePowerDialerQueueLoad = useCallback((numbers: DialerEntry[]) => {
        setPowerDialerQueue(numbers);
        setPowerDialerIndex(0);
        setPowerDialerActive(false);
        setPowerDialerPaused(false);
        if (powerDialerTimerRef.current) {
            clearTimeout(powerDialerTimerRef.current);
            powerDialerTimerRef.current = null;
        }
    }, []);

    // Reorder the power dialer queue and adjust currentIndex to maintain consistency
    const handlePowerDialerReorder = useCallback((newQueue: DialerEntry[], fromIndex: number, toIndex: number) => {
        setPowerDialerQueue(newQueue);

        // Adjust currentIndex based on the move
        setPowerDialerIndex(prevIndex => {
            // If moving an item from after current to before/at current, increment index
            if (fromIndex > prevIndex && toIndex <= prevIndex) {
                return prevIndex + 1;
            }
            // If moving an item from before/at current to after current, decrement index
            if (fromIndex <= prevIndex && toIndex > prevIndex) {
                return Math.max(0, prevIndex - 1);
            }
            // If moving the current item itself
            if (fromIndex === prevIndex) {
                return toIndex;
            }
            // No change needed
            return prevIndex;
        });
    }, []);

    // ---------------------------------------------------------------------------
    // Update performance counters
    // ---------------------------------------------------------------------------
    const handlePerformanceUpdate = useCallback(async (
        field: 'owner_reached' | 'pitch_completed' | 'appointment_set',
        value: number
    ) => {
        if (!session) return;
        try {
            // Compute delta from current session value and use atomic increment/decrement.
            // This prevents race conditions when the user clicks rapidly or when concurrent
            // updates (e.g., from handleSaveCall) modify the same counter.
            const currentValue = session[field] || 0;
            const delta = value - currentValue;
            const atomicUpdate: Record<string, number> = {};
            if (delta > 0) {
                atomicUpdate[`${field}+`] = delta;
            } else if (delta < 0) {
                atomicUpdate[`${field}-`] = Math.abs(delta);
            } else {
                return; // No change needed
            }
            const updatedSession = await pb.collection(COLLECTIONS.COLD_CALLING_SESSIONS).update<ColdCallingSession>(
                session.id,
                atomicUpdate
            );
            setSession(updatedSession);
        } catch (err) {
            console.error('Failed to update performance counter:', err);
        }
    }, [session, setSession]);

    // ---------------------------------------------------------------------------
    // Helper to render the main UI content
    // ---------------------------------------------------------------------------
    const renderContent = () => {
        if (collectionMissing) {
            return (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="text-center space-y-4 max-w-md">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--warning-subtle)] flex items-center justify-center mx-auto">
                            <AlertTriangle size={28} className="text-[var(--warning)]" />
                        </div>
                        <h1 className="text-xl font-bold">Collection Setup Required</h1>
                        <p className="text-sm text-[var(--muted)] leading-relaxed">
                            The <code className="px-1.5 py-0.5 rounded bg-[var(--sidebar-bg)] text-xs font-mono">cold_calling_sessions</code> collection
                            doesn&apos;t exist in PocketBase yet. Import the updated schema to enable Call Sessions.
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                            Import <code className="px-1 py-0.5 rounded bg-[var(--sidebar-bg)] font-mono text-[10px]">pb_db_schema.json</code> from
                            the <code className="px-1 py-0.5 rounded bg-[var(--sidebar-bg)] font-mono text-[10px]">packages/pocketbase-client</code> directory.
                        </p>
                    </div>
                </div>
            );
        }

        if (otherTabActive) {
            return (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="text-center space-y-4 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--warning)]/40 shadow-xl">
                        <div className="w-16 h-16 rounded-2xl bg-[var(--warning-subtle)] flex items-center justify-center mx-auto">
                            <AlertTriangle size={28} className="text-[var(--warning)]" />
                        </div>
                        <h1 className="text-xl font-bold">Session Open in Another Tab</h1>
                        <p className="text-sm text-[var(--muted)] leading-relaxed">
                            The call session is already running in another browser tab.
                            Please use that tab to make calls. Opening the session in multiple tabs can cause call data conflicts.
                        </p>
                        <button
                            onClick={() => {
                                // Force-claim this tab (previous tab may have been closed)
                                localStorage.setItem(SESSION_TAB_LOCK_KEY, JSON.stringify({ tabId: tabId.current, ts: Date.now() }));
                                setOtherTabActive(false);
                            }}
                            className="px-4 py-2 rounded-lg bg-[var(--warning)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                        >
                            Use This Tab Instead
                        </button>
                    </div>
                </div>
            );
        }

        if (authLoading || loading) {
            return (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
                </div>
            );
        }

        if (!session) {
            if (isStandaloneMode) {
                if (!isSessionActive) {
                    return (
                        <div className="flex items-center justify-center min-h-[60vh]">
                            <div className="text-center space-y-6 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--card-border)] shadow-xl">
                                <div className="w-16 h-16 rounded-2xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto animate-pulse">
                                    <Headphones size={32} className="text-[var(--error)]" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold mb-2">Connect Audio to Start</h2>
                                    <p className="text-[var(--muted)] text-sm mb-4">
                                        Recording must be enabled before you can make standalone calls.
                                    </p>
                                </div>
                                <div className="text-left bg-[var(--sidebar-bg)] p-4 rounded-xl space-y-3 text-sm border border-[var(--card-border)]">
                                    <p className="font-medium text-[var(--foreground)]">Instructions:</p>
                                    <ol className="list-decimal list-inside space-y-2 text-[var(--muted)]">
                                        <li>Click <span className="font-semibold text-[var(--foreground)]">Connect Audio</span> below</li>
                                        <li>Select the <span className="font-semibold text-[var(--foreground)]">Window</span> tab</li>
                                        <li>Choose the <span className="font-semibold text-[var(--foreground)]">Chrome window</span> (this window)</li>
                                        <li><span className="text-[var(--error)] font-bold">IMPORTANT:</span> Toggle <span className="font-semibold text-[var(--foreground)]">Share system audio</span> &quot;ON&quot; at the bottom</li>
                                        <li>Make sure <span className="font-semibold text-[var(--foreground)]">Zoom Workplace app</span> is running on your device</li>
                                    </ol>
                                </div>
                                <button
                                    type="button"
                                    onClick={verifyZoomRunning}
                                    disabled={zoomDetecting || zoomDetected === true}
                                    className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                                        zoomDetected === true
                                            ? 'border-[var(--success)] bg-[var(--success-subtle)] cursor-default'
                                            : zoomDetected === false
                                                ? 'border-[var(--error)] bg-[var(--error-subtle)]/20 hover:bg-[var(--error-subtle)]/30 cursor-pointer active:scale-[0.99]'
                                                : zoomDetecting
                                                    ? 'border-[var(--card-border)] bg-[var(--sidebar-bg)] cursor-wait'
                                                    : 'border-[var(--card-border)] bg-[var(--sidebar-bg)] hover:border-[var(--foreground)]/30 hover:bg-[var(--card-hover)] cursor-pointer active:scale-[0.99]'
                                    }`}
                                >
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${zoomDetected === true ? 'bg-[var(--success)]/20' : 'bg-[var(--card-bg)]'}`}>
                                        {zoomDetecting
                                            ? <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
                                            : zoomDetected === true
                                                ? <Check size={20} className="text-[var(--success)]" />
                                                : zoomDetected === false
                                                    ? <AlertTriangle size={20} className="text-[var(--error)]" />
                                                    : <ExternalLink size={20} className="text-[var(--muted)]" />
                                        }
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-semibold ${zoomDetected === true ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>
                                            Open and Verify Zoom Workplace app is running and logged in
                                        </p>
                                        {zoomDetecting && <p className="text-xs text-[var(--muted)] mt-0.5">Opening Zoom and verifying...</p>}
                                        {zoomDetected === true && (
                                            <p className="text-xs text-[var(--success)] mt-0.5">
                                                Zoom detected and running
                                            </p>
                                        )}
                                        {zoomDetected === false && <p className="text-xs text-[var(--error)] mt-0.5">Zoom not detected — click to try again</p>}
                                        {zoomDetected === null && !zoomDetecting && <p className="text-xs text-[var(--muted)] mt-0.5">Click to open Zoom and verify it is running</p>}
                                    </div>
                                </button>
                                {recorderError && (
                                    <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                        {recorderError}
                                    </div>
                                )}
                                <button
                                    onClick={startAudioSession}
                                    disabled={!zoomAppConfirmed || !agentConnected}
                                    className="w-full py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                    Connect Audio & Start
                                </button>
                            </div>
                        </div>
                    );
                }
                return <StandaloneCallInterface onExit={exitStandalone} />;
            }

            // Show "Connect Audio" screen after user clicked "Start Session"
            if (awaitingAudioConnect) {
                return (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center space-y-6 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--card-border)] shadow-xl">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto animate-pulse">
                                <Headphones size={32} className="text-[var(--error)]" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold mb-2">Connect Audio to Start</h2>
                                <p className="text-[var(--muted)] text-sm mb-4">
                                    Screen share with system audio is required to record calls.
                                </p>
                            </div>
                            <div className="text-left bg-[var(--sidebar-bg)] p-4 rounded-xl space-y-3 text-sm border border-[var(--card-border)]">
                                <p className="font-medium text-[var(--foreground)]">Instructions:</p>
                                <ol className="list-decimal list-inside space-y-2 text-[var(--muted)]">
                                    <li>Click <span className="font-semibold text-[var(--foreground)]">Connect Audio & Start</span> below</li>
                                    <li>Select the <span className="font-semibold text-[var(--foreground)]">Window</span> tab</li>
                                    <li>Choose the <span className="font-semibold text-[var(--foreground)]">Chrome window</span> (this window)</li>
                                    <li><span className="text-[var(--error)] font-bold">IMPORTANT:</span> Toggle <span className="font-semibold text-[var(--foreground)]">Share system audio</span> &quot;ON&quot; at the bottom</li>
                                    <li>Make sure <span className="font-semibold text-[var(--foreground)]">Zoom Workplace app</span> is running on your device</li>
                                </ol>
                            </div>
                            <button
                                type="button"
                                onClick={verifyZoomRunning}
                                disabled={zoomDetecting || zoomDetected === true}
                                className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                                    zoomDetected === true
                                        ? 'border-[var(--success)] bg-[var(--success-subtle)] cursor-default'
                                        : zoomDetected === false
                                            ? 'border-[var(--error)] bg-[var(--error-subtle)]/20 hover:bg-[var(--error-subtle)]/30 cursor-pointer active:scale-[0.99]'
                                            : zoomDetecting
                                                ? 'border-[var(--card-border)] bg-[var(--sidebar-bg)] cursor-wait'
                                                : 'border-[var(--card-border)] bg-[var(--sidebar-bg)] hover:border-[var(--foreground)]/30 hover:bg-[var(--card-hover)] cursor-pointer active:scale-[0.99]'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${zoomDetected === true ? 'bg-[var(--success)]/20' : 'bg-[var(--card-bg)]'}`}>
                                    {zoomDetecting
                                        ? <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
                                        : zoomDetected === true
                                            ? <Check size={20} className="text-[var(--success)]" />
                                            : zoomDetected === false
                                                ? <AlertTriangle size={20} className="text-[var(--error)]" />
                                                : <ExternalLink size={20} className="text-[var(--muted)]" />
                                    }
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${zoomDetected === true ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>
                                        Open and Verify Zoom Workplace app is running and logged in
                                    </p>
                                    {zoomDetecting && <p className="text-xs text-[var(--muted)] mt-0.5">Opening Zoom and verifying...</p>}
                                    {zoomDetected === true && (
                                        <p className="text-xs text-[var(--success)] mt-0.5">
                                            Zoom detected and running
                                        </p>
                                    )}
                                    {zoomDetected === false && <p className="text-xs text-[var(--error)] mt-0.5">Zoom not detected — click to try again</p>}
                                    {zoomDetected === null && !zoomDetecting && <p className="text-xs text-[var(--muted)] mt-0.5">Click to open Zoom and verify it is running</p>}
                                </div>
                            </button>
                            {/* Local Agent verification */}
                            <button
                                type="button"
                                onClick={() => { if (!agentConnected) launchAgent(); }}
                                disabled={agentConnected}
                                className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                                    agentConnected
                                        ? 'border-[var(--success)] bg-[var(--success-subtle)] cursor-default'
                                        : 'border-[var(--card-border)] bg-[var(--sidebar-bg)] hover:border-[var(--foreground)]/30 hover:bg-[var(--card-hover)] cursor-pointer active:scale-[0.99]'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${agentConnected ? 'bg-[var(--success)]/20' : 'bg-[var(--card-bg)]'}`}>
                                    {agentConnected
                                        ? <Check size={20} className="text-[var(--success)]" />
                                        : <AlertTriangle size={20} className="text-[var(--muted)]" />
                                    }
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${agentConnected ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>
                                        CRM Local Agent
                                    </p>
                                    {agentConnected
                                        ? <p className="text-xs text-[var(--success)] mt-0.5">Agent connected and running</p>
                                        : <p className="text-xs text-[var(--muted)] mt-0.5">Agent not detected — click to launch</p>
                                    }
                                </div>
                            </button>
                            {recorderError && (
                                <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                    {recorderError}
                                </div>
                            )}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setAwaitingAudioConnect(false)}
                                    className="flex-1 py-3 rounded-xl bg-[var(--sidebar-bg)] text-[var(--foreground)] font-semibold text-sm border border-[var(--card-border)] hover:bg-[var(--card-hover)] active:scale-[0.98] transition-all"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={handleConnectAudioAndStart}
                                    disabled={!zoomAppConfirmed || !agentConnected || starting}
                                    className="flex-[2] py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                    {starting ? 'Connecting...' : 'Connect Audio & Start'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            }

            // ── Blocked by another user's active session ──
            if (isBlockedByOtherSession && otherActiveSession) {
                const otherStart = new Date(otherActiveSession.started_at).getTime();
                const otherPausedSec = otherActiveSession.total_paused_sec ?? 0;
                const otherCurrentPauseSec = otherActiveSession.paused_at
                    ? Math.floor((Date.now() - new Date(otherActiveSession.paused_at).getTime()) / 1000)
                    : 0;
                const otherElapsed = Math.max(0, Math.floor((Date.now() - otherStart) / 1000) - otherPausedSec - otherCurrentPauseSec);
                const isPaused = !!otherActiveSession.paused_at;

                return (
                    <div className="flex items-center justify-center min-h-[60vh]">
                        <div className="text-center space-y-5 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--warning)]/40 shadow-xl">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--warning-subtle)] flex items-center justify-center mx-auto">
                                <Headphones size={28} className="text-[var(--warning)] animate-pulse" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold mb-2">Session In Progress</h1>
                                <p className="text-sm text-[var(--muted)] leading-relaxed">
                                    <span className="font-semibold text-[var(--foreground)]">{activeSessionUserName}</span>{' '}
                                    is currently in an active call session. Only one session can run at a time.
                                </p>
                            </div>
                            <div className="flex items-center justify-center gap-3 bg-[var(--sidebar-bg)] p-3 rounded-xl border border-[var(--card-border)]">
                                <span className={`w-2 h-2 rounded-full ${isPaused ? 'bg-[var(--warning)]' : 'bg-[var(--success)] animate-pulse'}`} />
                                <span className="text-sm font-medium">{isPaused ? 'Paused' : 'Active'}</span>
                                <span className="text-sm font-mono text-[var(--muted)]">{formatDuration(otherElapsed)}</span>
                            </div>
                            <p className="text-xs text-[var(--muted)]">
                                You&apos;ll be able to start your session once {activeSessionUserName?.split(' ')[0] || 'they'} end{activeSessionUserName?.split(' ')[0] ? 's' : ''} theirs.
                                This page will update automatically.
                            </p>
                        </div>
                    </div>
                );
            }

            return <SessionModeSelector onStartSession={startSession} onStartStandalone={startStandalone} onStartTestSession={startTestSession} lastCompletedSession={lastCompletedSession} onResumeSession={resumeLastSession} resuming={resuming} />;
        }

        if (!isSessionActive && !isVirtualDialerMode) {
            // Session exists but audio disconnected (e.g. page reload) - reconnect audio
            return (
                <div className="space-y-6">
                    {/* Active Session Banner */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold">Call Session</h1>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--success-subtle)] text-[var(--success)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                                Active
                            </span>
                            <span className="text-lg font-mono font-semibold tabular-nums text-[var(--muted)]">
                                {formatDuration(elapsedSec)}
                            </span>
                        </div>

                        <button
                            onClick={() => endSession()}
                            disabled={ending}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-medium text-sm border border-[var(--error)]/30 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                        >
                            {ending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                            {ending ? 'Ending...' : 'End Session'}
                        </button>
                    </div>

                    <div className="flex items-center justify-center min-h-[50vh]">
                        <div className="text-center space-y-6 max-w-md bg-[var(--card-bg)] p-8 rounded-2xl border border-[var(--card-border)] shadow-xl">
                            <div className="w-16 h-16 rounded-2xl bg-[var(--error-subtle)] flex items-center justify-center mx-auto animate-pulse">
                                <Headphones size={32} className="text-[var(--error)]" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold mb-2">Reconnect Audio</h2>
                                <p className="text-[var(--muted)] text-sm mb-4">
                                    Your session is still active. Reconnect screen share to continue calling.
                                </p>
                            </div>
                            <div className="text-left bg-[var(--sidebar-bg)] p-4 rounded-xl space-y-3 text-sm border border-[var(--card-border)]">
                                <p className="font-medium text-[var(--foreground)]">Instructions:</p>
                                <ol className="list-decimal list-inside space-y-2 text-[var(--muted)]">
                                    <li>Click <span className="font-semibold text-[var(--foreground)]">Connect Audio</span> below</li>
                                    <li>Select the <span className="font-semibold text-[var(--foreground)]">Window</span> tab</li>
                                    <li>Choose the <span className="font-semibold text-[var(--foreground)]">Chrome window</span> (this window)</li>
                                    <li><span className="text-[var(--error)] font-bold">IMPORTANT:</span> Toggle <span className="font-semibold text-[var(--foreground)]">Share system audio</span> &quot;ON&quot; at the bottom</li>
                                </ol>
                            </div>
                            <button
                                type="button"
                                onClick={verifyZoomRunning}
                                disabled={zoomDetecting || zoomDetected === true}
                                className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                                    zoomDetected === true
                                        ? 'border-[var(--success)] bg-[var(--success-subtle)] cursor-default'
                                        : zoomDetected === false
                                            ? 'border-[var(--error)] bg-[var(--error-subtle)]/20 hover:bg-[var(--error-subtle)]/30 cursor-pointer active:scale-[0.99]'
                                            : zoomDetecting
                                                ? 'border-[var(--card-border)] bg-[var(--sidebar-bg)] cursor-wait'
                                                : 'border-[var(--card-border)] bg-[var(--sidebar-bg)] hover:border-[var(--foreground)]/30 hover:bg-[var(--card-hover)] cursor-pointer active:scale-[0.99]'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${zoomDetected === true ? 'bg-[var(--success)]/20' : 'bg-[var(--card-bg)]'}`}>
                                    {zoomDetecting
                                        ? <Loader2 size={20} className="animate-spin text-[var(--muted)]" />
                                        : zoomDetected === true
                                            ? <Check size={20} className="text-[var(--success)]" />
                                            : zoomDetected === false
                                                ? <AlertTriangle size={20} className="text-[var(--error)]" />
                                                : <ExternalLink size={20} className="text-[var(--muted)]" />
                                    }
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${zoomDetected === true ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>
                                        Open and Verify Zoom Workplace app is running and logged in
                                    </p>
                                    {zoomDetecting && <p className="text-xs text-[var(--muted)] mt-0.5">Opening Zoom and verifying...</p>}
                                    {zoomDetected === true && (
                                        <p className="text-xs text-[var(--success)] mt-0.5">
                                            Zoom detected and running
                                        </p>
                                    )}
                                    {zoomDetected === false && <p className="text-xs text-[var(--error)] mt-0.5">Zoom not detected — click to try again</p>}
                                    {zoomDetected === null && !zoomDetecting && <p className="text-xs text-[var(--muted)] mt-0.5">Click to open Zoom and verify it is running</p>}
                                </div>
                            </button>
                            {/* Local Agent verification */}
                            <button
                                type="button"
                                onClick={() => { if (!agentConnected) launchAgent(); }}
                                disabled={agentConnected}
                                className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                                    agentConnected
                                        ? 'border-[var(--success)] bg-[var(--success-subtle)] cursor-default'
                                        : 'border-[var(--card-border)] bg-[var(--sidebar-bg)] hover:border-[var(--foreground)]/30 hover:bg-[var(--card-hover)] cursor-pointer active:scale-[0.99]'
                                }`}
                            >
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${agentConnected ? 'bg-[var(--success)]/20' : 'bg-[var(--card-bg)]'}`}>
                                    {agentConnected
                                        ? <Check size={20} className="text-[var(--success)]" />
                                        : <AlertTriangle size={20} className="text-[var(--muted)]" />
                                    }
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold ${agentConnected ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>
                                        CRM Local Agent
                                    </p>
                                    {agentConnected
                                        ? <p className="text-xs text-[var(--success)] mt-0.5">Agent connected and running</p>
                                        : <p className="text-xs text-[var(--muted)] mt-0.5">Agent not detected — click to launch</p>
                                    }
                                </div>
                            </button>
                            {recorderError && (
                                <div className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/30 p-2 rounded-lg">
                                    {recorderError}
                                </div>
                            )}
                            <button
                                onClick={startAudioSession}
                                disabled={!zoomAppConfirmed || !agentConnected}
                                className="w-full py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
                            >
                                Connect Audio
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">Call Session</h1>
                        {session.is_test && (
                            <>
                                <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/30">
                                    TEST
                                </span>
                                <button
                                    onClick={handleCopyTestNumbers}
                                    title="Copy test phone numbers for the power dialer"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                                >
                                    {testNumbersCopied ? <Check size={11} /> : <Copy size={11} />}
                                    {testNumbersCopied ? 'Copied!' : 'Test Numbers'}
                                </button>
                            </>
                        )}
                        {session.paused_at ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--warning-subtle)] text-[var(--warning)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
                                Paused
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--success-subtle)] text-[var(--success)]">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                                Active
                            </span>
                        )}
                        <span className="text-lg font-mono font-semibold tabular-nums text-[var(--muted)]">
                            {formatDuration(elapsedSec)}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {session.paused_at ? (
                            (() => {
                                const resumeBlocked = !agentConnected || !agentZoomDetected;
                                const resumeBtn = (
                                    <button
                                        onClick={resumeSession}
                                        disabled={pausing || resumeBlocked}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--success-subtle)] text-[var(--success)] font-medium text-sm border border-[var(--success)]/30 hover:bg-[var(--success)] hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {pausing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                                        {pausing ? 'Resuming...' : 'Resume Session'}
                                    </button>
                                );
                                if (!agentConnected) return <Tooltip content="CRM Agent must be running to resume">{resumeBtn}</Tooltip>;
                                if (!agentZoomDetected) return <Tooltip content="Zoom must be running to resume">{resumeBtn}</Tooltip>;
                                return resumeBtn;
                            })()
                        ) : (
                            isInCall ? (
                                <Tooltip content="Cannot pause during a call">
                                    <button
                                        disabled
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] font-medium text-sm border border-[var(--warning)]/30 transition-all opacity-50 cursor-not-allowed"
                                    >
                                        <Pause size={16} />
                                        Pause Session
                                    </button>
                                </Tooltip>
                            ) : (
                                <button
                                    onClick={pauseSession}
                                    disabled={pausing}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] font-medium text-sm border border-[var(--warning)]/30 hover:bg-[var(--warning)] hover:text-white transition-all disabled:opacity-50"
                                >
                                    {pausing ? <Loader2 size={16} className="animate-spin" /> : <Pause size={16} />}
                                    {pausing ? 'Pausing...' : 'Pause Session'}
                                </button>
                            )
                        )}
                        <button
                            onClick={() => endSession()}
                            disabled={ending}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-medium text-sm border border-[var(--error)]/30 hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                        >
                            {ending ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                            {ending ? 'Ending...' : 'End Session'}
                        </button>
                    </div>
                </div>

                {/* Current Call Timer - shown when call is active */}
                {(callStatus === 'ringing' || callStatus === 'connected') && (
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                {callStatus === 'ringing' ? (
                                    <>
                                        <div className="w-12 h-12 rounded-full bg-[var(--warning-subtle)] flex items-center justify-center">
                                            <Phone className="w-6 h-6 text-[var(--warning)] animate-bounce" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-lg">Ringing...</p>
                                            <p className="text-sm text-[var(--muted)]">
                                                Ring Duration: {ringStartTime ? Math.floor((Date.now() - ringStartTime) / 1000) : 0}s
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-12 h-12 rounded-full bg-[var(--success-subtle)] flex items-center justify-center">
                                            <Phone className="w-6 h-6 text-[var(--success)]" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-lg">Call Connected</p>
                                            <div className="flex gap-4 text-sm text-[var(--muted)]">
                                                <span>Ring: {ringStartTime && connectTime ? Math.floor((connectTime - ringStartTime) / 1000) : 0}s</span>
                                                <span>Call: {currentCallDuration}s</span>
                                                <span className="font-medium text-[var(--foreground)]">
                                                    Total: {(ringStartTime && connectTime ? Math.floor((connectTime - ringStartTime) / 1000) : 0) + currentCallDuration}s
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="flex items-center gap-6">
                                {/* Recording Indicator & Manual Stop */}
                                {recorderStatus === 'recording' && (
                                    <div className="flex items-center gap-3 pr-6 border-r border-[var(--card-border)]">
                                        <div className="flex flex-col items-end">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                                <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Recording</span>
                                            </div>
                                            <span className="text-xs font-mono font-medium">{Math.floor(recorderDuration / 60)}:{(recorderDuration % 60).toString().padStart(2, '0')}</span>
                                        </div>
                                        <button
                                            onClick={() => stopRecording()}
                                            className="p-2 rounded-lg bg-[var(--sidebar-bg)] border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-all group"
                                            title="Stop Recording"
                                        >
                                            <Square size={16} fill="currentColor" className="group-hover:fill-white" />
                                        </button>
                                    </div>
                                )}

                                <div className="text-right">
                                    <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Phone Number</p>
                                    <p className="font-mono text-sm font-medium">{currentPhoneNumber || 'Unknown'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Agent disconnected alert — shown during active session when agent drops */}
                {agentLostDuringSession && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--error-subtle)]/30 border border-[var(--error)]/30">
                        <AlertTriangle size={20} className="text-[var(--error)] shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--error)]">CRM Agent not detected</p>
                            <p className="text-xs text-[var(--muted)] mt-0.5">
                                The local CRM Agent is not running. Calls are blocked until the agent is connected. Click Launch to start it.
                            </p>
                        </div>
                        <button
                            onClick={launchAgent}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--error)] text-white hover:opacity-90 active:scale-[0.97] transition-all"
                        >
                            <Zap size={13} />
                            Launch
                        </button>
                    </div>
                )}

                {/* Zoom not detected alert — shown during active session when agent reports Zoom gone */}
                {zoomLostDuringSession && !agentLostDuringSession && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--error-subtle)]/30 border border-[var(--error)]/30">
                        <AlertTriangle size={20} className="text-[var(--error)] shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--error)]">Zoom not detected</p>
                            <p className="text-xs text-[var(--muted)] mt-0.5">
                                Open Zoom Workplace on your device, then click Retry. The dialer will refresh automatically once Zoom is detected.
                            </p>
                        </div>
                        <button
                            onClick={() => { launchZoom(); }}
                            disabled={zoomLaunching}
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--error)] text-white hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50"
                        >
                            {zoomLaunching ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                            Retry
                        </button>
                    </div>
                )}

                {/* Docked Zoom Phone Dialer - Above Current Call section */}
                <div className="relative">
                    <ZoomPhoneDialer
                        docked
                        disabled={(hasUnsavedCall && callStatus !== 'ringing' && callStatus !== 'connected') || !!session.paused_at || zoomLostDuringSession || agentLostDuringSession}
                        disabledReason={
                            agentLostDuringSession ? 'Run CRM Agent first' :
                            zoomLostDuringSession ? 'Open Zoom first' :
                            session.paused_at ? 'Resume session to make calls' :
                            undefined
                        }
                    />
                    {(session.paused_at || agentLostDuringSession || zoomLostDuringSession) && (
                        <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-[1px] flex items-center justify-center rounded-xl z-10 pointer-events-none">
                            <p className="text-sm font-medium text-[var(--muted)]">
                                {agentLostDuringSession ? 'Run CRM Agent to make calls' :
                                 zoomLostDuringSession ? 'Open Zoom to make calls' :
                                 'Resume session to make calls'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Power Dialer — between Zoom dialer and main grid */}
                <PowerDialerPanel
                    queue={powerDialerQueue}
                    currentIndex={powerDialerIndex}
                    active={powerDialerActive}
                    paused={powerDialerPaused}
                    delay={powerDialerDelay}
                    onStart={handlePowerDialerStart}
                    onPause={handlePowerDialerPause}
                    onResume={handlePowerDialerResume}
                    onStop={handlePowerDialerStop}
                    onStartFrom={handlePowerDialerStartFrom}
                    onDelayChange={setPowerDialerDelay}
                    onQueueLoad={handlePowerDialerQueueLoad}
                    onQueueReorder={handlePowerDialerReorder}
                    disabled={!!session.paused_at}
                    canStart={!hasUnsavedCall && callStatus !== 'ringing' && callStatus !== 'connected'}
                />

                {/* Main layout */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    {/* Left column — 60% */}
                    <div className="lg:col-span-3 space-y-6">
                        <CurrentCallForm
                            phoneNumber={hasUnsavedCall ? (pinnedFormPhoneNumber || currentPhoneNumber) : currentPhoneNumber}
                            onSave={handleSaveCall}
                            saving={savingCall}
                            hasUnsavedCall={hasUnsavedCall}
                            initialDraft={callDraft}
                            onDraftChange={setCallDraft}
                            onDiscard={handleDiscardCall}
                            isCallLive={callStatus === 'ringing' || callStatus === 'connected'}
                            onCallback={handleCallback}
                            callbackEvents={callbackEvents}
                            suggestedCompanyName={suggestedCompanyName}
                        />
                    </div>

                    {/* Right column — 40% */}
                    <div className="lg:col-span-2 space-y-6">
                        <SessionMetrics
                            totalDials={session.total_dials || 0}
                            totalPickups={session.total_pickups || 0}
                            totalCallbacks={session.total_callbacks || 0}
                            totalIncoming={session.total_incoming || 0}
                            durationSec={elapsedSec}
                        />
                        <PerformanceTracker
                            ownerReached={session.owner_reached || 0}
                            pitchCompleted={session.pitch_completed || 0}
                            appointmentSet={session.appointment_set || 0}
                            onUpdate={handlePerformanceUpdate}
                        />
                        <SessionFollowUps
                            onAddToDialer={handleAddFollowUpToDialer}
                            onDialNow={handleDialFollowUp}
                            onSelectCompany={handleSelectFollowUpCompany}
                            hasUnsavedCall={hasUnsavedCall}
                            isCallInProgress={callStatus === 'ringing' || callStatus === 'connected'}
                        />
                        <button
                            onClick={() => setShowManualAdjustment(true)}
                            className="w-full text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] bg-[var(--card-bg)] border border-[var(--card-border)] hover:border-[var(--primary)]/30 rounded-xl px-4 py-2.5 transition-colors flex items-center justify-center gap-1.5"
                        >
                            <SlidersHorizontal size={13} />
                            Manual Adjustment
                        </button>
                        <LastCallPreview
                            callLog={lastCallLog}
                            companyName={lastCallCompanyName}
                            sessionId={session.id}
                        />
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            {renderContent()}

            {/* Follow-up notification toasts */}
            <FollowUpNotificationContainer
                notifications={activeNotifications}
                onDismiss={handleDismissNotification}
            />

            {/* Manual adjustment modal */}
            {showManualAdjustment && session && (
                <ManualAdjustmentModal
                    session={session}
                    onApplied={(updatedSession) => {
                        setSession(updatedSession);
                        setShowManualAdjustment(false);
                        addToast('success', 'Manual adjustment applied');
                    }}
                    onClose={() => setShowManualAdjustment(false)}
                />
            )}

            {/* Test session cleanup modal */}
            {showTestCleanupModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                                <span className="text-amber-500 text-sm font-bold">TEST</span>
                            </div>
                            <div>
                                <h2 className="text-lg font-bold">Test Session Ended</h2>
                                <p className="text-sm text-[var(--muted)] mt-1">
                                    Would you like to delete all data created during this test session? This includes call logs, recordings, follow-ups, and any companies that were only created during this session.
                                </p>
                            </div>
                        </div>

                        {cleanupError && (
                            <p className="text-xs text-[var(--error)] bg-[var(--error-subtle)]/20 rounded-lg p-2">
                                {cleanupError}
                            </p>
                        )}

                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={handleKeepTestData}
                                disabled={cleaningUp}
                                className="flex-1 py-2.5 rounded-xl border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--sidebar-bg)] transition-colors disabled:opacity-50"
                            >
                                Keep for Now
                            </button>
                            <button
                                onClick={handleDeleteTestData}
                                disabled={cleaningUp}
                                className="flex-[1.5] py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                            >
                                {cleaningUp ? (
                                    <>
                                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                        </svg>
                                        Deleting...
                                    </>
                                ) : 'Delete Everything'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
