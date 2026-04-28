'use client';

import { useLocalAgent } from '@/contexts/local-agent-context';
import { RotateCcw, Upload, AlertCircle } from 'lucide-react';

export function PendingUploadsPanel() {
    const ctx = useLocalAgent();
    const { uploadQueueStatus, sendCommand } = ctx;
    const failedUploads = (ctx as { failedUploads?: Array<{ fileName: string; phoneNumber: string; error: string | null }> }).failedUploads ?? [];
    const pendingCount = uploadQueueStatus?.pendingCount ?? 0;
    const failedCount = uploadQueueStatus?.failedCount ?? 0;

    if (pendingCount === 0 && failedCount === 0) return null;

    const onRetryAll = () => sendCommand({ type: 'retryAllUploads' });
    const onRetryOne = (fileName: string) => sendCommand({ type: 'uploadRecording', fileName });

    return (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--muted)] uppercase tracking-wider">
                    <Upload size={14} />
                    Recording Uploads
                </h3>
                {failedCount > 0 && (
                    <button
                        type="button"
                        onClick={onRetryAll}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)] hover:underline"
                    >
                        <RotateCcw size={12} /> Retry all
                    </button>
                )}
            </div>
            <div className="text-xs text-[var(--muted)]">
                {pendingCount > 0 && <span>{pendingCount} pending</span>}
                {pendingCount > 0 && failedCount > 0 && <span> · </span>}
                {failedCount > 0 && <span className="text-[var(--error)]">{failedCount} failed</span>}
            </div>
            {failedUploads.length > 0 && (
                <ul className="space-y-1.5 pt-1">
                    {failedUploads.slice(0, 5).map(f => (
                        <li key={f.fileName} className="flex items-start justify-between gap-2 text-xs">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 truncate">
                                    <AlertCircle size={12} className="shrink-0 text-[var(--error)]" />
                                    <span className="truncate font-medium">{f.phoneNumber || f.fileName}</span>
                                </div>
                                {f.error && <div className="truncate text-[var(--muted)] pl-[18px]">{f.error}</div>}
                            </div>
                            <button
                                type="button"
                                onClick={() => onRetryOne(f.fileName)}
                                className="shrink-0 font-medium text-[var(--primary)] hover:underline"
                            >
                                Retry
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
