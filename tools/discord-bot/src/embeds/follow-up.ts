import { EmbedBuilder } from 'discord.js';

const COLOR_DUE      = 0x5865F2; // Discord blurple
const COLOR_OVERDUE  = 0xFEE75C; // Yellow

export interface FollowUpRecord {
  id: string;
  scheduled_time: string;
  notes?: string;
  expand?: {
    assigned_to?: { name?: string };
    company?:     { company_name?: string };
  };
}

/**
 * Builds a Discord embed for a follow-up notification.
 * @param record   The follow_ups PocketBase record (with expansions)
 * @param overdue  true → overdue style, false → due-now reminder style
 */
export function buildFollowUpEmbed(record: FollowUpRecord, overdue: boolean): EmbedBuilder {
  const companyName = record.expand?.company?.company_name ?? 'Unknown Company';
  const scheduledAt = new Date(record.scheduled_time);
  const crmBaseUrl  = process.env.CRM_BASE_URL?.replace(/\/$/, '') ?? '';
  const crmLink     = crmBaseUrl ? `${crmBaseUrl}/follow-ups/${record.id}` : null;

  const embed = new EmbedBuilder()
    .setColor(overdue ? COLOR_OVERDUE : COLOR_DUE)
    .setTitle(overdue ? '⚠️ Overdue Follow-up' : '🔔 Follow-up Reminder')
    .setDescription(
      overdue
        ? `Your follow-up with **${companyName}** is overdue.`
        : `You have a follow-up with **${companyName}** due now.`
    )
    .addFields(
      { name: 'Company',        value: companyName,                              inline: true  },
      { name: 'Scheduled Time', value: scheduledAt.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),                                                                        inline: true  }
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
