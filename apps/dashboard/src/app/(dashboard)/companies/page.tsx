'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Building2,
  Phone,
  MapPin,
  ExternalLink,
  Plus,
  Edit,
  X,
  Check,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Instagram,
  Mail,
  MessageSquare,
  Calendar,
  Download,
  Upload,
  Globe,
  UserCog,
  Tag,
  Layers,
  Loader2,
  User as UserIcon,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type ColdCall, type EventLog, type LeadCategory, type User as UserType } from '@/lib/types';
import { cn, sanitizeFilterValue, buildPhoneSearchFilter, stripPhoneFormatting, formatCompanyName, extractWebsiteFromName } from '@/lib/utils';
import { getOutcomeColors } from '@/lib/call-outcomes';
import { useAuth } from '@/contexts/auth-context';
import { AssigneePicker, AssigneeAvatar, useTeamMembers } from '@/components/assignee-picker';
import { usePermissions } from '@/contexts/role-permission-context';
import { CompaniesTableSkeleton } from '@/components/dashboard-skeletons';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { ExportLeadsModal } from '@/components/export-leads-modal';
import { ImportLeadsModal } from '@/components/import-leads-modal';
import { LeadCategorySelect } from '@/components/lead-category-select';
import {
  FilterBuilder,
  FilterChips,
  runFilterSearch,
  useFilterSelection,
  fetchAllMatchingIds,
  shouldConfirmSelectAll,
  type FilterCondition,
  type FilterFieldDef,
  type FilterLogic,
} from '@/components/filter-builder';
import { DEFAULT_OUTCOMES } from '@/lib/call-outcomes';
import { useCustomCallOutcomes } from '@/hooks/use-custom-call-outcomes';
import { RelativeTime } from '@/components/relative-time';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { PageGuard } from '@/components/page-guard';
import {
  TableContainer,
  IndexCell,
  HeaderIndexCell,
  ResizableTh,
  useResizableColumns,
  TablePagination,
  TableEmptyState,
  SelectionToolbar,
} from '@/components/ui/data-table';

// Column definitions for companies table
const COMPANY_COLUMNS: ColumnDefinition[] = [
  { key: 'company_name', label: 'Company Name', defaultVisible: true },
  { key: 'owner_name', label: 'Owner', defaultVisible: true },
  { key: 'instagram_handle', label: 'Instagram', defaultVisible: false },
  { key: 'lead_category', label: 'Lead Category', defaultVisible: true },
  { key: 'assigned_to', label: 'Assigned To', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'email', label: 'Email', defaultVisible: true },
  { key: 'company_location', label: 'Location', defaultVisible: false },
  { key: 'website', label: 'Website', defaultVisible: true },
  { key: 'source', label: 'Source', defaultVisible: true },
  { key: 'last_contacted', label: 'Last Contact', defaultVisible: true },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

// Source badge colors
const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'Cold Call': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
  'Google Maps': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Manual': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Instagram': { bg: 'bg-[var(--accent-red-subtle)]', text: 'text-[var(--accent-red)]' },
};

// Status is a JSON array (computed from call outcomes) — last call per phone, deduplicated.
const COMPANY_STATUSES = ['Cold No Reply', 'Replied', 'Warm', 'Booked', 'Paid', 'Client', 'Excluded'] as const;
const COMPANY_SOURCES = ['Cold Call', 'Google Maps', 'Manual', 'Instagram'] as const;
const CALL_DIRECTIONS = ['outbound', 'inbound'] as const;

function buildCompaniesFilterFields(customOutcomes: readonly string[]): readonly FilterFieldDef[] {
  const statusOptions = [...DEFAULT_OUTCOMES, ...customOutcomes, ...COMPANY_STATUSES];
  const anyOutcomeOptions = [...DEFAULT_OUTCOMES, ...customOutcomes];
  return [
  { key: 'lead_category', label: 'Lead Category', type: 'rel_id', relCollection: 'lead_categories', group: 'Company' },
  {
    key: 'call_outcome',
    label: 'Call Outcome',
    type: 'multi_enum',
    group: 'Calls',
    scopes: {
      last: { key: 'status', type: 'multi_enum', options: statusOptions },
      any: { key: 'call_logs_via_company.call_outcome', type: 'rel_select', options: anyOutcomeOptions },
    },
  },
  { key: 'source', label: 'Source', type: 'enum', options: COMPANY_SOURCES, group: 'Company' },
  { key: 'company_location', label: 'Location', type: 'text', group: 'Company' },
  { key: 'email', label: 'Email', type: 'text', group: 'Company' },
  { key: 'website', label: 'Website', type: 'text', group: 'Company' },
  { key: 'instagram_handle', label: 'Instagram', type: 'text', group: 'Company' },
  { key: 'last_contacted', label: 'Last Contacted', type: 'date', group: 'Calls' },
  { key: 'do_not_contact', label: 'Do Not Contact', type: 'boolean', group: 'Company' },

  // Call attributes without a denormalized last-call equivalent on the company — only "any call" scope is useful.
  { key: 'call_logs_via_company.direction', label: 'Call Direction', type: 'rel_select', options: CALL_DIRECTIONS, group: 'Calls' },
  { key: 'call_logs_via_company.status_changed_to', label: 'Call Status Changed To', type: 'rel_select', options: COMPANY_STATUSES, group: 'Calls' },
  { key: 'call_logs_via_company.caller', label: 'Called By', type: 'rel_id', relCollection: 'users', group: 'Calls' },
  { key: 'call_logs_via_company.post_call_notes', label: 'Call Notes Contain', type: 'rel_text', group: 'Calls' },
  { key: 'call_logs_via_company.owner_reached', label: 'Owner Reached', type: 'rel_boolean', group: 'Calls' },
  { key: 'call_logs_via_company.warm_lead', label: 'Warm Lead', type: 'rel_boolean', group: 'Calls' },
  { key: 'call_logs_via_company.pitch_completed', label: 'Pitch Completed', type: 'rel_boolean', group: 'Calls' },
  { key: 'call_logs_via_company.has_recording', label: 'Has Recording', type: 'rel_boolean', group: 'Calls' },
  { key: 'call_logs_via_company.duration', label: 'Total Duration (s)', type: 'rel_number', group: 'Calls' },
  { key: 'call_logs_via_company.call_duration', label: 'Talk Duration (s)', type: 'rel_number', group: 'Calls' },
  { key: 'call_logs_via_company.call_time', label: 'Call Date', type: 'rel_date', group: 'Calls' },
  ];
}

// Company row with inline edit
function CompanyRow({
  company,
  onEdit,
  isColumnVisible,
  index,
  selected,
  onSelect,
  hasSelection,
  timezones,
  categories,
  onAddCategory,
  isAdmin,
  teamMembers,
}: {
  company: Company;
  onEdit: (id: string, data: Partial<Company>) => void;
  isColumnVisible: (key: string) => boolean;
  index: number;
  selected: boolean;
  onSelect: () => void;
  hasSelection: boolean;
  timezones?: { timezone: string; label: string }[];
  categories: LeadCategory[];
  onAddCategory: (name: string) => Promise<LeadCategory | null>;
  isAdmin: boolean;
  teamMembers: UserType[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    company_name: company.company_name,
    owner_name: company.owner_name || '',
    company_location: company.company_location || '',
    instagram_handle: company.instagram_handle || '',
    email: company.email || '',
    website: company.website || '',
  });

  const handleSave = () => {
    onEdit(company.id, editData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData({
      company_name: company.company_name,
      owner_name: company.owner_name || '',
      company_location: company.company_location || '',
      instagram_handle: company.instagram_handle || '',
      email: company.email || '',
      website: company.website || '',
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <tr className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
        <td className="py-3 px-4 w-12">
          <span className="text-xs tabular-nums text-[var(--muted)]">{index}</span>
        </td>
        {isColumnVisible('company_name') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.company_name}
              onChange={(e) => setEditData(p => ({ ...p, company_name: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </td>
        )}
        {isColumnVisible('owner_name') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.owner_name}
              onChange={(e) => setEditData(p => ({ ...p, owner_name: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              placeholder="Owner name"
            />
          </td>
        )}
        {isColumnVisible('instagram_handle') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.instagram_handle}
              onChange={(e) => setEditData(p => ({ ...p, instagram_handle: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              placeholder="@username"
            />
          </td>
        )}
        {isColumnVisible('lead_category') && (
          <td className="py-3 px-4">
            <LeadCategorySelect
              value={company.lead_category || ''}
              categories={categories}
              onChange={(id) => onEdit(company.id, { lead_category: id })}
              onAddCategory={onAddCategory}
            />
          </td>
        )}
        {isColumnVisible('assigned_to') && (
          <td className="py-3 px-4">
            <AssigneePicker
              value={company.assigned_to}
              expandedUser={company.expand?.assigned_to}
              members={teamMembers}
              onChange={(uid) => onEdit(company.id, { assigned_to: uid ?? '' })}
              disabled={!isAdmin}
            />
          </td>
        )}
        {isColumnVisible('status') && (
          <td className="py-3 px-4">
            <div className="flex flex-wrap gap-1">
              {Array.isArray(company.status) && company.status.length > 0 ? company.status.map(s => {
                const colors = getOutcomeColors(s);
                return (
                  <span key={s} className={cn("px-2 py-0.5 text-xs font-medium rounded-full", colors.bg, colors.text)}>
                    {s}
                  </span>
                );
              }) : <span className="text-[var(--muted)] text-xs">-</span>}
            </div>
          </td>
        )}
        {isColumnVisible('email') && (
          <td className="py-3 px-4">
            <input
              type="email"
              value={editData.email}
              onChange={(e) => setEditData(p => ({ ...p, email: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              placeholder="Email"
            />
          </td>
        )}
        {isColumnVisible('company_location') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.company_location}
              onChange={(e) => setEditData(p => ({ ...p, company_location: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              placeholder="Location"
            />
          </td>
        )}
        {isColumnVisible('website') && (
          <td className="py-3 px-4">
            <input
              type="url"
              value={editData.website}
              onChange={(e) => setEditData(p => ({ ...p, website: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              placeholder="https://example.com"
            />
          </td>
        )}
        {isColumnVisible('source') && (
          <td className="py-3 px-4">
            <span className={cn(
              "px-2 py-1 rounded text-xs",
              SOURCE_COLORS[company.source || 'Manual']?.bg || 'bg-gray-500/20',
              SOURCE_COLORS[company.source || 'Manual']?.text || 'text-gray-400'
            )}>
              {company.source || 'Manual'}
            </span>
          </td>
        )}
        {isColumnVisible('last_contacted') && (
          <td className="py-3 px-4">
            {company.last_contacted ? (
              <RelativeTime date={company.last_contacted} timezones={timezones} className="text-sm text-[var(--muted)]" />
            ) : (
              <span className="text-sm text-[var(--muted)]">-</span>
            )}
          </td>
        )}
        <td className="py-3 px-4">
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              className="p-1.5 rounded bg-[var(--success-subtle)] text-[var(--success)] hover:opacity-80 transition-opacity"
            >
              <Check size={14} />
            </button>
            <button
              onClick={handleCancel}
              className="p-1.5 rounded bg-[var(--error-subtle)] text-[var(--error)] hover:opacity-80 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors">
      <IndexCell
        index={index}
        selected={selected}
        onSelect={onSelect}
        forceCheckbox={hasSelection}
      />
      {isColumnVisible('company_name') && (
        <td className="py-3 px-4 overflow-hidden">
          <CompanyHoverCard company={company} className="block min-w-0 max-w-full">
            <Link href={`/companies/${company.id}`} className="block truncate font-medium hover:text-[var(--primary)] transition-colors" title={company.company_name}>
              {formatCompanyName(company.company_name)}
            </Link>
          </CompanyHoverCard>
        </td>
      )}
      {isColumnVisible('owner_name') && (
        <td className="py-3 px-4 text-sm overflow-hidden">
          <span className="block truncate">{company.owner_name || <span className="text-[var(--muted)]">-</span>}</span>
        </td>
      )}
      {isColumnVisible('instagram_handle') && (
        <td className="py-3 px-4 overflow-hidden">
          <span className="text-sm">
            {company.instagram_handle ? (
              <a
                href={`https://instagram.com/${company.instagram_handle.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline flex items-center gap-1 min-w-0"
              >
                <Instagram size={12} className="shrink-0" />
                <span className="truncate">@{company.instagram_handle.replace('@', '')}</span>
              </a>
            ) : <span className="text-[var(--muted)]">-</span>}
          </span>
        </td>
      )}
      {isColumnVisible('lead_category') && (
        <td className="py-3 px-4 overflow-hidden">
          <LeadCategorySelect
            value={company.lead_category || ''}
            categories={categories}
            onChange={(id) => onEdit(company.id, { lead_category: id })}
            onAddCategory={onAddCategory}
          />
        </td>
      )}
      {isColumnVisible('assigned_to') && (
        <td className="py-3 px-4">
          {!company.assigned_to && company.contact_source?.startsWith('Extension') ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
              NEW
            </span>
          ) : (
            <AssigneePicker
              value={company.assigned_to}
              expandedUser={company.expand?.assigned_to}
              members={teamMembers}
              onChange={(uid) => onEdit(company.id, { assigned_to: uid ?? '' })}
              disabled={!isAdmin}
            />
          )}
        </td>
      )}
      {isColumnVisible('status') && (
        <td className="py-3 px-4 overflow-hidden">
          {Array.isArray(company.status) && company.status.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {company.status.map(s => {
                const colors = getOutcomeColors(s);
                return (
                  <span key={s} className={cn("inline-flex px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap", colors.bg, colors.text)}>
                    {s}
                  </span>
                );
              })}
            </div>
          ) : <span className="text-[var(--muted)]">-</span>}
        </td>
      )}
      {isColumnVisible('email') && (
        <td className="py-3 px-4 overflow-hidden">
          <span className="text-sm">
            {company.email ? (
              <a href={`mailto:${company.email}`} className="text-[var(--primary)] hover:underline flex items-center gap-1 min-w-0">
                <Mail size={12} className="shrink-0" />
                <span className="truncate">{company.email}</span>
              </a>
            ) : <span className="text-[var(--muted)]">-</span>}
          </span>
        </td>
      )}
      {isColumnVisible('company_location') && (
        <td className="py-3 px-4 text-sm overflow-hidden">
          <div className="flex items-center gap-1 min-w-0">
            <span className="truncate">{company.company_location || <span className="text-[var(--muted)]">-</span>}</span>
            {company.google_maps_link && (
              <a
                href={company.google_maps_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline shrink-0"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </td>
      )}
      {isColumnVisible('website') && (
        <td className="py-3 px-4 overflow-hidden">
          <span className="text-sm">
            {company.website ? (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline flex items-center gap-1 min-w-0"
                title={company.website}
              >
                <Globe size={12} className="shrink-0" />
                <span className="truncate">{company.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
              </a>
            ) : <span className="text-[var(--muted)]">-</span>}
          </span>
        </td>
      )}
      {isColumnVisible('source') && (
        <td className="py-3 px-4">
          <span className={cn(
            "px-2 py-1 rounded text-xs",
            SOURCE_COLORS[company.source || 'Manual']?.bg || 'bg-gray-500/20',
            SOURCE_COLORS[company.source || 'Manual']?.text || 'text-gray-400'
          )}>
            {company.source || 'Manual'}
          </span>
        </td>
      )}
      {isColumnVisible('last_contacted') && (
        <td className="py-3 px-4">
          {company.last_contacted ? (
            <RelativeTime date={company.last_contacted} timezones={timezones} className="text-sm text-[var(--muted)]" />
          ) : (
            <span className="text-sm text-[var(--muted)]">-</span>
          )}
        </td>
      )}
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 rounded border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors"
            title="Edit"
          >
            <Edit size={14} />
          </button>
          <Link
            href={`/companies/${company.id}`}
            className="p-1.5 rounded bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100 transition-colors"
            title="View Details"
          >
            <ChevronRight size={14} />
          </Link>
        </div>
      </td>
    </tr>
  );
}

// Add Company Modal
function AddCompanyModal({
  isOpen,
  onClose,
  onAdd
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: Partial<Company>, phoneEntries: { phone: string; location: string }[]) => void;
}) {
  const [formData, setFormData] = useState({
    company_name: '',
    owner_name: '',
    company_location: '',
    google_maps_link: '',
    website: '',
    source: 'Manual',
    instagram_handle: '',
    email: '',
    notes: '',
  });

  // Dynamic phone numbers with optional locations
  const [phoneEntries, setPhoneEntries] = useState<{ phone: string; location: string }[]>([
    { phone: '', location: '' }
  ]);

  const addPhoneEntry = () => {
    setPhoneEntries(prev => [...prev, { phone: '', location: '' }]);
  };

  const removePhoneEntry = (index: number) => {
    if (phoneEntries.length > 1) {
      setPhoneEntries(prev => prev.filter((_, i) => i !== index));
    }
  };

  const updatePhoneEntry = (index: number, field: 'phone' | 'location', value: string) => {
    setPhoneEntries(prev => prev.map((entry, i) =>
      i === index ? { ...entry, [field]: value } : entry
    ));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) return;

    const data = { ...formData };
    if (!data.website) data.website = extractWebsiteFromName(data.company_name) ?? '';
    onAdd(data as Partial<Company>, phoneEntries.filter(entry => entry.phone.trim()));

    // Reset form
    setFormData({
      company_name: '',
      owner_name: '',
      company_location: '',
      google_maps_link: '',
      website: '',
      source: 'Manual',
      instagram_handle: '',
      email: '',
      notes: '',
    });
    setPhoneEntries([{ phone: '', location: '' }]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add New Company</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-1 sm:col-span-2">
              <label className="text-sm text-[var(--muted)] block mb-1">Company Name *</label>
              <input
                type="text"
                value={formData.company_name}
                onChange={(e) => setFormData(p => ({ ...p, company_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                required
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Owner Name</label>
              <input
                type="text"
                value={formData.owner_name}
                onChange={(e) => setFormData(p => ({ ...p, owner_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Status</label>
              <p className="text-sm text-[var(--muted)] px-3 py-2">Auto-computed from calls</p>
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Instagram Handle</label>
              <input
                type="text"
                value={formData.instagram_handle}
                onChange={(e) => setFormData(p => ({ ...p, instagram_handle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                placeholder="@username"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                placeholder="email@example.com"
              />
            </div>

            {/* Dynamic Phone Numbers Section */}
            <div className="col-span-1 sm:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-[var(--muted)]">Phone Numbers</label>
                <button
                  type="button"
                  onClick={addPhoneEntry}
                  className="text-xs px-2 py-1 rounded bg-[var(--card-hover)] text-[var(--foreground)] hover:bg-[var(--sidebar-hover)] flex items-center gap-1"
                >
                  <Plus size={12} />
                  Add Phone
                </button>
              </div>
              <div className="space-y-2">
                {phoneEntries.map((entry, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <input
                        type="tel"
                        value={entry.phone}
                        onChange={(e) => updatePhoneEntry(index, 'phone', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                        placeholder="+1-555-1234"
                      />
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={entry.location}
                        onChange={(e) => updatePhoneEntry(index, 'location', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                        placeholder="Location (optional)"
                      />
                    </div>
                    {phoneEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePhoneEntry(index)}
                        className="p-2 text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] rounded-lg transition-colors"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="text-sm text-[var(--muted)] block mb-1">Company Location</label>
              <input
                type="text"
                value={formData.company_location}
                onChange={(e) => setFormData(p => ({ ...p, company_location: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                placeholder="City, State"
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="text-sm text-[var(--muted)] block mb-1">Google Maps Link</label>
              <input
                type="url"
                value={formData.google_maps_link}
                onChange={(e) => setFormData(p => ({ ...p, google_maps_link: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                placeholder="https://maps.google.com/..."
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="text-sm text-[var(--muted)] block mb-1">Website</label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => setFormData(p => ({ ...p, website: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                placeholder="https://example.com"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Source</label>
              <select
                value={formData.source}
                onChange={(e) => setFormData(p => ({ ...p, source: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              >
                <option value="Manual">Manual</option>
                <option value="Cold Call">Cold Call</option>
                <option value="Google Maps">Google Maps</option>
                <option value="Instagram">Instagram</option>
              </select>
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="text-sm text-[var(--muted)] block mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData(p => ({ ...p, notes: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                placeholder="Initial notes..."
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100"
            >
              Add Company
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { hasPermission } = usePermissions();
  const canAccessExtensionLeads = isAdmin || hasPermission('can_access_extension_leads_directly');
  const teamMembers = useTeamMembers();
  const { preferences } = useUserPreferences();
  const { customOutcomes } = useCustomCallOutcomes();
  const filterFields = useMemo(() => buildCompaniesFilterFields(customOutcomes), [customOutcomes]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<LeadCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [filterLogic, setFilterLogic] = useState<FilterLogic>('AND');
  const [appliedConditions, setAppliedConditions] = useState<FilterCondition[]>([]);
  const [appliedLogic, setAppliedLogic] = useState<FilterLogic>('AND');
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'mine' | 'unassigned' | 'new' | string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const perPage = 25;

  // Column visibility
  const { visibleColumns, toggleColumn, isColumnVisible, columns, resetToDefault } = useColumnVisibility('companies', COMPANY_COLUMNS);

  // Table selection — supports both visible-mode and all_filtered-mode
  const selection = useFilterSelection();
  const visibleIds = companies.map(c => c.id);
  const isPageAllSelected = selection.isPageAllSelected(visibleIds);
  const isPageSomeSelected = !isPageAllSelected && companies.some(c => selection.isSelected(c.id));

  // Bulk actions
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMenu, setBulkMenu] = useState<null | 'assignee' | 'category' | 'source'>(null);
  const bulkMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bulkMenu) return;
    function onClick(e: MouseEvent) {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(e.target as Node)) {
        setBulkMenu(null);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [bulkMenu]);

  const handleBulkUpdate = async (patch: Partial<Company>) => {
    if (selection.selectedCount === 0) return;
    setBulkBusy(true);
    setBulkMenu(null);
    try {
      const ids = await selection.materialize(() =>
        fetchAllMatchingIds({
          collection: COLLECTIONS.COMPANIES,
          fields: filterFields,
          conditions: appliedConditions,
          logic: appliedLogic,
        }),
      );
      if (ids.length === 0) return;
      if (shouldConfirmSelectAll(ids.length)) {
        const ok = window.confirm(`This will update ${ids.length} companies. Continue?`);
        if (!ok) return;
      }
      const selectedIdSet = new Set(ids);
      await Promise.all(
        ids.map(id => pb.collection(COLLECTIONS.COMPANIES).update(id, patch))
      );
      setCompanies(prev =>
        prev.map(c => {
          if (!selectedIdSet.has(c.id)) return c;
          const next: Company = { ...c, ...patch } as Company;
          if ('assigned_to' in patch) {
            const uid = patch.assigned_to as string;
            next.expand = {
              ...c.expand,
              assigned_to: uid ? teamMembers.find(m => m.id === uid) : undefined,
            };
          }
          return next;
        })
      );
      selection.clear();
    } catch (err) {
      console.error('Bulk update failed:', err);
    } finally {
      setBulkBusy(false);
    }
  };

  // Resizable columns
  const { getWidth, resize } = useResizableColumns('companies', [
    { key: 'company_name', initialWidth: 200, minWidth: 100 },
    { key: 'owner_name', initialWidth: 150, minWidth: 80 },
    { key: 'instagram_handle', initialWidth: 150, minWidth: 80 },
    { key: 'lead_category', initialWidth: 130, minWidth: 80 },
    { key: 'assigned_to', initialWidth: 160, minWidth: 120 },
    { key: 'status', initialWidth: 150, minWidth: 80 },
    { key: 'email', initialWidth: 180, minWidth: 100 },
    { key: 'company_location', initialWidth: 150, minWidth: 80 },
    { key: 'website', initialWidth: 180, minWidth: 100 },
    { key: 'source', initialWidth: 100, minWidth: 70 },
    { key: 'last_contacted', initialWidth: 130, minWidth: 80 },
    { key: 'actions', initialWidth: 100, minWidth: 70 },
  ]);

  const fetchCompanies = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const safeSearch = sanitizeFilterValue(searchTerm);
      const digits = stripPhoneFormatting(searchTerm);
      let searchFilter = '';
      if (safeSearch) {
        searchFilter = `company_name ~ "${safeSearch}" || owner_name ~ "${safeSearch}"`;
        if (digits.length >= 3) {
          searchFilter += ` || ${buildPhoneSearchFilter('phone_number', searchTerm)}`;
        }
      }
      let assigneeFilterStr = '';
      if (assigneeFilter === 'mine' && user?.id) {
        assigneeFilterStr = `assigned_to = "${user.id}"`;
      } else if (assigneeFilter === 'unassigned') {
        assigneeFilterStr = `assigned_to = ""`;
      } else if (assigneeFilter === 'new') {
        assigneeFilterStr = `assigned_to = "" && contact_source ~ "Extension"`;
      } else if (assigneeFilter !== 'all' && assigneeFilter) {
        assigneeFilterStr = `assigned_to = "${assigneeFilter}"`;
      }
      // Members without extension-leads permission cannot see unassigned leads by default
      const hideUnassigned = !canAccessExtensionLeads && assigneeFilter === 'all'
        ? `assigned_to != ""`
        : '';
      const extraParts = [searchFilter && `(${searchFilter})`, assigneeFilterStr, hideUnassigned].filter(Boolean);
      const extraFilter = extraParts.join(' && ');

      const result = await runFilterSearch<Company>({
        collection: COLLECTIONS.COMPANIES,
        fields: filterFields,
        conditions: appliedConditions,
        logic: appliedLogic,
        page,
        perPage,
        sort: '-created',
        expand: 'lead_category,assigned_to',
        extraFilter: extraFilter || undefined,
      });

      setCompanies(result.items);
      setTotalPages(result.totalPages);
      setTotalItems(result.totalItems);
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch companies:', err);
        setError(`Failed to load companies: ${err.message} ${err.data ? JSON.stringify(err.data) : ''}`);
      }
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, appliedConditions, appliedLogic, isAuthenticated, assigneeFilter, user?.id, canAccessExtensionLeads, filterFields]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCompanies();
    }
  }, [isAuthenticated, fetchCompanies]);

  useEffect(() => {
    if (!isAuthenticated) return;
    pb.collection(COLLECTIONS.LEAD_CATEGORIES).getFullList<LeadCategory>({ sort: 'name' })
      .then(setCategories)
      .catch(() => {});
  }, [isAuthenticated]);

  const handleAddCategory = async (name: string): Promise<LeadCategory | null> => {
    try {
      const created = await pb.collection(COLLECTIONS.LEAD_CATEGORIES).create<LeadCategory>({ name });
      setCategories(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    } catch {
      return null;
    }
  };

  const handleEdit = async (id: string, data: Partial<Company>) => {
    try {
      await pb.collection(COLLECTIONS.COMPANIES).update(id, data);
      setCompanies(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    } catch (err) {
      console.error('Failed to update company:', err);
    }
  };

  const handleAdd = async (data: Partial<Company>, phoneEntries: { phone: string; location: string }[] = []) => {
    try {
      const payload: Partial<Company> = { ...data };
      if (!payload.assigned_to && user?.id) payload.assigned_to = user.id;
      const newCompany = await pb.collection(COLLECTIONS.COMPANIES).create<Company>(payload);
      setCompanies(prev => [newCompany, ...prev]);
      // Create phone_numbers collection records for each entry
      await Promise.all(
        phoneEntries.map(entry =>
          pb.collection(COLLECTIONS.PHONE_NUMBERS).create({
            company: newCompany.id,
            phone_number: entry.phone.trim(),
            location_name: entry.location.trim() || undefined,
          })
        )
      );
    } catch (err) {
      console.error('Failed to create company:', err);
    }
  };

  if (loading || authLoading) {
    return <CompaniesTableSkeleton />;
  }

  return (
    <PageGuard pageKey="companies">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Companies</h1>
          <p className="text-[var(--muted)] mt-1">Manage business entities and contact information</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchInput
              placeholder="Search companies..."
              onSearch={setSearchTerm}
              defaultValue={searchTerm}
              key={searchTerm}
              className="w-full sm:w-64"
            />
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors"
          >
            <Plus size={16} />
            Add Company
          </button>

          <FilterBuilder
            fields={filterFields}
            conditions={filterConditions}
            logic={filterLogic}
            relData={{
              lead_categories: categories.map(c => ({ id: c.id, label: c.name })),
            }}
            onChange={(c, l) => {
              setFilterConditions(c);
              setFilterLogic(l);
              setAppliedConditions(c);
              setAppliedLogic(l);
              setPage(1);
              selection.exitAllFiltered();
            }}
            title="Filter"
          />

          {(isAdmin || canAccessExtensionLeads) && (
            <select
              value={assigneeFilter}
              onChange={(e) => { setAssigneeFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              title="Filter by assignee"
            >
              <option value="all">All assignees</option>
              <option value="mine">Assigned to me</option>
              <option value="new">New (extension)</option>
              {isAdmin && <option value="unassigned">Unassigned</option>}
              {isAdmin && teamMembers.filter(m => m.id !== user?.id).map(m => (
                <option key={m.id} value={m.id}>{m.name || m.email}</option>
              ))}
            </select>
          )}

          <ColumnSelector
            columns={columns}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
            onReset={resetToDefault}
          />

          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors text-sm"
            title="Export to CSV"
          >
            <Download size={15} />
            Export
          </button>

          <button
            onClick={() => {
              // Auto-download the import template so the user immediately gets a
              // structured starter CSV (header row must not be edited).
              import('@/lib/csv-utils').then(m => {
                m.downloadCSV(m.generateBlankImportTemplate(), 'companies-import-template.csv');
              });
              setShowImportModal(true);
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors text-sm"
            title="Import from CSV — downloads a template you can fill in"
          >
            <Upload size={15} />
            Import
          </button>

          <button
            onClick={fetchCompanies}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Active filters strip */}
      {appliedConditions.length > 0 && (
        <FilterChips
          conditions={appliedConditions}
          fields={filterFields}
          relData={{ lead_categories: categories.map(c => ({ id: c.id, label: c.name })) }}
          onRemove={(id) => {
            const next = appliedConditions.filter(c => c.id !== id);
            setFilterConditions(next);
            setAppliedConditions(next);
            setPage(1);
            selection.exitAllFiltered();
          }}
          onClear={() => {
            setFilterConditions([]);
            setAppliedConditions([]);
            setPage(1);
            selection.exitAllFiltered();
          }}
        />
      )}

      {/* Select-all-matching banner */}
      {selection.mode === 'visible' && isPageAllSelected && totalItems > companies.length && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--primary-subtle)] border border-[var(--primary)]/20 text-xs">
          <span className="text-[var(--primary)]">
            All {companies.length} on this page are selected.
          </span>
          <button
            onClick={() => selection.enterAllFiltered(totalItems)}
            className="font-semibold text-[var(--primary)] hover:underline"
          >
            Select all {totalItems} matching this filter →
          </button>
        </div>
      )}
      {selection.mode === 'all_filtered' && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--primary-subtle)] border border-[var(--primary)]/20 text-xs">
          <span className="text-[var(--primary)]">
            All {selection.selectedCount} matching companies are selected.
          </span>
          <button
            onClick={selection.exitAllFiltered}
            className="font-semibold text-[var(--primary)] hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Selection Toolbar */}
      <SelectionToolbar count={selection.selectedCount} totalCount={selection.mode === 'all_filtered' ? totalItems : companies.length}>
        <div className="flex items-center gap-2" ref={bulkMenuRef}>
          {/* Assignee */}
          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => setBulkMenu(bulkMenu === 'assignee' ? null : 'assignee')}
                disabled={bulkBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] text-xs font-medium hover:bg-[var(--card-hover)] transition-all disabled:opacity-50"
              >
                {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <UserCog size={12} />}
                Assignee
                <ChevronDown size={10} />
              </button>
              {bulkMenu === 'assignee' && (
                <div className="absolute top-full right-0 mt-1 w-52 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => handleBulkUpdate({ assigned_to: '' })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
                  >
                    <UserIcon size={12} className="text-[var(--muted)]" />
                    Unassigned
                  </button>
                  {teamMembers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleBulkUpdate({ assigned_to: m.id })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
                    >
                      <AssigneeAvatar user={m} size={16} />
                      <span className="truncate">{m.name || m.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Lead Category */}
          <div className="relative">
            <button
              onClick={() => setBulkMenu(bulkMenu === 'category' ? null : 'category')}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] text-xs font-medium hover:bg-[var(--card-hover)] transition-all disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <Tag size={12} />}
              Category
              <ChevronDown size={10} />
            </button>
            {bulkMenu === 'category' && (
              <div className="absolute top-full right-0 mt-1 w-52 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                <button
                  onClick={() => handleBulkUpdate({ lead_category: '' })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left text-[var(--muted)]"
                >
                  <X size={12} />
                  Clear category
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => handleBulkUpdate({ lead_category: cat.id })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
                  >
                    <Tag size={12} className="text-[var(--muted)]" />
                    <span className="truncate">{cat.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Source */}
          <div className="relative">
            <button
              onClick={() => setBulkMenu(bulkMenu === 'source' ? null : 'source')}
              disabled={bulkBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] text-xs font-medium hover:bg-[var(--card-hover)] transition-all disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />}
              Source
              <ChevronDown size={10} />
            </button>
            {bulkMenu === 'source' && (
              <div className="absolute top-full right-0 mt-1 w-44 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 py-1">
                {(['Manual', 'Cold Call', 'Google Maps', 'Instagram'] as const).map(src => (
                  <button
                    key={src}
                    onClick={() => handleBulkUpdate({ source: src })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
                  >
                    <span className={cn(
                      'px-2 py-0.5 rounded text-[10px]',
                      SOURCE_COLORS[src]?.bg,
                      SOURCE_COLORS[src]?.text
                    )}>
                      {src}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={selection.clear}
            disabled={bulkBusy}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </SelectionToolbar>

      {/* Table */}
      <TableContainer>
        {companies.length === 0 ? (
          <TableEmptyState
            icon={<Building2 size={24} className="text-[var(--primary)]" />}
            title="No companies found"
            description={searchTerm ? 'Try a different search term' : 'Add your first company to get started'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                  <tr>
                    <HeaderIndexCell
                      allSelected={isPageAllSelected}
                      someSelected={isPageSomeSelected}
                      onToggleAll={() => selection.togglePageAll(visibleIds)}
                    />
                    {isColumnVisible('company_name') && (
                      <ResizableTh width={getWidth('company_name')} minWidth={100} onResize={(w) => resize('company_name', w)}>Company Name</ResizableTh>
                    )}
                    {isColumnVisible('owner_name') && (
                      <ResizableTh width={getWidth('owner_name')} minWidth={80} onResize={(w) => resize('owner_name', w)}>Owner</ResizableTh>
                    )}
                    {isColumnVisible('instagram_handle') && (
                      <ResizableTh width={getWidth('instagram_handle')} minWidth={80} onResize={(w) => resize('instagram_handle', w)}>Instagram</ResizableTh>
                    )}
                    {isColumnVisible('lead_category') && (
                      <ResizableTh width={getWidth('lead_category')} minWidth={80} onResize={(w) => resize('lead_category', w)}>Lead Category</ResizableTh>
                    )}
                    {isColumnVisible('assigned_to') && (
                      <ResizableTh width={getWidth('assigned_to')} minWidth={120} onResize={(w) => resize('assigned_to', w)}>Assigned To</ResizableTh>
                    )}
                    {isColumnVisible('status') && (
                      <ResizableTh width={getWidth('status')} minWidth={80} onResize={(w) => resize('status', w)}>Status</ResizableTh>
                    )}
                    {isColumnVisible('email') && (
                      <ResizableTh width={getWidth('email')} minWidth={100} onResize={(w) => resize('email', w)}>Email</ResizableTh>
                    )}
                    {isColumnVisible('company_location') && (
                      <ResizableTh width={getWidth('company_location')} minWidth={80} onResize={(w) => resize('company_location', w)}>Location</ResizableTh>
                    )}
                    {isColumnVisible('website') && (
                      <ResizableTh width={getWidth('website')} minWidth={100} onResize={(w) => resize('website', w)}>Website</ResizableTh>
                    )}
                    {isColumnVisible('source') && (
                      <ResizableTh width={getWidth('source')} minWidth={70} onResize={(w) => resize('source', w)}>Source</ResizableTh>
                    )}
                    {isColumnVisible('last_contacted') && (
                      <ResizableTh width={getWidth('last_contacted')} minWidth={80} onResize={(w) => resize('last_contacted', w)}>Last Contact</ResizableTh>
                    )}
                    <ResizableTh width={getWidth('actions')} minWidth={70} resizable={false}>Actions</ResizableTh>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company, idx) => (
                    <CompanyRow
                      key={company.id}
                      company={company}
                      onEdit={handleEdit}
                      isColumnVisible={isColumnVisible}
                      index={(page - 1) * perPage + idx + 1}
                      selected={selection.isSelected(company.id)}
                      onSelect={() => selection.toggle(company.id)}
                      hasSelection={selection.selectedCount > 0}
                      timezones={preferences?.timezones}
                      categories={categories}
                      onAddCategory={handleAddCategory}
                      isAdmin={isAdmin}
                      teamMembers={teamMembers}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <TablePagination
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              perPage={perPage}
              onPageChange={setPage}
            />
          </>
        )}
      </TableContainer>

      {/* Add Company Modal */}
      <AddCompanyModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAdd}
      />

      {/* Export Modal */}
      <ExportLeadsModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        companiesCount={totalItems}
        searchFilter={searchTerm}
      />

      {/* Import Modal */}
      <ImportLeadsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportComplete={fetchCompanies}
      />

    </div>
    </PageGuard>

  );

}

