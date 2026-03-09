'use client';

import { useState, useEffect } from 'react';
import { Plus, Save, Loader2, Play, Pause, Settings2 } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import {
  EMAIL_COLLECTIONS,
  type EmailSequence,
  type EmailSequenceStep,
  type EmailTemplate,
  type SequenceStatus,
  type TriggerType,
} from '@/lib/email-types';
import { SequenceStepCard } from './sequence-step-card';

interface SequenceBuilderProps {
  sequenceId: string;
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  manual: 'Manual Enrollment',
  status_change: 'Company Status Change',
  new_company: 'New Company Added',
  tag_added: 'Tag Added',
};

export function SequenceBuilder({ sequenceId }: SequenceBuilderProps) {
  const [sequence, setSequence] = useState<EmailSequence | null>(null);
  const [steps, setSteps] = useState<EmailSequenceStep[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [seqData, stepsData, templatesData] = await Promise.all([
          pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).getOne<EmailSequence>(sequenceId),
          pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_STEPS).getFullList<EmailSequenceStep>({
            filter: `sequence = "${sequenceId}"`,
            sort: 'step_order',
            expand: 'template',
          }),
          pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).getFullList<EmailTemplate>({
            sort: 'name',
          }),
        ]);

        setSequence(seqData);
        setSteps(stepsData);
        setTemplates(templatesData);
      } catch (error) {
        console.error('Failed to load sequence:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sequenceId]);

  const handleSaveSequence = async (updates: Partial<EmailSequence>) => {
    if (!sequence) return;
    setSaving(true);
    try {
      const updated = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCES).update<EmailSequence>(sequence.id, updates);
      setSequence(updated);
    } catch (error) {
      console.error('Failed to update sequence:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!sequence) return;
    const newStatus: SequenceStatus = sequence.status === 'active' ? 'paused' : 'active';
    await handleSaveSequence({ status: newStatus });
  };

  const handleAddStep = async () => {
    if (!sequence) return;
    try {
      const newStep = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_STEPS).create<EmailSequenceStep>({
        sequence: sequence.id,
        step_order: steps.length + 1,
        delay_days: steps.length === 0 ? 0 : 1,
        delay_hours: 0,
      });
      setSteps(prev => [...prev, newStep]);
    } catch (error) {
      console.error('Failed to add step:', error);
    }
  };

  const handleUpdateStep = async (stepId: string, data: Partial<EmailSequenceStep>) => {
    try {
      const updated = await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_STEPS).update<EmailSequenceStep>(stepId, data, {
        expand: 'template',
      });
      setSteps(prev => prev.map(s => s.id === stepId ? updated : s));
    } catch (error) {
      console.error('Failed to update step:', error);
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_STEPS).delete(stepId);
      setSteps(prev => {
        const filtered = prev.filter(s => s.id !== stepId);
        // Re-order remaining steps
        return filtered.map((s, i) => ({ ...s, step_order: i + 1 }));
      });
    } catch (error) {
      console.error('Failed to delete step:', error);
    }
  };

  const handleMoveStep = async (index: number, direction: 'up' | 'down') => {
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;

    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];

    // Update step_order
    const reordered = newSteps.map((s, i) => ({ ...s, step_order: i + 1 }));
    setSteps(reordered);

    // Persist order changes
    try {
      await Promise.all(
        reordered.map(s =>
          pb.collection(EMAIL_COLLECTIONS.EMAIL_SEQUENCE_STEPS).update(s.id, { step_order: s.step_order })
        )
      );
    } catch (error) {
      console.error('Failed to reorder steps:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--muted)]">Sequence not found</p>
      </div>
    );
  }

  const statusColor = sequence.status === 'active'
    ? 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20'
    : sequence.status === 'paused'
      ? 'bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/20'
      : 'bg-[var(--card-hover)] text-[var(--muted)] border-[var(--card-border)]';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black tracking-tight">{sequence.name}</h2>
            <span className={`px-2 py-0.5 text-xs font-bold rounded-full border ${statusColor}`}>
              {sequence.status}
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {TRIGGER_LABELS[sequence.trigger_type]} · {steps.length} step{steps.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-2 rounded-xl border border-[var(--card-border)] text-sm font-bold hover:bg-[var(--card-hover)] transition-all flex items-center gap-2"
          >
            <Settings2 size={14} />
            Settings
          </button>
          <button
            onClick={handleToggleStatus}
            disabled={saving || sequence.status === 'draft'}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 disabled:opacity-50 ${
              sequence.status === 'active'
                ? 'bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/20 hover:bg-[var(--warning)]/20'
                : 'bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20 hover:bg-[var(--success)]/20'
            }`}
          >
            {sequence.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
            {sequence.status === 'active' ? 'Pause' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <h3 className="text-sm font-bold">Sequence Settings</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Sequence Name</label>
              <input
                type="text"
                value={sequence.name}
                onChange={(e) => setSequence(prev => prev ? { ...prev, name: e.target.value } : null)}
                onBlur={(e) => handleSaveSequence({ name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--muted)] font-medium block mb-1">Trigger Type</label>
              <select
                value={sequence.trigger_type}
                onChange={(e) => handleSaveSequence({ trigger_type: e.target.value as TriggerType })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:border-[var(--primary)] outline-none"
              >
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sequence.stop_on_reply ?? false}
                onChange={(e) => handleSaveSequence({ stop_on_reply: e.target.checked })}
                className="rounded"
              />
              Stop on reply
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sequence.stop_on_status_change ?? false}
                onChange={(e) => handleSaveSequence({ stop_on_status_change: e.target.checked })}
                className="rounded"
              />
              Stop on status change
            </label>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-3">
        {steps.length === 0 ? (
          <div className="bg-[var(--card-bg)] border border-dashed border-[var(--card-border)] rounded-xl p-8 text-center">
            <p className="text-sm text-[var(--muted)] mb-3">No steps yet. Add your first email step to start building the sequence.</p>
            <button
              onClick={handleAddStep}
              className="px-4 py-2 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-bold hover:opacity-90 transition-all inline-flex items-center gap-2"
            >
              <Plus size={14} />
              Add First Step
            </button>
          </div>
        ) : (
          <>
            {steps.map((step, index) => (
              <SequenceStepCard
                key={step.id}
                step={step}
                index={index}
                templates={templates}
                onUpdate={handleUpdateStep}
                onDelete={handleDeleteStep}
                onMoveUp={() => handleMoveStep(index, 'up')}
                onMoveDown={() => handleMoveStep(index, 'down')}
                isFirst={index === 0}
                isLast={index === steps.length - 1}
              />
            ))}

            {/* Add step button */}
            <button
              onClick={handleAddStep}
              className="w-full py-3 rounded-xl border border-dashed border-[var(--card-border)] text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--primary)] hover:bg-[var(--primary-subtle)] transition-all flex items-center justify-center gap-2"
            >
              <Plus size={14} />
              Add Step
            </button>
          </>
        )}
      </div>
    </div>
  );
}
