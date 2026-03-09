import { Client, EmbedBuilder } from 'discord.js';

/**
 * Fetches a Discord user by ID and sends them a DM embed.
 * Logs and swallows errors so a single failure never crashes the cron job.
 */
export async function sendDM(
  client: Client,
  discordUserId: string,
  embed: EmbedBuilder
): Promise<void> {
  try {
    const user = await client.users.fetch(discordUserId);
    const dm   = await user.createDM();
    await dm.send({ embeds: [embed] });
    console.log(`[DM] Sent to ${user.tag} (${discordUserId})`);
  } catch (err: any) {
    // Common causes: user closed DMs, bot doesn't share a server with them, invalid ID
    console.error(`[DM] Failed to send DM to user ${discordUserId}: ${err?.message ?? err}`);
  }
}
