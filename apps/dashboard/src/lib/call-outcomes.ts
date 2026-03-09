/**
 * Shared call outcome / company status configuration.
 *
 * Call outcomes and company statuses are the SAME set of options.
 * A company's status is the combined set of the last call outcome(s) for each
 * of its phone numbers.
 */

// ─── Built-in outcomes ───────────────────────────────────────────────────────

export const DEFAULT_OUTCOMES = [
  'Interested',
  'Not Interested',
  'Callback',
  'No Answer',
  'Fumbled',
  'Bad Lead',
  'Send Email',
  'Hung Up (Rude Recep)',
  'Hung Up (Other)',
  'Missed Call',
] as const;

/** The quick-select pills shown on the call form (before "Hung Up" split button) */
export const FORM_OUTCOMES = [
  'Interested',
  'Not Interested',
  'Callback',
  'No Answer',
  'Fumbled',
  'Bad Lead',
  'Send Email',
  'Other +',
] as const;

export const HUNG_UP_PRIMARY = 'Hung Up (Rude Recep)' as const;
export const HUNG_UP_OTHER = 'Hung Up (Other)' as const;

export const CALLBACK_REASONS = [
  'Callback (Recep hung up)',
  'Callback (Owner hung up)',
  'Callback (Audio Issue)',
  'Callback (Other)',
] as const;

export type CallbackReason = typeof CALLBACK_REASONS[number];

export const MAX_OUTCOMES = 3;
export const NO_ANSWER = 'No Answer';

// ─── Colors (shared across all pages) ────────────────────────────────────────

export const OUTCOME_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Interested':          { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]',   border: 'border-[var(--success)]'   },
  'Not Interested':      { bg: 'bg-[var(--error-subtle)]',   text: 'text-[var(--error)]',     border: 'border-[var(--error)]'     },
  'Callback':            { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]',   border: 'border-[var(--warning)]'   },
  'No Answer':           { bg: 'bg-[var(--card-hover)]',     text: 'text-[var(--muted)]',     border: 'border-[var(--muted)]'     },
  'Fumbled':             { bg: 'bg-orange-500/10',           text: 'text-orange-500',         border: 'border-orange-500'         },
  'Bad Lead':            { bg: 'bg-red-900/20',              text: 'text-red-400',            border: 'border-red-400'            },
  'Send Email':          { bg: 'bg-blue-500/10',             text: 'text-blue-400',           border: 'border-blue-400'           },
  'Other +':             { bg: 'bg-[var(--info-subtle)]',    text: 'text-[var(--info)]',      border: 'border-[var(--info)]'      },
  'Hung Up (Rude Recep)':{ bg: 'bg-red-500/10',             text: 'text-red-500',            border: 'border-red-500'            },
  'Hung Up (Other)':     { bg: 'bg-red-400/10',             text: 'text-red-400',            border: 'border-red-400'            },
  'Missed Call':         { bg: 'bg-[var(--card-hover)]',     text: 'text-[var(--muted)]',     border: 'border-[var(--muted)]'     },
  'Untouched':           { bg: 'bg-slate-500/10',            text: 'text-slate-400',          border: 'border-slate-400'          },
};

/** Get colors for any outcome, falling back to a neutral style for custom outcomes */
export function getOutcomeColors(outcome: string): { bg: string; text: string; border: string } {
  return OUTCOME_COLORS[outcome] || {
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    border: 'border-purple-400',
  };
}

// ─── Company status helpers ──────────────────────────────────────────────────

/**
 * Compute a company's statuses from its call logs.
 * Groups call logs by phone_number_record, takes the latest call per phone,
 * and returns the union of all their call_outcome arrays (deduplicated).
 */
export function computeCompanyStatuses(callLogs: Array<{
  phone_number_record: string;
  call_time: string;
  call_outcome?: string[];
}>): string[] {
  if (!callLogs.length) return [];

  // Group by phone number record
  const byPhone = new Map<string, typeof callLogs[0]>();
  for (const log of callLogs) {
    const phoneId = log.phone_number_record;
    if (!phoneId) continue;
    const existing = byPhone.get(phoneId);
    if (!existing || new Date(log.call_time) > new Date(existing.call_time)) {
      byPhone.set(phoneId, log);
    }
  }

  // Collect unique outcomes from last call per phone
  const statuses = new Set<string>();
  for (const log of byPhone.values()) {
    const outcomes = log.call_outcome;
    if (outcomes && Array.isArray(outcomes)) {
      for (const o of outcomes) {
        statuses.add(o);
      }
    }
  }

  return [...statuses];
}
