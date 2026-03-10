import { Message, EmbedBuilder, SendableChannels } from 'discord.js';
import { pb, withAuth } from '../pb';

// ─── Helpers ────────────────────────────────────────────────────────────────

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function fmt(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Resolve a Discord @mention or plain name to a PocketBase user record.
 * Accepts: <@123456789>, a discord user ID, or a name search string.
 */
async function resolveUser(mention: string): Promise<any | null> {
  // Discord mention format: <@123456789> or <@!123456789>
  const mentionMatch = mention.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    const discordId = mentionMatch[1];
    try {
      return await withAuth(() =>
        pb.collection('users').getFirstListItem(`discord_user_id="${discordId}"`)
      );
    } catch {
      return null;
    }
  }

  // Raw Discord ID (all digits)
  if (/^\d{17,20}$/.test(mention)) {
    try {
      return await withAuth(() =>
        pb.collection('users').getFirstListItem(`discord_user_id="${mention}"`)
      );
    } catch {
      return null;
    }
  }

  // Name-based search (case-insensitive)
  try {
    return await withAuth(() =>
      pb.collection('users').getFirstListItem(`name~"${mention}"`)
    );
  } catch {
    return null;
  }
}

function buildFollowUpsListEmbed(
  records: any[],
  title: string,
  description: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Tableturnerr CRM' })
    .setTimestamp(new Date());

  if (records.length === 0) {
    embed.setDescription(`${description}\n\nNo follow-ups found.`);
    return embed;
  }

  const crmBaseUrl = process.env.CRM_BASE_URL?.replace(/\/$/, '') ?? '';

  // Show up to 15 follow-ups in the embed
  const shown = records.slice(0, 15);
  for (const r of shown) {
    const company = r.expand?.company?.company_name ?? 'Unknown';
    const assignee = r.expand?.assigned_to?.name ?? 'Unassigned';
    const time = formatTime(r.scheduled_time);
    const status = r.status.toUpperCase();
    const notes = r.notes?.trim() ? `\n> ${r.notes.trim().slice(0, 80)}` : '';
    const link = crmBaseUrl ? ` — [Open](${crmBaseUrl}/follow-ups/${r.id})` : '';

    embed.addFields({
      name: `${company}`,
      value: `**Assigned:** ${assignee} | **Time:** ${time} | **Status:** ${status}${notes}${link}`,
      inline: false,
    });
  }

  if (records.length > 15) {
    embed.addFields({
      name: '\u200b',
      value: `_...and ${records.length - 15} more_`,
      inline: false,
    });
  }

  return embed;
}

// ─── Time-range parser ──────────────────────────────────────────────────────

/**
 * Parse a duration string like "30m", "2h", "1h30m" into milliseconds.
 * Returns null if parsing fails.
 */
function parseDuration(input: string): number | null {
  const match = input.match(/^(?:(\d+)h)?(?:(\d+)m)?$/i);
  if (!match || (!match[1] && !match[2])) return null;

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  return (hours * 60 + minutes) * 60 * 1000;
}

// ─── Sub-commands ───────────────────────────────────────────────────────────

async function handleToday(
  channel: SendableChannels,
  userFilter?: string
): Promise<void> {
  const now = new Date();
  const dayStart = fmt(startOfDay(now));
  const dayEnd = fmt(endOfDay(now));

  let filter = `scheduled_time >= "${dayStart}" && scheduled_time <= "${dayEnd}"`;
  let titleSuffix = 'Everyone';

  if (userFilter) {
    const user = await resolveUser(userFilter);
    if (!user) {
      await channel.send(`Could not find a user matching **${userFilter}**.`);
      return;
    }
    filter += ` && assigned_to = "${user.id}"`;
    titleSuffix = user.name;
  }

  const records = await withAuth(() =>
    pb.collection('follow_ups').getFullList({
      filter,
      sort: 'scheduled_time',
      expand: 'assigned_to,company',
    })
  );

  const embed = buildFollowUpsListEmbed(
    records,
    `Follow-ups Today — ${titleSuffix}`,
    `Showing all follow-ups for **${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })}**`
  );

  await channel.send({ embeds: [embed] });
}

async function handleNext(
  channel: SendableChannels,
  durationStr: string,
  userFilter?: string
): Promise<void> {
  const ms = parseDuration(durationStr);
  if (!ms) {
    await channel.send(
      `Invalid duration **${durationStr}**. Use formats like \`30m\`, \`2h\`, or \`1h30m\`.`
    );
    return;
  }

  const now = new Date();
  const future = new Date(now.getTime() + ms);

  let filter = `status = "pending" && scheduled_time >= "${fmt(now)}" && scheduled_time <= "${fmt(future)}"`;
  let titleSuffix = 'Everyone';

  if (userFilter) {
    const user = await resolveUser(userFilter);
    if (!user) {
      await channel.send(`Could not find a user matching **${userFilter}**.`);
      return;
    }
    filter += ` && assigned_to = "${user.id}"`;
    titleSuffix = user.name;
  }

  const records = await withAuth(() =>
    pb.collection('follow_ups').getFullList({
      filter,
      sort: 'scheduled_time',
      expand: 'assigned_to,company',
    })
  );

  const embed = buildFollowUpsListEmbed(
    records,
    `Follow-ups — Next ${durationStr} — ${titleSuffix}`,
    `Showing pending follow-ups from now to **${formatTime(future.toISOString())}**`
  );

  await channel.send({ embeds: [embed] });
}

async function handleOverdue(
  channel: SendableChannels,
  userFilter?: string
): Promise<void> {
  const now = new Date();

  let filter = `status = "pending" && scheduled_time < "${fmt(now)}"`;
  let titleSuffix = 'Everyone';

  if (userFilter) {
    const user = await resolveUser(userFilter);
    if (!user) {
      await channel.send(`Could not find a user matching **${userFilter}**.`);
      return;
    }
    filter += ` && assigned_to = "${user.id}"`;
    titleSuffix = user.name;
  }

  const records = await withAuth(() =>
    pb.collection('follow_ups').getFullList({
      filter,
      sort: '-scheduled_time',
      expand: 'assigned_to,company',
    })
  );

  const embed = buildFollowUpsListEmbed(
    records,
    `Overdue Follow-ups — ${titleSuffix}`,
    `Showing all pending follow-ups past their scheduled time`
  );

  await channel.send({ embeds: [embed] });
}

async function handleAll(
  channel: SendableChannels,
  userFilter?: string
): Promise<void> {
  let filter = `status = "pending"`;
  let titleSuffix = 'Everyone';

  if (userFilter) {
    const user = await resolveUser(userFilter);
    if (!user) {
      await channel.send(`Could not find a user matching **${userFilter}**.`);
      return;
    }
    filter += ` && assigned_to = "${user.id}"`;
    titleSuffix = user.name;
  }

  const records = await withAuth(() =>
    pb.collection('follow_ups').getFullList({
      filter,
      sort: 'scheduled_time',
      expand: 'assigned_to,company',
    })
  );

  const embed = buildFollowUpsListEmbed(
    records,
    `All Pending Follow-ups — ${titleSuffix}`,
    `Showing all pending follow-ups`
  );

  await channel.send({ embeds: [embed] });
}

// ─── Main handler ───────────────────────────────────────────────────────────

/**
 * /followups today [@user]
 * /followups next <duration> [@user]
 * /followups overdue [@user]
 * /followups all [@user]
 */
export async function handleFollowups(message: Message): Promise<void> {
  const channel = message.channel as SendableChannels;
  const args = message.content.trim().split(/\s+/).slice(1); // remove "/followups"
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    await channel.send(
      'Usage: `/followups <today|next|overdue|all> [user]`\nType `/help followups` for details.'
    );
    return;
  }

  try {
    switch (subcommand) {
      case 'today':
        await handleToday(channel, args.slice(1).join(' ') || undefined);
        break;

      case 'next': {
        const duration = args[1];
        if (!duration) {
          await channel.send('Usage: `/followups next <duration> [user]` — e.g. `/followups next 30m`');
          return;
        }
        await handleNext(channel, duration, args.slice(2).join(' ') || undefined);
        break;
      }

      case 'overdue':
        await handleOverdue(channel, args.slice(1).join(' ') || undefined);
        break;

      case 'all':
        await handleAll(channel, args.slice(1).join(' ') || undefined);
        break;

      default:
        await channel.send(
          `Unknown subcommand **${subcommand}**. Use: \`today\`, \`next\`, \`overdue\`, or \`all\`.`
        );
    }
  } catch (err: any) {
    console.error(`[followups] Command error:`, err?.message ?? err);
    await channel.send('Something went wrong fetching follow-ups. Check bot logs.').catch(() => {});
  }
}
