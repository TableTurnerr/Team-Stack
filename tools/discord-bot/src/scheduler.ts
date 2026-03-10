import cron from 'node-cron';
import { Client } from 'discord.js';
import { checkDueFollowUps, checkOverdueFollowUps } from './notifications/follow-ups';

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MINUTES ?? '5', 10);

export function startScheduler(client: Client): void {
  // Due follow-ups — runs every POLL_INTERVAL_MINUTES minutes
  const dueExpression = `*/${POLL_INTERVAL} * * * *`;
  cron.schedule(dueExpression, () => {
    checkDueFollowUps(client).catch((err) =>
      console.error('[scheduler] Unhandled error in checkDueFollowUps:', err)
    );
  });
  console.log(`[scheduler] Due follow-ups job scheduled: ${dueExpression}`);

  // Overdue follow-ups — runs every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    checkOverdueFollowUps(client).catch((err) =>
      console.error('[scheduler] Unhandled error in checkOverdueFollowUps:', err)
    );
  });
  console.log('[scheduler] Overdue follow-ups job scheduled: every 30 minutes');
}
