'use client';

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import { EMAIL_COLLECTIONS, type EmailTemplate } from '@/lib/email-types';
import { Plus, FileText, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { SearchInput } from '@/components/search-input';
import { CardGridSkeleton } from '@/components/dashboard-skeletons';
import { TemplateCard } from '@/components/email/template-card';
import { cn } from '@/lib/utils';

const CATEGORIES = ['All', 'Welcome', 'Follow-up', 'Promotion', 'Newsletter', 'Re-engagement', 'Other'];

export default function TemplatesPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => {
    if (isAuthenticated) fetchTemplates();
  }, [isAuthenticated]);

  async function fetchTemplates() {
    setLoading(true);
    try {
      const result = await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).getList<EmailTemplate>(1, 200, {
        sort: '-updated',
        expand: 'created_by',
      });
      setTemplates(result.items);
    } catch (err) {
      if ((err as { status?: number })?.status !== 0) console.error('Error fetching templates:', err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = templates.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.subject || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'All' || t.category === category;
    return matchesSearch && matchesCategory;
  });

  async function handleClone(template: EmailTemplate) {
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).create({
        name: `${template.name} (Copy)`,
        subject: template.subject,
        html_body: template.html_body,
        json_body: template.json_body,
        preview_text: template.preview_text,
        category: template.category,
        created_by: pb.authStore.model?.id,
      });
      fetchTemplates();
    } catch (err) {
      console.error('Error cloning template:', err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
      await pb.collection(EMAIL_COLLECTIONS.EMAIL_TEMPLATES).delete(id);
      fetchTemplates();
    } catch (err) {
      console.error('Error deleting template:', err);
    }
  }

  if (loading) return <CardGridSkeleton />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <a
            href="/email"
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors mt-1"
          >
            <ArrowLeft size={20} />
          </a>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Reusable email designs for your campaigns</p>
          </div>
        </div>
        <button
          onClick={() => router.push('/email/templates/new')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors"
        >
          <Plus size={16} />
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex bg-[var(--card-bg)] border border-[var(--card-border)] p-1 rounded-lg overflow-x-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors',
                category === cat
                  ? 'bg-[var(--foreground)] text-[var(--background)]'
                  : 'text-[var(--muted)] hover:text-[var(--foreground)]',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <SearchInput
          placeholder="Search templates…"
          onSearch={setSearch}
          defaultValue={search}
          className="w-full sm:max-w-sm"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--primary-subtle)] flex items-center justify-center mx-auto mb-4">
            <FileText size={24} className="text-[var(--primary)]" />
          </div>
          <p className="text-sm font-medium">No templates found</p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {search ? 'Try a different search term' : 'Create your first email template'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onEdit={(id) => router.push(`/email/templates/${id}`)}
              onClone={handleClone}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
