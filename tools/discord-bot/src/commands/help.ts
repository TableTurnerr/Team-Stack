import { Message, EmbedBuilder, SendableChannels } from 'discord.js';

// ─── Command registry ───────────────────────────────────────────────────────

interface CommandInfo {
  name: string;
  summary: string;
  usage: string;
  examples: string[];
  details: string;
}

const commands: CommandInfo[] = [
  {
    name: 'help',
    summary: 'Show all commands or details about a specific command.',
    usage: '/help [command]',
    examples: ['/help', '/help followups', '/help clear'],
    details:
      'Without arguments, lists all available commands. ' +
      'Pass a command name to see its full usage, examples, and description.',
  },
  {
    name: 'followups',
    summary: 'Check follow-ups — today, upcoming, overdue, or all.',
    usage: '/followups <today|next|overdue|all> [user]',
    examples: [
      '/followups today',
      '/followups today @Nooh Ali',
      '/followups today Nooh',
      '/followups next 30m',
      '/followups next 2h @Nooh Ali',
      '/followups next 1h30m',
      '/followups overdue',
      '/followups overdue Nooh',
      '/followups all',
    ],
    details:
      'Query follow-ups from the CRM database.\n\n' +
      '**Subcommands:**\n' +
      '`today` — All follow-ups scheduled for today.\n' +
      '`next <duration>` — Pending follow-ups within the given time window (e.g. `30m`, `2h`, `1h30m`).\n' +
      '`overdue` — All pending follow-ups past their scheduled time.\n' +
      '`all` — All pending follow-ups regardless of time.\n\n' +
      '**User filter (optional):**\n' +
      'Add a Discord @mention, a Discord user ID, or a name to filter by assignee. ' +
      'Name matching is case-insensitive and partial (e.g. `Nooh` matches `Nooh Ali`).',
  },
  {
    name: 'clear',
    summary: 'Delete messages in the current channel.',
    usage: '/clear <count>',
    examples: ['/clear 5', '/clear 20'],
    details:
      'Deletes messages in the current channel.\n\n' +
      '**In DMs:** Deletes the bot\'s own messages (bots cannot delete user DMs).\n' +
      '**In servers:** Bulk-deletes all messages (requires Manage Messages permission).\n\n' +
      'Count must be between 1 and 100. Messages older than 14 days cannot be bulk-deleted by Discord.',
  },
  {
    name: 'test',
    summary: 'Test follow-up notifications without waiting for the cron job.',
    usage: '/test <due|overdue|embed|fake|channel>',
    examples: [
      '/test due',
      '/test overdue',
      '/test embed',
      '/test embed overdue',
      '/test fake',
      '/test fake overdue',
      '/test channel',
    ],
    details:
      'Manually trigger or preview follow-up notifications.\n\n' +
      '**Subcommands:**\n' +
      '`due` — Run the due follow-ups cron job immediately. Real records will be processed and marked.\n' +
      '`overdue` — Run the overdue follow-ups cron job immediately. Real records will be processed and marked.\n' +
      '`embed` — Preview a sample "due" embed in the current channel (no DB changes).\n' +
      '`embed overdue` — Preview a sample "overdue" embed in the current channel (no DB changes).\n' +
      '`fake` — Send a fake due notification to the follow-ups channel with your @mention (no DB changes).\n' +
      '`fake overdue` — Same as above but with the overdue style.\n' +
      '`channel` — Send a test embed to the follow-ups notification channel to verify connectivity.',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildOverviewEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Tableturnerr Bot — Commands')
    .setDescription('Here are all available commands. Use `/help <command>` for details.')
    .setFooter({ text: 'Tableturnerr CRM' })
    .setTimestamp(new Date());

  for (const cmd of commands) {
    embed.addFields({
      name: `/${cmd.name}`,
      value: cmd.summary,
      inline: false,
    });
  }

  return embed;
}

function buildCommandEmbed(cmd: CommandInfo): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`/${cmd.name}`)
    .setDescription(cmd.details)
    .addFields(
      { name: 'Usage', value: `\`${cmd.usage}\``, inline: false },
      {
        name: 'Examples',
        value: cmd.examples.map((e) => `\`${e}\``).join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: 'Tableturnerr CRM' })
    .setTimestamp(new Date());
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handleHelp(message: Message): Promise<void> {
  const channel = message.channel as SendableChannels;
  const args = message.content.trim().split(/\s+/).slice(1);
  const target = args[0]?.toLowerCase().replace(/^\//, ''); // allow "/help /followups"

  if (!target) {
    await channel.send({ embeds: [buildOverviewEmbed()] });
    return;
  }

  const cmd = commands.find((c) => c.name === target);
  if (!cmd) {
    await channel.send(`Unknown command **${target}**. Type \`/help\` to see all commands.`);
    return;
  }

  await channel.send({ embeds: [buildCommandEmbed(cmd)] });
}
