"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { pb } from '@/lib/pocketbase';
import { Note, COLLECTIONS, User } from '@/lib/types';
import { format } from 'date-fns';
import { Plus, Archive, Trash2, RotateCcw, PenLine, X, StickyNote, Expand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import dynamic from 'next/dynamic';
import { extractPlainText } from '@/components/block-editor/helpers';
import { CardGridSkeleton } from '@/components/dashboard-skeletons';
import { SearchInput } from '@/components/search-input';

// Dynamic import — keeps Tiptap + ProseMirror out of the server bundle
const BlockEditor = dynamic(
  () => import('@/components/block-editor/block-editor').then((m) => ({ default: m.BlockEditor })),
  { ssr: false, loading: () => <div className="flex-1 min-h-[400px]" /> },
);

type Tab = 'active' | 'archived' | 'deleted';

export default function NotesPage() {
  const { isAuthenticated } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [currentNote, setCurrentNote] = useState<Partial<Note>>({});
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const currentNoteRef = useRef(currentNote);
  currentNoteRef.current = currentNote;
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const DRAFT_KEY = 'notes_editor_draft';

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft) as { note: Partial<Note>; editing: boolean };
        if (parsed.editing && (parsed.note.title || parsed.note.note_text)) {
          setCurrentNote(parsed.note);
          setIsEditing(true);
        }
      }
    } catch { /* ignore corrupt draft */ }
  }, []);

  // Persist draft to localStorage whenever editor state changes
  useEffect(() => {
    if (isEditing) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ note: currentNote, editing: true }));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [isEditing, currentNote]);

  useEffect(() => {
    if (isAuthenticated) fetchNotes();
  }, [isAuthenticated]);

  async function fetchNotes() {
    setLoading(true);
    try {
      const result = await pb.collection(COLLECTIONS.NOTES).getList<Note>(1, 200, {
        sort: '-updated',
        expand: 'created_by',
      });
      setNotes(result.items);
    } catch (error: unknown) {
      if ((error as { status?: number })?.status !== 0) console.error('Error fetching notes:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredNotes = notes.filter((n) => {
    // Search across plain text (handles both JSON and legacy notes)
    const plainText = extractPlainText(n.note_text);
    const matchesSearch =
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      plainText.toLowerCase().includes(search.toLowerCase());

    if (tab === 'active') return !n.is_archived && !n.is_deleted && matchesSearch;
    if (tab === 'archived') return n.is_archived && !n.is_deleted && matchesSearch;
    if (tab === 'deleted') return n.is_deleted && matchesSearch;
    return false;
  });

  const handleSave = useCallback(async () => {
    const note = currentNoteRef.current;
    const userId = pb.authStore.model?.id;
    if (!userId) {
      alert('You must be logged in to save notes.');
      return;
    }
    try {
      if (note.id) {
        await pb.collection(COLLECTIONS.NOTES).update(note.id, {
          title: note.title || 'Untitled',
          note_text: note.note_text || '',
          is_archived: note.is_archived || false,
          is_deleted: note.is_deleted || false,
        });
      } else {
        const created = await pb.collection(COLLECTIONS.NOTES).create({
          title: note.title || 'Untitled',
          note_text: note.note_text || '',
          created_by: userId,
          is_archived: note.is_archived || false,
          is_deleted: note.is_deleted || false,
        });
        // Update currentNote with the new ID so subsequent saves update instead of creating duplicates
        setCurrentNote((prev) => ({ ...prev, id: created.id }));
      }
      // Stay in editor — just refresh the list in background
      fetchNotes();
      setIsDirty(false);
      // Brief flash to confirm save
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } catch (e) {
      alert('Error saving note: ' + e);
    }
  }, []);

  // Ctrl+S to save
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditing, handleSave]);

  // "/" to focus search when not editing
  useEffect(() => {
    if (isEditing) return;
    const handler = (e: KeyboardEvent) => {
      // Skip if user is already typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === '/') {
        e.preventDefault();
        const input = searchContainerRef.current?.querySelector('input');
        input?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditing]);

  async function handleStatusChange(id: string, updates: Partial<Note>) {
    try {
      await pb.collection(COLLECTIONS.NOTES).update(id, updates);
      fetchNotes();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeletePermanent(id: string) {
    if (!confirm('Permanently delete this note?')) return;
    try {
      await pb.collection(COLLECTIONS.NOTES).delete(id);
      fetchNotes();
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) return <CardGridSkeleton />;

  // ─── Editor view ──────────────────────────────────────────────────────────
  if (isEditing) {
    return (
      <div className="h-full flex flex-col gap-4">
        {/* Editor header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <input
            type="text"
            placeholder="Untitled"
            className="text-2xl font-bold bg-transparent border-none focus:outline-none focus:ring-0 w-full placeholder:text-[var(--muted)]"
            value={currentNote.title || ''}
            onChange={(e) => { setCurrentNote({ ...currentNote, title: e.target.value }); setIsDirty(true); }}
            autoFocus={!currentNote.id}
          />
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {saveFlash && (
              <span className="text-xs text-[var(--success)] font-medium animate-pulse">Saved</span>
            )}
            <button
              onClick={() => { setIsEditing(false); setCurrentNote({}); localStorage.removeItem(DRAFT_KEY); }}
              className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-[var(--card-hover)] transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                isDirty
                  ? "bg-[var(--foreground)] text-[var(--background)] hover:opacity-90"
                  : "bg-[var(--muted)]/30 text-[var(--muted)] cursor-not-allowed opacity-50"
              )}
            >
              Save
            </button>
            <span className="text-[10px] text-[var(--muted)] hidden sm:inline">Ctrl+S</span>
          </div>
        </div>

        {/* Block editor */}
        <div className="flex-1 overflow-y-auto">
          <BlockEditor
            content={currentNote.note_text || ''}
            onChange={(value) => { setCurrentNote((prev) => ({ ...prev, note_text: value })); setIsDirty(true); }}
            autoFocus={!!currentNote.id}
            editable
          />
        </div>
      </div>
    );
  }

  // ─── List view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* View Note Modal */}
      {viewingNote && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setViewingNote(null)}
        >
          <div
            className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-[var(--card-border)]">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold truncate">{viewingNote.title}</h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                  <span>By {(viewingNote.expand?.created_by as User)?.name || 'Unknown'}</span>
                  <span>•</span>
                  <span>
                    {viewingNote.updated
                      ? format(new Date(viewingNote.updated), 'MMM d, yyyy h:mm a')
                      : '-'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setViewingNote(null)}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors ml-4"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal body — read-only block editor */}
            <div className="flex-1 overflow-y-auto p-6">
              <BlockEditor
                content={viewingNote.note_text}
                onChange={() => {}}
                editable={false}
              />
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--card-border)]">
              <button
                onClick={() => {
                  setCurrentNote(viewingNote);
                  setIsEditing(true);
                  setIsDirty(false);
                  setViewingNote(null);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors text-sm font-medium"
              >
                <PenLine size={14} />
                Edit Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notes</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Team notes and documentation</p>
        </div>
        <button
          onClick={() => { setCurrentNote({}); setIsEditing(true); setIsDirty(false); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors"
        >
          <Plus size={16} />
          New Note
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex bg-[var(--card-bg)] border border-[var(--card-border)] p-1 rounded-lg">
          {(['active', 'archived', 'deleted'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md capitalize transition-colors',
                tab === t
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div ref={searchContainerRef} className="relative flex-1 w-full sm:max-w-sm">
          <SearchInput
            placeholder="Search notes…"
            onSearch={setSearch}
            defaultValue={search}
            key={search}
            className="w-full sm:max-w-sm"
            hintLabel="/"
          />
        </div>
      </div>

      {/* Notes grid */}
      <div
        className={cn(
          filteredNotes.length === 0 &&
            'bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden',
        )}
      >
        {filteredNotes.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--warning-subtle)] flex items-center justify-center mx-auto mb-4">
              <StickyNote size={24} className="text-[var(--warning)]" />
            </div>
            <p className="text-sm font-medium">No notes found</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {search ? 'Try a different search term' : `No ${tab} notes yet`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNotes.map((note) => {
              const preview = extractPlainText(note.note_text);
              return (
                <div
                  key={note.id}
                  className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl flex flex-col h-64 card-interactive"
                >
                  <div className="p-4 flex-1 overflow-hidden">
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <h3 className="font-semibold text-sm truncate">{note.title}</h3>
                      <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider shrink-0">
                        {note.updated ? format(new Date(note.updated), 'MMM d') : '-'}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--muted)] whitespace-pre-wrap line-clamp-6">
                      {preview || 'Empty note'}
                    </p>
                  </div>

                  <div className="px-4 py-3 border-t border-[var(--card-border)] flex justify-between items-center">
                    <span className="text-xs text-[var(--muted)]">
                      {(note.expand?.created_by as User)?.name || 'Unknown'}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setViewingNote(note)}
                        className="p-1.5 rounded-md hover:bg-[var(--info-subtle)] text-[var(--muted)] hover:text-[var(--info)] transition-colors"
                        title="View"
                      >
                        <Expand size={14} />
                      </button>
                      <button
                        onClick={() => { setCurrentNote(note); setIsEditing(true); setIsDirty(false); }}
                        className="p-1.5 rounded-md hover:bg-[var(--primary-subtle)] text-[var(--muted)] hover:text-[var(--primary)] transition-colors"
                        title="Edit"
                      >
                        <PenLine size={14} />
                      </button>

                      {tab === 'active' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(note.id, { is_archived: true })}
                            className="p-1.5 rounded-md hover:bg-[var(--warning-subtle)] text-[var(--muted)] hover:text-[var(--warning)] transition-colors"
                            title="Archive"
                          >
                            <Archive size={14} />
                          </button>
                          <button
                            onClick={() => handleStatusChange(note.id, { is_deleted: true })}
                            className="p-1.5 rounded-md hover:bg-[var(--error-subtle)] text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                            title="Move to Trash"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}

                      {tab === 'archived' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(note.id, { is_archived: false })}
                            className="p-1.5 rounded-md hover:bg-[var(--success-subtle)] text-[var(--muted)] hover:text-[var(--success)] transition-colors"
                            title="Unarchive"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            onClick={() => handleStatusChange(note.id, { is_deleted: true })}
                            className="p-1.5 rounded-md hover:bg-[var(--error-subtle)] text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                            title="Move to Trash"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}

                      {tab === 'deleted' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(note.id, { is_deleted: false })}
                            className="p-1.5 rounded-md hover:bg-[var(--success-subtle)] text-[var(--muted)] hover:text-[var(--success)] transition-colors"
                            title="Restore"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            onClick={() => handleDeletePermanent(note.id)}
                            className="p-1.5 rounded-md hover:bg-[var(--error-subtle)] text-[var(--muted)] hover:text-[var(--error)] transition-colors"
                            title="Delete Permanently"
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
