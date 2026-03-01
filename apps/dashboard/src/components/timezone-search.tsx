'use client';

import { useState, useMemo, useEffect } from 'react';
import { Search, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CITY_TIMEZONE_MAP } from '@/lib/city-timezone-map';

interface TimezoneSearchProps {
    onSelect: (timezone: { timezone: string; label: string }) => void;
    onCancel: () => void;
    existingTimezones?: string[]; // IDs of timezones already selected
}

interface TimezoneResult {
    timezone: string;
    city: string;
    source: 'iana' | 'city-map';
}

export function TimezoneSearch({ onSelect, onCancel, existingTimezones = [] }: TimezoneSearchProps) {
    const [search, setSearch] = useState('');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // All IANA timezone IDs
    const allTimezones = useMemo(() => {
        if (typeof Intl === 'undefined' || !Intl.supportedValuesOf) {
            return [];
        }
        return Intl.supportedValuesOf('timeZone');
    }, []);

    // Derive a friendly city label from IANA ID
    const getIanaLabel = (tz: string) => {
        const parts = tz.split('/');
        return parts[parts.length - 1].replace(/_/g, ' ');
    };

    // Build combined results from both IANA search and city-map search
    const filteredResults = useMemo((): TimezoneResult[] => {
        const lower = search.toLowerCase().trim();
        if (!lower) {
            // Return popular timezones by default
            const popular = [
                'America/New_York', 'America/Chicago', 'America/Denver',
                'America/Los_Angeles', 'America/Toronto', 'America/Vancouver',
                'Europe/London', 'Europe/Paris', 'Europe/Berlin',
                'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Shanghai',
                'Australia/Sydney', 'Pacific/Auckland',
            ];
            return popular
                .filter(tz => allTimezones.includes(tz))
                .map(tz => ({ timezone: tz, city: getIanaLabel(tz), source: 'iana' as const }));
        }

        const seen = new Set<string>();
        const results: TimezoneResult[] = [];

        // 1. City-map matches (city name search — covers small towns too)
        for (const [cityKey, tzId] of Object.entries(CITY_TIMEZONE_MAP)) {
            if (cityKey.includes(lower) || lower.includes(cityKey)) {
                if (!seen.has(tzId)) {
                    seen.add(tzId);
                    // Find the best city label from the map key
                    const cityLabel = cityKey
                        .split(' ')
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ');
                    results.push({ timezone: tzId, city: cityLabel, source: 'city-map' });
                }
            }
        }

        // 2. IANA ID direct matches (e.g. "America/New_York", "Europe/Paris")
        for (const tz of allTimezones) {
            if (tz.toLowerCase().includes(lower) && !seen.has(tz)) {
                seen.add(tz);
                results.push({ timezone: tz, city: getIanaLabel(tz), source: 'iana' });
            }
        }

        return results.slice(0, 60);
    }, [search, allTimezones]);

    if (!mounted) return <div className="p-4 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-[320px] bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Search Header */}
            <div className="p-2 border-b border-[var(--card-border)]">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 text-[var(--muted)]" size={14} />
                    <input
                        type="text"
                        placeholder="Search any city or timezone..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-sm bg-[var(--sidebar-bg)] border border-[var(--card-border)] rounded-md focus:outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted)]"
                        autoFocus
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-1">
                {filteredResults.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--muted)]">
                        No timezones found for &quot;{search}&quot;
                    </div>
                ) : (
                    <div className="space-y-0.5">
                        {!search && (
                            <div className="px-3 py-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                                Popular Timezones
                            </div>
                        )}
                        {filteredResults.map((result, idx) => {
                            const isSelected = existingTimezones.includes(result.timezone);
                            return (
                                <button
                                    key={`${result.timezone}-${idx}`}
                                    onClick={() => {
                                        if (!isSelected) {
                                            onSelect({ timezone: result.timezone, label: result.city });
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
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium truncate">{result.city}</span>
                                        <span className="text-[10px] text-[var(--muted)] truncate">{result.timezone}</span>
                                    </div>
                                    {isSelected && <Check size={14} className="text-[var(--success)] shrink-0 ml-2" />}
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
