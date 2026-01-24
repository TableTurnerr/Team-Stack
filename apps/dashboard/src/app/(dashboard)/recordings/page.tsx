'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Mic,
  Upload,
  Search,
  RefreshCw,
  Trash2,
  Play,
  Pause,
  X,
  FileAudio,
  Pencil,
  Filter
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { formatDate, formatDateTime, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { TableSkeleton } from '@/components/dashboard-skeletons';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';

interface Recording {
  id: string;
  created: string;
  recording_date?: string;
  phone_number?: string;
  note?: string;
  file: string;
  uploader?: string;
  collectionId: string;
  collectionName: string;
  expand?: {
    uploader?: {
      name?: string;
      email?: string;
    }
  }
}

const RECORDING_COLUMNS: ColumnDefinition[] = [
  { key: 'recording_date', label: 'Date', defaultVisible: true },
  { key: 'created', label: 'Uploaded', defaultVisible: true },
  { key: 'phone_number', label: 'Phone', defaultVisible: true },
  { key: 'note', label: 'Note', defaultVisible: true },
  { key: 'file', label: 'Recording', defaultVisible: true },
  { key: 'uploader', label: 'Uploader', defaultVisible: true },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

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
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPhone, setUploadPhone] = useState('');
  const [uploadNote, setUploadNote] = useState('');
  const [uploadDate, setUploadDate] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit Note State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

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
        filters.push(`(phone_number ~ "${searchTerm}" || note ~ "${searchTerm}")`);
      }

      const queryOptions = {
        expand: 'uploader',
        filter: filters.length > 0 ? filters.join(' && ') : undefined,
      };

      try {
        // Try sorting by recording_date first
        const result = await pb.collection('recordings').getList<Recording>(page, perPage, {
          ...queryOptions,
          sort: '-recording_date,-created',
        });
        setRecordings(result.items);
        setTotalPages(result.totalPages);
      } catch (sortErr: any) {
        // Fallback 1: Try sorting by created (if recording_date missing)
        try {
          const result = await pb.collection('recordings').getList<Recording>(page, perPage, {
            ...queryOptions,
            sort: '-created',
          });
          setRecordings(result.items);
          setTotalPages(result.totalPages);
        } catch (fallbackErr: any) {
           console.warn('Fallback 1 failed', fallbackErr);
           // Fallback 2: Try without filters (if filters causing 400)
           try {
             const result = await pb.collection('recordings').getList<Recording>(page, perPage, {
               expand: 'uploader',
               sort: '-created',
             });
             setRecordings(result.items);
             setTotalPages(result.totalPages);
           } catch (finalErr: any) {
             // Ultimate fallback: raw list without expand/filters
             console.warn('Ultimate fallback', finalErr);
             const result = await pb.collection('recordings').getList<Recording>(page, perPage, {
               sort: '-created',
             });
             setRecordings(result.items);
             setTotalPages(result.totalPages);
           }
        }
      }
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch recordings:', err);
        setError(`Failed to load recordings: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [page, isAuthenticated, searchTerm]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchRecordings();
    }
  }, [isAuthenticated, fetchRecordings]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadFile(file);

      // Extract metadata from filename: recording_DD-MM-YYYY_HH-mm-ss_PHONENUMBER
      // Example: recording_13-01-2026_23-23-41_18568541222
      const pattern = /^recording_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})_(.+)$/;
      const match = file.name.replace(/\.[^/.]+$/, "").match(pattern);

      if (match) {
        const [, date, time, phone] = match;
        setUploadPhone(phone);
        
        // Format date/time for PocketBase (YYYY-MM-DD HH:MM:SS+05:00)
        const [day, month, year] = date.split('-');
        const formattedTime = time.replace(/-/g, ':');
        const isoDate = `${year}-${month}-${day} ${formattedTime}+05:00`;
        setUploadDate(isoDate);

        // Format the note with extracted date/time for better context if note is empty
        if (!uploadNote) {
          setUploadNote(`Call on ${date} at ${formattedTime}`);
        }
      } else {
        // Fallback to metadata (lastModified)
        if (file.lastModified) {
          const d = new Date(file.lastModified);
          const isoDate = d.toISOString().replace('T', ' ').split('.')[0];
          setUploadDate(isoDate);
          
          if (!uploadNote) {
            setUploadNote(`Call uploaded from file: ${file.name}`);
          }
        } else {
          setUploadDate('');
        }
        setUploadPhone('');
      }
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !user) return;

    if (uploadFile.size > 52428800) { // 50MB
      alert("File is too large. Maximum size is 50MB.");
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', uploadFile);
      if (uploadPhone) formData.append('phone_number', uploadPhone);
      if (uploadNote) formData.append('note', uploadNote);
      if (uploadDate) formData.append('recording_date', uploadDate);
      formData.append('uploader', user.id);

      await pb.collection('recordings').create(formData);
      
      // Reset form
      setUploadFile(null);
      setUploadPhone('');
      setUploadNote('');
      setUploadDate('');
      setIsUploadOpen(false);
      
      // Refresh list
      fetchRecordings();
    } catch (err: any) {
      console.error('Upload failed:', err);
      const dataMessage = err?.data 
        ? Object.entries(err.data)
            .map(([key, val]: [string, any]) => `${key}: ${val.message}`)
            .join('\n')
        : '';
      
      const fullMessage = [
        `Status: ${err.status}`,
        err.message,
        dataMessage,
        err.response ? JSON.stringify(err.response, null, 2) : ''
      ].filter(Boolean).join('\n\n');

      alert(`Upload failed:\n${fullMessage}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recording?')) return;
    
    try {
      await pb.collection('recordings').delete(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

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
      await pb.collection('recordings').update(editingId, { note: editNote });
      
      setRecordings(prev => prev.map(r => r.id === editingId ? { ...r, note: editNote } : r));
      setIsEditOpen(false);
      setEditingId(null);
    } catch (err: any) {
      console.error('Update failed:', err);
      alert(`Update failed: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const getRecordingDisplayDate = (recording: Recording) => {
    const pattern = /recording_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})/;
    const match = recording.file.match(pattern);
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

  // ... existing fetchRecordings ...

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
              className="pl-9 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--foreground)] w-full sm:w-64"
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
                onClick={() => setIsUploadOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload size={16} />
                Upload Recording
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



      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-[var(--card-border)]">
              <h2 className="font-semibold text-lg">Upload Recording</h2>
              <button 
                onClick={() => setIsUploadOpen(false)}
                className="p-2 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleUpload} className="p-4 space-y-4">
              {/* File Input */}
              <div>
                <label className="block text-sm font-medium mb-1">Audio File *</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[var(--card-border)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--foreground)] hover:bg-[var(--sidebar-bg)] transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  {uploadFile ? (
                    <div className="flex flex-col items-center gap-2 text-[var(--success)]">
                      <FileAudio size={32} />
                      <span className="text-sm font-medium">{uploadFile.name}</span>
                      <span className="text-xs text-[var(--muted)]">{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-[var(--muted)]">
                      <Upload size={32} />
                      <span className="text-sm">Click to select audio file</span>
                      <span className="text-xs">MP3, WAV, M4A supported</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium mb-1">Phone Number (Optional)</label>
                <input
                  type="text"
                  value={uploadPhone}
                  onChange={(e) => setUploadPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                />
              </div>

              {/* Note */}
              <div>
                <label className="block text-sm font-medium mb-1">Note (Optional)</label>
                <textarea
                  value={uploadNote}
                  onChange={(e) => setUploadNote(e.target.value)}
                  placeholder="Any details about this call..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-2 focus:ring-[var(--foreground)]"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || isUploading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isUploading && <RefreshCw size={14} className="animate-spin" />}
                  {isUploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                    {isColumnVisible('created') && (
                      <td className="py-3 px-4 whitespace-nowrap text-sm text-[var(--muted)]">
                        {formatDate(recording.created)}
                      </td>
                    )}
                    {isColumnVisible('phone_number') && (
                      <td className="py-3 px-4 whitespace-nowrap text-sm font-mono">
                        {recording.phone_number || 'N/A'}
                      </td>
                    )}
                    {isColumnVisible('note') && (
                      <td className="py-3 px-4 text-sm max-w-xs group relative">
                        <div className="flex items-center gap-2">
                          <span className="truncate" title={recording.note}>{recording.note || 'N/A'}</span>
                          <button 
                            onClick={() => openEdit(recording)}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all"
                            title="Edit note"
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                    {isColumnVisible('file') && (
                      <td className="py-3 px-4">
                        <audio 
                          controls 
                          preload="none"
                          className="h-8 w-full min-w-[200px] max-w-[300px]"
                          src={pb.files.getUrl(recording, recording.file)}
                        />
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
