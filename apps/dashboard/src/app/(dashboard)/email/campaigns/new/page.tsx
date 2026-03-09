'use client';

import { useAuth } from '@/contexts/auth-context';
import { CampaignBuilder } from '@/components/email/campaign-builder';

export default function NewCampaignPage() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create Campaign</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Build and send an email campaign to your audience
        </p>
      </div>

      <CampaignBuilder />
    </div>
  );
}
