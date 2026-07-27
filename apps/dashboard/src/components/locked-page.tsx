import { LockKeyhole } from 'lucide-react';

export function LockedPage({ feature = 'This section' }: { feature?: string }) {
  return (
    <div className="min-h-[65vh] grid place-items-center">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-5 w-16 h-16 rounded-2xl bg-[var(--card-hover)] flex items-center justify-center">
          <LockKeyhole size={30} className="text-[var(--muted)]" />
        </span>
        <h1 className="text-2xl font-semibold">{feature} is locked</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">This legacy CRM section is no longer active in the dashboard. Use Lead Submission, Pipeline, Financial Overview, or Team Overview.</p>
      </div>
    </div>
  );
}
