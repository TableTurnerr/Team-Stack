'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import { EMAIL_COLLECTIONS, type EmailTemplate } from '@/lib/email-types';
import { COLLECTIONS, type Company } from '@/lib/types';
import { ArrowLeft, Save, Send, Loader2, Trash2, Users } from 'lucide-react';
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

export default function EditTemplatePage() {
  const { isAuthenticated } = useAuth();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [category, setCategory] = useState('');
  const [jsonBody, setJsonBody] = useState('');
  const [htmlBody, setHtmlBody] = useState('');

  // Sample company for preview
  const [sampleCompany, setSampleCompany] = useState<Partial<Company> | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showCompanyPicker, setShowCompanyPicker] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    async function load() {
      try {
        const [template, companiesResult] = await Promise.all([
          pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).getOne<EmailTemplate>(id),
          pb.collection(COLLECTIONS.COMPANIES).getList<Company>(1, 20, {
            sort: '-updated',
            filter: 'email != ""',
          }),
        ]);

        setName(template.name);
        setSubject(template.subject || '');
        setPreviewText(template.preview_text || '');
        setCategory(template.category || '');
        setJsonBody(template.json_body ? JSON.stringify(template.json_body) : '');
        setHtmlBody(template.html_body || '');
        setCompanies(companiesResult.items);
        if (companiesResult.items.length > 0) {
          setSampleCompany(companiesResult.items[0]);
        }
      } catch (err) {
        console.error('Error loading template:', err);
        router.push('/email/templates');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isAuthenticated, id, router]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let parsedJson: Record<string, unknown> | undefined;
      try { parsedJson = jsonBody ? JSON.parse(jsonBody) : undefined; } catch { /* keep undefined */ }

      await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).update(id, {
        name: name.trim(),
        subject,
        html_body: htmlBody,
        json_body: parsedJson,
        preview_text: previewText,
        category: category || undefined,
      });
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).delete(id);
      router.push('/email/templates');
    } catch (err) {
      console.error('Error deleting template:', err);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 bg-[var(--card-bg)] rounded-lg animate-pulse" />
        <div className="h-12 bg-[var(--card-bg)] rounded-lg animate-pulse" />
        <div className="h-[500px] bg-[var(--card-bg)] rounded-lg animate-pulse" />
      </div>
    );
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
            <h1 className="text-2xl font-bold tracking-tight">Edit Template</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">Modify your email design</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--card-border)] text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
          >
            <Trash2 size={14} />
          </button>
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
            Save
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
      <div className="flex items-center gap-4">
        <div className="flex bg-[var(--card-bg)] border border-[var(--card-border)] p-1 rounded-lg">
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

        {/* Company picker for preview */}
        {activeTab === 'preview' && companies.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowCompanyPicker(!showCompanyPicker)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              <Users size={13} />
              {sampleCompany ? (sampleCompany as Company).company_name : 'Select company'}
            </button>
            {showCompanyPicker && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto py-1">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSampleCompany(c); setShowCompanyPicker(false); }}
                    className={cn(
                      'w-full flex flex-col px-3 py-2 text-left hover:bg-[var(--card-hover)] transition-colors',
                      sampleCompany && (sampleCompany as Company).id === c.id && 'bg-[var(--card-hover)]',
                    )}
                  >
                    <span className="text-sm font-medium truncate">{c.company_name}</span>
                    <span className="text-xs text-[var(--muted)] truncate">{c.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
        />
      ) : (
        <TemplatePreview
          html={htmlBody}
          subject={subject}
          previewText={previewText}
          sampleCompany={sampleCompany}
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
