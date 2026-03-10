import { Message, TextChannel, DMChannel, PartialDMChannel, SendableChannels } from 'discord.js';

/**
 * Handles the /clear <count> command.
 *
 * - In DM channels: deletes the bot's own messages (bots cannot delete user DMs).
 * - In guild channels: bulk-deletes all messages (requires Manage Messages permission).
 *
 * Usage: /clear 10
 */
export async function handleClear(message: Message): Promise<void> {
  const args = message.content.trim().split(/\s+/);
  const count = parseInt(args[1], 10);

  const channel = message.channel as SendableChannels;

  if (isNaN(count) || count < 1 || count > 100) {
    const msg = await channel.send('Usage: `/clear <number>` — number must be between 1 and 100.');
    setTimeout(() => msg.delete().catch(() => {}), 5000);
    return;
  }

  try {
    if (message.channel.isDMBased()) {
      // DMs: can only delete the bot's own messages
      const dm = channel as DMChannel | PartialDMChannel;
      const fetched = await dm.messages.fetch({ limit: 100 });

      const botMessages = fetched
        .filter((m) => m.author.id === message.client.user!.id)
        .first(count);

      if (botMessages.length === 0) {
        const msg = await channel.send('No bot messages found to delete.');
        setTimeout(() => msg.delete().catch(() => {}), 5000);
        return;
      }

      await Promise.all(botMessages.map((m) => m.delete()));
      const confirmation = await channel.send(
        `Deleted ${botMessages.length} bot message${botMessages.length !== 1 ? 's' : ''}.`
      );
      setTimeout(() => confirmation.delete().catch(() => {}), 5000);
    } else {
      // Guild channel: bulk delete (messages must be < 14 days old)
      const guildChannel = channel as TextChannel;
      const fetched = await guildChannel.messages.fetch({ limit: count });
      const deleted = await guildChannel.bulkDelete(fetched, true);

      const confirmation = await channel.send(
        `Deleted ${deleted.size} message${deleted.size !== 1 ? 's' : ''}.`
      );
      setTimeout(() => confirmation.delete().catch(() => {}), 5000);
    }
  } catch (err: any) {
    console.error('[Clear] Failed to delete messages:', err?.message ?? err);
    await channel.send('Failed to delete messages. Check bot permissions.').catch(() => {});
  }
}
