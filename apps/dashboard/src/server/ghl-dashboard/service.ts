import 'server-only';
import { getPbAdmin } from '@/lib/pb-admin';
import { ghlRequest } from './client';
import { getDashboardGhlConfig } from './config';
import { cachedDashboardRead, invalidateDashboardReads } from './cache';
import {
  ContactNote, ContactPatch, ContactPhone, DashboardGhlError, GhlUser, LeadCustomField, LeadFormConfig, LeadSubmissionInput,
  LeadSubmissionResult, OpportunityDetail, OpportunityPage, OpportunityPatch,
  OpportunitySummary, PipelineStage, TeamOverviewResponse,
} from './models';

type Json = Record<string, any>;

const asString = (value: unknown) => typeof value === 'string' ? value : undefined;
const first = (...values: unknown[]) => values.find(v => typeof v === 'string' && v) as string | undefined;
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function contactPhones(contact: Json, primary?: string): ContactPhone[] {
  const values: ContactPhone[] = [];
  const add = (value: unknown, label = 'Phone') => {
    if (typeof value !== 'string' || !value.trim()) return;
    const number = value.trim();
    if (!values.some(item => item.number === number)) values.push({ number, label });
  };

  add(contact.phone ?? primary, 'Primary');
  for (const field of ['additionalPhones', 'additionalPhoneNumbers', 'phoneNumbers']) {
    const entries = contact[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === 'string') add(entry, 'Additional');
      else if (entry && typeof entry === 'object') {
        const value = entry as Json;
        add(value.phone ?? value.number ?? value.value, first(value.label, value.type, value.phoneType, 'Additional'));
      }
    }
  }
  return values;
}

function contactNotes(raw: Json): ContactNote[] {
  return itemsFrom(raw, ['notes']).map(note => ({
    id: String(note.id || note._id || ''),
    body: first(note.body, note.note, note.content, note.text) || '',
    createdAt: first(note.createdAt, note.created_at),
  })).filter(note => note.body);
}

function normalizeOpportunity(raw: Json): OpportunitySummary {
  const contact = raw.contact || raw.contactDetails || {};
  return {
    id: String(raw.id || raw._id || ''),
    contactId: first(raw.contactId, raw.contact_id, contact.id),
    pipelineId: String(raw.pipelineId || raw.pipeline_id || ''),
    stageId: String(raw.pipelineStageId || raw.stageId || raw.pipeline_stage_id || ''),
    name: String(raw.name || raw.opportunityName || contact.name || 'Untitled opportunity'),
    contactName: first(raw.contactName, contact.name, [contact.firstName, contact.lastName].filter(Boolean).join(' ')),
    companyName: first(raw.companyName, contact.companyName),
    phone: first(raw.phone, contact.phone),
    email: first(raw.email, contact.email),
    monetaryValue: num(raw.monetaryValue ?? raw.monetary_value ?? raw.value),
    assignedTo: first(raw.assignedTo, raw.assigned_to, raw.ownerId),
    status: String(raw.status || 'open').toLowerCase(),
    source: first(raw.source, raw.leadSource),
    createdAt: first(raw.createdAt, raw.created_at),
    updatedAt: first(raw.updatedAt, raw.updated_at, raw.lastStatusChangeAt),
    lastStageChangeAt: first(raw.lastStageChangeAt, raw.last_stage_change_at),
  };
}

function itemsFrom(raw: Json, keys: string[]) {
  for (const key of keys) if (Array.isArray(raw[key])) return raw[key] as Json[];
  return [] as Json[];
}

function usersFrom(raw: Json): Json[] {
  if (Array.isArray(raw.users)) return raw.users;
  if (Array.isArray(raw.data)) return raw.data;
  if (raw.data && typeof raw.data === 'object' && Array.isArray(raw.data.users)) return raw.data.users;
  if (raw.result && typeof raw.result === 'object' && Array.isArray(raw.result.users)) return raw.result.users;
  return [];
}

function normalizeUser(raw: Json): GhlUser {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || 'Unnamed user'),
    email: asString(raw.email),
  };
}

function userBelongsToLocation(raw: Json, locationId: string) {
  const locationIds = raw.roles?.locationIds || raw.locationIds || [];
  return Array.isArray(locationIds) && locationIds.includes(locationId);
}

async function savedGhlUserId(applicationUserId: string) {
  const pb = await getPbAdmin();
  if (!pb) return undefined;
  try {
    const record = await pb.collection('user_preferences').getFirstListItem(`user="${applicationUserId}"`, { fields: 'workflow_preferences' });
    return asString(record.workflow_preferences?.ghl_user_id);
  } catch {
    return undefined;
  }
}

async function fetchVerifiedGhlUser(ghlUserId: string, applicationUserId: string) {
  const config = getDashboardGhlConfig();
  const raw = await ghlRequest<Json>(`/users/${encodeURIComponent(ghlUserId)}`, {
    userId: applicationUserId,
    recordId: ghlUserId,
    version: 'v3',
  });
  const user = raw.user || raw;
  if (!user.id) throw new DashboardGhlError('ghl_user_not_found', 404);
  if (!userBelongsToLocation(user, config.locationId)) throw new DashboardGhlError('ghl_user_wrong_location', 400);
  return normalizeUser(user);
}

export async function lookupGhlIdentity(ghlUserId: string, applicationUserId: string) {
  const user = await fetchVerifiedGhlUser(ghlUserId, applicationUserId);
  return { ghlUserId: user.id, name: user.name };
}

export async function confirmGhlIdentity(ghlUserId: string, applicationUserId: string) {
  const user = await fetchVerifiedGhlUser(ghlUserId, applicationUserId);
  const pb = await getPbAdmin();
  if (!pb) throw new DashboardGhlError('attribution_store_unavailable', 503);
  let record: Json | undefined;
  try {
    record = await pb.collection('user_preferences').getFirstListItem(`user="${applicationUserId}"`);
  } catch {
    // Created below.
  }
  const workflow = { ...(record?.workflow_preferences || {}), ghl_user_id: user.id };
  if (record) await pb.collection('user_preferences').update(record.id, { workflow_preferences: workflow });
  else await pb.collection('user_preferences').create({ user: applicationUserId, workflow_preferences: workflow });
  invalidateDashboardReads(applicationUserId);
  return { matched: true as const, ghlUserId: user.id, ghlUserName: user.name, matchMethod: 'confirmed-id' as const };
}

export async function getLeadFormConfig(userId: string, userEmail: string): Promise<LeadFormConfig> {
  return cachedDashboardRead(`${userId}:form-config`, 5 * 60_000, () => getLeadFormConfigUncached(userId, userEmail));
}

async function getLeadFormConfigUncached(userId: string, userEmail: string): Promise<LeadFormConfig> {
  const config = getDashboardGhlConfig();
  const locationRaw = await ghlRequest<Json>(`/locations/${config.locationId}`, { userId, version: 'v3' });
  const location = locationRaw.location || locationRaw;
  if (!location?.id) throw new DashboardGhlError('ghl_location_validation_failed', 503);

  // A sub-account Private Integration Token is location-scoped. Use the
  // location user list directly instead of the company-scoped search endpoint;
  // the latter can omit sub-account users or return a different response shape.
  const usersRequest = ghlRequest<Json>(
    `/users/?locationId=${encodeURIComponent(config.locationId)}`,
    { userId, version: '2023-02-21' },
  ).catch(error => {
    const derivedCompanyId = first(location.companyId, location.company_id);
    if (!derivedCompanyId) throw error;
    return ghlRequest<Json>(
      `/users/search?companyId=${encodeURIComponent(derivedCompanyId)}&locationId=${encodeURIComponent(config.locationId)}`,
      { userId, version: 'v3' },
    );
  });

  const [pipelineRaw, usersRaw, fieldsRaw, tagsRaw] = await Promise.all([
    ghlRequest<Json>(`/opportunities/pipelines?locationId=${encodeURIComponent(config.locationId)}`, { userId }),
    usersRequest,
    ghlRequest<Json>(`/locations/${config.locationId}/customFields?model=contact`, { userId, version: 'v3' }),
    ghlRequest<Json>(`/locations/${config.locationId}/tags`, { userId, version: 'v3' }),
  ]);
  const pipelines = itemsFrom(pipelineRaw, ['pipelines']);
  const normalizedPipelines = pipelines.map(pipeline => ({
    id: String(pipeline.id),
    name: String(pipeline.name || 'Unnamed pipeline'),
    stages: itemsFrom(pipeline, ['stages']).map((stage, index): PipelineStage => ({
      id: String(stage.id), name: String(stage.name || `Stage ${index + 1}`), position: num(stage.position ?? index),
    })).sort((a, b) => a.position - b.position),
  })).filter(pipeline => pipeline.id && pipeline.stages.length);
  if (!normalizedPipelines.length) throw new DashboardGhlError('ghl_pipeline_not_found', 503);
  const users: GhlUser[] = usersFrom(usersRaw).map(normalizeUser);
  const emailMatchedUser = users.find(user => user.email?.trim().toLowerCase() === userEmail.trim().toLowerCase());
  let matchedUser = emailMatchedUser;
  let matchMethod: 'email' | 'confirmed-id' | undefined = emailMatchedUser ? 'email' : undefined;
  if (!matchedUser) {
    const savedId = await savedGhlUserId(userId);
    if (savedId) {
      matchedUser = users.find(user => user.id === savedId);
      if (!matchedUser) {
        try { matchedUser = await fetchVerifiedGhlUser(savedId, userId); }
        catch { matchedUser = undefined; }
      }
      if (matchedUser) matchMethod = 'confirmed-id';
    }
  }
  const allowed = new Set(config.customFieldKeys);
  const customFields: LeadCustomField[] = itemsFrom(fieldsRaw, ['customFields', 'fields'])
    .map(field => ({ id: String(field.id), key: String(field.fieldKey || field.key || field.id), name: String(field.name || field.fieldKey || 'Custom field'), dataType: String(field.dataType || field.type || 'text') }))
    .filter(field => allowed.has(field.key));
  return {
    configured: true, locationId: config.locationId,
    pipelines: normalizedPipelines,
    users,
    tags: itemsFrom(tagsRaw, ['tags']).map(tag => ({ id: String(tag.id), name: String(tag.name || '') })).filter(tag => tag.id && tag.name),
    customFields,
    currentUser: matchedUser
      ? { matched: true, ghlUserId: matchedUser.id, ghlUserName: matchedUser.name, matchMethod }
      : { matched: false },
    defaults: { leadSource: config.leadSource },
  };
}

export async function listOpportunities(pipelineId: string, stageId: string, cursor: string | undefined, userId: string): Promise<OpportunityPage> {
  const pageKey = `${userId}:opportunities:${pipelineId}:${stageId}:${cursor || 'first'}`;
  return cachedDashboardRead(pageKey, 15_000, () => listOpportunitiesUncached(pipelineId, stageId, cursor, userId));
}

async function listOpportunitiesUncached(pipelineId: string, stageId: string, cursor: string | undefined, userId: string): Promise<OpportunityPage> {
  const config = getDashboardGhlConfig();
  const params = new URLSearchParams({ location_id: config.locationId, pipeline_id: pipelineId, pipeline_stage_id: stageId, limit: '50' });
  if (cursor) params.set('startAfterId', cursor);
  const raw = await ghlRequest<Json>(`/opportunities/search?${params}`, { userId });
  const items = itemsFrom(raw, ['opportunities']).map(normalizeOpportunity).filter(item => item.id);
  const meta = raw.meta || {};
  // `startAfterId` is returned for the current page too, including the final
  // page. Only expose a cursor when GHL explicitly reports another page.
  // A final page can still include cursor-shaped metadata. A short page is
  // conclusive: every record for this stage has already been returned.
  const hasNextPage = items.length === 50 && Boolean(meta.nextPageUrl ?? meta.next_page_url ?? meta.hasMore ?? meta.has_more);
  const nextCursor = hasNextPage ? first(meta.startAfterId, meta.nextCursor, raw.nextCursor) : undefined;
  return { items, nextCursor, complete: !nextCursor };
}

export async function getOpportunity(id: string, userId: string): Promise<OpportunityDetail> {
  return cachedDashboardRead(`${userId}:opportunity:${id}`, 30_000, () => getOpportunityUncached(id, userId));
}

async function getOpportunityUncached(id: string, userId: string): Promise<OpportunityDetail> {
  const raw = await ghlRequest<Json>(`/opportunities/${encodeURIComponent(id)}`, { userId, recordId: id });
  const opportunity = normalizeOpportunity(raw.opportunity || raw);
  let phoneNumbers: ContactPhone[] = opportunity.phone ? [{ number: opportunity.phone, label: 'Primary' }] : [];
  let notes: ContactNote[] = [];
  if (opportunity.contactId) {
    const contactRaw = await ghlRequest<Json>(`/contacts/${encodeURIComponent(opportunity.contactId)}`, { userId, recordId: opportunity.contactId });
    const contact = contactRaw.contact || contactRaw;
    opportunity.contactName = first(contact.name, [contact.firstName, contact.lastName].filter(Boolean).join(' '), opportunity.contactName);
    opportunity.companyName = first(contact.companyName, opportunity.companyName);
    opportunity.phone = first(contact.phone, opportunity.phone);
    opportunity.email = first(contact.email, opportunity.email);
    phoneNumbers = contactPhones(contact, opportunity.phone);
    // Notes are a separate GHL resource. A contact without note-read access
    // should still open normally, so treat that fetch as best-effort.
    try {
      const notesRaw = await ghlRequest<Json>(`/contacts/${encodeURIComponent(opportunity.contactId)}/notes`, { userId, recordId: opportunity.contactId });
      notes = contactNotes(notesRaw);
    } catch {
      notes = [];
    }
  }
  return { ...opportunity, phoneNumbers, notes };
}

export async function updateOpportunity(id: string, patch: OpportunityPatch, userId: string): Promise<OpportunityDetail> {
  const { status, pipelineId, ...fields } = patch;
  if (Object.keys(fields).length) {
    await ghlRequest(`/opportunities/${encodeURIComponent(id)}`, {
      method: 'PUT', userId, recordId: id,
      body: {
        ...(fields.stageId ? { pipelineStageId: fields.stageId } : {}),
        ...(fields.monetaryValue !== undefined ? { monetaryValue: fields.monetaryValue } : {}),
        ...(fields.assignedTo !== undefined ? { assignedTo: fields.assignedTo || '' } : {}),
        ...(pipelineId ? { pipelineId } : {}),
      },
    });
  }
  if (status) await ghlRequest(`/opportunities/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { status }, userId, recordId: id });
  invalidateDashboardReads(userId);
  return getOpportunityUncached(id, userId);
}

export async function updateContact(id: string, patch: ContactPatch, userId: string) {
  await ghlRequest(`/contacts/${encodeURIComponent(id)}`, { method: 'PUT', body: patch, userId, recordId: id });
  const raw = await ghlRequest<Json>(`/contacts/${encodeURIComponent(id)}`, { userId, recordId: id });
  invalidateDashboardReads(userId);
  return raw.contact || raw;
}

async function findDuplicateOpportunity(contactId: string, pipelineId: string, userId: string) {
  const config = getDashboardGhlConfig();
  const params = new URLSearchParams({ location_id: config.locationId, pipeline_id: pipelineId, contact_id: contactId, limit: '10' });
  const raw = await ghlRequest<Json>(`/opportunities/search?${params}`, { userId });
  return itemsFrom(raw, ['opportunities']).map(normalizeOpportunity).find(item => item.contactId === contactId && item.pipelineId === pipelineId);
}

export async function submitLead(input: LeadSubmissionInput, userId: string, userEmail: string): Promise<LeadSubmissionResult> {
  const config = getDashboardGhlConfig();
  const formConfig = await getLeadFormConfig(userId, userEmail);
  const pipeline = formConfig.pipelines.find(candidate => candidate.id === input.pipelineId);
  if (!pipeline) throw new DashboardGhlError('invalid_pipeline', 400);
  if (!pipeline.stages.some(stage => stage.id === input.stageId)) throw new DashboardGhlError('invalid_stage', 400);
  if (!formConfig.currentUser.matched || !formConfig.currentUser.ghlUserId) throw new DashboardGhlError('ghl_user_not_matched', 409);
  if (input.submissionTag && !formConfig.tags.some(tag => tag.name === input.submissionTag)) throw new DashboardGhlError('invalid_tag', 400);
  const assignedUserId = formConfig.currentUser.ghlUserId;
  const customFields = Object.entries(input.customFields || {})
    .filter(([key]) => config.customFieldKeys.includes(key))
    .map(([key, fieldValue]) => ({ key, field_value: fieldValue }));

  const pb = await getPbAdmin();
  if (!pb) throw new DashboardGhlError('attribution_store_unavailable', 503);
  let submission: Json;
  try {
    submission = await pb.collection('lead_submissions').getFirstListItem(`idempotency_key="${input.idempotencyKey.replaceAll('"', '\\"')}"`);
    if (submission.status === 'succeeded') return { status: 'succeeded', contactId: submission.ghl_contact_id, opportunityId: submission.ghl_opportunity_id };
    if (submission.status === 'duplicate') return { status: 'duplicate', duplicate: true, contactId: submission.ghl_contact_id, opportunityId: submission.duplicate_opportunity_id };
  } catch {
    submission = await pb.collection('lead_submissions').create({
      submitted_by: userId, idempotency_key: input.idempotencyKey, status: 'pending',
      pipeline_id: input.pipelineId, stage_id_at_submission: input.stageId,
      assigned_ghl_user_id: assignedUserId,
      lead_source: config.leadSource, opportunity_value: input.opportunityValue || 0,
    });
  }

  try {
    const contactRaw = await ghlRequest<Json>('/contacts/upsert', {
      method: 'POST', version: '2021-07-28', userId,
      body: {
        locationId: config.locationId, firstName: input.firstName, lastName: input.lastName,
        companyName: input.companyName, phone: input.phone, email: input.email,
        source: config.leadSource, ...(input.submissionTag ? { tags: [input.submissionTag] } : {}),
        ...(customFields.length ? { customFields } : {}),
      },
    });
    const contactId = String(contactRaw.contact?.id || contactRaw.id || '');
    if (!contactId) throw new DashboardGhlError('malformed_contact_response', 502);
    await pb.collection('lead_submissions').update(submission.id, { ghl_contact_id: contactId });
    const duplicate = await findDuplicateOpportunity(contactId, input.pipelineId, userId);
    if (duplicate) {
      await pb.collection('lead_submissions').update(submission.id, { status: 'duplicate', duplicate_opportunity_id: duplicate.id });
      return { status: 'duplicate', duplicate: true, contactId, opportunityId: duplicate.id };
    }
    const opportunityRaw = await ghlRequest<Json>('/opportunities/', {
      method: 'POST', userId,
      body: {
        locationId: config.locationId, pipelineId: input.pipelineId, pipelineStageId: input.stageId,
        contactId, name: input.companyName || [input.firstName, input.lastName].filter(Boolean).join(' ') || 'New lead',
        monetaryValue: input.opportunityValue || 0, source: config.leadSource, status: 'open',
        assignedTo: assignedUserId,
      },
    });
    const opportunityId = String(opportunityRaw.opportunity?.id || opportunityRaw.id || '');
    if (!opportunityId) throw new DashboardGhlError('malformed_opportunity_response', 502);
    invalidateDashboardReads(userId);
    const warnings: string[] = [];
    if (input.notes) {
      try {
        await ghlRequest(`/contacts/${encodeURIComponent(contactId)}/notes`, { method: 'POST', body: { body: input.notes, userId: assignedUserId }, userId, recordId: contactId });
      } catch { warnings.push('The lead was created, but the note could not be attached.'); }
    }
    await pb.collection('lead_submissions').update(submission.id, { status: 'succeeded', ghl_opportunity_id: opportunityId });
    return { status: 'succeeded', contactId, opportunityId, warnings: warnings.length ? warnings : undefined };
  } catch (error) {
    const code = error instanceof DashboardGhlError ? error.code : 'unknown_error';
    await pb.collection('lead_submissions').update(submission.id, { status: 'failed', error_code: code }).catch(() => {});
    throw error;
  }
}

async function allPipelineOpportunities(userId: string, pipelineId: string, stageIds: string[]) {
  const all: OpportunitySummary[] = [];
  for (const stageId of stageIds) {
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listOpportunities(pipelineId, stageId, cursor, userId);
      all.push(...page.items);
      cursor = page.nextCursor;
      pages++;
      if (pages > 200) throw new DashboardGhlError('pagination_limit_exceeded', 504);
    } while (cursor);
  }
  return all;
}

export async function getTeamOverview(userId: string, userEmail: string, pipelineId: string, from: string, to: string): Promise<TeamOverviewResponse> {
  const config = await getLeadFormConfig(userId, userEmail);
  const pipeline = config.pipelines.find(candidate => candidate.id === pipelineId);
  if (!pipeline) throw new DashboardGhlError('invalid_pipeline', 400);
  const pb = await getPbAdmin();
  if (!pb) throw new DashboardGhlError('attribution_store_unavailable', 503);
  const submissions = await pb.collection('lead_submissions').getFullList<Json>({
    filter: `created >= "${from}" && created <= "${to}" && (status="succeeded" || status="duplicate")`,
    fields: 'submitted_by,status,ghl_opportunity_id,duplicate_opportunity_id,opportunity_value,expand.submitted_by.name,expand.submitted_by.email',
    expand: 'submitted_by',
  });
  const opportunities = await allPipelineOpportunities(userId, pipelineId, pipeline.stages.map(stage => stage.id));
  const ids = new Set(submissions.map(s => s.ghl_opportunity_id || s.duplicate_opportunity_id).filter(Boolean));
  const attributed = opportunities.filter(o => ids.has(o.id));
  const now = Date.now();
  const staleMs = getDashboardGhlConfig().staleDays * 86400000;
  const stageName = new Map(pipeline.stages.map(s => [s.id, s.name]));
  const stageRows = pipeline.stages.map(stage => {
    const rows = attributed.filter(o => o.stageId === stage.id);
    return { stageId: stage.id, stageName: stage.name, count: rows.length, value: rows.reduce((sum, o) => sum + o.monetaryValue, 0) };
  });
  const submitter = new Map<string, { userName?: string; count: number; value: number }>();
  for (const s of submissions) {
    const row = submitter.get(s.submitted_by) || { userName: s.expand?.submitted_by?.name || s.expand?.submitted_by?.email, count: 0, value: 0 };
    row.count++; row.value += num(s.opportunity_value); submitter.set(s.submitted_by, row);
  }
  const currentAges = attributed.map(o => Date.parse(o.lastStageChangeAt || '')).filter(Number.isFinite).map(t => (now - t) / 86400000);
  const metric = <T>(value: T, source: 'ghl' | 'local' | 'calculated'): { value: T; source: typeof source; complete: true } => ({ value, source, complete: true });
  return {
    period: { from, to },
    submissions: metric(submissions.length, 'local'),
    createdOpportunities: metric(submissions.filter(s => s.status === 'succeeded').length, 'local'),
    submittedValue: metric(submissions.reduce((sum, s) => sum + num(s.opportunity_value), 0), 'local'),
    activeOpportunities: metric(attributed.filter(o => o.status === 'open').length, 'ghl'),
    won: metric(attributed.filter(o => o.status === 'won').length, 'ghl'),
    lost: metric(attributed.filter(o => o.status === 'lost').length, 'ghl'),
    stale: metric(attributed.filter(o => o.status === 'open' && now - Date.parse(o.lastStageChangeAt || o.updatedAt || '') > staleMs).length, 'calculated'),
    unassigned: metric(attributed.filter(o => !o.assignedTo).length, 'ghl'),
    missingContactInfo: metric(attributed.filter(o => !o.phone && !o.email).length, 'ghl'),
    averageCurrentStageAgeDays: currentAges.length ? metric(currentAges.reduce((a, b) => a + b, 0) / currentAges.length, 'calculated') : { value: null, source: 'ghl', complete: false, unavailableReason: 'GHL did not supply stage-change timestamps.' },
    historicalAverageTimeInStage: { value: null, source: 'ghl', complete: false, unavailableReason: 'Complete stage-transition history is unavailable.' },
    stageConversionRates: { value: null, source: 'ghl', complete: false, unavailableReason: 'Complete stage-transition history is unavailable.' },
    byStage: stageRows.map(row => ({ ...row, stageName: stageName.get(row.stageId) || row.stageName })),
    bySubmitter: [...submitter].map(([submitterId, row]) => ({ userId: submitterId, ...row })),
  };
}
