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
  ChevronRight
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company, type ColdCall } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

// Source badge colors
const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  'Cold Call': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
  'Google Maps': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Manual': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Instagram': { bg: 'bg-[var(--accent-red-subtle)]', text: 'text-[var(--accent-red)]' },
};

// Company row with inline edit
function CompanyRow({
  company,
  onEdit,
  onView
}: {
  company: Company;
  onEdit: (id: string, data: Partial<Company>) => void;
  onView: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    company_name: company.company_name,
    owner_name: company.owner_name || '',
    phone_numbers: company.phone_numbers || '',
    company_location: company.company_location || '',
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
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <tr className="border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
        <td className="py-3 px-4">
          <input
            type="text"
            value={editData.company_name}
            onChange={(e) => setEditData(p => ({ ...p, company_name: e.target.value }))}
            className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </td>
        <td className="py-3 px-4">
          <input
            type="text"
            value={editData.owner_name}
            onChange={(e) => setEditData(p => ({ ...p, owner_name: e.target.value }))}
            className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="Owner name"
          />
        </td>
        <td className="py-3 px-4">
          <input
            type="text"
            value={editData.phone_numbers}
            onChange={(e) => setEditData(p => ({ ...p, phone_numbers: e.target.value }))}
            className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)] font-mono text-sm"
            placeholder="Phone numbers"
          />
        </td>
        <td className="py-3 px-4">
          <input
            type="text"
            value={editData.company_location}
            onChange={(e) => setEditData(p => ({ ...p, company_location: e.target.value }))}
            className="w-full px-2 py-1 rounded border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="Location"
          />
        </td>
        <td className="py-3 px-4">
          <span className={cn(
            "px-2 py-1 rounded text-xs",
            SOURCE_COLORS[company.source || 'Manual']?.bg || 'bg-gray-500/20',
            SOURCE_COLORS[company.source || 'Manual']?.text || 'text-gray-400'
          )}>
            {company.source || 'Manual'}
          </span>
        </td>
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
      <td className="py-3 px-4">
        <span className="font-medium">{company.company_name}</span>
      </td>
      <td className="py-3 px-4 text-sm">
        {company.owner_name || <span className="text-[var(--muted)]">-</span>}
      </td>
      <td className="py-3 px-4">
        <span className="text-sm font-mono">
          {company.phone_numbers || <span className="text-[var(--muted)]">-</span>}
        </span>
      </td>
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
      <td className="py-3 px-4">
        <span className={cn(
          "px-2 py-1 rounded text-xs",
          SOURCE_COLORS[company.source || 'Manual']?.bg || 'bg-gray-500/20',
          SOURCE_COLORS[company.source || 'Manual']?.text || 'text-gray-400'
        )}>
          {company.source || 'Manual'}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsEditing(true)}
            className="p-1.5 rounded border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors"
            title="Edit"
          >
            <Edit size={14} />
          </button>
          <button
            onClick={() => onView(company.id)}
            className="p-1.5 rounded bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100 transition-colors"
            title="View calls"
          >
            <ChevronRight size={14} />
          </button>
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
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) return;
    onAdd(formData);
    setFormData({
      company_name: '',
      owner_name: '',
      phone_numbers: '',
      company_location: '',
      google_maps_link: '',
      source: 'Manual',
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add New Company</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
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
            <label className="text-sm text-[var(--muted)] block mb-1">Phone Numbers (comma-separated)</label>
            <input
              type="text"
              value={formData.phone_numbers}
              onChange={(e) => setFormData(p => ({ ...p, phone_numbers: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              placeholder="+1-555-1234, +1-555-5678"
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

          <div>
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

// Company Calls Drawer
function CompanyCallsDrawer({
  companyId,
  onClose
}: {
  companyId: string | null;
  onClose: () => void;
}) {
  const [company, setCompany] = useState<Company | null>(null);
  const [calls, setCalls] = useState<ColdCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [companyData, callsData] = await Promise.all([
          pb.collection(COLLECTIONS.COMPANIES).getOne<Company>(companyId),
          pb.collection(COLLECTIONS.COLD_CALLS).getList<ColdCall>(1, 50, {
            filter: `company = "${companyId}"`,
            sort: '-created',
          }),
        ]);
        setCompany(companyData);
        setCalls(callsData.items);
      } catch (err) {
        console.error('Failed to fetch company data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId]);

  if (!companyId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="bg-[var(--card-bg)] border-l border-[var(--card-border)] w-full max-w-md h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[var(--card-bg)] border-b border-[var(--card-border)] p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Company Calls</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--foreground)]">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <RefreshCw size={24} className="mx-auto animate-spin text-[var(--muted)]" />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {company && (
              <div className="p-4 bg-[var(--sidebar-bg)] rounded-lg">
                <h3 className="font-semibold">{company.company_name}</h3>
                {company.owner_name && (
                  <p className="text-sm text-[var(--muted)]">{company.owner_name}</p>
                )}
                {company.phone_numbers && (
                  <p className="text-sm font-mono mt-1">{company.phone_numbers}</p>
                )}
              </div>
            )}

            <h3 className="font-medium text-sm text-[var(--muted)]">
              {calls.length} Call{calls.length !== 1 ? 's' : ''}
            </h3>

            {calls.length === 0 ? (
              <p className="text-[var(--muted)] text-sm">No calls recorded for this company.</p>
            ) : (
              <div className="space-y-2">
                {calls.map((call) => (
                  <Link
                    key={call.id}
                    href={`/cold-calls/${call.id}`}
                    className="block p-3 rounded-lg border border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{formatDate(call.created)}</span>
                      {call.call_outcome && (
                        <span className={cn(
                          "px-2 py-0.5 rounded text-xs",
                          call.call_outcome === 'Interested' ? 'bg-[var(--success-subtle)] text-[var(--success)]' :
                            call.call_outcome === 'Not Interested' ? 'bg-[var(--error-subtle)] text-[var(--error)]' :
                              'bg-[var(--card-hover)] text-[var(--muted)]'
                        )}>
                          {call.call_outcome}
                        </span>
                      )}
                    </div>
                    {call.call_summary && (
                      <p className="text-sm text-[var(--muted)] mt-1 line-clamp-2">
                        {call.call_summary}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
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
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 25;

  const fetchCompanies = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const result = await pb.collection(COLLECTIONS.COMPANIES).getList<Company>(page, perPage, {
        sort: '-created',
        ...(searchTerm && { filter: `company_name ~ "${searchTerm}" || phone_numbers ~ "${searchTerm}" || owner_name ~ "${searchTerm}"` }),
      });

      setCompanies(result.items);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
      setError('Failed to load companies');
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
              className="pl-9 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--primary)] w-48 sm:w-64"
            />
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100 transition-colors"
          >
            <Plus size={16} />
            Add Company
          </button>

          <button
            onClick={fetchCompanies}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors"
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
        {(loading || authLoading) && companies.length === 0 ? (
          <div className="p-12 text-center">
            <RefreshCw size={32} className="mx-auto mb-4 text-[var(--muted)] animate-spin" />
            <p className="text-[var(--muted)]">Loading companies...</p>
          </div>
        ) : companies.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 size={48} className="mx-auto mb-4 text-[var(--muted)] opacity-50" />
            <h2 className="text-lg font-medium">No Companies Found</h2>
            <p className="text-[var(--muted)] mt-2">
              {searchTerm ? 'Try a different search term' : 'Add your first company to get started'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                  <tr>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Company Name</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Owner</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Location</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Source</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <CompanyRow
                      key={company.id}
                      company={company}
                      onEdit={handleEdit}
                      onView={setSelectedCompanyId}
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

      {/* Company Calls Drawer */}
      <CompanyCallsDrawer
        companyId={selectedCompanyId}
        onClose={() => setSelectedCompanyId(null)}
      />
    </div>
  );
}
