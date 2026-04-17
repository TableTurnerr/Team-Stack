'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Phone,
  MapPin,
  User,
  Calendar,
  Building2,
  Hash,
} from 'lucide-react';
import { cn, formatPhoneNumber, formatDate } from '@/lib/utils';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS } from '@/lib/types';
import type { PhoneNumber } from '@/lib/types';

// ─── Module-level cache to avoid redundant API calls ─────────────────────────
const phoneCache = new Map<string, { data: PhoneNumber; ts: number }>();
const CACHE_TTL = 5 * 60_000; // 5 minutes
const inflight = new Map<string, Promise<PhoneNumber | null>>();

function getCached(key: string): PhoneNumber | null {
  const entry = phoneCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    phoneCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: PhoneNumber) {
  phoneCache.set(key, { data, ts: Date.now() });
}

/** Deduplicated fetch — only one in-flight request per key */
async function fetchPhoneRecord(phoneNumberStr: string): Promise<PhoneNumber | null> {
  const digits = phoneNumberStr.replace(/\D/g, '');
  const cacheKey = digits.slice(-10); // normalize to last 10 digits
  if (!cacheKey || cacheKey.length < 7) return null;

  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

  const promise = (async () => {
    try {
      const result = await pb.collection(COLLECTIONS.PHONE_NUMBERS).getList<PhoneNumber>(1, 1, {
        filter: `phone_number ~ "${cacheKey}"`,
        expand: 'company',
        requestKey: null,
      });
      const record = result.items[0] || null;
      if (record) setCache(cacheKey, record);
      return record;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

// ─── Label colors (same as phone-number-card.tsx) ────────────────────────────
const LABEL_COLORS: Record<string, string> = {
  'Owner Direct': 'bg-purple-500/10 text-purple-400',
  'Main Line': 'bg-blue-500/10 text-blue-400',
  'Manager': 'bg-orange-500/10 text-orange-400',
  'Branch': 'bg-green-500/10 text-green-400',
};

// ─── Component ───────────────────────────────────────────────────────────────

interface PhoneHoverCardProps {
  /** Pass the full record to skip the API call entirely */
  phoneRecord?: PhoneNumber;
  /** Raw phone number string — triggers lazy fetch if no phoneRecord given */
  phoneNumber?: string;
  children: React.ReactNode;
  className?: string;
  side?: 'top' | 'bottom';
}

export function PhoneHoverCard({ phoneRecord, phoneNumber, children, className, side = 'top' }: PhoneHoverCardProps) {
  // If nothing to look up, just render children
  const hasSource = !!phoneRecord || !!phoneNumber;

  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [record, setRecord] = useState<PhoneNumber | null>(phoneRecord || null);
  const [fetched, setFetched] = useState(!!phoneRecord);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Keep in sync if prop changes
  useEffect(() => {
    if (phoneRecord) {
      setRecord(phoneRecord);
      setFetched(true);
    }
  }, [phoneRecord]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      x: rect.left,
      y: side === 'top' ? rect.top : rect.bottom,
    });
  }, [side]);

  const show = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    updatePosition();
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      // Lazy-fetch only on first hover, only if we don't already have the record
      if (!fetched && phoneNumber) {
        setFetched(true);
        fetchPhoneRecord(phoneNumber).then(r => {
          if (r) setRecord(r);
        });
      }
    }, 300);
  }, [updatePosition, fetched, phoneNumber]);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 350);
  }, []);

  const cancelHide = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const handleScroll = () => updatePosition();
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    }
  }, [isVisible, updatePosition]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const company = record?.expand?.company;
  const hasLabel = !!record?.label;
  const hasLocation = !!record?.location_name;
  const hasReceptionist = !!record?.receptionist_name;
  const hasLastCalled = !!record?.last_called;
  const hasTotalCalls = (record?.total_calls ?? 0) > 0;

  if (!hasSource) return <div className={cn('inline-block', className)}>{children}</div>;

  return (
    <div
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      className={cn('inline-block', className)}
    >
      {children}
      {isVisible && (
        <div
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
          className={cn(
            'fixed z-[100] w-[260px] p-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg',
            'animate-in fade-in duration-200',
            side === 'top' && 'slide-in-from-bottom-2',
            side === 'bottom' && 'slide-in-from-top-2',
          )}
          style={{
            left: `${Math.max(8, Math.min(coords.x, window.innerWidth - 276))}px`,
            ...(side === 'top'
              ? { top: `${coords.y - 8}px`, transform: 'translateY(-100%)' }
              : { top: `${coords.y + 8}px` }
            ),
          }}
        >
          {!record ? (
            <div className="p-3 text-center text-xs text-[var(--muted)]">
              {fetched ? 'No record found' : 'Loading...'}
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-3 pb-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center flex-shrink-0">
                    <Phone size={14} className="text-[var(--muted)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold font-mono">{formatPhoneNumber(record.phone_number)}</p>
                    {hasLabel && (
                      <span className={cn(
                        'inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded-full mt-0.5',
                        LABEL_COLORS[record.label!] || 'bg-[var(--card-hover)] text-[var(--muted)]'
                      )}>
                        {record.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Company */}
              {company && (
                <div className="mx-3 py-2 border-t border-[var(--card-border)]">
                  <div className="flex items-center gap-2">
                    <Building2 size={12} className="text-[var(--muted)] flex-shrink-0" />
                    <Link
                      href={`/companies/${company.id}`}
                      className="text-[11px] font-semibold text-[var(--primary)] hover:underline truncate"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {company.company_name}
                    </Link>
                  </div>
                  {company.owner_name && (
                    <div className="flex items-center gap-2 mt-1">
                      <User size={11} className="text-[var(--muted)] flex-shrink-0" />
                      <span className="text-[11px] text-[var(--muted)] truncate">{company.owner_name}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Details */}
              {(hasLocation || hasReceptionist || hasLastCalled || hasTotalCalls) && (
                <div className="mx-3 pt-2 pb-2 border-t border-[var(--card-border)] space-y-1.5">
                  {hasLocation && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <MapPin size={11} className="text-[var(--muted)] flex-shrink-0" />
                      <span className="text-[var(--muted)] truncate">{record.location_name}</span>
                    </div>
                  )}
                  {hasReceptionist && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <User size={11} className="text-[var(--muted)] flex-shrink-0" />
                      <span className="text-[var(--muted)]">Receptionist: {record.receptionist_name}</span>
                    </div>
                  )}
                  {hasTotalCalls && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <Hash size={11} className="text-[var(--muted)] flex-shrink-0" />
                      <span className="text-[var(--muted)]">{record.total_calls} call{record.total_calls !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {hasLastCalled && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <Calendar size={11} className="text-[var(--muted)] flex-shrink-0" />
                      <span className="text-[var(--muted)]">Last called: {formatDate(record.last_called!)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Footer — link to company */}
              {company && (
                <div className="px-3 py-2 border-t border-[var(--card-border)] flex justify-end">
                  <Link
                    href={`/companies/${company.id}`}
                    className="text-[10px] font-semibold text-[var(--primary)] hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View Company
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
