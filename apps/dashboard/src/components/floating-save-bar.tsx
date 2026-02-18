'use client';

import { Save, Undo2, Loader2 } from 'lucide-react';
import { useUnsavedChanges } from '@/contexts/unsaved-changes-context';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export function FloatingSaveBar() {
  const { hasUnsavedChanges, changeCount, saveAll, undoAll, isSaving } = useUnsavedChanges();
  const { addToast } = useToast();

  if (!hasUnsavedChanges) return null;

  const handleSave = async () => {
    const result = await saveAll();
    if (result.success) {
      addToast('success', 'All changes saved successfully');
    } else {
      addToast('error', `Some changes failed to save: ${result.errors.join(', ')}`);
    }
  };

  const handleUndo = () => {
    undoAll();
    addToast('info', 'All unsaved changes reverted');
  };

  return (
    <div
      className={cn(
        'fixed top-0 right-0 left-0 lg:left-64 z-30',
        'bg-[var(--warning-subtle)] border-b border-[var(--warning)]',
        'px-4 py-2 flex items-center justify-between gap-4',
        'animate-in slide-in-from-top duration-200'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2 h-2 rounded-full bg-[var(--warning)] animate-pulse" />
        <span className="font-medium text-[var(--foreground)]">
          {changeCount} unsaved change{changeCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleUndo}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
        >
          <Undo2 size={14} />
          Undo All
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? 'Saving...' : 'Save All'}
        </button>
      </div>
    </div>
  );
}
