'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Mic, Upload, Search, RefreshCw, Trash2, Play, Pause, X, FileAudio, Pencil, Filter, History } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Recording } from '@/lib/types';
import { formatDate, formatDateTime, formatDuration, cn, sanitizeFilterValue } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { TableSkeleton } from '@/components/dashboard-skeletons';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { BulkUploadModal } from '@/components/bulk-upload-modal';

const RECORDING_COLUMNS: ColumnDefinition[] = [
  { key: 'recording_date', label: 'Date', defaultVisible: true },
  { key: 'duration', label: 'Duration', defaultVisible: true },
  { key: 'created', label: 'Uploaded', defaultVisible: true },
  { key: 'phone_number', label: 'Phone', defaultVisible: true },
  { key: 'note', label: 'Note', defaultVisible: true },
  { key: 'file', label: 'Recording', defaultVisible: true },
  { key: 'uploader', label: 'Uploader', defaultVisible: true },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(audio.src);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      resolve(0);
    };
  });
};

export default function RecordingsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Upload State
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleBulkUpload = async (pendingFiles: any[]) => {
    if (!user) return;
    setIsUploading(true);

    try {
      for (const f of pendingFiles) {
        const formData = new FormData();
        formData.append('file', f.file);
        formData.append('uploader', user.id);

        // Auto-match logic
        if (f.matchedPhoneNumber) {
          try {
            const phoneRecord = await pb.collection('phone_numbers').getFirstListItem(`phone_number ~ "${f.matchedPhoneNumber}"`);
            if (phoneRecord) {
              formData.append('phone_number_record', phoneRecord.id);
              formData.append('company', phoneRecord.company);
              formData.append('phone_number', phoneRecord.phone_number);
            }
          } catch (e) {
            // No match found, use raw phone from filename
            formData.append('phone_number', f.matchedPhoneNumber);
          }
        }

        const duration = await getAudioDuration(f.file);
        if (duration) formData.append('duration', Math.round(duration).toString());

        // Extract date from filename if possible
        const meta = extractMetadata(f.file.name);
        if (meta) {
          formData.append('recording_date', meta.isoDate);
          formData.append('note', `Call on ${meta.displayDate}`);
        }

        await pb.collection('recordings').create(formData);
      }

      fetchRecordings();
    } catch (err) {
      console.error('Bulk upload failed:', err);
      alert('Some files failed to upload. Check console for details.');
    } finally {
      setIsUploading(false);
    }
  };

  const extractMetadata = (filename: string) => {
    const pattern = /^recording_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})_(.+)$/;
    const match = filename.replace(/\.[^/.]+$/, "").match(pattern);
    if (match) {
      const [, date, time, phone] = match;
      const [day, month, year] = date.split('-');
      const formattedTime = time.replace(/-/g, ':');
      const isoDate = `${year}-${month}-${day}T${formattedTime}+05:00`;
      return { phone, isoDate, displayDate: `${date} at ${formattedTime}` };
    }
    return null;
  };

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        resolve(0);
      };
    });
  };

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const openEdit = (recording: Recording) => {
    setEditingId(recording.id);
    setEditNote(recording.note || '');
    setIsEditOpen(true);
  };

  const handleUpdateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;

    try {
      setIsUpdating(true);
      await pb.collection('recordings').update(editingId, {
        note: editNote
      });
      setIsEditOpen(false);
      fetchRecordings();
    } catch (err) {
      console.error('Failed to update note:', err);
      alert('Failed to update note');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recording?')) return;

    try {
      await pb.collection('recordings').delete(id);
      fetchRecordings();
    } catch (err) {
      console.error('Failed to delete recording:', err);
      alert('Failed to delete recording');
    }
  };

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const perPage = 20;

  // Column visibility
  const { visibleColumns, toggleColumn, isColumnVisible, columns } = useColumnVisibility('recordings', RECORDING_COLUMNS);

  const fetchRecordings = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const filters: string[] = [];
      if (searchTerm) {
        const safeSearch = sanitizeFilterValue(searchTerm);
        if (safeSearch) {
          filters.push(`(phone_number ~ "${safeSearch}" || note ~ "${safeSearch}")`);
        }
      }

      const queryOptions = {
        expand: 'uploader,company,phone_number_record',
        filter: filters.length > 0 ? filters.join(' && ') : undefined,
        sort: '-recording_date,-created',
      };

      const result = await pb.collection(COLLECTIONS.RECORDINGS).getList<Recording>(page, perPage, queryOptions);
      setRecordings(result.items);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch recordings:', err);
        setError(`Failed to load recordings: ${err.message} (Status: ${err.status})`);
      }
    } finally {
      setLoading(false);
    }
  }, [page, isAuthenticated, searchTerm]);

  const getRecordingDisplayDate = (recording: Recording) => {
    const pattern = /recording_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})/;
    const match = recording.file?.match(pattern);
    if (match) {
      const [, date, time] = match;
      const [day, month, year] = date.split('-');
      const formattedTime = time.replace(/-/g, ':');
      // Construct an ISO-like string that new Date() can reliably parse, adding +05:00 offset
      const isoDate = `${year}-${month}-${day}T${formattedTime}+05:00`;
      return formatDateTime(isoDate);
    }

    if (recording.recording_date) {
      return formatDateTime(recording.recording_date);
    }
    return 'N/A';
  };

  const clearFilters = () => {
    setSearchTerm('');
  };

  const hasActiveFilters = !!searchTerm;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch recordings when component mounts or dependencies change
  useEffect(() => {
    fetchRecordings();
  }, [fetchRecordings]);

  const toggleSelectAll = () => {
    if (selectedIds.size === recordings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(recordings.map(r => r.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} recordings?`)) return;

    try {
      await Promise.all(Array.from(selectedIds).map(id => pb.collection('recordings').delete(id)));
      setRecordings(prev => prev.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
    } catch (err: any) {
      alert(`Bulk delete failed: ${err.message}`);
    }
  };

  if (loading && page === 1 || authLoading) {
    return <TableSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Recordings</h1>
          <p className="text-[var(--muted)] mt-1">Manage and listen to uploaded call recordings</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search recordings..."
              className="pl-9 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] w-full sm:w-64"
            />
          </div>

          {selectedIds.size > 0 && isAdmin ? (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error)] text-white hover:opacity-90 transition-colors"
            >
              <Trash2 size={16} />
              Delete ({selectedIds.size})
            </button>
          ) : (
            isAdmin && (
              <button
                onClick={() => setIsBulkUploadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload size={16} />
                Bulk Upload
              </button>
            )
          )}

          <ColumnSelector
            columns={columns}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
          />

          <button
            onClick={fetchRecordings}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--foreground)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Bulk Upload Modal */}
      <BulkUploadModal
        isOpen={isBulkUploadOpen}
        onClose={() => setIsBulkUploadOpen(false)}
        onUpload={handleBulkUpload}
      />

      {/* Edit Note Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
              <h2 className="font-semibold text-lg">Edit Note</h2>
              <button
                onClick={() => setIsEditOpen(false)}
                className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpdateNote} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Note</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Add details..."
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isUpdating && <RefreshCw size={14} className="animate-spin" />}
                  {isUpdating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Recordings Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {recordings.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--sidebar-bg)] flex items-center justify-center mx-auto mb-4">
              <Mic size={24} className="text-[var(--muted)]" />
            </div>
            <p className="text-sm font-medium">No recordings found</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {isAdmin ? 'Upload a recording to get started' : 'Contact an admin to upload recordings'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                <tr>
                  {isAdmin && (
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === recordings.length && recordings.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-[var(--card-border)] text-[var(--foreground)] focus:ring-[var(--foreground)]"
                      />
                    </th>
                  )}
                  {isColumnVisible('recording_date') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Date</th>}
                  {isColumnVisible('duration') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Duration</th>}
                  {isColumnVisible('created') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Uploaded</th>}
                  {isColumnVisible('phone_number') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>}
                  {isColumnVisible('note') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Note</th>}
                  {isColumnVisible('file') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Recording</th>}
                  {isColumnVisible('uploader') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Uploader</th>}
                  <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)]">
                {recordings.map((recording, i) => (
                  <tr key={recording.id} className="hover:bg-[var(--sidebar-bg)] transition-colors group">
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <div className="relative w-5 h-5 flex items-center justify-center">
                          <span className={cn(
                            "text-xs text-[var(--muted)] transition-opacity",
                            (selectedIds.has(recording.id) || showFilters) ? "opacity-0" : "group-hover:opacity-0"
                          )}>
                            {(page - 1) * perPage + i + 1}
                          </span>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(recording.id)}
                            onChange={() => toggleSelectOne(recording.id)}
                            className={cn(
                              "absolute inset-0 opacity-0 transition-opacity",
                              (selectedIds.has(recording.id) || showFilters) ? "opacity-100" : "group-hover:opacity-100"
                            )}
                          />
                        </div>
                      </td>
                    )}
                    {isColumnVisible('recording_date') && (
                      <td className="py-3 px-4 whitespace-nowrap text-sm">
                        {getRecordingDisplayDate(recording)}
                      </td>
                    )}
                    {isColumnVisible('duration') && (
                      <td className="py-3 px-4 whitespace-nowrap text-sm font-mono">
                        {recording.duration ? formatDuration(recording.duration) : 'N/A'}
                      </td>
                    )}
                    {isColumnVisible('created') && (
                      <td className="py-3 px-4 whitespace-nowrap text-sm text-[var(--muted)]">
                        {formatDate(recording.created)}
                      </td>
                    )}
                    {isColumnVisible('phone_number') && (
                      <td className="py-3 px-4 whitespace-nowrap text-sm font-mono">
                        {recording.expand?.phone_number_record ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-[var(--foreground)]">{recording.expand.phone_number_record.phone_number}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {recording.expand.phone_number_record.label && (
                                <span className="text-[10px] px-1 py-0 rounded bg-[var(--card-hover)] text-[var(--muted)] font-bold uppercase tracking-wider">
                                  {recording.expand.phone_number_record.label}
                                </span>
                              )}
                              {recording.expand.company && (
                                <Link
                                  href={`/companies/${recording.company}`}
                                  className="text-[10px] text-[var(--primary)] font-bold hover:underline truncate max-w-[100px]"
                                >
                                  {recording.expand.company.company_name}
                                </Link>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--muted)]">{recording.phone_number || 'N/A'}</span>
                        )}
                      </td>
                    )}
                    {isColumnVisible('note') && (
                      <td className="py-3 px-4 text-sm max-w-xs group relative">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate" title={recording.note}>{recording.note || 'N/A'}</span>
                            <button
                              onClick={() => openEdit(recording)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all"
                              title="Edit note"
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                          {recording.call_log && (
                            <Link
                              href={`/cold-calls/${recording.call_log}`}
                              className="text-[10px] text-[var(--primary)] font-bold hover:underline flex items-center gap-1"
                            >
                              <History size={10} />
                              View Transcript
                            </Link>
                          )}
                        </div>
                      </td>
                    )}
                    {isColumnVisible('file') && (
                      <td className="py-3 px-4">
                        {recording.file ? (
                          <audio 
                            controls 
                            preload="none"
                            className="h-8 w-full min-w-[200px] max-w-[300px]"
                            src={pb.files.getUrl(recording, recording.file)}
                          />
                        ) : (
                          <span className="text-xs text-[var(--muted)]">No file</span>
                        )}
                      </td>
                    )}
                    {isColumnVisible('uploader') && (
                      <td className="py-3 px-4 text-sm whitespace-nowrap">
                        {recording.expand?.uploader?.name || recording.expand?.uploader?.email || recording.uploader || 'N/A'}
                      </td>
                    )}
                    <td className="py-3 px-4 text-right">
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(recording.id)}
                          className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                          title="Delete recording"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--muted)]">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)] transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)] transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
