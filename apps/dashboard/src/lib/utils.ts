import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(date);
}

export function formatPhoneNumber(phone: string | undefined | null): string {
  if (!phone) return 'N/A';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Sanitize a value for use in PocketBase filter strings.
 * Prevents filter injection attacks by escaping special characters.
 *
 * @param value - The raw user input to sanitize
 * @returns Sanitized string safe for use in filter expressions
 */
export function sanitizeFilterValue(value: string): string {
  if (!value) return '';

  // Escape double quotes and backslashes which can break filter syntax
  let sanitized = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Remove potentially dangerous filter operators that could be injected
  // These could allow filter bypass: && || ! ( ) ~ = != > >= < <=
  sanitized = sanitized.replace(/[&|!()~=<>]/g, '');

  return sanitized;
}

/**
 * Session Statistics Helper Functions
 */

export interface SessionStats {
  pickupRate: number;
  ownerRate: number;
  pitchRate: number;
  appointmentRate: number;
  averageCallDuration: number;
  pickupRateColor: string;
  ownerRateColor: string;
}

/**
 * Calculate comprehensive statistics for a cold calling session
 *
 * @param session - The cold calling session to analyze
 * @returns Detailed statistics about the session performance
 */
export function calculateSessionStats(session: {
  total_dials: number;
  total_pickups: number;
  total_duration_sec: number;
  owner_reached: number;
  pitch_completed: number;
  appointment_set: number;
}): SessionStats {
  const totalDials = session.total_dials || 0;
  const totalPickups = session.total_pickups || 0;

  // Calculate rates (as percentages)
  const pickupRate = totalDials > 0 ? Math.round((totalPickups / totalDials) * 100) : 0;
  const ownerRate = totalDials > 0 ? Math.round(((session.owner_reached || 0) / totalDials) * 100) : 0;
  const pitchRate = totalPickups > 0 ? Math.round(((session.pitch_completed || 0) / totalPickups) * 100) : 0;
  const appointmentRate = totalPickups > 0 ? Math.round(((session.appointment_set || 0) / totalPickups) * 100) : 0;

  // Calculate average call duration
  const averageCallDuration = totalPickups > 0
    ? Math.round((session.total_duration_sec || 0) / totalPickups)
    : 0;

  // Determine color indicators based on performance
  const pickupRateColor = pickupRate >= 50 ? 'success' : pickupRate >= 30 ? 'warning' : 'error';
  const ownerRateColor = ownerRate >= 40 ? 'success' : ownerRate >= 20 ? 'warning' : 'error';

  return {
    pickupRate,
    ownerRate,
    pitchRate,
    appointmentRate,
    averageCallDuration,
    pickupRateColor,
    ownerRateColor,
  };
}

/**
 * Format session duration in a human-readable format
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string (e.g., "2h 15m", "45m", "30s")
 */
export function formatSessionDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

/**
 * Calculate aggregate statistics across multiple sessions
 *
 * @param sessions - Array of sessions to analyze
 * @returns Aggregated statistics
 */
export function calculateAggregateStats(sessions: Array<{
  total_dials: number;
  total_pickups: number;
  total_duration_sec: number;
  owner_reached: number;
  pitch_completed: number;
  appointment_set: number;
}>) {
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalDials: 0,
      totalPickups: 0,
      totalDuration: 0,
      averagePickupRate: 0,
      averageOwnerRate: 0,
      totalAppointments: 0,
    };
  }

  const totals = sessions.reduce(
    (acc, session) => ({
      dials: acc.dials + (session.total_dials || 0),
      pickups: acc.pickups + (session.total_pickups || 0),
      duration: acc.duration + (session.total_duration_sec || 0),
      ownerReached: acc.ownerReached + (session.owner_reached || 0),
      appointments: acc.appointments + (session.appointment_set || 0),
    }),
    { dials: 0, pickups: 0, duration: 0, ownerReached: 0, appointments: 0 }
  );

  const averagePickupRate = totals.dials > 0
    ? Math.round((totals.pickups / totals.dials) * 100)
    : 0;

  const averageOwnerRate = totals.dials > 0
    ? Math.round((totals.ownerReached / totals.dials) * 100)
    : 0;

  return {
    totalSessions: sessions.length,
    totalDials: totals.dials,
    totalPickups: totals.pickups,
    totalDuration: totals.duration,
    averagePickupRate,
    averageOwnerRate,
    totalAppointments: totals.appointments,
  };
}