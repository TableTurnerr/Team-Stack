'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, ChevronDown, RefreshCw, Filter as FilterIcon, Database, ShieldBan } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailList } from '@/lib/email-types';
import { ListBuilder, type FilterRule, buildPocketBaseFilter } from './list-builder';
import { COLLECTIONS } from '@/lib/types';
import { sanitizeFilterValue } from '@/lib/utils';

interface AudiencePickerProps {
  selectedListId: string | null;
  onSelect: (listId: string | null) => void;
  excludeListId?: string | null;
  onExcludeSelect?: (listId: string | null) => void;
  className?: string;
}

export function AudiencePicker({
  selectedListId,
  onSelect,
  excludeListId,
  onExcludeSelect,
  className,
}: AudiencePickerProps) {
  const [lists, setLists] = useState<EmailList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showExcludeDropdown, setShowExcludeDropdown] = useState(false);
  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [inlineName, setInlineName] = useState('');
  const [inlineFilters, setInlineFilters] = useState<FilterRule[]>([]);
  const [creating, setCreating] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchLists = async () => {
      try {
        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).getFullList({
          sort: '-created',
        });
        setLists(result as unknown as EmailList[]);
      } catch (err) {
        console.error('Failed to fetch lists:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLists();
  }, []);

  // Estimate count for selected list
  useEffect(() => {
    if (!selectedListId) {
      setEstimatedCount(null);
      return;
    }
    const selected = lists.find(l => l.id === selectedListId);
    if (selected) {
      setEstimatedCount(selected.cached_count ?? null);
    }
  }, [selectedListId, lists]);

  const handleInlineCreate = async () => {
    if (!inlineName.trim()) return;
    setCreating(true);
    try {
      // Count matching companies
      const filterStr = buildPocketBaseFilter(inlineFilters);
      const emailFilter = [filterStr, 'email != ""', 'do_not_contact != true'].filter(Boolean).join(' && ');
      const countResult = await pb.collection(COLLECTIONS.COMPANIES).getList(1, 1, { filter: emailFilter || undefined });

      const created = await pb.collection(EMAIL_COLLECTIONS.EMAIL_LISTS).create({
        name: inlineName.trim(),
        list_type: 'dynamic',
        filter_json: inlineFilters,
        cached_count: countResult.totalItems,
        created_by: pb.authStore.model?.id,
      });
      const newList = created as unknown as EmailList;
      setLists(prev => [newList, ...prev]);
      onSelect(newList.id);
      setShowInlineCreate(false);
      setInlineName('');
      setInlineFilters([]);
    } catch (err) {
      console.error('Failed to create inline list:', err);
    } finally {
      setCreating(false);
    }
  };

  const selectedList = lists.find(l => l.id === selectedListId);
  const excludeList = excludeListId ? lists.find(l => l.id === excludeListId) : null;
  const audienceLists = lists.filter(l => l.list_type !== 'suppression');
  const suppressionLists = lists.filter(l => l.list_type === 'suppression');

  const typeIcons: Record<string, typeof Users> = { static: Database, dynamic: FilterIcon, suppression: ShieldBan };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Audience List Selection */}
      <div>
        <label className="text-sm font-medium block mb-2">Audience List</label>
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover)] transition-colors text-left"
          >
            {selectedList ? (
              <div className="flex items-center gap-2">
                {(() => { const Icon = typeIcons[selectedList.list_type] ?? Users; return <Icon size={16} className="text-[var(--muted)]" />; })()}
                <span className="text-sm font-medium">{selectedList.name}</span>
                <span className="text-xs text-[var(--muted)]">
                  ({selectedList.cached_count ?? 0} contacts)
                </span>
              </div>
            ) : (
              <span className="text-sm text-[var(--muted)]">Select an audience list...</span>
            )}
            <ChevronDown size={16} className={cn('transition-transform', showDropdown && 'rotate-180')} />
          </button>

          {showDropdown && (
            <div className="absolute z-20 top-full mt-1 w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl max-h-64 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw size={16} className="animate-spin text-[var(--muted)]" />
                </div>
              ) : (
                <>
                  {audienceLists.map(list => {
                    const Icon = typeIcons[list.list_type] ?? Users;
                    return (
                      <button
                        key={list.id}
                        onClick={() => { onSelect(list.id); setShowDropdown(false); }}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--card-hover)] transition-colors text-left',
                          selectedListId === list.id && 'bg-[var(--primary-subtle)]'
                        )}
                      >
                        <Icon size={16} className="text-[var(--muted)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{list.name}</p>
                          <p className="text-xs text-[var(--muted)] capitalize">{list.list_type} &middot; {list.cached_count ?? 0} contacts</p>
                        </div>
                      </button>
                    );
                  })}
                  {audienceLists.length === 0 && (
                    <p className="px-4 py-3 text-sm text-[var(--muted)]">No audience lists available</p>
                  )}
                  <button
                    onClick={() => { setShowDropdown(false); setShowInlineCreate(true); }}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-[var(--primary)] hover:bg-[var(--card-hover)] transition-colors border-t border-[var(--card-border)]"
                  >
                    <Plus size={14} />
                    Create new list
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {estimatedCount !== null && (
          <p className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-1">
            <Users size={12} />
            Estimated {estimatedCount} recipients
          </p>
        )}
      </div>

      {/* Exclusion List */}
      {onExcludeSelect && (
        <div>
          <label className="text-sm font-medium block mb-2">Exclusion List (optional)</label>
          <div className="relative">
            <button
              onClick={() => setShowExcludeDropdown(!showExcludeDropdown)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover)] transition-colors text-left"
            >
              {excludeList ? (
                <div className="flex items-center gap-2">
                  <ShieldBan size={16} className="text-[var(--muted)]" />
                  <span className="text-sm font-medium">{excludeList.name}</span>
                </div>
              ) : (
                <span className="text-sm text-[var(--muted)]">No exclusion list</span>
              )}
              <ChevronDown size={16} className={cn('transition-transform', showExcludeDropdown && 'rotate-180')} />
            </button>

            {showExcludeDropdown && (
              <div className="absolute z-20 top-full mt-1 w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl max-h-48 overflow-y-auto">
                <button
                  onClick={() => { onExcludeSelect(null); setShowExcludeDropdown(false); }}
                  className={cn(
                    'w-full px-4 py-3 text-sm text-left hover:bg-[var(--card-hover)] transition-colors',
                    !excludeListId && 'bg-[var(--primary-subtle)]'
                  )}
                >
                  None
                </button>
                {[...suppressionLists, ...audienceLists].map(list => {
                  const Icon = typeIcons[list.list_type] ?? Users;
                  return (
                    <button
                      key={list.id}
                      onClick={() => { onExcludeSelect(list.id); setShowExcludeDropdown(false); }}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--card-hover)] transition-colors text-left',
                        excludeListId === list.id && 'bg-[var(--primary-subtle)]'
                      )}
                    >
                      <Icon size={16} className="text-[var(--muted)] shrink-0" />
                      <span className="text-sm">{list.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline Create */}
      {showInlineCreate && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-medium">Create New Audience List</h3>
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">List Name</label>
            <input
              type="text"
              value={inlineName}
              onChange={(e) => setInlineName(e.target.value)}
              placeholder="e.g., Warm Lead with Email"
              className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
              autoFocus
            />
          </div>
          <ListBuilder filters={inlineFilters} onChange={setInlineFilters} />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowInlineCreate(false); setInlineName(''); setInlineFilters([]); }}
              className="px-3 py-1.5 text-sm rounded-lg btn-ghost border border-[var(--card-border)]"
            >
              Cancel
            </button>
            <button
              onClick={handleInlineCreate}
              disabled={!inlineName.trim() || creating}
              className="px-3 py-1.5 text-sm rounded-lg btn-primary disabled:opacity-50 flex items-center gap-2"
            >
              {creating && <RefreshCw size={14} className="animate-spin" />}
              Create & Select
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
