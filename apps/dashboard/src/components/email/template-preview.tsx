'use client';

import { useState, useMemo } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EMAIL_VARIABLES } from './variable-inserter';
import type { Company } from '@/lib/types';

interface TemplatePreviewProps {
  html: string;
  subject?: string;
  previewText?: string;
  sampleCompany?: Partial<Company> | null;
}

const VARIABLE_TO_COMPANY_FIELD: Record<string, keyof Company> = {
  Company_Name: 'company_name',
  Owner_Name: 'owner_name',
  Email: 'email',
  Location: 'company_location',
  Status: 'status',
  Source: 'source',
  Google_Rating: 'google_rating',
  Instagram_Handle: 'instagram_handle',
  First_Contacted: 'first_contacted',
  Last_Contacted: 'last_contacted',
};

function resolveVariables(text: string, company?: Partial<Company> | null): string {
  if (!text) return text;
  return text.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_match, key: string, fallback?: string) => {
    const field = VARIABLE_TO_COMPANY_FIELD[key];
    if (field && company && company[field]) {
      return String(company[field]);
    }
    if (fallback) return fallback;
    const variable = EMAIL_VARIABLES.find((v) => v.key === key);
    return variable?.example ?? `{{${key}}}`;
  });
}

export function TemplatePreview({ html, subject, previewText, sampleCompany }: TemplatePreviewProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const resolvedHtml = useMemo(() => resolveVariables(html, sampleCompany), [html, sampleCompany]);
  const resolvedSubject = useMemo(() => resolveVariables(subject || '', sampleCompany), [subject, sampleCompany]);

  return (
    <div className="space-y-3">
      {/* Device toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Preview</h3>
        <div className="flex bg-[var(--card-bg)] border border-[var(--card-border)] p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              device === 'desktop'
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            <Monitor size={13} />
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              device === 'mobile'
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            <Smartphone size={13} />
            Mobile
          </button>
        </div>
      </div>

      {/* Email envelope preview */}
      {(subject || previewText) && (
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-3 space-y-1">
          {subject && (
            <div className="text-sm font-semibold truncate">{resolvedSubject}</div>
          )}
          {previewText && (
            <div className="text-xs text-[var(--muted)] truncate">
              {resolveVariables(previewText, sampleCompany)}
            </div>
          )}
        </div>
      )}

      {/* Preview frame */}
      <div
        className={cn(
          'mx-auto border border-[var(--card-border)] rounded-lg overflow-hidden bg-white transition-all duration-300',
          device === 'desktop' ? 'w-full' : 'w-[375px]',
        )}
      >
        <div className="bg-[var(--card-bg)] border-b border-[var(--card-border)] px-3 py-1.5 flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--error)]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--warning)]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--success)]" />
          <span className="ml-2 text-[10px] text-[var(--muted)]">
            {device === 'desktop' ? 'Desktop Preview' : 'Mobile Preview'}
          </span>
        </div>
        <iframe
          srcDoc={`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  margin: 0;
                  padding: 24px;
                  color: #1a1a1a;
                  font-size: 14px;
                  line-height: 1.6;
                }
                a { color: #2563eb; }
                h1 { font-size: 24px; margin: 16px 0 8px; }
                h2 { font-size: 20px; margin: 14px 0 6px; }
                h3 { font-size: 16px; margin: 12px 0 4px; }
                p { margin: 8px 0; }
                hr { border: none; border-top: 1px solid #e5e5e5; margin: 16px 0; }
                ul, ol { padding-left: 24px; }
                mark { padding: 2px 4px; border-radius: 2px; }
                img { max-width: 100%; height: auto; }
              </style>
            </head>
            <body>${resolvedHtml}</body>
            </html>
          `}
          className="w-full border-0"
          style={{ minHeight: '300px', height: device === 'desktop' ? '500px' : '600px' }}
          sandbox="allow-same-origin"
          title="Email preview"
        />
      </div>
    </div>
  );
}
