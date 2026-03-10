import { EmbedBuilder } from 'discord.js';

const COLOR_DUE      = 0x5865F2; // Discord blurple
const COLOR_OVERDUE  = 0xFEE75C; // Yellow

export interface TimezoneEntry {
  timezone: string; // IANA e.g. "America/New_York"
  label: string;    // e.g. "EST"
}

export interface FollowUpRecord {
  id: string;
  scheduled_time: string;
  client_timezone?: string;
  notes?: string;
  expand?: {
    assigned_to?: { name?: string };
    company?:     { company_name?: string };
  };
}

/**
 * Format a date in a specific IANA timezone.
 * Returns e.g. "Mar 11, 2026, 3:30 PM"
 */
function formatInTimezone(date: Date, timezone: string): string {
  try {
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    // Invalid timezone — fall back to UTC
    return date.toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' (UTC)';
  }
}

/**
 * Get the short timezone abbreviation (e.g. "EST", "PST", "UTC") for a given IANA timezone.
 */
function getTimezoneAbbr(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}

/**
 * Build a multi-timezone time display string.
 * Order: assigned user's local timezone first (labeled with their name), then their saved timezones.
 * Duplicates are skipped.
 */
function buildTimezoneDisplay(
  date: Date,
  localTimezone: string | undefined,
  savedTimezones: TimezoneEntry[],
  assignedName: string
): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  // 1. Assigned user's own local timezone always first
  if (localTimezone?.trim()) {
    seen.add(localTimezone);
    const tzAbbr = getTimezoneAbbr(date, localTimezone);
    lines.push(`🏠 **${assignedName}'s Time (${tzAbbr}):** ${formatInTimezone(date, localTimezone)}`);
  }

  // 2. Their saved/monitored timezones
  for (const tz of savedTimezones) {
    if (!seen.has(tz.timezone)) {
      seen.add(tz.timezone);
      lines.push(`**${tz.label}:** ${formatInTimezone(date, tz.timezone)}`);
    }
  }

  // Fallback if nothing at all
  if (lines.length === 0) {
    return formatInTimezone(date, 'UTC') + ' (UTC)';
  }

  return lines.join('\n');
}

/**
 * Builds a Discord embed for a follow-up notification.
 * @param localTimezone  The user's own IANA timezone (from workflow_preferences.cold_calling_timezone)
 * @param savedTimezones The user's saved/monitored timezones list
 */
export function buildFollowUpEmbed(
  record: FollowUpRecord,
  overdue: boolean,
  assignedName?: string,
  discordUserId?: string,
  localTimezone?: string,
  savedTimezones?: TimezoneEntry[]
): EmbedBuilder {
  const companyName = record.expand?.company?.company_name ?? 'Unknown Company';
  const scheduledAt = new Date(record.scheduled_time);
  const crmBaseUrl  = process.env.CRM_BASE_URL?.replace(/\/$/, '') ?? '';
  const crmLink     = crmBaseUrl ? `${crmBaseUrl}/follow-ups/${record.id}` : null;

  const assignedDisplay = discordUserId?.trim()
    ? `<@${discordUserId}>`
    : (assignedName ?? 'Unassigned');

  const timeDisplay = buildTimezoneDisplay(scheduledAt, localTimezone, savedTimezones ?? [], assignedName ?? 'User');

  const embed = new EmbedBuilder()
    .setColor(overdue ? COLOR_OVERDUE : COLOR_DUE)
    .setTitle(overdue ? '⚠️ Overdue Follow-up' : '🔔 Follow-up Reminder')
    .setDescription(
      overdue
        ? `Follow-up with **${companyName}** is overdue.`
        : `Follow-up with **${companyName}** is due now.`
    )
    .addFields(
      { name: 'Assigned To', value: assignedDisplay, inline: true  },
      { name: 'Company',     value: companyName,     inline: true  },
      { name: 'Scheduled Time', value: timeDisplay,  inline: false }
    )
    .setFooter({ text: 'Tableturnerr CRM' })
    .setTimestamp(new Date());

  if (record.notes?.trim()) {
    embed.addFields({ name: 'Notes', value: record.notes.trim(), inline: false });
  }

  if (crmLink) {
    embed.addFields({ name: 'Open in CRM', value: `[View follow-up](${crmLink})`, inline: false });
  }

  return embed;
}
