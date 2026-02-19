import { addDays, format, isToday, isTomorrow, isYesterday, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Get the default follow-up time: tomorrow at the same time
 */
export function getDefaultFollowUpTime(): Date {
  return addDays(new Date(), 1);
}

/**
 * Format a scheduled time as a human-readable relative string
 * e.g., "in 5 mins", "in 2 hours", "Tomorrow 2:00 PM", "Feb 20 at 3:00 PM"
 */
export function formatRelativeFollowUp(scheduledTime: string | Date): string {
  const date = new Date(scheduledTime);
  const now = new Date();

  if (date < now) {
    // Overdue
    const minsAgo = differenceInMinutes(now, date);
    if (minsAgo < 60) return `Overdue by ${minsAgo}m`;
    const hoursAgo = differenceInHours(now, date);
    if (hoursAgo < 24) return `Overdue by ${hoursAgo}h`;
    const daysAgo = differenceInDays(now, date);
    return `Overdue by ${daysAgo}d`;
  }

  const minsUntil = differenceInMinutes(date, now);
  if (minsUntil < 60) return `in ${minsUntil} min${minsUntil !== 1 ? 's' : ''}`;

  const hoursUntil = differenceInHours(date, now);
  if (hoursUntil < 2) return `in ${minsUntil} mins`;

  if (isToday(date)) return `Today ${format(date, 'h:mm a')}`;
  if (isTomorrow(date)) return `Tomorrow ${format(date, 'h:mm a')}`;

  const daysUntil = differenceInDays(date, now);
  if (daysUntil < 7) return `in ${daysUntil} days (${format(date, 'EEE h:mm a')})`;

  return `${format(date, 'MMM d')} at ${format(date, 'h:mm a')}`;
}

/**
 * Format a time in a specific timezone
 */
export function formatTimeInTimezone(date: string | Date, timezone: string): string {
  try {
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return format(new Date(date), 'h:mm a');
  }
}

/**
 * Format a date+time in a specific timezone
 */
export function formatDateTimeInTimezone(date: string | Date, timezone: string): string {
  try {
    const d = new Date(date);
    return d.toLocaleString('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return format(new Date(date), 'MMM d, h:mm a');
  }
}

/**
 * Get the short timezone abbreviation (e.g., "EST", "PST")
 */
export function getTimezoneAbbreviation(timezone: string): string {
  try {
    const parts = new Date().toLocaleTimeString('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).split(' ');
    return parts[parts.length - 1] || timezone;
  } catch {
    return timezone;
  }
}

/**
 * Get a readable city name from an IANA timezone string
 * e.g., "America/New_York" -> "New York"
 */
export function getTimezoneCityName(timezone: string): string {
  const parts = timezone.split('/');
  return (parts[parts.length - 1] || timezone).replace(/_/g, ' ');
}

/**
 * Convert a local date+time in a given timezone to UTC
 * e.g., User picks "2pm" and timezone is "America/New_York" -> stores as UTC
 */
export function localTimeToUTC(date: Date, timezone: string): Date {
  return fromZonedTime(date, timezone);
}

/**
 * Convert a UTC date to local time in a given timezone
 */
export function utcToLocalTime(date: Date | string, timezone: string): Date {
  return toZonedTime(new Date(date), timezone);
}

/**
 * Format a follow-up's original scheduling info
 * e.g., "2:00 PM EST (America/New_York)"
 */
export function formatOriginalScheduleInfo(scheduledTime: string, clientTimezone: string): string {
  const timeStr = formatTimeInTimezone(scheduledTime, clientTimezone);
  const abbr = getTimezoneAbbreviation(clientTimezone);
  const city = getTimezoneCityName(clientTimezone);
  return `${timeStr} ${abbr} (${city})`;
}
