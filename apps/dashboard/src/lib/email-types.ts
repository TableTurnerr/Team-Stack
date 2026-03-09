import type { RecordModel } from 'pocketbase';
import type { Company, User } from './types';

// ============================================================================
// Email Marketing Type Definitions
// ============================================================================

export interface EmailTemplate extends RecordModel {
  name: string;
  subject?: string;
  html_body?: string;
  json_body?: Record<string, unknown>;
  preview_text?: string;
  category?: string;
  created_by?: string;
  expand?: {
    created_by?: User;
  };
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled';
export type CampaignType = 'one_time' | 'ab_test';
export type ABWinnerMetric = 'open_rate' | 'click_rate';

export interface EmailCampaign extends RecordModel {
  name: string;
  template?: string;
  subject?: string;
  html_body?: string;
  json_body?: Record<string, unknown>;
  status: CampaignStatus;
  campaign_type?: CampaignType;
  audience_list?: string;
  exclusion_list?: string;
  scheduled_at?: string;
  sent_at?: string;
  sent_count?: number;
  delivered_count?: number;
  opened_count?: number;
  clicked_count?: number;
  bounced_count?: number;
  unsubscribed_count?: number;
  ab_variant?: string;
  ab_parent?: string;
  ab_split_pct?: number;
  ab_winner_metric?: ABWinnerMetric;
  created_by?: string;
  expand?: {
    template?: EmailTemplate;
    audience_list?: EmailList;
    exclusion_list?: EmailList;
    ab_parent?: EmailCampaign;
    created_by?: User;
  };
}

export type ListType = 'static' | 'dynamic' | 'suppression';

export interface EmailList extends RecordModel {
  name: string;
  list_type: ListType;
  filter_json?: Record<string, unknown>;
  company_ids?: string[];
  cached_count?: number;
  created_by?: string;
  expand?: {
    created_by?: User;
  };
}

export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'unsubscribed';

export interface EmailRecipient extends RecordModel {
  campaign: string;
  company: string;
  email_address: string;
  status: RecipientStatus;
  tracking_id: string;
  open_count?: number;
  click_count?: number;
  sent_at?: string;
  opened_at?: string;
  clicked_at?: string;
  personalization_data?: Record<string, unknown>;
  expand?: {
    campaign?: EmailCampaign;
    company?: Company;
  };
}

export type SequenceStatus = 'draft' | 'active' | 'paused' | 'archived';
export type TriggerType = 'manual' | 'status_change' | 'new_company' | 'tag_added';

export interface EmailSequence extends RecordModel {
  name: string;
  status: SequenceStatus;
  trigger_type: TriggerType;
  trigger_config?: Record<string, unknown>;
  stop_on_reply?: boolean;
  stop_on_status_change?: boolean;
  stop_statuses?: string[];
  audience_list?: string;
  created_by?: string;
  expand?: {
    audience_list?: EmailList;
    created_by?: User;
  };
}

export interface EmailSequenceStep extends RecordModel {
  sequence: string;
  step_order: number;
  template?: string;
  delay_days?: number;
  delay_hours?: number;
  send_window_start?: string;
  send_window_end?: string;
  subject_override?: string;
  body_override?: string;
  expand?: {
    sequence?: EmailSequence;
    template?: EmailTemplate;
  };
}

export type EnrollmentStatus = 'active' | 'completed' | 'stopped_reply' | 'stopped_status' | 'stopped_manual';

export interface EmailSequenceEnrollment extends RecordModel {
  sequence: string;
  company: string;
  status: EnrollmentStatus;
  current_step?: number;
  next_send_at?: string;
  enrolled_at: string;
  expand?: {
    sequence?: EmailSequence;
    company?: Company;
  };
}

export type EmailEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'unsubscribed' | 'complained';

export interface EmailEvent extends RecordModel {
  recipient?: string;
  enrollment?: string;
  company?: string;
  event_type: EmailEventType;
  event_data?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  expand?: {
    recipient?: EmailRecipient;
    enrollment?: EmailSequenceEnrollment;
    company?: Company;
  };
}

export type UnsubscribeSource = 'link_click' | 'manual' | 'bounce' | 'complaint';

export interface EmailUnsubscribe extends RecordModel {
  company?: string;
  email_address: string;
  reason?: string;
  source: UnsubscribeSource;
  campaign?: string;
  expand?: {
    company?: Company;
    campaign?: EmailCampaign;
  };
}

// ============================================================================
// Email Collection Names
// ============================================================================

export const EMAIL_COLLECTIONS = {
  EMAIL_TEMPLATES: 'email_templates',
  EMAIL_CAMPAIGNS: 'email_campaigns',
  EMAIL_LISTS: 'email_lists',
  EMAIL_RECIPIENTS: 'email_recipients',
  EMAIL_SEQUENCES: 'email_sequences',
  EMAIL_SEQUENCE_STEPS: 'email_sequence_steps',
  EMAIL_SEQUENCE_ENROLLMENTS: 'email_sequence_enrollments',
  EMAIL_EVENTS: 'email_events',
  EMAIL_UNSUBSCRIBES: 'email_unsubscribes',
} as const;
