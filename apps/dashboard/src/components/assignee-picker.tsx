'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronDown, Loader2, User } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type User as UserType } from '@/lib/types';
import { cn } from '@/lib/utils';

let cachedMembers: UserType[] | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

export function useTeamMembers() {
  const [members, setMembers] = useState<UserType[]>(cachedMembers ?? []);
  useEffect(() => {
    const fresh = cachedMembers && Date.now() - cachedAt < CACHE_MS;
    if (fresh) return;
    pb.collection(COLLECTIONS.USERS)
      .getFullList<UserType>({ filter: 'status != "suspended"', sort: 'name' })
      .then(m => {
        cachedMembers = m;
        cachedAt = Date.now();
        setMembers(m);
      })
      .catch(() => {});
  }, []);
  return members;
}

export function AssigneeAvatar({ user, size = 24 }: { user?: UserType | null; size?: number }) {
  const px = `${size}px`;
  if (!user) {
    return (
      <div
        className="rounded-full bg-[var(--card-hover)] flex items-center justify-center flex-shrink-0"
        style={{ width: px, height: px }}
      >
        <User size={Math.round(size * 0.55)} className="text-[var(--muted)]" />
      </div>
    );
  }
  return (
    <div
      className="rounded-full bg-[var(--primary)] flex items-center justify-center flex-shrink-0 relative overflow-hidden"
      style={{ width: px, height: px }}
    >
      {user.avatar ? (
        <Image
          src={pb.files.getUrl(user, user.avatar, { thumb: '48x48' })}
          alt={user.name || ''}
          fill
          sizes={px}
          className="object-cover"
        />
      ) : (
        <span className="text-white font-bold" style={{ fontSize: Math.round(size * 0.4) }}>
          {(user.name?.charAt(0) || user.email?.charAt(0) || 'U').toUpperCase()}
        </span>
      )}
    </div>
  );
}

interface AssigneePickerProps {
  value?: string;
  expandedUser?: UserType | null;
  onChange: (userId: string | null) => void | Promise<void>;
  disabled?: boolean;
  allowUnassign?: boolean;
  members?: UserType[];
  placeholder?: string;
  className?: string;
}

export function AssigneePicker({
  value,
  expandedUser,
  onChange,
  disabled,
  allowUnassign = true,
  members: membersProp,
  placeholder = 'Unassigned',
  className,
}: AssigneePickerProps) {
  const fetched = useTeamMembers();
  const members = membersProp ?? fetched;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = expandedUser ?? members.find(m => m.id === value) ?? null;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleSelect = async (userId: string | null) => {
    setOpen(false);
    if (userId === (value ?? null)) return;
    setSaving(true);
    try {
      await onChange(userId);
    } finally {
      setSaving(false);
    }
  };

  if (disabled) {
    return (
      <div className={cn('flex items-center gap-1.5 min-w-0', className)}>
        <AssigneeAvatar user={current} size={20} />
        <span className="text-sm truncate">
          {current ? (current.name || current.email) : <span className="text-[var(--muted)]">{placeholder}</span>}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg border border-transparent hover:border-[var(--card-border)] hover:bg-[var(--sidebar-bg)] transition-all disabled:opacity-50"
      >
        {saving ? (
          <Loader2 size={14} className="animate-spin text-[var(--muted)]" />
        ) : (
          <AssigneeAvatar user={current} size={20} />
        )}
        <span className="text-sm truncate flex-1 text-left">
          {current ? (current.name || current.email) : <span className="text-[var(--muted)]">{placeholder}</span>}
        </span>
        <ChevronDown size={12} className="text-[var(--muted)] flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[200px] bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
          {allowUnassign && (
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left"
            >
              <AssigneeAvatar user={null} size={20} />
              <span className="text-[var(--muted)]">Unassigned</span>
            </button>
          )}
          {members.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleSelect(m.id)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--sidebar-bg)] transition-colors text-left',
                m.id === value && 'bg-[var(--sidebar-bg)]'
              )}
            >
              <AssigneeAvatar user={m} size={20} />
              <span>{m.name || m.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
