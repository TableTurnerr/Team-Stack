'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Mic, Upload, Search, RefreshCw, Trash2, Play, Pause, X, FileAudio, Pencil, Filter, History, Headphones, Download, Minimize2, Maximize2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Recording } from '@/lib/types';
import { formatDate, formatDateTime, formatDuration, formatPhoneNumber, cn, sanitizeFilterValue, buildPhoneSearchFilter, stripPhoneFormatting } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { TableSkeleton } from '@/components/dashboard-skeletons';
import { SearchInput } from '@/components/search-input';
import { ColumnSelector } from '@/components/column-selector';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { BulkUploadModal, type PendingFile, type DuplicateInfo, type UploadProgress } from '@/components/bulk-upload-modal';
import { ZoomCallButton } from '@/components/zoom-call-button';
import { TableContainer, IndexCell, HeaderIndexCell, ResizableTh, useResizableColumns, TablePagination, TableEmptyState } from '@/components/ui/data-table';
import { CompanyHoverCard } from '@/components/company-hover-card';
import { PhoneHoverCard } from '@/components/phone-hover-card';
import { RelativeTime } from '@/components/relative-time';
import { useUserPreferences } from '@/hooks/use-user-preferences';

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
  const { preferences } = useUserPreferences();
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

  // Audio player state
  const [playingRecording, setPlayingRecording] = useState<Recording | null>(null);
  const [playerMinimized, setPlayerMinimized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHoveringMic, setIsHoveringMic] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const closePlayer = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlayingRecording(null);
    setPlayerMinimized(false);
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handlePlayRecording = (recording: Recording) => {
    setPlayingRecording(recording);
    setPlayerMinimized(false);
  };

  // Check for duplicate recordings by original_filename - batched with retry logic
  const checkDuplicates = async (fileNames: string[]): Promise<Map<string, DuplicateInfo>> => {
    const duplicates = new Map<string, DuplicateInfo>();
    const BATCH_SIZE = 25; // Process in batches to reduce rate limit risk
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000; // Start with 1 second delay

    // Helper function to check a single file with retry logic
    const checkSingleFile = async (fileName: string, retryCount = 0): Promise<{ fileName: string; existing: Recording } | null> => {
      const escapedFileName = fileName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      try {
        const existing = await pb.collection(COLLECTIONS.RECORDINGS).getFirstListItem<Recording>(
          `original_filename = "${escapedFileName}"`,
          { expand: 'uploader,company,phone_number_record' }
        );

        if (existing) {
          console.log(`Duplicate found: "${fileName}" matches existing original_filename "${existing.original_filename}"`);
          return { fileName, existing };
        }
      } catch (e: any) {
        // 404 means no duplicate found, which is expected
        if (e.status === 404) {
          return null;
        }

        // 429 Too Many Requests - retry with exponential backoff
        if (e.status === 429 && retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
          console.log(`Rate limited on ${fileName}, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return checkSingleFile(fileName, retryCount + 1);
        }

        console.error(`Error checking duplicate for ${fileName}:`, e);
      }

      return null;
    };

    // Process files in batches
    for (let i = 0; i < fileNames.length; i += BATCH_SIZE) {
      const batch = fileNames.slice(i, i + BATCH_SIZE);

      try {
        const results = await Promise.all(batch.map(fileName => checkSingleFile(fileName)));

        for (const result of results) {
          if (result) {
            duplicates.set(result.fileName, {
              existingRecording: result.existing,
              existingFileUrl: pb.files.getUrl(result.existing, result.existing.file || '')
            });
          }
        }
      } catch (err) {
        console.error('Failed to check duplicates in batch:', err);
      }

      // Small delay between batches to be gentle on the server
      if (i + BATCH_SIZE < fileNames.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return duplicates;
  };

  const handleBulkUpload = async (
    pendingFiles: PendingFile[],
    onProgress?: (progress: UploadProgress) => void,
    shouldCancel?: () => boolean,
    onLog?: (message: string) => void
  ) => {
    if (!user) return;
    setIsUploading(true);

    const UPLOAD_TIMEOUT_MS = 60000; // 60 seconds timeout per file
    const MAX_RETRIES = 3;

    try {
      for (let i = 0; i < pendingFiles.length; i++) {
        // Check for cancellation
        if (shouldCancel?.()) {
          const msg = `Upload cancelled after ${i} of ${pendingFiles.length} files`;
          console.log(msg);
          onLog?.(msg);
          throw new Error('Upload cancelled');
        }

        const f = pendingFiles[i];

        // Log progress
        const sizeMB = (f.file.size / (1024 * 1024)).toFixed(2);
        onLog?.(`Processing ${i + 1}/${pendingFiles.length}: ${f.file.name} (${sizeMB} MB)`);

        // Report progress
        onProgress?.({
          current: i,
          total: pendingFiles.length,
          currentFileName: f.file.name
        });

        // Delete existing if needed
        if (f.resolution === 'keep_new' && f.duplicateInfo?.existingRecording) {
          try {
            onLog?.(`Replacing existing recording (ID: ${f.duplicateInfo.existingRecording.id})...`);
            await pb.collection(COLLECTIONS.RECORDINGS).delete(f.duplicateInfo.existingRecording.id);
          } catch (deleteErr: any) {
            console.error('Failed to delete existing recording:', deleteErr);
            onLog?.(`Warning: Failed to delete existing file: ${deleteErr.message}`);
          }
        }

        const formData = new FormData();
        formData.append('file', f.file);
        formData.append('uploader', user.id);
        formData.append('original_filename', f.file.name);

        // Auto-match logic
        if (f.matchedPhoneNumber) {
          try {
            const phoneRecord = await pb.collection('phone_numbers').getFirstListItem(`phone_number ~ "${f.matchedPhoneNumber}"`);
            if (phoneRecord) {
              formData.append('phone_number_record', phoneRecord.id);
              formData.append('company', phoneRecord.company);
              formData.append('phone_number', phoneRecord.phone_number);
              onLog?.(`Matched to company via phone: ${f.matchedPhoneNumber}`);
            }
          } catch (e) {
            formData.append('phone_number', f.matchedPhoneNumber);
            onLog?.(`No company match found for phone: ${f.matchedPhoneNumber}`);
          }
        }

        const duration = await getAudioDuration(f.file);
        if (duration) formData.append('duration', Math.round(duration).toString());

        const meta = extractMetadata(f.file.name);
        if (meta) {
          formData.append('recording_date', meta.isoDate);
          formData.append('note', `Call on ${meta.displayDate}`);
        }

        // Upload with retry and timeout
        let attempts = 0;
        let uploaded = false;

        while (attempts < MAX_RETRIES && !uploaded) {
          try {
            attempts++;
            if (attempts > 1) onLog?.(`Retry attempt ${attempts}/${MAX_RETRIES} for ${f.file.name}...`);

            // Create a promise that rejects after timeout
            const uploadPromise = pb.collection(COLLECTIONS.RECORDINGS).create(formData);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Upload timed out')), UPLOAD_TIMEOUT_MS)
            );

            await Promise.race([uploadPromise, timeoutPromise]);
            uploaded = true;
            onLog?.(`Successfully uploaded ${f.file.name}`);
          } catch (err: any) {
            console.error(`Upload error for ${f.file.name} (Attempt ${attempts}):`, err);

            if (shouldCancel?.()) throw new Error('Upload cancelled');

            if (attempts >= MAX_RETRIES) {
              onLog?.(`Failed to upload ${f.file.name} after ${MAX_RETRIES} attempts. Error: ${err.message}`);
              // We don't throw here to allow continuing with other files? 
              // Or user prefers partial success? user said "cancel/skip the uploads (except the ones that were already uploaded)" implying stop on cancel, but continue on error?
              // Usually bulk upload should try to continue or stop. I'll log failure and Continue.
              onLog?.(`Skipping ${f.file.name}...`);
            } else {
              const delay = 1000 * Math.pow(2, attempts);
              onLog?.(`Error: ${err.message}. Retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
            }
          }
        }
      }

      onProgress?.({
        current: pendingFiles.length,
        total: pendingFiles.length,
        currentFileName: 'Completed'
      });
      onLog?.('Bulk upload completed.');

      fetchRecordings();
    } catch (err: any) {
      if (err?.message === 'Upload cancelled') {
        fetchRecordings();
        onLog?.('Upload process cancelled.');
      } else {
        console.error('Bulk upload failed:', err);
        alert('Bulk upload process encountered errors. Check logs for details.');
        onLog?.(`Critical Error: ${err.message}`);
      }
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

  const { widths, resize, getWidth } = useResizableColumns('recordings', [
    { key: 'recording_date', initialWidth: 130 },
    { key: 'duration', initialWidth: 90 },
    { key: 'created', initialWidth: 120 },
    { key: 'phone_number', initialWidth: 180 },
    { key: 'note', initialWidth: 200 },
    { key: 'file', initialWidth: 120 },
    { key: 'uploader', initialWidth: 100 },
    { key: 'actions', initialWidth: 80 },
  ]);

  const fetchRecordings = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      setLoading(true);
      setError(null);

      const filters: string[] = [];
      if (searchTerm) {
        const safeSearch = sanitizeFilterValue(searchTerm);
        if (safeSearch) {
          const digits = stripPhoneFormatting(searchTerm);
          const phoneCondition = digits.length >= 3
            ? buildPhoneSearchFilter('phone_number', searchTerm)
            : `phone_number ~ "${safeSearch}"`;
          const searchConditions = [
            phoneCondition,
            `note ~ "${safeSearch}"`
          ];

          filters.push(`(${searchConditions.join(' || ')})`);
        }
      }

      // Build query options
      const queryOptions: { sort: string; filter?: string; expand?: string } = {
        sort: '-recording_date,-created',
        expand: 'uploader,company,phone_number_record',
      };
      if (filters.length > 0) {
        queryOptions.filter = filters.join(' && ');
      }

      console.log(`Fetching from ${COLLECTIONS.RECORDINGS} with options:`, queryOptions);

      const result = await pb.collection(COLLECTIONS.RECORDINGS).getList<Recording>(page, perPage, queryOptions);
      setRecordings(result.items);
      setTotalPages(result.totalPages);
    } catch (err: any) {
      // Log full error for debugging
      console.error('Recording Fetch Error (full):', err);
      console.error('Error type:', typeof err, err?.constructor?.name);
      console.error('Error keys:', Object.keys(err || {}));

      if (err.status !== 0) {
        setError(`Failed to load recordings: ${err.message || err.toString() || 'Unknown error'} (Status: ${err.status || 'N/A'})`);
      }
    } finally {
      setLoading(false);
    }
  }, [page, isAuthenticated, searchTerm]);

  /** Extract the best available date string for a recording (ISO or PB date). Returns null if none found. */
  const getRecordingDateISO = (recording: Recording): string | null => {
    const pattern = /recording_(\d{2}-\d{2}-\d{4})_(\d{2}-\d{2}-\d{2})/;
    const match = recording.file?.match(pattern);
    if (match) {
      const [, date, time] = match;
      const [day, month, year] = date.split('-');
      const formattedTime = time.replace(/-/g, ':');
      return `${year}-${month}-${day}T${formattedTime}+05:00`;
    }
    if (recording.recording_date) return recording.recording_date;
    return null;
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
      const ids = Array.from(selectedIds);
      const BATCH_SIZE = 5;

      // Delete in batches to avoid rate limits
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(id => pb.collection('recordings').delete(id)));

        // Small delay between batches
        if (i + BATCH_SIZE < ids.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

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
            <SearchInput
              placeholder="Search recordings..."
              onSearch={setSearchTerm}
              defaultValue={searchTerm}
              key={searchTerm} // Reset input when search term is cleared externally
              className="w-full sm:w-64"
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
        checkDuplicates={checkDuplicates}
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
                  className="w-full px-3 py-2 rounded-lg border border-[var(--card-border)] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
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
      <TableContainer>
        {recordings.length === 0 ? (
          <TableEmptyState
            icon={<Mic size={24} className="text-[var(--muted)]" />}
            title="No recordings found"
            description={isAdmin ? 'Upload a recording to get started' : 'Contact an admin to upload recordings'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                  <tr>
                    <HeaderIndexCell
                      allSelected={selectedIds.size === recordings.length && recordings.length > 0}
                      someSelected={selectedIds.size > 0 && selectedIds.size < recordings.length}
                      onToggleAll={toggleSelectAll}
                    />
                    {isColumnVisible('recording_date') && (
                      <ResizableTh width={getWidth('recording_date')} onResize={(w) => resize('recording_date', w)}>Date</ResizableTh>
                    )}
                    {isColumnVisible('duration') && (
                      <ResizableTh width={getWidth('duration')} onResize={(w) => resize('duration', w)}>Duration</ResizableTh>
                    )}
                    {isColumnVisible('created') && (
                      <ResizableTh width={getWidth('created')} onResize={(w) => resize('created', w)}>Uploaded</ResizableTh>
                    )}
                    {isColumnVisible('phone_number') && (
                      <ResizableTh width={getWidth('phone_number')} onResize={(w) => resize('phone_number', w)}>Phone</ResizableTh>
                    )}
                    {isColumnVisible('note') && (
                      <ResizableTh width={getWidth('note')} onResize={(w) => resize('note', w)}>Note</ResizableTh>
                    )}
                    {isColumnVisible('file') && (
                      <ResizableTh width={getWidth('file')} onResize={(w) => resize('file', w)}>Recording</ResizableTh>
                    )}
                    {isColumnVisible('uploader') && (
                      <ResizableTh width={getWidth('uploader')} onResize={(w) => resize('uploader', w)}>Uploader</ResizableTh>
                    )}
                    <ResizableTh width={getWidth('actions')} resizable={false} align="right">Actions</ResizableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)]">
                  {recordings.map((recording, i) => (
                    <tr key={recording.id} className="hover:bg-[var(--sidebar-bg)] transition-colors group">
                      <IndexCell
                        index={(page - 1) * perPage + i + 1}
                        selected={selectedIds.has(recording.id)}
                        onSelect={() => toggleSelectOne(recording.id)}
                        forceCheckbox={selectedIds.size > 0}
                      />
                      {isColumnVisible('recording_date') && (
                        <td className="py-3 px-4 whitespace-nowrap text-sm">
                          {(() => {
                            const d = getRecordingDateISO(recording);
                            return d ? <RelativeTime date={d} timezones={preferences?.timezones} className="text-sm" /> : 'N/A';
                          })()}
                        </td>
                      )}
                      {isColumnVisible('duration') && (
                        <td className="py-3 px-4 whitespace-nowrap text-sm font-mono">
                          {recording.duration ? formatDuration(recording.duration) : 'N/A'}
                        </td>
                      )}
                      {isColumnVisible('created') && (
                        <td className="py-3 px-4 whitespace-nowrap text-sm">
                          <RelativeTime date={recording.created} timezones={preferences?.timezones} className="text-sm text-[var(--muted)]" />
                        </td>
                      )}
                      {isColumnVisible('phone_number') && (
                        <td className="py-3 px-4 whitespace-nowrap text-sm font-mono">
                          {recording.expand?.phone_number_record ? (
                            <div className="flex items-center gap-1">
                              <div className="flex flex-col">
                                <PhoneHoverCard phoneRecord={recording.expand.phone_number_record} side="bottom">
                                  <span className="font-bold text-[var(--foreground)] cursor-default">
                                    {formatPhoneNumber(recording.expand.phone_number_record.phone_number)}
                                  </span>
                                </PhoneHoverCard>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {recording.expand.phone_number_record.label && (
                                    <span className="text-[10px] px-1 py-0 rounded bg-[var(--card-hover)] text-[var(--muted)] font-bold uppercase tracking-wider">
                                      {recording.expand.phone_number_record.label}
                                    </span>
                                  )}
                                  {recording.expand.company && (
                                    <CompanyHoverCard company={recording.expand.company} side="bottom">
                                      <Link
                                        href={`/companies/${recording.company}`}
                                        className="text-[10px] text-[var(--primary)] font-bold hover:underline truncate max-w-[100px]"
                                      >
                                        {recording.expand.company.company_name}
                                      </Link>
                                    </CompanyHoverCard>
                                  )}
                                </div>
                              </div>
                              <ZoomCallButton phoneNumber={recording.expand.phone_number_record.phone_number} />
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-[var(--muted)]">{formatPhoneNumber(recording.phone_number)}</span>
                              {recording.phone_number && (
                                <ZoomCallButton phoneNumber={recording.phone_number} />
                              )}
                            </div>
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
                            <button
                              onClick={() => handlePlayRecording(recording)}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all group",
                                playingRecording?.id === recording.id
                                  ? "bg-[var(--primary)]/10 border-[var(--primary)] text-[var(--primary)]"
                                  : "bg-[var(--sidebar-bg)] border-[var(--card-border)] text-[var(--foreground)] hover:bg-[var(--card-hover)] hover:border-[var(--primary)]"
                              )}
                            >
                              <Headphones size={14} className={cn(
                                "transition-colors",
                                playingRecording?.id === recording.id ? "text-[var(--primary)]" : "text-[var(--muted)] group-hover:text-[var(--primary)]"
                              )} />
                              <span>{playingRecording?.id === recording.id ? 'Playing...' : 'Listen'}</span>
                            </button>
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
                        <div className="flex items-center justify-end gap-1">
                          {recording.file && (
                            <a
                              href={pb.files.getUrl(recording, recording.file)}
                              download
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                              title="Download recording"
                            >
                              <Download size={16} className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors" />
                            </a>
                          )}
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(recording.id)}
                              className="p-2 rounded-lg hover:bg-[var(--error-subtle)] transition-colors"
                              title="Delete recording"
                            >
                              <Trash2 size={16} className="text-[var(--muted)] hover:text-[var(--error)] transition-colors" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </TableContainer>

      {/* Floating Recording Player */}
      {playingRecording && (
        <div 
          className={cn(
            "fixed z-50 transition-all duration-300",
            playerMinimized 
              ? "bottom-4 right-4 w-auto" 
              : "inset-0 flex items-end justify-center sm:items-center p-4 bg-black/40 backdrop-blur-sm"
          )}
          onClick={!playerMinimized ? closePlayer : undefined}
        >
          <div
            className={cn(
              "bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-2xl transition-all duration-300 overflow-hidden",
              playerMinimized 
                ? "w-64 p-3 flex flex-col gap-2" 
                : "w-full max-w-md p-4 space-y-3"
            )}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {playerMinimized ? (
                  <button 
                    onClick={togglePlayback}
                    onMouseEnter={() => setIsHoveringMic(true)}
                    onMouseLeave={() => setIsHoveringMic(false)}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all",
                      isPlaying ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "bg-[var(--warning-subtle)] text-[var(--warning)]"
                    )}
                  >
                    {isPlaying ? (
                      isHoveringMic ? (
                        <Pause size={16} fill="currentColor" />
                      ) : (
                        <Mic size={16} className="animate-pulse" />
                      )
                    ) : (
                      <Play size={16} fill="currentColor" className="ml-0.5" />
                    )}
                  </button>
                ) : (
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    isPlaying ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "bg-[var(--card-hover)] text-[var(--muted)]"
                  )}>
                    <Mic size={16} />
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  {playerMinimized ? (
                    <span className="text-xs font-medium truncate text-[var(--foreground)]">
                      {playingRecording.note || playingRecording.original_filename || 'Call Recording'}
                    </span>
                  ) : (
                    <>
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest leading-none mb-1",
                        isPlaying ? "text-[var(--primary)]" : "text-[var(--muted)]"
                      )}>
                        {isPlaying ? 'Playing' : 'Paused'}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {playingRecording.note || playingRecording.original_filename || 'Call Recording'}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!playerMinimized && playingRecording.file && (
                  <a
                    href={pb.files.getUrl(playingRecording, playingRecording.file)}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                    title="Download"
                  >
                    <Download size={15} />
                  </a>
                )}
                <button
                  onClick={() => setPlayerMinimized(!playerMinimized)}
                  className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)] transition-colors"
                  title={playerMinimized ? "Expand" : "Minimize"}
                >
                  {playerMinimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
                </button>
                <button
                  onClick={closePlayer}
                  className={cn(
                    "p-1.5 rounded-lg text-[var(--muted)] transition-colors",
                    playerMinimized ? "hover:text-[var(--error)] hover:bg-[var(--error)]/5" : "hover:text-[var(--foreground)] hover:bg-[var(--card-hover)]"
                  )}
                  title="Close"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            {playingRecording.file ? (
              <audio
                ref={audioRef}
                controls={!playerMinimized}
                autoPlay
                preload="metadata"
                className={cn(
                  "w-full h-10 transition-all",
                  playerMinimized ? "h-0 opacity-0 pointer-events-none" : "h-10 opacity-100"
                )}
                src={pb.files.getUrl(playingRecording, playingRecording.file)}
                onEnded={closePlayer}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            ) : !playerMinimized && (
              <p className="text-sm text-[var(--muted)] text-center py-2">No audio file attached.</p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
