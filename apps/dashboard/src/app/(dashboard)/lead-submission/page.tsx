'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Send, TriangleAlert } from 'lucide-react';
import { PageGuard } from '@/components/page-guard';
import { dashboardApi, DashboardApiError } from '@/lib/ghl-dashboard-client';
import type { LeadFormConfig, LeadSubmissionResult } from '@/server/ghl-dashboard/models';
import { getGhlPreferences, saveGhlPreferences } from '@/lib/ghl-preferences';
import { useAuth } from '@/contexts/auth-context';

const inputClass = 'w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15';
const errorClass = 'border-[var(--error)] focus:border-[var(--error)] focus:ring-[var(--error)]/15';
const industries = ['Pressure Washing', 'Landscaping', 'Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Painting', 'Window Cleaning', 'House Cleaning', 'Pest Control', 'Junk Removal', 'Pool Service', 'Other'];
const statusDescriptions: Record<string, string> = {
  'Meeting Booked': 'A meeting has been scheduled, but more questions still need to be discussed and answered.',
  'Closed and Onboarding Scheduled': 'The lead has a 5/5 interest level, only needs a little more warming up, and is expected to be onboarded during the next call.',
  'Follow-up': 'There was limited time to speak properly, and another conversation is required.',
};

type FormValues = {
  businessName: string; ownerName: string; phone: string; industry: string; otherIndustry: string;
  googleReviews: string; starRating: string; yearsInBusiness: string; jobsPerMonth: string; reviewSource: string;
  crmSoftware: string; collectsPhoneNumbers: string; pastCustomers: string; teamSize: string;
  businessGoal: string; biggestChallenge: string; interestLevel: string; status: string; meetingDateTime: string; extraNotes: string;
  pipelineId: string; stageId: string; submissionTag: string;
};

const emptyForm: FormValues = {
  businessName: '', ownerName: '', phone: '', industry: '', otherIndustry: '', googleReviews: '', starRating: '', yearsInBusiness: '', jobsPerMonth: '', reviewSource: '', crmSoftware: '', collectsPhoneNumbers: '', pastCustomers: '', teamSize: '', businessGoal: '', biggestChallenge: '', interestLevel: '', status: '', meetingDateTime: '', extraNotes: '', pipelineId: '', stageId: '', submissionTag: '',
};

export default function LeadSubmissionPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<LeadFormConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LeadSubmissionResult | null>(null);
  const [error, setError] = useState<DashboardApiError | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormValues>(emptyForm);
  const idempotencyKey = useRef('');

  useEffect(() => {
    dashboardApi<LeadFormConfig>('/config').then(value => {
      setConfig(value);
      const saved = getGhlPreferences(user?.id || 'anonymous');
      const pipeline = value.pipelines.find(item => item.id === saved.pipelineId) || value.pipelines[0];
      const stage = pipeline?.stages.find(item => item.id === saved.stageId) || pipeline?.stages[0];
      const submissionTag = value.tags.some(tag => tag.name === saved.submissionTag) ? saved.submissionTag || '' : '';
      setForm(current => ({ ...current, pipelineId: pipeline?.id || '', stageId: stage?.id || '', submissionTag }));
    }).catch((e: DashboardApiError) => setConfigError(e.message));
  }, [user?.id]);

  const update = (key: keyof FormValues, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const fieldClass = (key: keyof FormValues) => `${inputClass}${errors[key] ? ` ${errorClass}` : ''}`;
  const requiresMeeting = form.status === 'Meeting Booked' || form.status === 'Closed and Onboarding Scheduled';

  function validate() {
    const next: Record<string, string> = {};
    if (!form.businessName.trim()) next.businessName = 'Business name is required.';
    if (!form.ownerName.trim()) next.ownerName = 'Owner name is required.';
    const digits = form.phone.replace(/\D/g, '');
    if (!form.phone.trim()) next.phone = 'Phone number is required.';
    else if (digits.length < 7 || digits.length > 15) next.phone = 'Enter a valid phone number.';
    if (!form.industry) next.industry = 'Please select an industry.';
    if (form.industry === 'Other' && !form.otherIndustry.trim()) next.otherIndustry = 'Please enter the industry.';
    for (const key of ['googleReviews', 'yearsInBusiness'] as const) if (form[key] !== '' && Number(form[key]) < 0) next[key] = 'Must be zero or greater.';
    if (form.starRating !== '' && (Number(form.starRating) < 0 || Number(form.starRating) > 5)) next.starRating = 'Enter a rating from 0 to 5.';
    if (!form.interestLevel) next.interestLevel = 'Please select an interest score.';
    if (!form.status) next.status = 'Please select a status.';
    if (requiresMeeting && !form.meetingDateTime) next.meetingDateTime = 'Meeting date and time are required for this status.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !validate() || !config) return;
    setSubmitting(true); setError(null); setResult(null);
    const [firstName, ...lastName] = form.ownerName.trim().split(/\s+/);
    const notes = [
      `Industry: ${form.industry === 'Other' ? form.otherIndustry : form.industry}`,
      `Google Reviews: ${form.googleReviews || 'Not provided'}`,
      `Star Rating: ${form.starRating || 'Not provided'}`,
      `Years in Business: ${form.yearsInBusiness || 'Not provided'}`,
      `Jobs per Month: ${form.jobsPerMonth || 'Not provided'}`,
      `Current Review Method: ${form.reviewSource || 'Not provided'}`,
      `CRM / Job Management Software: ${form.crmSoftware || 'Not provided'}`,
      `Collects Customer Phone Numbers: ${form.collectsPhoneNumbers || 'Not provided'}`,
      `Past Customers: ${form.pastCustomers || 'Not provided'}`,
      `Team Size: ${form.teamSize || 'Not provided'}`,
      `Business Goal: ${form.businessGoal || 'Not provided'}`,
      `Biggest Challenge: ${form.biggestChallenge || 'Not provided'}`,
      `Interest Level: ${form.interestLevel}/5`,
      `Status: ${form.status}`,
      `Meeting Date & Time: ${form.meetingDateTime || 'Not scheduled'}`,
      `Extra Notes: ${form.extraNotes || 'None'}`,
    ].join('\n');
    try {
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const response = await dashboardApi<LeadSubmissionResult>('/leads', { method: 'POST', body: JSON.stringify({ firstName, lastName: lastName.join(' '), companyName: form.businessName, phone: form.phone, notes, pipelineId: form.pipelineId, stageId: form.stageId, submissionTag: form.submissionTag, idempotencyKey: idempotencyKey.current }) });
      setResult(response); idempotencyKey.current = '';
      if (response.status === 'succeeded') setForm(current => ({ ...emptyForm, pipelineId: current.pipelineId, stageId: current.stageId, submissionTag: current.submissionTag }));
    } catch (e) { setError(e as DashboardApiError); }
    finally { setSubmitting(false); }
  }

  return <PageGuard pageKey="lead-submission">
    <div className="max-w-4xl mx-auto space-y-6">
      <header><h1 className="text-2xl font-bold tracking-tight">Lead Submission</h1><p className="text-sm text-[var(--muted)] mt-1">Capture business details and qualify your next opportunity.</p></header>
      {configError && <StateBanner icon={AlertCircle} tone="error" title="GHL setup required" text={configError} />}
      {!config && !configError && <div className="min-h-64 grid place-items-center"><Loader2 className="animate-spin text-[var(--muted)]" /></div>}
      {config && <form noValidate onSubmit={submit} className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 md:p-7 space-y-8">
        <p className="text-xs text-[var(--muted)]"><span className="text-[var(--error)]">*</span> Required fields. All other fields are optional.</p>
        <FormSection number="1" title="Business Information"><div className="grid md:grid-cols-2 gap-5">
          <Field label="Business Name" required error={errors.businessName}><input className={fieldClass('businessName')} value={form.businessName} onChange={e => update('businessName', e.target.value)} /></Field>
          <Field label="Owner Name" required error={errors.ownerName}><input className={fieldClass('ownerName')} value={form.ownerName} onChange={e => update('ownerName', e.target.value)} /></Field>
          <Field label="Phone Number" required error={errors.phone}><input className={`${fieldClass('phone')}${!form.phone.trim() ? ' phone-field-empty' : ''}`} type="tel" inputMode="tel" value={form.phone} onChange={e => update('phone', e.target.value)} /></Field>
          <Field label="Industry" required error={errors.industry}><select className={fieldClass('industry')} value={form.industry} onChange={e => update('industry', e.target.value)}><option value="">Select an industry</option>{industries.map(item => <option key={item}>{item}</option>)}</select></Field>
          {form.industry === 'Other' && <Field label="Please enter your industry" required error={errors.otherIndustry}><input className={fieldClass('otherIndustry')} value={form.otherIndustry} onChange={e => update('otherIndustry', e.target.value)} /></Field>}
        </div></FormSection>
        <FormSection number="2" title="Business Performance"><div className="grid md:grid-cols-2 gap-5">
          <Field label="Number of Google Reviews" error={errors.googleReviews}><input className={fieldClass('googleReviews')} type="number" min="0" value={form.googleReviews} onChange={e => update('googleReviews', e.target.value)} /></Field>
          <Field label="Star Rating" error={errors.starRating}><input className={fieldClass('starRating')} type="number" min="0" max="5" step="0.1" value={form.starRating} onChange={e => update('starRating', e.target.value)} /></Field>
          <Field label="Years in Business" error={errors.yearsInBusiness}><input className={fieldClass('yearsInBusiness')} type="number" min="0" value={form.yearsInBusiness} onChange={e => update('yearsInBusiness', e.target.value)} /></Field>
          <Field label="How many jobs do you do per month?"><ChoiceSelect value={form.jobsPerMonth} onChange={value => update('jobsPerMonth', value)} options={['Under 20', '20–50', '50–100', '100+']} /></Field>
          <Field label="How do you currently get reviews?" className="md:col-span-2"><textarea rows={4} className={fieldClass('reviewSource')} value={form.reviewSource} onChange={e => update('reviewSource', e.target.value)} /></Field>
          <Field label="CRM / Job Management Software" hint="Enter the name of the software or write ‘No system’." className="md:col-span-2"><input className={fieldClass('crmSoftware')} value={form.crmSoftware} onChange={e => update('crmSoftware', e.target.value)} /></Field>
          <Field label="Do you collect customers’ phone numbers?"><ChoiceSelect value={form.collectsPhoneNumbers} onChange={value => update('collectsPhoneNumbers', value)} options={['Always', 'Sometimes', 'Rarely', 'No']} /></Field>
          <Field label="Approximately how many past customers do you have?"><ChoiceSelect value={form.pastCustomers} onChange={value => update('pastCustomers', value)} options={['Under 100', '100–500', '500–1000', '1000+']} /></Field>
          <Field label="Team Size"><ChoiceSelect value={form.teamSize} onChange={value => update('teamSize', value)} options={['Just me', '2–5', '6–10', '10+']} /></Field>
        </div></FormSection>
        <FormSection number="3" title="Goals and Challenges"><div className="grid gap-5">
          <Field label="Biggest business goal this year" hint="For example: hiring a good technician, improving management, or scaling the business."><textarea rows={4} className={fieldClass('businessGoal')} placeholder="For example: hiring a good technician, improving management, or scaling the business." value={form.businessGoal} onChange={e => update('businessGoal', e.target.value)} /></Field>
          <Field label="Biggest challenge" hint="For example: inconsistent jobs, low-quality prospects, or lower-ticket jobs."><textarea rows={4} className={fieldClass('biggestChallenge')} placeholder="For example: inconsistent jobs, low-quality prospects, or lower-ticket jobs." value={form.biggestChallenge} onChange={e => update('biggestChallenge', e.target.value)} /></Field>
        </div></FormSection>
        <FormSection number="4" title="Lead Qualification"><div className="grid md:grid-cols-2 gap-5">
          <Field label="How interested are they out of 5?" required error={errors.interestLevel}><select className={fieldClass('interestLevel')} value={form.interestLevel} onChange={e => update('interestLevel', e.target.value)}><option value="">Select interest score</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select>{form.interestLevel && <p className="mt-1.5 text-xs text-[var(--muted)]">Interest score: <strong>{form.interestLevel}/5</strong></p>}</Field>
          <Field label="Status" required error={errors.status}><select className={fieldClass('status')} value={form.status} onChange={e => update('status', e.target.value)}><option value="">Select a status</option>{Object.keys(statusDescriptions).map(value => <option key={value}>{value}</option>)}</select>{form.status && <p className="mt-1.5 text-xs text-[var(--muted)]">{statusDescriptions[form.status]}</p>}</Field>
          <Field label="Meeting Date & Time" required={requiresMeeting} hint={requiresMeeting ? 'Required for the selected status.' : 'Optional'} error={errors.meetingDateTime}><input className={fieldClass('meetingDateTime')} type="datetime-local" value={form.meetingDateTime} onChange={e => update('meetingDateTime', e.target.value)} /></Field>
          <Field label="Extra Notes" hint="Optional" className="md:col-span-2"><textarea rows={4} className={fieldClass('extraNotes')} value={form.extraNotes} onChange={e => update('extraNotes', e.target.value)} /></Field>
        </div></FormSection>
        {error && <StateBanner icon={AlertCircle} tone="error" title={error.code === 'validation_failed' ? 'Check the form' : 'Submission failed'} text={[error.message, error.retryAfter ? `Retry in about ${error.retryAfter} seconds.` : '', error.fields ? Object.values(error.fields).join(' · ') : ''].filter(Boolean).join(' ')} />}
        {result?.status === 'duplicate' && <StateBanner icon={TriangleAlert} tone="warning" title="Existing opportunity found" text="The contact was matched, but no second opportunity was created." />}
        {result?.status === 'succeeded' && <StateBanner icon={CheckCircle2} tone="success" title="Lead submitted" text={result.warnings?.join(' ') || 'The lead has been saved successfully.'} />}
        <button disabled={submitting || !config.currentUser.matched || !form.pipelineId || !form.stageId} className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{submitting ? 'Submitting…' : 'Submit Lead'}</button>
      </form>}
    </div>
  </PageGuard>;
}

function FormSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) { return <section className="space-y-5"><div className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-full bg-[var(--primary)] text-xs font-bold text-white">{number}</span><h2 className="text-lg font-semibold">{title}</h2></div>{children}</section>; }
function Field({ label, hint, required, error, className, children }: { label: string; hint?: string; required?: boolean; error?: string; className?: string; children: React.ReactNode }) { return <label className={`block ${className || ''}`}><span className="text-sm font-medium">{label}{required && <span className="ml-1 text-[var(--error)]">*</span>}</span>{hint && <span className="block mt-1 text-xs text-[var(--muted)]">{hint}</span>}<span className="block mt-1.5">{children}</span>{error && <span role="alert" className="block mt-1.5 text-xs text-[var(--error)]">{error}</span>}</label>; }
function ChoiceSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) { return <select className={inputClass} value={value} onChange={e => onChange(e.target.value)}><option value="">Select an option</option>{options.map(option => <option key={option}>{option}</option>)}</select>; }
function StateBanner({ icon: Icon, tone, title, text }: { icon: typeof AlertCircle; tone: 'error' | 'warning' | 'success'; title: string; text: string }) { const colors = tone === 'error' ? 'border-[var(--error)] bg-[var(--error-subtle)]' : tone === 'warning' ? 'border-[var(--warning)] bg-[var(--warning-subtle)]' : 'border-[var(--success)] bg-[var(--success-subtle)]'; return <div role="status" className={`flex gap-3 rounded-lg border p-3 ${colors}`}><Icon size={18} className="shrink-0 mt-0.5" /><span><strong className="text-sm">{title}</strong><span className="block text-xs mt-0.5">{text}</span></span></div>; }
