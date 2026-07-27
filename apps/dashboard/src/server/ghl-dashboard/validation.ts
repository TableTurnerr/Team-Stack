import { ContactPatch, DashboardGhlError, LeadSubmissionInput, OpportunityPatch } from './models';

const text = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : undefined;

export function parseLeadSubmission(value: unknown): LeadSubmissionInput {
  if (!value || typeof value !== 'object') throw new DashboardGhlError('invalid_input', 400);
  const raw = value as Record<string, unknown>;
  const input: LeadSubmissionInput = {
    idempotencyKey: text(raw.idempotencyKey, 100) || '',
    firstName: text(raw.firstName, 100), lastName: text(raw.lastName, 100),
    companyName: text(raw.companyName, 200), phone: text(raw.phone, 50),
    email: text(raw.email, 200)?.toLowerCase(), notes: text(raw.notes, 5000),
    pipelineId: text(raw.pipelineId, 100) || '',
    stageId: text(raw.stageId, 100) || '',
    submissionTag: text(raw.submissionTag, 100),
    opportunityValue: raw.opportunityValue === '' || raw.opportunityValue == null ? undefined : Number(raw.opportunityValue),
    customFields: raw.customFields && typeof raw.customFields === 'object'
      ? Object.fromEntries(Object.entries(raw.customFields as Record<string, unknown>).map(([k, v]) => [k, text(v, 1000) || '']))
      : undefined,
  };
  const fields: Record<string, string> = {};
  if (!input.idempotencyKey) fields.idempotencyKey = 'Required';
  if (!input.phone && !input.email) fields.contact = 'Phone or email is required';
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) fields.email = 'Invalid email';
  if (!input.pipelineId) fields.pipelineId = 'Required';
  if (!input.stageId) fields.stageId = 'Required';
  if (input.opportunityValue != null && (!Number.isFinite(input.opportunityValue) || input.opportunityValue < 0)) fields.opportunityValue = 'Must be zero or greater';
  if (Object.keys(fields).length) throw new DashboardGhlError('validation_failed', 400, undefined, fields);
  return input;
}

export function parseOpportunityPatch(value: unknown): OpportunityPatch {
  if (!value || typeof value !== 'object') throw new DashboardGhlError('invalid_input', 400);
  const raw = value as Record<string, unknown>;
  const patch: OpportunityPatch = {};
  if ('pipelineId' in raw) patch.pipelineId = text(raw.pipelineId, 100);
  if ('stageId' in raw) patch.stageId = text(raw.stageId, 100);
  if ('status' in raw) {
    if (!['open', 'won', 'lost', 'abandoned'].includes(String(raw.status))) throw new DashboardGhlError('invalid_status', 400);
    patch.status = raw.status as OpportunityPatch['status'];
  }
  if ('monetaryValue' in raw) {
    const amount = Number(raw.monetaryValue);
    if (!Number.isFinite(amount) || amount < 0) throw new DashboardGhlError('invalid_value', 400);
    patch.monetaryValue = amount;
  }
  if ('assignedTo' in raw) patch.assignedTo = raw.assignedTo === null ? null : text(raw.assignedTo, 100);
  if (!Object.keys(patch).length) throw new DashboardGhlError('empty_patch', 400);
  return patch;
}

export function parseContactPatch(value: unknown): ContactPatch {
  if (!value || typeof value !== 'object') throw new DashboardGhlError('invalid_input', 400);
  const raw = value as Record<string, unknown>;
  const allowed = ['firstName', 'lastName', 'companyName', 'phone', 'email'] as const;
  const patch: ContactPatch = {};
  for (const key of allowed) if (key in raw) patch[key] = text(raw[key], key === 'companyName' || key === 'email' ? 200 : 100);
  if ('additionalPhones' in raw) {
    if (!Array.isArray(raw.additionalPhones)) throw new DashboardGhlError('invalid_phone_numbers', 400);
    patch.additionalPhones = raw.additionalPhones.map(value => {
      if (!value || typeof value !== 'object') throw new DashboardGhlError('invalid_phone_numbers', 400);
      const phone = text((value as Record<string, unknown>).phone, 100);
      if (!phone) throw new DashboardGhlError('invalid_phone_numbers', 400);
      return { phone, label: text((value as Record<string, unknown>).label, 100) };
    });
  }
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) throw new DashboardGhlError('invalid_email', 400);
  if (!Object.keys(patch).length) throw new DashboardGhlError('empty_patch', 400);
  return patch;
}
