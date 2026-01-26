'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { 
  Building2, 
  Phone, 
  History, 
  StickyNote, 
  ChevronLeft, 
  Save, 
  Undo2,
  Plus,
  Loader2,
  MapPin,
  Instagram,
  Mail,
  ExternalLink,
  MessageSquare,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { 
  COLLECTIONS, 
  type Company, 
  type PhoneNumber, 
  type CallLog, 
  type CompanyNote, 
  type Interaction,
  type FollowUp
} from '@/lib/types';
import { cn, formatDate } from '@/lib/utils';
import { InlineEditField } from '@/components/inline-edit-field';
import { PhoneNumberCard } from '@/components/phone-number-card';
import { CallLogForm } from '@/components/call-log-form';

type TabType = 'overview' | 'phones' | 'calls' | 'notes' | 'timeline';

export default function CompanyDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  
  // Data State
  const [company, setCompany] = useState<Company | null>(null);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [notes, setNotes] = useState<CompanyNote[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);

  // Modals
  const [isLogCallOpen, setIsLogCallOpen] = useState(false);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null);
  const [isEditingAll, setIsEditingAll] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [
          companyData,
          phonesData,
          callsData,
          notesData,
          interactionsData,
          followUpsData
        ] = await Promise.all([
          pb.collection(COLLECTIONS.COMPANIES).getOne<Company>(id),
          pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
            filter: `company = "${id}"`,
            sort: 'created'
          }),
          pb.collection(COLLECTIONS.CALL_LOGS).getFullList<CallLog>({
            filter: `company = "${id}"`,
            sort: '-call_time',
            expand: 'phone_number_record,caller'
          }),
          pb.collection(COLLECTIONS.COMPANY_NOTES).getFullList<CompanyNote>({
            filter: `company = "${id}"`,
            sort: '-created',
            expand: 'created_by'
          }),
          pb.collection(COLLECTIONS.INTERACTIONS).getFullList<Interaction>({
            filter: `company = "${id}"`,
            sort: '-timestamp',
            expand: 'user'
          }),
          pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
            filter: `company = "${id}" && status = "pending"`,
            sort: 'scheduled_time'
          })
        ]);

        setCompany(companyData);
        setPhoneNumbers(phonesData);
        setCallLogs(callsData);
        setNotes(notesData);
        setInteractions(interactionsData);
        setFollowUps(followUpsData);
      } catch (error) {
        console.error('Failed to fetch company details:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const handleUpdateCompany = async (field: keyof Company, value: string) => {
    if (!company) return;
    try {
      await pb.collection(COLLECTIONS.COMPANIES).update(company.id, { [field]: value });
      setCompany(prev => prev ? { ...prev, [field]: value } : null);
    } catch (error) {
      console.error(`Failed to update ${String(field)}:`, error);
      throw error;
    }
  };

  const handleAddNote = async () => {
    if (!company || !newNoteContent.trim()) return;
    try {
      const newNote = await pb.collection(COLLECTIONS.COMPANY_NOTES).create<CompanyNote>({
        company: company.id,
        note_type: 'pre_call',
        content: newNoteContent,
        created_by: pb.authStore.model?.id
      });
      
      const expandedNote = await pb.collection(COLLECTIONS.COMPANY_NOTES).getOne<CompanyNote>(newNote.id, {
        expand: 'created_by'
      });

      setNotes(prev => [expandedNote, ...prev]);
      setNewNoteContent('');
      setIsAddingNote(false);

      // Log interaction
      await pb.collection(COLLECTIONS.INTERACTIONS).create({
        company: company.id,
        channel: 'email', // Defaulting to email for notes/research
        direction: 'outbound',
        timestamp: new Date().toISOString(),
        user: pb.authStore.model?.id,
        summary: `Added pre-call note: ${newNoteContent.substring(0, 50)}...`,
      });
    } catch (error) {
      console.error('Failed to add note:', error);
    }
  };

  const handleLogCall = async (data: Partial<CallLog>) => {
    if (!company || !selectedPhoneId) return;
    try {
      const newCall = await pb.collection(COLLECTIONS.CALL_LOGS).create<CallLog>({
        ...data,
        company: company.id,
        phone_number_record: selectedPhoneId,
        caller: pb.authStore.model?.id
      });
      
      // Update local state
      setCallLogs(prev => [newCall, ...prev]);
      
      // Also update the phone number's last_called date
      await pb.collection(COLLECTIONS.PHONE_NUMBERS).update(selectedPhoneId, {
        last_called: newCall.call_time,
        receptionist_name: data.receptionist_name
      });

      // Refresh phones to show updated last_called
      const updatedPhones = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getFullList<PhoneNumber>({
        filter: `company = "${id}"`,
        sort: 'created'
      });
      setPhoneNumbers(updatedPhones);

      // Log interaction
      await pb.collection(COLLECTIONS.INTERACTIONS).create({
        company: company.id,
        channel: 'phone',
        direction: 'outbound',
        timestamp: newCall.call_time,
        user: pb.authStore.model?.id,
        summary: `Call: ${data.call_outcome} - ${data.post_call_notes?.substring(0, 50)}...`,
        call_log: newCall.id
      });

    } catch (error) {
      console.error('Failed to log call:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
        <p className="text-sm text-[var(--muted)] font-medium">Loading company intelligence...</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold">Company not found</h2>
        <button 
          onClick={() => router.push('/companies')}
          className="mt-4 text-[var(--primary)] hover:underline flex items-center gap-2 justify-center"
        >
          <ChevronLeft size={16} /> Back to Companies
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Breadcrumbs & Header */}
      <div className="flex flex-col gap-4">
        <button 
          onClick={() => router.push('/companies')}
          className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors w-fit"
        >
          <ChevronLeft size={16} />
          Back to Companies
        </button>
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
              {company.company_name}
              {company.status && (
                <span className={cn(
                  "px-2 py-0.5 text-xs font-bold rounded-full border",
                  company.status === 'Warm' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                  company.status === 'Replied' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  "bg-[var(--card-hover)] text-[var(--muted)] border-[var(--card-border)]"
                )}>
                  {company.status}
                </span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)] font-medium">
              {company.instagram_handle && (
                <a href={`https://instagram.com/${company.instagram_handle.replace('@', '')}`} target="_blank" className="flex items-center gap-1.5 hover:text-[var(--foreground)]">
                  <Instagram size={14} />
                  @{company.instagram_handle.replace('@', '')}
                </a>
              )}
              {company.email && (
                <a href={`mailto:${company.email}`} className="flex items-center gap-1.5 hover:text-[var(--foreground)]">
                  <Mail size={14} />
                  {company.email}
                </a>
              )}
              {company.company_location && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={14} />
                  {company.company_location}
                  {company.google_maps_link && (
                    <a href={company.google_maps_link} target="_blank" className="text-[var(--primary)]">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                setActiveTab('overview');
                setIsEditingAll(!isEditingAll);
              }}
              className={cn(
                "px-4 py-2 rounded-xl border text-sm font-bold transition-all",
                isEditingAll 
                  ? "bg-[var(--primary-subtle)] border-[var(--primary)] text-[var(--primary)]" 
                  : "border-[var(--card-border)] hover:bg-[var(--card-hover)]"
              )}
            >
              {isEditingAll ? 'Cancel Editing' : 'Edit Details'}
            </button>
            <button 
              onClick={() => setIsEditingAll(false)}
              className="px-6 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-bold hover:opacity-90 transition-all shadow-lg"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--card-border)] overflow-x-auto no-scrollbar">
        {[
          { id: 'overview', label: 'Overview', icon: Building2 },
          { id: 'phones', label: 'Locations & Phones', icon: Phone },
          { id: 'calls', label: 'Call History', icon: History },
          { id: 'notes', label: 'Pre-Call Notes', icon: StickyNote },
          { id: 'timeline', label: 'Timeline', icon: MessageSquare },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={cn(
              "flex items-center gap-2 px-6 py-4 text-sm font-bold transition-all relative whitespace-nowrap",
              activeTab === tab.id 
                ? "text-[var(--foreground)]" 
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            )}
          >
            <tab.icon size={16} />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--foreground)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 space-y-6">
                <h3 className="text-lg font-bold">General Information</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
                  <InlineEditField 
                    id={`company_${id}_name`}
                    label="Company Name"
                    value={company.company_name}
                    onSave={(v) => handleUpdateCompany('company_name', v)}
                    isEditing={isEditingAll}
                  />
                  <InlineEditField 
                    id={`company_${id}_owner`}
                    label="Owner / Decision Maker"
                    value={company.owner_name || ''}
                    onSave={(v) => handleUpdateCompany('owner_name', v)}
                    placeholder="Enter owner name..."
                    isEditing={isEditingAll}
                  />
                  <InlineEditField 
                    id={`company_${id}_status`}
                    label="CRM Status"
                    value={company.status || 'Cold No Reply'}
                    type="select"
                    options={[
                      { value: 'Cold No Reply', label: 'Cold No Reply' },
                      { value: 'Replied', label: 'Replied' },
                      { value: 'Warm', label: 'Warm' },
                      { value: 'Booked', label: 'Booked' },
                      { value: 'Paid', label: 'Paid' },
                      { value: 'Client', label: 'Client' },
                      { value: 'Excluded', label: 'Excluded' },
                    ]}
                    onSave={(v) => handleUpdateCompany('status', v)}
                    isEditing={isEditingAll}
                  />
                  <InlineEditField 
                    id={`company_${id}_ig`}
                    label="Instagram Handle"
                    value={company.instagram_handle || ''}
                    onSave={(v) => handleUpdateCompany('instagram_handle', v)}
                    placeholder="@username"
                    isEditing={isEditingAll}
                  />
                </div>
              </div>

              {followUps.length > 0 && (
                <div className="bg-orange-500/5 border border-orange-500/20 rounded-2xl p-6 space-y-4">
                  <h3 className="text-sm font-bold text-orange-400 uppercase tracking-widest flex items-center gap-2">
                    <Clock size={14} />
                    Active Follow-Ups ({followUps.length})
                  </h3>
                  <div className="space-y-3">
                    {followUps.map(fu => (
                      <div key={fu.id} className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold">{formatDate(fu.scheduled_time)}</p>
                          <p className="text-xs text-[var(--muted)] mt-0.5">{fu.notes}</p>
                        </div>
                        <button className="p-2 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white transition-all">
                          <CheckCircle2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6">
                <h3 className="text-sm font-bold text-[var(--muted)] uppercase tracking-widest mb-4">Quick Stats</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--muted)]">Total Calls</span>
                    <span className="text-sm font-bold">{callLogs.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--muted)]">Phone Numbers</span>
                    <span className="text-sm font-bold">{phoneNumbers.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--muted)]">Last Contact</span>
                    <span className="text-sm font-bold">{company.last_contacted ? formatDate(company.last_contacted) : 'Never'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--muted)] uppercase tracking-widest">Pre-Call Notes</h3>
                  <button 
                    onClick={() => {
                      setActiveTab('notes');
                      setIsAddingNote(true);
                    }}
                    className="p-1.5 rounded-lg bg-[var(--card-hover)] text-[var(--foreground)] hover:bg-[var(--sidebar-hover)] transition-all"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                
                <div className="space-y-3">
                  {notes.slice(0, 2).map(note => (
                    <div key={note.id} className="text-sm p-3 rounded-xl bg-[var(--sidebar-bg)] border border-[var(--card-border)]">
                      <p className="line-clamp-3 text-[var(--foreground)] font-medium leading-relaxed">{note.content}</p>
                      <p className="text-[10px] text-[var(--muted)] mt-2 font-bold">{formatDate(note.created)}</p>
                    </div>
                  ))}
                  {notes.length === 0 && (
                    <p className="text-xs text-[var(--muted)] italic py-4 text-center">No pre-call notes found.</p>
                  )}
                  {notes.length > 2 && (
                    <button 
                      onClick={() => setActiveTab('notes')}
                      className="text-xs text-[var(--primary)] font-bold hover:underline w-full text-center"
                    >
                      View all notes
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'phones' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Registered Locations</h3>
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-xs font-bold hover:opacity-90">
                <Plus size={14} />
                Add Phone Number
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {phoneNumbers.map(phone => (
                <PhoneNumberCard 
                  key={phone.id}
                  phoneNumber={phone}
                  recentCalls={callLogs.filter(c => c.phone_number_record === phone.id).slice(0, 3)}
                  onEdit={(id) => console.log('Edit', id)}
                  onDelete={(id) => console.log('Delete', id)}
                  onLogCall={(id) => {
                    setSelectedPhoneId(id);
                    setIsLogCallOpen(true);
                  }}
                />
              ))}
              {phoneNumbers.length === 0 && (
                <div className="col-span-full py-12 text-center bg-[var(--sidebar-bg)] border-2 border-dashed border-[var(--card-border)] rounded-2xl">
                  <Phone size={32} className="mx-auto text-[var(--muted)] mb-3" />
                  <p className="text-[var(--muted)] font-medium">No phone numbers registered for this company.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'calls' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Call History</h3>
            </div>
            
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)] text-[var(--muted)]">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Date & Time</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Number</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Outcome</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Summary</th>
                    <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)]">
                  {callLogs.map(call => (
                    <tr key={call.id} className="hover:bg-[var(--sidebar-bg)] transition-colors">
                      <td className="px-6 py-4 text-sm font-medium">{formatDate(call.call_time)}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-mono">{call.expand?.phone_number_record?.phone_number}</div>
                        <div className="text-[10px] text-[var(--muted)] font-bold">{call.expand?.phone_number_record?.label}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold",
                          call.call_outcome === 'Interested' ? "bg-green-500/10 text-green-400" :
                          call.call_outcome === 'No Answer' ? "bg-red-500/10 text-red-400" :
                          "bg-[var(--card-hover)] text-[var(--muted)]"
                        )}>
                          {call.call_outcome}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--muted)] max-w-xs truncate">
                        {call.post_call_notes}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-[var(--primary)] text-xs font-bold hover:underline">View Transcript</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {callLogs.length === 0 && (
                <div className="py-24 text-center">
                  <History size={48} className="mx-auto text-[var(--card-border)] mb-4" />
                  <p className="text-[var(--muted)]">No call logs available for this company.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Pre-Call Notes</h3>
              <button 
                onClick={() => setIsAddingNote(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-xs font-bold hover:opacity-90 transition-all shadow-sm"
              >
                <Plus size={14} />
                Add Note
              </button>
            </div>
            
            {isAddingNote && (
              <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <StickyNote size={16} className="text-[var(--primary)]" />
                  <span className="text-sm font-bold">New Pre-Call Note</span>
                </div>
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Enter pre-call notes, research, or key talking points..."
                  className="w-full bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-xl px-4 py-3 focus:outline-none focus:ring-1 focus:ring-[var(--foreground)] text-sm min-h-[120px] transition-all"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button 
                    onClick={() => {
                      setIsAddingNote(false);
                      setNewNoteContent('');
                    }}
                    className="px-4 py-2 text-xs font-bold hover:bg-[var(--card-hover)] rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleAddNote}
                    disabled={!newNoteContent.trim()}
                    className="px-6 py-2 bg-[var(--foreground)] text-[var(--background)] text-xs font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    Save Note
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              {notes.map(note => (
                <div key={note.id} className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-6 space-y-3 hover:border-[var(--sidebar-border)] transition-all">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-[var(--primary-subtle)] text-[var(--primary)]">
                        <StickyNote size={16} />
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider">{note.note_type.replace('_', ' ')}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] text-[var(--muted)]">{formatDate(note.created)}</p>
                          {note.expand?.created_by && (
                            <span className="text-[10px] text-[var(--muted)] flex items-center gap-1">
                              • by <span className="font-bold text-[var(--foreground)]">{note.expand.created_by.name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-[var(--foreground)]">{note.content}</p>
                </div>
              ))}
              {notes.length === 0 && !isAddingNote && (
                <div className="py-24 text-center bg-[var(--sidebar-bg)] border-2 border-dashed border-[var(--card-border)] rounded-2xl">
                  <StickyNote size={48} className="mx-auto text-[var(--card-border)] mb-4" />
                  <p className="text-[var(--muted)] font-medium">No notes yet. Add one to prepare for your next call.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <h3 className="text-lg font-bold">Activity Timeline</h3>
            <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:ml-[2.5rem] before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-[var(--card-border)] before:to-transparent">
              {interactions.map((interaction) => (
                <div key={interaction.id} className="relative flex gap-6 md:gap-8 group">
                  <div className="absolute left-0 inset-0 flex justify-center w-10 md:w-20">
                    <div className="h-full w-0.5 bg-[var(--card-border)] group-last:bg-[linear-gradient(to_bottom,var(--card-border)_50%,transparent_50%)]"></div>
                  </div>
                  <div className="relative z-10 flex-none w-10 h-10 md:w-16 md:h-16 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center text-[var(--muted)] shadow-sm">
                      {interaction.channel === 'phone' ? <Phone size={14} /> : 
                       interaction.channel === 'instagram' ? <Instagram size={14} /> : 
                       <Mail size={14} />}
                    </div>
                  </div>
                  <div className="flex-auto pb-8">
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl p-4 shadow-sm hover:border-[var(--sidebar-border)] transition-all">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest">{interaction.channel} interaction</span>
                        <time className="text-[10px] text-[var(--muted)]">{formatDate(interaction.timestamp)}</time>
                      </div>
                      <p className="text-sm font-medium">{interaction.summary}</p>
                      {interaction.expand?.user && (
                        <p className="mt-3 text-[10px] text-[var(--muted)] flex items-center gap-1">
                          By <span className="text-[var(--foreground)] font-bold">{interaction.expand.user.name}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {interactions.length === 0 && (
                <div className="py-24 text-center">
                  <MessageSquare size={48} className="mx-auto text-[var(--card-border)] mb-4" />
                  <p className="text-[var(--muted)]">No activity recorded yet.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <CallLogForm 
        isOpen={isLogCallOpen}
        onClose={() => setIsLogCallOpen(false)}
        onSubmit={handleLogCall}
        companyName={company.company_name}
        phoneNumber={phoneNumbers.find(p => p.id === selectedPhoneId)?.phone_number || ''}
      />
    </div>
  );
}
