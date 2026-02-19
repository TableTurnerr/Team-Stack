'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Phone,
  Building2,
  MapPin,
  Clock,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
} from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type PhoneNumber, type FollowUp } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { formatRelativeFollowUp } from '@/lib/timezone-utils';
import { useColumnVisibility, type ColumnDefinition } from '@/hooks/use-column-visibility';
import { ColumnSelector } from '@/components/column-selector';
import { ZoomCallButton } from '@/components/zoom-call-button';
import { FollowUpTimeDisplay } from '@/components/follow-up-time-display';

const PHONE_NUMBER_COLUMNS: ColumnDefinition[] = [
  { key: 'phone_number', label: 'Phone Number', defaultVisible: true },
  { key: 'company', label: 'Company', defaultVisible: true },
  { key: 'location', label: 'Location', defaultVisible: true },
  { key: 'label', label: 'Label', defaultVisible: true },
  { key: 'total_calls', label: 'Total Calls', defaultVisible: true },
  { key: 'last_called', label: 'Last Called', defaultVisible: true },
  { key: 'receptionist', label: 'Receptionist', defaultVisible: false },
  { key: 'follow_up', label: 'Follow-Up', defaultVisible: true },
  { key: 'actions', label: 'Actions', alwaysVisible: true },
];

const LABEL_COLORS: Record<string, string> = {
  'Owner Direct': 'bg-[var(--success-subtle)] text-[var(--success)]',
  'Main Line': 'bg-[var(--info-subtle)] text-[var(--info)]',
  'Manager': 'bg-[var(--warning-subtle)] text-[var(--warning)]',
  'Branch': 'bg-[var(--card-hover)] text-[var(--muted)]',
};

interface PhoneNumbersTabProps {
  searchTerm?: string;
}

export function PhoneNumbersTab({ searchTerm = '' }: PhoneNumbersTabProps) {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [followUps, setFollowUps] = useState<Map<string, FollowUp>>(new Map());
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'last_called', dir: 'desc' });
  const perPage = 20;

  const { columns, visibleColumns, isColumnVisible, toggleColumn } = useColumnVisibility('cold-calls-phone-numbers', PHONE_NUMBER_COLUMNS);

  const fetchPhoneNumbers = useCallback(async () => {
    try {
      setLoading(true);
      const filters: string[] = [];
      if (searchTerm) {
        const safe = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        filters.push(`(phone_number ~ "${safe}" || expand.company.company_name ~ "${safe}" || location_name ~ "${safe}" || receptionist_name ~ "${safe}")`);
      }

      const sortStr = `${sort.dir === 'desc' ? '-' : ''}${sort.field}`;
      const result = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(page, perPage, {
        sort: sortStr,
        expand: 'company',
        ...(filters.length > 0 && { filter: filters.join(' && ') }),
      });

      setPhoneNumbers(result.items);
      setTotalPages(result.totalPages);

      // Fetch pending follow-ups for visible phone numbers
      if (result.items.length > 0) {
        const ids = result.items.map(p => `phone_number_record = "${p.id}"`).join(' || ');
        try {
          const fups = await pb.collection(COLLECTIONS.FOLLOW_UPS).getFullList<FollowUp>({
            filter: `status = "pending" && (${ids})`,
            sort: 'scheduled_time',
          });
          const map = new Map<string, FollowUp>();
          for (const fu of fups) {
            if (fu.phone_number_record && !map.has(fu.phone_number_record)) {
              map.set(fu.phone_number_record, fu);
            }
          }
          setFollowUps(map);
        } catch {
          // Follow-ups query may fail if no phone_number_record filter matches
        }
      }
    } catch (err) {
      console.error('Failed to fetch phone numbers:', err);
    } finally {
      setLoading(false);
    }
  }, [page, sort, searchTerm]);

  useEffect(() => {
    fetchPhoneNumbers();
  }, [fetchPhoneNumbers]);

  const handleSort = (field: string) => {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-16 text-center">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-[var(--card-border)] rounded w-1/3 mx-auto" />
          <div className="h-4 bg-[var(--card-border)] rounded w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ColumnSelector
          columns={columns}
          visibleColumns={visibleColumns}
          onToggle={toggleColumn}
        />
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {phoneNumbers.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--info-subtle)] flex items-center justify-center mx-auto mb-4">
              <Phone size={24} className="text-[var(--info)]" />
            </div>
            <p className="text-sm font-medium">No phone numbers found</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {searchTerm ? 'Try adjusting your search' : 'Phone numbers will appear here after calls are logged'}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--sidebar-bg)] border-b border-[var(--card-border)]">
                  <tr>
                    {isColumnVisible('phone_number') && (
                      <th
                        className="text-left py-3 px-4 font-medium text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]"
                        onClick={() => handleSort('phone_number')}
                      >
                        <div className="flex items-center gap-1">
                          Phone Number
                          {sort.field === 'phone_number' && (sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                      </th>
                    )}
                    {isColumnVisible('company') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Company</th>}
                    {isColumnVisible('location') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Location</th>}
                    {isColumnVisible('label') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Label</th>}
                    {isColumnVisible('total_calls') && (
                      <th
                        className="text-left py-3 px-4 font-medium text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]"
                        onClick={() => handleSort('total_calls')}
                      >
                        <div className="flex items-center gap-1">
                          Total Calls
                          {sort.field === 'total_calls' && (sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                      </th>
                    )}
                    {isColumnVisible('last_called') && (
                      <th
                        className="text-left py-3 px-4 font-medium text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]"
                        onClick={() => handleSort('last_called')}
                      >
                        <div className="flex items-center gap-1">
                          Last Called
                          {sort.field === 'last_called' && (sort.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </div>
                      </th>
                    )}
                    {isColumnVisible('receptionist') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Receptionist</th>}
                    {isColumnVisible('follow_up') && <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Follow-Up</th>}
                    <th className="text-left py-3 px-4 font-medium text-[var(--muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {phoneNumbers.map((pn) => {
                    const company = pn.expand?.company;
                    const followUp = followUps.get(pn.id);

                    return (
                      <tr
                        key={pn.id}
                        className="border-b border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-colors"
                      >
                        {isColumnVisible('phone_number') && (
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-mono font-medium">{pn.phone_number}</span>
                              <ZoomCallButton phoneNumber={pn.phone_number} />
                            </div>
                          </td>
                        )}
                        {isColumnVisible('company') && (
                          <td className="py-3 px-4">
                            {company ? (
                              <Link href={`/companies/${company.id}`} className="flex items-center gap-1.5 hover:text-[var(--primary)] transition-colors">
                                <Building2 size={12} className="text-[var(--muted)]" />
                                <span className="font-medium text-sm">{company.company_name}</span>
                              </Link>
                            ) : (
                              <span className="text-[var(--muted)] text-sm">Unknown</span>
                            )}
                          </td>
                        )}
                        {isColumnVisible('location') && (
                          <td className="py-3 px-4">
                            {pn.location_name ? (
                              <div className="flex items-center gap-1">
                                <MapPin size={12} className="text-[var(--muted)]" />
                                <span className="text-sm">{pn.location_name}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">-</span>
                            )}
                          </td>
                        )}
                        {isColumnVisible('label') && (
                          <td className="py-3 px-4">
                            {pn.label ? (
                              <span className={cn(
                                "px-2 py-0.5 rounded-md text-xs font-medium",
                                LABEL_COLORS[pn.label] || 'bg-[var(--card-hover)] text-[var(--muted)]'
                              )}>
                                {pn.label}
                              </span>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">-</span>
                            )}
                          </td>
                        )}
                        {isColumnVisible('total_calls') && (
                          <td className="py-3 px-4">
                            <span className="text-sm font-medium">{pn.total_calls || 0}</span>
                          </td>
                        )}
                        {isColumnVisible('last_called') && (
                          <td className="py-3 px-4">
                            {pn.last_called ? (
                              <div className="flex items-center gap-1 text-sm text-[var(--muted)]">
                                <Clock size={12} />
                                <span>{formatDate(pn.last_called)}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-[var(--muted)]">Never</span>
                            )}
                          </td>
                        )}
                        {isColumnVisible('receptionist') && (
                          <td className="py-3 px-4">
                            <span className="text-sm">{pn.receptionist_name || '-'}</span>
                          </td>
                        )}
                        {isColumnVisible('follow_up') && (
                          <td className="py-3 px-4">
                            {followUp ? (
                              <FollowUpTimeDisplay
                                scheduledTime={followUp.scheduled_time}
                                clientTimezone={followUp.client_timezone}
                                compact
                              />
                            ) : (
                              <span className="text-xs text-[var(--muted)]">None</span>
                            )}
                          </td>
                        )}
                        <td className="py-3 px-4">
                          {company && (
                            <Link
                              href={`/companies/${company.id}?tab=phones`}
                              className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors inline-block"
                              title="View in Company"
                            >
                              <Eye size={16} />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-[var(--card-border)]">
                <span className="text-sm text-[var(--muted)]">Page {page} of {totalPages}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 rounded-md border border-[var(--card-border)] disabled:opacity-50 hover:bg-[var(--sidebar-bg)]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
