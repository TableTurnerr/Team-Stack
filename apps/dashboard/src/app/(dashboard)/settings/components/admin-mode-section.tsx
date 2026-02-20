'use client';

import { useState } from 'react';
import { Shield, AlertTriangle, Power, PowerOff } from 'lucide-react';
import { useAdminMode } from '@/contexts/admin-mode-context';
import { cn } from '@/lib/utils';

export function AdminModeSection() {
  const { isAdminMode, enableAdminMode, exitAdminMode, pendingDeletions } = useAdminMode();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleEnableClick = () => {
    if (!showConfirm) {
      setShowConfirm(true);
    }
  };

  const handleConfirmEnable = () => {
    enableAdminMode();
    setShowConfirm(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Admin Mode</h2>
        <p className="text-[var(--muted)] mt-1">
          Permanent deletion tools — staged and applied on exit
        </p>
      </div>

      {/* Main card */}
      <div className={cn(
        "rounded-2xl border-2 p-6 space-y-5 transition-all duration-300",
        isAdminMode
          ? "border-red-500 bg-red-500/5"
          : "border-[var(--card-border)] bg-[var(--card-bg)]"
      )}>
        <div className="flex items-start gap-4">
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
            isAdminMode ? "bg-red-500/10" : "bg-[var(--sidebar-bg)]"
          )}>
            <Shield size={24} className={isAdminMode ? "text-red-500" : "text-[var(--muted)]"} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-base">Admin Mode</h3>
              {isAdminMode && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold uppercase tracking-widest border border-red-500/20 animate-pulse">
                  Active
                </span>
              )}
              {isAdminMode && pendingDeletions.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--warning-subtle)] text-[var(--warning)] font-bold border border-[var(--warning)]/20">
                  {pendingDeletions.length} deletion{pendingDeletions.length !== 1 ? 's' : ''} staged
                </span>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] mt-1 leading-relaxed">
              {isAdminMode
                ? "Admin mode is active. A red border surrounds the application. Navigate to any company or phone number to permanently delete records. All changes are staged and only applied when you exit admin mode."
                : "Enable to gain permanent deletion access. All deletions are staged — nothing is applied until you explicitly confirm and exit admin mode."}
            </p>
          </div>
        </div>

        {/* Warning (non-admin mode only) */}
        {!isAdminMode && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-[var(--warning-subtle)] border border-[var(--warning)]/20">
            <AlertTriangle size={14} className="text-[var(--warning)] mt-0.5 flex-shrink-0" />
            <div className="text-xs text-[var(--warning)] space-y-1">
              <p className="font-semibold">Admin mode grants destructive capabilities:</p>
              <ul className="list-disc list-inside space-y-0.5 opacity-80">
                <li>Permanently delete companies and all their data</li>
                <li>Permanently delete phone numbers and associated call logs</li>
                <li>Optionally delete call recordings (off by default)</li>
              </ul>
            </div>
          </div>
        )}

        {/* Confirm enable prompt */}
        {showConfirm && !isAdminMode && (
          <div className="p-4 rounded-xl bg-red-500/5 border-2 border-red-500/30 space-y-3">
            <p className="text-sm font-bold text-red-400">Enable Admin Mode?</p>
            <p className="text-xs text-[var(--muted)]">
              You acknowledge that this grants access to irreversible permanent deletion of database records. All deletions are staged and only committed when you exit admin mode.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 rounded-xl border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--card-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEnable}
                className="flex-1 px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
              >
                <Power size={14} />
                Enable Admin Mode
              </button>
            </div>
          </div>
        )}

        {/* Toggle button */}
        {!showConfirm && (
          <button
            onClick={isAdminMode ? exitAdminMode : handleEnableClick}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all",
              isAdminMode
                ? "bg-[var(--card-hover)] text-[var(--foreground)] border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)]"
                : "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
            )}
          >
            {isAdminMode
              ? <><PowerOff size={16} /> Exit Admin Mode (Discard All Staged Changes)</>
              : <><Shield size={16} /> Enable Admin Mode</>
            }
          </button>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)] p-5 space-y-3">
        <h4 className="text-sm font-bold">How Admin Mode Works</h4>
        <ul className="space-y-2">
          {[
            "Deletions are queued — nothing is applied until you confirm exit",
            "A red border surrounds the entire app while admin mode is active",
            "Each deletion has a 10-second safety countdown — cancel anytime",
            "Call recordings are never deleted by default; you must opt in per-deletion",
            "Exiting without confirming discards all staged deletions",
            "The 'Confirm & Exit' button in the top banner pulses to remind you of pending changes",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-[var(--muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)] mt-1.5 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
