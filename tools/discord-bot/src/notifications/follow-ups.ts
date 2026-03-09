import { Client } from 'discord.js';
import { pb, withAuth } from '../pb';
import { buildFollowUpEmbed, FollowUpRecord } from '../embeds/follow-up';
import { sendDM } from '../utils/send-dm';
import { isInDND, NotificationSettings } from '../utils/dnd';

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MINUTES ?? '5', 10);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getUserPrefs(userId: string): Promise<NotificationSettings> {
  try {
    const result = await withAuth(() =>
      pb.collection('user_preferences').getFirstListItem(`user="${userId}"`)
    );
    return (result.notification_settings as NotificationSettings) ?? {};
  } catch {
    // No preferences record → use defaults (all notifications on, DND off)
    return {};
  }
}

async function processRecord(
  client: Client,
  record: any,
  overdue: boolean
): Promise<void> {
  try {
    const user = record.expand?.assigned_to;
    if (!user) {
      console.warn(`[follow-ups] Record ${record.id} has no expanded assigned_to — skipping.`);
      return;
    }

    const discordUserId: string = user.discord_user_id ?? '';
    if (!discordUserId.trim()) {
      console.log(`[follow-ups] User ${user.id} (${user.name}) has no discord_user_id — skipping.`);
      return;
    }

    const prefs = await getUserPrefs(user.id);

    // Respect the follow_up_reminders toggle (default: true)
    if (prefs.follow_up_reminders === false) {
      console.log(`[follow-ups] User ${user.name} has follow_up_reminders disabled — skipping.`);
      return;
    }

    // Respect DND window
    if (isInDND(prefs)) {
      console.log(`[follow-ups] User ${user.name} is in DND — skipping.`);
      return;
    }

    const embed = buildFollowUpEmbed(record as FollowUpRecord, overdue);
    await sendDM(client, discordUserId, embed);

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

export async function checkDueFollowUps(client: Client): Promise<void> {
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
  } catch (err: any) {
    console.error(`[follow-ups] checkDueFollowUps error: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Cron job: overdue follow-ups
// ---------------------------------------------------------------------------

export async function checkOverdueFollowUps(client: Client): Promise<void> {
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
  } catch (err: any) {
    console.error(`[follow-ups] checkOverdueFollowUps error: ${err?.message ?? err}`);
  }
}
