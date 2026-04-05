'use client';

import { usePermissionsOptional } from '@/contexts/role-permission-context';

interface UserRoleBadgesProps {
  userId: string;
  maxVisible?: number;
  size?: 'xs' | 'sm';
}

export function UserRoleBadges({ userId, maxVisible = 3, size = 'xs' }: UserRoleBadgesProps) {
  const permissions = usePermissionsOptional();
  if (!permissions) return null;

  const userRoles = permissions.roles.filter(r => r.members?.includes(userId));
  if (userRoles.length === 0) return null;

  const visible = userRoles.slice(0, maxVisible);
  const overflow = userRoles.length - maxVisible;

  const padding = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map(role => (
        <span
          key={role.id}
          className={`inline-flex items-center gap-1 rounded-full font-medium text-white leading-none ${padding}`}
          style={{ backgroundColor: role.color || '#5865F2' }}
          title={role.name}
        >
          {role.name}
        </span>
      ))}
      {overflow > 0 && (
        <span className={`inline-flex items-center rounded-full font-medium bg-[var(--card-border)] text-[var(--muted)] leading-none ${padding}`}>
          +{overflow}
        </span>
      )}
    </div>
  );
}
