import 'dotenv/config';
import { Client, GatewayIntentBits, Message } from 'discord.js';
import { authAdmin } from './pb';
import { startScheduler } from './scheduler';
import { handleClear } from './commands/clear';
import { handleFollowups } from './commands/followups';
import { handleHelp } from './commands/help';
import { handleTest } from './commands/test';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN is not set in environment variables.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', async (readyClient) => {
  console.log(`[Discord] Logged in as ${readyClient.user.tag}`);

  try {
    await authAdmin();
  } catch (err) {
    console.error('[PocketBase] Failed to authenticate admin on startup:', err);
    process.exit(1);
  }

  startScheduler(client);
  console.log('[Bot] Scheduler started. Bot is running.');
});

client.on('messageCreate', async (message: Message) => {
  // Ignore messages from bots (including self)
  if (message.author.bot) return;

  // Strip bot @mention prefix so "@TableTurnerr help" works like "/help"
  let content = message.content.trim();
  const botId = message.client.user?.id;
  if (botId) {
    const mentionRegex = new RegExp(`^<@!?${botId}>\\s*`);
    if (mentionRegex.test(content)) {
      content = '/' + content.replace(mentionRegex, '').trim();
      // Update message.content so handlers see the normalized command
      message.content = content;
    }
  }

  if (content.startsWith('/help')) {
    await handleHelp(message);
  } else if (content.startsWith('/followups')) {
    await handleFollowups(message);
  } else if (content.startsWith('/clear')) {
    await handleClear(message);
  } else if (content.startsWith('/test')) {
    await handleTest(message);
  }
});

client.on('error', (err) => {
  console.error('[Discord] Client error:', err);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[Bot] Received ${signal} — shutting down...`);
  client.destroy();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(DISCORD_BOT_TOKEN);
