import { getPbAdmin } from './pb-admin';

const COLLECTION = 'user_preferences';
const FIELD = 'workflow_preferences';
const KEY = 'leadScrapingSessions';

export interface LeadScrapingSessionRecord {
  recordId: string;
  clientId: string;
  name: string;
  ownerUserId: string;
  updatedAt: number;
  payloadOmitted: false;
  session: Record<string, unknown>;
}

async function getPreferencesRecord(userId: string) {
  const pb = await getPbAdmin();
  if (!pb) throw new Error('pb_unavailable');

  try {
    const existing = await pb.collection(COLLECTION).getFirstListItem(`user="${userId}"`);
    return { pb, record: existing };
  } catch {
    try {
      const created = await pb.collection(COLLECTION).create({
        user: userId,
        [FIELD]: {},
      });
      return { pb, record: created };
    } catch {
      throw new Error('pb_read_failed');
    }
  }
}

function readWorkflowPreferences(record: Record<string, unknown>): Record<string, unknown> {
  const raw = record[FIELD];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw as Record<string, unknown> } : {};
}

function readSessions(workflow: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(workflow[KEY]) ? (workflow[KEY] as Record<string, unknown>[]).filter(Boolean) : [];
}

function toRecord(userId: string, session: Record<string, unknown>): LeadScrapingSessionRecord {
  const meta = (session.__meta && typeof session.__meta === 'object' ? session.__meta : {}) as Record<string, unknown>;
  const clientId = String(meta.clientId || session.id || '');
  return {
    recordId: clientId,
    clientId,
    name: String(meta.name || session.name || 'Saved session'),
    ownerUserId: userId,
    updatedAt: Number(meta.updatedAt || session.updatedAt || 0) || 0,
    payloadOmitted: false,
    session,
  };
}

export async function listLeadScrapingSessions(userId: string): Promise<LeadScrapingSessionRecord[]> {
  const { record } = await getPreferencesRecord(userId);
  const workflow = readWorkflowPreferences(record as unknown as Record<string, unknown>);
  return readSessions(workflow)
    .map((session) => toRecord(userId, session))
    .filter((session) => Boolean(session.clientId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function upsertLeadScrapingSession(
  userId: string,
  locationId: string,
  session: Record<string, unknown>,
): Promise<LeadScrapingSessionRecord> {
  const clientId = String(session.id || '');
  if (!clientId) throw new Error('missing_session_id');

  const { pb, record } = await getPreferencesRecord(userId);
  const workflow = readWorkflowPreferences(record as unknown as Record<string, unknown>);
  const sessions = readSessions(workflow);
  const payload = {
    ...session,
    locationId: String(session.locationId || locationId || ''),
    __meta: {
      clientId,
      ownerUserId: userId,
      name: String(session.name || 'Saved session'),
      updatedAt: Date.now(),
      payloadOmitted: false,
    },
  };

  const idx = sessions.findIndex((item) => String(item.id || ((item.__meta as Record<string, unknown> | undefined)?.clientId || '')) === clientId);
  if (idx >= 0) sessions[idx] = payload;
  else sessions.unshift(payload);

  workflow[KEY] = sessions;
  await pb.collection(COLLECTION).update(record.id, { [FIELD]: workflow });
  return toRecord(userId, payload);
}

export async function deleteLeadScrapingSession(userId: string, recordId: string): Promise<void> {
  const { pb, record } = await getPreferencesRecord(userId);
  const workflow = readWorkflowPreferences(record as unknown as Record<string, unknown>);
  const sessions = readSessions(workflow);
  const kept = sessions.filter((item) => String(item.id || ((item.__meta as Record<string, unknown> | undefined)?.clientId || '')) !== recordId);
  if (kept.length === sessions.length) throw new Error('session_not_found');
  workflow[KEY] = kept;
  await pb.collection(COLLECTION).update(record.id, { [FIELD]: workflow });
}
