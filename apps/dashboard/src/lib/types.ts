import type { RecordModel } from 'pocketbase';

// ============================================================================
// Type Definitions
// ============================================================================

export interface User extends RecordModel {
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'member';
  status: 'online' | 'offline' | 'suspended';
  avatar?: string;
  last_activity?: string;
  discord_user_id?: string;
}

export interface Company extends RecordModel {
  company_name: string;
  owner_name?: string;
  company_location?: string;
  google_maps_link?: string;
  source?: string;

  // NEW fields merged from leads
  instagram_handle?: string;
  email?: string;
  status?: string[];
  first_contacted?: string;
  last_contacted?: string;
  notes?: string;
  contact_source?: string;

  // Ratings & Reviews
  google_rating?: string;
  google_reviews_count?: string;

  // Email suppression
  do_not_contact?: boolean;
}



export interface InstaActor extends RecordModel {
  username: string;
  owner: string;
  status: 'Active' | 'Suspended By Team' | 'Suspended By Insta' | 'Discarded';
  last_activity?: string;
  expand?: {
    owner?: User;
  };
}

export interface ColdCall extends RecordModel {
  company?: string;
  caller_name?: string;
  recipients?: string;
  call_outcome?: 'Interested' | 'Not Interested' | 'Callback' | 'No Answer' | 'Fumbled' | 'Other' | 'Hung Up (Rude Recep)' | 'Hung Up (Other)' | 'Bad Lead' | 'Send Email';
  objections?: string[];
  pain_points?: string[];
  follow_up_actions?: string[];
  call_summary?: string;
  call_duration_estimate?: string;
  model_used?: string;
  phone_number?: string;
  owner_name?: string;
  claimed_by?: string;
  expand?: {
    company?: Company;
    claimed_by?: User;
  };
}

export interface CallTranscript extends RecordModel {
  call: string;
  transcript: string;
  expand?: {
    call?: ColdCall;
  };
}

export interface EventLog extends RecordModel {
  event_type: 'Outreach' | 'Change in Tar Info' | 'Tar Exception Toggle' | 'User' | 'System' | 'Cold Call';
  actor?: string;
  user?: string;
  company?: string;           // NEW: Direct company link

  cold_call?: string;
  details?: string;
  source?: string;
  expand?: {
    actor?: InstaActor;
    user?: User;
    company?: Company;        // NEW

    cold_call?: ColdCall;
  };
}

export interface OutreachLog extends RecordModel {
  event: string;
  message_text?: string;
  sent_at?: string;
  expand?: {
    event?: EventLog;
  };
}

export interface Goal extends RecordModel {
  metric: 'Total Messages Sent' | 'Unique Profiles Contacted' | 'Replies Received' | 'Warm Leads Generated' | 'Bookings Made' | 'Payments Received' | 'Calls Made' | 'Calls Transcribed';
  target_value: number;
  frequency: 'Daily' | 'Weekly' | 'Monthly';
  assigned_to_user?: string;
  assigned_to_actor?: string;
  status: 'Active' | 'Pending Suggestion' | 'Rejected' | 'Archived';
  suggested_by?: string;
  start_date?: string;
  end_date?: string;
  expand?: {
    assigned_to_user?: User;
    assigned_to_actor?: InstaActor;
    suggested_by?: User;
  };
}

export interface Rule extends RecordModel {
  type: 'Frequency Cap' | 'Interval Spacing';
  metric: 'Total Messages Sent' | 'Unique Profiles Contacted' | 'Calls Made';
  limit_value: number;
  time_window_sec: number;
  severity?: string;
  assigned_to_user?: string;
  assigned_to_actor?: string;
  status: 'Active' | 'Pending Suggestion' | 'Rejected' | 'Archived';
  suggested_by?: string;
  expand?: {
    assigned_to_user?: User;
    assigned_to_actor?: InstaActor;
    suggested_by?: User;
  };
}

export interface Alert extends RecordModel {
  created_by: string;
  target_user: string;
  entity_type: 'cold_call' | 'company' | 'goal' | 'follow_up';
  entity_id?: string;
  entity_label?: string;
  alert_time?: string;
  message?: string;
  is_dismissed: boolean;
  expand?: {
    created_by?: User;
    target_user?: User;
  };
}

export interface Note extends RecordModel {
  title: string;
  note_text: string;
  created_by: string;
  last_edited_by?: string;
  is_archived: boolean;
  is_deleted: boolean;
  deleted_at?: string;
  expand?: {
    created_by?: User;
    last_edited_by?: User;
  };
}

export interface PhoneNumber extends RecordModel {
  company: string;
  phone_number: string;
  label?: string;
  location_name?: string;
  location_address?: string;
  receptionist_name?: string;
  last_called?: string;
  total_calls?: number;
  /** Soft-delete: set to true to mark as disassociated from the company (requires the field in PocketBase schema) */
  disassociated?: boolean;
  expand?: {
    company?: Company;
  };
}

export interface CallLog extends RecordModel {
  company: string;
  phone_number_record: string;
  caller?: string;
  call_time: string;
  duration?: number; // Total duration (ring_duration + call_duration) in seconds
  ring_duration?: number; // Time spent ringing before pickup (in seconds)
  call_duration?: number; // Time spent on actual call after pickup (in seconds)
  call_outcome?: string[];
  direction?: 'outbound' | 'inbound';
  owner_name_found?: string;
  receptionist_name?: string;
  post_call_notes?: string;
  status_changed_to?: string;
  has_recording?: boolean;
  session?: string; // Optional - null for standalone calls, populated for session-based calls
  cold_call?: string; // Optional link to AI transcript (cold_calls record)
  // Per-call performance tracking (tied to specific calls, aggregated to session level)
  owner_reached?: boolean;
  pitch_completed?: boolean;
  appointment_set?: boolean;
  // Callback tracking: array of {reason, timestamp} for each callback made during this call
  callback_events?: Array<{ reason: string; timestamp: string }>;
  /** True when this call log was created via the callback feature (i.e. it is a re-dial) */
  is_callback?: boolean;
  expand?: {
    company?: Company;
    phone_number_record?: PhoneNumber;
    caller?: User;
    session?: ColdCallingSession;
    cold_call?: ColdCall;
  };
}

export interface ManualAdjustmentChange {
  field: string;
  from: number;
  to: number;
}

export interface ManualAdjustment {
  timestamp: string;
  changes: ManualAdjustmentChange[];
  reason?: string;
}

export interface ColdCallingSession extends RecordModel {
  user: string;
  started_at: string;
  ended_at?: string;
  total_dials: number;
  total_pickups: number;
  total_duration_sec: number;
  owner_reached: number;
  pitch_completed: number;
  appointment_set: number;
  status: 'active' | 'completed';
  session_notes?: string; // Optional notes about the session (e.g., overall observations, issues)
  paused_at?: string; // ISO timestamp set when session is paused, null when resumed
  total_paused_sec: number; // Accumulated pause duration across all pauses (default 0)
  is_test?: boolean; // True for test sessions — all data can be deleted at end of session
  /** Count of call logs with callbacks in this session */
  total_callbacks?: number;
  /** Count of incoming/received calls in this session */
  total_incoming?: number;
  /** History of manual counter adjustments */
  manual_adjustments?: ManualAdjustment[] | null;
  /** Whether the session owner is currently on an active Zoom call */
  on_call?: boolean;
  expand?: {
    user?: User;
  };
}

export interface FollowUp extends RecordModel {
  call_log?: string;
  company: string;
  phone_number_record?: string;
  created_by?: string;
  scheduled_time: string;
  client_timezone: string;
  assigned_to?: string;
  notes?: string;
  status: 'pending' | 'completed' | 'dismissed';
  completed_at?: string;
  expand?: {
    call_log?: CallLog;
    company?: Company;
    phone_number_record?: PhoneNumber;
    assigned_to?: User;
    created_by?: User;
  };
}

export interface CompanyNote extends RecordModel {
  company: string;
  phone_number_record?: string;
  note_type: 'pre_call' | 'research' | 'general';
  content: string;
  created_by: string;
  expand?: {
    company?: Company;
    phone_number_record?: PhoneNumber;
    created_by?: User;
  };
}

export interface Interaction extends RecordModel {
  company: string;
  channel: 'phone' | 'instagram' | 'email';
  direction: 'outbound' | 'inbound';
  timestamp: string;
  user?: string;
  summary?: string;
  call_log?: string;
  expand?: {
    company?: Company;
    user?: User;
    call_log?: CallLog;
  };
}

export interface CustomCallOutcome extends RecordModel {
  name: string;
  created_by?: string;
  expand?: {
    created_by?: User;
  };
}

export interface Recording extends RecordModel {
  phone_number?: string;
  uploader?: string;
  file?: string;
  original_filename?: string;
  note?: string;
  recording_date?: string;
  duration?: number;
  call_log?: string;
  company?: string;
  phone_number_record?: string;
  expand?: {
    uploader?: User;
    call_log?: CallLog;
    company?: Company;
    phone_number_record?: PhoneNumber;
  };
}

export interface UserPreferences extends RecordModel {
  user: string;
  theme?: 'light' | 'dark' | 'system';
  display_density?: 'comfortable' | 'compact';
  timezones?: { timezone: string; label: string }[];
  notification_settings?: {
    follow_up_reminders?: boolean;
    team_activity?: boolean;
    new_recordings?: boolean;
    system_announcements?: boolean;
    daily_digest?: boolean;
    weekly_summary?: boolean;
    new_team_member?: boolean;
    important_updates?: boolean;
    sound_enabled?: boolean;
    dnd_enabled?: boolean;
    dnd_start?: string;
    dnd_end?: string;
    dnd_days?: string[];
  };
  workflow_preferences?: {
    default_page_size?: number;
    default_sort_order?: 'newest' | 'oldest' | 'alphabetical';
    remember_columns?: boolean;
    default_reminder_time?: string;
    default_follow_up_interval?: '1_day' | '3_days' | '1_week';
    auto_follow_up_callback?: boolean;
    default_call_outcome?: string;
    auto_start_recording?: boolean;
    show_transcript_panel?: boolean;
    default_status_filters?: string[];
    expanded_view?: boolean;
    cold_calling_timezone?: string; // IANA timezone string for follow-up scheduling
    // Follow-up notification settings
    followup_window_hours_ahead?: number; // Hours ahead of current time to show follow-ups (default: 8)
    followup_window_hours_behind?: number; // Hours behind current time to show overdue follow-ups (default: 8)
    followup_pre_notification_minutes?: number; // Minutes before scheduled time to send "heads up" notification (default: 0 = disabled)
    followup_sound_enabled?: boolean; // Whether to play sound on follow-up notifications (default: true)
  };
  privacy_settings?: {
    show_online_status?: boolean;
    activity_visibility?: 'team' | 'admins_only';
  };
  /** Persisted power dialer queue + progress, survives across CRM sessions and devices */
  power_dialer_state?: {
    queue: Array<{ number: string; company?: string }>;
    currentIndex: number;
    delay: number;
    autoHangupEnabled: boolean;
    autoHangupSeconds: number;
  } | null;
  expand?: {
    user?: User;
  };
}

// ============================================================================
// Financial Types
// ============================================================================

export type SupportedCurrency = 'USD' | 'PKR' | 'GBP' | 'EUR' | 'AED' | 'CAD' | 'AUD' | 'SGD' | 'INR' | 'SAR';

/** Represents a category's percentage contribution to a transaction or subscription. */
export interface CategorySplit {
  category_id: string;
  percentage: number; // 0–100, all splits on a transaction must sum to 100
}

export interface BankAccount extends RecordModel {
  name: string;
  currency: SupportedCurrency;
  balance: number;
  account_type: 'checking' | 'savings' | 'wallet' | 'credit' | 'crypto' | 'cash';
  color?: string;
  icon?: string;
  notes?: string;
  is_active?: boolean;
  created_by: string;
  expand?: {
    created_by?: User;
  };
}

export interface BalanceAdjustment extends RecordModel {
  bank_account: string;
  old_balance: number;
  new_balance: number;
  reason: string;
  adjusted_by: string;
  expand?: {
    bank_account?: BankAccount;
    adjusted_by?: User;
  };
}

export interface FinCategory extends RecordModel {
  name: string;
  type: 'income' | 'expense' | 'both';
  color?: string;
  icon?: string;
  budget_limit?: number;
  budget_currency?: SupportedCurrency;
  created_by: string;
  expand?: {
    created_by?: User;
  };
}

export interface FinTransaction extends RecordModel {
  bank_account: string;
  type: 'income' | 'expense';
  amount: number;
  currency: SupportedCurrency;
  fee_amount?: number;
  category?: string;
  /** Multi-category percentage splits. When present, overrides single `category` for breakdown/budget logic. */
  category_splits?: CategorySplit[];
  tags?: string[];
  description?: string;
  status: 'pending' | 'cleared';
  date: string;
  expected_clear_date?: string;
  receipt_file?: string;
  created_by: string;
  is_recurring?: boolean;
  recurring_id?: string;
  refund_of?: string;
  expand?: {
    bank_account?: BankAccount;
    category?: FinCategory;
    created_by?: User;
  };
}

export interface RecurringTransaction extends RecordModel {
  bank_account: string;
  type: 'income' | 'expense';
  amount: number;
  currency: SupportedCurrency;
  fee_amount?: number;
  category?: string;
  /** Multi-category percentage splits — propagated to each generated FinTransaction. */
  category_splits?: CategorySplit[];
  description: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  end_date?: string;
  next_run_date?: string;
  initial_amount?: number;
  renewal_amount?: number;
  initial_applied?: boolean;
  amount_history?: Array<{ amount: number; date: string; note?: string }>;
  is_active?: boolean;
  created_by: string;
  expand?: {
    bank_account?: BankAccount;
    category?: FinCategory;
    created_by?: User;
  };
}

// ============================================================================
// Collection Names Constants
// ============================================================================

export const COLLECTIONS = {
  USERS: 'users',
  COMPANIES: 'companies',

  INSTA_ACTORS: 'insta_actors',
  COLD_CALLS: 'cold_calls',
  CALL_TRANSCRIPTS: 'call_transcripts',
  EVENT_LOGS: 'event_logs',
  OUTREACH_LOGS: 'outreach_logs',
  GOALS: 'goals',
  RULES: 'rules',
  ALERTS: 'alerts',
  NOTES: 'notes',

  // New CRM collections
  PHONE_NUMBERS: 'phone_numbers',
  CALL_LOGS: 'call_logs',
  FOLLOW_UPS: 'follow_ups',
  COMPANY_NOTES: 'company_notes',
  INTERACTIONS: 'interactions',
  RECORDINGS: 'recordings',
  USER_PREFERENCES: 'user_preferences',
  COLD_CALLING_SESSIONS: 'cold_calling_sessions',

  CUSTOM_CALL_OUTCOMES: 'custom_call_outcomes',

  // Financial collections
  BANK_ACCOUNTS: 'bank_accounts',
  BALANCE_ADJUSTMENTS: 'balance_adjustments',
  FIN_CATEGORIES: 'fin_categories',
  FIN_TRANSACTIONS: 'fin_transactions',
  RECURRING_TRANSACTIONS: 'recurring_transactions',

  // Email marketing collections
  EMAIL_TEMPLATES: 'email_templates',
  EMAIL_CAMPAIGNS: 'email_campaigns',
  EMAIL_LISTS: 'email_lists',
  EMAIL_RECIPIENTS: 'email_recipients',
  EMAIL_SEQUENCES: 'email_sequences',
  EMAIL_SEQUENCE_STEPS: 'email_sequence_steps',
  EMAIL_SEQUENCE_ENROLLMENTS: 'email_sequence_enrollments',
  EMAIL_EVENTS: 'email_events',
  EMAIL_UNSUBSCRIBES: 'email_unsubscribes',

  // Recycle bin
  RECYCLE_BIN: 'recycle_bin',
} as const;

export type RecycleBinItemType = 'company' | 'phone_number' | 'call_log' | 'session';

export interface RecycleBinItem {
  id: string;
  item_type: RecycleBinItemType;
  original_id: string;
  item_label: string;
  item_data: Record<string, unknown>;
  related_data?: Record<string, unknown>;
  deleted_by: string;
  deleted_at: string;
  expires_at: string;
  created: string;
  updated: string;
  expand?: {
    deleted_by?: User;
  };
}
