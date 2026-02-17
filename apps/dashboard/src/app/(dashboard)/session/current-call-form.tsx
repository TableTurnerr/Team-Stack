'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Building2, User, Phone as PhoneIcon, StickyNote, AlertCircle } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company } from '@/lib/types';
import { cn } from '@/lib/utils';

const OUTCOMES = [
    'Interested',
    'Not Interested',
    'Callback',
    'No Answer',
    'Wrong Number',
    'Other',
] as const;

const OUTCOME_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    'Interested': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]', border: 'border-[var(--success)]' },
    'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]', border: 'border-[var(--error)]' },
    'Callback': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]', border: 'border-[var(--warning)]' },
    'No Answer': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]', border: 'border-[var(--muted)]' },
    'Wrong Number': { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]', border: 'border-[var(--warning)]' },
    'Other': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]', border: 'border-[var(--info)]' },
};

export interface CallFormData {
    companyId: string;
    companyName: string;
    phoneNumber: string;
    recipientName: string;
    callOutcome: string;
    interestLevel: number;
    postCallNotes: string;
    wasPickedUp: boolean;
    ownerReached: boolean;
    pitchCompleted: boolean;
    appointmentSet: boolean;
}

interface CurrentCallFormProps {
    phoneNumber: string;
    onSave: (data: CallFormData) => void;
    saving?: boolean;
    /** Whether a recorded call is waiting to be submitted */
    hasUnsavedCall?: boolean;
}

export function CurrentCallForm({ phoneNumber, onSave, saving, hasUnsavedCall }: CurrentCallFormProps) {
    const [companySearch, setCompanySearch] = useState('');
    const [companyResults, setCompanyResults] = useState<Company[]>([]);
    const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
    const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
    const [recipientName, setRecipientName] = useState('');
    const [callOutcome, setCallOutcome] = useState('');
    const [interestLevel, setInterestLevel] = useState(5);
    const [postCallNotes, setPostCallNotes] = useState('');
    const [ownerReached, setOwnerReached] = useState(false);
    const [pitchCompleted, setPitchCompleted] = useState(false);
    const [appointmentSet, setAppointmentSet] = useState(false);
    const [noneSelected, setNoneSelected] = useState(true);
    const [isNewCompany, setIsNewCompany] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Sync "None" with other performance options
    useEffect(() => {
        if (ownerReached || pitchCompleted || appointmentSet) {
            setNoneSelected(false);
        }
    }, [ownerReached, pitchCompleted, appointmentSet]);

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

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowCompanyDropdown(false);
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
            setRecipientName(company.owner_name);
        }
    };

    // Toggle recipient tag between Receptionist and Owner
    const handleTagClick = () => {
        const newOwnerState = !ownerReached;
        setOwnerReached(newOwnerState);
        if (newOwnerState) {
            setNoneSelected(false);
        }
    };

    // Handle "None" toggle
    const handleNoneToggle = () => {
        setNoneSelected(true);
        setOwnerReached(false);
        setPitchCompleted(false);
        setAppointmentSet(false);
    };

    const handleSave = useCallback(async () => {
        if (!selectedCompany && !isNewCompany) return;
        if (!companySearch.trim()) return;

        try {
            let companyId: string;
            let companyName: string;

            if (isNewCompany) {
                const newCompany = await pb.collection(COLLECTIONS.COMPANIES).create<Company>({
                    company_name: companySearch.trim(),
                    owner_name: recipientName || undefined,
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
                recipientName,
                callOutcome,
                interestLevel,
                postCallNotes,
                wasPickedUp: callOutcome !== 'No Answer' && callOutcome !== 'Wrong Number' && callOutcome !== '',
                ownerReached,
                pitchCompleted,
                appointmentSet,
            });

            // Reset form
            setCompanySearch('');
            setSelectedCompany(null);
            setIsNewCompany(false);
            setRecipientName('');
            setCallOutcome('');
            setInterestLevel(5);
            setPostCallNotes('');
            setOwnerReached(false);
            setPitchCompleted(false);
            setAppointmentSet(false);
            setNoneSelected(true);
        } catch (err) {
            console.error('Failed to save call:', err);
        }
    }, [selectedCompany, isNewCompany, companySearch, phoneNumber, recipientName, callOutcome, interestLevel, postCallNotes, ownerReached, pitchCompleted, appointmentSet, onSave]);

    // Required fields: Company, Phone Number (auto-filled), Call Outcome, Interest Level (always has value), Post-call Notes
    const hasCompany = (selectedCompany || isNewCompany) && companySearch.trim().length >= 2;
    const hasPhoneNumber = !!phoneNumber;
    const hasOutcome = !!callOutcome;
    const hasNotes = postCallNotes.trim().length > 0;
    const canSave = hasCompany && hasPhoneNumber && hasOutcome && hasNotes && !saving;

    return (
        <div className={cn(
            "bg-[var(--card-bg)] border rounded-xl p-5 space-y-4 transition-all duration-300",
            hasUnsavedCall
                ? "border-[var(--warning)] shadow-[0_0_0_1px_var(--warning),0_0_15px_-3px_var(--warning)] animate-[pulse-border_2s_ease-in-out_infinite]"
                : "border-[var(--card-border)]"
        )}>
            {/* Header with unsaved indicator */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Current Call
                </h3>
                {hasUnsavedCall && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--warning-subtle)] border border-[var(--warning)]/30">
                        <AlertCircle size={12} className="text-[var(--warning)]" />
                        <span className="text-[10px] font-semibold text-[var(--warning)] uppercase tracking-wider">
                            Recorded but unsubmitted
                        </span>
                    </div>
                )}
            </div>

            {/* Company autocomplete */}
            <div className="relative" ref={dropdownRef}>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center justify-between">
                    <span>Company <span className="text-[var(--error)]">*</span></span>
                    {isNewCompany && companySearch.trim().length >= 2 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-semibold uppercase tracking-wider">
                            New
                        </span>
                    )}
                </label>
                <div className="relative">
                    <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                        type="text"
                        value={companySearch}
                        onChange={e => {
                            setCompanySearch(e.target.value);
                            setSelectedCompany(null);
                        }}
                        placeholder="Search or create company..."
                        className="w-full pl-8 pr-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
                    />
                    {selectedCompany && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--success)]" />
                    )}
                </div>

                {/* Dropdown */}
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
                <label className="text-xs text-[var(--muted)] mb-1 block">Phone Number <span className="text-[var(--error)]">*</span></label>
                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm">
                    <PhoneIcon size={14} className="text-[var(--muted)]" />
                    <span className="font-mono">{phoneNumber || '—'}</span>
                </div>
            </div>

            {/* Recipient with Receptionist/Owner tag */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-2">
                    <span>Recipient Name</span>
                    <button
                        type="button"
                        onClick={handleTagClick}
                        className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider border transition-all cursor-pointer",
                            ownerReached
                                ? "bg-[var(--success-subtle)] text-[var(--success)] border-[var(--success)]/30 hover:bg-[var(--success)]/20"
                                : "bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]"
                        )}
                    >
                        {ownerReached ? 'Owner' : 'Receptionist'}
                    </button>
                </label>
                <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                        type="text"
                        value={recipientName}
                        onChange={e => setRecipientName(e.target.value)}
                        placeholder="Who did you speak to? (Only write the name)"
                        className="w-full pl-8 pr-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors"
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
                </div>
            </div>

            {/* Interest Level */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center justify-between">
                    <span>Interest Level <span className="text-[var(--error)]">*</span></span>
                    <span className="font-semibold text-[var(--foreground)]">{interestLevel}/10</span>
                </label>
                <input
                    type="range"
                    min={1}
                    max={10}
                    value={interestLevel}
                    onChange={e => setInterestLevel(parseInt(e.target.value))}
                    className="w-full accent-[var(--foreground)]"
                />
            </div>

            {/* Performance Tracking with None option */}
            <div className="space-y-2">
                <label className="text-xs text-[var(--muted)] mb-1 block">Performance</label>
                <div className="flex flex-col gap-2">
                    {/* None option - default */}
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
                                if (e.target.checked) setNoneSelected(false);
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

            {/* Notes */}
            <div>
                <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
                    <StickyNote size={12} />
                    <span>Post-call Notes <span className="text-[var(--error)]">*</span></span>
                </label>
                <textarea
                    value={postCallNotes}
                    onChange={e => setPostCallNotes(e.target.value)}
                    placeholder="Quick notes about the call..."
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] transition-colors resize-none"
                />
            </div>

            {/* Save button */}
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
                {saving ? 'Saving...' : hasUnsavedCall ? 'Submit Call Log' : 'Save Call & Next'}
            </button>
        </div>
    );
}
