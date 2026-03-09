'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trash2, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRecycleBinOptional, type DeletedItemInfo } from '@/contexts/recycle-bin-context';

const TOAST_DURATION = 7000; // 7 seconds

const TYPE_LABELS: Record<string, string> = {
  company: 'Company',
  phone_number: 'Phone Number',
  call_log: 'Call Log',
  session: 'Session',
};

export function UndoDeleteToast() {
  const recycleBin = useRecycleBinOptional();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [currentItem, setCurrentItem] = useState<DeletedItemInfo | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (recycleBin?.lastDeleted && recycleBin.lastDeleted !== currentItem) {
      setCurrentItem(recycleBin.lastDeleted);
      setLeaving(false);
      setIsUndoing(false);
      setProgress(100);
      requestAnimationFrame(() => setVisible(true));
    }
  }, [recycleBin?.lastDeleted, currentItem]);

  // Progress bar countdown
  useEffect(() => {
    if (!visible || leaving || isUndoing) return;

    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / TOAST_DURATION) * 100);
      setProgress(remaining);

      if (remaining > 0) {
        rafId = requestAnimationFrame(tick);
      }
    };

    let rafId = requestAnimationFrame(tick);

    const timer = setTimeout(() => {
      dismiss();
    }, TOAST_DURATION);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leaving, isUndoing, currentItem]);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      setCurrentItem(null);
    }, 300);
  }, []);

  const handleUndo = useCallback(async () => {
    if (!recycleBin || isUndoing) return;
    setIsUndoing(true);
    try {
      await recycleBin.undoLastDeletion();
      dismiss();
    } catch (err) {
      console.error('Undo failed:', err);
      setIsUndoing(false);
    }
  }, [recycleBin, isUndoing, dismiss]);

  if (!visible || !currentItem) return null;

  const typeLabel = TYPE_LABELS[currentItem.itemType] || currentItem.itemType;

  return (
    <div className="fixed top-4 right-4 z-[100] pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto w-[380px] rounded-xl overflow-hidden shadow-2xl transition-all duration-300 ease-out',
          visible && !leaving
            ? 'opacity-100 translate-x-0 scale-100'
            : 'opacity-0 translate-x-8 scale-95'
        )}
      >
        {/* Animated gradient border wrapper */}
        <div className="p-[2px] rounded-xl bg-gradient-to-r from-red-500 via-orange-500 to-red-500 bg-[length:200%_100%] animate-[border-gradient_3s_linear_infinite]">
          <div className="bg-[var(--card-bg)] rounded-[10px] overflow-hidden">
            {/* Content */}
            <div className="px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {typeLabel} deleted
                </p>
                <p className="text-xs text-[var(--muted)] mt-0.5 truncate">
                  {currentItem.itemLabel}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={handleUndo}
                  disabled={isUndoing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-xs font-bold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  <Undo2 size={12} />
                  {isUndoing ? 'Undoing...' : 'Undo'}
                </button>
                <button
                  onClick={dismiss}
                  className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Keyboard hint */}
            <div className="px-4 pb-2 flex items-center gap-1.5">
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sidebar-bg)] border border-[var(--card-border)] text-[var(--muted)] font-mono">
                Ctrl+Z
              </kbd>
              <span className="text-[10px] text-[var(--muted)]">to undo</span>
            </div>

            {/* Progress bar */}
            <div className="h-[2px] bg-[var(--card-border)]">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-orange-500 transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
