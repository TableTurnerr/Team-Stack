'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceBuilder } from '@/components/email/sequence-builder';
import { EnrollmentTable } from '@/components/email/enrollment-table';

type TabType = 'builder' | 'enrollments';

export default function SequenceDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('builder');

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Back button */}
      <button
        onClick={() => router.push('/email/sequences')}
        className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors w-fit"
      >
        <ChevronLeft size={16} />
        Back to Sequences
      </button>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--card-border)]">
        {[
          { id: 'builder' as const, label: 'Builder' },
          { id: 'enrollments' as const, label: 'Enrollments' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-6 py-4 text-sm font-bold transition-all relative whitespace-nowrap',
              activeTab === tab.id
                ? 'text-[var(--foreground)]'
                : 'text-[var(--muted)] hover:text-[var(--foreground)]'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--foreground)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'builder' && <SequenceBuilder sequenceId={id} />}
        {activeTab === 'enrollments' && <EnrollmentTable sequenceId={id} />}
      </div>
    </div>
  );
}
