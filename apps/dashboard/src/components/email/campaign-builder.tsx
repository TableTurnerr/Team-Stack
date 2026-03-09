'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, ChevronLeft, Check, Send, RefreshCw, Mail, Type, Users, Eye, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { EMAIL_COLLECTIONS, type EmailTemplate, type EmailList, type ABWinnerMetric } from '@/lib/email-types';
import { AudiencePicker } from './audience-picker';
import { SchedulePicker } from './schedule-picker';
import { ABTestSetup } from './ab-test-setup';
import Link from 'next/link';

interface CampaignBuilderProps {
  campaignId?: string;
  className?: string;
}

type Step = 'details' | 'template' | 'audience' | 'review';

const STEPS: { key: Step; label: string; icon: typeof Mail }[] = [
  { key: 'details', label: 'Details', icon: Type },
  { key: 'template', label: 'Template', icon: FileText },
  { key: 'audience', label: 'Audience', icon: Users },
  { key: 'review', label: 'Review & Send', icon: Eye },
];

export function CampaignBuilder({ campaignId, className }: CampaignBuilderProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>('details');
  const [saving, setSaving] = useState(false);

  // Step 1: Details
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');

  // Step 2: Template
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Step 3: Audience
  const [audienceListId, setAudienceListId] = useState<string | null>(null);
  const [exclusionListId, setExclusionListId] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  // A/B Test
  const [abEnabled, setAbEnabled] = useState(false);
  const [abSubjectA, setAbSubjectA] = useState('');
  const [abSubjectB, setAbSubjectB] = useState('');
  const [abSplitPct, setAbSplitPct] = useState(10);
  const [abWinnerMetric, setAbWinnerMetric] = useState<ABWinnerMetric>('open_rate');

  // Load templates
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).getFullList({
          sort: '-created',
        });
        setTemplates(result as unknown as EmailTemplate[]);
      } catch (err) {
        console.error('Failed to fetch templates:', err);
      } finally {
        setLoadingTemplates(false);
      }
    };
    fetchTemplates();
  }, []);

  // Load existing campaign if editing
  useEffect(() => {
    if (!campaignId) return;
    const fetchCampaign = async () => {
      try {
        const campaign = await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).getOne(campaignId, {
          expand: 'template,audience_list,exclusion_list',
        });
        setName(campaign.name || '');
        setSubject(campaign.subject || '');
        setSelectedTemplateId(campaign.template || null);
        setAudienceListId(campaign.audience_list || null);
        setExclusionListId(campaign.exclusion_list || null);
        if (campaign.scheduled_at) {
          setScheduleMode('scheduled');
          setScheduledAt(campaign.scheduled_at);
        }
        if (campaign.campaign_type === 'ab_test') {
          setAbEnabled(true);
          setAbSplitPct(campaign.ab_split_pct || 10);
          setAbWinnerMetric(campaign.ab_winner_metric || 'open_rate');
        }
      } catch (err) {
        console.error('Failed to load campaign:', err);
      }
    };
    fetchCampaign();
  }, [campaignId]);

  const currentStepIndex = STEPS.findIndex(s => s.key === currentStep);

  const canProceed = () => {
    switch (currentStep) {
      case 'details': return name.trim().length > 0 && subject.trim().length > 0;
      case 'template': return !!selectedTemplateId;
      case 'audience': return !!audienceListId;
      case 'review': return true;
      default: return false;
    }
  };

  const goNext = () => {
    const idx = currentStepIndex;
    if (idx < STEPS.length - 1) {
      setCurrentStep(STEPS[idx + 1].key);
    }
  };

  const goPrev = () => {
    const idx = currentStepIndex;
    if (idx > 0) {
      setCurrentStep(STEPS[idx - 1].key);
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const data = {
        name,
        subject: abEnabled ? abSubjectA : subject,
        template: selectedTemplateId,
        audience_list: audienceListId,
        exclusion_list: exclusionListId || undefined,
        status: 'draft',
        campaign_type: abEnabled ? 'ab_test' : 'one_time',
        scheduled_at: scheduleMode === 'scheduled' ? scheduledAt : undefined,
        ab_split_pct: abEnabled ? abSplitPct : undefined,
        ab_winner_metric: abEnabled ? abWinnerMetric : undefined,
        created_by: pb.authStore.model?.id,
      };

      if (campaignId) {
        await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).update(campaignId, data);
      } else {
        const created = await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).create(data);
        router.push(`/email/campaigns/${created.id}`);
        return;
      }
    } catch (err) {
      console.error('Failed to save campaign:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleScheduleOrSend = async () => {
    setSaving(true);
    try {
      const status = scheduleMode === 'scheduled' ? 'scheduled' : 'sending';
      const data = {
        name,
        subject: abEnabled ? abSubjectA : subject,
        template: selectedTemplateId,
        audience_list: audienceListId,
        exclusion_list: exclusionListId || undefined,
        status,
        campaign_type: abEnabled ? 'ab_test' : 'one_time',
        scheduled_at: scheduleMode === 'scheduled' ? scheduledAt : undefined,
        ab_split_pct: abEnabled ? abSplitPct : undefined,
        ab_winner_metric: abEnabled ? abWinnerMetric : undefined,
        created_by: pb.authStore.model?.id,
      };

      let id = campaignId;
      if (campaignId) {
        await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).update(campaignId, data);
      } else {
        const created = await pb.collection(EMAIL_COLLECTIONS.EMAIL_CAMPAIGNS).create(data);
        id = created.id;
      }

      // If sending now, trigger the send API
      if (scheduleMode === 'now' && id) {
        try {
          await fetch('/api/email-send/campaign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaignId: id }),
          });
        } catch {
          // Campaign was created, send will be retried by cron
        }
      }

      router.push(`/email/campaigns/${id}`);
    } catch (err) {
      console.error('Failed to send/schedule campaign:', err);
    } finally {
      setSaving(false);
    }
  };

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, idx) => {
          const isActive = step.key === currentStep;
          const isCompleted = idx < currentStepIndex;
          const StepIcon = step.icon;

          return (
            <div key={step.key} className="flex items-center gap-2">
              {idx > 0 && (
                <div className={cn(
                  'w-8 h-px',
                  isCompleted || isActive ? 'bg-[var(--foreground)]' : 'bg-[var(--card-border)]'
                )} />
              )}
              <button
                onClick={() => {
                  // Only allow going back or to completed steps
                  if (idx <= currentStepIndex) setCurrentStep(step.key);
                }}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive && 'bg-[var(--foreground)] text-[var(--background)] font-medium',
                  isCompleted && !isActive && 'text-[var(--foreground)]',
                  !isActive && !isCompleted && 'text-[var(--muted)] cursor-default'
                )}
              >
                {isCompleted ? (
                  <Check size={16} className="text-[var(--success)]" />
                ) : (
                  <StepIcon size={16} />
                )}
                <span className="hidden sm:inline">{step.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
        {/* Step 1: Details */}
        {currentStep === 'details' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Campaign Details</h2>
              <p className="text-sm text-[var(--muted)] mt-1">Give your campaign a name and subject line</p>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">Campaign Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., March Newsletter"
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                autoFocus
              />
              <p className="text-xs text-[var(--muted)] mt-1">Internal name, not visible to recipients</p>
            </div>

            {!abEnabled && (
              <div>
                <label className="text-sm font-medium block mb-1.5">Subject Line</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., We'd love to help your restaurant grow"
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--card-border)] bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-[var(--foreground)]"
                />
                <p className="text-xs text-[var(--muted)] mt-1">
                  Use {'{{variables}}'} for personalization, e.g., {'{{Owner_Name|there}}'}
                </p>
              </div>
            )}

            <ABTestSetup
              enabled={abEnabled}
              onToggle={(v) => {
                setAbEnabled(v);
                if (v) {
                  setAbSubjectA(subject);
                  setAbSubjectB('');
                }
              }}
              variantASubject={abSubjectA}
              variantBSubject={abSubjectB}
              onVariantASubjectChange={(v) => { setAbSubjectA(v); setSubject(v); }}
              onVariantBSubjectChange={setAbSubjectB}
              splitPct={abSplitPct}
              onSplitPctChange={setAbSplitPct}
              winnerMetric={abWinnerMetric}
              onWinnerMetricChange={setAbWinnerMetric}
            />
          </div>
        )}

        {/* Step 2: Template */}
        {currentStep === 'template' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Select Template</h2>
              <p className="text-sm text-[var(--muted)] mt-1">
                Choose a template for your campaign or{' '}
                <Link href="/email/templates/new" className="text-[var(--primary)] hover:underline">create a new one</Link>
              </p>
            </div>

            {loadingTemplates ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={20} className="animate-spin text-[var(--muted)]" />
              </div>
            ) : templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)]">
                <FileText size={32} className="mb-2 opacity-50" />
                <p className="text-sm">No templates available</p>
                <Link href="/email/templates/new" className="text-sm text-[var(--primary)] mt-2 hover:underline">
                  Create your first template
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {templates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={cn(
                      'flex flex-col p-4 rounded-xl border text-left transition-all',
                      selectedTemplateId === template.id
                        ? 'border-[var(--foreground)] bg-[var(--card-hover)] shadow-sm ring-1 ring-[var(--foreground)]'
                        : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{template.name}</p>
                        {template.subject && (
                          <p className="text-xs text-[var(--muted)] mt-1 truncate">{template.subject}</p>
                        )}
                      </div>
                      {selectedTemplateId === template.id && (
                        <Check size={16} className="text-[var(--success)] shrink-0" />
                      )}
                    </div>
                    {template.category && (
                      <span className="mt-3 px-2 py-0.5 rounded-full text-xs bg-[var(--card-hover)] text-[var(--muted)] self-start">
                        {template.category}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Audience */}
        {currentStep === 'audience' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Choose Audience</h2>
              <p className="text-sm text-[var(--muted)] mt-1">Select who should receive this campaign</p>
            </div>

            <AudiencePicker
              selectedListId={audienceListId}
              onSelect={setAudienceListId}
              excludeListId={exclusionListId}
              onExcludeSelect={setExclusionListId}
            />

            <div className="border-t border-[var(--card-border)] pt-5">
              <SchedulePicker
                mode={scheduleMode}
                scheduledAt={scheduledAt}
                onModeChange={setScheduleMode}
                onScheduledAtChange={setScheduledAt}
              />
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {currentStep === 'review' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Review & Send</h2>
              <p className="text-sm text-[var(--muted)] mt-1">Double-check everything before sending</p>
            </div>

            <div className="space-y-3">
              <ReviewRow label="Campaign Name" value={name} />
              <ReviewRow label="Subject" value={abEnabled ? `A/B Test: "${abSubjectA}" vs "${abSubjectB}"` : subject} />
              <ReviewRow label="Template" value={selectedTemplate?.name ?? 'Not selected'} />
              <ReviewRow label="Campaign Type" value={abEnabled ? `A/B Test (${abSplitPct}% split, ${abWinnerMetric})` : 'One-time'} />
              <ReviewRow label="Delivery" value={scheduleMode === 'now' ? 'Send immediately' : `Scheduled: ${new Date(scheduledAt).toLocaleString()}`} />
            </div>

            {scheduleMode === 'now' && (
              <div className="bg-[var(--warning-subtle)] border border-[var(--warning)] rounded-lg p-3 text-sm text-[var(--warning)]">
                This campaign will be sent immediately after confirmation. This action cannot be undone.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {currentStepIndex > 0 && (
            <button
              onClick={goPrev}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-ghost border border-[var(--card-border)]"
            >
              <ChevronLeft size={16} />
              Back
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveDraft}
            disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm rounded-lg btn-ghost border border-[var(--card-border)] disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <RefreshCw size={14} className="animate-spin" />}
            Save Draft
          </button>

          {currentStep !== 'review' ? (
            <button
              onClick={goNext}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-primary disabled:opacity-50"
            >
              Next
              <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleScheduleOrSend}
              disabled={saving || !canProceed()}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg btn-primary disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {scheduleMode === 'now' ? 'Send Now' : 'Schedule Campaign'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--card-border)] last:border-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%]">{value}</span>
    </div>
  );
}
