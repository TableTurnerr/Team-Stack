export interface NotificationSettings {
  follow_up_reminders?: boolean;
  dnd_enabled?: boolean;
  dnd_start?: string; // "HH:MM"
  dnd_end?: string;   // "HH:MM"
}

/**
 * Returns true if the current time falls inside the user's DND window.
 * Handles windows that cross midnight (e.g. 22:00 → 08:00).
 */
export function isInDND(prefs: NotificationSettings): boolean {
  if (!prefs.dnd_enabled) return false;

  const now = new Date();
  const [startH, startM] = (prefs.dnd_start || '22:00').split(':').map(Number);
  const [endH, endM] = (prefs.dnd_end || '08:00').split(':').map(Number);

  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const startMins = startH * 60 + startM;
  const endMins   = endH  * 60 + endM;

  // Same-day window (e.g. 09:00 → 17:00)
  if (startMins < endMins) return nowMins >= startMins && nowMins < endMins;

  // Cross-midnight window (e.g. 22:00 → 08:00)
  return nowMins >= startMins || nowMins < endMins;
}
