'use client';

import { useEffect, useState, useCallback } from 'react';
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
  Instagram,
  Mail,
  MessageSquare,
  Calendar,
  Download,
  Upload
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type ColdCall, type EventLog } from '@/lib/types';
import { cn, sanitizeFilterValue, buildPhoneSearchFilter, stripPhoneFormatting } from '@/lib/utils';
import { getOutcomeColors } from '@/lib/call-outcomes';
import { useAuth } from '@/contexts/auth-context';
import { CompaniesTableSkeleton } from '@/components/dashboard-skeletons';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { ExportLeadsModal } from '@/components/export-leads-modal';
import { ImportLeadsModal } from '@/components/import-leads-modal';
import { RelativeTime } from '@/components/relative-time';
import { useUserPreferences } from '@/hooks/use-user-preferences';
import { PageGuard } from '@/components/page-guard';
import {
  TableContainer,
  IndexCell,
  HeaderIndexCell,
  ResizableTh,
  useResizableColumns,
  useTableSelection,
  TablePagination,
  TableEmptyState,
  SelectionToolbar,
} from '@/components/ui/data-table';

// Column definitions for companies table
const COMPANY_COLUMNS: ColumnDefinition[] = [
  { key: 'company_name', label: 'Company Name', defaultVisible: true },
  { key: 'owner_name', label: 'Owner', defaultVisible: true },
  { key: 'instagram_handle', label: 'Instagram', defaultVisible: true },      // NEW
  { key: 'status', label: 'Status', defaultVisible: true },                   // NEW
  { key: 'email', label: 'Email', defaultVisible: false },                    // NEW
  { key: 'company_location', label: 'Location', defaultVisible: false },
  { key: 'source', label: 'Source', defaultVisible: true },
  { key: 'last_contacted', label: 'Last Contact', defaultVisible: true },     // NEW
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

// Source badge colors
const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'Cold Call': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
  'Google Maps': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Manual': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Instagram': { bg: 'bg-[var(--accent-red-subtle)]', text: 'text-[var(--accent-red)]' },
};

// Status is now a JSON array (computed from call outcomes) — no fixed options

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
}: {
  company: Company;
  onEdit: (id: string, data: Partial<Company>) => void;
  isColumnVisible: (key: string) => boolean;
  index: number;
  selected: boolean;
  onSelect: () => void;
  hasSelection: boolean;
  timezones?: { timezone: string; label: string }[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    company_name: company.company_name,
    owner_name: company.owner_name || '',
    company_location: company.company_location || '',
    instagram_handle: company.instagram_handle || '',
    email: company.email || '',
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
        <td className="py-3 px-4 overflow-visible">
          <CompanyHoverCard company={company}>
            <Link href={`/companies/${company.id}`} className="block truncate font-medium hover:text-[var(--primary)] transition-colors" title={company.company_name}>
              {company.company_name}
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

    onAdd(formData as Partial<Company>, phoneEntries.filter(entry => entry.phone.trim()));

    // Reset form
    setFormData({
      company_name: '',
      owner_name: '',
      company_location: '',
      google_maps_link: '',
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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { preferences } = useUserPreferences();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const perPage = 25;

  // Column visibility
  const { visibleColumns, toggleColumn, isColumnVisible, columns } = useColumnVisibility('companies', COMPANY_COLUMNS);

  // Table selection
  const selection = useTableSelection(companies);

  // Resizable columns
  const { getWidth, resize } = useResizableColumns('companies', [
    { key: 'company_name', initialWidth: 200, minWidth: 100 },
    { key: 'owner_name', initialWidth: 150, minWidth: 80 },
    { key: 'instagram_handle', initialWidth: 150, minWidth: 80 },
    { key: 'status', initialWidth: 150, minWidth: 80 },
    { key: 'email', initialWidth: 180, minWidth: 100 },
    { key: 'company_location', initialWidth: 150, minWidth: 80 },
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
      let filter = '';
      if (safeSearch) {
        filter = `company_name ~ "${safeSearch}" || owner_name ~ "${safeSearch}"`;
        if (digits.length >= 3) {
          filter += ` || ${buildPhoneSearchFilter('phone_number', searchTerm)}`;
        }
      }
      const result = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(page, perPage, {
        sort: '-created',
        ...(filter && { filter }),
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
  }, [page, searchTerm, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCompanies();
    }
  }, [isAuthenticated, fetchCompanies]);

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
      const newCompany = await pb.collection(COLLECTIONS.COMPANIES).create<Company>(data);
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

          <ColumnSelector
            columns={columns}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
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
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors text-sm"
            title="Import from CSV"
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

      {/* Selection Toolbar */}
      <SelectionToolbar count={selection.count} totalCount={companies.length} />

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
                      allSelected={selection.allSelected}
                      someSelected={selection.someSelected}
                      onToggleAll={selection.toggleAll}
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
                    {isColumnVisible('status') && (
                      <ResizableTh width={getWidth('status')} minWidth={80} onResize={(w) => resize('status', w)}>Status</ResizableTh>
                    )}
                    {isColumnVisible('email') && (
                      <ResizableTh width={getWidth('email')} minWidth={100} onResize={(w) => resize('email', w)}>Email</ResizableTh>
                    )}
                    {isColumnVisible('company_location') && (
                      <ResizableTh width={getWidth('company_location')} minWidth={80} onResize={(w) => resize('company_location', w)}>Location</ResizableTh>
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
                      hasSelection={selection.hasSelection}
                      timezones={preferences?.timezones}
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

