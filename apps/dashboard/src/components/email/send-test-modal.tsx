'use client';

import { useState } from 'react';
import { X, Send, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';

interface SendTestModalProps {
  open: boolean;
  onClose: () => void;
  subject: string;
  html: string;
  previewText?: string;
}

type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

export function SendTestModal({ open, onClose, subject, html, previewText }: SendTestModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<SendStatus>('idle');
  const [error, setError] = useState('');

  if (!open) return null;

  async function handleSend() {
    if (!email.trim()) return;
    setStatus('sending');
    setError('');

    try {
      const res = await fetch('/api/email-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pb.authStore.token}` },
        body: JSON.stringify({
          to: email.trim(),
          subject: subject || '(No subject)',
          html,
          previewText,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send test email');
      }

      setStatus('sent');
      setTimeout(() => {
        setStatus('idle');
        setEmail('');
        onClose();
      }, 2000);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--card-border)]">
          <div>
            <h2 className="text-lg font-semibold">Send Test Email</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">Preview how your email will look in an inbox</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-1.5">
              Recipient Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2.5 text-sm bg-[var(--background)] border border-[var(--card-border)] rounded-lg focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
              disabled={status === 'sending'}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
          </div>

          {subject && (
            <div className="bg-[var(--background)] border border-[var(--card-border)] rounded-lg p-3">
              <div className="text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider mb-1">Subject</div>
              <div className="text-sm truncate">{subject}</div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--error-subtle)] text-[var(--error)] text-sm">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {status === 'sent' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--success-subtle)] text-[var(--success)] text-sm">
              <CheckCircle size={16} />
              Test email sent successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-[var(--card-border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg hover:bg-[var(--card-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={!email.trim() || status === 'sending' || status === 'sent'}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              'bg-[var(--foreground)] text-[var(--background)] hover:opacity-90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {status === 'sending' ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Sending…
              </>
            ) : status === 'sent' ? (
              <>
                <CheckCircle size={14} />
                Sent!
              </>
            ) : (
              <>
                <Send size={14} />
                Send Test
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
