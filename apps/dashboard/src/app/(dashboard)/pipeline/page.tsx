'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Building2, CalendarDays, Check, ChevronsUpDown, CircleDot, Copy, ExternalLink, GitBranch, GripVertical, Loader2, Mail, MessageSquareText, Pencil, Phone, RefreshCw, UserRound, X } from 'lucide-react';
import { PageGuard } from '@/components/page-guard';
import { dashboardApi, DashboardApiError } from '@/lib/ghl-dashboard-client';
import type { GhlUser, LeadFormConfig, OpportunityDetail, OpportunityPage, OpportunitySummary, PipelineStage } from '@/server/ghl-dashboard/models';
import { useAuth } from '@/contexts/auth-context';
import { getGhlPreferences, saveGhlPreferences } from '@/lib/ghl-preferences';

type ColumnState = { items: OpportunitySummary[]; cursor?: string; loading: boolean; loaded: boolean; error?: string };
const control = 'w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm';

function sanitizeContactNoteHtml(html: string) {
  // GHL note bodies are HTML. Keep the useful formatting but never inject its
  // raw markup directly into the dashboard.
  if (typeof window === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const document = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3', 'I', 'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'U', 'UL']);
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        element.setAttribute('href', href);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        element.removeAttribute('href');
      }
    } else {
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    }
  }
  return document.body.innerHTML;
}

// GHL pages can overlap while opportunities are being updated. Keep a single
// card per opportunity so pagination and refreshes cannot produce duplicate keys.
function uniqueOpportunities(items: OpportunitySummary[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export default function PipelinePage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<LeadFormConfig | null>(null);
  const [pipelineId, setPipelineId] = useState('');
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [mutation, setMutation] = useState<string | null>(null);
  const [pipelineMenuOpen, setPipelineMenuOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const boardScrollbarRef = useRef<HTMLDivElement>(null);
  const edgeScrollFrame = useRef<number | null>(null);
  const edgeScrollVelocity = useRef(0);
  const verticalEdgeScrollVelocity = useRef(0);

  function stopEdgeScroll() {
    edgeScrollVelocity.current = 0;
    verticalEdgeScrollVelocity.current = 0;
    if (edgeScrollFrame.current !== null) {
      cancelAnimationFrame(edgeScrollFrame.current);
      edgeScrollFrame.current = null;
    }
  }

  function runEdgeScroll() {
    const board = boardRef.current;
    if (!board || (!edgeScrollVelocity.current && !verticalEdgeScrollVelocity.current)) { edgeScrollFrame.current = null; return; }
    if (edgeScrollVelocity.current) board.scrollLeft += edgeScrollVelocity.current;
    if (verticalEdgeScrollVelocity.current) window.scrollBy({ top: verticalEdgeScrollVelocity.current });
    edgeScrollFrame.current = requestAnimationFrame(runEdgeScroll);
  }

  function handleEdgeScroll(clientX: number, clientY: number) {
    const board = boardRef.current;
    if (!board) return;
    const { left, right } = board.getBoundingClientRect();
    const edgeSize = 84;
    const leftProgress = Math.max(0, Math.min(1, (left + edgeSize - clientX) / edgeSize));
    const rightProgress = Math.max(0, Math.min(1, (clientX - (right - edgeSize)) / edgeSize));
    edgeScrollVelocity.current = leftProgress ? -(1.5 + leftProgress * 10) : rightProgress ? 1.5 + rightProgress * 10 : 0;
    const verticalEdgeSize = 96;
    const topProgress = Math.max(0, Math.min(1, (verticalEdgeSize - clientY) / verticalEdgeSize));
    const bottomProgress = Math.max(0, Math.min(1, (clientY - (window.innerHeight - verticalEdgeSize)) / verticalEdgeSize));
    verticalEdgeScrollVelocity.current = topProgress ? -(1.5 + topProgress * 10) : bottomProgress ? 1.5 + bottomProgress * 10 : 0;
    if (!edgeScrollVelocity.current && !verticalEdgeScrollVelocity.current) { stopEdgeScroll(); return; }
    if (edgeScrollFrame.current === null) edgeScrollFrame.current = requestAnimationFrame(runEdgeScroll);
  }

  useEffect(() => () => stopEdgeScroll(), []);

  const loadColumn = useCallback(async (selectedPipelineId: string, stageId: string, append = false, force = false) => {
    let cursor: string | undefined;
    setColumns(current => {
      cursor = append ? current[stageId]?.cursor : undefined;
      return { ...current, [stageId]: { ...(current[stageId] || { items: [], loaded: false }), loading: true, error: undefined } };
    });
    try {
      const query = new URLSearchParams({ pipelineId: selectedPipelineId, stageId });
      if (cursor) query.set('cursor', cursor);
      const page = await dashboardApi<OpportunityPage>(`/opportunities?${query}`, force ? { cache: 'reload' } : undefined);
      setColumns(current => ({
        ...current,
        [stageId]: {
          items: uniqueOpportunities(append ? [...(current[stageId]?.items || []), ...page.items] : page.items),
          cursor: page.nextCursor,
          loading: false,
          loaded: true,
        },
      }));
    } catch (e) {
      const apiError = e as DashboardApiError;
      setColumns(current => ({ ...current, [stageId]: { ...(current[stageId] || { items: [] }), loading: false, loaded: true, error: apiError.message } }));
    }
  }, []);

  useEffect(() => {
    dashboardApi<LeadFormConfig>('/config').then(value => {
      setConfig(value);
      const saved = getGhlPreferences(user?.id || 'anonymous');
      const pipeline = value.pipelines.find(item => item.id === saved.pipelineId) || value.pipelines[0];
      setPipelineId(pipeline?.id || '');
      pipeline?.stages.forEach(stage => void loadColumn(pipeline.id, stage.id));
    }).catch((e: DashboardApiError) => setError(e.message));
  }, [loadColumn, user?.id]);

  const pipeline = config?.pipelines.find(item => item.id === pipelineId);
  const pipelineItems = pipeline?.stages.flatMap(stage => columns[stage.id]?.items || []) || [];
  const pipelineValue = pipelineItems.reduce((sum, item) => sum + item.monetaryValue, 0);

  function selectPipeline(nextId: string) {
    const next = config?.pipelines.find(item => item.id === nextId);
    setPipelineId(nextId);
    setColumns({});
    setPipelineMenuOpen(false);
    if (user?.id) saveGhlPreferences(user.id, { pipelineId: nextId, stageId: next?.stages[0]?.id });
    next?.stages.forEach(stage => void loadColumn(next.id, stage.id));
  }

  async function move(card: OpportunitySummary, stageId: string) {
    if (stageId === card.stageId || mutation) return;
    setMutation(card.id); setError('');
    try {
      await dashboardApi(`/opportunities/${card.id}`, { method: 'PATCH', body: JSON.stringify({ pipelineId, stageId }) });
      await Promise.all([loadColumn(pipelineId, card.stageId), loadColumn(pipelineId, stageId)]);
    } catch (e) { setError((e as DashboardApiError).message); }
    finally { setMutation(null); }
  }

  return <PageGuard pageKey="pipeline">
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--card-border)] bg-[linear-gradient(115deg,var(--card-bg),var(--primary-subtle))] px-5 py-4 shadow-sm">
        <span><h1 className="text-2xl font-bold tracking-tight">Pipeline</h1><p className="text-sm text-[var(--muted)] mt-1">Live opportunities synced with GoHighLevel</p></span>
        {config && pipeline && <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              aria-label="Change pipeline"
              aria-expanded={pipelineMenuOpen}
              aria-haspopup="menu"
              onClick={() => setPipelineMenuOpen(open => !open)}
              className="group inline-flex max-w-56 items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--card-hover)]"
              title="Change pipeline"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-[var(--primary-subtle)] text-[var(--primary)]"><GitBranch size={13} /></span>
              <span className="truncate">{pipeline.name}</span>
              <ChevronsUpDown size={14} className="shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--foreground)]" />
            </button>
            {pipelineMenuOpen && <div role="menu" aria-label="Choose pipeline" className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1 shadow-xl">
              {config.pipelines.map(item => <button key={item.id} role="menuitem" onClick={() => selectPipeline(item.id)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--card-hover)]">
                <GitBranch size={14} className="shrink-0 text-[var(--muted)]" />
                <span className="flex-1 truncate">{item.name}</span>
                {item.id === pipelineId && <Check size={15} className="text-[var(--primary)]" />}
              </button>)}
            </div>}
          </div>
          <button onClick={() => pipeline.stages.forEach(stage => void loadColumn(pipeline.id, stage.id, false, true))} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--card-border)] text-sm"><RefreshCw size={15} /> Refresh</button>
        </div>}
      </header>
      {config && pipeline && <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5"><CircleDot size={13} className="text-[var(--primary)]" /><strong className="text-[var(--foreground)]">{pipelineItems.length}</strong> opportunities</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5"><strong className="text-[var(--foreground)]">${pipelineValue.toLocaleString()}</strong> pipeline value</span>
          <span className="hidden items-center gap-1.5 text-[11px] sm:inline-flex"><GripVertical size={13} /> Drag a card to move it between stages</span>
        </div>
        <div ref={boardScrollbarRef} aria-label="Scroll pipeline horizontally" className="h-3 overflow-x-auto overflow-y-hidden" onScroll={event => { if (boardRef.current) boardRef.current.scrollLeft = event.currentTarget.scrollLeft; }}><div className="h-px" style={{ width: `${Math.max(pipeline.stages.length * 342 - 16, 1)}px` }} /></div>
      </div>}
      {error && <div role="alert" className="flex gap-2 rounded-lg border border-[var(--error)] bg-[var(--error-subtle)] p-3 text-sm"><AlertCircle size={18} />{error}</div>}
      {!config && !error && <div className="min-h-64 grid place-items-center"><Loader2 className="animate-spin" /></div>}
      {config && pipeline && <div ref={boardRef} className="flex gap-4 overflow-x-auto pb-5 pt-1" aria-label="Opportunity Kanban board" onScroll={event => { if (boardScrollbarRef.current) boardScrollbarRef.current.scrollLeft = event.currentTarget.scrollLeft; }} onPointerMove={event => handleEdgeScroll(event.clientX, event.clientY)} onPointerLeave={stopEdgeScroll} onDragOver={event => { event.preventDefault(); handleEdgeScroll(event.clientX, event.clientY); }} onDragLeave={event => { if (event.currentTarget === event.target) stopEdgeScroll(); }}>
        {pipeline.stages.map((stage, index) => <PipelineColumn key={stage.id} stage={stage} index={index} state={columns[stage.id]} users={config.users} stages={pipeline.stages} locationId={config.locationId} mutation={mutation} dragging={dragging} isDropTarget={dropStage === stage.id} onDragState={id => { setDragging(id); if (!id) setDropStage(null); }} onDropTarget={setDropStage} onLoadMore={() => loadColumn(pipeline.id, stage.id, true)} onOpen={setSelected} onMove={move} />)}
      </div>}
      {selected && config && pipeline && <OpportunityDrawer id={selected} pipelineId={pipeline.id} locationId={config.locationId} stages={pipeline.stages} users={config.users} onClose={() => setSelected(null)} onSaved={() => { pipeline.stages.forEach(stage => void loadColumn(pipeline.id, stage.id)); }} />}
    </div>
  </PageGuard>;
}

const STAGE_ACCENTS = ['#60a5fa', '#a78bfa', '#f59e0b', '#f472b6', '#34d399', '#22d3ee'];

function PipelineColumn({ stage, index, state, stages, users, locationId, mutation, dragging, isDropTarget, onDragState, onDropTarget, onLoadMore, onOpen, onMove }: {
  stage: PipelineStage; index: number; state?: ColumnState; stages: PipelineStage[]; users: GhlUser[]; locationId: string; mutation: string | null; dragging: string | null; isDropTarget: boolean;
  onDragState: (id: string | null) => void; onDropTarget: (id: string | null) => void; onLoadMore: () => void; onOpen: (id: string) => void; onMove: (card: OpportunitySummary, stageId: string) => void;
}) {
  const total = state?.items.reduce((sum, item) => sum + item.monetaryValue, 0) || 0;
  const accent = STAGE_ACCENTS[index % STAGE_ACCENTS.length];
  return <section className={`w-[326px] shrink-0 snap-start overflow-hidden rounded-2xl border bg-[var(--card-hover)] transition-all duration-200 ${isDropTarget ? 'border-[var(--primary)] bg-[var(--primary-subtle)] shadow-[0_0_0_3px_var(--primary-subtle)]' : 'border-[var(--card-border)] shadow-sm'}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDragEnter={e => { e.preventDefault(); if (dragging) onDropTarget(stage.id); }} onDragLeave={e => { if (e.currentTarget === e.target) onDropTarget(null); }} onDrop={e => {
    const raw = e.dataTransfer.getData('application/json');
    onDropTarget(null); onDragState(null); if (raw) onMove(JSON.parse(raw), stage.id);
  }}>
    <header className="border-b border-[var(--card-border)] px-3.5 py-3"><span className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full ring-4 ring-[var(--card-bg)]" style={{ backgroundColor: accent }} /><strong className="truncate text-sm tracking-tight">{stage.name}</strong><span className="grid size-5 shrink-0 place-items-center rounded-md bg-[var(--card-bg)] text-[11px] font-semibold text-[var(--muted)]">{state?.items.length || 0}</span></span><span className="rounded-md bg-[var(--card-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--muted)]">${total.toLocaleString()}</span></span></header>
    <div className="min-h-44 space-y-2.5 p-2.5">
      {state?.loading && !state.loaded && <div className="py-10 grid place-items-center"><Loader2 className="animate-spin" size={20} /></div>}
      {state?.error && <div className="p-3 text-xs text-[var(--error)]">{state.error}<button onClick={onLoadMore} className="block underline mt-1">Retry</button></div>}
      {isDropTarget && <div className="grid min-h-24 place-items-center rounded-xl border border-dashed border-[var(--primary)] bg-[var(--card-bg)]/45 text-xs font-medium text-[var(--primary)] animate-in fade-in zoom-in-95 duration-150">Drop opportunity here</div>}
      {state?.loaded && !state.items.length && !isDropTarget && <p className="rounded-xl border border-dashed border-[var(--card-border)] py-10 text-center text-xs text-[var(--muted)]">No opportunities yet</p>}
      {state?.items.map((card, cardIndex) => <OpportunityCard key={card.id} card={card} index={cardIndex} stages={stages} users={users} locationId={locationId} busy={mutation === card.id} isDragging={dragging === card.id} onDragState={onDragState} onOpen={() => onOpen(card.id)} onMove={stageId => onMove(card, stageId)} />)}
      {state?.cursor && <button disabled={state.loading} onClick={onLoadMore} className="w-full py-2 text-xs rounded-lg border border-[var(--card-border)]">{state.loading ? 'Loading…' : 'Load more'}</button>}
    </div>
  </section>;
}

function OpportunityCard({ card, index, stages, users, locationId, busy, isDragging, onDragState, onOpen, onMove }: { card: OpportunitySummary; index: number; stages: PipelineStage[]; users: GhlUser[]; locationId: string; busy: boolean; isDragging: boolean; onDragState: (id: string | null) => void; onOpen: () => void; onMove: (stageId: string) => void }) {
  const assignee = users.find(user => user.id === card.assignedTo)?.name;
  const initials = (card.contactName || card.name).split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const createdDate = card.createdAt ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(card.createdAt)) : null;
  return <article draggable={!busy} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/json', JSON.stringify(card)); onDragState(card.id); }} onDragEnd={() => onDragState(null)} style={{ animationDelay: `${index * 35}ms` }} className={`group relative overflow-hidden rounded-xl border bg-[var(--card-bg)] p-3.5 shadow-sm transition-[transform,opacity,border-color,box-shadow] duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 ${isDragging ? 'scale-[0.97] border-[var(--primary)] opacity-35 shadow-none' : 'border-[var(--card-border)] hover:-translate-y-0.5 hover:border-[var(--muted)] hover:shadow-lg hover:shadow-black/15'} ${busy ? 'pointer-events-none opacity-60' : ''}`}>
    <span className="absolute inset-y-0 left-0 w-0.5 bg-[var(--primary)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
    <div className="flex items-start gap-1">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left"><span className="mb-2 flex items-center gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--primary-subtle)] text-[10px] font-bold text-[var(--primary)]">{initials || '?'}</span><span className="min-w-0"><strong className="block truncate text-sm leading-tight">{card.contactName || card.name}</strong>{card.companyName && <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--muted)]"><Building2 size={11} />{card.companyName}</span>}</span></span><span className="flex items-center justify-between gap-2"><span className="rounded-md bg-[var(--success-subtle)] px-1.5 py-1 text-xs font-semibold text-[var(--success)]">${card.monetaryValue.toLocaleString()}</span><span className="text-[11px] capitalize text-[var(--muted)]">{card.status}</span></span><span className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--muted)]"><span className="flex min-w-0 items-center gap-1 truncate"><UserRound size={12} />{assignee || 'Unassigned'}</span>{createdDate && <span className="flex shrink-0 items-center gap-1"><CalendarDays size={11} />{createdDate}</span>}</span></button>
      <span className="flex shrink-0 flex-col items-center gap-1"><GripVertical size={15} className="mt-1 text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-70" />{card.contactId && <a href={`https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(card.contactId)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${card.contactName || card.name} in GoHighLevel`} title="Open contact in GoHighLevel" className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--primary-subtle)] hover:text-[var(--primary)]"><ExternalLink size={14} /></a>}</span>
    </div>
    <span className="mt-3 flex items-center gap-2 border-t border-[var(--card-border)] pt-2.5 text-[var(--muted)]">{card.phone && <a href={`tel:${card.phone}`} onClick={event => event.stopPropagation()} className="flex min-w-0 items-center gap-1 text-[11px] hover:text-[var(--primary)] hover:underline" title={card.phone}><Phone size={12} className="shrink-0" /><span className="truncate">{card.phone}</span></a>}{card.email && <Mail size={12} className="shrink-0" />}{!card.phone && !card.email && <span className="text-[10px]">No phone or email</span>}<select aria-label={`Move ${card.name} to stage`} disabled={busy} value={card.stageId} onChange={e => onMove(e.target.value)} className="ml-auto max-w-36 border-0 bg-transparent py-0 pl-1 pr-5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] focus:shadow-none">{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></span>
  </article>;
}

function NoteCard({ note }: { note: OpportunityDetail['notes'][number] }) {
  return <article className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-3"><div className="prose prose-sm max-w-none break-words text-[var(--foreground)] prose-a:text-[var(--primary)] prose-a:underline prose-p:my-1 prose-ul:my-1 prose-ol:my-1" dangerouslySetInnerHTML={{ __html: sanitizeContactNoteHtml(note.body) }} />{note.createdAt && <p className="mt-1.5 text-[11px] text-[var(--muted)]">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(note.createdAt))}</p>}</article>;
}

function OpportunityDrawer({ id, pipelineId, locationId, stages, users, onClose, onSaved }: { id: string; pipelineId: string; locationId: string; stages: PipelineStage[]; users: GhlUser[]; onClose: () => void; onSaved: () => void }) {
  const [item, setItem] = useState<OpportunityDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [editingNumbers, setEditingNumbers] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState<Array<{ number: string; label: string }>>([]);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  useEffect(() => { dashboardApi<OpportunityDetail>(`/opportunities?id=${encodeURIComponent(id)}`).then(setItem).catch((e: DashboardApiError) => setError(e.message)); }, [id]);
  useEffect(() => { if (item) setPhoneNumbers(item.phoneNumbers); }, [item]);
  const draft = useMemo(() => item ? { stageId: item.stageId, status: item.status, monetaryValue: item.monetaryValue, assignedTo: item.assignedTo || '' } : null, [item]);
  const [edits, setEdits] = useState<Record<string, string | number>>({});
  const [contactEdits, setContactEdits] = useState<Record<string, string>>({});
  async function save() {
    if (!item || !draft) return;
    setSaving(true); setError('');
    try {
      let opportunity = item;
      if (Object.keys(edits).length) {
        opportunity = await dashboardApi<OpportunityDetail>(`/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify({ ...draft, ...edits, pipelineId, assignedTo: (edits.assignedTo ?? draft.assignedTo) || null }) });
      }
      if (item.contactId && Object.keys(contactEdits).length) {
        await dashboardApi(`/contacts/${item.contactId}`, { method: 'PATCH', body: JSON.stringify(contactPatch) });
        opportunity = await dashboardApi<OpportunityDetail>(`/opportunities?id=${encodeURIComponent(id)}`);
      }
      setItem(opportunity); setEdits({}); setContactEdits({}); onSaved();
    } catch (e) { setError((e as DashboardApiError).message); }
    finally { setSaving(false); }
  }
  const value = (key: string) => edits[key] ?? (draft as any)?.[key] ?? '';
  const copyPhone = async (phone: string) => {
    await navigator.clipboard.writeText(phone);
    setCopiedPhone(phone);
    window.setTimeout(() => setCopiedPhone(current => current === phone ? null : current), 1_500);
  };
  const updatePhone = (index: number, number: string) => setPhoneNumbers(current => current.map((phone, i) => i === index ? { ...phone, number } : phone));
  const savePhoneNumbers = () => {
    const nonEmpty = phoneNumbers.filter(phone => phone.number.trim());
    const [primary, ...additional] = nonEmpty;
    setContactEdits(current => ({ ...current, phone: primary?.number.trim() || '', additionalPhones: JSON.stringify(additional.map(phone => ({ phone: phone.number.trim(), label: phone.label }))) }));
    setEditingNumbers(false);
  };
  const contactPatch = Object.fromEntries(Object.entries(contactEdits).map(([key, value]) => [key, key === 'additionalPhones' ? JSON.parse(value) : value]));
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="h-full w-full max-w-md bg-[var(--background)] border-l border-[var(--card-border)] p-6 overflow-y-auto" aria-label="Opportunity details">
      <header className="flex justify-between"><span><h2 className="text-xl font-semibold">Opportunity details</h2><p className="text-xs text-[var(--muted)] mt-1">Changes are confirmed by GHL before the board updates.</p></span><button onClick={onClose} aria-label="Close details"><X /></button></header>
      {!item && !error && <div className="py-20 grid place-items-center"><Loader2 className="animate-spin" /></div>}
      {error && <p className="mt-6 text-sm text-[var(--error)]">{error}</p>}
      {item && showAllNotes && <div className="mt-7 space-y-4">
        <button onClick={() => setShowAllNotes(false)} className="mx-auto flex items-center gap-1.5 text-base font-semibold hover:text-[var(--primary)]"><ArrowLeft size={16} /> Notes</button>
        {item.notes.length ? item.notes.map(note => <NoteCard key={note.id || note.body} note={note} />) : <p className="rounded-lg border border-dashed border-[var(--card-border)] p-3 text-sm text-[var(--muted)]">No notes for this contact.</p>}
      </div>}
      {item && !showAllNotes && <div className="mt-7 space-y-4">
        <div className="flex items-start justify-between gap-3"><span><strong>{item.contactName || item.name}</strong><p className="text-sm text-[var(--muted)]">{item.companyName || 'No company'}</p></span>{item.contactId && <a href={`https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(item.contactId)}`} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--primary-subtle)] hover:text-[var(--primary)]"><ExternalLink size={13} /> Open in GHL</a>}</div>
        {item.contactId && <div className="space-y-3">
          <div>
            <span className="flex items-center justify-between text-sm font-medium">Contact numbers <button onClick={() => { setPhoneNumbers(item.phoneNumbers); setEditingNumbers(value => !value); }} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]" aria-label="Edit contact numbers" title="Edit contact numbers"><Pencil size={14} /></button></span>
            <div className="mt-1.5 space-y-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
              {editingNumbers ? phoneNumbers.map((phone, index) => <div key={`${phone.label}-${index}`} className="flex items-center gap-2"><span className="w-20 shrink-0 text-[10px] text-[var(--muted)]">{phone.label}</span><input value={phone.number} onChange={event => updatePhone(index, event.target.value)} className="min-w-0 flex-1 rounded border border-[var(--card-border)] bg-transparent py-1.5 px-2 text-sm" /></div>) : item.phoneNumbers.length ? item.phoneNumbers.map(phone => <div key={`${phone.label}-${phone.number}`} className="flex items-center justify-between gap-3 text-sm"><a href={`tel:${phone.number}`} className="flex min-w-0 items-center gap-2 hover:text-[var(--primary)]"><Phone size={14} className="shrink-0 text-[var(--muted)]" /><span className="truncate">{phone.number}</span></a><span className="ml-auto shrink-0 rounded bg-[var(--card-hover)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{phone.label}</span><button onClick={() => void copyPhone(phone.number)} className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--primary)]" title={copiedPhone === phone.number ? 'Copied' : 'Copy phone number'} aria-label={copiedPhone === phone.number ? `${phone.label} phone number copied` : `Copy ${phone.label} phone number`}>{copiedPhone === phone.number ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}</button></div>) : <span className="text-sm text-[var(--muted)]">No phone numbers</span>}
              {editingNumbers && <div className="flex justify-end gap-2 pt-1"><button onClick={() => { setPhoneNumbers(item.phoneNumbers); setEditingNumbers(false); }} className="text-xs text-[var(--muted)]">Cancel</button><button onClick={savePhoneNumbers} className="text-xs font-medium text-[var(--primary)]">Apply</button></div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Primary phone<input className={`${control} mt-1`} value={contactEdits.phone ?? item.phone ?? ''} onChange={e => setContactEdits(v => ({ ...v, phone: e.target.value }))} /></label>
          <label className="block text-sm">Email<input className={`${control} mt-1`} type="email" value={contactEdits.email ?? item.email ?? ''} onChange={e => setContactEdits(v => ({ ...v, email: e.target.value }))} /></label>
          <label className="block text-sm col-span-2">Company<input className={`${control} mt-1`} value={contactEdits.companyName ?? item.companyName ?? ''} onChange={e => setContactEdits(v => ({ ...v, companyName: e.target.value }))} /></label>
          </div>
          <div>
            <span className="flex items-center justify-between gap-1.5 text-sm font-medium"><span className="flex items-center gap-1.5"><MessageSquareText size={14} /> Notes</span><button onClick={() => setShowAllNotes(true)} className="text-xs font-medium text-[var(--primary)] hover:underline">All notes</button></span>
            <div className="mt-1.5 space-y-2">
              {item.notes.length ? <NoteCard note={item.notes[0]} /> : <p className="rounded-lg border border-dashed border-[var(--card-border)] p-3 text-sm text-[var(--muted)]">No notes for this contact.</p>}
            </div>
          </div>
        </div>}
        <label className="block text-sm">Stage<select className={`${control} mt-1`} value={value('stageId')} onChange={e => setEdits(v => ({ ...v, stageId: e.target.value }))}>{stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-sm">Status<select className={`${control} mt-1`} value={value('status')} onChange={e => setEdits(v => ({ ...v, status: e.target.value }))}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option><option value="abandoned">Abandoned</option></select></label>
        <label className="block text-sm">Value<input className={`${control} mt-1`} type="number" min="0" value={value('monetaryValue')} onChange={e => setEdits(v => ({ ...v, monetaryValue: Number(e.target.value) }))} /></label>
        <label className="block text-sm">Assignee<select className={`${control} mt-1`} value={value('assignedTo')} onChange={e => setEdits(v => ({ ...v, assignedTo: e.target.value }))}><option value="">Unassigned</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <button disabled={saving || (!Object.keys(edits).length && !Object.keys(contactEdits).length)} onClick={save} className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
      </div>}
    </aside>
  </div>;
}
