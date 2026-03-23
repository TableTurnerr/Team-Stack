'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Play, Pause, Download, Minimize2, Maximize2, X } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { type Recording } from '@/lib/types';
import { cn } from '@/lib/utils';

interface RecordingPlayerOverlayProps {
    /** PocketBase recording object */
    recording: Recording | null;
    /** Optional blob URL for in-memory browser recordings */
    blobUrl?: string | null;
    /** Called when the player is closed */
    onClose: () => void;
}

export function RecordingPlayerOverlay({ recording, blobUrl, onClose }: RecordingPlayerOverlayProps) {
    const [playerMinimized, setPlayerMinimized] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isHoveringMic, setIsHoveringMic] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const isOpen = !!(recording || blobUrl);

    const closePlayer = useCallback(() => {
        audioRef.current?.pause();
        if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
        }
        setPlayerMinimized(false);
        setIsPlaying(false);
        onClose();
    }, [blobUrl, onClose]);

    const togglePlayback = useCallback(() => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
    }, [isPlaying]);

    // Reset minimized state when a new recording opens
    useEffect(() => {
        if (isOpen) {
            setPlayerMinimized(false);
            setIsPlaying(false);
        }
    }, [recording?.id, blobUrl]);

    if (!isOpen) return null;

    const title = recording
        ? (recording.note || recording.original_filename || 'Call Recording')
        : 'Unsubmitted Recording';

    const audioSrc = blobUrl || (recording?.file ? pb.files.getUrl(recording, recording.file) : '');
    const hasFile = !!(blobUrl || recording?.file);
    const downloadUrl = recording?.file ? pb.files.getUrl(recording, recording.file) : null;

    return (
        <div
            className={cn(
                "fixed z-[60] transition-all duration-300",
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
                                    {title}
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
                                        {title}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {!playerMinimized && downloadUrl && (
                            <a
                                href={downloadUrl}
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
                {hasFile ? (
                    <audio
                        ref={audioRef}
                        controls={!playerMinimized}
                        autoPlay
                        preload="metadata"
                        className={cn(
                            "w-full h-10 transition-all",
                            playerMinimized ? "h-0 opacity-0 pointer-events-none" : "h-10 opacity-100"
                        )}
                        src={audioSrc}
                        onEnded={closePlayer}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                    />
                ) : !playerMinimized && (
                    <p className="text-sm text-[var(--muted)] text-center py-2">No audio file attached.</p>
                )}
            </div>
        </div>
    );
}
