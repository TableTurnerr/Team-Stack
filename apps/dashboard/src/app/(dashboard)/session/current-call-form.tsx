'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Building2, User, Phone as PhoneIcon, StickyNote, AlertCircle, CalendarClock, X, AlertTriangle, ChevronDown, Plus, Crown, Mail } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type PhoneNumber, type CallLog } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FollowUpScheduler } from '@/components/follow-up-scheduler';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';

const OUTCOMES = [
    'Interested',
    'Not Interested',
    'Callback',
    'No Answer',
    'Fumbled',
    'Bad Lead',
    'Send Email',
    'Other',
] as const;

// The "Hung Up" group is rendered as a split button
const HUNG_UP_PRIMARY = 'Hung Up (Rude Recep)' as const;
const HUNG_UP_OTHER = 'Hung Up (Other)' as const;

const CALLBACK_REASONS = [
    'Callback (Recep hung up)',
    'Callback (Owner hung up)',
    'Callback (Audio Issue)',
    'Callback (Other)',
] as const;

export type CallbackReason = typeof CALLBACK_REASONS[number];

const OUTCOME_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]', border: 'border-[var(--success)]' },
    'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]', border: 'border-[var(--error)]' },
    'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]', border: 'border-[var(--warning)]' },
    'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]', border: 'border-[var(--muted)]' },
    'Fumbled': { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500' },
    'Bad Lead': { bg: 'bg-red-900/20', text: 'text-red-400', border: 'border-red-400' },
    'Send Email': { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-400' },
    'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]', border: 'border-[var(--info)]' },
    'Hung Up (Rude Recep)': { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500' },
    'Hung Up (Other)': { bg: 'bg-red-400/10', text: 'text-red-400', border: 'border-red-400' },
};

export interface CallFormData {
    companyId: string;
    companyName: string;
    phoneNumber: string;
    receptionistName: string;
    ownerName: string;
    callOutcome: string;
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
}

export interface CallFormDraft {
    companySearch: string;
    selectedCompany: Pick<Company, 'id' | 'company_name' | 'owner_name'> | null;
    receptionistName: string;
    ownerName: string;
    callOutcome: string;
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
    callOutcome: '',
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
    const [companySearch, setCompanySearch] = useState('');
    const [companyResults, setCompanyResults] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
    const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
    const [receptionistName, setReceptionistName] = useState('');
    const [ownerName, setOwnerName] = useState('');
    const [callOutcome, setCallOutcome] = useState('');
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
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const callbackDropdownRef = useRef<HTMLDivElement>(null);
    const hungUpDropdownRef = useRef<HTMLDivElement>(null);

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

    const [companyLookupState, setCompanyLookupState] = useState<'idle' | 'searching' | 'found' | 'not-found'>('idle');

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
        setCallOutcome('');
        setPostCallNotes('');
        setOwnerReached(false);
        setPitchCompleted(false);
        setAppointmentSet(false);
        setNoneSelected(true);
        setShowFollowUp(false);
        setFollowUpData(null);
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
        setCallOutcome(initialDraft.callOutcome || '');
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
                        if (bestMatch.receptionist_name) {
                            setReceptionistName(bestMatch.receptionist_name);
                        }
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
        if (!callOutcome) return;
        if (isSavingRef.current) return;
        isSavingRef.current = true;

        try {
            let companyId: string;
            let companyName: string;

            if (isNewCompany) {
                const newCompany = await pb.collection(COLLECTIONS.COMPANIES).create<Company>({
                    company_name: companySearch.trim(),
                    owner_name: ownerName || undefined,
                    source: 'Cold Call',
                    first_contacted: new Date().toISOString(),
                    last_contacted: new Date().toISOString(),
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
                wasPickedUp: callOutcome !== 'No Answer' && callOutcome !== '',
                ownerReached,
                pitchCompleted,
                appointmentSet,
                followUp: showFollowUp ? followUpData : null,
                callbackEvents: callbackEvents.length > 0 ? callbackEvents : undefined,
                additionalPhoneNumber: additionalPhoneNumber.trim() || undefined,
                additionalPhoneNote: additionalPhoneNote.trim() || undefined,
                email: email.trim() || undefined,
            });

            resetForm();
        } catch (err) {
            console.error('Failed to save call:', err);
        } finally {
            isSavingRef.current = false;
        }
    }, [selectedCompany, isNewCompany, companySearch, phoneNumber, receptionistName, ownerName, callOutcome, postCallNotes, ownerReached, pitchCompleted, appointmentSet, onSave, showFollowUp, followUpData, callbackEvents, additionalPhoneNumber, additionalPhoneNote, email, resetForm]);

    const hasDraftValues =
        companySearch.trim().length > 0 ||
        !!selectedCompany ||
        receptionistName.trim().length > 0 ||
        ownerName.trim().length > 0 ||
        !!callOutcome ||
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

    const hasCompany = (selectedCompany || isNewCompany) && companySearch.trim().length >= 2;
    const hasPhoneNumber = !!phoneNumber;
    const hasOutcome = !!callOutcome;
    const canSave = hasCompany && hasPhoneNumber && hasOutcome && !saving && !isCallLive;

    const handleCallbackSelect = (reason: CallbackReason) => {
        setShowCallbackDropdown(false);
        onCallback?.(reason);
    };

    const isHungUpOutcome = callOutcome === HUNG_UP_PRIMARY || callOutcome === HUNG_UP_OTHER;

    return (
        <div className={cn(
            "bg-[var(--card-bg)] border rounded-xl p-5 space-y-4 transition-all duration-300",
            hasUnsavedCall
                ? "border-[var(--warning)] shadow-[0_0_0_1px_var(--warning),0_0_15px_-3px_var(--warning)] animate-[pulse-border_2s_ease-in-out_infinite]"
                : "border-[var(--card-border)]"
        )}>
            {/* Header with unsaved indicator */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Current Call
                </h3>
                {hasUnsavedCall && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--warning-subtle)] border border-[var(--warning)]/30">
                            <AlertCircle size={12} className="text-[var(--warning)]" />
                            <span className="text-[10px] font-semibold text-[var(--warning)] uppercase tracking-wider">
                                Recorded but unsubmitted
                            </span>
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

            {/* Brief call history panel — shown when company is auto-matched */}
            {autoFetchedCompany && selectedCompany?.id === autoFetchedCompany.id && (callHistoryLoading || callHistory.length > 0) && (() => {
                // Group logs by phone_number_record (or 'unknown')
                const byPhone = new Map<string, { phone: string; calls: CallLog[] }>();
                for (const log of callHistory) {
                    const key = log.phone_number_record || 'unknown';
                    const display = log.expand?.phone_number_record?.phone_number || 'Unknown';
                    if (!byPhone.has(key)) byPhone.set(key, { phone: display, calls: [] });
                    byPhone.get(key)!.calls.push(log);
                }
                const groups = [...byPhone.entries()].sort((a, b) => b[1].calls.length - a[1].calls.length);

                return (
                    <div className="border border-[var(--card-border)] rounded-lg overflow-hidden text-xs">
                        <div className="px-3 py-1.5 bg-[var(--sidebar-bg)] border-b border-[var(--card-border)] flex items-center justify-between">
                            <span className="font-semibold uppercase tracking-wider text-[var(--muted)] text-[10px]">
                                Prior Calls
                            </span>
                            {callHistoryLoading ? (
                                <span className="text-[10px] text-[var(--muted)]">Loading…</span>
                            ) : (
                                <span className="text-[10px] text-[var(--muted)]">{callHistory.length} total</span>
                            )}
                        </div>
                        {!callHistoryLoading && (
                            <div className="divide-y divide-[var(--card-border)] max-h-48 overflow-y-auto">
                                {groups.map(([key, { phone, calls }]) => {
                                    const notedCalls = calls.filter(c => c.post_call_notes);
                                    return (
                                        <div key={key} className="px-3 py-2">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <span className="font-mono font-medium text-[var(--foreground)]">{phone}</span>
                                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--card-hover)] text-[var(--muted)] font-semibold whitespace-nowrap">
                                                    {calls.length} call{calls.length !== 1 ? 's' : ''}
                                                </span>
                                                {calls[0]?.call_outcome && (
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--card-hover)] text-[var(--muted)] truncate max-w-[80px]">
                                                        {calls[0].call_outcome}
                                                    </span>
                                                )}
                                            </div>
                                            {notedCalls.length > 0 && (
                                                <div className="space-y-0.5 ml-1.5 border-l border-[var(--card-border)] pl-2">
                                                    {notedCalls.slice(0, 3).map(call => (
                                                        <div key={call.id} className="flex gap-1.5 text-[10px]">
                                                            <span className="text-[var(--muted)] whitespace-nowrap shrink-0">
                                                                {new Date(call.call_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                            </span>
                                                            <span className="text-[var(--foreground)]/70 line-clamp-1" title={call.post_call_notes}>
                                                                {call.post_call_notes}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
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
                <div className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-300",
                    isCallLive
                        ? "bg-[var(--success-subtle)] border border-[var(--success)] animate-[pulse-green-border_2s_ease-in-out_infinite]"
                        : "bg-[var(--sidebar-bg)] border border-[var(--card-border)]"
                )}>
                    <PhoneIcon size={14} className={isCallLive ? "text-[var(--success)]" : "text-[var(--muted)]"} />
                    <span className={cn("font-mono", isCallLive && "text-[var(--success)] font-medium")}>{phoneNumber || '—'}</span>
                </div>
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
                                : "bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]"
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
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] border border-[var(--success)]/30 font-semibold uppercase tracking-wider">
                            Reached
                        </span>
                    )}
                </label>
                <div className="relative">
                    <Crown size={14} className={cn("absolute left-3 top-1/2 -translate-y-1/2", ownerReached ? "text-[var(--success)]" : "text-[var(--muted)]")} />
                    <input
                        type="text"
                        value={ownerName}
                        onChange={e => {
                            const val = e.target.value;
                            setOwnerName(val);
                            if (val.trim() && !ownerReached) {
                                setOwnerReached(true);
                                setNoneSelected(false);
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
                <label className="text-xs text-[var(--muted)] mb-1.5 block">Call Outcome <span className="text-[var(--error)]">*</span></label>
                <div className="flex flex-wrap gap-1.5">
                    {OUTCOMES.map(outcome => {
                        const colors = OUTCOME_COLORS[outcome];
                        const isSelected = callOutcome === outcome;
                        return (
                            <button
                                key={outcome}
                                onClick={() => setCallOutcome(isSelected ? '' : outcome)}
                                className={cn(
                                    'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                                    isSelected
                                        ? `${colors.bg} ${colors.text} ${colors.border}`
                                        : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                                )}
                            >
                                {outcome}
                            </button>
                        );
                    })}

                    {/* Hung Up split button */}
                    <div className="relative flex" ref={hungUpDropdownRef}>
                        <button
                            onClick={() => setCallOutcome(callOutcome === HUNG_UP_PRIMARY ? '' : HUNG_UP_PRIMARY)}
                            className={cn(
                                'px-2.5 py-1.5 rounded-l-lg text-xs font-medium border-y border-l transition-all',
                                callOutcome === HUNG_UP_PRIMARY
                                    ? `${OUTCOME_COLORS[HUNG_UP_PRIMARY].bg} ${OUTCOME_COLORS[HUNG_UP_PRIMARY].text} ${OUTCOME_COLORS[HUNG_UP_PRIMARY].border}`
                                    : isHungUpOutcome && callOutcome === HUNG_UP_OTHER
                                    ? `${OUTCOME_COLORS[HUNG_UP_OTHER].bg} ${OUTCOME_COLORS[HUNG_UP_OTHER].text} ${OUTCOME_COLORS[HUNG_UP_OTHER].border}`
                                    : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                            )}
                        >
                            {isHungUpOutcome ? callOutcome : HUNG_UP_PRIMARY}
                        </button>
                        <button
                            onClick={() => setShowHungUpDropdown(v => !v)}
                            className={cn(
                                'px-1.5 py-1.5 rounded-r-lg text-xs font-medium border transition-all border-l-0',
                                isHungUpOutcome
                                    ? `${OUTCOME_COLORS[callOutcome as typeof HUNG_UP_PRIMARY].bg} ${OUTCOME_COLORS[callOutcome as typeof HUNG_UP_PRIMARY].text} ${OUTCOME_COLORS[callOutcome as typeof HUNG_UP_PRIMARY].border}`
                                    : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                            )}
                        >
                            <ChevronDown size={10} className={cn("transition-transform", showHungUpDropdown && "rotate-180")} />
                        </button>
                        {showHungUpDropdown && (
                            <div className="absolute left-0 top-full mt-1 z-30 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-lg min-w-[160px] overflow-hidden">
                                {[HUNG_UP_PRIMARY, HUNG_UP_OTHER].map(opt => (
                                    <button
                                        key={opt}
                                        type="button"
                                        onClick={() => { setCallOutcome(opt); setShowHungUpDropdown(false); }}
                                        className={cn(
                                            "w-full text-left px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors",
                                            callOutcome === opt ? "font-semibold text-red-500" : "text-[var(--foreground)]"
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
                    disabled={!hasDraftValues && !hasUnsavedCall}
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
                    {saving ? 'Saving...' : isCallLive ? 'Call in Progress...' : hasUnsavedCall ? 'Submit Call Log' : 'Save Call & Next'}
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
        </div>
    );
}
