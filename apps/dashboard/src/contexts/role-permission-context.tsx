'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { pb } from '@/lib/pocketbase';
import { useAuth } from '@/contexts/auth-context';
import { Role, COLLECTIONS, PageKey, RolePermissions, RoleDataAccess } from '@/lib/types';

// All page keys for the system
export const ALL_PAGE_KEYS: PageKey[] = [
  'overview',
  'cold-calls',
  'session',
  'recordings',
  'session-logs',
  'companies',
  'leads',
  'notes',
  'follow-ups',
  'email',
  'financial',
  'team',
  'recycle-bin',
  'settings',
  'roles',
];

// Human-readable labels for pages
export const PAGE_LABELS: Record<PageKey, string> = {
  'overview': 'Overview / Dashboard',
  'cold-calls': 'Cold Calls',
  'session': 'Call Session',
  'recordings': 'Recordings',
  'session-logs': 'Session Logs',
  'companies': 'Companies',
  'leads': 'Leads',
  'notes': 'Notes',
  'follow-ups': 'Follow-Ups',
  'email': 'Email Marketing',
  'financial': 'Financial Overview',
  'team': 'Team Overview',
  'recycle-bin': 'Recycle Bin',
  'settings': 'Settings',
  'roles': 'Role Management',
};

// Human-readable labels for permissions
export const PERMISSION_LABELS: Record<keyof RolePermissions, string> = {
  can_create_companies: 'Create Companies',
  can_edit_companies: 'Edit Companies',
  can_delete_companies: 'Delete Companies',
  can_manage_team: 'Manage Team Members',
  can_manage_roles: 'Manage Roles',
  can_view_financial: 'View Financial Data',
  can_export_data: 'Export Data',
  can_bulk_actions: 'Perform Bulk Actions',
  can_manage_email_campaigns: 'Manage Email Campaigns',
  can_view_recordings: 'View Call Recordings',
  can_delete_recordings: 'Delete Recordings',
  can_manage_sessions: 'Manage Call Sessions',
  can_access_extension_leads_directly: 'Access Extension Leads Directly (auto-claim on call)',
};

interface RolePermissionContextType {
  roles: Role[];
  userRoles: Role[];
  isLoading: boolean;
  // Permission checks
  canAccessPage: (pageKey: PageKey) => boolean;
  hasPermission: (permKey: keyof RolePermissions) => boolean;
  getDataAccess: () => RoleDataAccess;
  // Preview mode
  isPreviewMode: boolean;
  previewRole: Role | null;
  startPreview: (role: Role) => void;
  exitPreview: () => void;
  // Role management
  refreshRoles: () => Promise<void>;
}

const RolePermissionContext = createContext<RolePermissionContextType | undefined>(undefined);

export function RolePermissionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [userRoles, setUserRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewRole, setPreviewRole] = useState<Role | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const fetchedRef = useRef(false);

  const isAdmin = user?.role === 'admin';

  // Seed default roles if none exist (only called by admin users)
  const seedDefaultRoles = useCallback(async (adminUserId: string) => {
    // Fetch all users to auto-assign them
    let allUsers: { id: string; role: string }[] = [];
    try {
      allUsers = await pb.collection(COLLECTIONS.USERS).getFullList({ fields: 'id,role' });
    } catch { /* ignore */ }

    const adminIds = allUsers.filter(u => u.role === 'admin').map(u => u.id);
    const memberIds = allUsers.filter(u => u.role !== 'admin').map(u => u.id);

    const allPageAccess: Record<string, boolean> = {};
    ALL_PAGE_KEYS.forEach(k => { allPageAccess[k] = true; });

    const memberPageAccess: Record<string, boolean> = {
      overview: true, 'cold-calls': true, session: true, recordings: true,
      'session-logs': true, companies: true, leads: true, notes: true,
      'follow-ups': true, email: false, financial: false, team: false,
      'recycle-bin': false, settings: true, roles: false,
    };

    const allPerms: Record<string, boolean> = {};
    Object.keys(PERMISSION_LABELS).forEach(k => { allPerms[k] = true; });

    const memberPerms: Record<string, boolean> = {
      can_create_companies: true, can_edit_companies: true, can_delete_companies: false,
      can_manage_team: false, can_manage_roles: false, can_view_financial: false,
      can_export_data: false, can_bulk_actions: false, can_manage_email_campaigns: false,
      can_view_recordings: true, can_delete_recordings: false, can_manage_sessions: true,
      can_access_extension_leads_directly: false,
    };

    const managerPageAccess: Record<string, boolean> = {
      ...memberPageAccess, email: true, financial: true, team: true, 'recycle-bin': false,
    };
    const managerPerms: Record<string, boolean> = {
      ...memberPerms, can_export_data: true, can_bulk_actions: true,
      can_manage_email_campaigns: true, can_view_financial: true, can_delete_recordings: true,
      can_access_extension_leads_directly: true,
    };

    const defaults = [
      {
        name: 'Admin', color: '#ED4245', position: 0, is_default: false,
        members: adminIds, page_access: allPageAccess, permissions: allPerms,
        data_access: { mode: 'all' },
        created_by: adminUserId,
      },
      {
        name: 'Manager', color: '#FEE75C', position: 1, is_default: false,
        members: [] as string[], page_access: managerPageAccess, permissions: managerPerms,
        data_access: { mode: 'all' },
        created_by: adminUserId,
      },
      {
        name: 'Member', color: '#57F287', position: 2, is_default: true,
        members: memberIds, page_access: memberPageAccess, permissions: memberPerms,
        data_access: { mode: 'assigned' },
        created_by: adminUserId,
      },
    ];

    for (const role of defaults) {
      try {
        await pb.collection(COLLECTIONS.ROLES).create(role);
      } catch { /* might already exist from a race — ignore */ }
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    if (!user?.id) {
      setRoles([]);
      setUserRoles([]);
      setIsLoading(false);
      return;
    }

    try {
      let allRoles = await pb.collection(COLLECTIONS.ROLES).getFullList<Role>({
        sort: 'position',
      });

      // First-time setup: seed default roles if none exist (admin only)
      if (allRoles.length === 0 && user.role === 'admin') {
        await seedDefaultRoles(user.id);
        allRoles = await pb.collection(COLLECTIONS.ROLES).getFullList<Role>({ sort: 'position' });
      }

      setRoles(allRoles);

      // Find roles where current user is a member
      const myRoles = allRoles.filter(r => r.members?.includes(user.id));
      setUserRoles(myRoles);
    } catch (error) {
      console.error('Failed to fetch roles:', error);
      setRoles([]);
      setUserRoles([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, user?.role, seedDefaultRoles]);

  useEffect(() => {
    if (user?.id && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchRoles();
    } else if (!user?.id) {
      fetchedRef.current = false;
      setRoles([]);
      setUserRoles([]);
      setIsLoading(false);
    }
  }, [user?.id, fetchRoles]);

  // Subscribe to role changes for real-time updates
  useEffect(() => {
    if (!user?.id) return;

    const unsubscribe = pb.collection(COLLECTIONS.ROLES).subscribe('*', () => {
      fetchRoles();
    });

    return () => {
      unsubscribe.then(unsub => {
        if (typeof unsub === 'function') unsub();
      }).catch(() => {});
      pb.collection(COLLECTIONS.ROLES).unsubscribe('*').catch(() => {});
    };
  }, [user?.id, fetchRoles]);

  // Compute effective permissions from all user roles (union of all role permissions)
  const getEffectivePageAccess = useCallback((): Record<PageKey, boolean> => {
    // If previewing, use only the preview role's access
    if (isPreviewMode && previewRole) {
      return previewRole.page_access || {} as Record<PageKey, boolean>;
    }

    // Admins have full access to everything
    if (isAdmin) {
      const fullAccess: Record<string, boolean> = {};
      ALL_PAGE_KEYS.forEach(k => { fullAccess[k] = true; });
      return fullAccess as Record<PageKey, boolean>;
    }

    // Union of all role page accesses
    const access: Record<string, boolean> = {};
    for (const role of userRoles) {
      if (role.page_access) {
        for (const [key, val] of Object.entries(role.page_access)) {
          if (val) access[key] = true;
        }
      }
    }

    // Fallback: if roles are still loading or user has no roles assigned,
    // grant sensible default access so the user isn't completely locked out
    if (userRoles.length === 0) {
      // Basic default access — same as "Member" role
      const defaults: PageKey[] = ['overview', 'cold-calls', 'session', 'recordings', 'session-logs', 'companies', 'leads', 'notes', 'follow-ups'];
      defaults.forEach(k => { access[k] = true; });
    }

    // Everyone can always access settings
    access['settings'] = true;

    return access as Record<PageKey, boolean>;
  }, [isAdmin, userRoles, isPreviewMode, previewRole]);

  const getEffectivePermissions = useCallback((): RolePermissions => {
    if (isPreviewMode && previewRole) {
      return previewRole.permissions || {};
    }

    if (isAdmin) {
      const full: RolePermissions = {};
      (Object.keys(PERMISSION_LABELS) as (keyof RolePermissions)[]).forEach(k => {
        (full as any)[k] = true;
      });
      return full;
    }

    // Union of all role permissions
    const perms: RolePermissions = {};
    for (const role of userRoles) {
      if (role.permissions) {
        for (const [key, val] of Object.entries(role.permissions)) {
          if (val) (perms as any)[key] = true;
        }
      }
    }
    return perms;
  }, [isAdmin, userRoles, isPreviewMode, previewRole]);

  const canAccessPage = useCallback((pageKey: PageKey): boolean => {
    const access = getEffectivePageAccess();
    return !!access[pageKey];
  }, [getEffectivePageAccess]);

  const hasPermission = useCallback((permKey: keyof RolePermissions): boolean => {
    const perms = getEffectivePermissions();
    return !!perms[permKey];
  }, [getEffectivePermissions]);

  const getDataAccess = useCallback((): RoleDataAccess => {
    if (isPreviewMode && previewRole) {
      return previewRole.data_access || { mode: 'none' };
    }

    if (isAdmin) {
      return { mode: 'all' };
    }

    // Merge across roles: 'all' wins, then 'specific' (union of IDs), then 'assigned', then 'none'
    let bestMode: 'specific' | 'assigned' | 'none' = 'none';
    const ids = new Set<string>();

    for (const role of userRoles) {
      const da = role.data_access;
      if (!da?.mode) continue;

      if (da.mode === 'all') {
        return { mode: 'all' };
      }
      if (da.mode === 'specific') {
        bestMode = 'specific';
        (da.company_ids || []).forEach(id => ids.add(id));
      } else if (da.mode === 'assigned' && bestMode !== 'specific') {
        bestMode = 'assigned';
      }
    }

    if (bestMode === 'specific') {
      return { mode: 'specific', company_ids: [...ids] };
    }
    return { mode: bestMode };
  }, [isAdmin, userRoles, isPreviewMode, previewRole]);

  const startPreview = useCallback((role: Role) => {
    if (!isAdmin) return; // Only admins can preview
    setPreviewRole(role);
    setIsPreviewMode(true);
  }, [isAdmin]);

  const exitPreview = useCallback(() => {
    setPreviewRole(null);
    setIsPreviewMode(false);
  }, []);

  const refreshRoles = useCallback(async () => {
    await fetchRoles();
  }, [fetchRoles]);

  return (
    <RolePermissionContext.Provider
      value={{
        roles,
        userRoles,
        isLoading,
        canAccessPage,
        hasPermission,
        getDataAccess,
        isPreviewMode,
        previewRole,
        startPreview,
        exitPreview,
        refreshRoles,
      }}
    >
      {children}
    </RolePermissionContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(RolePermissionContext);
  if (context === undefined) {
    throw new Error('usePermissions must be used within a RolePermissionProvider');
  }
  return context;
}

/** Safe version that returns null outside provider */
export function usePermissionsOptional() {
  return useContext(RolePermissionContext) ?? null;
}
