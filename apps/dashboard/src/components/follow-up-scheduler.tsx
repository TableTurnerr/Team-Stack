'use client';

import { useState, useEffect } from 'react';
import { Globe, Clock, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { useFollowUps } from '@/contexts/follow-up-context';
import { useToast } from '@/components/ui/toast';
import { TimezoneSearch } from '@/components/timezone-search';
import {
  getTimezoneAbbreviation,
  getTimezoneCityName,
  localTimeToUTC,
  utcToLocalTime,
} from '@/lib/timezone-utils';
import { format, addDays } from 'date-fns';

type DateMode = 'today' | 'tomorrow' | 'day-after' | 'other';

interface FollowUpSchedulerProps {
  companyId: string;
  companyName: string;
  phoneNumberRecordId?: string;
  callLogId?: string;
  onScheduled?: (followUpId: string) => void;
  onCancel?: () => void;
  compact?: boolean;
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

  // The "starred" timezone drives the default
  const defaultTz =
    preferences?.workflow_preferences?.cold_calling_timezone ||
    preferences?.timezones?.[0]?.timezone ||
    'America/New_York';

  const [selectedTimezone, setSelectedTimezone] = useState(defaultTz);

  // Two-way sync: when user stars a timezone in the sidebar, instantly update the form
  // and reset the time to the current wall-clock time in the new timezone
  useEffect(() => {
    setSelectedTimezone(defaultTz);
    setTimeValue(format(utcToLocalTime(new Date(), defaultTz), 'HH:mm'));
    setIsCurrentTime(true);
  }, [defaultTz]);

  // Date mode and time value — initialize time to NOW in the selected timezone
  const [dateMode, setDateMode] = useState<DateMode>('tomorrow');
  const [timeValue, setTimeValue] = useState(() =>
    format(utcToLocalTime(new Date(), defaultTz), 'HH:mm')
  );
  const [isCurrentTime, setIsCurrentTime] = useState(true);
  const [otherDateValue, setOtherDateValue] = useState(
    format(addDays(new Date(), 3), 'yyyy-MM-dd')
  );

  // Build the scheduled Date object from current state
  function buildScheduledDate(): Date {
    const [hours, minutes] = timeValue.split(':').map(Number);
    let base: Date;
    if (dateMode === 'today') base = new Date();
    else if (dateMode === 'tomorrow') base = addDays(new Date(), 1);
    else if (dateMode === 'day-after') base = addDays(new Date(), 2);
    else base = new Date(otherDateValue + 'T00:00:00');
    base.setHours(hours, minutes, 0, 0);
    return base;
  }

  // Notify parent in controlled mode whenever state changes
  useEffect(() => {
    if (!onChange) return;
    const [hours, minutes] = timeValue.split(':').map(Number);
    let base: Date;
    if (dateMode === 'today') base = new Date();
    else if (dateMode === 'tomorrow') base = addDays(new Date(), 1);
    else if (dateMode === 'day-after') base = addDays(new Date(), 2);
    else base = new Date(otherDateValue + 'T00:00:00');
    base.setHours(hours, minutes, 0, 0);
    const utcDate = localTimeToUTC(base, selectedTimezone);
    onChange({ scheduledTime: utcDate.toISOString(), timezone: selectedTimezone, notes });
  }, [dateMode, timeValue, otherDateValue, selectedTimezone, notes, onChange]);

  // When the user picks a timezone in the form:
  // 1. Update the local state
  // 2. Star it (set as cold_calling_timezone)
  // 3. Add it to the monitored sidebar list if not already present
  const handleTimezoneSelect = async (tz: { timezone: string; label: string }) => {
    setSelectedTimezone(tz.timezone);
    setShowTzSearch(false);

    const existingTzs = preferences?.timezones || [];
    const alreadyInList = existingTzs.some(t => t.timezone === tz.timezone);
    const newTimezones = alreadyInList
      ? existingTzs
      : existingTzs.length < 4
        ? [...existingTzs, tz]
        : existingTzs; // at capacity — still star it, just don't add to list

    await updatePreferences({
      workflow_preferences: {
        ...preferences?.workflow_preferences,
        cold_calling_timezone: tz.timezone,
      },
      timezones: newTimezones,
    });
  };

  const handleSave = async () => {
    if (!companyId) return;
    setIsSaving(true);
    try {
      const utcDate = localTimeToUTC(buildScheduledDate(), selectedTimezone);
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

  // Human-readable time for button labels (e.g. "2:00 PM")
  const displayTime = (() => {
    const [h, m] = timeValue.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return format(d, 'h:mm a');
  })();

  const today = new Date();
  const dayAfter = addDays(today, 2);
  const todayStr = format(today, 'yyyy-MM-dd');

  const dateOptions: { mode: DateMode; label: string }[] = [
    { mode: 'today', label: 'Today' },
    { mode: 'tomorrow', label: 'Tomorrow' },
    { mode: 'day-after', label: format(dayAfter, 'EEE do') },
    { mode: 'other', label: 'Other…' },
  ];

  return (
    <div className={cn(
      'space-y-3',
      !compact && 'p-4 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]'
    )}>
      {/* Timezone banner — clicking opens timezone search */}
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

      {/* Relative date quick-select */}
      <div className="grid grid-cols-4 gap-1.5">
        {dateOptions.map((opt) => (
          <button
            key={opt.mode}
            type="button"
            onClick={() => setDateMode(opt.mode)}
            className={cn(
              'flex flex-col items-center justify-center px-1 py-2.5 rounded-lg text-xs font-medium transition-all border',
              dateMode === opt.mode
                ? 'bg-[var(--info-subtle)] text-[var(--info)] border-[var(--info)]/40'
                : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
            )}
          >
            <span className="text-[11px] font-semibold leading-tight">{opt.label}</span>
            <span className="text-[10px] opacity-60 mt-0.5">
              {opt.mode !== 'other' ? displayTime : '—'}
            </span>
          </button>
        ))}
      </div>

      {/* Shared time picker for Today / Tomorrow / day-after */}
      {dateMode !== 'other' && (
        <div>
          <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Clock size={10} />
              Time ({tzAbbr})
            </span>
            <button
              type="button"
              onClick={() => {
                const next = !isCurrentTime;
                setIsCurrentTime(next);
                if (next) setTimeValue(format(utcToLocalTime(new Date(), selectedTimezone), 'HH:mm'));
              }}
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider border transition-all cursor-pointer',
                isCurrentTime
                  ? 'bg-[var(--success-subtle)] text-[var(--success)] border-[var(--success)]/30 hover:bg-[var(--success)]/20'
                  : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
              )}
            >
              Current Time
            </button>
          </label>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => { setTimeValue(e.target.value); setIsCurrentTime(false); }}
            className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
        </div>
      )}

      {/* Full date + time picker for "Other" */}
      {dateMode === 'other' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-1">
              <Calendar size={10} />
              Date
            </label>
            <input
              type="date"
              value={otherDateValue}
              min={todayStr}
              onChange={(e) => setOtherDateValue(e.target.value)}
              className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-[var(--muted)] mb-1 flex items-center gap-2">
              <span className="flex items-center gap-1">
                <Clock size={10} />
                Time ({tzAbbr})
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !isCurrentTime;
                  setIsCurrentTime(next);
                  if (next) setTimeValue(format(utcToLocalTime(new Date(), selectedTimezone), 'HH:mm'));
                }}
                className={cn(
                  'text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider border transition-all cursor-pointer',
                  isCurrentTime
                    ? 'bg-[var(--success-subtle)] text-[var(--success)] border-[var(--success)]/30 hover:bg-[var(--success)]/20'
                    : 'bg-[var(--sidebar-bg)] text-[var(--muted)] border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                )}
              >
                Current Time
              </button>
            </label>
            <input
              type="time"
              value={timeValue}
              onChange={(e) => { setTimeValue(e.target.value); setIsCurrentTime(false); }}
              className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </div>
        </div>
      )}

      {/* Notes — only shown in non-compact (standalone) mode */}
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

      {/* Save button — only shown in uncontrolled (standalone) mode */}
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
            {isSaving ? 'Scheduling…' : 'Schedule Follow-Up'}
          </button>
        </div>
      )}
    </div>
  );
}
