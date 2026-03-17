'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  MapPin,
  Instagram,
  Mail,
  ExternalLink,
  Calendar,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getOutcomeColors } from '@/lib/call-outcomes';
import type { Company } from '@/lib/types';

interface CompanyHoverCardProps {
  company: Company;
  children: React.ReactNode;
  className?: string;
  /** Side to show the card on. Defaults to 'top'. */
  side?: 'top' | 'bottom';
}

export function CompanyHoverCard({ company, children, className, side = 'top' }: CompanyHoverCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0, triggerWidth: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      x: rect.left,
      y: side === 'top' ? rect.top : rect.bottom,
      triggerWidth: rect.width,
    });
  }, [side]);

  const show = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    updatePosition();
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, 300);
  }, [updatePosition]);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 150);
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

  const hasStatus = Array.isArray(company.status) && company.status.length > 0;
  const hasLocation = !!company.company_location;
  const hasInstagram = !!company.instagram_handle;
  const hasEmail = !!company.email;
  const hasOwner = !!company.owner_name;
  const hasLastContacted = !!company.last_contacted;
  const hasSource = !!company.source;

  const formatRelativeTime = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
    'Cold Call': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
    'Google Maps': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
    'Manual': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
    'Instagram': { bg: 'bg-[var(--accent-red-subtle)]', text: 'text-[var(--accent-red)]' },
  };

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
          ref={cardRef}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
          className={cn(
            'fixed z-[100] w-[280px] p-0 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg',
            'animate-in fade-in duration-200',
            side === 'top' && 'slide-in-from-bottom-2',
            side === 'bottom' && 'slide-in-from-top-2',
          )}
          style={{
            left: `${Math.max(8, Math.min(coords.x, window.innerWidth - 296))}px`,
            ...(side === 'top'
              ? { top: `${coords.y - 8}px`, transform: 'translateY(-100%)' }
              : { top: `${coords.y + 8}px` }
            ),
          }}
        >
          {/* Header */}
          <div className="p-3 pb-2">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[var(--sidebar-bg)] border border-[var(--card-border)] flex items-center justify-center flex-shrink-0">
                <Building2 size={16} className="text-[var(--muted)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{company.company_name}</p>
                {hasOwner && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <User size={10} className="text-[var(--muted)] flex-shrink-0" />
                    <p className="text-[11px] text-[var(--muted)] truncate">{company.owner_name}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status badges */}
          {hasStatus && (
            <div className="px-3 pb-2">
              <div className="flex flex-wrap gap-1">
                {company.status!.map(s => {
                  const colors = getOutcomeColors(s);
                  return (
                    <span key={s} className={cn('px-2 py-0.5 text-[10px] font-semibold rounded-full', colors.bg, colors.text)}>
                      {s}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Details */}
          {(hasLocation || hasInstagram || hasEmail || hasLastContacted) && (
            <div className="mx-3 pt-2 pb-2 border-t border-[var(--card-border)] space-y-1.5">
              {hasLocation && (
                <div className="flex items-center gap-2 text-[11px]">
                  <MapPin size={11} className="text-[var(--muted)] flex-shrink-0" />
                  <span className="text-[var(--muted)] truncate">{company.company_location}</span>
                  {company.google_maps_link && (
                    <a
                      href={company.google_maps_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
              {hasInstagram && (
                <div className="flex items-center gap-2 text-[11px]">
                  <Instagram size={11} className="text-[var(--muted)] flex-shrink-0" />
                  <a
                    href={`https://instagram.com/${company.instagram_handle!.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] hover:underline truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    @{company.instagram_handle!.replace('@', '')}
                  </a>
                </div>
              )}
              {hasEmail && (
                <div className="flex items-center gap-2 text-[11px]">
                  <Mail size={11} className="text-[var(--muted)] flex-shrink-0" />
                  <a
                    href={`mailto:${company.email}`}
                    className="text-[var(--primary)] hover:underline truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {company.email}
                  </a>
                </div>
              )}
              {hasLastContacted && (
                <div className="flex items-center gap-2 text-[11px]">
                  <Calendar size={11} className="text-[var(--muted)] flex-shrink-0" />
                  <span className="text-[var(--muted)]">Last contact: {formatRelativeTime(company.last_contacted!)}</span>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="px-3 py-2 border-t border-[var(--card-border)] flex items-center justify-between">
            {hasSource && (
              <span className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium',
                SOURCE_COLORS[company.source!]?.bg || 'bg-gray-500/20',
                SOURCE_COLORS[company.source!]?.text || 'text-gray-400'
              )}>
                {company.source}
              </span>
            )}
            <Link
              href={`/companies/${company.id}`}
              className="text-[10px] font-semibold text-[var(--primary)] hover:underline ml-auto"
              onClick={(e) => e.stopPropagation()}
            >
              View Details
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
