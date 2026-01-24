'use client';

import { useState } from 'react';
import { X, Phone, Mic, User, FileText, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallLog } from '@/lib/types';

interface CallLogFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<CallLog>) => void;
  companyName: string;
  phoneNumber: string;
}

const OUTCOME_OPTIONS = [
  'Interested',
  'Not Interested',
  'Callback',
  'No Answer',
  'Wrong Number',
  'Other'
] as const;

export function CallLogForm({
  isOpen,
  onClose,
  onSubmit,
  companyName,
  phoneNumber,
}: CallLogFormProps) {
  const [formData, setFormData] = useState({
    call_outcome: 'No Answer' as CallLog['call_outcome'],
    duration: 0,
    owner_name_found: '',
    receptionist_name: '',
    post_call_notes: '',
    interest_level: 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      call_time: new Date().toISOString(),
    });
    setFormData({
      call_outcome: 'No Answer',
      duration: 0,
      owner_name_found: '',
      receptionist_name: '',
      post_call_notes: '',
      interest_level: 0,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Phone size={18} />
              Log Call
            </h2>
            <p className="text-xs text-[var(--muted)]">
              {companyName} • {phoneNumber}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Outcome Grid */}
          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-3">Call Outcome</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {OUTCOME_OPTIONS.map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, call_outcome: outcome }))}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm border transition-all",
                    formData.call_outcome === outcome
                      ? "bg-[var(--foreground)] text-[var(--background)] border-[var(--foreground)] font-medium shadow-md"
                      : "bg-transparent border-[var(--card-border)] text-[var(--muted)] hover:bg-[var(--sidebar-bg)] hover:text-[var(--foreground)]"
                  )}
                >
                  {outcome}
                </button>
              ))}
            </div>
          </div>

          {/* Conditional Fields based on Outcome */}
          {formData.call_outcome !== 'No Answer' && formData.call_outcome !== 'Wrong Number' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--muted)] block mb-1">Owner Name Found</label>
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type="text"
                      value={formData.owner_name_found}
                      onChange={(e) => setFormData(p => ({ ...p, owner_name_found: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--sidebar-bg)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-sm"
                      placeholder="e.g. John Doe"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--muted)] block mb-1">Receptionist Name</label>
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type="text"
                      value={formData.receptionist_name}
                      onChange={(e) => setFormData(p => ({ ...p, receptionist_name: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--sidebar-bg)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-sm"
                      placeholder="e.g. Sarah"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--muted)] block mb-1">Interest Level (1-10)</label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={formData.interest_level}
                  onChange={(e) => setFormData(p => ({ ...p, interest_level: parseInt(e.target.value) }))}
                  className="w-full h-2 bg-[var(--card-border)] rounded-lg appearance-none cursor-pointer accent-[var(--foreground)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--muted)] mt-1">
                  <span>Not Interested</span>
                  <span className="font-medium text-[var(--foreground)]">{formData.interest_level}</span>
                  <span>Very Interested</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-[var(--muted)] block mb-2">Post Call Notes</label>
            <div className="relative">
              <FileText size={16} className="absolute left-3 top-3 text-[var(--muted)]" />
              <textarea
                value={formData.post_call_notes}
                onChange={(e) => setFormData(p => ({ ...p, post_call_notes: e.target.value }))}
                rows={4}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--sidebar-bg)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-sm resize-none"
                placeholder="Summary of the conversation..."
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-colors text-sm font-medium flex items-center justify-center gap-2"
            >
              <Check size={16} />
              Save Log
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}