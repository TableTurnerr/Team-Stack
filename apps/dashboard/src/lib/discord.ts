// ============================================================================
// Discord Webhook Utility
// ============================================================================

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  content?: string;
  username?: string;
  embeds?: DiscordEmbed[];
}

// Brand color for embeds
const COLORS = {
  primary: 0x5865f2,   // Discord blurple (default)
  success: 0x57f287,   // Green
  warning: 0xfee75c,   // Yellow
  error: 0xed4245,     // Red
  info: 0x5865f2,      // Blue/blurple
};

/**
 * Sends a raw payload to a Discord webhook URL.
 * Webhooks natively support CORS so this can be called from the browser.
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    return { ok: false, error: 'Invalid Discord webhook URL' };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Tableturnerr CRM', ...payload }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ============================================================================
// Formatted message builders
// ============================================================================

export interface FollowUpNotificationOptions {
  companyName: string;
  scheduledTime: string;   // ISO string
  assignedTo?: string;
  notes?: string;
  isOverdue?: boolean;
  crmUrl?: string;
}

export function buildFollowUpEmbed(opts: FollowUpNotificationOptions): DiscordWebhookPayload {
  const when = new Date(opts.scheduledTime);
  const timeStr = when.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const fields: DiscordEmbed['fields'] = [
    { name: 'Company', value: opts.companyName, inline: true },
    { name: 'Scheduled', value: timeStr, inline: true },
  ];

  if (opts.assignedTo) {
    fields.push({ name: 'Assigned To', value: opts.assignedTo, inline: true });
  }
  if (opts.notes) {
    fields.push({ name: 'Notes', value: opts.notes.slice(0, 200), inline: false });
  }
  if (opts.crmUrl) {
    fields.push({ name: 'Open in CRM', value: opts.crmUrl, inline: false });
  }

  return {
    embeds: [{
      title: opts.isOverdue
        ? '⚠️ Overdue Follow-up'
        : '🔔 Follow-up Reminder',
      description: opts.isOverdue
        ? `Follow-up with **${opts.companyName}** was due and hasn't been completed.`
        : `You have a follow-up with **${opts.companyName}** coming up.`,
      color: opts.isOverdue ? COLORS.warning : COLORS.primary,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Tableturnerr CRM' },
    }],
  };
}

export interface NewFollowUpOptions {
  companyName: string;
  scheduledTime: string;
  createdBy: string;
  assignedTo?: string;
  notes?: string;
  crmUrl?: string;
}

export function buildNewFollowUpEmbed(opts: NewFollowUpOptions): DiscordWebhookPayload {
  const when = new Date(opts.scheduledTime);
  const timeStr = when.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const fields: DiscordEmbed['fields'] = [
    { name: 'Company', value: opts.companyName, inline: true },
    { name: 'Scheduled', value: timeStr, inline: true },
    { name: 'Created By', value: opts.createdBy, inline: true },
  ];

  if (opts.assignedTo) {
    fields.push({ name: 'Assigned To', value: opts.assignedTo, inline: true });
  }
  if (opts.notes) {
    fields.push({ name: 'Notes', value: opts.notes.slice(0, 200), inline: false });
  }
  if (opts.crmUrl) {
    fields.push({ name: 'Open in CRM', value: opts.crmUrl, inline: false });
  }

  return {
    embeds: [{
      title: '📅 New Follow-up Scheduled',
      description: `**${opts.createdBy}** scheduled a follow-up with **${opts.companyName}**.`,
      color: COLORS.success,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Tableturnerr CRM' },
    }],
  };
}

export interface AlertNotificationOptions {
  message: string;
  entityType?: string;
  entityLabel?: string;
  createdBy?: string;
  crmUrl?: string;
}

export function buildAlertEmbed(opts: AlertNotificationOptions): DiscordWebhookPayload {
  const fields: DiscordEmbed['fields'] = [];

  if (opts.entityType && opts.entityLabel) {
    fields.push({ name: opts.entityType, value: opts.entityLabel, inline: true });
  }
  if (opts.createdBy) {
    fields.push({ name: 'From', value: opts.createdBy, inline: true });
  }
  if (opts.crmUrl) {
    fields.push({ name: 'Open in CRM', value: opts.crmUrl, inline: false });
  }

  return {
    embeds: [{
      title: '🔔 CRM Alert',
      description: opts.message,
      color: COLORS.info,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Tableturnerr CRM' },
    }],
  };
}

export function buildTestEmbed(): DiscordWebhookPayload {
  return {
    embeds: [{
      title: '✅ Webhook Connected',
      description: 'Your Discord webhook is configured correctly. You will receive CRM notifications here.',
      color: COLORS.success,
      fields: [
        { name: 'Source', value: 'Tableturnerr CRM', inline: true },
        { name: 'Status', value: 'Active', inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Tableturnerr CRM' },
    }],
  };
}

export function buildTeamTestEmbed(channelPurpose: string): DiscordWebhookPayload {
  return {
    embeds: [{
      title: '✅ Team Webhook Connected',
      description: `This channel is now configured to receive **${channelPurpose}** notifications from Tableturnerr CRM.`,
      color: COLORS.success,
      timestamp: new Date().toISOString(),
      footer: { text: 'Tableturnerr CRM' },
    }],
  };
}
