'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import { EMAIL_COLLECTIONS } from '@/lib/email-types';
import { ArrowLeft, Save, Send, Loader2 } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { SendTestModal } from '@/components/email/send-test-modal';
import { TemplatePreview } from '@/components/email/template-preview';
import { cn } from '@/lib/utils';
import { PageGuard } from '@/components/page-guard';

const TemplateEditor = dynamic(
  () => import('@/components/email/template-editor').then((m) => ({ default: m.TemplateEditor })),
  { ssr: false, loading: () => <div className="min-h-[400px] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg animate-pulse" /> },
);

const CATEGORIES = ['Welcome', 'Follow-up', 'Promotion', 'Newsletter', 'Re-engagement', 'Other'];

export default function NewTemplatePage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [category, setCategory] = useState('');
  const [jsonBody, setJsonBody] = useState('');
  const [htmlBody, setHtmlBody] = useState('');

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let parsedJson: Record<string, unknown> | undefined;
      try { parsedJson = jsonBody ? JSON.parse(jsonBody) : undefined; } catch { /* keep undefined */ }

      const record = await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).create({
        name: name.trim(),
        subject,
        html_body: htmlBody,
        json_body: parsedJson,
        preview_text: previewText,
        category: category || undefined,
        created_by: pb.authStore.model?.id,
      });
      router.push(`/email/templates/${record.id}`);
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageGuard pageKey="email">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/email/templates"
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Template</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">Create a reusable email design</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTestModal(true)}
            disabled={!htmlBody}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            Test Send
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              'bg-[var(--foreground)] text-[var(--background)] hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Template
          </button>
        </div>
      </div>

      {/* Name & Category */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1.5">
            Template Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Welcome Email"
            className="w-full px-3 py-2.5 text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1.5">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2.5 text-sm bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--primary)]"
          >
            <option value="">No category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Editor / Preview tabs */}
      <div className="flex bg-[var(--card-bg)] border border-[var(--card-border)] p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('editor')}
          className={cn(
            'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
            activeTab === 'editor'
              ? 'bg-[var(--foreground)] text-[var(--background)]'
              : 'text-[var(--muted)] hover:text-[var(--foreground)]',
          )}
        >
          Editor
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={cn(
            'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
            activeTab === 'preview'
              ? 'bg-[var(--foreground)] text-[var(--background)]'
              : 'text-[var(--muted)] hover:text-[var(--foreground)]',
          )}
        >
          Preview
        </button>
      </div>

      {/* Content */}
      {activeTab === 'editor' ? (
        <TemplateEditor
          content={jsonBody}
          onChange={(json, html) => { setJsonBody(json); setHtmlBody(html); }}
          subject={subject}
          onSubjectChange={setSubject}
          previewText={previewText}
          onPreviewTextChange={setPreviewText}
          autoFocus
        />
      ) : (
        <TemplatePreview
          html={htmlBody}
          subject={subject}
          previewText={previewText}
        />
      )}

      <SendTestModal
        open={showTestModal}
        onClose={() => setShowTestModal(false)}
        subject={subject}
        html={htmlBody}
        previewText={previewText}
      />
    </div>
    </PageGuard>
  );
}
