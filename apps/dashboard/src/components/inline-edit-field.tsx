'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, Undo2, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineEditFieldProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  label?: string;
  id: string; // Unique ID for localStorage
  type?: 'text' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
  isEditing?: boolean;
  onEditChange?: (isEditing: boolean) => void;
}

export function InlineEditField({
  value,
  onSave,
  label,
  id,
  type = 'text',
  options,
  className,
  placeholder,
  isEditing: externalIsEditing,
  onEditChange,
}: InlineEditFieldProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  
  const isEditing = externalIsEditing !== undefined ? externalIsEditing : internalIsEditing;
  const setIsEditing = useCallback((val: boolean) => {
    if (onEditChange) {
      onEditChange(val);
    } else {
      setInternalIsEditing(val);
    }
  }, [onEditChange]);
  const [currentValue, setCurrentValue] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  // History for Ctrl+Z
  const [history, setHistory] = useState<string[]>([value]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Load unsaved changes from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`unsaved_${id}`);
    if (saved !== null && saved !== value) {
      setCurrentValue(saved);
      setHasUnsavedChanges(true);
      setHistory([value, saved]);
      setHistoryIndex(1);
    }
  }, [id, value]);

  // Sync with value if it changes externally
  useEffect(() => {
    if (!hasUnsavedChanges) {
      setCurrentValue(value);
      setSavedValue(value);
      setHistory([value]);
      setHistoryIndex(0);
    }
  }, [value, hasUnsavedChanges]);

  const handleSave = async () => {
    if (currentValue === savedValue) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(currentValue);
      setSavedValue(currentValue);
      setHasUnsavedChanges(false);
      localStorage.removeItem(`unsaved_${id}`);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setCurrentValue(savedValue);
    setHasUnsavedChanges(false);
    localStorage.removeItem(`unsaved_${id}`);
    setIsEditing(false);
  };

  const handleChange = (newValue: string) => {
    setCurrentValue(newValue);
    setHasUnsavedChanges(newValue !== savedValue);
    if (newValue !== savedValue) {
      localStorage.setItem(`unsaved_${id}`, newValue);
    } else {
      localStorage.removeItem(`unsaved_${id}`);
    }

    // Add to history if different from last
    if (newValue !== history[historyIndex]) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newValue);
      // Limit history size
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (historyIndex > 0) {
        const prevValue = history[historyIndex - 1];
        setCurrentValue(prevValue);
        setHistoryIndex(historyIndex - 1);
        setHasUnsavedChanges(prevValue !== savedValue);
      }
    } else if (e.key === 'Enter' && type !== 'textarea') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  const handleReset = () => {
    setCurrentValue(value);
    setHasUnsavedChanges(false);
    localStorage.removeItem(`unsaved_${id}`);
    setHistory([value]);
    setHistoryIndex(0);
  };

  if (!isEditing && !hasUnsavedChanges) {
    return (
      <div
        onClick={() => setIsEditing(true)}
        className={cn(
          "group relative cursor-pointer py-1 px-2 -mx-2 rounded hover:bg-[var(--sidebar-hover)] transition-colors min-h-[1.5rem]",
          className
        )}
      >
        <span className={cn(!currentValue && "text-[var(--muted)]")}>
          {currentValue || placeholder || 'Click to edit...'}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {label && <label className="text-xs text-[var(--muted)]">{label}</label>}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          {type === 'textarea' ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={currentValue}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] text-sm min-h-[80px]"
              autoFocus
            />
          ) : type === 'select' ? (
            <select
              ref={inputRef as React.RefObject<HTMLSelectElement>}
              value={currentValue}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] text-sm"
              autoFocus
            >
              {options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={currentValue}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] text-sm"
              autoFocus
            />
          )}
          
          {hasUnsavedChanges && (
            <div 
              className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--primary)] border border-[var(--card-bg)]" 
              title="Unsaved changes"
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges}
            className="p-1 rounded hover:bg-[var(--success-subtle)] text-[var(--success)] disabled:opacity-30 transition-colors"
            title="Save (Enter)"
          >
            <Check size={16} />
          </button>
          <button
            onClick={handleCancel}
            className="p-1 rounded hover:bg-[var(--error-subtle)] text-[var(--error)] transition-colors"
            title="Cancel (Esc)"
          >
            <X size={16} />
          </button>
          {hasUnsavedChanges && (
            <button
              onClick={handleReset}
              className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors"
              title="Reset to original"
            >
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      </div>
      {hasUnsavedChanges && (
        <p className="text-[10px] text-[var(--primary)] flex items-center gap-1">
          <Undo2 size={10} />
          Ctrl+Z to undo unsaved changes
        </p>
      )}
    </div>
  );
}
