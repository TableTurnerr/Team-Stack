import { pb } from '@/lib/pocketbase';
import {
  COLLECTIONS,
  type Company,
  type PhoneNumber,
  type CallLog,
} from '@/lib/types';

// ============================================================================
// Interfaces
// ============================================================================

export interface CsvPhoneEntry {
  pb_id?: string;
  phone_number: string;
  label?: string;
  location_name?: string;
  location_address?: string;
  receptionist_name?: string;
  last_called?: string;
  total_calls?: number;
  disassociated?: boolean;
}

export interface CsvCompanyRow {
  id: string;
  company_name: string;
  owner_name: string;
  company_location: string;
  google_maps_link: string;

  source: string;
  instagram_handle: string;
  email: string;
  status: string;
  first_contacted: string;
  last_contacted: string;
  notes: string;
  contact_source: string;
  phone_numbers_json: CsvPhoneEntry[];
  // Reference-only (never applied on import)
  total_calls: number;
  total_pickups: number;
  appointment_set_count: number;
  last_call_time: string;
  last_call_outcome: string;
  session_ids: string[];
  recording_ids: string[];
  follow_up_ids: string[];
}

export interface ExportOptions {
  includePhoneNumbersJson: boolean;
  includeCallStats: boolean;
  includeReferenceIds: boolean;
}

export interface CompanyCallStats {
  total_calls: number;
  total_pickups: number;
  appointment_set_count: number;
  last_call_time: string;
  last_call_outcome: string;
  session_ids: string[];
  recording_ids: string[];
  follow_up_ids: string[];
}

export interface ParseResult {
  rows: CsvCompanyRow[];
  errors: Array<{ line: number; message: string }>;
  warnings: Array<{ line: number; message: string }>;
}

// Diff engine types
export type FieldResolution = 'use_new' | 'use_old';
export type PhoneResolution = 'apply' | 'skip';
export type CompanyResolution = 'apply' | 'skip';
export type CompanyAction = 'update' | 'create' | 'delete' | 'unchanged';

export interface FieldDiff {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
  hasChanged: boolean;
  resolution: FieldResolution;
}

export interface PhoneNumberDiff {
  diffId: string;
  action: 'add' | 'update' | 'remove' | 'unchanged';
  pbId?: string;
  csvData?: CsvPhoneEntry;
  dbData?: PhoneNumber;
  fieldDiffs: FieldDiff[];
  resolution: PhoneResolution;
}

export interface CompanyDiff {
  rowId: string;
  action: CompanyAction;
  matchType: 'id' | 'name' | 'new' | 'deleted';
  isAmbiguous?: boolean;
  csvRow?: CsvCompanyRow;
  dbRecord?: Company;
  fieldDiffs: FieldDiff[];
  phoneNumberDiffs: PhoneNumberDiff[];
  companyResolution: CompanyResolution;
  isExpanded: boolean;
  applyStatus?: 'pending' | 'applying' | 'applied' | 'error';
  applyError?: string;
}

// ============================================================================
// Constants
// ============================================================================

export const FIELD_LABELS: Record<string, string> = {
  company_name: 'Company Name',
  owner_name: 'Owner Name',
  company_location: 'Location',
  google_maps_link: 'Google Maps Link',

  source: 'Source',
  instagram_handle: 'Instagram Handle',
  email: 'Email',
  status: 'Status',
  first_contacted: 'First Contacted',
  last_contacted: 'Last Contacted',
  notes: 'Notes',
  contact_source: 'Contact Source',
};

// Fields that can be edited on import (excludes id and reference-only columns)
export const IMPORTABLE_FIELDS: string[] = [
  'company_name',
  'owner_name',
  'company_location',
  'google_maps_link',
  'source',
  'instagram_handle',
  'email',
  'status',
  'first_contacted',
  'last_contacted',
  'notes',
  'contact_source',
];

// Select-type fields — normalize to lowercase for comparison
const SELECT_FIELDS = new Set(['status', 'source', 'contact_source']);

// Date fields — compare only YYYY-MM-DD portion
const DATE_FIELDS = new Set(['first_contacted', 'last_contacted']);

// ============================================================================
// CSV Encoding / Decoding
// ============================================================================

/**
 * Escapes a single CSV cell value per RFC 4180.
 * Wraps in double quotes if the value contains comma, double-quote, or newline.
 * Internal double-quotes are doubled.
 */
export function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Splits a single CSV line into cells, respecting RFC 4180 quoting rules.
 * Handles quoted fields that contain commas, newlines, and doubled double-quotes.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      cells.push('');
      break;
    }
    if (line[i] === '"') {
      // Quoted field
      let cell = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          cell += line[i];
          i++;
        }
      }
      cells.push(cell);
      if (line[i] === ',') i++;
    } else {
      // Unquoted field
      const end = line.indexOf(',', i);
      if (end === -1) {
        cells.push(line.slice(i));
        break;
      } else {
        cells.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
  return cells;
}

/**
 * Parses a JSON cell that may be empty. Returns null on failure.
 */
function parseCsvJsonCell<T>(cell: string): T | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// CSV Generation
// ============================================================================

const CSV_HEADERS = [
  'id',
  'company_name',
  'owner_name',
  'company_location',
  'google_maps_link',
  'source',
  'instagram_handle',
  'email',
  'status',
  'first_contacted',
  'last_contacted',
  'notes',
  'contact_source',
  'phone_numbers_json',
  'total_calls',
  'total_pickups',
  'appointment_set_count',
  'last_call_time',
  'last_call_outcome',
  'session_ids',
  'recording_ids',
  'follow_up_ids',
];

/**
 * Builds the full CSV string for export.
 * Returns UTF-8 string with BOM prefix for Excel compatibility.
 */
export function generateLeadsCSV(
  companies: Company[],
  phoneMap: Map<string, PhoneNumber[]>,
  callStatsMap: Map<string, CompanyCallStats>,
  options: ExportOptions
): string {
  const headerRow = CSV_HEADERS.map(escapeCsvCell).join(',');
  const rows = companies.map(company => {
    // Phone numbers JSON
    let phoneJsonCell = '';
    if (options.includePhoneNumbersJson) {
      const phones = phoneMap.get(company.id) ?? [];
      const entries: CsvPhoneEntry[] = phones.map(p => ({
        pb_id: p.id,
        phone_number: p.phone_number,
        label: p.label ?? '',
        location_name: p.location_name ?? '',
        location_address: p.location_address ?? '',
        receptionist_name: p.receptionist_name ?? '',
        last_called: p.last_called ?? '',
        total_calls: p.total_calls ?? 0,
        disassociated: p.disassociated ?? false,
      }));
      phoneJsonCell = escapeCsvCell(JSON.stringify(entries));
    }

    // Call stats
    const stats = callStatsMap.get(company.id);
    const totalCalls = options.includeCallStats ? (stats?.total_calls ?? 0) : 0;
    const totalPickups = options.includeCallStats ? (stats?.total_pickups ?? 0) : 0;
    const appointmentCount = options.includeCallStats ? (stats?.appointment_set_count ?? 0) : 0;
    const lastCallTime = options.includeCallStats ? (stats?.last_call_time ?? '') : '';
    const lastCallOutcome = options.includeCallStats ? (stats?.last_call_outcome ?? '') : '';

    // Reference IDs
    const sessionIds = (options.includeReferenceIds && stats) ? stats.session_ids.join(';') : '';
    const recordingIds = (options.includeReferenceIds && stats) ? stats.recording_ids.join(';') : '';
    const followUpIds = (options.includeReferenceIds && stats) ? stats.follow_up_ids.join(';') : '';

    const cells = [
      escapeCsvCell(company.id),
      escapeCsvCell(company.company_name),
      escapeCsvCell(company.owner_name ?? ''),
      escapeCsvCell(company.company_location ?? ''),
      escapeCsvCell(company.google_maps_link ?? ''),
      escapeCsvCell(company.source ?? ''),
      escapeCsvCell(company.instagram_handle ?? ''),
      escapeCsvCell(company.email ?? ''),
      escapeCsvCell(company.status ?? ''),
      escapeCsvCell(company.first_contacted ?? ''),
      escapeCsvCell(company.last_contacted ?? ''),
      escapeCsvCell(company.notes ?? ''),
      escapeCsvCell(company.contact_source ?? ''),
      phoneJsonCell,
      escapeCsvCell(String(totalCalls)),
      escapeCsvCell(String(totalPickups)),
      escapeCsvCell(String(appointmentCount)),
      escapeCsvCell(lastCallTime),
      escapeCsvCell(lastCallOutcome),
      escapeCsvCell(sessionIds),
      escapeCsvCell(recordingIds),
      escapeCsvCell(followUpIds),
    ];
    return cells.join(',');
  });

  // BOM + header + rows
  return '\uFEFF' + headerRow + '\n' + rows.join('\n');
}

/**
 * Triggers a browser file download for CSV content.
 */
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parses a CSV string into an array of CsvCompanyRow objects.
 * BOM-safe. Non-fatal on JSON parse failures (warns instead of errors).
 */
export function parseLeadsCSV(csvText: string): ParseResult {
  const errors: Array<{ line: number; message: string }> = [];
  const warnings: Array<{ line: number; message: string }> = [];

  // Strip BOM if present
  const text = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;

  // Split into lines while respecting quoted multiline fields
  const lines = splitCsvIntoLines(text);

  if (lines.length < 2) {
    errors.push({ line: 1, message: 'CSV file is empty or has no data rows.' });
    return { rows: [], errors, warnings };
  }

  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());

  // Validate required headers
  if (!headers.includes('id') || !headers.includes('company_name')) {
    errors.push({ line: 1, message: 'CSV must have at minimum the columns: id, company_name' });
    return { rows: [], errors, warnings };
  }

  const rows: CsvCompanyRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i].trim();
    if (!line) continue;

    const cells = splitCsvLine(line);

    const get = (col: string): string => {
      const idx = headers.indexOf(col);
      if (idx === -1) return '';
      return (cells[idx] ?? '').trim();
    };

    // Parse phone_numbers_json
    const phoneJsonRaw = get('phone_numbers_json');
    let phoneNumbersJson: CsvPhoneEntry[] = [];
    if (phoneJsonRaw) {
      const parsed = parseCsvJsonCell<CsvPhoneEntry[]>(phoneJsonRaw);
      if (parsed && Array.isArray(parsed)) {
        phoneNumbersJson = parsed;
      } else if (phoneJsonRaw) {
        warnings.push({ line: lineNum, message: `Could not parse phone_numbers_json — field ignored.` });
      }
    }

    // Parse numeric reference fields
    const totalCalls = parseInt(get('total_calls'), 10) || 0;
    const totalPickups = parseInt(get('total_pickups'), 10) || 0;
    const appointmentSetCount = parseInt(get('appointment_set_count'), 10) || 0;

    // Parse semicolon-delimited ID lists
    const parseIdList = (col: string): string[] => {
      const raw = get(col);
      if (!raw) return [];
      return raw.split(';').map(s => s.trim()).filter(Boolean);
    };

    const companyName = get('company_name');
    if (!companyName) {
      warnings.push({ line: lineNum, message: 'Row has no company_name — skipped.' });
      continue;
    }

    rows.push({
      id: get('id'),
      company_name: companyName,
      owner_name: get('owner_name'),
      company_location: get('company_location'),
      google_maps_link: get('google_maps_link'),
      source: get('source'),
      instagram_handle: get('instagram_handle'),
      email: get('email'),
      status: get('status'),
      first_contacted: get('first_contacted'),
      last_contacted: get('last_contacted'),
      notes: get('notes'),
      contact_source: get('contact_source'),
      phone_numbers_json: phoneNumbersJson,
      total_calls: totalCalls,
      total_pickups: totalPickups,
      appointment_set_count: appointmentSetCount,
      last_call_time: get('last_call_time'),
      last_call_outcome: get('last_call_outcome'),
      session_ids: parseIdList('session_ids'),
      recording_ids: parseIdList('recording_ids'),
      follow_up_ids: parseIdList('follow_up_ids'),
    });
  }

  return { rows, errors, warnings };
}

/**
 * Splits CSV text into logical lines, respecting quoted multi-line fields.
 */
function splitCsvIntoLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++; // CRLF
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ============================================================================
// Diff Engine
// ============================================================================

/**
 * Normalizes a field value for diff comparison.
 */
export function normalizeFieldValue(field: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (SELECT_FIELDS.has(field)) return v.toLowerCase();
  if (DATE_FIELDS.has(field)) {
    // Compare only the date portion (YYYY-MM-DD), ignore time component
    if (!v) return '';
    // PocketBase date format: "2025-01-15 10:30:00.000Z" or ISO 8601
    return v.slice(0, 10);
  }
  return v;
}

let _diffCounter = 0;
function uniqueId(prefix = 'diff'): string {
  return `${prefix}-${++_diffCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Builds per-field diffs between a CSV row and a DB record.
 * Only includes fields that changed.
 */
export function buildFieldDiffs(csvRow: CsvCompanyRow, dbRecord: Company): FieldDiff[] {
  return IMPORTABLE_FIELDS.map(field => {
    const csvVal = (csvRow as unknown as Record<string, string>)[field] ?? '';
    const dbVal = (dbRecord as Record<string, unknown>)[field] as string | undefined ?? '';

    const csvNorm = normalizeFieldValue(field, csvVal);
    const dbNorm = normalizeFieldValue(field, String(dbVal));

    return {
      field,
      label: FIELD_LABELS[field] ?? field,
      oldValue: String(dbVal),
      newValue: csvVal,
      hasChanged: csvNorm !== dbNorm,
      resolution: 'use_new' as FieldResolution,
    };
  });
}

/**
 * Builds phone number diffs: matches by pb_id first, then by phone_number string.
 */
export function buildPhoneNumberDiffs(
  csvPhones: CsvPhoneEntry[],
  dbPhones: PhoneNumber[]
): PhoneNumberDiff[] {
  const phoneFieldLabels: Record<string, string> = {
    phone_number: 'Phone Number',
    label: 'Label',
    location_name: 'Location Name',
    location_address: 'Location Address',
    receptionist_name: 'Receptionist Name',
    last_called: 'Last Called',
    total_calls: 'Total Calls',
    disassociated: 'Disassociated',
  };
  const phoneFields = ['phone_number', 'label', 'location_name', 'location_address', 'receptionist_name'];

  const diffs: PhoneNumberDiff[] = [];
  const matchedDbIds = new Set<string>();

  for (const csvPhone of csvPhones) {
    if (csvPhone.disassociated) continue; // Skip already-disassociated entries

    // Match by pb_id first
    let matched = csvPhone.pb_id ? dbPhones.find(p => p.id === csvPhone.pb_id) : undefined;
    // Fallback: match by phone_number string (normalized)
    if (!matched) {
      matched = dbPhones.find(
        p => !matchedDbIds.has(p.id) && p.phone_number.trim() === csvPhone.phone_number.trim()
      );
    }

    if (matched) {
      matchedDbIds.add(matched.id);
      const fieldDiffs: FieldDiff[] = phoneFields.map(f => {
        const csvVal = String((csvPhone as unknown as Record<string, unknown>)[f] ?? '');
        const dbVal = String((matched as unknown as Record<string, unknown>)[f] ?? '');
        return {
          field: f,
          label: phoneFieldLabels[f] ?? f,
          oldValue: dbVal,
          newValue: csvVal,
          hasChanged: csvVal.trim() !== dbVal.trim(),
          resolution: 'use_new' as FieldResolution,
        };
      }).filter(d => d.hasChanged);

      const hasChanges = fieldDiffs.length > 0;
      diffs.push({
        diffId: uniqueId('phone'),
        action: hasChanges ? 'update' : 'unchanged',
        pbId: matched.id,
        csvData: csvPhone,
        dbData: matched,
        fieldDiffs,
        resolution: hasChanges ? 'apply' : 'skip',
      });
    } else {
      // Not found → ADD
      diffs.push({
        diffId: uniqueId('phone'),
        action: 'add',
        csvData: csvPhone,
        fieldDiffs: [],
        resolution: 'apply',
      });
    }
  }

  // DB phones not matched by CSV → REMOVE (soft-delete)
  for (const dbPhone of dbPhones) {
    if (!matchedDbIds.has(dbPhone.id) && !dbPhone.disassociated) {
      diffs.push({
        diffId: uniqueId('phone'),
        action: 'remove',
        pbId: dbPhone.id,
        dbData: dbPhone,
        fieldDiffs: [],
        resolution: 'apply',
      });
    }
  }

  return diffs;
}

/**
 * Main diff engine.
 * Matches: 1) by id, 2) by company_name (case-insensitive), 3) new / deleted.
 * Output order: updates → creates → deletes → unchanged.
 */
export function buildDiff(
  csvRows: CsvCompanyRow[],
  dbCompanies: Company[],
  dbPhoneMap: Map<string, PhoneNumber[]>
): CompanyDiff[] {
  const dbById = new Map(dbCompanies.map(c => [c.id, c]));
  const dbByName = new Map(dbCompanies.map(c => [c.company_name.trim().toLowerCase(), c]));
  const matchedDbIds = new Set<string>();

  const updates: CompanyDiff[] = [];
  const creates: CompanyDiff[] = [];

  for (const csvRow of csvRows) {
    let dbRecord: Company | undefined;
    let matchType: CompanyDiff['matchType'] = 'new';
    let isAmbiguous = false;

    // 1. Match by ID
    if (csvRow.id && dbById.has(csvRow.id)) {
      dbRecord = dbById.get(csvRow.id);
      matchType = 'id';
    }
    // 2. Match by name
    if (!dbRecord) {
      const nameKey = csvRow.company_name.trim().toLowerCase();
      const candidate = dbByName.get(nameKey);
      if (candidate) {
        // Check for multiple companies with same name
        const nameMatches = dbCompanies.filter(
          c => c.company_name.trim().toLowerCase() === nameKey
        );
        isAmbiguous = nameMatches.length > 1;
        dbRecord = candidate;
        matchType = 'name';
      }
    }

    if (dbRecord) {
      matchedDbIds.add(dbRecord.id);
      const fieldDiffs = buildFieldDiffs(csvRow, dbRecord);
      const phoneNumberDiffs = buildPhoneNumberDiffs(
        csvRow.phone_numbers_json,
        dbPhoneMap.get(dbRecord.id) ?? []
      );

      const hasFieldChanges = fieldDiffs.some(d => d.hasChanged);
      const hasPhoneChanges = phoneNumberDiffs.some(d => d.action !== 'unchanged');
      const action: CompanyAction = (hasFieldChanges || hasPhoneChanges) ? 'update' : 'unchanged';

      const diff: CompanyDiff = {
        rowId: uniqueId('company'),
        action,
        matchType,
        isAmbiguous,
        csvRow,
        dbRecord,
        fieldDiffs,
        phoneNumberDiffs,
        companyResolution: action === 'unchanged' ? 'skip' : 'apply',
        isExpanded: false,
      };

      if (action === 'update') {
        updates.push(diff);
      } else {
        updates.push(diff); // unchanged goes after — we'll sort below
      }
    } else {
      // New company
      creates.push({
        rowId: uniqueId('company'),
        action: 'create',
        matchType: 'new',
        csvRow,
        fieldDiffs: [],
        phoneNumberDiffs: [],
        companyResolution: 'apply',
        isExpanded: false,
      });
    }
  }

  // DB companies not matched → deleted candidates
  const deletes: CompanyDiff[] = [];
  for (const dbCompany of dbCompanies) {
    if (!matchedDbIds.has(dbCompany.id)) {
      deletes.push({
        rowId: uniqueId('company'),
        action: 'delete',
        matchType: 'deleted',
        dbRecord: dbCompany,
        fieldDiffs: [],
        phoneNumberDiffs: [],
        companyResolution: 'skip', // Default to skip for safety
        isExpanded: false,
      });
    }
  }

  // Sort: updates first, then creates, then deletes, then unchanged
  const actualUpdates = updates.filter(d => d.action === 'update');
  const unchanged = updates.filter(d => d.action === 'unchanged');

  return [...actualUpdates, ...creates, ...deletes, ...unchanged];
}

/**
 * Pure function — applies bulk resolutions to a diff array.
 */
export function applyBulkResolution(
  diffs: CompanyDiff[],
  companyResolution: CompanyResolution | null,
  fieldResolution: FieldResolution | null,
  filterByAction?: CompanyAction
): CompanyDiff[] {
  return diffs.map(diff => {
    if (filterByAction && diff.action !== filterByAction) return diff;

    const newDiff = { ...diff };

    if (companyResolution !== null) {
      newDiff.companyResolution = companyResolution;
    }

    if (fieldResolution !== null) {
      newDiff.fieldDiffs = diff.fieldDiffs.map(fd => ({
        ...fd,
        resolution: fieldResolution,
      }));
      newDiff.phoneNumberDiffs = diff.phoneNumberDiffs.map(pd => ({
        ...pd,
        resolution: fieldResolution === 'use_new' ? 'apply' : 'skip',
      }));
    }

    return newDiff;
  });
}

/**
 * Counts diffs by action where companyResolution = 'apply'.
 */
export function countAppliedDiffsByAction(diffs: CompanyDiff[], action: CompanyAction): number {
  return diffs.filter(d => d.action === action && d.companyResolution === 'apply').length;
}

// ============================================================================
// PocketBase Data Fetching
// ============================================================================

/**
 * Fetches all phone numbers for given company IDs in batches of 50.
 * Returns Map<companyId, PhoneNumber[]>.
 */
export async function fetchPhoneNumbersForCompanies(
  ids: string[]
): Promise<Map<string, PhoneNumber[]>> {
  const result = new Map<string, PhoneNumber[]>();
  if (ids.length === 0) return result;

  const batchSize = 50;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const filter = batch.map(id => `company = "${id}"`).join(' || ');
    try {
      const phones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
        filter,
        sort: 'created',
      });
      for (const phone of phones) {
        const list = result.get(phone.company) ?? [];
        list.push(phone);
        result.set(phone.company, list);
      }
    } catch (err) {
      console.error('Failed to fetch phone numbers batch:', err);
    }
  }

  return result;
}

/**
 * Fetches aggregated call stats for given company IDs.
 * Returns Map<companyId, CompanyCallStats>.
 */
export async function fetchCallStatsForCompanies(
  ids: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, CompanyCallStats>> {
  const result = new Map<string, CompanyCallStats>();
  if (ids.length === 0) return result;

  const batchSize = 30;
  const totalBatches = Math.ceil(ids.length / batchSize);

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize) + 1;
    onProgress?.(batchIndex, totalBatches);

    const batch = ids.slice(i, i + batchSize);
    const filter = batch.map(id => `company = "${id}"`).join(' || ');

    try {
      const callLogs = await pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
        filter,
        sort: '-call_time',
        fields: 'id,company,call_outcome,call_time,owner_reached,appointment_set,session',
      });

      // Aggregate per company
      const companyMap = new Map<string, CallLog[]>();
      for (const log of callLogs) {
        const list = companyMap.get(log.company) ?? [];
        list.push(log);
        companyMap.set(log.company, list);
      }

      for (const companyId of batch) {
        const logs = companyMap.get(companyId) ?? [];
        const sessionIds = [...new Set(logs.map(l => l.session).filter(Boolean) as string[])];
        const mostRecent = logs[0]; // already sorted by -call_time

        result.set(companyId, {
          total_calls: logs.length,
          total_pickups: logs.filter(l => !l.call_outcome?.includes('No Answer')).length,
          appointment_set_count: logs.filter(l => l.appointment_set).length,
          last_call_time: mostRecent?.call_time ?? '',
          last_call_outcome: Array.isArray(mostRecent?.call_outcome) ? mostRecent.call_outcome.join(', ') : (mostRecent?.call_outcome ?? ''),
          session_ids: sessionIds,
          recording_ids: [], // populated below
          follow_up_ids: [], // populated below
        });
      }
    } catch (err) {
      console.error('Failed to fetch call logs batch:', err);
    }
  }

  // Fetch recording IDs
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const filter = batch.map(id => `company = "${id}"`).join(' || ');
    try {
      const recordings = await pb.collection(COLLECTIONS.RECORDINGS).getFullList({
        filter,
        fields: 'id,company',
      });
      for (const rec of recordings as unknown as Array<{ id: string; company: string }>) {
        const stats = result.get(rec.company);
        if (stats) stats.recording_ids.push(rec.id);
      }
    } catch (err) {
      console.error('Failed to fetch recordings batch:', err);
    }
  }

  // Fetch follow-up IDs (pending only)
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const companyFilter = batch.map(id => `company = "${id}"`).join(' || ');
    const filter = `(${companyFilter}) && status = "pending"`;
    try {
      const followUps = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList({
        filter,
        fields: 'id,company',
      });
      for (const fu of followUps as unknown as Array<{ id: string; company: string }>) {
        const stats = result.get(fu.company);
        if (stats) stats.follow_up_ids.push(fu.id);
      }
    } catch (err) {
      console.error('Failed to fetch follow-ups batch:', err);
    }
  }

  return result;
}
