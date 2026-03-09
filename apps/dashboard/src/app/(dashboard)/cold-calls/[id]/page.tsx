'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Phone,
  Building2,
  User,
  Clock,
  Target,
  UserCheck,
  CalendarCheck,
  StickyNote,
  Zap,
  Loader2,
  PhoneForwarded,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type CallLog, type ColdCall, type Company, type ColdCallingSession, type PhoneNumber, type User as UserType } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { getOutcomeColors } from '@/lib/call-outcomes';

function formatDuration(seconds?: number): string {
  if (!seconds || seconds === 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--card-border)] last:border-0">
      {Icon && <Icon size={16} className="text-[var(--muted)] mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-0.5">{label}</p>
        <div className="text-sm font-medium">{value || <span className="text-[var(--muted)]">-</span>}</div>
      </div>
    </div>
  );
}

export default function ColdCallDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const isCallLog = searchParams.get('type') === 'log';

  const { isAuthenticated } = useAuth();
  const [callLog, setCallLog] = useState<CallLog | null>(null);
  const [coldCall, setColdCall] = useState<ColdCall | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !id) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        if (isCallLog) {
          const log = await pb.collection(COLLECTIONS.CALL_LOGS).getOne<CallLog>(id, {
            expand: 'company,phone_number_record,caller,session,cold_call',
          });
          setCallLog(log);
        } else {
          // Try call_log first, fallback to cold_call
          try {
            const log = await pb.collection(COLLECTIONS.CALL_LOGS).getOne<CallLog>(id, {
              expand: 'company,phone_number_record,caller,session,cold_call',
            });
            setCallLog(log);
          } catch {
            const call = await pb.collection(COLLECTIONS.COLD_CALLS).getOne<ColdCall>(id, {
              expand: 'company,claimed_by',
            });
            setColdCall(call);
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch call details:', err);
        setError('Failed to load call details');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, isCallLog, isAuthenticated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/cold-calls" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
          <ArrowLeft size={16} /> Back to Cold Calls
        </Link>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">{error}</div>
      </div>
    );
  }

  if (callLog) {
    return <CallLogDetail log={callLog} />;
  }

  if (coldCall) {
    return <ColdCallDetail call={coldCall} />;
  }

  return null;
}

// ─── Call Log Detail View ────────────────────────────────────────────────────

function CallLogDetail({ log }: { log: CallLog }) {
  const company = log.expand?.company;
  const phoneRecord = log.expand?.phone_number_record;
  const caller = log.expand?.caller;
  const session = log.expand?.session;
  const coldCall = log.expand?.cold_call as ColdCall | undefined;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <Link href="/cold-calls" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
        <ArrowLeft size={16} /> Back to Cold Calls
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Call Log Details</h1>
            <p className="text-[var(--muted)] text-sm mt-1">
              {log.call_time ? formatDate(log.call_time) : 'Unknown date'}
            </p>
          </div>
          {coldCall && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--info-subtle)] text-[var(--info)] text-xs font-semibold">
              <Zap size={12} />
              AI Analyzed
            </span>
          )}
          {(log.callback_events?.length ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] text-xs font-semibold border border-[var(--warning)]/30">
              <PhoneForwarded size={12} />
              Callback ({log.callback_events!.length})
            </span>
          )}
        </div>
        {log.call_outcome && (Array.isArray(log.call_outcome) ? log.call_outcome : [log.call_outcome]).length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {(Array.isArray(log.call_outcome) ? log.call_outcome : [log.call_outcome]).map(oc => {
              const colors = getOutcomeColors(oc);
              return (
                <span key={oc} className={cn("px-3 py-1.5 rounded-lg text-sm font-semibold", colors.bg, colors.text)}>
                  {oc}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Main info card */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Call Information</h2>

        <InfoRow
          label="Company"
          icon={Building2}
          value={company ? (
            <Link href={`/companies/${company.id}`} className="text-[var(--primary)] hover:underline">
              {company.company_name}
            </Link>
          ) : 'Unknown'}
        />
        <InfoRow
          label="Phone Number"
          icon={Phone}
          value={phoneRecord?.phone_number || '-'}
        />
        <InfoRow
          label="Recipient"
          icon={User}
          value={
            <div className="flex items-center gap-2">
              <span>{log.owner_name_found || '-'}</span>
              {log.owner_reached && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-subtle)] text-[var(--success)] font-semibold uppercase">Owner</span>
              )}
            </div>
          }
        />
        <InfoRow
          label="Caller"
          icon={User}
          value={caller?.name || '-'}
        />
      </div>

      {/* Timing card */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Call Timing</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
            <p className="text-xs text-[var(--muted)] mb-1">Ring Duration</p>
            <p className="text-lg font-semibold">{formatDuration(log.ring_duration)}</p>
          </div>
          <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
            <p className="text-xs text-[var(--muted)] mb-1">Call Duration</p>
            <p className="text-lg font-semibold">{formatDuration(log.call_duration)}</p>
          </div>
          <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
            <p className="text-xs text-[var(--muted)] mb-1">Total</p>
            <p className="text-lg font-semibold">{formatDuration(log.duration)}</p>
          </div>
        </div>
      </div>

      {/* Performance card */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Performance</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className={cn(
            "flex items-center gap-2 p-3 rounded-lg border",
            log.owner_reached
              ? "bg-[var(--success-subtle)] border-[var(--success)]/30"
              : "bg-[var(--sidebar-bg)] border-[var(--card-border)]"
          )}>
            <UserCheck size={16} className={log.owner_reached ? "text-[var(--success)]" : "text-[var(--muted)]"} />
            <span className="text-sm font-medium">Owner Reached</span>
          </div>
          <div className={cn(
            "flex items-center gap-2 p-3 rounded-lg border",
            log.pitch_completed
              ? "bg-[var(--info-subtle)] border-[var(--info)]/30"
              : "bg-[var(--sidebar-bg)] border-[var(--card-border)]"
          )}>
            <Target size={16} className={log.pitch_completed ? "text-[var(--info)]" : "text-[var(--muted)]"} />
            <span className="text-sm font-medium">Pitch Completed</span>
          </div>
          <div className={cn(
            "flex items-center gap-2 p-3 rounded-lg border",
            log.appointment_set
              ? "bg-[var(--warning-subtle)] border-[var(--warning)]/30"
              : "bg-[var(--sidebar-bg)] border-[var(--card-border)]"
          )}>
            <CalendarCheck size={16} className={log.appointment_set ? "text-[var(--warning)]" : "text-[var(--muted)]"} />
            <span className="text-sm font-medium">Appointment Set</span>
          </div>
        </div>
      </div>

      {/* Notes card */}
      {log.post_call_notes && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
            <StickyNote size={14} />
            Post-call Notes
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{log.post_call_notes}</p>
        </div>
      )}

      {/* Callback Events card */}
      {(log.callback_events?.length ?? 0) > 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--warning)]/30 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--warning)] uppercase tracking-wider mb-4 flex items-center gap-2">
            <PhoneForwarded size={14} />
            Callback Events ({log.callback_events!.length})
          </h2>
          <div className="space-y-2">
            {log.callback_events!.map((evt, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[var(--warning-subtle)] rounded-lg border border-[var(--warning)]/20">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[var(--warning)]/20 flex items-center justify-center text-[10px] font-bold text-[var(--warning)]">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{evt.reason}</span>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session info card */}
      {session && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Session Info</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
              <p className="text-xs text-[var(--muted)] mb-1">Started</p>
              <p className="text-sm font-semibold">{session.started_at ? formatDate(session.started_at) : '-'}</p>
            </div>
            <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
              <p className="text-xs text-[var(--muted)] mb-1">Total Dials</p>
              <p className="text-lg font-semibold">{session.total_dials || 0}</p>
            </div>
            <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
              <p className="text-xs text-[var(--muted)] mb-1">Total Pickups</p>
              <p className="text-lg font-semibold">{session.total_pickups || 0}</p>
            </div>
            <div className="text-center p-3 bg-[var(--sidebar-bg)] rounded-lg">
              <p className="text-xs text-[var(--muted)] mb-1">Session Duration</p>
              <p className="text-sm font-semibold">{formatDuration(session.total_duration_sec)}</p>
            </div>
          </div>
          {session.session_notes && (
            <div className="mt-4 p-3 bg-[var(--sidebar-bg)] rounded-lg">
              <p className="text-xs text-[var(--muted)] mb-1">Session Notes</p>
              <p className="text-sm">{session.session_notes}</p>
            </div>
          )}
        </div>
      )}

      {/* AI Transcript Insights (if linked cold_call exists) */}
      {coldCall && (
        <>
          <div className="border-t border-[var(--card-border)] pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={18} className="text-[var(--info)]" />
              <h2 className="text-lg font-bold">AI Transcript Insights</h2>
              {coldCall.model_used && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--sidebar-bg)] text-[var(--muted)]">
                  {coldCall.model_used}
                </span>
              )}
            </div>
          </div>

          {coldCall.call_summary && (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">AI Call Summary</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{coldCall.call_summary}</p>
            </div>
          )}

          {coldCall.objections && coldCall.objections.length > 0 && (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Objections</h2>
              <ul className="space-y-2">
                {coldCall.objections.map((obj: string, i: number) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-[var(--error)] mt-0.5">&#x2022;</span>
                    {obj}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {coldCall.pain_points && coldCall.pain_points.length > 0 && (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Pain Points</h2>
              <ul className="space-y-2">
                {coldCall.pain_points.map((point: string, i: number) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-[var(--warning)] mt-0.5">&#x2022;</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {coldCall.follow_up_actions && coldCall.follow_up_actions.length > 0 && (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">AI Suggested Follow-ups</h2>
              <ul className="space-y-2">
                {coldCall.follow_up_actions.map((action: string, i: number) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-[var(--success)] mt-0.5">&#x2022;</span>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Cold Call (AI Transcript) Detail View ───────────────────────────────────

function ColdCallDetail({ call }: { call: ColdCall }) {
  const company = call.expand?.company;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/cold-calls" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
        <ArrowLeft size={16} /> Back to Cold Calls
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Transcript Details</h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            {call.created ? formatDate(call.created) : 'Unknown date'}
          </p>
        </div>
        {call.call_outcome && (() => {
          const colors = getOutcomeColors(call.call_outcome);
          return (
            <span className={cn("px-3 py-1.5 rounded-lg text-sm font-semibold", colors.bg, colors.text)}>
              {call.call_outcome}
            </span>
          );
        })()}
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Call Information</h2>
        <InfoRow label="Company" icon={Building2} value={company?.company_name || 'Unknown'} />
        <InfoRow label="Phone Number" icon={Phone} value={call.phone_number || '-'} />
        <InfoRow label="Recipient" icon={User} value={call.recipients || '-'} />
        <InfoRow label="Owner Name" icon={User} value={call.owner_name || '-'} />
        <InfoRow label="Caller" icon={User} value={call.caller_name || '-'} />
        <InfoRow label="Duration Estimate" icon={Clock} value={call.call_duration_estimate || '-'} />
        <InfoRow label="Model Used" icon={Zap} value={call.model_used || '-'} />
      </div>

      {call.call_summary && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Call Summary</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{call.call_summary}</p>
        </div>
      )}

      {call.objections && call.objections.length > 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Objections</h2>
          <ul className="space-y-2">
            {call.objections.map((obj, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-[var(--error)] mt-0.5">&#x2022;</span>
                {obj}
              </li>
            ))}
          </ul>
        </div>
      )}

      {call.pain_points && call.pain_points.length > 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Pain Points</h2>
          <ul className="space-y-2">
            {call.pain_points.map((point, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-[var(--warning)] mt-0.5">&#x2022;</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {call.follow_up_actions && call.follow_up_actions.length > 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">Follow-up Actions</h2>
          <ul className="space-y-2">
            {call.follow_up_actions.map((action, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-[var(--success)] mt-0.5">&#x2022;</span>
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
