import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import { buildPhoneSearchFilter, stripPhoneFormatting, formatPhoneNumber } from '@/lib/utils';
import { extractPlainText } from '@/components/block-editor/helpers';

export type SearchResultType =
  | 'company'
  | 'note'
  | 'recording'
  | 'team'
  | 'follow-up'
  | 'cold-call'
  | 'page';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  href: string;
  iconName?: 'Building2' | 'StickyNote' | 'Mic' | 'Users' | 'CalendarClock' | 'Phone';
}

export interface SearchResults {
  companies: SearchResult[];
  notes: SearchResult[];
  recordings: SearchResult[];
  users: SearchResult[];
  followUps: SearchResult[];
  callLogs: SearchResult[];
}

/**
 * Run the full-text global search against PocketBase and return grouped results.
 * `limit` controls the page size per collection.
 */
export async function runGlobalSearch(q: string, limit: number): Promise<SearchResults> {
  const empty: SearchResults = { companies: [], notes: [], recordings: [], users: [], followUps: [], callLogs: [] };
  const query = q.trim();
  if (!query) return empty;

  const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const digits = stripPhoneFormatting(query);

  const companyFieldFilter = [
    `company_name ~ "${escaped}"`,
    `owner_name ~ "${escaped}"`,
    `receptionist_name ~ "${escaped}"`,
    `instagram_handle ~ "${escaped}"`,
    `email ~ "${escaped}"`,
    `website ~ "${escaped}"`,
  ].join(' || ');

  const companyPhoneFilter = digits.length >= 3
    ? `${companyFieldFilter} || ${buildPhoneSearchFilter('phone_number', query)} || ${buildPhoneSearchFilter('phone_number_record.phone_number', query)}`
    : companyFieldFilter;

  const callLogPhoneFilter = digits.length >= 3
    ? buildPhoneSearchFilter('phone_number_record.phone_number', query)
    : `phone_number_record.phone_number ~ "${escaped}"`;
  const callLogFilter = `company.company_name ~ "${escaped}" || owner_name_found ~ "${escaped}" || ${callLogPhoneFilter}`;

  const phoneNumberFilter = buildPhoneSearchFilter('phone_number', query);

  const [companies, notes, recordings, users, followUps, callLogs, phones] = await Promise.all([
    pb.collection(COLLECTIONS.COMPANIES).getList(1, limit, { filter: companyPhoneFilter, fields: 'id,company_name,owner_name,phone_number', requestKey: null }).catch(() => ({ items: [] })),
    pb.collection(COLLECTIONS.NOTES).getList(1, limit, { filter: `note_text ~ "${escaped}"`, fields: 'id,note_text,company', requestKey: null }).catch(() => ({ items: [] })),
    pb.collection(COLLECTIONS.RECORDINGS).getList(1, limit, { filter: `filename ~ "${escaped}"`, fields: 'id,filename,company', requestKey: null }).catch(() => ({ items: [] })),
    pb.collection(COLLECTIONS.USERS).getList(1, limit, { filter: `name ~ "${escaped}" || email ~ "${escaped}"`, fields: 'id,name,email', requestKey: null }).catch(() => ({ items: [] })),
    pb.collection(COLLECTIONS.FOLLOW_UPS).getList(1, limit, { filter: `title ~ "${escaped}" || description ~ "${escaped}"`, fields: 'id,title,due_date', requestKey: null }).catch(() => ({ items: [] })),
    pb.collection(COLLECTIONS.CALL_LOGS).getList(1, limit, { filter: callLogFilter, expand: 'company,phone_number_record,cold_call', sort: '-call_time', requestKey: null }).catch(() => ({ items: [] })),
    pb.collection(COLLECTIONS.PHONE_NUMBERS).getList(1, limit, { filter: phoneNumberFilter, fields: 'id,phone_number,company,label', expand: 'company', requestKey: null }).catch(() => ({ items: [] })),
  ]);

  const result = { ...empty };
  const seenCompanyIds = new Set<string>();

  for (const c of companies.items) {
    const company = c as any;
    seenCompanyIds.add(company.id);
    result.companies.push({
      id: company.id,
      type: 'company',
      title: company.company_name,
      subtitle: company.owner_name || company.phone_number || undefined,
      href: `/companies/${company.id}`,
      iconName: 'Building2',
    });
  }

  // Phone number matches — promote the owning company into the company results
  // so searching a phone surfaces its company directly.
  for (const p of phones.items) {
    const phone = p as any;
    const company = phone.expand?.company;
    const phoneDisplay = formatPhoneNumber(phone.phone_number) || phone.phone_number;
    if (company && !seenCompanyIds.has(company.id)) {
      seenCompanyIds.add(company.id);
      result.companies.push({
        id: company.id,
        type: 'company',
        title: company.company_name,
        subtitle: phoneDisplay,
        href: `/companies/${company.id}`,
        iconName: 'Building2',
      });
    } else if (!company) {
      result.companies.push({
        id: phone.id,
        type: 'company',
        title: phoneDisplay,
        subtitle: phone.label || 'Phone number',
        href: '/companies',
        iconName: 'Phone',
      });
    }
  }

  for (const n of notes.items) {
    const note = n as any;
    const text = extractPlainText(note.note_text || '');
    const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
    result.notes.push({
      id: note.id,
      type: 'note',
      title: preview || 'Untitled Note',
      href: '/notes',
      iconName: 'StickyNote',
    });
  }

  for (const r of recordings.items) {
    const rec = r as any;
    result.recordings.push({
      id: rec.id,
      type: 'recording',
      title: rec.filename || 'Recording',
      href: '/recordings',
      iconName: 'Mic',
    });
  }

  for (const u of users.items) {
    const user = u as any;
    result.users.push({
      id: user.id,
      type: 'team',
      title: user.name || user.email,
      subtitle: user.email,
      href: '/team',
      iconName: 'Users',
    });
  }

  for (const f of followUps.items) {
    const fu = f as any;
    result.followUps.push({
      id: fu.id,
      type: 'follow-up',
      title: fu.title || 'Follow-up',
      subtitle: fu.due_date ? `Due: ${new Date(fu.due_date).toLocaleDateString()}` : undefined,
      href: '/follow-ups',
      iconName: 'CalendarClock',
    });
  }

  for (const cl of callLogs.items) {
    const log = cl as any;
    const phone = log.expand?.phone_number_record?.phone_number || '';
    const companyName = log.expand?.company?.company_name || '';
    const owner = log.owner_name_found || '';
    const outcome = Array.isArray(log.call_outcome) ? log.call_outcome.join(', ') : (log.call_outcome || '');
    const coldCall = log.expand?.cold_call;
    const detailHref = coldCall ? `/cold-calls/${coldCall.id}` : `/cold-calls/${log.id}?type=log`;
    result.callLogs.push({
      id: log.id,
      type: 'cold-call',
      title: companyName ? `${companyName} — ${formatPhoneNumber(phone)}` : formatPhoneNumber(phone) || 'Call Log',
      subtitle: [owner, outcome].filter(Boolean).join(' · ') || undefined,
      href: detailHref,
      iconName: 'Phone',
    });
  }

  return result;
}

export function flattenResults(r: SearchResults): SearchResult[] {
  return [...r.companies, ...r.notes, ...r.recordings, ...r.users, ...r.followUps, ...r.callLogs];
}
