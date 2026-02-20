'use client';

import { useState } from 'react';
import { AlertTriangle, X, Link2Off, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type PhoneNumber } from '@/lib/types';

interface SoftDeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  phoneNumber: PhoneNumber;
  onDisassociated: (id: string) => void;
}

export function SoftDeleteConfirmModal({ isOpen, onClose, phoneNumber, onDisassociated }: SoftDeleteConfirmModalProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setConfirming(true);
    setError('');
    try {
      await pb.collection(COLLECTIONS.PHONE_NUMBERS).update(phoneNumber.id, {
        disassociated: true,
      });
      onDisassociated(phoneNumber.id);
      onClose();
    } catch {
      setError(
        'Failed to disassociate. Make sure the "disassociated" boolean field exists in the phone_numbers collection in PocketBase.'
      );
    } finally {
      setConfirming(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-[var(--warning-subtle)] flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} className="text-[var(--warning)]" />
            </div>
            <div>
              <h2 className="text-base font-bold">Disassociate Phone Number?</h2>
              <p className="text-xs text-[var(--muted)] mt-1">
                This marks the number as removed without deleting call history.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
          <p className="font-mono font-bold text-sm">{phoneNumber.phone_number}</p>
          {phoneNumber.location_name && (
            <p className="text-xs text-[var(--muted)] mt-0.5">{phoneNumber.location_name}</p>
          )}
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--info-subtle)] border border-[var(--info)]/20">
          <Link2Off size={14} className="text-[var(--info)] mt-0.5 flex-shrink-0" />
          <p className="text-xs text-[var(--info)]">
            All existing call logs remain intact. The phone number will be shown with a strikethrough to indicate it is no longer active for this company.
          </p>
        </div>

        {error && (
          <p className="text-xs text-[var(--error)] px-3 py-2 bg-[var(--error-subtle)] rounded-lg border border-[var(--error)]/20">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            disabled={confirming}
            className="px-4 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--sidebar-bg)] text-sm font-medium hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
          >
            Keep It
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="px-4 py-2.5 rounded-xl bg-[var(--warning)] text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {confirming ? <Loader2 size={14} className="animate-spin" /> : <Link2Off size={14} />}
            {confirming ? 'Disassociating...' : 'Disassociate'}
          </button>
        </div>
      </div>
    </div>
  );
}
