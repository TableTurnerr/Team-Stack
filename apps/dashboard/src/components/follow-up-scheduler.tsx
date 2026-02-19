'use client';

import { useState, useEffect } from 'react';
import { Globe, Calendar, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useToast } from '@/components/ui/toast';
import { TimezoneSearch } from '@/components/timezone-search';
import {
  getDefaultFollowUpTime,
  getTimezoneAbbreviation,
  getTimezoneCityName,
  localTimeToUTC,
} from '@/lib/timezone-utils';
import { format } from 'date-fns';

interface FollowUpSchedulerProps {
  companyId: string;
  companyName: string;
  phoneNumberRecordId?: string;
  callLogId?: string;
  onScheduled?: (followUpId: string) => void;
  onCancel?: () => void;
  compact?: boolean; // For inline use in session form
  // Allow parent to control the data without auto-saving
  onChange?: (data: { scheduledTime: string; timezone: string; notes: string } | null) => void;
}

export function FollowUpScheduler({
  companyId,
  companyName,
  phoneNumberRecordId,
  callLogId,
  onScheduled,
  onCancel,
  compact = false,
  onChange,
}: FollowUpSchedulerProps) {
  const { preferences, updatePreferences } = useUserPreferences();
  const { createFollowUp } = useFollowUps();
  const { addToast } = useToast();
  const [showTzSearch, setShowTzSearch] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notes, setNotes] = useState('');

  // Get the active cold calling timezone or fall back to first sidebar tz or EST
  const defaultTz = preferences?.workflow_preferences?.cold_calling_timezone
    || preferences?.timezones?.[0]?.timezone
    || 'America/New_York';

  const [selectedTimezone, setSelectedTimezone] = useState(defaultTz);

  // Set default follow-up time (tomorrow, same hour)
  const defaultTime = getDefaultFollowUpTime();
  const [dateValue, setDateValue] = useState(format(defaultTime, 'yyyy-MM-dd'));
  const [timeValue, setTimeValue] = useState(format(defaultTime, 'HH:mm'));

  // Notify parent of changes when in controlled mode
  useEffect(() => {
    if (onChange) {
      const localDate = new Date(`${dateValue}T${timeValue}:00`);
      const utcDate = localTimeToUTC(localDate, selectedTimezone);
      onChange({
        scheduledTime: utcDate.toISOString(),
        timezone: selectedTimezone,
        notes,
      });
    }
  }, [dateValue, timeValue, selectedTimezone, notes, onChange]);

  const handleTimezoneSelect = async (tz: { timezone: string; label: string }) => {
    setSelectedTimezone(tz.timezone);
    setShowTzSearch(false);

    // Auto-add timezone to sidebar if not already present
    const existingTzs = preferences?.timezones || [];
    if (!existingTzs.find(t => t.timezone === tz.timezone) && existingTzs.length < 4) {
      await updatePreferences({ timezones: [...existingTzs, tz] });
    }
  };

  const handleSave = async () => {
    if (!companyId) return;
    setIsSaving(true);

    try {
      // Convert the selected local time in the chosen timezone to UTC
      const localDate = new Date(`${dateValue}T${timeValue}:00`);
      const utcDate = localTimeToUTC(localDate, selectedTimezone);

      const followUp = await createFollowUp({
        company: companyId,
        phone_number_record: phoneNumberRecordId,
        call_log: callLogId,
        scheduled_time: utcDate.toISOString(),
        client_timezone: selectedTimezone,
        notes: notes || `Follow up with ${companyName}`,
      });

      addToast('success', `Follow-up scheduled for ${companyName}`);
      onScheduled?.(followUp.id);
    } catch (err) {
      addToast('error', 'Failed to schedule follow-up');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const tzAbbr = getTimezoneAbbreviation(selectedTimezone);
  const tzCity = getTimezoneCityName(selectedTimezone);

  return (
    <div className={cn(
      'space-y-3',
      !compact && 'p-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]'
    )}>
      {/* Timezone Banner */}
      <button
        type="button"
        onClick={() => setShowTzSearch(!showTzSearch)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--info-subtle)] border border-[var(--info)] text-sm text-left transition-colors hover:bg-opacity-80"
      >
        <Globe size={14} className="text-[var(--info)] shrink-0" />
        <span className="text-[var(--foreground)]">
          Scheduling in <strong>{tzAbbr}</strong> ({tzCity})
        </span>
        <span className="ml-auto text-xs text-[var(--info)]">Change</span>
      </button>

      {showTzSearch && (
        <div className="relative z-10">
          <TimezoneSearch
            onSelect={handleTimezoneSelect}
            onCancel={() => setShowTzSearch(false)}
            existingTimezones={[]}
          />
        </div>
      )}

      {/* Date + Time */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
            <Calendar size={10} />
            Date
          </label>
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
            <Clock size={10} />
            Time ({tzAbbr})
          </label>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => setTimeValue(e.target.value)}
            className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
        </div>
      </div>

      {/* Notes */}
      {!compact && (
        <div>
          <label className="text-xs text-[var(--muted)] mb-1 block">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`Follow up with ${companyName}...`}
            className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
        </div>
      )}

      {/* Actions - only show when not in controlled mode */}
      {!onChange && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-sm text-[var(--muted)] hover:bg-[var(--card-hover)] transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !companyId}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isSaving ? 'Scheduling...' : 'Schedule Follow-Up'}
          </button>
        </div>
      )}
    </div>
  );
}
