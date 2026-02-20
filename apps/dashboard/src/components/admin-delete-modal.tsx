'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, X, Trash2, Clock, Mic, ChevronDown, ChevronUp } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import type { CallLog, PhoneNumber } from '@/lib/types';
import { useAdminMode } from '@/contexts/admin-mode-context';

interface AdminDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'phone_number' | 'company';
  targetId: string;
  targetLabel: string;
  associatedCallLogs: CallLog[];
  /** Only for company deletions */
  associatedPhoneNumbers?: PhoneNumber[];
  onStaged?: () => void;
}

type ModalStep = 'confirm' | 'countdown' | 'staged';

export function AdminDeleteModal({
  isOpen,
  onClose,
  type,
  targetId,
  targetLabel,
  associatedCallLogs,
  associatedPhoneNumbers,
  onStaged,
}: AdminDeleteModalProps) {
  const { addStagedDeletion } = useAdminMode();
  const [deleteRecordings, setDeleteRecordings] = useState(false);
  const [step, setStep] = useState<ModalStep>('confirm');
  const [countdown, setCountdown] = useState(10);
  const [checkboxPulsing, setCheckboxPulsing] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasRecordings = associatedCallLogs.some(log => log.has_recording);
  const recordingCount = associatedCallLogs.filter(log => log.has_recording).length;
  const displayLogs = showAllLogs ? associatedCallLogs : associatedCallLogs.slice(0, 5);

  // Reset state whenever modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setStep('confirm');
      setCountdown(10);
      setDeleteRecordings(false);
      setCheckboxPulsing(false);
      setShowAllLogs(false);
    }
  }, [isOpen]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const stageTheDeletion = useCallback(() => {
    addStagedDeletion({
      type,
      targetId,
      targetLabel,
      associatedCallLogIds: associatedCallLogs.map(l => l.id),
      deleteRecordings,
      hasRecordings,
      associatedPhoneNumberIds: associatedPhoneNumbers?.map(p => p.id),
    });
    setStep('staged');
    setCheckboxPulsing(false);
    setTimeout(() => {
      onStaged?.();
      onClose();
    }, 1500);
  }, [
    addStagedDeletion, 
    type, 
    targetId, 
    targetLabel, 
    associatedCallLogs, 
    deleteRecordings, 
    hasRecordings, 
    associatedPhoneNumbers, 
    onStaged, 
    onClose
  ]);

  // Trigger stageTheDeletion when countdown hits zero
  useEffect(() => {
    if (step === 'countdown' && countdown === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      stageTheDeletion();
    }
  }, [step, countdown, stageTheDeletion]);

  const handleFirstConfirm = () => {
    setStep('countdown');
    setCheckboxPulsing(true);
    setCountdown(10);
    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
  };

  const handleCancel = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setStep('confirm');
    setCountdown(10);
    setCheckboxPulsing(false);
    setDeleteRecordings(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[var(--card-bg)] border-2 border-red-500/50 rounded-2xl shadow-2xl shadow-red-500/20 max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="p-6 border-b border-[var(--card-border)] bg-red-500/5 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-red-400">Permanent Deletion — Irreversible</h2>
                <p className="text-xs text-[var(--muted)] mt-0.5">Admin Mode · Staged deletions apply on exit</p>
              </div>
            </div>
            <button
              onClick={step === 'countdown' ? handleCancel : onClose}
              className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
              title={step === 'countdown' ? 'Cancel countdown' : 'Close'}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Target record */}
          <div>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-2">
              {type === 'phone_number' ? 'Phone Number to Delete' : 'Company to Delete'}
            </p>
            <div className="px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/20">
              <p className="font-mono font-bold text-red-400">{targetLabel}</p>
              {type === 'company' && associatedPhoneNumbers && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  {associatedPhoneNumbers.length} phone number{associatedPhoneNumbers.length !== 1 ? 's' : ''} will also be permanently deleted
                </p>
              )}
            </div>
          </div>

          {/* Phone numbers (company deletion only) */}
          {type === 'company' && associatedPhoneNumbers && associatedPhoneNumbers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-2">
                Phone Numbers ({associatedPhoneNumbers.length})
              </p>
              <div className="space-y-1">
                {associatedPhoneNumbers.map(phone => (
                  <div key={phone.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                    <span className="text-sm font-mono">{phone.phone_number}</span>
                    {phone.label && (
                      <span className="text-[10px] text-[var(--muted)] px-1.5 py-0.5 rounded bg-[var(--card-hover)]">
                        {phone.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Call logs */}
          <div>
            <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest mb-2">
              Call Logs to Delete ({associatedCallLogs.length})
            </p>
            {associatedCallLogs.length === 0 ? (
              <div className="px-3 py-2 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                <p className="text-xs text-[var(--muted)]">No call logs associated.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {displayLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                    <div className="min-w-0">
                      <span className="text-xs font-medium">{formatDate(log.call_time)}</span>
                      {log.expand?.phone_number_record?.phone_number && (
                        <span className="text-[10px] text-[var(--muted)] ml-2 font-mono">
                          {log.expand.phone_number_record.phone_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {log.has_recording && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--primary-subtle)] text-[var(--primary)] font-bold">
                          REC
                        </span>
                      )}
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                        log.call_outcome === 'Interested' ? "bg-green-500/10 text-green-400" :
                          log.call_outcome === 'No Answer' ? "bg-red-500/10 text-red-400" :
                            "bg-[var(--card-hover)] text-[var(--muted)]"
                      )}>
                        {log.call_outcome || 'No outcome'}
                      </span>
                    </div>
                  </div>
                ))}
                {associatedCallLogs.length > 5 && (
                  <button
                    onClick={() => setShowAllLogs(!showAllLogs)}
                    className="w-full text-xs text-[var(--muted)] hover:text-[var(--foreground)] flex items-center justify-center gap-1 py-1.5 transition-colors"
                  >
                    {showAllLogs
                      ? <><ChevronUp size={12} /> Show less</>
                      : <><ChevronDown size={12} /> Show {associatedCallLogs.length - 5} more</>
                    }
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Recordings opt-in checkbox — pulses after first confirm */}
          {hasRecordings && (
            <div className={cn(
              "p-4 rounded-xl border transition-all duration-300",
              checkboxPulsing
                ? "border-red-500/50 bg-red-500/5 animate-[pulse-red-border_1.5s_ease-in-out_infinite]"
                : "border-[var(--card-border)] bg-[var(--sidebar-bg)]"
            )}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteRecordings}
                  onChange={e => setDeleteRecordings(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <Mic size={14} className={deleteRecordings ? "text-red-400" : "text-[var(--muted)]"} />
                    <span className={cn("text-sm font-semibold", deleteRecordings ? "text-red-400" : "text-[var(--foreground)]")}>
                      Also Delete Call Recordings ({recordingCount})
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                    {checkboxPulsing
                      ? "⚠️ Review carefully — recordings are permanently lost once deleted."
                      : "Off by default. Call recordings are kept even when their logs are deleted."}
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--card-border)] space-y-3 flex-shrink-0">
          {step === 'confirm' && (
            <>
              <p className="text-xs text-[var(--muted)] text-center">
                This stages a permanent deletion of{' '}
                {type === 'phone_number' ? 'this phone number' : 'this company'} and{' '}
                {associatedCallLogs.length} call log{associatedCallLogs.length !== 1 ? 's' : ''}.{' '}
                After clicking confirm, you have <strong>10 seconds</strong> to cancel.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--sidebar-bg)] text-sm font-medium hover:bg-[var(--card-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFirstConfirm}
                  className="px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} />
                  Confirm Permanent Deletion
                </button>
              </div>
            </>
          )}

          {step === 'countdown' && (
            <>
              <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-red-400" />
                  <span className="text-sm font-bold text-red-400">
                    Staging in {countdown}s...
                  </span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full transition-colors",
                          i < countdown ? "bg-red-400" : "bg-red-400/20"
                        )}
                      />
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleCancel}
                  className="text-xs font-bold text-red-400 hover:text-red-300 border border-red-500/30 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {hasRecordings && (
                <p className="text-xs text-[var(--muted)] text-center">
                  Review the recording option above before time runs out.
                </p>
              )}
            </>
          )}

          {step === 'staged' && (
            <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30">
              <span className="text-sm font-bold text-green-400">
                ✓ Staged — will be applied when Admin Mode exits
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
