import { Target, Lock } from 'lucide-react';

export default function GoalsPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Goals</h1>
        <span className="flex items-center gap-1 text-xs bg-amber-500/10 text-amber-600 px-2 py-1 rounded-full">
          <Lock size={12} />
          Coming Soon
        </span>
      </div>
      <p className="text-[var(--muted)]">Set and track performance targets for your team</p>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-12 text-center">
        <Target size={48} className="mx-auto mb-4 text-[var(--muted)] opacity-50" />
        <h2 className="text-lg font-medium">Goals Module</h2>
        <p className="text-[var(--muted)] mt-2">
          This feature is currently under development and will be available in a future release.
        </p>
      </div>
    </div>
  );
}
