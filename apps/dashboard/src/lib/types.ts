import type { RecordModel } from 'pocketbase';

// ============================================================================
// Type Definitions
// ============================================================================

export interface User extends RecordModel {
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'member';
  status: 'online' | 'offline' | 'suspended';
  last_activity?: string;
}

export interface Company extends RecordModel {
  company_name: string;
  owner_name?: string;
  company_location?: string;
  google_maps_link?: string;
  phone_numbers?: string;
  source?: string;

  // NEW fields merged from leads
  instagram_handle?: string;
  email?: string;
  status?: 'Cold No Reply' | 'Replied' | 'Warm' | 'Booked' | 'Paid' | 'Client' | 'Excluded';
  first_contacted?: string;
  last_contacted?: string;
  notes?: string;
  contact_source?: string;
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
  call_outcome?: 'Interested' | 'Not Interested' | 'Callback' | 'No Answer' | 'Wrong Number' | 'Other';
  interest_level?: number;
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
  entity_type: 'cold_call' | 'company' | 'goal';
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
  expand?: {
    company?: Company;
  };
}

export interface CallLog extends RecordModel {
  company: string;
  phone_number_record: string;
  caller?: string;
  call_time: string;
  duration?: number;
  call_outcome?: 'Interested' | 'Not Interested' | 'Callback' | 'No Answer' | 'Wrong Number' | 'Other';
  owner_name_found?: string;
  receptionist_name?: string;
  post_call_notes?: string;
  interest_level?: number;
  status_changed_to?: 'Cold No Reply' | 'Replied' | 'Warm' | 'Booked' | 'Paid' | 'Client' | 'Excluded';
  has_recording?: boolean;
  expand?: {
    company?: Company;
    phone_number_record?: PhoneNumber;
    caller?: User;
  };
}

export interface FollowUp extends RecordModel {
  call_log?: string;
  company: string;
  scheduled_time: string;
  client_timezone: string;
  assigned_to?: string;
  notes?: string;
  status: 'pending' | 'completed' | 'dismissed';
  completed_at?: string;
  expand?: {
    call_log?: CallLog;
    company?: Company;
    assigned_to?: User;
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

export interface Recording extends RecordModel {
  phone_number?: string;
  uploader?: string;
  file?: string;
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
  };
  privacy_settings?: {
    show_online_status?: boolean;
    activity_visibility?: 'team' | 'admins_only';
  };
  expand?: {
    user?: User;
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
} as const;
