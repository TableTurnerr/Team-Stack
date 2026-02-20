'use client';

import { useState } from 'react';
import { Shield, Trash2, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminModeOptional } from '@/contexts/admin-mode-context';

export function AdminModeBanner() {
  const adminMode = useAdminModeOptional();
  const [showDetails, setShowDetails] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);

  if (!adminMode?.isAdminMode) return null;

  const { pendingDeletions, removeStagedDeletion, commitAndExit, exitAdminMode, isCommitting, commitError } = adminMode;

  return (
    <>
      <div className="bg-red-950/95 border-b-2 border-red-500 text-white flex-shrink-0">
        {/* Main bar */}
        <div className="px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 flex-shrink-0">
              <Shield size={15} className="text-red-300" />
              <span className="font-bold text-xs text-red-200 uppercase tracking-widest">Admin Mode Active</span>
            </div>

            {pendingDeletions.length > 0 ? (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1.5 text-xs text-red-300 hover:text-white transition-colors"
              >
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex-shrink-0">
                  {pendingDeletions.length}
                </span>
                pending deletion{pendingDeletions.length !== 1 ? 's' : ''} staged
                {showDetails ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            ) : (
              <span className="text-xs text-red-500">No deletions staged yet</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Exit without applying */}
            <button
              onClick={exitAdminMode}
              disabled={isCommitting}
              className="flex items-center gap-1.5 text-xs text-red-300 hover:text-white border border-red-700 hover:border-red-400 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
            >
              <X size={11} />
              Exit (Discard)
            </button>

            {/* Confirm & Exit — pulses every 4s via attention-pulse animation */}
            <button
              onClick={() => setShowFinalConfirm(true)}
              disabled={isCommitting || pendingDeletions.length === 0}
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                "bg-red-500 hover:bg-red-400 text-white",
                "animate-[attention-pulse_4s_ease-in-out_infinite]",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:animate-none"
              )}
            >
              {isCommitting
                ? <Loader2 size={13} className="animate-spin" />
                : <Trash2 size={13} />
              }
              {isCommitting
                ? 'Applying...'
                : `Confirm & Exit (${pendingDeletions.length})`
              }
            </button>
          </div>
        </div>

        {/* Commit error */}
        {commitError && (
          <div className="px-4 pb-2.5">
            <p className="text-xs text-red-300 bg-red-900/60 px-3 py-2 rounded-lg border border-red-500/30">
              ⚠️ {commitError}
            </p>
          </div>
        )}

        {/* Expanded staged deletions list */}
        {showDetails && pendingDeletions.length > 0 && (
          <div className="px-4 pb-3 pt-1 space-y-1 border-t border-red-800/60">
            <p className="text-[9px] font-bold text-red-500 uppercase tracking-widest mb-2 mt-2">Staged Deletions</p>
            {pendingDeletions.map(d => (
              <div
                key={d.stagingId}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-red-950/60 border border-red-800/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded uppercase font-bold flex-shrink-0",
                    d.type === 'company'
                      ? "bg-red-500/30 text-red-200"
                      : "bg-orange-500/30 text-orange-200"
                  )}>
                    {d.type === 'company' ? 'Co.' : 'Ph.'}
                  </span>
                  <span className="text-xs text-red-100 font-mono truncate">{d.targetLabel}</span>
                  <span className="text-[10px] text-red-500 flex-shrink-0">
                    {d.associatedCallLogIds.length} log{d.associatedCallLogIds.length !== 1 ? 's' : ''}
                    {d.deleteRecordings && d.hasRecordings ? ' + recordings' : ''}
                  </span>
                </div>
                <button
                  onClick={() => removeStagedDeletion(d.stagingId)}
                  className="p-1 rounded text-red-500 hover:text-white hover:bg-red-500/20 transition-colors flex-shrink-0"
                  title="Unstage this deletion"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Final confirmation modal */}
      {showFinalConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--card-bg)] border-2 border-red-500 rounded-2xl shadow-2xl shadow-red-500/30 max-w-md w-full p-6 space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Shield size={24} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-red-400">Apply All Deletions?</h3>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {pendingDeletions.length} permanent deletion{pendingDeletions.length !== 1 ? 's' : ''} · This cannot be undone
                </p>
              </div>
            </div>

            <p className="text-sm text-[var(--muted)]">
              All staged records will be permanently removed from the database. Admin mode will be disabled after completion.
            </p>

            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {pendingDeletions.map(d => (
                <div key={d.stagingId} className="flex items-center gap-2 text-xs py-1">
                  <Trash2 size={11} className="text-red-400 flex-shrink-0" />
                  <span className="text-red-300 font-mono truncate">{d.targetLabel}</span>
                  <span className="text-[var(--muted)] flex-shrink-0">
                    ({d.associatedCallLogIds.length} log{d.associatedCallLogIds.length !== 1 ? 's' : ''}
                    {d.deleteRecordings && d.hasRecordings ? ', +recordings' : ''})
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowFinalConfirm(false)}
                disabled={isCommitting}
                className="px-4 py-2.5 rounded-xl border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
              >
                Go Back
              </button>
              <button
                onClick={async () => {
                  setShowFinalConfirm(false);
                  await commitAndExit();
                }}
                disabled={isCommitting}
                className="px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCommitting
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Trash2 size={14} />
                }
                {isCommitting ? 'Applying...' : 'Apply & Exit Admin Mode'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
