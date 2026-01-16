'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft,
    Phone,
    Building2,
    User,
    Calendar,
    Clock,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    Target,
    CheckSquare,
    MessageSquare,
    Edit,
    Bell,
    UserCheck,
    ExternalLink,
    Copy,
    Check
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type ColdCall, type CallTranscript } from '@/lib/types';
import { formatDate, formatDateTime, cn } from '@/lib/utils';

// Outcome badge colors
const OUTCOME_COLORS: Record<string, { bg: string; text: string; icon?: string }> = {
    'Interested': { bg: 'bg-green-500/20', text: 'text-green-400' },
    'Not Interested': { bg: 'bg-red-500/20', text: 'text-red-400' },
    'Callback': { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
    'No Answer': { bg: 'bg-gray-500/20', text: 'text-gray-400' },
    'Wrong Number': { bg: 'bg-orange-500/20', text: 'text-orange-400' },
    'Other': { bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

// Page params type
type PageParams = Promise<{ id: string }>;

export default function ColdCallDetailPage({ params }: { params: PageParams }) {
    const router = useRouter();
    const resolvedParams = useParams();
    const callId = resolvedParams?.id as string;

    const [call, setCall] = useState<ColdCall | null>(null);
    const [transcript, setTranscript] = useState<CallTranscript | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showTranscript, setShowTranscript] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const fetchCallDetails = async () => {
            if (!callId) return;

            try {
                setLoading(true);

                // Fetch cold call with expanded relations
                const callData = await pb.collection(COLLECTIONS.COLD_CALLS).getOne<ColdCall>(callId, {
                    expand: 'company,claimed_by',
                });
                setCall(callData);

                // Fetch transcript
                try {
                    const transcripts = await pb.collection(COLLECTIONS.CALL_TRANSCRIPTS).getList<CallTranscript>(1, 1, {
                        filter: `call = "${callId}"`,
                    });
                    if (transcripts.items.length > 0) {
                        setTranscript(transcripts.items[0]);
                    }
                } catch (e) {
                    // Transcript might not exist, that's okay
                    console.log('No transcript found for this call');
                }

            } catch (err) {
                console.error('Failed to fetch call details:', err);
                setError('Failed to load call details');
            } finally {
                setLoading(false);
            }
        };

        fetchCallDetails();
    }, [callId]);

    const copyPhoneNumber = () => {
        if (call?.phone_number) {
            navigator.clipboard.writeText(call.phone_number);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]"></div>
            </div>
        );
    }

    if (error || !call) {
        return (
            <div className="space-y-6">
                <Link
                    href="/cold-calls"
                    className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                    <ArrowLeft size={16} />
                    Back to Cold Calls
                </Link>

                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-8 text-center">
                    <AlertTriangle size={48} className="mx-auto mb-4 text-red-400" />
                    <h2 className="text-lg font-medium">Call Not Found</h2>
                    <p className="text-[var(--muted)] mt-2">{error || 'This cold call record could not be found.'}</p>
                </div>
            </div>
        );
    }

    const company = call.expand?.company;
    const claimedBy = call.expand?.claimed_by;
    const interestLevel = call.interest_level || 0;

    return (
        <div className="space-y-6">
            {/* Back Link */}
            <Link
                href="/cold-calls"
                className="inline-flex items-center gap-2 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
                <ArrowLeft size={16} />
                Back to Cold Calls
            </Link>

            {/* Header */}
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-[var(--primary)]/10 rounded-lg">
                            <Phone size={24} className="text-[var(--primary)]" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">
                                {company?.company_name || 'Unknown Company'}
                            </h1>
                            <div className="flex flex-wrap items-center gap-4 mt-2 text-[var(--muted)]">
                                {call.phone_number && (
                                    <button
                                        onClick={copyPhoneNumber}
                                        className="flex items-center gap-1 hover:text-[var(--foreground)] transition-colors font-mono"
                                    >
                                        <Phone size={14} />
                                        {call.phone_number}
                                        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                    </button>
                                )}
                                <span className="flex items-center gap-1">
                                    <Calendar size={14} />
                                    {formatDateTime(call.created)}
                                </span>
                                {call.call_duration_estimate && (
                                    <span className="flex items-center gap-1">
                                        <Clock size={14} />
                                        {call.call_duration_estimate}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {call.call_outcome && (
                            <span className={cn(
                                "px-3 py-1.5 rounded-lg text-sm font-medium",
                                OUTCOME_COLORS[call.call_outcome]?.bg || 'bg-gray-500/20',
                                OUTCOME_COLORS[call.call_outcome]?.text || 'text-gray-400'
                            )}>
                                {call.call_outcome}
                            </span>
                        )}
                        <div className={cn(
                            "px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2",
                            interestLevel >= 7 ? "bg-green-500/20 text-green-400" :
                                interestLevel >= 4 ? "bg-yellow-500/20 text-yellow-400" :
                                    "bg-red-500/20 text-red-400"
                        )}>
                            <Target size={14} />
                            Interest: {interestLevel}/10
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column - AI Analysis */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Summary */}
                    {call.call_summary && (
                        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                                <MessageSquare size={18} />
                                Call Summary
                            </h2>
                            <p className="text-[var(--muted)] leading-relaxed">{call.call_summary}</p>
                        </div>
                    )}

                    {/* AI Analysis Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Objections */}
                        {call.objections && call.objections.length > 0 && (
                            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                                <h3 className="font-semibold mb-3 flex items-center gap-2 text-red-400">
                                    <AlertTriangle size={16} />
                                    Objections ({call.objections.length})
                                </h3>
                                <ul className="space-y-2">
                                    {call.objections.map((obj, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                                            <span className="text-red-400 mt-1">•</span>
                                            {obj}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Pain Points */}
                        {call.pain_points && call.pain_points.length > 0 && (
                            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                                <h3 className="font-semibold mb-3 flex items-center gap-2 text-yellow-400">
                                    <Target size={16} />
                                    Pain Points ({call.pain_points.length})
                                </h3>
                                <ul className="space-y-2">
                                    {call.pain_points.map((pain, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                                            <span className="text-yellow-400 mt-1">•</span>
                                            {pain}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Follow-up Actions */}
                    {call.follow_up_actions && call.follow_up_actions.length > 0 && (
                        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                            <h3 className="font-semibold mb-3 flex items-center gap-2 text-green-400">
                                <CheckSquare size={16} />
                                Follow-up Actions
                            </h3>
                            <ul className="space-y-2">
                                {call.follow_up_actions.map((action, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                                        <CheckSquare size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                                        {action}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Full Transcript */}
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
                        <button
                            onClick={() => setShowTranscript(!showTranscript)}
                            className="w-full p-6 flex items-center justify-between hover:bg-[var(--sidebar-bg)] transition-colors"
                        >
                            <h3 className="font-semibold flex items-center gap-2">
                                <MessageSquare size={16} />
                                Full Transcript
                                {transcript && (
                                    <span className="text-[var(--muted)] text-sm font-normal">
                                        ({transcript.transcript.length} characters)
                                    </span>
                                )}
                            </h3>
                            {showTranscript ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>

                        {showTranscript && (
                            <div className="px-6 pb-6 border-t border-[var(--card-border)]">
                                {transcript ? (
                                    <pre className="mt-4 text-sm text-[var(--muted)] whitespace-pre-wrap font-sans leading-relaxed max-h-[500px] overflow-y-auto">
                                        {transcript.transcript}
                                    </pre>
                                ) : (
                                    <p className="mt-4 text-[var(--muted)] text-sm">No transcript available for this call.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column - Info Cards & Actions */}
                <div className="space-y-6">
                    {/* Company Info Card */}
                    {company && (
                        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                            <h3 className="font-semibold mb-4 flex items-center gap-2">
                                <Building2 size={16} />
                                Company Info
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <span className="text-sm text-[var(--muted)]">Name</span>
                                    <p className="font-medium">{company.company_name}</p>
                                </div>
                                {call.owner_name && (
                                    <div>
                                        <span className="text-sm text-[var(--muted)]">Owner/Contact</span>
                                        <p className="font-medium">{call.owner_name}</p>
                                    </div>
                                )}
                                {company.company_location && (
                                    <div>
                                        <span className="text-sm text-[var(--muted)]">Location</span>
                                        <p className="font-medium">{company.company_location}</p>
                                    </div>
                                )}
                                {company.google_maps_link && (
                                    <a
                                        href={company.google_maps_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
                                    >
                                        <ExternalLink size={14} />
                                        View on Google Maps
                                    </a>
                                )}
                                <Link
                                    href={`/companies`}
                                    className="inline-flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
                                >
                                    <Building2 size={14} />
                                    View Company
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* Call Meta */}
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <Phone size={16} />
                            Call Details
                        </h3>
                        <div className="space-y-3">
                            {call.recipients && (
                                <div>
                                    <span className="text-sm text-[var(--muted)]">Recipient</span>
                                    <p className="font-medium">{call.recipients}</p>
                                </div>
                            )}
                            {claimedBy && (
                                <div>
                                    <span className="text-sm text-[var(--muted)]">Claimed By</span>
                                    <p className="font-medium flex items-center gap-1">
                                        <User size={14} />
                                        {claimedBy.name}
                                    </p>
                                </div>
                            )}
                            {call.model_used && (
                                <div>
                                    <span className="text-sm text-[var(--muted)]">AI Model</span>
                                    <p className="font-medium font-mono text-sm">{call.model_used}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
                        <h3 className="font-semibold mb-4">Actions</h3>
                        <div className="space-y-2">
                            <button className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors">
                                <Edit size={16} />
                                Edit Details
                            </button>
                            <button className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors">
                                <Bell size={16} />
                                Set Alert
                            </button>
                            {!claimedBy && (
                                <button className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors">
                                    <UserCheck size={16} />
                                    Claim This Call
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
