import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { authAdmin } from './pb';
import { startScheduler } from './scheduler';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
  throw new Error('DISCORD_BOT_TOKEN is not set in environment variables.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
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
