'use client';

import { useState } from 'react';
import { Plus, Minus, Check, X } from 'lucide-react';

interface PerformanceCounterInlineProps {
    value: number;
    onSave: (newValue: number) => Promise<void>;
    label: string;
}

export function PerformanceCounterInline({ value, onSave, label }: PerformanceCounterInlineProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const [saving, setSaving] = useState(false);

    const handleIncrement = () => {
        setEditValue(prev => prev + 1);
    };

    const handleDecrement = () => {
        setEditValue(prev => Math.max(0, prev - 1));
    };

    const handleSave = async () => {
        if (editValue === value) {
            setIsEditing(false);
            return;
        }

        setSaving(true);
        try {
            await onSave(editValue);
            setIsEditing(false);
        } catch (err) {
            console.error('Failed to save:', err);
            // Reset to original value on error
            setEditValue(value);
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        setEditValue(value);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="flex items-center gap-2">
                <button
                    onClick={handleDecrement}
                    disabled={saving}
                    className="w-7 h-7 rounded flex items-center justify-center bg-[var(--card-bg)] border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors disabled:opacity-50"
                    aria-label={`Decrement ${label}`}
                >
                    <Minus size={14} />
                </button>

                <span className="w-10 text-center font-medium tabular-nums">{editValue}</span>

                <button
                    onClick={handleIncrement}
                    disabled={saving}
                    className="w-7 h-7 rounded flex items-center justify-center bg-[var(--card-bg)] border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors disabled:opacity-50"
                    aria-label={`Increment ${label}`}
                >
                    <Plus size={14} />
                </button>

                <div className="flex items-center gap-1 ml-1">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-7 h-7 rounded flex items-center justify-center bg-[var(--success-subtle)] text-[var(--success)] hover:bg-[var(--success)] hover:text-white transition-all disabled:opacity-50"
                        aria-label="Save"
                    >
                        <Check size={14} />
                    </button>
                    <button
                        onClick={handleCancel}
                        disabled={saving}
                        className="w-7 h-7 rounded flex items-center justify-center bg-[var(--error-subtle)] text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-all disabled:opacity-50"
                        aria-label="Cancel"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <button
            onClick={() => setIsEditing(true)}
            className="font-medium hover:text-[var(--primary)] transition-colors tabular-nums"
        >
            {value}
        </button>
    );
}
