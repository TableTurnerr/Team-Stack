"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { Note, COLLECTIONS, User } from '@/lib/types';
import { format } from 'date-fns';
import { Plus, Archive, Trash2, RotateCcw, FileText, Search, X } from 'lucide-react';

type Tab = 'active' | 'archived' | 'deleted';

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  
  const [isEditing, setIsEditing] = useState(false);
  const [currentNote, setCurrentNote] = useState<Partial<Note>>({});

  useEffect(() => {
    fetchNotes();
  }, []);

  async function fetchNotes() {
    setLoading(true);
    try {
      const result = await pb.collection(COLLECTIONS.NOTES).getList<Note>(1, 200, {
        sort: '-updated',
        expand: 'created_by'
      });
      setNotes(result.items);
    } catch (error) {
      console.error("Error fetching notes:", error);
    } finally {
      setLoading(false);
    }
  }

  const filteredNotes = notes.filter(n => {
    const matchesSearch = n.title.toLowerCase().includes(search.toLowerCase()) || 
                          n.note_text.toLowerCase().includes(search.toLowerCase());
    
    if (tab === 'active') return !n.is_archived && !n.is_deleted && matchesSearch;
    if (tab === 'archived') return n.is_archived && !n.is_deleted && matchesSearch;
    if (tab === 'deleted') return n.is_deleted && matchesSearch;
    return false;
  });

  async function handleSave() {
    try {
      const data = {
        title: currentNote.title || 'Untitled',
        note_text: currentNote.note_text || '',
        created_by: pb.authStore.model?.id, // Assuming logged in, otherwise fail or optional
        is_archived: currentNote.is_archived || false,
        is_deleted: currentNote.is_deleted || false
      };

      if (currentNote.id) {
        await pb.collection(COLLECTIONS.NOTES).update(currentNote.id, data);
      } else {
        await pb.collection(COLLECTIONS.NOTES).create(data);
      }
      setIsEditing(false);
      setCurrentNote({});
      fetchNotes();
    } catch (e) {
      alert("Error saving note: " + e);
    }
  }

  async function handleStatusChange(id: string, updates: Partial<Note>) {
    try {
      await pb.collection(COLLECTIONS.NOTES).update(id, updates);
      fetchNotes();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeletePermanent(id: string) {
    if (!confirm("Permanently delete this note?")) return;
    try {
      await pb.collection(COLLECTIONS.NOTES).delete(id);
      fetchNotes();
    } catch (e) {
      console.error(e);
    }
  }

  if (isEditing) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <input 
            type="text" 
            placeholder="Note Title" 
            className="text-2xl font-bold border-none focus:ring-0 w-full bg-transparent"
            value={currentNote.title || ''}
            onChange={e => setCurrentNote({...currentNote, title: e.target.value})}
          />
          <div className="flex gap-2">
            <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
          </div>
        </div>
        <textarea 
          className="flex-1 w-full p-4 border rounded-lg focus:ring-2 focus:ring-blue-500 resize-none font-mono text-sm"
          placeholder="Write your note here (Markdown supported)..."
          value={currentNote.note_text || ''}
          onChange={e => setCurrentNote({...currentNote, note_text: e.target.value})}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Notes</h1>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            {(['active', 'archived', 'deleted'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 text-sm font-medium rounded-md capitalize ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <button 
          onClick={() => { setCurrentNote({}); setIsEditing(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} />
          New Note
        </button>
      </div>

      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text" 
            placeholder="Search notes..." 
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredNotes.map((note) => (
          <div key={note.id} className="bg-white rounded-lg shadow border hover:shadow-md transition-shadow flex flex-col h-64">
            <div className="p-4 flex-1 overflow-hidden">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg truncate pr-2">{note.title}</h3>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                   {format(new Date(note.updated), 'MMM d')}
                </span>
              </div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-6">{note.note_text}</p>
            </div>
            
            <div className="p-3 bg-gray-50 border-t flex justify-between items-center">
              <div className="text-xs text-gray-500">
                {(note.expand?.created_by as User)?.name || 'Unknown'}
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => { setCurrentNote(note); setIsEditing(true); }}
                  className="p-1 hover:bg-gray-200 rounded text-gray-600"
                  title="Edit"
                >
                  <FileText size={16} />
                </button>

                {tab === 'active' && (
                  <>
                    <button 
                      onClick={() => handleStatusChange(note.id, { is_archived: true })}
                      className="p-1 hover:bg-gray-200 rounded text-gray-600"
                      title="Archive"
                    >
                      <Archive size={16} />
                    </button>
                    <button 
                      onClick={() => handleStatusChange(note.id, { is_deleted: true })}
                      className="p-1 hover:bg-red-100 rounded text-red-600"
                      title="Move to Trash"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}

                {tab === 'archived' && (
                  <>
                    <button 
                      onClick={() => handleStatusChange(note.id, { is_archived: false })}
                      className="p-1 hover:bg-gray-200 rounded text-gray-600"
                      title="Unarchive"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button 
                      onClick={() => handleStatusChange(note.id, { is_deleted: true })}
                      className="p-1 hover:bg-red-100 rounded text-red-600"
                      title="Move to Trash"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}

                {tab === 'deleted' && (
                  <>
                    <button 
                      onClick={() => handleStatusChange(note.id, { is_deleted: false })}
                      className="p-1 hover:bg-gray-200 rounded text-gray-600"
                      title="Restore"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button 
                      onClick={() => handleDeletePermanent(note.id)}
                      className="p-1 hover:bg-red-100 rounded text-red-600"
                      title="Delete Permanently"
                    >
                      <X size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        
        {filteredNotes.length === 0 && (
          <div className="col-span-full text-center py-10 text-gray-500">
            No notes found in {tab}.
          </div>
        )}
      </div>
    </div>
  );
}