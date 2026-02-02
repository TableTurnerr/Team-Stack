'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  X,
  Upload,
  FileAudio,
  Check,
  AlertCircle,
  Loader2,
  Table as TableIcon,
  Settings2,
  Phone,
  Building2,
  Trash2,
  AlertTriangle,
  Play,
  Pause,
  Edit3,
  Copy,
  CheckSquare,
  Square,
  MinusSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recording } from '@/lib/types';

export interface DuplicateInfo {
  existingRecording: Recording;
  existingFileUrl: string;
}

export interface PendingFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'error' | 'duplicate' | 'resolved';
  matchedPhoneNumber?: string;
  matchedCompanyId?: string;
  matchedCompanyName?: string;
  error?: string;
  duplicateInfo?: DuplicateInfo;
  resolution?: 'keep_new' | 'keep_existing' | 'rename';
  newFileName?: string;
}

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (files: PendingFile[]) => Promise<void>;
  checkDuplicates: (fileNames: string[]) => Promise<Map<string, DuplicateInfo>>;
}

// Duplicate Resolution Modal Component
function DuplicateResolutionModal({
  pendingFile,
  onResolve,
  onResolveAll,
  onCancel,
  duplicateCount,
  currentIndex
}: {
  pendingFile: PendingFile;
  onResolve: (resolution: 'keep_new' | 'keep_existing' | 'rename', newFileName?: string) => void;
  onResolveAll: (resolution: 'keep_new' | 'keep_existing') => void;
  onCancel: () => void;
  duplicateCount: number;
  currentIndex: number;
}) {
  const [newFileName, setNewFileName] = useState('');
  const [showRenameInput, setShowRenameInput] = useState(false);
  const [newAudioUrl, setNewAudioUrl] = useState<string | null>(null);
  const [newDuration, setNewDuration] = useState<number | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);

  useEffect(() => {
    // Create object URL for the new file
    const url = URL.createObjectURL(pendingFile.file);
    setNewAudioUrl(url);

    // Get duration of new file
    const audio = new Audio();
    audio.src = url;
    audio.onloadedmetadata = () => {
      setNewDuration(audio.duration);
    };

    return () => URL.revokeObjectURL(url);
  }, [pendingFile.file]);

  const existingRecording = pendingFile.duplicateInfo?.existingRecording;
  const existingFileUrl = pendingFile.duplicateInfo?.existingFileUrl;

  const handleRename = () => {
    if (newFileName.trim()) {
      // Preserve the original extension
      const originalExt = pendingFile.file.name.split('.').pop();
      const finalName = newFileName.includes('.') ? newFileName : `${newFileName}.${originalExt}`;
      onResolve('rename', finalName);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 border-b border-[var(--card-border)] bg-[var(--error-subtle)]">
          <div className="w-10 h-10 rounded-full bg-[var(--error)]/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="text-[var(--error)]" size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-[var(--error)]">Duplicate Call Recording Found</h2>
              {duplicateCount > 1 && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--error)]/20 text-[var(--error)] text-xs font-bold">
                  {currentIndex + 1} of {duplicateCount}
                </span>
              )}
            </div>
            <p className="text-sm text-[var(--muted)] mt-0.5">
              A recording with the exact same filename already exists. Compare and choose which to keep.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* File Name Alert */}
          <div className="bg-[var(--error-subtle)] rounded-xl p-4 border border-[var(--error)]/30">
            <div className="flex items-start gap-3">
              <Copy size={18} className="text-[var(--error)] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-[var(--error)] uppercase tracking-wider font-bold mb-1">Duplicate Filename Detected</p>
                <p className="font-mono text-sm font-medium break-all text-[var(--foreground)]">{pendingFile.file.name}</p>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-[var(--primary-subtle)] rounded-xl p-4 border border-[var(--primary)]/30">
            <p className="text-sm text-[var(--primary)] font-medium">
              Listen to both recordings below to compare them and decide which one to keep.
            </p>
          </div>

          {/* Comparison Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Existing Recording */}
            <div className="border border-[var(--card-border)] rounded-xl overflow-hidden bg-[var(--card-bg)]">
              <div className="bg-[var(--sidebar-bg)] px-4 py-3 border-b border-[var(--card-border)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--muted)]"></div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                    Existing Recording
                  </p>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {existingFileUrl && (
                  <div className="bg-[var(--sidebar-bg)] rounded-lg p-3 border border-[var(--card-border)]">
                    <p className="text-[10px] text-[var(--muted)] uppercase mb-2 font-bold flex items-center gap-1">
                      <Play size={10} /> Listen to Existing
                    </p>
                    <audio
                      controls
                      preload="metadata"
                      className="w-full h-10"
                      src={existingFileUrl}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Uploaded</p>
                    <p className="text-sm">{formatDate(existingRecording?.created)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Duration</p>
                    <p className="text-sm font-mono">{formatDuration(existingRecording?.duration)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Phone Number</p>
                    <p className="text-sm font-mono">{existingRecording?.phone_number || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Original Filename</p>
                    <p className="text-sm font-mono truncate" title={existingRecording?.original_filename || existingRecording?.file}>{existingRecording?.original_filename || existingRecording?.file || 'N/A'}</p>
                  </div>
                </div>
                {existingRecording?.note && (
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Note</p>
                    <p className="text-sm text-[var(--muted)]">{existingRecording.note}</p>
                  </div>
                )}
              </div>
            </div>

            {/* New Recording */}
            <div className="border-2 border-[var(--primary)] rounded-xl overflow-hidden bg-[var(--card-bg)]">
              <div className="bg-[var(--primary-subtle)] px-4 py-3 border-b border-[var(--primary)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--primary)]"></div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--primary)]">
                    New Recording (To Upload)
                  </p>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {newAudioUrl && (
                  <div className="bg-[var(--primary-subtle)]/50 rounded-lg p-3 border border-[var(--primary)]/30">
                    <p className="text-[10px] text-[var(--primary)] uppercase mb-2 font-bold flex items-center gap-1">
                      <Play size={10} /> Listen to New
                    </p>
                    <audio
                      controls
                      preload="metadata"
                      className="w-full h-10"
                      src={newAudioUrl}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">File Size</p>
                    <p className="text-sm">{formatFileSize(pendingFile.file.size)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Duration</p>
                    <p className="text-sm font-mono">{formatDuration(newDuration || undefined)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">Detected Phone</p>
                    <p className="text-sm font-mono">{pendingFile.matchedPhoneNumber || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--muted)] uppercase">File Type</p>
                    <p className="text-sm">{pendingFile.file.type || 'audio/*'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Rename Input */}
          {showRenameInput && (
            <div className="bg-[var(--sidebar-bg)] rounded-xl p-4 border border-[var(--card-border)]">
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--muted)] mb-2">
                Enter New Filename
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="Enter new filename..."
                  className="flex-1 px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                />
                <button
                  onClick={handleRename}
                  disabled={!newFileName.trim()}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
              <p className="text-[10px] text-[var(--muted)] mt-2">
                The file extension (.{pendingFile.file.name.split('.').pop()}) will be preserved automatically
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-[var(--card-border)] bg-[var(--sidebar-bg)]">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-[var(--muted)] font-medium">How would you like to handle this duplicate?</p>
            {duplicateCount > 1 && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--card-border)] accent-[var(--primary)]"
                />
                <span className={cn(
                  "text-sm font-medium transition-colors",
                  applyToAll ? "text-[var(--foreground)]" : "text-[var(--muted)]"
                )}>
                  Apply to all ({duplicateCount - currentIndex} remaining)
                </span>
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => applyToAll ? onResolveAll('keep_new') : onResolve('keep_new')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[var(--background)] font-bold hover:bg-gray-100 transition-all"
              title="Delete existing and upload new recording"
            >
              <Upload size={16} />
              Replace with New
            </button>
            <button
              onClick={() => applyToAll ? onResolveAll('keep_existing') : onResolve('keep_existing')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--card-border)] font-bold hover:bg-[var(--card-hover)] transition-all"
              title="Keep existing recording, skip uploading this file"
            >
              <Check size={16} />
              Keep Existing
            </button>
            <button
              onClick={() => !applyToAll && setShowRenameInput(!showRenameInput)}
              disabled={applyToAll}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold transition-all",
                applyToAll
                  ? "opacity-50 cursor-not-allowed border-[var(--card-border)] text-[var(--muted)]"
                  : showRenameInput
                    ? "border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary)]"
                    : "border-[var(--card-border)] hover:bg-[var(--card-hover)]"
              )}
              title={applyToAll ? "Cannot rename when applying to all" : "Rename the new file and upload both"}
            >
              <Edit3 size={16} />
              Rename & Upload Both
            </button>
            <button
              onClick={onCancel}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--error)]/50 text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all ml-auto font-bold"
              title="Discard this file and don't upload"
            >
              <Trash2 size={16} />
              Discard New
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BulkUploadModal({
  isOpen,
  onClose,
  onUpload,
  checkDuplicates
}: BulkUploadModalProps) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [viewMode, setViewMode] = useState<'simple' | 'preview'>('preview');
  const [duplicateToResolve, setDuplicateToResolve] = useState<PendingFile | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const addFiles = useCallback(async (newFiles: File[]) => {
    const audioFiles = newFiles.filter(f => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) return;

    // Create pending files first
    const pendingFiles: PendingFile[] = audioFiles.map(f => {
      const phoneMatch = f.name.match(/\d{10,15}/);
      return {
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        status: 'pending',
        matchedPhoneNumber: phoneMatch ? phoneMatch[0] : undefined
      };
    });

    // Add files to state immediately
    setFiles(prev => [...prev, ...pendingFiles]);

    // Check for duplicates
    setIsCheckingDuplicates(true);
    try {
      const fileNames = audioFiles.map(f => f.name);
      const duplicates = await checkDuplicates(fileNames);

      if (duplicates.size > 0) {
        // Update files with duplicate info
        setFiles(prev => prev.map(f => {
          const duplicateInfo = duplicates.get(f.file.name);
          if (duplicateInfo) {
            return {
              ...f,
              status: 'duplicate' as const,
              duplicateInfo
            };
          }
          return f;
        }));
      }
    } catch (error) {
      console.error('Failed to check duplicates:', error);
    } finally {
      setIsCheckingDuplicates(false);
    }
  }, [checkDuplicates]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, [addFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const handleDuplicateResolution = (
    fileId: string,
    resolution: 'keep_new' | 'keep_existing' | 'rename',
    newFileName?: string
  ) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;

      if (resolution === 'keep_existing') {
        // Remove this file from the list
        return { ...f, status: 'resolved' as const, resolution };
      }

      if (resolution === 'rename' && newFileName) {
        // Create a new File object with the new name
        const newFile = new File([f.file], newFileName, { type: f.file.type });
        return {
          ...f,
          file: newFile,
          status: 'pending' as const,
          resolution,
          newFileName,
          duplicateInfo: undefined
        };
      }

      // keep_new - mark as resolved and ready to upload (will replace existing)
      return {
        ...f,
        status: 'pending' as const,
        resolution
      };
    }));
    setDuplicateToResolve(null);
  };

  // Handle applying resolution to ALL remaining duplicates
  const handleDuplicateResolutionAll = (
    resolution: 'keep_new' | 'keep_existing'
  ) => {
    setFiles(prev => prev.map(f => {
      // Only apply to files that are still duplicates
      if (f.status !== 'duplicate') return f;

      if (resolution === 'keep_existing') {
        return { ...f, status: 'resolved' as const, resolution };
      }

      // keep_new - mark as resolved and ready to upload (will replace existing)
      return {
        ...f,
        status: 'pending' as const,
        resolution
      };
    }));
    setDuplicateToResolve(null);
  };

  const duplicateFiles = files.filter(f => f.status === 'duplicate');
  const hasUnresolvedDuplicates = duplicateFiles.length > 0;
  const uploadableFiles = files.filter(f => f.status === 'pending');

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(files.map(f => f.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const removeSelected = () => {
    setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
    setSelectedIds(new Set());
  };

  const allSelected = files.length > 0 && selectedIds.size === files.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < files.length;
  const noneSelected = selectedIds.size === 0;

  const handleUpload = async () => {
    // Only upload files that are pending (not resolved with 'keep_existing')
    const filesToUpload = files.filter(f => f.status === 'pending');
    if (filesToUpload.length === 0) {
      setFiles([]);
      onClose();
      return;
    }

    setIsUploading(true);
    try {
      await onUpload(filesToUpload);
      setFiles([]);
      onClose();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  // Show duplicate resolution modal if there's one to resolve
  const currentDuplicate = duplicateToResolve || duplicateFiles[0];
  const currentDuplicateIndex = currentDuplicate ? duplicateFiles.findIndex(f => f.id === currentDuplicate.id) : 0;
  if (currentDuplicate && currentDuplicate.status === 'duplicate') {
    return (
      <DuplicateResolutionModal
        pendingFile={currentDuplicate}
        duplicateCount={duplicateFiles.length}
        currentIndex={currentDuplicateIndex >= 0 ? currentDuplicateIndex : 0}
        onResolve={(resolution, newFileName) => {
          handleDuplicateResolution(currentDuplicate.id, resolution, newFileName);
        }}
        onResolveAll={(resolution) => {
          handleDuplicateResolutionAll(resolution);
        }}
        onCancel={() => {
          // Remove the file from the list (discard)
          setFiles(prev => prev.filter(f => f.id !== currentDuplicate.id));
          setDuplicateToResolve(null);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--card-border)] bg-[var(--sidebar-bg)]">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Upload className="text-[var(--primary)]" size={24} />
              Bulk Recording Upload
            </h2>
            <p className="text-sm text-[var(--muted)] mt-1">
              Upload multiple call recordings and match them to companies.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-1">
              <button
                onClick={() => setViewMode('simple')}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                  viewMode === 'simple' ? "bg-[var(--foreground)] text-[var(--background)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                )}
              >
                Simple
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                  viewMode === 'preview' ? "bg-[var(--foreground)] text-[var(--background)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                )}
              >
                Preview Table
              </button>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)]">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {files.length === 0 ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="h-full min-h-[300px] border-2 border-dashed border-[var(--card-border)] rounded-2xl flex flex-col items-center justify-center text-center p-12 transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary-subtle)]/5"
            >
              <div className="w-16 h-16 rounded-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center mb-6 text-[var(--muted)]">
                <FileAudio size={32} />
              </div>
              <h3 className="text-lg font-bold mb-2">Drag & drop recordings here</h3>
              <p className="text-sm text-[var(--muted)] mb-8 max-w-xs mx-auto">
                Select multiple MP3 or WAV files. We&apos;ll automatically try to match them by phone number in the filename.
              </p>
              <label className="px-6 py-3 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-bold cursor-pointer hover:opacity-90 transition-all">
                Browse Files
                <input type="file" multiple accept="audio/*" className="hidden" onChange={handleFileSelect} />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Bulk Action Bar */}
              {viewMode === 'preview' && files.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-xl">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={allSelected ? deselectAll : selectAll}
                      className="flex items-center gap-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                    >
                      {allSelected ? (
                        <>
                          <CheckSquare size={16} className="text-[var(--primary)]" />
                          Deselect All
                        </>
                      ) : someSelected ? (
                        <>
                          <MinusSquare size={16} className="text-[var(--primary)]" />
                          Select All
                        </>
                      ) : (
                        <>
                          <Square size={16} />
                          Select All
                        </>
                      )}
                    </button>
                    {selectedIds.size > 0 && (
                      <span className="text-sm text-[var(--muted)]">
                        <span className="font-bold text-[var(--foreground)]">{selectedIds.size}</span> of {files.length} selected
                      </span>
                    )}
                  </div>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={removeSelected}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] font-bold text-sm hover:bg-[var(--error)]/20 transition-colors"
                    >
                      <Trash2 size={14} />
                      Remove Selected ({selectedIds.size})
                    </button>
                  )}
                </div>
              )}

              {viewMode === 'preview' ? (
                <div className="border border-[var(--card-border)] rounded-xl overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)] text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-3 w-12">
                          <button
                            onClick={allSelected ? deselectAll : selectAll}
                            className="flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                          >
                            {allSelected ? (
                              <CheckSquare size={18} className="text-[var(--primary)]" />
                            ) : someSelected ? (
                              <MinusSquare size={18} className="text-[var(--primary)]" />
                            ) : (
                              <Square size={18} />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px]">Filename</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px]">Detected Phone</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px]">Match Status</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--card-border)]">
                      {files.map((f, index) => (
                        <tr
                          key={f.id}
                          className={cn(
                            "hover:bg-[var(--sidebar-bg)] transition-colors group",
                            selectedIds.has(f.id) && "bg-[var(--primary-subtle)]/30"
                          )}
                        >
                          <td className="px-4 py-4 w-12">
                            <div className="relative w-5 h-5 flex items-center justify-center">
                              <span className={cn(
                                "text-xs text-[var(--muted)] font-medium transition-opacity",
                                selectedIds.has(f.id) ? "opacity-0" : "group-hover:opacity-0"
                              )}>
                                {index + 1}
                              </span>
                              <button
                                onClick={() => toggleSelect(f.id)}
                                className={cn(
                                  "absolute inset-0 flex items-center justify-center transition-opacity",
                                  selectedIds.has(f.id) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                )}
                              >
                                {selectedIds.has(f.id) ? (
                                  <CheckSquare size={16} className="text-[var(--primary)]" />
                                ) : (
                                  <Square size={16} className="text-[var(--muted)] hover:text-[var(--foreground)]" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-4 truncate max-w-[200px] font-medium">
                            {f.file.name}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-2 font-mono">
                              <Phone size={12} className="text-[var(--muted)]" />
                              {f.matchedPhoneNumber || <span className="text-[var(--error)] text-xs font-sans">No phone found</span>}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            {f.status === 'duplicate' ? (
                              <button
                                onClick={() => setDuplicateToResolve(f)}
                                className="flex items-center gap-2 text-[var(--error)] font-medium hover:underline"
                              >
                                <AlertTriangle size={12} />
                                Duplicate Found - Resolve
                              </button>
                            ) : f.status === 'resolved' && f.resolution === 'keep_existing' ? (
                              <div className="flex items-center gap-2 text-[var(--muted)] font-medium">
                                <Check size={12} />
                                Keeping Existing
                              </div>
                            ) : f.resolution === 'rename' ? (
                              <div className="flex items-center gap-2 text-[var(--success)] font-medium">
                                <Edit3 size={12} />
                                Renamed
                              </div>
                            ) : f.resolution === 'keep_new' ? (
                              <div className="flex items-center gap-2 text-[var(--primary)] font-medium">
                                <Upload size={12} />
                                Will Replace
                              </div>
                            ) : f.matchedCompanyName ? (
                              <div className="flex items-center gap-2 text-[var(--success)] font-medium">
                                <Building2 size={12} />
                                {f.matchedCompanyName}
                              </div>
                            ) : f.matchedPhoneNumber ? (
                              <div className="flex items-center gap-2 text-[var(--primary)] font-medium">
                                <Phone size={12} />
                                Will match by phone
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-[var(--muted)]">
                                <AlertCircle size={12} />
                                No match found
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              onClick={() => removeFile(f.id)}
                              className="p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--error-subtle)] hover:text-[var(--error)] transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {files.map((f) => (
                    <div
                      key={f.id}
                      className={cn(
                        "p-4 rounded-xl border bg-[var(--card-bg)] flex items-center gap-3",
                        f.status === 'duplicate'
                          ? "border-[var(--error)] bg-[var(--error-subtle)]"
                          : f.resolution === 'keep_existing'
                            ? "border-[var(--card-border)] opacity-50"
                            : "border-[var(--card-border)]"
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-lg border flex items-center justify-center",
                        f.status === 'duplicate'
                          ? "bg-[var(--error)]/10 border-[var(--error)]/30 text-[var(--error)]"
                          : "bg-[var(--sidebar-bg)] border-[var(--card-border)] text-[var(--muted)]"
                      )}>
                        {f.status === 'duplicate' ? <AlertTriangle size={20} /> : <FileAudio size={20} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.file.name}</p>
                        {f.status === 'duplicate' ? (
                          <button
                            onClick={() => setDuplicateToResolve(f)}
                            className="text-[10px] text-[var(--error)] font-bold uppercase tracking-wider mt-0.5 hover:underline"
                          >
                            Duplicate - Click to resolve
                          </button>
                        ) : f.resolution === 'keep_existing' ? (
                          <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mt-0.5">
                            Skipped (keeping existing)
                          </p>
                        ) : (
                          <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mt-0.5">
                            {f.matchedPhoneNumber || 'Unknown Phone'}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => removeFile(f.id)}
                        className="text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <label className="p-4 rounded-xl border-2 border-dashed border-[var(--card-border)] flex items-center justify-center gap-2 text-sm text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--foreground)] cursor-pointer transition-all">
                    <Plus size={16} />
                    Add More
                    <input type="file" multiple accept="audio/*" className="hidden" onChange={handleFileSelect} />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--card-border)] bg-[var(--sidebar-bg)]">
          {/* Duplicate Warning */}
          {hasUnresolvedDuplicates && (
            <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg bg-[var(--error-subtle)] border border-[var(--error)]/30">
              <AlertTriangle size={16} className="text-[var(--error)]" />
              <span className="text-sm text-[var(--error)] font-medium">
                {duplicateFiles.length} duplicate{duplicateFiles.length > 1 ? 's' : ''} found. Please resolve before uploading.
              </span>
            </div>
          )}

          {/* Checking duplicates indicator */}
          {isCheckingDuplicates && (
            <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg bg-[var(--primary-subtle)] border border-[var(--primary)]/30">
              <Loader2 size={16} className="text-[var(--primary)] animate-spin" />
              <span className="text-sm text-[var(--primary)] font-medium">
                Checking for duplicates...
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-sm text-[var(--muted)]">
              <span className="font-bold text-[var(--foreground)]">{uploadableFiles.length}</span> recording{uploadableFiles.length !== 1 ? 's' : ''} ready to upload
              {files.filter(f => f.resolution === 'keep_existing').length > 0 && (
                <span className="ml-2">
                  (<span className="text-[var(--muted)]">{files.filter(f => f.resolution === 'keep_existing').length} skipped</span>)
                </span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl border border-[var(--card-border)] font-bold hover:bg-[var(--card-hover)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={uploadableFiles.length === 0 || isUploading || hasUnresolvedDuplicates || isCheckingDuplicates}
                className="px-8 py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    Upload{uploadableFiles.length > 0 ? ` (${uploadableFiles.length})` : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Plus(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}