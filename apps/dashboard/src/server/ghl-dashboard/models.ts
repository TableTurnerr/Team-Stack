export type MetricSource = 'ghl' | 'local' | 'calculated';

export interface MetricValue<T> {
  value: T | null;
  source: MetricSource;
  complete: boolean;
  unavailableReason?: string;
}

export interface PipelineStage { id: string; name: string; position: number }
export interface GhlPipeline { id: string; name: string; stages: PipelineStage[] }
export interface GhlUser { id: string; name: string; email?: string }
export interface GhlTag { id: string; name: string }
export interface LeadCustomField { id: string; key: string; name: string; dataType: string }

export interface LeadFormConfig {
  configured: true;
  locationId: string;
  pipelines: GhlPipeline[];
  users: GhlUser[];
  tags: GhlTag[];
  customFields: LeadCustomField[];
  currentUser: { matched: boolean; ghlUserId?: string; ghlUserName?: string; matchMethod?: 'email' | 'confirmed-id' };
  defaults: { leadSource: string };
}

export interface LeadSubmissionInput {
  idempotencyKey: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  opportunityValue?: number;
  pipelineId: string;
  stageId: string;
  submissionTag?: string;
  customFields?: Record<string, string>;
}

export interface LeadSubmissionResult {
  status: 'succeeded' | 'duplicate';
  contactId: string;
  opportunityId: string;
  duplicate?: boolean;
  warnings?: string[];
}

export interface OpportunitySummary {
  id: string;
  contactId?: string;
  pipelineId: string;
  stageId: string;
  name: string;
  contactName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  monetaryValue: number;
  assignedTo?: string;
  status: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  lastStageChangeAt?: string;
}

export interface ContactPhone {
  number: string;
  label: string;
}

export interface ContactNote {
  id: string;
  body: string;
  createdAt?: string;
}

export interface OpportunityDetail extends OpportunitySummary {
  phoneNumbers: ContactPhone[];
  notes: ContactNote[];
}

export interface OpportunityPage {
  items: OpportunitySummary[];
  nextCursor?: string;
  complete: boolean;
}

export interface OpportunityPatch {
  pipelineId?: string;
  stageId?: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned';
  monetaryValue?: number;
  assignedTo?: string | null;
}

export interface ContactPatch {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  additionalPhones?: Array<{ phone: string; label?: string }>;
}

export interface TeamOverviewResponse {
  period: { from: string; to: string };
  submissions: MetricValue<number>;
  createdOpportunities: MetricValue<number>;
  submittedValue: MetricValue<number>;
  activeOpportunities: MetricValue<number>;
  won: MetricValue<number>;
  lost: MetricValue<number>;
  stale: MetricValue<number>;
  unassigned: MetricValue<number>;
  missingContactInfo: MetricValue<number>;
  averageCurrentStageAgeDays: MetricValue<number>;
  historicalAverageTimeInStage: MetricValue<number>;
  stageConversionRates: MetricValue<Record<string, number>>;
  byStage: Array<{ stageId: string; stageName: string; count: number; value: number }>;
  bySubmitter: Array<{ userId: string; userName?: string; count: number; value: number }>;
}

export class DashboardGhlError extends Error {
  constructor(
    public code: string,
    public status = 502,
    public retryAfter?: number,
    public details?: Record<string, string>,
  ) {
    super(code);
  }
}
