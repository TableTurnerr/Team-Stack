'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailList } from '@/lib/email-types';
import { RefreshCw, List, Plus, Users, Trash2, Edit2, ShieldBan, Filter as FilterIcon, Database, Search, X, Building2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime, sanitizeFilterValue } from '@/lib/utils';
import { SearchInput } from '@/components/search-input';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { TableSkeleton } from '@/components/dashboard-skeletons';
import { COLLECTIONS, type Company } from '@/lib/types';

export default function ListsPage() {
  const { isAuthenticated } = useAuth();
  const [lists, setLists] = useState<EmailList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListType, setNewListType] = useState<'static' | 'dynamic' | 'suppression'>('dynamic');
  const [creating, setCreating] = useState(false);
  const [companySearch, setCompanySearch] = useState('');
  const [companyResults, setCompanyResults] = useState<Company[]>([]);
  const [searchingCompanies, setSearchingCompanies] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<Company[]>([]);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchLists = async () => {
      setLoading(true);
      try {
        const filters: string[] = [];
        if (search) {
          filters.push(`name ~ "${sanitizeFilterValue(search)}"`);
        }
        if (typeFilter !== 'all') {
          filters.push(`list_type = "${sanitizeFilterValue(typeFilter)}"`);
        }
        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).getFullList({
          filter: filters.length > 0 ? filters.join(' && ') : '',
          sort: '-created',
          expand: 'created_by',
        });
        setLists(result as unknown as EmailList[]);
      } catch (err) {
        console.error('Failed to fetch lists:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLists();
  }, [isAuthenticated, search, typeFilter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).delete(deleteTarget);
      setLists(prev => prev.filter(l => l.id !== deleteTarget));
    } catch (err) {
      console.error('Failed to delete list:', err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleCompanySearch = (query: string) => {
    setCompanySearch(query);
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!query.trim()) {
      setCompanyResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearchingCompanies(true);
      try {
        const result = await pb.collection(COLLECTIONS.COMPANIES).getList(1, 10, {
          filter: `company_name ~ "${sanitizeFilterValue(query)}"`,
          sort: 'company_name',
        });
        const companies = result.items as unknown as Company[];
        // Filter out already-selected companies
        const selectedIds = new Set(selectedCompanies.map(c => c.id));
        setCompanyResults(companies.filter(c => !selectedIds.has(c.id)));
      } catch (err) {
        console.error('Failed to search companies:', err);
      } finally {
        setSearchingCompanies(false);
      }
    }, 300);
    setSearchTimeout(timeout);
  };

  const addCompany = (company: Company) => {
    setSelectedCompanies(prev => [...prev, company]);
    setCompanyResults(prev => prev.filter(c => c.id !== company.id));
    setCompanySearch('');
    setCompanyResults([]);
  };

  const removeCompany = (companyId: string) => {
    setSelectedCompanies(prev => prev.filter(c => c.id !== companyId));
  };

  const handleCreate = async () => {
    if (!newListName.trim()) return;
    setCreating(true);
    try {
      const companyIds = selectedCompanies.map(c => c.id);
      const created = await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).create({
        name: newListName.trim(),
        list_type: newListType,
        filter_json: newListType === 'dynamic' ? {} : undefined,
        company_ids: newListType === 'static' || newListType === 'suppression' ? companyIds : undefined,
        cached_count: newListType === 'static' || newListType === 'suppression' ? companyIds.length : 0,
        created_by: pb.authStore.model?.id,
      });
      setLists(prev => [created as unknown as EmailList, ...prev]);
      setNewListName('');
      setSelectedCompanies([]);
      setShowCreateModal(false);
    } catch (err) {
      console.error('Failed to create list:', err);
    } finally {
      setCreating(false);
    }
  };

  const typeIcons: Record<string, typeof List> = {
    static: Database,
    dynamic: FilterIcon,
    suppression: ShieldBan,
  };

  const typeColors: Record<string, string> = {
    static: 'bg-blue-500/10 text-blue-500',
    dynamic: 'bg-purple-500/10 text-purple-500',
    suppression: 'bg-red-500/10 text-red-500',
  };

  if (loading && lists.length === 0) return <TableSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <a
            href="/email"
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors mt-1"
          >
            <ArrowLeft size={20} />
          </a>
          <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users size={24} />
            Audience Lists
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Manage your email audience segments and suppression lists
          </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-primary"
        >
          <Plus size={16} />
          New List
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          placeholder="Search lists..."
          onSearch={setSearch}
          className="flex-1 max-w-sm"
        />
        <div className="flex gap-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-1">
          {['all', 'dynamic', 'static', 'suppression'].map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-md transition-colors capitalize',
                typeFilter === type
                  ? 'bg-[var(--foreground)] text-[var(--background)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]'
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* List Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-[var(--muted)]" />
        </div>
      ) : lists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--muted)]">
          <List size={48} className="mb-3 opacity-50" />
          <p className="text-lg font-medium">No lists found</p>
          <p className="text-sm mt-1">Create your first audience list to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => {
            const TypeIcon = typeIcons[list.list_type] ?? List;
            return (
              <a
                key={list.id}
                href={`/email/lists/${list.id}`}
                className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 card-interactive block"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn('p-2 rounded-lg', typeColors[list.list_type] ?? 'bg-[var(--card-hover)]')}>
                      <TypeIcon size={18} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-sm truncate">{list.name}</h3>
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-xs font-medium mt-1 inline-block capitalize',
                        typeColors[list.list_type] ?? 'bg-[var(--card-hover)] text-[var(--muted)]'
                      )}>
                        {list.list_type}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(list.id); }}
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[var(--muted)]">
                    <Users size={14} />
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {list.cached_count ?? 0}
                    </span>
                    <span className="text-xs">contacts</span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {formatDateTime(list.created)}
                  </p>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowCreateModal(false); setSelectedCompanies([]); setCompanySearch(''); setCompanyResults([]); }} />
          <div className="relative bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">Create New List</h2>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Name</label>
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="e.g., Cold Leads Q1"
                className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm text-[var(--muted)] block mb-1">Type</label>
              <div className="grid grid-cols-3 gap-2">
                {(['dynamic', 'static', 'suppression'] as const).map(type => {
                  const Icon = typeIcons[type];
                  return (
                    <button
                      key={type}
                      onClick={() => { setNewListType(type); setSelectedCompanies([]); setCompanySearch(''); setCompanyResults([]); }}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors text-sm capitalize',
                        newListType === type
                          ? 'border-[var(--foreground)] bg-[var(--card-hover)]'
                          : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                      )}
                    >
                      <Icon size={18} />
                      {type}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--muted)] mt-2">
                {newListType === 'dynamic' && 'Automatically includes companies matching your filter rules.'}
                {newListType === 'static' && 'Manually select specific companies to include.'}
                {newListType === 'suppression' && 'Companies in this list will be excluded from campaigns.'}
              </p>
            </div>

            {/* Company Search — shown for static & suppression lists */}
            {(newListType === 'static' || newListType === 'suppression') && (
              <div>
                <label className="text-sm text-[var(--muted)] block mb-1">Add Companies</label>
                <div className="relative">
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent">
                    <Search size={14} className="text-[var(--muted)] shrink-0" />
                    <input
                      type="text"
                      value={companySearch}
                      onChange={(e) => handleCompanySearch(e.target.value)}
                      placeholder="Search companies by name..."
                      className="w-full bg-transparent text-sm focus:outline-none"
                    />
                    {searchingCompanies && <RefreshCw size={14} className="animate-spin text-[var(--muted)] shrink-0" />}
                  </div>

                  {/* Search Results Dropdown */}
                  {companyResults.length > 0 && (
                    <div className="absolute z-30 top-full mt-1 w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {companyResults.map(company => (
                        <button
                          key={company.id}
                          onClick={() => addCompany(company)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--card-hover)] transition-colors text-left"
                        >
                          <Building2 size={14} className="text-[var(--muted)] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{company.company_name}</p>
                            <p className="text-xs text-[var(--muted)] truncate">
                              {[company.email, company.company_location].filter(Boolean).join(' · ') || 'No details'}
                            </p>
                          </div>
                          <Plus size={14} className="text-[var(--primary)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}

                  {companySearch.trim() && !searchingCompanies && companyResults.length === 0 && (
                    <div className="absolute z-30 top-full mt-1 w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl px-3 py-3">
                      <p className="text-xs text-[var(--muted)] text-center">No companies found</p>
                    </div>
                  )}
                </div>

                {/* Selected Companies */}
                {selectedCompanies.length > 0 && (
                  <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedCompanies.map(company => (
                      <div
                        key={company.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--card-hover)] border border-[var(--card-border)]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 size={14} className="text-[var(--muted)] shrink-0" />
                          <span className="text-sm truncate">{company.company_name}</span>
                          {company.email && (
                            <span className="text-xs text-[var(--muted)] truncate hidden sm:inline">{company.email}</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeCompany(company.id)}
                          className="p-1 rounded hover:bg-[var(--error-subtle)] text-[var(--muted)] hover:text-[var(--error)] transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-[var(--muted)] pt-1">
                      {selectedCompanies.length} {selectedCompanies.length === 1 ? 'company' : 'companies'} selected
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setShowCreateModal(false); setSelectedCompanies([]); setCompanySearch(''); setCompanyResults([]); }}
                className="px-4 py-2 text-sm rounded-lg btn-ghost border border-[var(--card-border)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newListName.trim() || creating}
                className="px-4 py-2 text-sm rounded-lg btn-primary disabled:opacity-50 flex items-center gap-2"
              >
                {creating && <RefreshCw size={14} className="animate-spin" />}
                Create List
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete List"
        message="This will permanently delete this audience list. Campaigns using this list will not be affected."
        confirmText="Delete"
        variant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
