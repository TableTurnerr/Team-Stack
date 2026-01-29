import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-2">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-64" />
            </div>

            {/* Layout */}
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Sidebar */}
                <div className="w-full lg:w-56 shrink-0 space-y-1">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-lg" />
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6 space-y-6">
                        <div className="space-y-2">
                            <Skeleton className="h-6 w-40" />
                            <Skeleton className="h-4 w-80" />
                        </div>
                        <div className="space-y-4">
                            <Skeleton className="h-10 w-full rounded-lg" />
                            <Skeleton className="h-10 w-full rounded-lg" />
                            <Skeleton className="h-10 w-full rounded-lg" />
                            <Skeleton className="h-24 w-full rounded-lg" />
                        </div>
                        <Skeleton className="h-10 w-32 rounded-lg" />
                    </div>
                </div>
            </div>
        </div>
    );
}
