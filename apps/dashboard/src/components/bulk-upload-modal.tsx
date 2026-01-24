'use client';

import { useState, useCallback } from 'react';
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
  Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PendingFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  matchedPhoneNumber?: string;
  matchedCompanyId?: string;
  matchedCompanyName?: string;
  error?: string;
}

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (files: PendingFile[]) => Promise<void>;
}

export function BulkUploadModal({
  isOpen,
  onClose,
  onUpload
}: BulkUploadModalProps) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [viewMode, setViewMode] = useState<'simple' | 'preview'>('preview');

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (newFiles: File[]) => {
    const audioFiles = newFiles.filter(f => f.type.startsWith('audio/'));
    const pendingFiles: PendingFile[] = audioFiles.map(f => {
      // Simple regex to match phone number from filename (assuming format like "2026-01-24_2125551234.mp3")
      const phoneMatch = f.name.match(/\d{10,15}/);
      return {
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        status: 'pending',
        matchedPhoneNumber: phoneMatch ? phoneMatch[0] : undefined
      };
    });
    setFiles(prev => [...prev, ...pendingFiles]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleUpload = async () => {
    setIsUploading(true);
    try {
      await onUpload(files);
      setFiles([]);
      onClose();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

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
            <div className="space-y-6">
              {viewMode === 'preview' ? (
                <div className="border border-[var(--card-border)] rounded-xl overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)] text-[var(--muted)]">
                      <tr>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px]">Filename</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px]">Detected Phone</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px]">Match Status</th>
                        <th className="px-4 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--card-border)]">
                      {files.map((f) => (
                        <tr key={f.id} className="hover:bg-[var(--sidebar-bg)] transition-colors">
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
                            {f.matchedCompanyName ? (
                              <div className="flex items-center gap-2 text-[var(--success)] font-medium">
                                <Building2 size={12} />
                                {f.matchedCompanyName}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-[var(--muted)]">
                                <AlertCircle size={12} />
                                Auto-matching...
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
                    <div key={f.id} className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center text-[var(--muted)]">
                        <FileAudio size={20} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.file.name}</p>
                        <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mt-0.5">
                          {f.matchedPhoneNumber || 'Unknown Phone'}
                        </p>
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
        <div className="p-6 border-t border-[var(--card-border)] bg-[var(--sidebar-bg)] flex items-center justify-between">
          <div className="text-sm text-[var(--muted)]">
            <span className="font-bold text-[var(--foreground)]">{files.length}</span> recordings selected
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
              disabled={files.length === 0 || isUploading}
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
                  Upload All
                </>
              )}
            </button>
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