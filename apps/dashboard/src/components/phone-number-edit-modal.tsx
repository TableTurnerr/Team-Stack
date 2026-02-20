'use client';

import { useState, useEffect } from 'react';
import { X, Save, Phone, MapPin, User, Loader2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type PhoneNumber } from '@/lib/types';
import { cn } from '@/lib/utils';

const PHONE_LABELS = ['Owner Direct', 'Main Line', 'Manager', 'Branch'] as const;

interface PhoneNumberEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  phoneNumber: PhoneNumber;
  onUpdated: (updated: PhoneNumber) => void;
}

export function PhoneNumberEditModal({ isOpen, onClose, phoneNumber, onUpdated }: PhoneNumberEditModalProps) {
  const [phoneNum, setPhoneNum] = useState(phoneNumber.phone_number);
  const [label, setLabel] = useState(phoneNumber.label || '');
  const [locationName, setLocationName] = useState(phoneNumber.location_name || '');
  const [locationAddress, setLocationAddress] = useState(phoneNumber.location_address || '');
  const [receptionistName, setReceptionistName] = useState(phoneNumber.receptionist_name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPhoneNum(phoneNumber.phone_number);
      setLabel(phoneNumber.label || '');
      setLocationName(phoneNumber.location_name || '');
      setLocationAddress(phoneNumber.location_address || '');
      setReceptionistName(phoneNumber.receptionist_name || '');
      setError('');
    }
  }, [isOpen, phoneNumber]);

  const handleSave = async () => {
    if (!phoneNum.trim()) {
      setError('Phone number is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await pb.collection(COLLECTIONS.PHONE_NUMBERS).update<PhoneNumber>(phoneNumber.id, {
        phone_number: phoneNum.trim(),
        label: label || null,
        location_name: locationName.trim() || null,
        location_address: locationAddress.trim() || null,
        receptionist_name: receptionistName.trim() || null,
      });
      onUpdated(updated);
      onClose();
    } catch {
      setError('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-[var(--card-border)]">
          <h2 className="text-base font-bold">Edit Phone Number</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <p className="text-sm text-[var(--error)] px-3 py-2 bg-[var(--error-subtle)] rounded-lg border border-[var(--error)]/20">
              {error}
            </p>
          )}

          {/* Phone Number */}
          <div>
            <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 block">
              Phone Number <span className="text-[var(--error)]">*</span>
            </label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="tel"
                value={phoneNum}
                onChange={e => setPhoneNum(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm font-mono focus:outline-none focus:border-[var(--primary)]"
                placeholder="+1 555-1234"
              />
            </div>
          </div>

          {/* Label */}
          <div>
            <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 block">
              Label
            </label>
            <div className="flex flex-wrap gap-2">
              {PHONE_LABELS.map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLabel(label === l ? '' : l)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    label === l
                      ? "bg-[var(--foreground)] text-[var(--background)] border-transparent"
                      : "bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Location Name */}
          <div>
            <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 block">
              Location Name
            </label>
            <input
              type="text"
              value={locationName}
              onChange={e => setLocationName(e.target.value)}
              className="w-full px-3 py-2.5 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              placeholder="e.g. Main Branch, Downtown Office"
            />
          </div>

          {/* Location Address */}
          <div>
            <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 block">
              Location Address
            </label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-3 text-[var(--muted)]" />
              <textarea
                value={locationAddress}
                onChange={e => setLocationAddress(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] resize-none"
                rows={2}
                placeholder="Street, City, State"
              />
            </div>
          </div>

          {/* Receptionist Name */}
          <div>
            <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 block">
              Receptionist Name
            </label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                value={receptionistName}
                onChange={e => setReceptionistName(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                placeholder="Receptionist or contact name"
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[var(--card-border)] grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl border border-[var(--card-border)] bg-[var(--sidebar-bg)] text-sm font-medium hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-bold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
