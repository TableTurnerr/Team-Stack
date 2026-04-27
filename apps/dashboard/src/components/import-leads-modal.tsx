'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  X,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Plus,
  Minus,
  RefreshCw,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company } from '@/lib/types';
import { cn, extractWebsiteFromName } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import {
  parseLeadsCSV,
  buildDiff,
  applyBulkResolution,
  fetchPhoneNumbersForCompanies,
  countAppliedDiffsByAction,
  FIELD_LABELS,
  type CsvCompanyRow,
  type CompanyDiff,
  type FieldDiff,
  type PhoneNumberDiff,
  type CompanyAction,
  type CompanyResolution,
  type FieldResolution,
  type PhoneResolution,
} from '@/lib/csv-utils';
import type { PhoneNumber } from '@/lib/types';

// ============================================================================
// Types
// ============================================================================

type ImportStage = 'drop' | 'parsing' | 'parse_error' | 'matching' | 'review' | 'applying' | 'done';
type FilterTab = 'all' | 'update' | 'create' | 'delete' | 'unchanged';

interface ApplyLog {
  type: 'info' | 'success' | 'error';
  message: string;
}

interface ImportSummary {
  updated: number;
  created: number;
  deleted: number;
  failed: number;
  phoneAdded: number;
  phoneUpdated: number;
  phoneRemoved: number;
}

interface ImportLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

// ============================================================================
// Sub-components
// ============================================================================

function SummaryBar({ diffs }: { diffs: CompanyDiff[] }) {
  const updates = diffs.filter(d => d.action === 'update').length;
  const creates = diffs.filter(d => d.action === 'create').length;
  const deletes = diffs.filter(d => d.action === 'delete').length;
  const unchanged = diffs.filter(d => d.action === 'unchanged').length;

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {updates > 0 && (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--warning-subtle)] text-[var(--warning)]">
          {updates} to update
        </span>
      )}
      {creates > 0 && (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--success-subtle)] text-[var(--success)]">
          {creates} to create
        </span>
      )}
      {deletes > 0 && (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--error-subtle)] text-[var(--error)]">
          {deletes} to delete
        </span>
      )}
      {unchanged > 0 && (
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--card-hover)] text-[var(--muted)]">
          {unchanged} unchanged
        </span>
      )}
    </div>
  );
}

function ActionBadge({ action }: { action: CompanyAction }) {
  const map: Record<CompanyAction, { label: string; className: string }> = {
    update: { label: 'UPDATE', className: 'bg-[var(--warning-subtle)] text-[var(--warning)]' },
    create: { label: 'CREATE', className: 'bg-[var(--success-subtle)] text-[var(--success)]' },
    delete: { label: 'DELETE', className: 'bg-[var(--error-subtle)] text-[var(--error)]' },
    unchanged: { label: 'UNCHANGED', className: 'bg-[var(--card-hover)] text-[var(--muted)]' },
  };
  const { label, className } = map[action];
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide', className)}>
      {label}
    </span>
  );
}

function FieldToggle({
  resolution,
  onChange,
  disabled,
}: {
  resolution: FieldResolution;
  onChange: (r: FieldResolution) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex rounded-md overflow-hidden border border-[var(--card-border)] text-xs shrink-0">
      <button
        onClick={() => !disabled && onChange('use_old')}
        disabled={disabled}
        className={cn(
          'px-2 py-1 transition-colors',
          resolution === 'use_old'
            ? 'bg-[var(--card-bg)] text-[var(--foreground)] font-medium'
            : 'bg-transparent text-[var(--muted)] hover:bg-[var(--card-hover)]'
        )}
      >
        Old
      </button>
      <button
        onClick={() => !disabled && onChange('use_new')}
        disabled={disabled}
        className={cn(
          'px-2 py-1 transition-colors border-l border-[var(--card-border)]',
          resolution === 'use_new'
            ? 'bg-[var(--primary-subtle)] text-[var(--primary)] font-medium'
            : 'bg-transparent text-[var(--muted)] hover:bg-[var(--card-hover)]'
        )}
      >
        New
      </button>
    </div>
  );
}

function FieldDiffTable({
  fieldDiffs,
  onFieldResolution,
  onBulkOld,
  onBulkNew,
  disabled,
}: {
  fieldDiffs: FieldDiff[];
  onFieldResolution: (field: string, resolution: FieldResolution) => void;
  onBulkOld: () => void;
  onBulkNew: () => void;
  disabled?: boolean;
}) {
  const changed = fieldDiffs.filter(f => f.hasChanged);
  const unchanged = fieldDiffs.filter(f => !f.hasChanged);

  if (changed.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Field Changes</p>
        <div className="flex gap-1">
          <button
            onClick={onBulkOld}
            disabled={disabled}
            className="px-2 py-0.5 text-xs rounded border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
          >
            Keep all old
          </button>
          <button
            onClick={onBulkNew}
            disabled={disabled}
            className="px-2 py-0.5 text-xs rounded border border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary)] hover:opacity-80 transition-colors disabled:opacity-50"
          >
            Use all new
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-[var(--card-border)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--card-bg)]">
              <th className="px-3 py-2 text-left text-[var(--muted)] font-medium w-28">Field</th>
              <th className="px-3 py-2 text-left text-[var(--muted)] font-medium">Current (DB)</th>
              <th className="px-3 py-2 text-left text-[var(--muted)] font-medium">Incoming (CSV)</th>
              <th className="px-3 py-2 text-right text-[var(--muted)] font-medium">Use</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--card-border)]">
            {changed.map(fd => (
              <tr key={fd.field} className="hover:bg-[var(--card-hover)] transition-colors">
                <td className="px-3 py-2 font-medium text-[var(--muted)]">{fd.label}</td>
                <td className="px-3 py-2 max-w-0">
                  <span className="block truncate text-[var(--foreground)] opacity-60">
                    {fd.oldValue || <span className="italic text-[var(--muted)]">empty</span>}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-0">
                  <span className={cn(
                    'block truncate font-medium',
                    fd.resolution === 'use_new' ? 'text-[var(--primary)]' : 'text-[var(--foreground)]'
                  )}>
                    {fd.newValue || <span className="italic text-[var(--muted)] font-normal">empty</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <FieldToggle
                    resolution={fd.resolution}
                    onChange={r => onFieldResolution(fd.field, r)}
                    disabled={disabled}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {unchanged.length > 0 && (
          <div className="px-3 py-2 text-xs text-[var(--muted)] border-t border-[var(--card-border)] bg-[var(--card-bg)]">
            {unchanged.length} field{unchanged.length !== 1 ? 's' : ''} unchanged
          </div>
        )}
      </div>
    </div>
  );
}

function PhoneDiffList({
  phoneDiffs,
  onPhoneResolution,
  disabled,
}: {
  phoneDiffs: PhoneNumberDiff[];
  onPhoneResolution: (diffId: string, resolution: PhoneResolution) => void;
  disabled?: boolean;
}) {
  const actionable = phoneDiffs.filter(d => d.action !== 'unchanged');
  if (actionable.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">
        Phone Number Changes
      </p>
      <div className="space-y-1.5">
        {actionable.map(pd => (
          <div
            key={pd.diffId}
            className={cn(
              'flex items-start justify-between gap-3 p-2.5 rounded-lg border text-xs',
              pd.action === 'add' && 'border-[var(--success)] bg-[var(--success-subtle)]',
              pd.action === 'update' && 'border-[var(--primary)] bg-[var(--primary-subtle)]',
              pd.action === 'remove' && 'border-[var(--error)] bg-[var(--error-subtle)]',
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              {pd.action === 'add' && <Plus size={12} className="text-[var(--success)] mt-0.5 shrink-0" />}
              {pd.action === 'update' && <RefreshCw size={12} className="text-[var(--primary)] mt-0.5 shrink-0" />}
              {pd.action === 'remove' && <Minus size={12} className="text-[var(--error)] mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <span className="font-medium">
                  {pd.csvData?.phone_number ?? pd.dbData?.phone_number ?? ''}
                </span>
                {pd.csvData?.label && (
                  <span className="text-[var(--muted)] ml-1">({pd.csvData.label})</span>
                )}
                {pd.action === 'update' && pd.fieldDiffs.length > 0 && (
                  <div className="mt-1 text-[var(--muted)]">
                    {pd.fieldDiffs.map(f => (
                      <span key={f.field} className="mr-2">
                        {f.label}: {f.oldValue || '—'} → {f.newValue || '—'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => onPhoneResolution(pd.diffId, 'apply')}
                disabled={disabled}
                className={cn(
                  'px-2 py-0.5 rounded text-xs transition-colors',
                  pd.resolution === 'apply'
                    ? 'bg-[var(--foreground)] text-[var(--background)]'
                    : 'border border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                )}
              >
                Apply
              </button>
              <button
                onClick={() => onPhoneResolution(pd.diffId, 'skip')}
                disabled={disabled}
                className={cn(
                  'px-2 py-0.5 rounded text-xs transition-colors',
                  pd.resolution === 'skip'
                    ? 'bg-[var(--card-bg)] text-[var(--foreground)] border border-[var(--card-border)]'
                    : 'border border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                )}
              >
                Skip
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompanyDiffRow({
  diff,
  onToggleExpand,
  onCompanyResolution,
  onFieldResolution,
  onPhoneResolution,
  onBulkFieldOld,
  onBulkFieldNew,
  disabled,
}: {
  diff: CompanyDiff;
  onToggleExpand: () => void;
  onCompanyResolution: (r: CompanyResolution) => void;
  onFieldResolution: (field: string, r: FieldResolution) => void;
  onPhoneResolution: (diffId: string, r: PhoneResolution) => void;
  onBulkFieldOld: () => void;
  onBulkFieldNew: () => void;
  disabled?: boolean;
}) {
  const companyName =
    diff.csvRow?.company_name ?? diff.dbRecord?.company_name ?? '—';

  const changedFields = diff.fieldDiffs.filter(f => f.hasChanged).length;
  const phoneChanges = diff.phoneNumberDiffs.filter(p => p.action !== 'unchanged');
  const phoneAdded = phoneChanges.filter(p => p.action === 'add').length;
  const phoneRemoved = phoneChanges.filter(p => p.action === 'remove').length;
  const phoneUpdated = phoneChanges.filter(p => p.action === 'update').length;

  const isSkipped = diff.companyResolution === 'skip';

  return (
    <div className={cn(
      'border border-[var(--card-border)] rounded-lg overflow-hidden transition-opacity',
      isSkipped && 'opacity-50'
    )}>
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--card-hover)] transition-colors"
        onClick={onToggleExpand}
      >
        {/* Expand icon */}
        <span className="text-[var(--muted)] shrink-0">
          {diff.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        {/* Action badge */}
        <ActionBadge action={diff.action} />

        {/* Company name */}
        <span className="text-sm font-medium flex-1 min-w-0 truncate">
          {companyName}
          {diff.isAmbiguous && (
            <span className="ml-2 text-xs text-[var(--warning)]">(ambiguous name match)</span>
          )}
          {diff.matchType === 'name' && (
            <span className="ml-2 text-xs text-[var(--muted)]">matched by name</span>
          )}
        </span>

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-[var(--muted)] shrink-0">
          {changedFields > 0 && (
            <span>{changedFields} field{changedFields !== 1 ? 's' : ''}</span>
          )}
          {phoneChanges.length > 0 && (
            <span>
              {phoneAdded > 0 && <span className="text-[var(--success)]">+{phoneAdded}</span>}
              {phoneUpdated > 0 && <span className="text-[var(--primary)] ml-1">~{phoneUpdated}</span>}
              {phoneRemoved > 0 && <span className="text-[var(--error)] ml-1">-{phoneRemoved}</span>}
              {' '}phones
            </span>
          )}
        </div>

        {/* Status indicator / skip button */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          {diff.applyStatus === 'applied' && <CheckCircle size={14} className="text-[var(--success)]" />}
          {diff.applyStatus === 'error' && <AlertCircle size={14} className="text-[var(--error)]" />}
          {diff.applyStatus === 'applying' && <Loader2 size={14} className="animate-spin text-[var(--primary)]" />}
          {!diff.applyStatus && diff.action !== 'unchanged' && (
            <button
              onClick={() => onCompanyResolution(isSkipped ? 'apply' : 'skip')}
              disabled={disabled}
              className={cn(
                'px-2 py-0.5 text-xs rounded border transition-colors',
                isSkipped
                  ? 'border-[var(--card-border)] text-[var(--muted)] hover:bg-[var(--card-hover)]'
                  : 'border-[var(--card-border)] text-[var(--foreground)] hover:bg-[var(--card-hover)]'
              )}
            >
              {isSkipped ? 'Include' : 'Skip'}
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {diff.applyError && (
        <div className="px-3 py-2 text-xs text-[var(--error)] bg-[var(--error-subtle)] border-t border-[var(--card-border)]">
          {diff.applyError}
        </div>
      )}

      {/* Expanded content */}
      {diff.isExpanded && (
        <div className="px-3 pb-3 pt-2 border-t border-[var(--card-border)] space-y-4 bg-[var(--background)]">
          {diff.action === 'create' && diff.csvRow && (
            <div className="text-xs text-[var(--muted)] space-y-1">
              <p className="font-medium text-[var(--foreground)]">New company — all fields will be created:</p>
              {Object.entries(FIELD_LABELS).map(([field, label]) => {
                const val = (diff.csvRow as unknown as Record<string, unknown>)?.[field];
                if (!val) return null;
                return (
                  <div key={field} className="flex gap-2">
                    <span className="w-28 shrink-0 text-[var(--muted)]">{label}:</span>
                    <span className="text-[var(--foreground)] truncate">{String(val)}</span>
                  </div>
                );
              })}
              {diff.csvRow.phone_numbers_json.length > 0 && (
                <div className="flex gap-2">
                  <span className="w-28 shrink-0 text-[var(--muted)]">Phones:</span>
                  <span className="text-[var(--foreground)]">
                    {diff.csvRow.phone_numbers_json.map(p => p.phone_number).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {diff.action === 'delete' && diff.dbRecord && (
            <div className="text-xs p-3 rounded-lg bg-[var(--error-subtle)] text-[var(--error)]">
              <p className="font-medium">This company will be set to &ldquo;Excluded&rdquo; status (soft delete).</p>
              <p className="mt-1 text-[var(--muted)]">All related call logs, recordings, and history will be preserved.</p>
            </div>
          )}

          {diff.action === 'update' && (
            <>
              <FieldDiffTable
                fieldDiffs={diff.fieldDiffs}
                onFieldResolution={onFieldResolution}
                onBulkOld={onBulkFieldOld}
                onBulkNew={onBulkFieldNew}
                disabled={disabled}
              />
              <PhoneDiffList
                phoneDiffs={diff.phoneNumberDiffs}
                onPhoneResolution={onPhoneResolution}
                disabled={disabled}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Apply log component
// ============================================================================

function ApplyLogView({ logs }: { logs: ApplyLog[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={ref}
      className="h-48 overflow-y-auto rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] p-3 font-mono text-xs space-y-0.5"
    >
      {logs.map((log, i) => (
        <div
          key={i}
          className={cn(
            log.type === 'error' && 'text-[var(--error)]',
            log.type === 'success' && 'text-[var(--success)]',
            log.type === 'info' && 'text-[var(--muted)]',
          )}
        >
          {log.message}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Modal
// ============================================================================

export function ImportLeadsModal({ isOpen, onClose, onImportComplete }: ImportLeadsModalProps) {
  const { user } = useAuth();
  const [stage, setStage] = useState<ImportStage>('drop');
  const [parseError, setParseError] = useState('');
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<CsvCompanyRow[]>([]);
  const [diffs, setDiffs] = useState<CompanyDiff[]>([]);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [showDeletedInDiff, setShowDeletedInDiff] = useState(false);
  const [applyLogs, setApplyLogs] = useState<ApplyLog[]>([]);
  const [applyProgress, setApplyProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [matchingProgress, setMatchingProgress] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setStage('drop');
    setParseError('');
    setParseWarnings([]);
    setParsedRows([]);
    setDiffs([]);
    setFilterTab('all');
    setShowDeletedInDiff(false);
    setApplyLogs([]);
    setSummary(null);
    setIsMinimized(false);
    onClose();
  };

  const addLog = (log: ApplyLog) => {
    setApplyLogs(prev => [...prev, log]);
  };

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFileSelect = (file: File) => {
    setStage('parsing');
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const result = parseLeadsCSV(text);
      if (result.errors.length > 0) {
        setParseError(result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n'));
        setStage('parse_error');
        return;
      }
      if (result.warnings.length > 0) {
        setParseWarnings(result.warnings.map(w => `Line ${w.line}: ${w.message}`));
      }
      setParsedRows(result.rows);
      runMatchingPhase(result.rows);
    };
    reader.onerror = () => {
      setParseError('Could not read the file. Please try again.');
      setStage('parse_error');
    };
    reader.readAsText(file, 'utf-8');
  };

  const runMatchingPhase = async (rows: CsvCompanyRow[]) => {
    setStage('matching');
    setMatchingProgress('Fetching companies from database...');
    try {
      const dbCompanies = await pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
        fields: 'id,company_name,owner_name,company_location,google_maps_link,phone_numbers,source,instagram_handle,email,status,first_contacted,last_contacted,notes,contact_source',
        sort: 'company_name',
      });

      setMatchingProgress('Fetching phone numbers...');
      const dbPhoneMap = await fetchPhoneNumbersForCompanies(dbCompanies.map(c => c.id));

      setMatchingProgress('Computing diff...');
      const computed = buildDiff(rows, dbCompanies, dbPhoneMap);
      setDiffs(computed);
      setStage('review');
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Failed to fetch database records.');
      setStage('parse_error');
    }
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      handleFileSelect(file);
    }
  };

  // ── Diff state updaters ────────────────────────────────────────────────────

  const updateDiff = (rowId: string, updater: (d: CompanyDiff) => CompanyDiff) => {
    setDiffs(prev => prev.map(d => d.rowId === rowId ? updater(d) : d));
  };

  const handleCompanyResolution = (rowId: string, resolution: CompanyResolution) => {
    updateDiff(rowId, d => ({ ...d, companyResolution: resolution }));
  };

  const handleFieldResolution = (rowId: string, field: string, resolution: FieldResolution) => {
    updateDiff(rowId, d => ({
      ...d,
      fieldDiffs: d.fieldDiffs.map(fd => fd.field === field ? { ...fd, resolution } : fd),
    }));
  };

  const handlePhoneResolution = (rowId: string, diffId: string, resolution: PhoneResolution) => {
    updateDiff(rowId, d => ({
      ...d,
      phoneNumberDiffs: d.phoneNumberDiffs.map(pd => pd.diffId === diffId ? { ...pd, resolution } : pd),
    }));
  };

  const handleBulkFieldOld = (rowId: string) => {
    updateDiff(rowId, d => ({
      ...d,
      fieldDiffs: d.fieldDiffs.map(fd => ({ ...fd, resolution: 'use_old' })),
    }));
  };

  const handleBulkFieldNew = (rowId: string) => {
    updateDiff(rowId, d => ({
      ...d,
      fieldDiffs: d.fieldDiffs.map(fd => ({ ...fd, resolution: 'use_new' })),
    }));
  };

  const handleToggleExpand = (rowId: string) => {
    updateDiff(rowId, d => ({ ...d, isExpanded: !d.isExpanded }));
  };

  const handleBulkAction = (action: string) => {
    switch (action) {
      case 'apply_all':
        setDiffs(applyBulkResolution(diffs, 'apply', null));
        break;
      case 'skip_all':
        setDiffs(applyBulkResolution(diffs, 'skip', null));
        break;
      case 'apply_updates':
        setDiffs(applyBulkResolution(diffs, 'apply', null, 'update'));
        break;
      case 'apply_creates':
        setDiffs(applyBulkResolution(diffs, 'apply', null, 'create'));
        break;
      case 'skip_deletes':
        setDiffs(applyBulkResolution(diffs, 'skip', null, 'delete'));
        break;
      case 'use_new_all':
        setDiffs(applyBulkResolution(diffs, null, 'use_new'));
        break;
      case 'use_old_all':
        setDiffs(applyBulkResolution(diffs, null, 'use_old'));
        break;
    }
  };

  // ── Apply logic ────────────────────────────────────────────────────────────

  const handleApply = async () => {
    const toApply = diffs.filter(d => d.companyResolution === 'apply' && d.action !== 'unchanged');
    if (toApply.length === 0) return;

    setStage('applying');
    setApplyLogs([]);
    setApplyProgress({ current: 0, total: toApply.length });

    const summary: ImportSummary = {
      updated: 0, created: 0, deleted: 0, failed: 0,
      phoneAdded: 0, phoneUpdated: 0, phoneRemoved: 0,
    };

    // Mark all as pending
    setDiffs(prev => prev.map(d => ({
      ...d,
      applyStatus: d.companyResolution === 'apply' && d.action !== 'unchanged' ? 'pending' : d.applyStatus,
    })));

    const process = async (diff: CompanyDiff, index: number) => {
      setApplyProgress({ current: index + 1, total: toApply.length });
      updateDiff(diff.rowId, d => ({ ...d, applyStatus: 'applying' }));

      try {
        if (diff.action === 'create' && diff.csvRow) {
          addLog({ type: 'info', message: `Creating: ${diff.csvRow.company_name}` });
          const payload: Partial<Company> = buildCompanyPayloadFromCsv(diff.csvRow);
          if (!payload.assigned_to && user?.id) payload.assigned_to = user.id;
          const created = await pb.collection(COLLECTIONS.COMPANIES).create<Company>(payload);

          // Create phone numbers
          for (const pd of diff.phoneNumberDiffs.filter(p => p.action === 'add' && p.resolution === 'apply')) {
            if (!pd.csvData) continue;
            await pb.collection(COLLECTIONS.PHONE_NUMBERS).create({
              company: created.id,
              phone_number: pd.csvData.phone_number,
              label: pd.csvData.label ?? '',
              location_name: pd.csvData.location_name ?? '',
              location_address: pd.csvData.location_address ?? '',
              receptionist_name: pd.csvData.receptionist_name ?? '',
            });
            summary.phoneAdded++;
          }

          summary.created++;
          addLog({ type: 'success', message: `  ✓ Created: ${created.company_name} (${created.id})` });
          updateDiff(diff.rowId, d => ({ ...d, applyStatus: 'applied' }));

        } else if (diff.action === 'update' && diff.dbRecord) {
          addLog({ type: 'info', message: `Updating: ${diff.dbRecord.company_name}` });

          // Build payload from field diffs where resolution = use_new
          const payload: Partial<Company> = {};
          for (const fd of diff.fieldDiffs) {
            if (fd.hasChanged && fd.resolution === 'use_new') {
              (payload as Record<string, unknown>)[fd.field] = fd.newValue;
            }
          }
          if (Object.keys(payload).length > 0) {
            await pb.collection(COLLECTIONS.COMPANIES).update(diff.dbRecord.id, payload);
          }

          // Phone number changes
          const companyId = diff.dbRecord.id;
          for (const pd of diff.phoneNumberDiffs) {
            if (pd.resolution !== 'apply') continue;
            if (pd.action === 'add' && pd.csvData) {
              await pb.collection(COLLECTIONS.PHONE_NUMBERS).create({
                company: companyId,
                phone_number: pd.csvData.phone_number,
                label: pd.csvData.label ?? '',
                location_name: pd.csvData.location_name ?? '',
                location_address: pd.csvData.location_address ?? '',
                receptionist_name: pd.csvData.receptionist_name ?? '',
              });
              summary.phoneAdded++;
            } else if (pd.action === 'update' && pd.pbId && pd.csvData) {
              const phonePayload: Record<string, unknown> = {};
              for (const fd of pd.fieldDiffs) {
                if (fd.resolution === 'use_new') phonePayload[fd.field] = fd.newValue;
              }
              if (Object.keys(phonePayload).length > 0) {
                await pb.collection(COLLECTIONS.PHONE_NUMBERS).update(pd.pbId, phonePayload);
                summary.phoneUpdated++;
              }
            } else if (pd.action === 'remove' && pd.pbId) {
              // Soft delete
              await pb.collection(COLLECTIONS.PHONE_NUMBERS).update(pd.pbId, { disassociated: true });
              summary.phoneRemoved++;
            }
          }

          summary.updated++;
          addLog({ type: 'success', message: `  ✓ Updated: ${diff.dbRecord.company_name}` });
          updateDiff(diff.rowId, d => ({ ...d, applyStatus: 'applied' }));

        } else if (diff.action === 'delete' && diff.dbRecord) {
          addLog({ type: 'info', message: `Excluding: ${diff.dbRecord.company_name}` });
          await pb.collection(COLLECTIONS.COMPANIES).update(diff.dbRecord.id, {
            status: 'Excluded',
          });
          summary.deleted++;
          addLog({ type: 'success', message: `  ✓ Excluded: ${diff.dbRecord.company_name}` });
          updateDiff(diff.rowId, d => ({ ...d, applyStatus: 'applied' }));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        addLog({ type: 'error', message: `  ✗ Failed: ${diff.csvRow?.company_name ?? diff.dbRecord?.company_name} — ${msg}` });
        summary.failed++;
        updateDiff(diff.rowId, d => ({ ...d, applyStatus: 'error', applyError: msg }));
      }

      // Rate-limit delay every 10 ops
      if ((index + 1) % 10 === 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    };

    // Creates first, then updates, then deletes
    const creates = toApply.filter(d => d.action === 'create');
    const updates = toApply.filter(d => d.action === 'update');
    const deletes = toApply.filter(d => d.action === 'delete');
    const ordered = [...creates, ...updates, ...deletes];

    for (let i = 0; i < ordered.length; i++) {
      await process(ordered[i], i);
    }

    addLog({ type: 'info', message: `Done. Updated: ${summary.updated}, Created: ${summary.created}, Deleted: ${summary.deleted}, Failed: ${summary.failed}` });
    setSummary(summary);
    setStage('done');
    onImportComplete();
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function buildCompanyPayloadFromCsv(row: CsvCompanyRow): Partial<Company> {
    return {
      company_name: row.company_name,
      owner_name: row.owner_name || undefined,
      company_location: row.company_location || undefined,
      google_maps_link: row.google_maps_link || undefined,
      website: extractWebsiteFromName(row.company_name),
      source: row.source || undefined,
      instagram_handle: row.instagram_handle || undefined,
      email: row.email || undefined,
      status: row.status ? (Array.isArray(row.status) ? row.status : [row.status]) as string[] : undefined,
      first_contacted: row.first_contacted || undefined,
      last_contacted: row.last_contacted || undefined,
      notes: row.notes || undefined,
      contact_source: row.contact_source || undefined,
    };
  }

  // ── Filtered diffs for display ─────────────────────────────────────────────

  const visibleDiffs = diffs.filter(d => {
    if (!showDeletedInDiff && d.action === 'delete') return false;
    if (filterTab === 'all') return true;
    return d.action === filterTab;
  });

  const totalToApply = diffs.filter(d => d.companyResolution === 'apply' && d.action !== 'unchanged').length;
  const hasDeletes = diffs.some(d => d.action === 'delete');

  // ── Render ─────────────────────────────────────────────────────────────────

  // Minimized floating widget during apply
  if (isMinimized && stage === 'applying') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-[var(--background)] border border-[var(--card-border)] rounded-xl shadow-2xl p-4 w-72">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Applying import...</span>
          <button onClick={() => setIsMinimized(false)} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <Maximize2 size={14} />
          </button>
        </div>
        <div className="w-full bg-[var(--card-border)] rounded-full h-1.5 mb-2">
          <div
            className="bg-[var(--primary)] h-1.5 rounded-full transition-all"
            style={{ width: `${applyProgress.total ? (applyProgress.current / applyProgress.total) * 100 : 0}%` }}
          />
        </div>
        <p className="text-xs text-[var(--muted)]">{applyProgress.current} / {applyProgress.total} changes applied</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={cn(
        'bg-[var(--background)] border border-[var(--card-border)] rounded-xl shadow-2xl flex flex-col w-full',
        stage === 'review' ? 'max-w-4xl max-h-[90vh]' : 'max-w-lg',
      )}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--card-border)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--primary-subtle)]">
              <Upload size={18} className="text-[var(--primary)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Import Companies</h2>
              <p className="text-xs text-[var(--muted)] capitalize">
                {stage === 'drop' && 'Upload a CSV file to import'}
                {stage === 'parsing' && 'Reading file...'}
                {stage === 'parse_error' && 'File error'}
                {stage === 'matching' && matchingProgress}
                {stage === 'review' && `Review ${diffs.length} companies`}
                {stage === 'applying' && `Applying ${applyProgress.current} / ${applyProgress.total} changes`}
                {stage === 'done' && 'Import complete'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stage === 'applying' && (
              <button
                onClick={() => setIsMinimized(true)}
                className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors"
                title="Minimize"
              >
                <Minimize2 size={14} />
              </button>
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">

          {/* Drop zone */}
          {stage === 'drop' && (
            <div
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-xl p-12 text-center transition-colors',
                isDragOver
                  ? 'border-[var(--primary)] bg-[var(--primary-subtle)]'
                  : 'border-[var(--card-border)] hover:border-[var(--primary)] hover:bg-[var(--card-hover)]'
              )}
            >
              <FileText size={40} className="mx-auto text-[var(--muted)] mb-4" />
              <p className="text-sm font-medium mb-1">Drag & drop your leads CSV here</p>
              <p className="text-xs text-[var(--muted)] mb-4">
                CSV must be exported from this app (must have <code className="font-mono">id</code> and <code className="font-mono">company_name</code> columns)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors"
              >
                Browse Files
              </button>
            </div>
          )}

          {/* Parsing */}
          {(stage === 'parsing' || stage === 'matching') && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {stage === 'parsing' ? 'Reading CSV...' : 'Matching records...'}
                </p>
                {stage === 'matching' && (
                  <p className="text-xs text-[var(--muted)] mt-1">{matchingProgress}</p>
                )}
              </div>
            </div>
          )}

          {/* Parse error */}
          {stage === 'parse_error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--error-subtle)] border border-[var(--error)]">
                <AlertCircle size={18} className="text-[var(--error)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[var(--error)]">Could not process file</p>
                  <pre className="text-xs text-[var(--muted)] mt-1 whitespace-pre-wrap">{parseError}</pre>
                </div>
              </div>
              <button
                onClick={() => {
                  setStage('drop');
                  setParseError('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
              >
                Try Another File
              </button>
            </div>
          )}

          {/* Review stage */}
          {stage === 'review' && (
            <div className="space-y-4">
              {/* Warnings */}
              {parseWarnings.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] text-xs">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Parsing warnings ({parseWarnings.length})</p>
                    <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
                      {parseWarnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
                      {parseWarnings.length > 3 && <li>...and {parseWarnings.length - 3} more</li>}
                    </ul>
                  </div>
                </div>
              )}

              <SummaryBar diffs={diffs} />

              {/* Controls row */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Filter tabs */}
                <div className="flex rounded-lg border border-[var(--card-border)] overflow-hidden text-xs">
                  {(['all', 'update', 'create', 'delete', 'unchanged'] as FilterTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setFilterTab(tab)}
                      className={cn(
                        'px-2.5 py-1.5 capitalize transition-colors border-r border-[var(--card-border)] last:border-r-0',
                        filterTab === tab
                          ? 'bg-[var(--foreground)] text-[var(--background)]'
                          : 'hover:bg-[var(--card-hover)] text-[var(--muted)]'
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Bulk actions */}
                <select
                  onChange={e => { handleBulkAction(e.target.value); e.target.value = ''; }}
                  defaultValue=""
                  className="px-2 py-1.5 text-xs rounded-lg border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors cursor-pointer"
                >
                  <option value="" disabled>Bulk actions...</option>
                  <option value="apply_all">Apply all changes</option>
                  <option value="skip_all">Skip all changes</option>
                  <option value="apply_updates">Apply updates only</option>
                  <option value="apply_creates">Apply creates only</option>
                  <option value="skip_deletes">Skip all deletes</option>
                  <option value="use_new_all">Use new values for all fields</option>
                  <option value="use_old_all">Keep old values for all fields</option>
                </select>

                {/* Show deleted toggle */}
                {hasDeletes && (
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-auto">
                    <input
                      type="checkbox"
                      checked={showDeletedInDiff}
                      onChange={e => setShowDeletedInDiff(e.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    Show deleted ({diffs.filter(d => d.action === 'delete').length})
                  </label>
                )}
              </div>

              {/* Diff list */}
              <div className="space-y-2">
                {visibleDiffs.length === 0 ? (
                  <p className="text-sm text-[var(--muted)] text-center py-8">No items in this category</p>
                ) : (
                  visibleDiffs.map(diff => (
                    <CompanyDiffRow
                      key={diff.rowId}
                      diff={diff}
                      onToggleExpand={() => handleToggleExpand(diff.rowId)}
                      onCompanyResolution={r => handleCompanyResolution(diff.rowId, r)}
                      onFieldResolution={(field, r) => handleFieldResolution(diff.rowId, field, r)}
                      onPhoneResolution={(diffId, r) => handlePhoneResolution(diff.rowId, diffId, r)}
                      onBulkFieldOld={() => handleBulkFieldOld(diff.rowId)}
                      onBulkFieldNew={() => handleBulkFieldNew(diff.rowId)}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          {/* Applying stage */}
          {stage === 'applying' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted)]">Progress</span>
                  <span className="font-medium">{applyProgress.current} / {applyProgress.total}</span>
                </div>
                <div className="w-full bg-[var(--card-border)] rounded-full h-2">
                  <div
                    className="bg-[var(--primary)] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${applyProgress.total ? (applyProgress.current / applyProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <ApplyLogView logs={applyLogs} />
            </div>
          )}

          {/* Done stage */}
          {stage === 'done' && summary && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-4 gap-3">
                <CheckCircle size={40} className="text-[var(--success)]" />
                <p className="text-base font-semibold">Import complete</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Updated', value: summary.updated, color: 'var(--warning)' },
                  { label: 'Created', value: summary.created, color: 'var(--success)' },
                  { label: 'Deleted', value: summary.deleted, color: 'var(--error)' },
                  { label: 'Failed', value: summary.failed, color: 'var(--error)' },
                  { label: 'Phones Added', value: summary.phoneAdded, color: 'var(--success)' },
                  { label: 'Phones Updated', value: summary.phoneUpdated, color: 'var(--primary)' },
                  { label: 'Phones Removed', value: summary.phoneRemoved, color: 'var(--error)' },
                ].filter(s => s.value > 0).map(stat => (
                  <div key={stat.label} className="p-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]">
                    <p className="text-xs text-[var(--muted)]">{stat.label}</p>
                    <p className="text-xl font-bold mt-0.5" style={{ color: stat.color }}>{stat.value}</p>
                  </div>
                ))}
              </div>
              <ApplyLogView logs={applyLogs} />
            </div>
          )}
        </div>

        {/* Footer */}
        {(stage === 'review' || stage === 'done') && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--card-border)] shrink-0">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              {stage === 'done' ? 'Close' : 'Cancel'}
            </button>
            {stage === 'review' && (
              <button
                onClick={handleApply}
                disabled={totalToApply === 0}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <CheckCircle size={14} />
                Apply {totalToApply} Change{totalToApply !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
