'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { PageGuard } from '@/components/page-guard';
import { dashboardApi, DashboardApiError } from '@/lib/ghl-dashboard-client';
import type { LeadFormConfig, MetricValue, TeamOverviewResponse } from '@/server/ghl-dashboard/models';
import { useAuth } from '@/contexts/auth-context';
import { getGhlPreferences, saveGhlPreferences } from '@/lib/ghl-preferences';

type Range = 7 | 30 | 90 | 'custom';
const dateInput = 'rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm';

function isoDay(date: Date, end = false) {
  const next = new Date(date);
  next.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return next.toISOString();
}

export default function TeamOverviewPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<LeadFormConfig | null>(null);
  const [pipelineId, setPipelineId] = useState('');
  const [range, setRange] = useState<Range>(30);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<TeamOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardApi<LeadFormConfig>('/config').then(value => {
      setConfig(value);
      const saved = getGhlPreferences(user?.id || 'anonymous');
      setPipelineId(value.pipelines.some(item => item.id === saved.pipelineId) ? saved.pipelineId || '' : value.pipelines[0]?.id || '');
    }).catch((e: DashboardApiError) => { setError(e.message); setLoading(false); });
  }, [user?.id]);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    let from: Date; let to: Date;
    if (range === 'custom') {
      if (!customFrom || !customTo) return;
      from = new Date(`${customFrom}T00:00:00`); to = new Date(`${customTo}T23:59:59`);
    } else {
      to = new Date(); from = new Date(); from.setDate(from.getDate() - range);
    }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ pipelineId, from: isoDay(from), to: isoDay(to, true) });
      setData(await dashboardApi<TeamOverviewResponse>(`/team-overview?${params}`));
    } catch (e) { setError((e as DashboardApiError).message); setData(null); }
    finally { setLoading(false); }
  }, [range, customFrom, customTo, pipelineId]);

  useEffect(() => { void load(); }, [load]);

  const cards: Array<[string, MetricValue<number> | undefined, 'number' | 'money' | 'days']> = [
    ['Submissions', data?.submissions, 'number'],
    ['Opportunities created', data?.createdOpportunities, 'number'],
    ['Submitted value', data?.submittedValue, 'money'],
    ['Current active', data?.activeOpportunities, 'number'],
    ['Won', data?.won, 'number'], ['Lost', data?.lost, 'number'],
    ['Stale open', data?.stale, 'number'], ['Unassigned', data?.unassigned, 'number'],
    ['Missing phone/email', data?.missingContactInfo, 'number'],
    ['Average current stage age', data?.averageCurrentStageAgeDays, 'days'],
  ];

  return <PageGuard pageKey="team">
    <div className="space-y-6">
      <header className="flex flex-wrap justify-between gap-4">
        <span><h1 className="text-2xl font-bold tracking-tight">Team Overview</h1><p className="text-sm text-[var(--muted)] mt-1">Local submission attribution combined with fully paginated live GHL pipeline health.</p></span>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--card-border)] px-3 py-2 text-sm"><RefreshCw size={15} />Refresh</button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        {config && <select aria-label="Pipeline" className={dateInput} value={pipelineId} onChange={e => {
          setPipelineId(e.target.value);
          if (user?.id) saveGhlPreferences(user.id, { pipelineId: e.target.value });
        }}>{config.pipelines.map(pipeline => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</select>}
        {[7, 30, 90].map(days => <button key={days} onClick={() => setRange(days as Range)} className={`rounded-lg px-3 py-2 text-sm border ${range === days ? 'border-[var(--primary)] bg-[var(--primary-subtle)]' : 'border-[var(--card-border)]'}`}>{days} days</button>)}
        <button onClick={() => setRange('custom')} className={`rounded-lg px-3 py-2 text-sm border ${range === 'custom' ? 'border-[var(--primary)] bg-[var(--primary-subtle)]' : 'border-[var(--card-border)]'}`}>Custom</button>
        {range === 'custom' && <><input aria-label="From date" type="date" className={dateInput} value={customFrom} onChange={e => setCustomFrom(e.target.value)} /><input aria-label="To date" type="date" className={dateInput} value={customTo} onChange={e => setCustomTo(e.target.value)} /></>}
      </div>
      {loading && <div className="min-h-56 grid place-items-center"><Loader2 className="animate-spin" /></div>}
      {error && <div className="flex gap-2 rounded-lg border border-[var(--error)] bg-[var(--error-subtle)] p-3 text-sm"><AlertCircle size={18} />{error}. Totals are unavailable; no partial values are shown.</div>}
      {data && !loading && <>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{cards.map(([label, metric, format]) => metric && <MetricCard key={label} label={label} metric={metric} format={format} />)}</div>
        <div className="grid lg:grid-cols-2 gap-5">
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden"><h2 className="font-semibold p-4 border-b border-[var(--card-border)]">Current opportunities by stage</h2><div className="divide-y divide-[var(--card-border)]">{data.byStage.map(row => <div key={row.stageId} className="flex justify-between p-4 text-sm"><span>{row.stageName}</span><span className="text-right"><strong>{row.count}</strong><span className="block text-xs text-[var(--muted)]">${row.value.toLocaleString()}</span></span></div>)}</div></section>
          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden"><h2 className="font-semibold p-4 border-b border-[var(--card-border)]">Submissions by application user</h2><div className="divide-y divide-[var(--card-border)]">{data.bySubmitter.map(row => <div key={row.userId} className="flex justify-between p-4 text-sm"><span>{row.userName || row.userId}</span><span className="text-right"><strong>{row.count}</strong><span className="block text-xs text-[var(--muted)]">${row.value.toLocaleString()}</span></span></div>)}</div></section>
        </div>
        <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5"><h2 className="font-semibold">Historical funnel metrics</h2><Unavailable metric={data.historicalAverageTimeInStage} label="Historical average time in stage" /><Unavailable metric={data.stageConversionRates} label="Stage conversion rates" /></section>
      </>}
    </div>
  </PageGuard>;
}

function MetricCard({ label, metric, format }: { label: string; metric: MetricValue<number>; format: 'number' | 'money' | 'days' }) {
  const displayed = metric.value == null ? '—' : format === 'money' ? `$${metric.value.toLocaleString()}` : format === 'days' ? `${metric.value.toFixed(1)}d` : metric.value.toLocaleString();
  return <article className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4"><p className="text-xs text-[var(--muted)]">{label}</p><p className="text-xl font-semibold mt-1">{displayed}</p><p className="mt-2 text-[10px] uppercase text-[var(--muted)]">{metric.source}{metric.complete ? '' : ' · unavailable'}</p></article>;
}

function Unavailable({ metric, label }: { metric: MetricValue<unknown>; label: string }) {
  return <div className="mt-4 rounded-lg bg-[var(--card-hover)] p-3"><p className="text-sm font-medium">{label}: unavailable</p><p className="text-xs text-[var(--muted)] mt-1">{metric.unavailableReason}</p><span className="text-[10px] uppercase text-[var(--muted)]">Source: {metric.source}</span></div>;
}
