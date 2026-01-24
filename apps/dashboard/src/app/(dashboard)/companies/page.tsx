'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  Phone,
  MapPin,
  ExternalLink,
  Plus,
  Search,
  Edit,
  X,
  Check,
  RefreshCw,
  ChevronRight,
  Instagram,
  Mail,
  MessageSquare,
  Calendar
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type ColdCall, type EventLog } from '@/lib/types';
import { formatDate, cn, sanitizeFilterValue } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { CompaniesTableSkeleton } from '@/components/dashboard-skeletons';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';

// Column definitions for companies table
const COMPANY_COLUMNS: ColumnDefinition[] = [
  { key: 'company_name', label: 'Company Name', defaultVisible: true },
  { key: 'owner_name', label: 'Owner', defaultVisible: true },
  { key: 'instagram_handle', label: 'Instagram', defaultVisible: true },      // NEW
  { key: 'status', label: 'Status', defaultVisible: true },                   // NEW
  { key: 'phone_numbers', label: 'Phone', defaultVisible: true },
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

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Warm': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Booked': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Replied': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
  'Cold No Reply': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Client': { bg: 'bg-[var(--primary-subtle)]', text: 'text-[var(--primary)]' },
  'Paid': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Excluded': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
};

const STATUS_OPTIONS = [
  'Cold No Reply',
  'Replied',
  'Warm',
  'Booked',
  'Paid',
  'Client',
  'Excluded'
] as const;

// Company row with inline edit
function CompanyRow({
  company,
  onEdit,
  isColumnVisible
}: {
  company: Company;
  onEdit: (id: string, data: Partial<Company>) => void;
  isColumnVisible: (key: string) => boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    company_name: company.company_name,
    owner_name: company.owner_name || '',
    phone_numbers: company.phone_numbers || '',
    company_location: company.company_location || '',
    instagram_handle: company.instagram_handle || '',
    status: company.status || 'Cold No Reply',
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
      phone_numbers: company.phone_numbers || '',
      company_location: company.company_location || '',
      instagram_handle: company.instagram_handle || '',
      status: company.status || 'Cold No Reply',
      email: company.email || '',
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <tr className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
        {isColumnVisible('company_name') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.company_name}
              onChange={(e) => setEditData(p => ({ ...p, company_name: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </td>
        )}
        {isColumnVisible('owner_name') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.owner_name}
              onChange={(e) => setEditData(p => ({ ...p, owner_name: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
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
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              placeholder="@username"
            />
          </td>
        )}
        {isColumnVisible('status') && (
          <td className="py-3 px-4">
            <select
              value={editData.status}
              onChange={(e) => setEditData(p => ({ ...p, status: e.target.value as any }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-[var(--card-bg)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-sm"
            >
              {STATUS_OPTIONS.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </td>
        )}
        {isColumnVisible('phone_numbers') && (
          <td className="py-3 px-4">
            <input
              type="text"
              value={editData.phone_numbers}
              onChange={(e) => setEditData(p => ({ ...p, phone_numbers: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)] font-mono text-sm"
              placeholder="Phone numbers"
            />
          </td>
        )}
        {isColumnVisible('email') && (
          <td className="py-3 px-4">
            <input
              type="email"
              value={editData.email}
              onChange={(e) => setEditData(p => ({ ...p, email: e.target.value }))}
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
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
              className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
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
            <span className="text-sm text-[var(--muted)]">
              {company.last_contacted ? formatDate(company.last_contacted) : '-'}
            </span>
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
      {isColumnVisible('company_name') && (
        <td className="py-3 px-4">
          <Link href={`/companies/${company.id}`} className="font-medium hover:text-[var(--primary)] transition-colors">
            {company.company_name}
          </Link>
        </td>
      )}
      {isColumnVisible('owner_name') && (
        <td className="py-3 px-4 text-sm">
          {company.owner_name || <span className="text-[var(--muted)]">-</span>}
        </td>
      )}
      {isColumnVisible('instagram_handle') && (
        <td className="py-3 px-4">
          <span className="text-sm">
            {company.instagram_handle ? (
              <a
                href={`https://instagram.com/${company.instagram_handle.replace('@', '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline flex items-center gap-1"
              >
                <Instagram size={12} />
                @{company.instagram_handle.replace('@', '')}
              </a>
            ) : <span className="text-[var(--muted)]">-</span>}
          </span>
        </td>
      )}
      {isColumnVisible('status') && (
        <td className="py-3 px-4">
          {company.status ? (
            <span className={cn(
              "inline-flex px-2 py-0.5 text-xs font-medium rounded-full",
              STATUS_STYLES[company.status]?.bg || 'bg-gray-500/20',
              STATUS_STYLES[company.status]?.text || 'text-gray-400'
            )}>
              {company.status}
            </span>
          ) : <span className="text-[var(--muted)]">-</span>}
        </td>
      )}
      {isColumnVisible('phone_numbers') && (
        <td className="py-3 px-4">
          <span className="text-sm font-mono">
            {company.phone_numbers || <span className="text-[var(--muted)]">-</span>}
          </span>
        </td>
      )}
      {isColumnVisible('email') && (
        <td className="py-3 px-4">
          <span className="text-sm">
            {company.email ? (
              <a href={`mailto:${company.email}`} className="text-[var(--primary)] hover:underline flex items-center gap-1">
                <Mail size={12} />
                {company.email}
              </a>
            ) : <span className="text-[var(--muted)]">-</span>}
          </span>
        </td>
      )}
      {isColumnVisible('company_location') && (
        <td className="py-3 px-4 text-sm">
          <div className="flex items-center gap-1">
            {company.company_location || <span className="text-[var(--muted)]">-</span>}
            {company.google_maps_link && (
              <a
                href={company.google_maps_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
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
          <span className="text-sm text-[var(--muted)]">
            {company.last_contacted ? formatDate(company.last_contacted) : '-'}
          </span>
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
  onAdd: (data: Partial<Company>) => void;
}) {
  const [formData, setFormData] = useState({
    company_name: '',
    owner_name: '',
    phone_numbers: '',
    company_location: '',
    google_maps_link: '',
    source: 'Manual',
    instagram_handle: '',
    status: 'Cold No Reply',
    email: '',
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) return;
    onAdd(formData as any);
    setFormData({
      company_name: '',
      owner_name: '',
      phone_numbers: '',
      company_location: '',
      google_maps_link: '',
      source: 'Manual',
      instagram_handle: '',
      status: 'Cold No Reply',
      email: '',
      notes: '',
    });
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
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                required
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Owner Name</label>
              <input
                type="text"
                value={formData.owner_name}
                onChange={(e) => setFormData(p => ({ ...p, owner_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData(p => ({ ...p, status: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                {STATUS_OPTIONS.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Instagram Handle</label>
              <input
                type="text"
                value={formData.instagram_handle}
                onChange={(e) => setFormData(p => ({ ...p, instagram_handle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="@username"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(p => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="email@example.com"
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Phone Numbers</label>
              <input
                type="text"
                value={formData.phone_numbers}
                onChange={(e) => setFormData(p => ({ ...p, phone_numbers: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="+1-555-1234..."
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Location</label>
              <input
                type="text"
                value={formData.company_location}
                onChange={(e) => setFormData(p => ({ ...p, company_location: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="text-sm text-[var(--muted)] block mb-1">Google Maps Link</label>
              <input
                type="url"
                value={formData.google_maps_link}
                onChange={(e) => setFormData(p => ({ ...p, google_maps_link: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                placeholder="https://maps.google.com/..."
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Source</label>
              <select
                value={formData.source}
                onChange={(e) => setFormData(p => ({ ...p, source: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
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
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 25;

  // Column visibility
  const { visibleColumns, toggleColumn, isColumnVisible, columns } = useColumnVisibility('companies', COMPANY_COLUMNS);

  const fetchCompanies = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const safeSearch = sanitizeFilterValue(searchTerm);
      const result = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(page, perPage, {
        sort: '-created',
        ...(safeSearch && { filter: `company_name ~ "${safeSearch}" || phone_numbers ~ "${safeSearch}" || owner_name ~ "${safeSearch}"` }),
      });

      setCompanies(result.items);
      setTotalPages(result.totalPages);
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

  const handleAdd = async (data: Partial<Company>) => {
    try {
      const newCompany = await pb.collection(COLLECTIONS.COMPANIES).create<Company>(data);
      setCompanies(prev => [newCompany, ...prev]);
    } catch (err) {
      console.error('Failed to create company:', err);
    }
  };

  if (loading || authLoading) {
    return <CompaniesTableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Companies</h1>
          <p className="text-[var(--muted)] mt-1">Manage business entities and contact information</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search companies..."
              className="pl-9 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--foreground)] w-full sm:w-64"
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

      {/* Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {companies.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center mx-auto mb-4">
              <Building2 size={24} className="text-[var(--primary)]" />
            </div>
            <p className="text-sm font-medium">No companies found</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {searchTerm ? 'Try a different search term' : 'Add your first company to get started'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                  <tr>
                    {isColumnVisible('company_name') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Company Name</th>}
                    {isColumnVisible('owner_name') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Owner</th>}
                    {isColumnVisible('instagram_handle') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Instagram</th>}
                    {isColumnVisible('status') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Status</th>}
                    {isColumnVisible('phone_numbers') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>}
                    {isColumnVisible('email') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Email</th>}
                    {isColumnVisible('company_location') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Location</th>}
                    {isColumnVisible('source') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Source</th>}
                    {isColumnVisible('last_contacted') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Last Contact</th>}
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <CompanyRow
                      key={company.id}
                      company={company}
                      onEdit={handleEdit}
                      isColumnVisible={isColumnVisible}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-[var(--card-border)]">
                <span className="text-sm text-[var(--muted)]">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

            {/* Add Company Modal */}

            <AddCompanyModal

              isOpen={showAddModal}

              onClose={() => setShowAddModal(false)}

              onAdd={handleAdd}

            />

          </div>

        );

      }

      