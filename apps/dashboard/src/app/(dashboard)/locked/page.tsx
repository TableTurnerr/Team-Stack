import { LockedPage } from '@/components/locked-page';

const LABELS: Record<string, string> = {
  'cold-calls': 'Cold Calls', session: 'Call Session', recordings: 'Recordings',
  'session-logs': 'Session Logs', companies: 'Companies', leads: 'Leads',
  notes: 'Notes', 'follow-ups': 'Follow-Ups', email: 'Email Marketing',
  'recycle-bin': 'Recycle Bin', roles: 'Roles', actors: 'Actors', goals: 'Goals',
  settings: 'Settings', search: 'Search',
};

export default async function LockedRoute({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const { feature } = await searchParams;
  return <LockedPage feature={LABELS[feature || ''] || 'This section'} />;
}
