'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Building2, User, Phone as PhoneIcon, StickyNote, AlertCircle, CalendarClock, X, AlertTriangle, ChevronDown, Plus, Crown, Mail, Mic, Download, Loader2, CheckCircle2, Pencil } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { useLocalAgent } from '@/contexts/local-agent-context';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type PhoneNumber, type CallLog, type Recording, type CustomCallOutcome, type FollowUp, type CompanyNote } from '@/lib/types';
import { cn, timeAgo, formatDateTime, formatPhoneNumber, extractWebsiteFromName } from '@/lib/utils';
import { FollowUpScheduler } from '@/components/follow-up-scheduler';
import { PhoneHoverCard } from '@/components/phone-hover-card';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { RecordingPlayerOverlay } from '@/components/recording-player-overlay';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import {
    FORM_OUTCOMES,
    HUNG_UP_PRIMARY,
    HUNG_UP_OTHER,
    CALLBACK_REASONS,
    MAX_OUTCOMES,
    NO_ANSWER,
    getOutcomeColors,
    type CallbackReason,
} from '@/lib/call-outcomes';

export type { CallbackReason };

export interface CallFormData {
    companyId: string;
    companyName: string;
    phoneNumber: string;
    receptionistName: string;
    ownerName: string;
    callOutcome: string[];
    postCallNotes: string;
    wasPickedUp: boolean;
    ownerReached: boolean;
    pitchCompleted: boolean;
    appointmentSet: boolean;
    followUp?: { scheduledTime: string; timezone: string; notes: string } | null;
    callbackEvents?: Array<{ reason: string; timestamp: string }>;
    additionalPhoneNumber?: string;
    additionalPhoneNote?: string;
    email?: string;
    completeFollowUpIds?: string[];
}

export interface CallFormDraft {
    companySearch: string;
    selectedCompany: Pick<Company, 'id' | 'company_name' | 'owner_name'> | null;
    receptionistName: string;
    ownerName: string;
    callOutcome: string[];
    postCallNotes: string;
    ownerReached: boolean;
    pitchCompleted: boolean;
    appointmentSet: boolean;
    noneSelected: boolean;
    isNewCompany: boolean;
    showFollowUp: boolean;
    followUpData: { scheduledTime: string; timezone: string; notes: string } | null;
    callbackEvents: Array<{ reason: string; timestamp: string }>;
    additionalPhoneNumber: string;
    additionalPhoneNote: string;
    email: string;
}

const EMPTY_DRAFT: CallFormDraft = {
    companySearch: '',
    selectedCompany: null,
    receptionistName: '',
    ownerName: '',
    callOutcome: [],
    postCallNotes: '',
    ownerReached: false,
    pitchCompleted: false,
    appointmentSet: false,
    noneSelected: true,
    isNewCompany: false,
    showFollowUp: false,
    followUpData: null,
    callbackEvents: [],
    additionalPhoneNumber: '',
    additionalPhoneNote: '',
    email: '',
};

interface CurrentCallFormProps {
    phoneNumber: string;
    onSave: (data: CallFormData) => void;
    saving?: boolean;
    /** Whether a recorded call is waiting to be submitted */
    hasUnsavedCall?: boolean;
    initialDraft?: CallFormDraft | null;
    onDraftChange?: (draft: CallFormDraft) => void;
    onDiscard?: () => void;
    /** Whether the call is currently live (ringing or connected) */
    isCallLive?: boolean;
    /** Called when user initiates a callback from the dropdown */
    onCallback?: (reason: CallbackReason) => void;
    /** Accumulated callback events for this call */
    callbackEvents?: Array<{ reason: string; timestamp: string }>;
    /** Suggested company name from power dialer queue */
    suggestedCompanyName?: string;
}

const EMPTY_CALLBACK_EVENTS: Array<{ reason: string; timestamp: string }> = [];

export function CurrentCallForm({ phoneNumber, onSave, saving, hasUnsavedCall, initialDraft, onDraftChange, onDiscard, isCallLive, onCallback, callbackEvents = EMPTY_CALLBACK_EVENTS, suggestedCompanyName }: CurrentCallFormProps) {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [companySearch, setCompanySearch] = useState('');
    const [companyResults, setCompanyResults] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
    const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
    const [receptionistName, setReceptionistName] = useState('');
    const [ownerName, setOwnerName] = useState('');
    const [callOutcome, setCallOutcome] = useState<string[]>([]);
    const [customOutcomes, setCustomOutcomes] = useState<string[]>([]);
    const [showOtherInput, setShowOtherInput] = useState(false);
    const [otherInputValue, setOtherInputValue] = useState('');
    const otherInputRef = useRef<HTMLInputElement>(null);

    // Load custom outcomes from DB once
    useEffect(() => {
        pb.collection(COLLECTIONS.CUSTOM_CALL_OUTCOMES).getFullList<CustomCallOutcome>({
            sort: 'name',
        }).then(records => {
            setCustomOutcomes(records.map(r => r.name));
        }).catch(() => {});
    }, []);

    /** Toggle an outcome tag respecting max-3 rules */
    const toggleOutcome = (outcome: string) => {
        setCallOutcome(prev => {
            // Deselect if already selected
            if (prev.includes(outcome)) {
                return prev.filter(o => o !== outcome);
            }
            // Enforce max
            if (prev.length >= MAX_OUTCOMES) return prev;
            return [...prev, outcome];
        });
    };
    const [postCallNotes, setPostCallNotes] = useState('');
    const [ownerReached, setOwnerReached] = useState(false);
    const [pitchCompleted, setPitchCompleted] = useState(false);
    const [appointmentSet, setAppointmentSet] = useState(false);
    const [noneSelected, setNoneSelected] = useState(true);
    const [isNewCompany, setIsNewCompany] = useState(false);
    const [showCallbackDropdown, setShowCallbackDropdown] = useState(false);
    const [showHungUpDropdown, setShowHungUpDropdown] = useState(false);
    const [additionalPhoneNumber, setAdditionalPhoneNumber] = useState('');
    const [additionalPhoneNote, setAdditionalPhoneNote] = useState('');
    const [showAdditionalPhone, setShowAdditionalPhone] = useState(false);
    const [email, setEmail] = useState('');
    const [showEmail, setShowEmail] = useState(false);
    const [shouldPulseOwnerReached, setShouldPulseOwnerReached] = useState(false);
    const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const callbackDropdownRef = useRef<HTMLDivElement>(null);
    const hungUpDropdownRef = useRef<HTMLDivElement>(null);

    const { deferredSegments, latestRecording, uploadQueueStatus } = useCallRecording();
    // Direct agent context for live recording + current-upload state. The
    // call-recording-context flattens these, but currentUpload isn't plumbed
    // through there yet, and we want per-state labels in the UI.
    const { recordingState: agentRecordingLiveState, uploadQueueStatus: agentUploadQueue, fetchLocalRecording, isConnected: agentConnected, unlinkedRecordings } = useLocalAgent();

    // Recording playback
    const [playerRecording, setPlayerRecording] = useState<Recording | null>(null);
    const [playerBlob, setPlayerBlob] = useState<string | null>(null);
    const [playerLoading, setPlayerLoading] = useState<string | null>(null);

    const handlePlayRecording = async (call: CallLog) => {
        if (playerLoading === call.id) return;

        // If clicking the same one that's already loaded, skip
        if (playerRecording?.call_log === call.id) {
            return;
        }

        setPlayerLoading(call.id);
        setPlayerBlob(null); // Clear blob player
        try {
            // Try by call_log first
            let recording: Recording | null = null;
            try {
                recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                    pb.filter('call_log = {:callLog}', { callLog: call.id }),
                );
            } catch {
                // Fallback: agent mode may upload before linking, so call_log isn't set on PB record.
                // Match by phone number AND the user who made the call — without the uploader scope
                // the most recent recording for that number could belong to a different user.
                const phone = call.expand?.phone_number_record?.phone_number;
                if (phone && call.caller) {
                    const digits = phone.replace(/\D/g, '').slice(-10);
                    try {
                        recording = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
                            pb.filter('phone_number ~ {:digits} && uploader = {:uploader}', {
                                digits,
                                uploader: call.caller,
                            }),
                            { sort: '-created' },
                        );
                    } catch {
                        // No recording found by phone either
                    }
                }
            }
            if (recording && recording.file) {
                setPlayerRecording(recording);
            }
        } catch (err) {
            console.error('Failed to fetch recording for prior call:', err);
        } finally {
            setPlayerLoading(null);
        }
    };

    // Find the deferred segment that belongs to THIS form's phone number.
    // Each segment stores the phone it was captured for; match on last 10 digits
    // to avoid format mismatches (+1, parens, dashes, etc.).
    const normalizePhone = (p: string) => p?.replace(/\D/g, '').slice(-10) || '';
    const formDigits = normalizePhone(phoneNumber);
    const matchingSegment = formDigits
        ? deferredSegments.find(s => normalizePhone(s.phone) === formDigits)
        : null;

    // Agent mode: resolve the recording that belongs to this form's phone number.
    // We check the live `latestRecording` first (populated during the active call)
    // and fall back to the persisted unlinked-recordings list (so the pill
    // survives page refreshes and agent reconnects). The unlinked list is
    // already sorted newest-first by the agent, so `find` picks the most recent.
    const resolvedAgentRecording = !matchingSegment && formDigits
        ? (latestRecording && normalizePhone(latestRecording.phoneNumber) === formDigits
            ? latestRecording
            : unlinkedRecordings.find(r => normalizePhone(r.phoneNumber) === formDigits) ?? null)
        : null;
    const agentRecordingMatch = !!resolvedAgentRecording;

    // Whether the agent is still uploading/processing the recording
    const agentRecordingUploading = agentRecordingMatch
        && ((uploadQueueStatus?.pendingCount ?? 0) > 0 || !!uploadQueueStatus?.currentUpload);

    // Whether the agent recording is fully uploaded and ready to play
    const agentRecordingReady = agentRecordingMatch && !agentRecordingUploading;

    // Inline recording-pipeline status for the "Recorded but unsubmitted" pill.
    // Order of precedence mirrors the agent's state machine:
    //   recording → stopping (converting) → pending upload → uploading → failed → uploaded
    const pendingCount = uploadQueueStatus?.pendingCount ?? 0;
    const failedCount = uploadQueueStatus?.failedCount ?? 0;
    const currentUpload = agentUploadQueue?.currentUpload ?? uploadQueueStatus?.currentUpload ?? null;
    const liveState = agentRecordingLiveState?.state ?? 'idle';
    const isRecordingNow = liveState === 'recording'
        && !!formDigits
        && normalizePhone(agentRecordingLiveState?.phoneNumber ?? '') === formDigits;
    const isConvertingNow = liveState === 'stopping'
        && !!formDigits
        && normalizePhone(agentRecordingLiveState?.phoneNumber ?? '') === formDigits;

    const recordingStatus: { label: string; tone: 'recording' | 'processing' | 'uploading' | 'pending' | 'failed' | 'uploaded' } | null =
        isRecordingNow ? { label: 'Recording…', tone: 'recording' }
        : isConvertingNow ? { label: 'Processing audio…', tone: 'processing' }
        : agentRecordingMatch && currentUpload ? { label: 'Uploading to CRM…', tone: 'uploading' }
        : agentRecordingMatch && pendingCount > 0 ? { label: `Queued (${pendingCount} pending)`, tone: 'pending' }
        : agentRecordingMatch && failedCount > 0 ? { label: 'Upload failed — will retry', tone: 'failed' }
        : agentRecordingMatch ? { label: 'Uploaded', tone: 'uploaded' }
        : null;

    // Whether we have any recording available for playback (browser or agent).
    // We surface the button whenever an agent match exists — even while uploading —
    // because the upload-queue counters can race (pendingCount transiently 0 during
    // the gap between conversion-complete and the upload loop's poll). Hiding the
    // button in that window made clicks silently impossible; the click handler now
    // gives toast feedback if the record isn't in PB yet.
    const hasRecordingForPlayback = !!(matchingSegment || agentRecordingMatch);

    const handlePlayUnsubmitted = async () => {
        // Browser mode: play from in-memory blob
        if (matchingSegment) {
            const url = URL.createObjectURL(matchingSegment.blob);
            setPlayerRecording(null);
            setPlayerBlob(url);
            return;
        }

        // Agent mode: match by filename PREFIX + uploader. We can't do an exact match
        // because the agent renames the file on disk when it gets linked to a call log:
        //   `{timestamp}_{phone}.mp3` → `{timestamp}_{phone}_cl-{callLogId}.mp3`
        // The recordingCompleted WebSocket message fires pre-rename, so `recordingToPlay.fileName`
        // is the base; PocketBase's `original_filename` is the post-rename form. Prefix-match
        // on the base (without the `.mp3` extension) handles both states. The timestamp
        // is millisecond-precise, so collisions across users/recordings are effectively zero —
        // the uploader scope makes it airtight.
        const recordingToPlay = resolvedAgentRecording ?? latestRecording;
        if (!recordingToPlay || !user) {
            addToast('warning', 'No recording available yet for this call.');
            return;
        }

        setPlayerLoading('unsubmitted');
        try {
            // Agent mode preview: before the call is submitted there's no call_log
            // to link, so the recording hasn't been uploaded. Fetch the file from
            // the agent's local disk and play it as an in-memory Blob. This is the
            // fast path and always works while the agent is running.
            if (agentConnected) {
                try {
                    const blob = await fetchLocalRecording(recordingToPlay.fileName);
                    const url = URL.createObjectURL(blob);
                    setPlayerRecording(null);
                    setPlayerBlob(url);
                    return;
                } catch (localErr) {
                    console.warn('[Unsubmitted] Local file fetch failed, falling back to PB:', localErr);
                }
            }

            // Fallback: the agent is offline OR the local file is gone (e.g. user
            // deleted it) — query PocketBase by original_filename prefix + uploader.
            const baseName = recordingToPlay.fileName.replace(/\.mp3$/i, '');
            const byFilename = await pb.collection(COLLECTIONS.RECORDINGS).getList<Recording>(1, 1, {
                filter: pb.filter('original_filename ~ {:base} && uploader = {:uploader}', {
                    base: baseName,
                    uploader: user.id,
                }),
                sort: '-created',
            });
            const recording = byFilename.items[0] ?? null;

            if (recording && recording.file) {
                setPlayerBlob(null);
                setPlayerRecording(recording);
            } else {
                addToast('warning',
                    agentConnected
                        ? 'The local recording file is missing and it hasn\'t been uploaded yet.'
                        : 'Local agent is offline and this recording isn\'t in the CRM yet.');
            }
        } catch (err) {
            console.error('Failed to fetch agent recording:', err);
            addToast('error', `Failed to load recording: ${err instanceof Error ? err.message : 'unknown error'}`);
        } finally {
            setPlayerLoading(null);
        }
    };

    const closePlayer = () => {
        setPlayerRecording(null);
        setPlayerBlob(null);
    };

    // Auto-fetch company state
    const [autoFetchedCompany, setAutoFetchedCompany] = useState<Company | null>(null);
    const [phoneNumberRecord, setPhoneNumberRecord] = useState<PhoneNumber | null>(null);
    const [phoneExistsForOtherCompany, setPhoneExistsForOtherCompany] = useState(false);
    const lastLookedUpPhone = useRef('');
    const lastAppliedSuggestion = useRef('');

    // Brief call history for known phone numbers
    const [callHistory, setCallHistory] = useState<CallLog[]>([]);
    const [callHistoryLoading, setCallHistoryLoading] = useState(false);
    const lastFetchedHistoryCompanyId = useRef('');

    // Pre-call notes for the matched company
    const [preCallNotes, setPreCallNotes] = useState<CompanyNote[]>([]);
    const [preCallNotesLoading, setPreCallNotesLoading] = useState(false);
    const lastFetchedNotesCompanyId = useRef('');

    // Inline edit state for the pre-call note line inside the Notes panel
    const [editingPreCallNote, setEditingPreCallNote] = useState(false);
    const [preCallNoteDraft, setPreCallNoteDraft] = useState('');
    const [savingPreCallNote, setSavingPreCallNote] = useState(false);

    // Prior calls attention pulse
    const priorCallsRef = useRef<HTMLDivElement>(null);
    const ownerNameRef = useRef<HTMLDivElement>(null);
    const [priorCallsPulsing, setPriorCallsPulsing] = useState(false);
    const priorCallsPulseTriggeredRef = useRef(false);

    const [companyLookupState, setCompanyLookupState] = useState<'idle' | 'searching' | 'found' | 'not-found'>('idle');

    // Pending follow-ups for the selected company
    const [pendingFollowUps, setPendingFollowUps] = useState<FollowUp[]>([]);
    const [completeFollowUps, setCompleteFollowUps] = useState(true); // default: complete them on save

    // Follow-up scheduling
    const [showFollowUp, setShowFollowUp] = useState(false);
    const [followUpData, setFollowUpData] = useState<{ scheduledTime: string; timezone: string; notes: string } | null>(null);
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    const hydratedFromDraft = useRef(false);

    const resetForm = useCallback(() => {
        setCompanySearch('');
        setSelectedCompany(null);
        setIsNewCompany(false);
        setReceptionistName('');
        setOwnerName('');
        setCallOutcome([]);
        setShowOtherInput(false);
        setOtherInputValue('');
        setPostCallNotes('');
        setOwnerReached(false);
        setPitchCompleted(false);
        setAppointmentSet(false);
        setNoneSelected(true);
        setShowFollowUp(false);
        setFollowUpData(null);
        setPendingFollowUps([]);
        setCompleteFollowUps(true);
        setAutoFetchedCompany(null);
        setPhoneNumberRecord(null);
        setPhoneExistsForOtherCompany(false);
        setCompanyLookupState('idle');
        setAdditionalPhoneNumber('');
        setAdditionalPhoneNote('');
        setShowAdditionalPhone(false);
        setEmail('');
        setShowEmail(false);
        lastLookedUpPhone.current = '';
        lastAppliedSuggestion.current = '';
    }, []);

    useEffect(() => {
        if (!initialDraft || hydratedFromDraft.current) return;

        setCompanySearch(initialDraft.companySearch || '');
        if (initialDraft.selectedCompany) {
            setSelectedCompany(initialDraft.selectedCompany as Company);
        }
        setReceptionistName(initialDraft.receptionistName || '');
        setOwnerName(initialDraft.ownerName || '');
        setCallOutcome(Array.isArray(initialDraft.callOutcome) ? initialDraft.callOutcome : initialDraft.callOutcome ? [initialDraft.callOutcome] : []);
        setPostCallNotes(initialDraft.postCallNotes || '');
        setOwnerReached(!!initialDraft.ownerReached);
        setPitchCompleted(!!initialDraft.pitchCompleted);
        setAppointmentSet(!!initialDraft.appointmentSet);
        setNoneSelected(initialDraft.noneSelected ?? true);
        setIsNewCompany(!!initialDraft.isNewCompany);
        setShowFollowUp(!!initialDraft.showFollowUp);
        setFollowUpData(initialDraft.followUpData || null);
        setAdditionalPhoneNumber(initialDraft.additionalPhoneNumber || '');
        setAdditionalPhoneNote(initialDraft.additionalPhoneNote || '');
        setEmail(initialDraft.email || '');

        hydratedFromDraft.current = true;
    }, [initialDraft]);

    useEffect(() => {
        onDraftChange?.({
            companySearch,
            selectedCompany: selectedCompany
                ? {
                    id: selectedCompany.id,
                    company_name: selectedCompany.company_name,
                    owner_name: selectedCompany.owner_name,
                }
                : null,
            receptionistName,
            ownerName,
            callOutcome,
            postCallNotes,
            ownerReached,
            pitchCompleted,
            appointmentSet,
            noneSelected,
            isNewCompany,
            showFollowUp,
            followUpData,
            callbackEvents,
            additionalPhoneNumber,
            additionalPhoneNote,
            email,
        });
    }, [companySearch, selectedCompany, receptionistName, ownerName, callOutcome, postCallNotes, ownerReached, pitchCompleted, appointmentSet, noneSelected, isNewCompany, showFollowUp, followUpData, callbackEvents, additionalPhoneNumber, additionalPhoneNote, email, onDraftChange]);

    // Reset suggestion tracking when phone number changes so the same company name
    // can be re-applied to consecutive calls (e.g. two different numbers for the same company)
    useEffect(() => {
        if (!phoneNumber) return;
        if (phoneNumber !== lastLookedUpPhone.current) {
            lastAppliedSuggestion.current = '';
        }
    }, [phoneNumber]);

    // Auto-fetch company when phone number changes
    useEffect(() => {
        if (!phoneNumber) {
            setCompanyLookupState('idle');
            return;
        }
        if (phoneNumber === lastLookedUpPhone.current) return;
        lastLookedUpPhone.current = phoneNumber;

        setCompanyLookupState('searching');

        const lookupPhone = async () => {
            try {
                const digits = phoneNumber.replace(/\D/g, '');
                if (digits.length < 7) {
                    setCompanyLookupState('not-found');
                    return;
                }

                const last10 = digits.slice(-10);
                const filterParts = [
                    `phone_number = "${phoneNumber}"`,
                    `phone_number ~ "${phoneNumber}"`,
                ];
                if (digits !== phoneNumber) {
                    filterParts.push(`phone_number ~ "${digits}"`);
                }
                if (last10 !== digits && last10.length >= 7) {
                    filterParts.push(`phone_number ~ "${last10}"`);
                }

                const result = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 5, {
                    filter: filterParts.join(' || '),
                    expand: 'company',
                });

                if (result.items.length > 0) {
                    const bestMatch = result.items.find(
                        p => p.phone_number === phoneNumber
                    ) || result.items.find(
                        p => p.phone_number.replace(/\D/g, '') === digits
                    ) || result.items.find(
                        p => p.phone_number.replace(/\D/g, '').slice(-10) === last10
                    ) || result.items[0];

                    setPhoneNumberRecord(bestMatch);
                    const company = bestMatch.expand?.company as Company | undefined;
                    if (company) {
                        setAutoFetchedCompany(company);
                        setSelectedCompany(company);
                        setCompanySearch(company.company_name);
                        setIsNewCompany(false);
                        if (company.owner_name) {
                            setOwnerName(company.owner_name);
                        }
                        if (company.email) { setEmail(company.email); setShowEmail(true); }
                        setCompanyLookupState('found');
                        return;
                    }
                }

                // Phone not found — apply suggested company from power dialer if available
                setPhoneNumberRecord(null);
                setAutoFetchedCompany(null);
                setCompanyLookupState('not-found');
            } catch {
                setCompanyLookupState('not-found');
            }
        };

        lookupPhone();
    }, [phoneNumber]);

    // Apply suggestedCompanyName when phone lookup fails to find a company
    useEffect(() => {
        if (!suggestedCompanyName) return;
        if (suggestedCompanyName === lastAppliedSuggestion.current) return;
        if (companyLookupState !== 'not-found') return;
        if (selectedCompany) return; // Already have a company

        lastAppliedSuggestion.current = suggestedCompanyName;

        // Search for the suggested company name
        const applysuggested = async () => {
            try {
                const result = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(1, 5, {
                    filter: `company_name ~ "${suggestedCompanyName}"`,
                    sort: 'company_name',
                });
                const exactMatch = result.items.find(
                    c => c.company_name.toLowerCase() === suggestedCompanyName.toLowerCase()
                );
                if (exactMatch) {
                    setSelectedCompany(exactMatch);
                    setCompanySearch(exactMatch.company_name);
                    setIsNewCompany(false);
                    if (exactMatch.owner_name) {
                        setOwnerName(exactMatch.owner_name);
                    }
                    if (exactMatch.email) { setEmail(exactMatch.email); setShowEmail(true); }
                } else {
                    // No exact match — pre-fill name for creation (even if partial matches exist)
                    setCompanySearch(suggestedCompanyName);
                    setIsNewCompany(true);
                }
            } catch {
                // ignore
            }
        };
        applysuggested();
    }, [suggestedCompanyName, companyLookupState, selectedCompany]);

    // Sync "None" with other performance options
    useEffect(() => {
        if (ownerReached || pitchCompleted || appointmentSet) {
            setNoneSelected(false);
        }
    }, [ownerReached, pitchCompleted, appointmentSet]);

    // Check phone uniqueness when company changes (only for new companies)
    useEffect(() => {
        if (!isNewCompany || !phoneNumber) {
            setPhoneExistsForOtherCompany(false);
            return;
        }
        if (phoneNumberRecord) {
            setPhoneExistsForOtherCompany(true);
            return;
        }
        setPhoneExistsForOtherCompany(false);
    }, [isNewCompany, phoneNumber, phoneNumberRecord]);

    // Fetch call history when auto-matched company changes
    useEffect(() => {
        if (!autoFetchedCompany) {
            setCallHistory([]);
            lastFetchedHistoryCompanyId.current = '';
            return;
        }
        if (autoFetchedCompany.id === lastFetchedHistoryCompanyId.current) return;
        lastFetchedHistoryCompanyId.current = autoFetchedCompany.id;

        setCallHistoryLoading(true);
        pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
            filter: `company = "${autoFetchedCompany.id}"`,
            sort: '-call_time',
            expand: 'phone_number_record',
        }).then(logs => {
            setCallHistory(logs);
        }).catch(console.error).finally(() => {
            setCallHistoryLoading(false);
        });
    }, [autoFetchedCompany]);

    // Fetch pre-call notes for the auto-matched company
    useEffect(() => {
        if (!autoFetchedCompany) {
            setPreCallNotes([]);
            lastFetchedNotesCompanyId.current = '';
            setEditingPreCallNote(false);
            setPreCallNoteDraft('');
            return;
        }
        if (autoFetchedCompany.id === lastFetchedNotesCompanyId.current) return;
        lastFetchedNotesCompanyId.current = autoFetchedCompany.id;
        setEditingPreCallNote(false);
        setPreCallNoteDraft('');

        setPreCallNotesLoading(true);
        pb.collection(COLLECTIONS.COMPANY_NOTES).getFullList<CompanyNote>({
            filter: `company = "${autoFetchedCompany.id}" && note_type = "pre_call"`,
            sort: '-created',
            expand: 'created_by',
        }).then(notes => {
            setPreCallNotes(notes);
        }).catch(console.error).finally(() => {
            setPreCallNotesLoading(false);
        });
    }, [autoFetchedCompany]);

    // Fetch pending follow-ups for the matched company
    useEffect(() => {
        const companyId = autoFetchedCompany?.id || selectedCompany?.id;
        if (!companyId) {
            setPendingFollowUps([]);
            return;
        }
        pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
            filter: `status = "pending" && company = "${companyId}"`,
            sort: 'scheduled_time',
        }).then(setPendingFollowUps).catch(() => setPendingFollowUps([]));
    }, [autoFetchedCompany?.id, selectedCompany?.id]);

    // Reset pulse trigger when call ends so next call can re-trigger
    useEffect(() => {
        if (!isCallLive) {
            priorCallsPulseTriggeredRef.current = false;
        }
    }, [isCallLive]);

    // Scroll to & pulse Prior Calls + owner name when call starts and history is available
    useEffect(() => {
        if (!isCallLive || callHistory.length === 0 || priorCallsPulseTriggeredRef.current) return;
        priorCallsPulseTriggeredRef.current = true;
        const timer = setTimeout(() => {
            priorCallsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setPriorCallsPulsing(true);
            setTimeout(() => setPriorCallsPulsing(false), 3700);
        }, 200);
        return () => clearTimeout(timer);
    }, [isCallLive, callHistory.length]);

    // Search companies
    useEffect(() => {
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (companySearch.length < 2) {
            setCompanyResults([]);
            setIsNewCompany(false);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const result = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(1, 8, {
                    filter: `company_name ~ "${companySearch}"`,
                    sort: 'company_name',
                });
                setCompanyResults(result.items);

                const exactMatch = result.items.find(
                    c => c.company_name.toLowerCase() === companySearch.toLowerCase()
                );

                if (exactMatch) {
                    setIsNewCompany(false);
                } else if (result.items.length === 0) {
                    setIsNewCompany(true);
                } else {
                    setIsNewCompany(true);
                }

                setShowCompanyDropdown(result.items.length > 0);
            } catch {
                setIsNewCompany(true);
            }
        }, 300);

        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        };
    }, [companySearch]);

    // Close dropdowns on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowCompanyDropdown(false);
            }
            if (callbackDropdownRef.current && !callbackDropdownRef.current.contains(e.target as Node)) {
                setShowCallbackDropdown(false);
            }
            if (hungUpDropdownRef.current && !hungUpDropdownRef.current.contains(e.target as Node)) {
                setShowHungUpDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const selectCompany = (company: Company) => {
        setSelectedCompany(company);
        setCompanySearch(company.company_name);
        setShowCompanyDropdown(false);
        setIsNewCompany(false);
        if (company.owner_name) {
            setOwnerName(company.owner_name);
        }
        if (company.email) { setEmail(company.email); setShowEmail(true); }
    };

    // Toggle "Owner Reached?" — auto-fills ownerName from receptionistName if recep IS the owner
    const handleOwnerTagClick = () => {
        const newOwnerState = !ownerReached;
        setOwnerReached(newOwnerState);
        if (newOwnerState) {
            setNoneSelected(false);
            // If owner name is empty and receptionist name is set, auto-fill (recep = owner)
            if (!ownerName && receptionistName) {
                setOwnerName(receptionistName);
            }
        }
    };

    const handleNoneToggle = () => {
        setNoneSelected(true);
        setOwnerReached(false);
        setPitchCompleted(false);
        setAppointmentSet(false);
    };

    const isSavingRef = useRef(false);

    const handleSave = useCallback(async () => {
        if (!selectedCompany && !isNewCompany) return;
        if (!companySearch.trim()) return;
        if (callOutcome.length === 0) return;
        if (isSavingRef.current) return;
        isSavingRef.current = true;

        try {
            let companyId: string;
            let companyName: string;

            if (isNewCompany) {
                const trimmedName = companySearch.trim();
                const newCompany = await pb.collection(COLLECTIONS.COMPANIES).create<Company>({
                    company_name: trimmedName,
                    owner_name: ownerName || undefined,
                    source: 'Cold Call',
                    first_contacted: new Date().toISOString(),
                    last_contacted: new Date().toISOString(),
                    website: extractWebsiteFromName(trimmedName),
                });
                companyId = newCompany.id;
                companyName = newCompany.company_name;
            } else if (selectedCompany) {
                companyId = selectedCompany.id;
                companyName = selectedCompany.company_name;
            } else {
                return;
            }

            onSave({
                companyId,
                companyName,
                phoneNumber,
                receptionistName,
                ownerName,
                callOutcome,
                postCallNotes,
                wasPickedUp: !callOutcome.includes('No Answer') && callOutcome.length > 0,
                ownerReached,
                pitchCompleted,
                appointmentSet,
                followUp: showFollowUp ? followUpData : null,
                callbackEvents: callbackEvents.length > 0 ? callbackEvents : undefined,
                additionalPhoneNumber: additionalPhoneNumber.trim() || undefined,
                additionalPhoneNote: additionalPhoneNote.trim() || undefined,
                email: email.trim() || undefined,
                completeFollowUpIds: completeFollowUps && pendingFollowUps.length > 0
                    ? pendingFollowUps.map(f => f.id)
                    : undefined,
            });

            resetForm();
        } catch (err) {
            console.error('Failed to save call:', err);
        } finally {
            isSavingRef.current = false;
        }
    }, [selectedCompany, isNewCompany, companySearch, phoneNumber, receptionistName, ownerName, callOutcome, postCallNotes, ownerReached, pitchCompleted, appointmentSet, onSave, showFollowUp, followUpData, callbackEvents, additionalPhoneNumber, additionalPhoneNote, email, completeFollowUps, pendingFollowUps, resetForm]);

    const hasDraftValues =
        companySearch.trim().length > 0 ||
        !!selectedCompany ||
        receptionistName.trim().length > 0 ||
        ownerName.trim().length > 0 ||
        callOutcome.length > 0 ||
        postCallNotes.trim().length > 0 ||
        ownerReached ||
        pitchCompleted ||
        appointmentSet ||
        showFollowUp ||
        !!followUpData;

    const handleConfirmDiscard = useCallback(() => {
        resetForm();
        onDraftChange?.(EMPTY_DRAFT);
        onDiscard?.();
        setShowDiscardConfirm(false);
    }, [onDiscard, onDraftChange, resetForm]);

    // Combine all pre-call notes into one string for inline display/edit.
    // Most recent first (DB query sorts by '-created').
    const combinedPreCallNote = preCallNotes.map(n => n.content).join('\n\n');
    const mostRecentPreCallNote = preCallNotes[0] ?? null;

    const handleStartEditPreCallNote = useCallback(() => {
        setPreCallNoteDraft(combinedPreCallNote);
        setEditingPreCallNote(true);
    }, [combinedPreCallNote]);

    const handleCancelEditPreCallNote = useCallback(() => {
        setEditingPreCallNote(false);
        setPreCallNoteDraft('');
    }, []);

    const handleSavePreCallNote = useCallback(async () => {
        if (!selectedCompany || !user) return;
        const trimmed = preCallNoteDraft.trim();
        setSavingPreCallNote(true);
        try {
            if (trimmed.length === 0) {
                // Delete all existing pre-call notes if cleared
                await Promise.all(preCallNotes.map(n =>
                    pb.collection(COLLECTIONS.COMPANY_NOTES).delete(n.id)
                ));
                setPreCallNotes([]);
            } else if (mostRecentPreCallNote) {
                // Update existing most-recent note; delete older duplicates
                const updated = await pb.collection(COLLECTIONS.COMPANY_NOTES).update<CompanyNote>(
                    mostRecentPreCallNote.id,
                    { content: trimmed },
                    { expand: 'created_by' }
                );
                const older = preCallNotes.slice(1);
                await Promise.all(older.map(n =>
                    pb.collection(COLLECTIONS.COMPANY_NOTES).delete(n.id)
                ));
                setPreCallNotes([updated]);
            } else {
                // Create new note
                const created = await pb.collection(COLLECTIONS.COMPANY_NOTES).create<CompanyNote>(
                    {
                        company: selectedCompany.id,
                        note_type: 'pre_call',
                        content: trimmed,
                        created_by: user.id,
                    },
                    { expand: 'created_by' }
                );
                setPreCallNotes([created]);
            }
            setEditingPreCallNote(false);
            setPreCallNoteDraft('');
        } catch (err) {
            console.error('Failed to save pre-call note:', err);
        } finally {
            setSavingPreCallNote(false);
        }
    }, [selectedCompany, user, preCallNoteDraft, preCallNotes, mostRecentPreCallNote]);

    const hasCompany = (selectedCompany || isNewCompany) && companySearch.trim().length >= 2;
    const hasPhoneNumber = !!phoneNumber;
    const hasOutcome = callOutcome.length > 0;
    // Only allow save after a call has actually happened (hasUnsavedCall === true).
    // During a live call: allow only if there's a previous unsaved call (callback scenario).
    // Before any call is made: always disabled.
    const canSave = hasCompany && hasPhoneNumber && hasOutcome && !saving && hasUnsavedCall;

    const handleCallbackSelect = (reason: CallbackReason) => {
        setShowCallbackDropdown(false);
        onCallback?.(reason);
    };

    const isHungUpOutcome = callOutcome.includes(HUNG_UP_PRIMARY) || callOutcome.includes(HUNG_UP_OTHER);
    const isAtMaxOutcomes = callOutcome.length >= MAX_OUTCOMES;

    const isRealNotesMode = !!(autoFetchedCompany && selectedCompany?.id === autoFetchedCompany.id);
    const displayCompany = isRealNotesMode ? autoFetchedCompany : null;
    const displayCallHistory = callHistory;
    const displayCallHistoryLoading = callHistoryLoading;
    const displayPreCallNotesLoading = preCallNotesLoading;

    return (
        <div className={cn(
            "bg-[var(--card-bg)] border rounded-xl p-5 space-y-4 transition-all duration-300",
            hasUnsavedCall
                ? "border-[var(--warning)] shadow-[0_0_0_1px_var(--warning),0_0_15px_-3px_var(--warning)] animate-[pulse-border_2s_ease-in-out_infinite]"
                : "border-[var(--card-border)]"
        )}>
            {/* Header with unsaved indicator */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                        {hasUnsavedCall && isCallLive ? 'Last Call' : 'Current Call'}
                    </h3>
                    {hasUnsavedCall && isCallLive && deferredSegments.length > 1 && (
                        <span className="text-[10px] font-semibold text-[var(--info)] bg-[var(--info-subtle)] px-1.5 py-0.5 rounded">
                            {deferredSegments.length} calls queued
                        </span>
                    )}
                </div>
                {hasUnsavedCall && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--warning-subtle)] border border-[var(--warning)]/30">
                            <AlertCircle size={12} className="text-[var(--warning)]" />
                            <span className="text-[10px] font-semibold text-[var(--warning)] uppercase tracking-wider">
                                Recorded but unsubmitted
                            </span>
                            {recordingStatus && (
                                <span
                                    className={cn(
                                        "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-1 border",
                                        recordingStatus.tone === 'recording' && "bg-[var(--error-subtle)] text-[var(--error)] border-[var(--error)]/30",
                                        recordingStatus.tone === 'processing' && "bg-[var(--info-subtle)] text-[var(--info)] border-[var(--info)]/30",
                                        recordingStatus.tone === 'uploading' && "bg-[var(--info-subtle)] text-[var(--info)] border-[var(--info)]/30",
                                        recordingStatus.tone === 'pending' && "bg-[var(--warning-subtle)] text-[var(--warning)] border-[var(--warning)]/30",
                                        recordingStatus.tone === 'failed' && "bg-[var(--error-subtle)] text-[var(--error)] border-[var(--error)]/30",
                                        recordingStatus.tone === 'uploaded' && "bg-[var(--success-subtle)] text-[var(--success)] border-[var(--success)]/30",
                                    )}
                                    title={
                                        recordingStatus.tone === 'uploaded'
                                            ? 'Saved to CRM — click the mic to listen'
                                            : recordingStatus.label
                                    }
                                >
                                    {(recordingStatus.tone === 'processing' || recordingStatus.tone === 'uploading' || recordingStatus.tone === 'pending') && (
                                        <Loader2 size={10} className="animate-spin" />
                                    )}
                                    {recordingStatus.tone === 'recording' && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--error)] animate-pulse" />
                                    )}
                                    {recordingStatus.tone === 'uploaded' && (
                                        <CheckCircle2 size={10} />
                                    )}
                                    {recordingStatus.tone === 'failed' && (
                                        <AlertTriangle size={10} />
                                    )}
                                    <span>{recordingStatus.label}</span>
                                </span>
                            )}
                            {hasRecordingForPlayback && (
                                <button
                                    type="button"
                                    onClick={handlePlayUnsubmitted}
                                    disabled={playerLoading === 'unsubmitted'}
                                    className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--warning)] text-white hover:scale-110 active:scale-95 transition-all ml-1 shadow-sm animate-pulse disabled:opacity-50 disabled:animate-none"
                                    title="Listen to unsubmitted recording"
                                >
                                    {playerLoading === 'unsubmitted' ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
                                </button>
                            )}
                        </div>

                        {/* Callback dropdown */}
                        {onCallback && (
                            <div className="relative" ref={callbackDropdownRef}>
                                <button
                                    type="button"
                                    onClick={() => setShowCallbackDropdown(v => !v)}
                                    className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border bg-[var(--info-subtle)] border-[var(--info)]/30 text-[var(--info)] hover:bg-[var(--info)]/20 transition-colors"
                                    title="Initiate a callback to the same number"
                                >
                                    Callback
                                    <ChevronDown size={10} className={cn("transition-transform", showCallbackDropdown && "rotate-180")} />
                                </button>

                                {showCallbackDropdown && (
                                    <div className="absolute right-0 top-full mt-1 z-30 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg min-w-[200px] overflow-hidden">
                                        <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
                                            Callback reason
                                        </div>
                                        {CALLBACK_REASONS.map(reason => (
                                            <button
                                                key={reason}
                                                type="button"
                                                onClick={() => handleCallbackSelect(reason)}
                                                className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-[var(--foreground)]"
                                            >
                                                {reason}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Callback events log */}
            {callbackEvents.length > 0 && (
                <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-[var(--info-subtle)] border border-[var(--info)]/20">
                    <span className="text-[10px] font-semibold text-[var(--info)] uppercase tracking-wider">
                        {callbackEvents.length} callback{callbackEvents.length > 1 ? 's' : ''} made during this call
                    </span>
                    {callbackEvents.map((evt, i) => (
                        <span key={i} className="text-[10px] text-[var(--info)]/80">
                            #{i + 1}: {evt.reason} — {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                    ))}
                </div>
            )}

            {/* Auto-fetched company banner */}
            {autoFetchedCompany && selectedCompany?.id === autoFetchedCompany.id && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--success-subtle)] border border-[var(--success)]/20">
                    <Building2 size={14} className="text-[var(--success)]" />
                    <span className="text-xs text-[var(--success)] font-medium">
                        Auto-matched to {autoFetchedCompany.company_name} from phone number
                    </span>
                </div>
            )}

            {/* Phone not found in DB */}
            {phoneNumber && companyLookupState === 'not-found' && !selectedCompany && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--card-hover)] border border-[var(--card-border)]">
                    <AlertCircle size={14} className="text-[var(--muted)] shrink-0" />
                    <span className="text-xs text-[var(--muted)]">
                        {formatPhoneNumber(phoneNumber)} is not in the database
                    </span>
                </div>
            )}

            {/* Notes panel — pre-call notes + brief call history, shown when company is auto-matched */}
            {displayCompany && (() => {
                // Group logs by phone_number_record (or 'unknown')
                const byPhone = new Map<string, { phone: string; calls: CallLog[] }>();
                for (const log of displayCallHistory) {
                    const key = log.phone_number_record || 'unknown';
                    const display = log.expand?.phone_number_record?.phone_number || 'Unknown';
                    if (!byPhone.has(key)) byPhone.set(key, { phone: display, calls: [] });
                    byPhone.get(key)!.calls.push(log);
                }
                const groups = [...byPhone.entries()].sort((a, b) => b[1].calls.length - a[1].calls.length);

                return (
                    <div ref={priorCallsRef} className={cn("border border-[var(--card-border)] rounded-lg overflow-hidden text-sm", priorCallsPulsing && "animate-[prior-call-pulse_1.8s_ease-in-out_2]")}>
                        <div className="px-3 py-1.5 bg-[var(--sidebar-bg)] border-b border-[var(--card-border)] flex items-center justify-between">
                            <span className="font-semibold uppercase tracking-wider text-[var(--muted)] text-xs flex items-center gap-1.5">
                                <StickyNote size={12} />
                                Notes
                            </span>
                            {displayCallHistoryLoading ? (
                                <span className="text-xs text-[var(--muted)]">Loading…</span>
                            ) : (
                                <span className="text-xs text-[var(--muted)]">{displayCallHistory.length} call{displayCallHistory.length !== 1 ? 's' : ''}</span>
                            )}
                        </div>

                        {/* Pre-call note line (editable inline) */}
                        {displayPreCallNotesLoading ? (
                            <div className="px-3 py-2 text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                                Loading pre-call notes…
                            </div>
                        ) : editingPreCallNote ? (
                            <div className="px-3 py-2 space-y-1.5 border-b border-[var(--card-border)]">
                                <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
                                    Pre-call note
                                </label>
                                <textarea
                                    value={preCallNoteDraft}
                                    onChange={(e) => setPreCallNoteDraft(e.target.value)}
                                    autoFocus
                                    rows={3}
                                    placeholder="Add a pre-call note for this company…"
                                    className="w-full text-xs bg-[var(--card-bg)] border border-[var(--card-border)] rounded-md px-2 py-1.5 resize-y focus:outline-none focus:border-[var(--primary)] text-[var(--foreground)]"
                                />
                                <div className="flex items-center justify-end gap-1.5">
                                    <button
                                        type="button"
                                        onClick={handleCancelEditPreCallNote}
                                        disabled={savingPreCallNote}
                                        className="px-2 py-1 rounded-md text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSavePreCallNote}
                                        disabled={savingPreCallNote}
                                        className="px-2 py-1 rounded-md text-[10px] font-semibold bg-[var(--primary)] text-white hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50 flex items-center gap-1"
                                    >
                                        {savingPreCallNote && <Loader2 size={10} className="animate-spin" />}
                                        Save
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handleStartEditPreCallNote}
                                className="w-full px-3 py-2 text-xs text-left border-b border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors group flex items-start gap-1.5"
                                title={combinedPreCallNote ? 'Click to edit pre-call note' : 'Click to add a pre-call note'}
                            >
                                <span className="flex-1 min-w-0">
                                    <span className="font-semibold text-[var(--muted)]">Pre call note: </span>
                                    {combinedPreCallNote ? (
                                        <span className="text-[var(--foreground)]/80 whitespace-pre-wrap break-words">{combinedPreCallNote}</span>
                                    ) : (
                                        <span className="text-[var(--muted)] italic">None</span>
                                    )}
                                </span>
                                <Pencil size={11} className="shrink-0 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                            </button>
                        )}

                        {!displayCallHistoryLoading && displayCallHistory.length === 0 && (
                            <div className="px-3 py-2 text-xs text-[var(--muted)] italic">
                                No prior calls
                            </div>
                        )}
                        {!displayCallHistoryLoading && displayCallHistory.length > 0 && (
                            <div className="divide-y divide-[var(--card-border)] max-h-48 overflow-y-auto">
                                {groups.map(([key, { phone, calls }]) => {
                                    const notedCalls = calls.filter(c => c.post_call_notes);
                                    return (
                                        <div key={key} className="px-3 py-2">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <PhoneHoverCard phoneNumber={phone !== 'Unknown' ? phone : undefined} phoneRecord={calls[0]?.expand?.phone_number_record} side="bottom">
                                                  <span className="font-mono font-medium text-[var(--foreground)] cursor-default">{phone}</span>
                                                </PhoneHoverCard>
                                                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--card-hover)] text-[var(--muted)] font-semibold whitespace-nowrap">
                                                    {calls.length} call{calls.length !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div className="space-y-1 ml-1.5 border-l border-[var(--card-border)] pl-2">
                                                {calls.slice(0, 3).map((call, idx) => (
                                                        <div key={call.id} className="space-y-0.5">
                                                                <div className="flex items-center gap-1.5 text-xs flex-wrap">
                                                                    <Tooltip content={`${formatDateTime(call.call_time)} (Your Time)`}>
                                                                        <span className="text-[var(--muted)] whitespace-nowrap shrink-0 cursor-help">
                                                                            {timeAgo(call.call_time)}
                                                                        </span>
                                                                    </Tooltip>
                                                                    {call.has_recording && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handlePlayRecording(call)}
                                                                            disabled={!!playerLoading}
                                                                            className={cn(
                                                                                "flex items-center justify-center w-5 h-5 rounded-lg transition-all",
                                                                                playerLoading === call.id 
                                                                                    ? "text-[var(--primary)]" 
                                                                                    : "text-[var(--primary)] hover:bg-[var(--primary)]/10"
                                                                            )}
                                                                            title="Play recording"
                                                                        >
                                                                            {playerLoading === call.id ? <Loader2 size={10} className="animate-spin" /> : <Mic size={10} />}
                                                                        </button>
                                                                    )}
                                                                    {call.receptionist_name && (
                                                                        <span className="text-[var(--foreground)]/80 whitespace-nowrap shrink-0 font-medium">
                                                                            {call.receptionist_name}
                                                                        </span>
                                                                    )}
                                                                    {/* Outcome tags for this specific call */}
                                                                    <div className="flex gap-1 flex-wrap">
                                                                        {(Array.isArray(call.call_outcome) ? call.call_outcome : call.call_outcome ? [call.call_outcome] : []).map(outcome => {
                                                                            const colors = getOutcomeColors(outcome);
                                                                            return (
                                                                                <span
                                                                                    key={outcome}
                                                                                    className={cn(
                                                                                        "px-1.5 py-0.5 rounded text-[9px] font-semibold border leading-none",
                                                                                        colors.bg,
                                                                                        colors.text,
                                                                                        colors.border
                                                                                    )}
                                                                                >
                                                                                    {outcome}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                                {call.post_call_notes && (
                                                                    <div className="text-[var(--foreground)]/70 line-clamp-1 text-xs ml-4" title={call.post_call_notes}>
                                                                        {call.post_call_notes}
                                                                    </div>
                                                                )}
                                                            </div>
                                                    ))}
                                                </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Phone uniqueness warning */}
            {phoneExistsForOtherCompany && isNewCompany && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--warning-subtle)] border border-[var(--warning)]/20">
                    <AlertTriangle size={14} className="text-[var(--warning)]" />
                    <span className="text-xs text-[var(--warning)] font-medium">
                        This phone number is already linked to another company. Consider selecting the existing company instead.
                    </span>
                </div>
            )}

            {/* Company autocomplete */}
            <div className="relative" ref={dropdownRef}>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center justify-between">
                    <span>Company <span className="text-[var(--error)]">*</span></span>
                    {isNewCompany && !selectedCompany && companySearch.trim().length >= 2 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-semibold uppercase tracking-wider">
                            New
                        </span>
                    )}
                    {selectedCompany && companyLookupState !== 'found' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-semibold uppercase tracking-wider">
                            Other Location
                        </span>
                    )}
                </label>
                <div className={cn(
                    "rounded-lg",
                    companyLookupState === 'searching' && "company-spin-border p-[2px]"
                )}>
                    <div className={cn(
                        "relative",
                        companyLookupState === 'searching' && "bg-[var(--sidebar-bg)] rounded-[6px]"
                    )}>
                        <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                        <input
                            type="text"
                            value={companySearch}
                            onChange={e => {
                                setCompanySearch(e.target.value);
                                setSelectedCompany(null);
                            }}
                            placeholder="Search or create company..."
                            className={cn(
                                "w-full pl-8 pr-3 py-2 text-sm focus:outline-none transition-all",
                                companyLookupState === 'searching'
                                    ? "bg-transparent border-0 rounded-[6px]"
                                    : companyLookupState === 'not-found' && !companySearch.trim()
                                        ? "bg-[var(--sidebar-bg)] border border-[var(--error)] rounded-lg animate-[pulse-red-border_2s_ease-in-out_infinite]"
                                        : "bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg focus:border-[var(--primary)]"
                            )}
                        />
                        {selectedCompany && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--success)]" />
                        )}
                    </div>
                </div>

                {showCompanyDropdown && companyResults.length > 0 && (
                    <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {companyResults.map(company => (
                            <button
                                key={company.id}
                                onClick={() => selectCompany(company)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--sidebar-bg)] transition-colors flex items-center justify-between"
                            >
                                <span className="font-medium">{company.company_name}</span>
                                {company.owner_name && (
                                    <span className="text-xs text-[var(--muted)]">{company.owner_name}</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Phone number display */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-2">
                    <span>Phone Number <span className="text-[var(--error)]">*</span></span>
                    {isCallLive && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--success)] uppercase tracking-wider">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                            Live
                        </span>
                    )}
                </label>
                <PhoneHoverCard phoneNumber={phoneNumber || undefined} side="bottom">
                  <div className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-300",
                      isCallLive
                          ? "bg-[var(--success-subtle)] border border-[var(--success)] animate-[pulse-green-border_2s_ease-in-out_infinite]"
                          : "bg-[var(--sidebar-bg)] border border-[var(--card-border)]"
                  )}>
                      <PhoneIcon size={14} className={isCallLive ? "text-[var(--success)]" : "text-[var(--muted)]"} />
                      <span className={cn("font-mono", isCallLive && "text-[var(--success)] font-medium")}>{phoneNumber ? formatPhoneNumber(phoneNumber) : '—'}</span>
                  </div>
                </PhoneHoverCard>
            </div>

            {/* Receptionist Name with "Owner Reached?" tag */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-2">
                    <span>Receptionist Name</span>
                    <button
                        type="button"
                        onClick={handleOwnerTagClick}
                        className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider border transition-all cursor-pointer",
                            ownerReached
                                ? "bg-[var(--success-subtle)] text-[var(--success)] border-[var(--success)]/30 hover:bg-[var(--success)]/20"
                                : "bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]",
                            shouldPulseOwnerReached && "animate-[attention-pulse_1.5s_ease-in-out_infinite] border-[var(--warning)] text-[var(--warning)]"
                        )}
                    >
                        Owner Reached?
                    </button>
                </label>
                <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                        type="text"
                        value={receptionistName}
                        onChange={e => setReceptionistName(e.target.value)}
                        placeholder="Receptionist name(s), e.g. Sarah, Mike"
                        className="w-full pl-8 pr-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                    />
                </div>
            </div>

            {/* Owner's Name — always visible */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-2">
                    <Crown size={11} className={ownerReached ? "text-[var(--success)]" : "text-[var(--muted)]"} />
                    <span className={ownerReached ? "text-[var(--success)]" : ""}>Owner&apos;s Name</span>
                    {ownerReached && (
                        <button
                            type="button"
                            onClick={() => setOwnerReached(false)}
                            className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] border border-[var(--success)]/30 font-semibold uppercase tracking-wider hover:bg-[var(--success)]/10 transition-colors cursor-pointer"
                        >
                            Reached
                        </button>
                    )}
                    {/* Saved/Update Status Tag */}
                    {selectedCompany?.owner_name && (
                        ownerName === selectedCompany.owner_name ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] border border-[var(--success)]/30 font-semibold uppercase tracking-wider">
                                Saved
                            </span>
                        ) : ownerName.trim() !== '' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--warning-subtle)] text-[var(--warning)] border border-[var(--warning)]/30 font-semibold uppercase tracking-wider">
                                Update
                            </span>
                        )
                    )}
                </label>
                <div ref={ownerNameRef} className={cn("relative rounded-lg", priorCallsPulsing && ownerName.trim() && "animate-[prior-call-pulse_1.8s_ease-in-out_2]")}>
                    <Crown size={14} className={cn("absolute left-3 top-1/2 -translate-y-1/2", ownerReached ? "text-[var(--success)]" : "text-[var(--muted)]")} />
                    <input
                        type="text"
                        value={ownerName}
                        onChange={e => {
                            const val = e.target.value;
                            setOwnerName(val);
                            
                            // Signal that owner might have been reached, but don't auto-toggle
                            if (val.trim() && !ownerReached) {
                                setShouldPulseOwnerReached(true);
                                if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
                                pulseTimeoutRef.current = setTimeout(() => {
                                    setShouldPulseOwnerReached(false);
                                }, 8000);
                            }
                        }}
                        placeholder="Owner name(s), e.g. John, Mike"
                        className={cn(
                            "w-full pl-8 pr-3 py-2 rounded-lg text-sm focus:outline-none transition-colors",
                            ownerReached
                                ? "bg-[var(--success-subtle)] border border-[var(--success)]/40 focus:border-[var(--success)]"
                                : "bg-[var(--sidebar-bg)] border border-[var(--card-border)] focus:border-[var(--primary)]"
                        )}
                    />
                </div>
            </div>

            {/* Call Outcome pills */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1.5 block">
                    Call Outcome <span className="text-[var(--error)]">*</span>
                    {callOutcome.length > 0 && (
                        <span className="ml-2 text-[10px] font-semibold text-[var(--muted)]">
                            {callOutcome.length}/{MAX_OUTCOMES}
                        </span>
                    )}
                </label>
                <div className="flex flex-wrap gap-1.5">
                    {FORM_OUTCOMES.map(outcome => {
                        if (outcome === 'Other +') {
                            // "Other +" opens an inline input to type a custom outcome
                            const otherPlusColors = getOutcomeColors('Other +');
                            const isDisabled = isAtMaxOutcomes;
                            return (
                                <div key="other-plus" className="relative">
                                    <button
                                        onClick={() => {
                                            setShowOtherInput(v => !v);
                                            setTimeout(() => otherInputRef.current?.focus(), 50);
                                        }}
                                        disabled={isDisabled}
                                        className={cn(
                                            'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                                            showOtherInput
                                                ? `${otherPlusColors.bg} ${otherPlusColors.text} ${otherPlusColors.border}`
                                                : isDisabled
                                                    ? 'bg-[var(--sidebar-bg)] text-[var(--muted)]/40 border-[var(--card-border)] opacity-40 cursor-not-allowed'
                                                    : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                                        )}
                                    >
                                        Other +
                                    </button>
                                    {showOtherInput && (
                                        <div className="absolute left-0 top-full mt-1 z-30 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg p-2 min-w-[220px]">
                                            <div className="flex gap-1.5 mb-1.5">
                                                <input
                                                    ref={otherInputRef}
                                                    type="text"
                                                    value={otherInputValue}
                                                    onChange={e => setOtherInputValue(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && otherInputValue.trim()) {
                                                            const name = otherInputValue.trim();
                                                            // Add custom outcome to DB (ignore duplicates)
                                                            pb.collection(COLLECTIONS.CUSTOM_CALL_OUTCOMES).create({ name }).catch(() => {});
                                                            if (!customOutcomes.includes(name)) {
                                                                setCustomOutcomes(prev => [...prev, name]);
                                                            }
                                                            toggleOutcome(name);
                                                            setOtherInputValue('');
                                                            setShowOtherInput(false);
                                                        }
                                                        if (e.key === 'Escape') {
                                                            setShowOtherInput(false);
                                                            setOtherInputValue('');
                                                        }
                                                    }}
                                                    placeholder="Type new outcome..."
                                                    className="flex-1 px-2 py-1.5 rounded border border-[var(--card-border)] bg-[var(--sidebar-bg)] text-xs focus:outline-none focus:border-[var(--primary)]"
                                                />
                                                <button
                                                    onClick={() => {
                                                        const name = otherInputValue.trim();
                                                        if (!name) return;
                                                        pb.collection(COLLECTIONS.CUSTOM_CALL_OUTCOMES).create({ name }).catch(() => {});
                                                        if (!customOutcomes.includes(name)) {
                                                            setCustomOutcomes(prev => [...prev, name]);
                                                        }
                                                        toggleOutcome(name);
                                                        setOtherInputValue('');
                                                        setShowOtherInput(false);
                                                    }}
                                                    className="px-2 py-1.5 rounded bg-[var(--primary)] text-white text-xs font-medium hover:bg-[var(--primary-hover)] transition-colors"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                            {customOutcomes.length > 0 && (
                                                <div className="flex flex-wrap gap-1 pt-1 border-t border-[var(--card-border)]">
                                                    {customOutcomes.map(co => {
                                                        const coColors = getOutcomeColors(co);
                                                        const coSelected = callOutcome.includes(co);
                                                        return (
                                                            <button
                                                                key={co}
                                                                onClick={() => { toggleOutcome(co); setShowOtherInput(false); }}
                                                                disabled={!coSelected && isAtMaxOutcomes}
                                                                className={cn(
                                                                    'px-2 py-1 rounded text-[11px] font-medium border transition-all',
                                                                    coSelected
                                                                        ? `${coColors.bg} ${coColors.text} ${coColors.border}`
                                                                        : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                                                                )}
                                                            >
                                                                {co}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        }
                        const colors = getOutcomeColors(outcome);
                        const isSelected = callOutcome.includes(outcome);
                        const isDisabled = !isSelected && isAtMaxOutcomes;
                        return (
                            <button
                                key={outcome}
                                onClick={() => toggleOutcome(outcome)}
                                disabled={isDisabled}
                                className={cn(
                                    'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                                    isSelected
                                        ? `${colors.bg} ${colors.text} ${colors.border}`
                                        : isDisabled
                                            ? 'bg-[var(--sidebar-bg)] text-[var(--muted)]/40 border-[var(--card-border)] opacity-40 cursor-not-allowed'
                                            : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                                )}
                            >
                                {outcome}
                            </button>
                        );
                    })}

                    {/* Any selected custom outcomes shown as active pills */}
                    {callOutcome.filter(o => !FORM_OUTCOMES.includes(o as any) && o !== HUNG_UP_PRIMARY && o !== HUNG_UP_OTHER).map(co => {
                        const coColors = getOutcomeColors(co);
                        return (
                            <button
                                key={co}
                                onClick={() => toggleOutcome(co)}
                                className={cn(
                                    'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                                    `${coColors.bg} ${coColors.text} ${coColors.border}`
                                )}
                            >
                                {co} <X size={10} className="inline ml-0.5" />
                            </button>
                        );
                    })}

                    {/* Hung Up split button */}
                    <div className="relative flex" ref={hungUpDropdownRef}>
                        {(() => {
                            const activeHungUp = callOutcome.includes(HUNG_UP_PRIMARY) ? HUNG_UP_PRIMARY
                                : callOutcome.includes(HUNG_UP_OTHER) ? HUNG_UP_OTHER
                                    : null;
                            const hungUpDisabled = !activeHungUp && isAtMaxOutcomes;
                            const hungColors = activeHungUp ? getOutcomeColors(activeHungUp) : null;
                            return (
                                <>
                                    <button
                                        onClick={() => toggleOutcome(activeHungUp || HUNG_UP_PRIMARY)}
                                        disabled={hungUpDisabled}
                                        className={cn(
                                            'px-2.5 py-1.5 rounded-l-lg text-xs font-medium border-y border-l transition-all',
                                            hungColors
                                                ? `${hungColors.bg} ${hungColors.text} ${hungColors.border}`
                                                : hungUpDisabled
                                                    ? 'bg-[var(--sidebar-bg)] text-[var(--muted)]/40 border-[var(--card-border)] opacity-40 cursor-not-allowed'
                                                    : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                                        )}
                                    >
                                        {activeHungUp || HUNG_UP_PRIMARY}
                                    </button>
                                    <button
                                        onClick={() => setShowHungUpDropdown(v => !v)}
                                        disabled={hungUpDisabled}
                                        className={cn(
                                            'px-1.5 py-1.5 rounded-r-lg text-xs font-medium border transition-all border-l-0',
                                            hungColors
                                                ? `${hungColors.bg} ${hungColors.text} ${hungColors.border}`
                                                : hungUpDisabled
                                                    ? 'bg-[var(--sidebar-bg)] text-[var(--muted)]/40 border-[var(--card-border)] opacity-40 cursor-not-allowed'
                                                    : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                                        )}
                                    >
                                        <ChevronDown size={10} className={cn("transition-transform", showHungUpDropdown && "rotate-180")} />
                                    </button>
                                </>
                            );
                        })()}
                        {showHungUpDropdown && (
                            <div className="absolute left-0 top-full mt-1 z-30 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg min-w-[160px] overflow-hidden">
                                {[HUNG_UP_PRIMARY, HUNG_UP_OTHER].map(opt => (
                                    <button
                                        key={opt}
                                        type="button"
                                        onClick={() => { toggleOutcome(opt); setShowHungUpDropdown(false); }}
                                        className={cn(
                                            "w-full text-left px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors",
                                            callOutcome.includes(opt) ? "font-semibold text-red-500" : "text-[var(--foreground)]"
                                        )}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Performance Tracking with None option */}
            <div className="space-y-2">
                <label className="text-xs text-[var(--muted)] mb-1 block">Performance</label>
                <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={noneSelected}
                            onChange={handleNoneToggle}
                            className="w-4 h-4 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--muted)] checked:border-[var(--muted)] transition-colors"
                        />
                        <span className="text-sm group-hover:text-[var(--foreground)] transition-colors text-[var(--muted)]">None</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={ownerReached}
                            onChange={e => {
                                setOwnerReached(e.target.checked);
                                if (e.target.checked) {
                                    setNoneSelected(false);
                                    if (!ownerName && receptionistName) {
                                        setOwnerName(receptionistName);
                                    }
                                }
                            }}
                            className="w-4 h-4 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--success)] checked:border-[var(--success)] transition-colors"
                        />
                        <span className="text-sm group-hover:text-[var(--foreground)] transition-colors">Owner Reached</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={pitchCompleted}
                            onChange={e => {
                                setPitchCompleted(e.target.checked);
                                if (e.target.checked) setNoneSelected(false);
                            }}
                            className="w-4 h-4 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--success)] checked:border-[var(--success)] transition-colors"
                        />
                        <span className="text-sm group-hover:text-[var(--foreground)] transition-colors">Pitch Completed</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={appointmentSet}
                            onChange={e => {
                                setAppointmentSet(e.target.checked);
                                if (e.target.checked) setNoneSelected(false);
                            }}
                            className="w-4 h-4 rounded border-[var(--card-border)] bg-[var(--sidebar-bg)] checked:bg-[var(--success)] checked:border-[var(--success)] transition-colors"
                        />
                        <span className="text-sm group-hover:text-[var(--foreground)] transition-colors">Appointment Set</span>
                    </label>
                </div>
            </div>

            {/* Notes — optional */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
                    <StickyNote size={12} />
                    <span>Post-call Notes <span className="text-[10px] text-[var(--muted)] font-normal">(optional)</span></span>
                </label>
                <textarea
                    value={postCallNotes}
                    onChange={e => setPostCallNotes(e.target.value)}
                    placeholder="Quick notes about the call..."
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors resize-none"
                />
            </div>

            {/* Additional Phone Number Found During Call */}
            <div className="border-t border-[var(--card-border)] pt-3 space-y-3">
                <button
                    type="button"
                    onClick={() => setShowAdditionalPhone(v => !v)}
                    className="flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors w-full"
                >
                    <Plus size={12} />
                    <span>Phone number found during call?</span>
                    <ChevronDown size={10} className={cn("transition-transform ml-auto", showAdditionalPhone && "rotate-180")} />
                </button>

                {showAdditionalPhone && (
                    <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                        <div className="relative">
                            <PhoneIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                            <input
                                type="text"
                                value={additionalPhoneNumber}
                                onChange={e => setAdditionalPhoneNumber(e.target.value)}
                                placeholder="New phone number found..."
                                className="w-full pl-8 pr-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                            />
                        </div>
                        <input
                            type="text"
                            value={additionalPhoneNote}
                            onChange={e => setAdditionalPhoneNote(e.target.value)}
                            placeholder="Label/note (e.g. Owner Direct, Manager Line)"
                            className="w-full px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                        />
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setShowEmail(v => !v)}
                    className="flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors w-full"
                >
                    <Mail size={12} />
                    <span>Email found during call?</span>
                    <ChevronDown size={10} className={cn("transition-transform ml-auto", showEmail && "rotate-180")} />
                </button>

                {showEmail && (
                    <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                        <div className="relative">
                            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="contact@company.com"
                                className="w-full pl-8 pr-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Pending follow-ups banner */}
            {pendingFollowUps.length > 0 && (
                <div className="border-t border-[var(--card-border)] pt-3">
                    <div className={cn(
                        "rounded-lg px-3 py-2.5 border transition-colors",
                        completeFollowUps
                            ? "bg-[var(--success-subtle)] border-[var(--success)]/30"
                            : "bg-[var(--warning-subtle)] border-[var(--warning)]/30"
                    )}>
                        <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={completeFollowUps}
                                onChange={e => setCompleteFollowUps(e.target.checked)}
                                className="mt-0.5 rounded accent-[var(--success)]"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--foreground)]">
                                    <CheckCircle2 size={14} className={completeFollowUps ? "text-[var(--success)]" : "text-[var(--warning)]"} />
                                    <span>
                                        {pendingFollowUps.length === 1
                                            ? 'Complete pending follow-up'
                                            : `Complete ${pendingFollowUps.length} pending follow-ups`
                                        }
                                    </span>
                                </div>
                                {pendingFollowUps.map(fu => (
                                    <p key={fu.id} className="text-xs text-[var(--muted)] mt-1 truncate">
                                        {fu.notes || 'No notes'} &middot; {new Date(fu.scheduled_time) < new Date() ? 'Overdue' : `Due ${timeAgo(fu.scheduled_time)}`}
                                    </p>
                                ))}
                            </div>
                        </label>
                    </div>
                </div>
            )}

            {/* Follow-up scheduling */}
            <div className="border-t border-[var(--card-border)] pt-3">
                {!showFollowUp ? (
                    <button
                        type="button"
                        onClick={() => setShowFollowUp(true)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--info)]/40 hover:bg-[var(--info-subtle)] transition-all"
                    >
                        <CalendarClock size={14} />
                        Schedule Follow-up
                    </button>
                ) : (
                    <div className="bg-[var(--info-subtle)] text-[var(--info)] border border-[var(--info)]/20 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between text-sm font-medium mb-3">
                            <div className="flex items-center gap-2">
                                <CalendarClock size={14} />
                                <span>Schedule Follow-up</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowFollowUp(false)}
                                className="flex items-center justify-center w-5 h-5 rounded-full text-[var(--info)] hover:bg-[var(--info)]/20 transition-all hover:scale-110"
                                title="Cancel follow-up"
                            >
                                <X size={13} />
                            </button>
                        </div>
                        <FollowUpScheduler
                            companyId={selectedCompany?.id ?? ''}
                            companyName={selectedCompany?.company_name ?? (companySearch.trim() || 'this company')}
                            phoneNumberRecordId={phoneNumberRecord?.id}
                            compact
                            onChange={setFollowUpData}
                        />
                    </div>
                )}
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => setShowDiscardConfirm(true)}
                    disabled={isCallLive || !hasUnsavedCall}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all border border-[var(--card-border)] bg-[var(--sidebar-bg)] text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Discard
                </button>

                <button
                    onClick={handleSave}
                    disabled={!canSave}
                    className={cn(
                        "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]",
                        hasUnsavedCall
                            ? "bg-[var(--warning)] text-white hover:opacity-90"
                            : "bg-[var(--foreground)] text-[var(--background)] hover:opacity-90"
                    )}
                >
                    <Save size={16} />
                    {saving ? 'Saving...' : hasUnsavedCall && isCallLive ? `Save Last Call${deferredSegments.length > 1 ? ` (1/${deferredSegments.length})` : ''}` : hasUnsavedCall ? 'Save Call' : isCallLive ? 'Call in Progress...' : 'Save Call & Next'}
                </button>
            </div>

            <ConfirmationModal
                isOpen={showDiscardConfirm}
                onClose={() => setShowDiscardConfirm(false)}
                onConfirm={handleConfirmDiscard}
                title="Discard current call details?"
                message="This will clear all unsaved fields for the current call. This action cannot be undone."
                confirmText="Discard"
                cancelText="Keep Editing"
                variant="warning"
            />

            <RecordingPlayerOverlay
                recording={playerRecording}
                blobUrl={playerBlob}
                onClose={closePlayer}
            />
        </div>
    );
}
