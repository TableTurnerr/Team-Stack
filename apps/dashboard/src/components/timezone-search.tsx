'use client';

import { useState, useMemo, useEffect } from 'react';
import { Search, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimezoneSearchProps {
    onSelect: (timezone: { timezone: string; label: string }) => void;
    onCancel: () => void;
    existingTimezones?: string[]; // IDs of timezones already selected
}

export function TimezoneSearch({ onSelect, onCancel, existingTimezones = [] }: TimezoneSearchProps) {
    const [search, setSearch] = useState('');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Get all supported timezones
    const allTimezones = useMemo(() => {
        if (typeof Intl === 'undefined' || !Intl.supportedValuesOf) {
            return [];
        }
        return Intl.supportedValuesOf('timeZone');
    }, []);

    // Filter based on search
    const filteredTimezones = useMemo(() => {
        if (!search) return allTimezones;
        const lower = search.toLowerCase();
        return allTimezones.filter(tz => tz.toLowerCase().includes(lower));
    }, [allTimezones, search]);

    // Generate a friendly label for a timezone ID
    const getLabel = (tz: string) => {
        const parts = tz.split('/');
        const city = parts[parts.length - 1].replace(/_/g, ' ');
        // We can't easily get strict abbreviations (EST/PST) without a library aka date-fns-tz or moment-timezone
        // So we'll stick to "City (Timezone ID)" or just "City" for now.
        // The previous ones were hardcoded.
        return city;
    };

    // Format for display
    const displayTimezones = filteredTimezones.slice(0, 50); // Limit to 50 results for performance

    if (!mounted) return <div className="p-4 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-[300px] bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Search Header */}
            <div className="p-2 border-b border-[var(--card-border)]">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 text-[var(--muted)]" size={14} />
                    <input
                        type="text"
                        placeholder="Search timezones..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-md focus:outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted)]"
                        autoFocus
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-1">
                {displayTimezones.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--muted)]">
                        No timezones found
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {displayTimezones.map(tz => {
                            const isSelected = existingTimezones.includes(tz);
                            const city = getLabel(tz);

                            return (
                                <button
                                    key={tz}
                                    onClick={() => {
                                        if (!isSelected) {
                                            onSelect({ timezone: tz, label: city });
                                        }
                                    }}
                                    disabled={isSelected}
                                    className={cn(
                                        "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors text-left",
                                        isSelected
                                            ? "opacity-50 cursor-not-allowed bg-[var(--sidebar-bg)]"
                                            : "hover:bg-[var(--card-hover)]"
                                    )}
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium">{city}</span>
                                        <span className="text-[10px] text-[var(--muted)]">{tz}</span>
                                    </div>
                                    {isSelected && <Check size={14} className="text-[var(--success)]" />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-[var(--card-border)] bg-[var(--sidebar-bg)]">
                <button
                    onClick={onCancel}
                    className="w-full py-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors rounded hover:bg-[var(--card-hover)]"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
