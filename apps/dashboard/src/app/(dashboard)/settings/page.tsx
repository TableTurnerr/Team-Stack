import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-[var(--muted)] mt-1">Configure application settings</p>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-12 text-center">
        <Settings size={48} className="mx-auto mb-4 text-[var(--muted)] opacity-50" />
        <h2 className="text-lg font-medium">Settings Module</h2>
        <p className="text-[var(--muted)] mt-2">Configuration options coming soon</p>
      </div>
    </div>
  );
}
