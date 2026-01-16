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
}

export interface Lead extends RecordModel {
  username: string;
  status: 'Cold No Reply' | 'Replied' | 'Warm' | 'Booked' | 'Paid' | 'Client' | 'Excluded';
  first_contacted?: string;
  last_updated?: string;
  notes?: string;
  email?: string;
  phone?: string;
  contact_source?: string;
  source?: string;
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
  target?: string;
  cold_call?: string;
  details?: string;
  source?: string;
  expand?: {
    actor?: InstaActor;
    user?: User;
    target?: Lead;
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
  entity_type: 'cold_call' | 'lead' | 'goal';
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

// ============================================================================
// Collection Names Constants
// ============================================================================

export const COLLECTIONS = {
  USERS: 'users',
  COMPANIES: 'companies',
  LEADS: 'leads',
  INSTA_ACTORS: 'insta_actors',
  COLD_CALLS: 'cold_calls',
  CALL_TRANSCRIPTS: 'call_transcripts',
  EVENT_LOGS: 'event_logs',
  OUTREACH_LOGS: 'outreach_logs',
  GOALS: 'goals',
  RULES: 'rules',
  ALERTS: 'alerts',
  NOTES: 'notes',
} as const;
