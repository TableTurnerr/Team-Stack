import { Client, TextChannel } from 'discord.js';
import { pb, withAuth } from '../pb';
import { buildFollowUpEmbed, FollowUpRecord, TimezoneEntry } from '../embeds/follow-up';

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MINUTES ?? '5', 10);
const FOLLOW_UP_CHANNEL_ID = '1478787441513992273';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserTimezoneInfo {
  localTimezone?: string;
  savedTimezones: TimezoneEntry[];
}

async function getUserTimezoneInfo(userId: string): Promise<UserTimezoneInfo> {
  try {
    const result = await withAuth(() =>
      pb.collection('user_preferences').getFirstListItem(`user="${userId}"`)
    );
    const savedTimezones = Array.isArray(result.timezones) ? result.timezones as TimezoneEntry[] : [];
    const workflow = result.workflow_preferences as { cold_calling_timezone?: string } | undefined;
    const localTimezone = workflow?.cold_calling_timezone;
    return { localTimezone, savedTimezones };
  } catch {
    return { savedTimezones: [] };
  }
}

async function processRecord(
  client: Client,
  record: any,
  overdue: boolean
): Promise<void> {
  try {
    const user = record.expand?.assigned_to;
    const discordUserId: string = user?.discord_user_id ?? '';
    const userName: string = user?.name ?? 'Unassigned';

    // Fetch the user's local timezone and saved timezones
    const tzInfo = user?.id ? await getUserTimezoneInfo(user.id) : { savedTimezones: [] };

    const embed = buildFollowUpEmbed(
      record as FollowUpRecord,
      overdue,
      userName,
      discordUserId,
      tzInfo.localTimezone,
      tzInfo.savedTimezones
    );

    // Send to the follow-ups channel
    const channel = await client.channels.fetch(FOLLOW_UP_CHANNEL_ID);
    if (!channel || !(channel instanceof TextChannel)) {
      console.error(`[follow-ups] Could not fetch channel ${FOLLOW_UP_CHANNEL_ID}`);
      return;
    }

    // Mention the assigned user if they have a discord ID
    const mentionContent = discordUserId.trim() ? `<@${discordUserId}>` : undefined;
    await channel.send({ content: mentionContent, embeds: [embed] });
    console.log(`[follow-ups] Sent to channel for ${userName} — record ${record.id}`);

    // Mark the record so we don't notify again
    const patch = overdue ? { overdue_notified: true } : { reminder_sent: true };
    await withAuth(() => pb.collection('follow_ups').update(record.id, patch));
    console.log(`[follow-ups] Marked record ${record.id} — ${JSON.stringify(patch)}`);
  } catch (err: any) {
    console.error(`[follow-ups] Error processing record ${record.id}: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Cron job: due follow-ups
// ---------------------------------------------------------------------------

export async function checkDueFollowUps(client: Client): Promise<number> {
  console.log('[follow-ups] Checking due follow-ups...');

  const now        = new Date();
  const windowStart = new Date(now.getTime() - POLL_INTERVAL * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + POLL_INTERVAL * 60 * 1000);

  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

  try {
    const records = await withAuth(() =>
      pb.collection('follow_ups').getFullList({
        filter: `status = "pending" && reminder_sent = false && scheduled_time >= "${fmt(windowStart)}" && scheduled_time <= "${fmt(windowEnd)}"`,
        expand: 'assigned_to,company',
      })
    );

    console.log(`[follow-ups] Found ${records.length} due follow-up(s).`);
    for (const record of records) {
      await processRecord(client, record, false);
    }
    return records.length;
  } catch (err: any) {
    console.error(`[follow-ups] checkDueFollowUps error: ${err?.message ?? err}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Cron job: overdue follow-ups
// ---------------------------------------------------------------------------

export async function checkOverdueFollowUps(client: Client): Promise<number> {
  console.log('[follow-ups] Checking overdue follow-ups...');

  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

  try {
    const records = await withAuth(() =>
      pb.collection('follow_ups').getFullList({
        filter: `status = "pending" && overdue_notified = false && scheduled_time < "${fmt(now)}"`,
        expand: 'assigned_to,company',
      })
    );

    console.log(`[follow-ups] Found ${records.length} overdue follow-up(s).`);
    for (const record of records) {
      await processRecord(client, record, true);
    }
    return records.length;
  } catch (err: any) {
    console.error(`[follow-ups] checkOverdueFollowUps error: ${err?.message ?? err}`);
    return 0;
  }
}
