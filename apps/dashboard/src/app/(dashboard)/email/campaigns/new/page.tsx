'use client';

import { useAuth } from '@/contexts/auth-context';
import { CampaignBuilder } from '@/components/email/campaign-builder';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NewCampaignPage() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link
          href="/email/campaigns"
          className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors mt-1"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create Campaign</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Build and send an email campaign to your audience
          </p>
        </div>
      </div>

      <CampaignBuilder />
    </div>
  );
}
