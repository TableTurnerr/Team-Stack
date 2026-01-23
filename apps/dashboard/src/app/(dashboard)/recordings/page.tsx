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
  Pencil
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { formatDate, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { TableSkeleton } from '@/components/dashboard-skeletons';

interface Recording {
  id: string;
  created: string;
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

export default function RecordingsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPhone, setUploadPhone] = useState('');
  const [uploadNote, setUploadNote] = useState('');
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

  const fetchRecordings = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const result = await pb.collection('recordings').getList<Recording>(page, perPage, {
        sort: '-created',
        expand: 'uploader',
      });

      setRecordings(result.items);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      if (err.status !== 0) {
        console.error('Failed to fetch recordings:', err);
        setError(`Failed to load recordings: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [page, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchRecordings();
    }
  }, [isAuthenticated, fetchRecordings]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadFile(e.target.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !user) return;

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('file', uploadFile);
      if (uploadPhone) formData.append('phone_number', uploadPhone);
      if (uploadNote) formData.append('note', uploadNote);
      formData.append('uploader', user.id);

      await pb.collection('recordings').create(formData);
      
      // Reset form
      setUploadFile(null);
      setUploadPhone('');
      setUploadNote('');
      setIsUploadOpen(false);
      
      // Refresh list
      fetchRecordings();
    } catch (err: any) {
      console.error('Upload failed:', err);
      alert(`Upload failed: ${err.message}`);
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
          {isAdmin && (
            <button
              onClick={() => setIsUploadOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload size={16} />
              Upload Recording
            </button>
          )}

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
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Date</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Phone</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Note</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Recording</th>
                  <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Uploader</th>
                  <th className="text-right py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--card-border)]">
                {recordings.map((recording) => (
                  <tr key={recording.id} className="hover:bg-[var(--sidebar-bg)] transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap text-sm">
                      {formatDate(recording.created)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-sm font-mono">
                      {recording.phone_number || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm max-w-xs group relative">
                      <div className="flex items-center gap-2">
                        <span className="truncate" title={recording.note}>{recording.note || '-'}</span>
                        <button 
                          onClick={() => openEdit(recording)}
                          className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-all"
                          title="Edit note"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <audio 
                        controls 
                        preload="none"
                        className="h-8 w-full min-w-[200px] max-w-[300px]"
                        src={pb.files.getUrl(recording, recording.file)}
                      />
                    </td>
                    <td className="py-3 px-4 text-sm whitespace-nowrap">
                      {recording.expand?.uploader?.name || recording.expand?.uploader?.email || 'Unknown'}
                    </td>
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
