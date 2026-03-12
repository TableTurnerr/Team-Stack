'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, MapPin, User, Calendar, Edit2, Trash2, History, Plus, Loader2 } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { PhoneNumber, CallLog } from '@/lib/types';
import { COLLECTIONS } from '@/lib/types';
import { pb } from '@/lib/pocketbase';
import { ZoomCallButton } from '@/components/zoom-call-button';
import { useZoomPhoneOptional } from '@/contexts/zoom-phone-context';
import { useCallRecording } from '@/contexts/call-recording-context';
import { useSession } from '@/contexts/session-context';
import { useRecycleBinOptional } from '@/contexts/recycle-bin-context';
import { useAuth } from '@/contexts/auth-context';

interface PhoneNumberCardProps {
  phoneNumber: PhoneNumber;
  recentCalls: CallLog[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onLogCall: (phoneNumberId: string) => void;
  className?: string;
}

const LABEL_COLORS: Record<string, string> = {
  'Owner Direct': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Main Line': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Manager': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Branch': 'bg-green-500/10 text-green-400 border-green-500/20',
};

export function PhoneNumberCard({
  phoneNumber,
  recentCalls,
  onEdit,
  onDelete,
  onLogCall,
  className
}: PhoneNumberCardProps) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const zoomPhone = useZoomPhoneOptional();
  const { isSessionActive } = useCallRecording();
  const { session, setStandaloneMode } = useSession();
  const recycleBin = useRecycleBinOptional();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const isDisassociated = !!phoneNumber.disassociated;

  const handleAdminDelete = async () => {
    if (!recycleBin || isDeleting) return;
    setIsDeleting(true);
    try {
      // Fetch related call logs so they can be saved in recycle bin and deleted first
      const callLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList({
        filter: `phone_number_record = "${phoneNumber.id}"`,
      });

      await recycleBin.moveToTrash({
        itemType: 'phone_number',
        originalId: phoneNumber.id,
        itemLabel: phoneNumber.phone_number,
        itemData: phoneNumber as unknown as Record<string, unknown>,
        relatedData: callLogs.length > 0 ? { [COLLECTIONS.CALL_LOGS]: callLogs } : undefined,
      });
    } catch (err) {
      console.error('Failed to delete phone number:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={cn(
      "border rounded-xl overflow-hidden group transition-all duration-200",
      isDisassociated
        ? "bg-[var(--sidebar-bg)] border-[var(--card-border)] opacity-60"
        : "bg-[var(--card-bg)] border-[var(--card-border)] hover:border-[var(--sidebar-border)]",
      className
    )}>

      {/* Disassociated banner */}
      {isDisassociated && (
        <div className="px-4 py-1.5 bg-[var(--card-hover)] border-b border-[var(--card-border)] flex items-center gap-2">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">Disassociated</span>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                "text-lg font-mono font-bold tracking-tight",
                isDisassociated && "line-through text-[var(--muted)]"
              )}>
                {phoneNumber.phone_number}
              </span>
              {!isDisassociated && <ZoomCallButton phoneNumber={phoneNumber.phone_number} />}
              {phoneNumber.label && (
                <span className={cn(
                  "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border",
                  isDisassociated
                    ? "bg-[var(--card-hover)] text-[var(--muted)] border-[var(--card-border)]"
                    : LABEL_COLORS[phoneNumber.label] || "bg-[var(--card-hover)] text-[var(--muted)] border-[var(--card-border)]"
                )}>
                  {phoneNumber.label}
                </span>
              )}
            </div>
            {phoneNumber.location_name && (
              <p className={cn(
                "text-sm font-medium",
                isDisassociated ? "line-through text-[var(--muted)]" : "text-[var(--foreground)]"
              )}>
                {phoneNumber.location_name}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Edit button — hidden when disassociated */}
            {!isDisassociated && (
              <button
                onClick={() => onEdit(phoneNumber.id)}
                className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
            )}

            {/* Delete button: admin → permanent delete to recycle bin; normal → soft delete (disassociate) */}
            {isAdmin ? (
              <button
                onClick={handleAdminDelete}
                disabled={isDeleting}
                className="p-1.5 rounded-lg text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-all duration-150 disabled:opacity-50"
                title="Delete to recycle bin"
              >
                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            ) : !isDisassociated && (
              <button
                onClick={() => onDelete(phoneNumber.id)}
                className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--error-subtle)] hover:text-[var(--error)] transition-colors"
                title="Disassociate"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {phoneNumber.location_address && (
            <div className={cn(
              "flex items-start gap-2",
              isDisassociated ? "text-[var(--muted)] line-through" : "text-[var(--muted)]"
            )}>
              <MapPin size={14} className="mt-0.5 flex-shrink-0" />
              <span className="line-clamp-2">{phoneNumber.location_address}</span>
            </div>
          )}
          {phoneNumber.receptionist_name && (
            <div className="flex items-center gap-2 text-[var(--muted)]">
              <User size={14} className="flex-shrink-0" />
              <span>Receptionist: <span className={cn(!isDisassociated && "text-[var(--foreground)]")}>{phoneNumber.receptionist_name}</span></span>
            </div>
          )}
          <div className="flex items-center gap-2 text-[var(--muted)]">
            <Calendar size={14} className="flex-shrink-0" />
            <span>Last Called: <span className={cn(!isDisassociated && "text-[var(--foreground)]")}>
              {phoneNumber.last_called ? formatDate(phoneNumber.last_called) : 'Never'}
            </span></span>
          </div>
        </div>

        {/* Action Bar — hidden when disassociated */}
        {!isDisassociated && (
          <div className="flex items-center gap-2 pt-2 border-t border-[var(--card-border)]">
            <button
              onClick={() => onLogCall(phoneNumber.id)}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-all text-xs font-semibold"
            >
              <Plus size={14} />
              Log Call
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isSessionActive) {
                  const shouldNavigate = window.confirm(
                    'Screen sharing is required to make and record calls.\n\n' +
                    'Click OK to go to the Call Session page and start screen sharing.'
                  );
                  if (shouldNavigate) router.push('/session');
                  return;
                }
                if (!session) setStandaloneMode(true);
                if (zoomPhone) {
                  const cleaned = phoneNumber.phone_number.replace(/\D/g, '');
                  zoomPhone.dialNumber(cleaned);
                }
                router.push('/session');
              }}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all text-xs font-semibold"
            >
              <Phone size={14} />
              Call via Zoom
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "p-2 rounded-lg border border-[var(--card-border)] transition-colors",
                showHistory ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted)] hover:bg-[var(--card-hover)]"
              )}
              title="View History"
            >
              <History size={16} />
            </button>
          </div>
        )}

        {/* Disassociated footer */}
        {isDisassociated && (
          <div className="pt-2 border-t border-[var(--card-border)]">
            <p className="text-[10px] text-[var(--muted)] text-center">
              This number is disassociated. Call history is preserved.
            </p>
          </div>
        )}
      </div>

      {/* Expandable History */}
      {showHistory && (
        <div className="border-t border-[var(--card-border)] bg-[var(--sidebar-bg)] p-4 max-h-[300px] overflow-y-auto">
          <h4 className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-3">
            Call History ({recentCalls.length})
          </h4>
          {recentCalls.length === 0 ? (
            <p className="text-xs text-[var(--muted)] text-center py-4">No calls recorded for this number.</p>
          ) : (
            <div className="space-y-4">
              {recentCalls.map((call) => (
                <div key={call.id} className="relative pl-4 border-l border-[var(--card-border)] pb-2 last:pb-0">
                  <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-[var(--card-border)]" />
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-medium">{formatDate(call.call_time)}</span>
                    <div className="flex gap-1 flex-wrap">
                      {(Array.isArray(call.call_outcome) ? call.call_outcome : call.call_outcome ? [call.call_outcome] : []).map(oc => (
                        <span key={oc} className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                          oc === 'Interested' ? "bg-green-500/10 text-green-400" :
                            oc === 'No Answer' ? "bg-red-500/10 text-red-400" :
                              "bg-[var(--card-hover)] text-[var(--muted)]"
                        )}>
                          {oc}
                        </span>
                      ))}
                    </div>
                  </div>
                  {call.post_call_notes && (
                    <p className="text-xs text-[var(--muted)] line-clamp-2">{call.post_call_notes}</p>
                  )}
                  {call.has_recording && (
                    <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--primary)] font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
                      Recording Available
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
