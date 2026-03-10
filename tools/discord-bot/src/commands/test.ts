import { Message, TextChannel, SendableChannels } from 'discord.js';
import { checkDueFollowUps, checkOverdueFollowUps } from '../notifications/follow-ups';
import { buildFollowUpEmbed, FollowUpRecord, TimezoneEntry } from '../embeds/follow-up';
import { pb, withAuth } from '../pb';

const FOLLOW_UP_CHANNEL_ID = '1478787441513992273';

const SAMPLE_TIMEZONES: TimezoneEntry[] = [
  { timezone: 'America/New_York', label: 'EST' },
  { timezone: 'America/Los_Angeles', label: 'PST' },
  { timezone: 'UTC', label: 'UTC' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildSampleRecord(): FollowUpRecord {
  return {
    id: 'test_000000000000000',
    scheduled_time: new Date().toISOString(),
    client_timezone: 'America/New_York',
    notes: 'This is a test follow-up notification. No real record was affected.',
    expand: {
      assigned_to: { name: 'Test User' },
      company: { company_name: 'Acme Corp' },
    },
  };
}

async function getFollowUpChannel(client: Message['client']): Promise<TextChannel | null> {
  try {
    const ch = await client.channels.fetch(FOLLOW_UP_CHANNEL_ID);
    if (ch instanceof TextChannel) return ch;
  } catch {}
  return null;
}

interface CallerTimezoneInfo {
  localTimezone?: string;
  savedTimezones: TimezoneEntry[];
}

/**
 * Look up the caller's PB user by discord_user_id and fetch their timezone info.
 */
async function getCallerTimezoneInfo(discordUserId: string): Promise<CallerTimezoneInfo> {
  try {
    const user = await withAuth(() =>
      pb.collection('users').getFirstListItem(`discord_user_id="${discordUserId}"`)
    );
    const prefs = await withAuth(() =>
      pb.collection('user_preferences').getFirstListItem(`user="${user.id}"`)
    );
    const savedTimezones = Array.isArray(prefs.timezones) ? prefs.timezones as TimezoneEntry[] : [];
    const workflow = prefs.workflow_preferences as { cold_calling_timezone?: string } | undefined;
    const localTimezone = workflow?.cold_calling_timezone;
    return {
      localTimezone,
      savedTimezones: savedTimezones.length > 0 ? savedTimezones : SAMPLE_TIMEZONES,
    };
  } catch {
    return { localTimezone: 'America/New_York', savedTimezones: SAMPLE_TIMEZONES };
  }
}

// ─── Sub-commands ───────────────────────────────────────────────────────────

async function handleTestDue(channel: SendableChannels, message: Message): Promise<void> {
  await channel.send('Triggering **due follow-ups** check...');
  const count = await checkDueFollowUps(message.client);
  if (count > 0) {
    await channel.send(`Sent **${count}** due notification(s) to <#${FOLLOW_UP_CHANNEL_ID}>.`);
  } else {
    await channel.send(
      'No due follow-ups found. The due check looks for pending records with `reminder_sent = false` ' +
        'whose `scheduled_time` is within ±5 minutes of now.\n' +
        'Try `/test fake` to send a fake notification instead.'
    );
  }
}

async function handleTestOverdue(channel: SendableChannels, message: Message): Promise<void> {
  await channel.send('Triggering **overdue follow-ups** check...');
  const count = await checkOverdueFollowUps(message.client);
  if (count > 0) {
    await channel.send(`Sent **${count}** overdue notification(s) to <#${FOLLOW_UP_CHANNEL_ID}>.`);
  } else {
    await channel.send(
      'No overdue follow-ups found. The overdue check looks for pending records with `overdue_notified = false` ' +
        'whose `scheduled_time` is in the past.\n' +
        'Try `/test fake overdue` to send a fake notification instead.'
    );
  }
}

async function handleTestEmbed(channel: SendableChannels, overdue: boolean): Promise<void> {
  const label = overdue ? 'overdue' : 'due';
  const embed = buildFollowUpEmbed(buildSampleRecord(), overdue, 'Test User', '', 'America/New_York', SAMPLE_TIMEZONES);
  await channel.send({ content: `Sample **${label}** follow-up embed:`, embeds: [embed] });
}

async function handleTestFake(message: Message, overdue: boolean): Promise<void> {
  const channel = message.channel as SendableChannels;
  const targetChannel = await getFollowUpChannel(message.client);

  if (!targetChannel) {
    await channel.send(`Could not fetch text channel \`${FOLLOW_UP_CHANNEL_ID}\`.`);
    return;
  }

  // Fetch the caller's actual timezone info from their profile
  const tzInfo = await getCallerTimezoneInfo(message.author.id);

  const label = overdue ? 'overdue' : 'due';
  const record = buildSampleRecord();
  const embed = buildFollowUpEmbed(record, overdue, message.author.username, message.author.id, tzInfo.localTimezone, tzInfo.savedTimezones);

  await targetChannel.send({
    content: `<@${message.author.id}>`,
    embeds: [embed],
  });

  await channel.send(`Sent a fake **${label}** notification to <#${FOLLOW_UP_CHANNEL_ID}> (with your @mention and timezones).`);
}

async function handleTestChannel(message: Message): Promise<void> {
  const channel = message.channel as SendableChannels;
  const targetChannel = await getFollowUpChannel(message.client);

  if (!targetChannel) {
    await channel.send(`Could not fetch text channel \`${FOLLOW_UP_CHANNEL_ID}\`.`);
    return;
  }

  const embed = buildFollowUpEmbed(buildSampleRecord(), false, 'Test User', '', 'America/New_York', SAMPLE_TIMEZONES);
  await targetChannel.send({ content: 'Test notification from `/test channel`:', embeds: [embed] });
  await channel.send(`Sent a test embed to <#${FOLLOW_UP_CHANNEL_ID}>.`);
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handleTest(message: Message): Promise<void> {
  const channel = message.channel as SendableChannels;
  const args = message.content.trim().split(/\s+/).slice(1);
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    await channel.send(
      '**Usage:** `/test <due|overdue|embed|fake|channel>`\n' +
        '`/test due` — Trigger the due follow-ups cron job\n' +
        '`/test overdue` — Trigger the overdue follow-ups cron job\n' +
        '`/test embed` — Preview a sample due embed here\n' +
        '`/test embed overdue` — Preview a sample overdue embed here\n' +
        '`/test fake` — Send a fake due notification to the follow-ups channel (with your @mention)\n' +
        '`/test fake overdue` — Send a fake overdue notification to the follow-ups channel\n' +
        '`/test channel` — Send a test embed to the follow-ups channel'
    );
    return;
  }

  try {
    switch (subcommand) {
      case 'due':
        await handleTestDue(channel, message);
        break;

      case 'overdue':
        await handleTestOverdue(channel, message);
        break;

      case 'embed': {
        const isOverdue = args[1]?.toLowerCase() === 'overdue';
        await handleTestEmbed(channel, isOverdue);
        break;
      }

      case 'fake': {
        const isOverdue = args[1]?.toLowerCase() === 'overdue';
        await handleTestFake(message, isOverdue);
        break;
      }

      case 'channel':
        await handleTestChannel(message);
        break;

      default:
        await channel.send(
          `Unknown test subcommand **${subcommand}**. Use: \`due\`, \`overdue\`, \`embed\`, \`fake\`, or \`channel\`.`
        );
    }
  } catch (err: any) {
    console.error('[test] Command error:', err?.message ?? err);
    await channel.send('Something went wrong. Check bot logs.').catch(() => {});
  }
}
