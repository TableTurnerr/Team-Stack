'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { usePermissions, ALL_PAGE_KEYS, PAGE_LABELS, PERMISSION_LABELS } from '@/contexts/role-permission-context';
import { pb } from '@/lib/pocketbase';
import { Role, User, COLLECTIONS, PageKey, RolePermissions, RoleDataAccess } from '@/lib/types';
import { PageGuard } from '@/components/page-guard';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  Plus,
  Trash2,
  GripVertical,
  Shield,
  Users,
  Eye,
  Settings,
  Database,
  Loader2,
  ChevronUp,
  ChevronDown,
  Search,
  X,
  Check,
  ShieldCheck,
  Palette,
} from 'lucide-react';

type Tab = 'display' | 'permissions' | 'members' | 'data-access';

const PRESET_COLORS = [
  '#5865F2', // Discord blurple
  '#57F287', // Green
  '#FEE75C', // Yellow
  '#EB459E', // Fuchsia
  '#ED4245', // Red
  '#FF7F32', // Orange
  '#3498DB', // Blue
  '#9B59B6', // Purple
  '#1ABC9C', // Teal
  '#E91E63', // Pink
  '#95A5A6', // Grey
  '#2ECC71', // Emerald
];

const DEFAULT_PAGE_ACCESS: Record<PageKey, boolean> = {
  'lead-submission': true,
  'pipeline': true,
  'overview': true,
  'cold-calls': true,
  'session': true,
  'recordings': true,
  'session-logs': true,
  'companies': true,
  'leads': true,
  'notes': true,
  'follow-ups': true,
  'email': false,
  'financial': false,
  'team': false,
  'recycle-bin': false,
  'settings': true,
  'roles': false,
};

const DEFAULT_PERMISSIONS: RolePermissions = {
  can_create_companies: true,
  can_edit_companies: true,
  can_delete_companies: false,
  can_manage_team: false,
  can_manage_roles: false,
  can_view_financial: false,
  can_export_data: false,
  can_bulk_actions: false,
  can_manage_email_campaigns: false,
  can_view_recordings: true,
  can_delete_recordings: false,
  can_manage_sessions: true,
  can_access_extension_leads_directly: false,
};

function RolesContent() {
  const { user } = useAuth();
  const { roles, refreshRoles, startPreview } = usePermissions();
  const { addToast } = useToast();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('display');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [companySearch, setCompanySearch] = useState('');
  const [companies, setCompanies] = useState<Array<{ id: string; company_name: string }>>([]);

  // Editable form state
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#5865F2');
  const [editPageAccess, setEditPageAccess] = useState<Record<PageKey, boolean>>(DEFAULT_PAGE_ACCESS);
  const [editPermissions, setEditPermissions] = useState<RolePermissions>(DEFAULT_PERMISSIONS);
  const [editMembers, setEditMembers] = useState<string[]>([]);
  const [editDataAccess, setEditDataAccess] = useState<RoleDataAccess>({ mode: 'all' });

  const selectedRole = roles.find(r => r.id === selectedRoleId) || null;

  const isRoleDirty = selectedRole ? (
    editName !== selectedRole.name ||
    editColor !== (selectedRole.color || '#5865F2') ||
    JSON.stringify(editPageAccess) !== JSON.stringify({ ...DEFAULT_PAGE_ACCESS, ...(selectedRole.page_access || {}) }) ||
    JSON.stringify(editPermissions) !== JSON.stringify({ ...DEFAULT_PERMISSIONS, ...(selectedRole.permissions || {}) }) ||
    JSON.stringify(editMembers) !== JSON.stringify(selectedRole.members || []) ||
    JSON.stringify(editDataAccess) !== JSON.stringify(selectedRole.data_access || { mode: 'all' })
  ) : false;

  // Fetch all users for member assignment
  useEffect(() => {
    pb.collection(COLLECTIONS.USERS).getFullList<User>({ sort: 'name' })
      .then(setAllUsers)
      .catch(() => {});
  }, []);

  // Fetch companies for data access assignment
  useEffect(() => {
    pb.collection(COLLECTIONS.COMPANIES).getFullList<any>({ sort: 'company_name', fields: 'id,company_name' })
      .then(setCompanies)
      .catch(() => {});
  }, []);

  // Load selected role into form
  useEffect(() => {
    if (selectedRole) {
      setEditName(selectedRole.name);
      setEditColor(selectedRole.color || '#5865F2');
      setEditPageAccess({ ...DEFAULT_PAGE_ACCESS, ...(selectedRole.page_access || {}) });
      setEditPermissions({ ...DEFAULT_PERMISSIONS, ...(selectedRole.permissions || {}) });
      setEditMembers(selectedRole.members || []);
      setEditDataAccess(selectedRole.data_access || { mode: 'all' });
    }
  }, [selectedRole]);

  const handleCreateRole = async () => {
    setIsCreating(true);
    try {
      const newRole = await pb.collection(COLLECTIONS.ROLES).create<Role>({
        name: 'New Role',
        color: PRESET_COLORS[roles.length % PRESET_COLORS.length],
        position: roles.length,
        is_default: false,
        members: [],
        page_access: DEFAULT_PAGE_ACCESS,
        permissions: DEFAULT_PERMISSIONS,
        data_access: { mode: 'all' },
        created_by: user?.id,
      });
      await refreshRoles();
      setSelectedRoleId(newRole.id);
      setActiveTab('display');
      addToast('success', 'Role created');
    } catch (error) {
      console.error('Failed to create role:', error);
      addToast('error', 'Failed to create role');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setIsSaving(true);
    try {
      await pb.collection(COLLECTIONS.ROLES).update(selectedRoleId, {
        name: editName,
        color: editColor,
        page_access: editPageAccess,
        permissions: editPermissions,
        members: editMembers,
        data_access: editDataAccess,
      });
      await refreshRoles();
      addToast('success', 'Role saved');
    } catch (error) {
      console.error('Failed to save role:', error);
      addToast('error', 'Failed to save role');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedRoleId) return;
    try {
      await pb.collection(COLLECTIONS.ROLES).delete(selectedRoleId);
      setSelectedRoleId(null);
      await refreshRoles();
      addToast('success', 'Role deleted');
    } catch (error) {
      console.error('Failed to delete role:', error);
      addToast('error', 'Failed to delete role');
    } finally {
      setShowDeleteModal(false);
    }
  };

  const handleMoveRole = async (roleId: string, direction: 'up' | 'down') => {
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= roles.length) return;

    try {
      await pb.collection(COLLECTIONS.ROLES).update(roles[idx].id, { position: swapIdx });
      await pb.collection(COLLECTIONS.ROLES).update(roles[swapIdx].id, { position: idx });
      await refreshRoles();
    } catch (error) {
      console.error('Failed to reorder roles:', error);
      addToast('error', 'Failed to reorder roles');
    }
  };

  const toggleMember = (userId: string) => {
    setEditMembers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const togglePageAccess = (key: PageKey) => {
    setEditPageAccess(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const togglePermission = (key: keyof RolePermissions) => {
    setEditPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAllPages = (value: boolean) => {
    const updated: Record<string, boolean> = {};
    ALL_PAGE_KEYS.forEach(k => { updated[k] = value; });
    setEditPageAccess(updated as Record<PageKey, boolean>);
  };

  const toggleAllPermissions = (value: boolean) => {
    const updated: RolePermissions = {};
    (Object.keys(PERMISSION_LABELS) as (keyof RolePermissions)[]).forEach(k => {
      (updated as any)[k] = value;
    });
    setEditPermissions(updated);
  };

  const filteredUsers = allUsers.filter(u => {
    if (!memberSearch) return true;
    const q = memberSearch.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  const filteredCompanies = companies.filter(c => {
    if (!companySearch) return true;
    return c.company_name?.toLowerCase().includes(companySearch.toLowerCase());
  });

  const toggleCompanyAssignment = (companyId: string) => {
    setEditDataAccess(prev => {
      const ids = prev.company_ids || [];
      const newIds = ids.includes(companyId) ? ids.filter(id => id !== companyId) : [...ids, companyId];
      return { mode: 'specific', company_ids: newIds };
    });
  };

  const tabs: { key: Tab; label: string; icon: React.ComponentType<any> }[] = [
    { key: 'display', label: 'Display', icon: Palette },
    { key: 'permissions', label: 'Permissions', icon: Shield },
    { key: 'members', label: 'Members', icon: Users },
    { key: 'data-access', label: 'Data Access', icon: Database },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles</h1>
          <p className="text-[var(--muted)] mt-1">
            Manage roles, permissions, and access control for your team
          </p>
        </div>
      </div>

      {/* Main layout: left role list, right role editor */}
      <div className="flex gap-6 min-h-[calc(100vh-220px)]">
        {/* ── Left panel: Role list ── */}
        <div className="w-64 shrink-0">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
            <div className="p-3 border-b border-[var(--card-border)] flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Roles ({roles.length})
              </span>
              <button
                onClick={handleCreateRole}
                disabled={isCreating}
                className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                title="Create new role"
              >
                {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              </button>
            </div>

            <div className="p-1.5 space-y-0.5 max-h-[calc(100vh-320px)] overflow-y-auto">
              {roles.map((role, idx) => (
                <div
                  key={role.id}
                  onClick={() => { setSelectedRoleId(role.id); setActiveTab('display'); }}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all',
                    selectedRoleId === role.id
                      ? 'bg-[var(--foreground)] text-[var(--background)]'
                      : 'hover:bg-[var(--card-hover)] text-[var(--foreground)]'
                  )}
                >
                  {/* Color dot */}
                  <div
                    className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/10"
                    style={{ backgroundColor: role.color || '#5865F2' }}
                  />
                  <span className="text-sm font-medium truncate flex-1">{role.name}</span>
                  <span className={cn(
                    'text-[10px] tabular-nums',
                    selectedRoleId === role.id ? 'text-[var(--background)]/60' : 'text-[var(--muted)]'
                  )}>
                    {role.members?.length || 0}
                  </span>

                  {/* Reorder buttons */}
                  <div className={cn(
                    'flex flex-col gap-0 opacity-0 group-hover:opacity-100 transition-opacity',
                    selectedRoleId === role.id && 'opacity-100'
                  )}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMoveRole(role.id, 'up'); }}
                      disabled={idx === 0}
                      className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronUp size={10} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMoveRole(role.id, 'down'); }}
                      disabled={idx === roles.length - 1}
                      className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronDown size={10} />
                    </button>
                  </div>
                </div>
              ))}

              {roles.length === 0 && (
                <div className="text-center py-8 text-sm text-[var(--muted)]">
                  No roles yet. Create one to get started.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right panel: Role editor ── */}
        <div className="flex-1 min-w-0">
          {!selectedRole ? (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl flex items-center justify-center min-h-[400px]">
              <div className="text-center space-y-3">
                <ShieldCheck size={48} className="mx-auto text-[var(--muted)]" />
                <p className="text-[var(--muted)]">Select a role to edit or create a new one</p>
                <button
                  onClick={handleCreateRole}
                  disabled={isCreating}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-primary"
                >
                  <Plus size={16} />
                  Create Role
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
              {/* Role header with color accent */}
              <div
                className="h-1.5 w-full"
                style={{ backgroundColor: editColor }}
              />

              {/* Tab bar */}
              <div className="flex items-center border-b border-[var(--card-border)] px-4">
                <div className="flex-1 flex gap-1">
                  {tabs.map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                          activeTab === tab.key
                            ? 'border-[var(--primary)] text-[var(--foreground)]'
                            : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
                        )}
                      >
                        <Icon size={16} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startPreview(selectedRole)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
                    title="Preview site as this role"
                  >
                    <Eye size={14} />
                    Preview
                  </button>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="p-1.5 rounded-lg text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                    title="Delete role"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Tab content */}
              <div className="p-6">
                {activeTab === 'display' && (
                  <DisplayTab
                    name={editName}
                    color={editColor}
                    onNameChange={setEditName}
                    onColorChange={setEditColor}
                    memberCount={editMembers.length}
                  />
                )}

                {activeTab === 'permissions' && (
                  <PermissionsTab
                    pageAccess={editPageAccess}
                    permissions={editPermissions}
                    onTogglePage={togglePageAccess}
                    onTogglePermission={togglePermission}
                    onToggleAllPages={toggleAllPages}
                    onToggleAllPermissions={toggleAllPermissions}
                  />
                )}

                {activeTab === 'members' && (
                  <MembersTab
                    members={editMembers}
                    allUsers={filteredUsers}
                    memberSearch={memberSearch}
                    onSearchChange={setMemberSearch}
                    onToggleMember={toggleMember}
                    roleColor={editColor}
                  />
                )}

                {activeTab === 'data-access' && (
                  <DataAccessTab
                    dataAccess={editDataAccess}
                    onDataAccessChange={setEditDataAccess}
                    companies={filteredCompanies}
                    companySearch={companySearch}
                    onCompanySearchChange={setCompanySearch}
                    onToggleCompany={toggleCompanyAssignment}
                  />
                )}
              </div>

              {/* Save bar */}
              <div className="border-t border-[var(--card-border)] px-6 py-3 flex items-center justify-end gap-3 bg-[var(--card-hover)]">
                <button
                  onClick={() => {
                    if (selectedRole) {
                      setEditName(selectedRole.name);
                      setEditColor(selectedRole.color || '#5865F2');
                      setEditPageAccess({ ...DEFAULT_PAGE_ACCESS, ...(selectedRole.page_access || {}) });
                      setEditPermissions({ ...DEFAULT_PERMISSIONS, ...(selectedRole.permissions || {}) });
                      setEditMembers(selectedRole.members || []);
                      setEditDataAccess(selectedRole.data_access || { mode: 'all' });
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-bg)] transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !editName.trim() || !isRoleDirty}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                    isRoleDirty && editName.trim() && !isSaving
                      ? "btn-primary cursor-pointer"
                      : "bg-[var(--card-hover)] text-[var(--muted)] border border-[var(--card-border)] cursor-not-allowed opacity-60"
                  )}
                >
                  {isSaving && <Loader2 size={14} className="animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Role"
        message={`Are you sure you want to delete "${selectedRole?.name}"? All members will lose the permissions granted by this role.`}
        confirmText="Delete Role"
        variant="danger"
      />
    </div>
  );
}

/* ─── Display Tab ─── */
function DisplayTab({
  name,
  color,
  onNameChange,
  onColorChange,
  memberCount,
}: {
  name: string;
  color: string;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  memberCount: number;
}) {
  return (
    <div className="space-y-8 max-w-lg">
      {/* Role Name */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Role Name</label>
        <input
          type="text"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          placeholder="e.g. Sales Manager"
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
        />
      </div>

      {/* Role Color */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Role Color</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className={cn(
                'w-8 h-8 rounded-full transition-all ring-offset-2 ring-offset-[var(--card-bg)]',
                color === c ? 'ring-2 ring-[var(--foreground)] scale-110' : 'hover:scale-105'
              )}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-[var(--muted)]">Custom:</label>
          <input
            type="color"
            value={color}
            onChange={e => onColorChange(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-none bg-transparent"
          />
          <input
            type="text"
            value={color}
            onChange={e => onColorChange(e.target.value)}
            className="w-24 px-2 py-1 text-xs font-mono rounded border border-[var(--card-border)] bg-[var(--background)]"
          />
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Preview</label>
        <div className="bg-[var(--card-hover)] rounded-lg p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: color }}>
            {name.charAt(0).toUpperCase() || 'R'}
          </div>
          <div>
            <span className="text-sm font-semibold" style={{ color }}>{name || 'Role Name'}</span>
            <p className="text-xs text-[var(--muted)]">{memberCount} member{memberCount !== 1 ? 's' : ''}</p>
          </div>
          <span
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            <Shield size={10} />
            {name || 'Role'}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Permissions Tab ─── */
function PermissionsTab({
  pageAccess,
  permissions,
  onTogglePage,
  onTogglePermission,
  onToggleAllPages,
  onToggleAllPermissions,
}: {
  pageAccess: Record<PageKey, boolean>;
  permissions: RolePermissions;
  onTogglePage: (key: PageKey) => void;
  onTogglePermission: (key: keyof RolePermissions) => void;
  onToggleAllPages: (v: boolean) => void;
  onToggleAllPermissions: (v: boolean) => void;
}) {
  const allPagesEnabled = ALL_PAGE_KEYS.every(k => pageAccess[k]);
  const allPermsEnabled = (Object.keys(PERMISSION_LABELS) as (keyof RolePermissions)[]).every(k => permissions[k]);

  return (
    <div className="space-y-8">
      {/* Page Access */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Page Access</h3>
            <p className="text-xs text-[var(--muted)]">Control which pages members with this role can access</p>
          </div>
          <button
            onClick={() => onToggleAllPages(!allPagesEnabled)}
            className="text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {allPagesEnabled ? 'Disable All' : 'Enable All'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ALL_PAGE_KEYS.map(key => (
            <div
              key={key}
              className={cn(
                'flex items-center justify-between px-4 py-3 rounded-lg border transition-colors',
                pageAccess[key]
                  ? 'border-[var(--primary)]/30 bg-[var(--primary-subtle)]'
                  : 'border-[var(--card-border)] bg-[var(--card-hover)]'
              )}
            >
              <span className="text-sm">{PAGE_LABELS[key]}</span>
              <ToggleSwitch
                checked={!!pageAccess[key]}
                onChange={() => onTogglePage(key)}
                size="sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Feature Permissions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Feature Permissions</h3>
            <p className="text-xs text-[var(--muted)]">Granular control over what actions this role can perform</p>
          </div>
          <button
            onClick={() => onToggleAllPermissions(!allPermsEnabled)}
            className="text-xs font-medium text-[var(--primary)] hover:underline"
          >
            {allPermsEnabled ? 'Disable All' : 'Enable All'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(Object.keys(PERMISSION_LABELS) as (keyof RolePermissions)[]).map(key => (
            <div
              key={key}
              className={cn(
                'flex items-center justify-between px-4 py-3 rounded-lg border transition-colors',
                permissions[key]
                  ? 'border-[var(--primary)]/30 bg-[var(--primary-subtle)]'
                  : 'border-[var(--card-border)] bg-[var(--card-hover)]'
              )}
            >
              <span className="text-sm">{PERMISSION_LABELS[key]}</span>
              <ToggleSwitch
                checked={!!permissions[key]}
                onChange={() => onTogglePermission(key)}
                size="sm"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Members Tab ─── */
function MembersTab({
  members,
  allUsers,
  memberSearch,
  onSearchChange,
  onToggleMember,
  roleColor,
}: {
  members: string[];
  allUsers: User[];
  memberSearch: string;
  onSearchChange: (v: string) => void;
  onToggleMember: (userId: string) => void;
  roleColor: string;
}) {
  const assignedUsers = allUsers.filter(u => members.includes(u.id));
  const unassignedUsers = allUsers.filter(u => !members.includes(u.id));

  return (
    <div className="space-y-6">
      {/* Assigned members */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          Members ({members.length})
        </h3>
        {assignedUsers.length === 0 ? (
          <p className="text-sm text-[var(--muted)] py-4 text-center">No members assigned to this role</p>
        ) : (
          <div className="space-y-1">
            {assignedUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--card-hover)]">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                  style={{ backgroundColor: roleColor }}
                >
                  {u.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-xs text-[var(--muted)] truncate">{u.email}</p>
                </div>
                <button
                  onClick={() => onToggleMember(u.id)}
                  className="p-1.5 rounded-lg text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                  title="Remove from role"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add members */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Add Members</h3>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            value={memberSearch}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border border-[var(--card-border)] p-1">
          {unassignedUsers.length === 0 ? (
            <p className="text-sm text-[var(--muted)] py-4 text-center">
              {memberSearch ? 'No matching users found' : 'All users are assigned'}
            </p>
          ) : (
            unassignedUsers.map(u => (
              <button
                key={u.id}
                onClick={() => onToggleMember(u.id)}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-[var(--card-border)] flex items-center justify-center text-xs font-medium">
                  {u.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-xs text-[var(--muted)] truncate">{u.email}</p>
                </div>
                <Plus size={14} className="text-[var(--muted)]" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Data Access Tab ─── */
function DataAccessTab({
  dataAccess,
  onDataAccessChange,
  companies,
  companySearch,
  onCompanySearchChange,
  onToggleCompany,
}: {
  dataAccess: RoleDataAccess;
  onDataAccessChange: (da: RoleDataAccess) => void;
  companies: Array<{ id: string; company_name: string }>;
  companySearch: string;
  onCompanySearchChange: (v: string) => void;
  onToggleCompany: (companyId: string) => void;
}) {
  const mode = dataAccess.mode || 'all';
  const assignedCompanyIds = dataAccess.company_ids || [];

  const modeDescriptions: Record<typeof mode, string> = {
    all: 'Members can see and interact with every company and lead in the CRM.',
    assigned: 'Members will only see companies and leads where they are listed as the assignee.',
    specific: 'Members can only see the hand-picked companies and leads listed below.',
    none: 'Members have no access to companies or leads.',
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Data Access</h3>
        <p className="text-xs text-[var(--muted)]">
          Control which companies and leads (same underlying records) members of this role can see
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['all', 'assigned', 'specific', 'none'] as const).map(m => (
          <button
            key={m}
            onClick={() => onDataAccessChange(
              m === 'specific'
                ? { mode: 'specific', company_ids: assignedCompanyIds }
                : { mode: m }
            )}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg border transition-colors capitalize',
              mode === m
                ? 'border-[var(--primary)] bg-[var(--primary-subtle)] text-[var(--primary)]'
                : 'border-[var(--card-border)] hover:bg-[var(--card-hover)]'
            )}
          >
            {m === 'all' ? 'All'
              : m === 'assigned' ? 'Only Assigned to User'
              : m === 'specific' ? 'Specific Companies'
              : 'No Access'}
          </button>
        ))}
      </div>

      <p className="text-xs text-[var(--muted)] italic">{modeDescriptions[mode]}</p>

      {mode === 'specific' && (
        <div className="space-y-3 pt-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={companySearch}
              onChange={e => onCompanySearchChange(e.target.value)}
              placeholder="Search companies..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          {assignedCompanyIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {assignedCompanyIds.map(id => {
                const c = companies.find(co => co.id === id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--primary-subtle)] text-[var(--primary)]"
                  >
                    {c?.company_name || id}
                    <button onClick={() => onToggleCompany(id)} className="hover:text-[var(--error)]">
                      <X size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto space-y-0.5 rounded-lg border border-[var(--card-border)] p-1">
            {companies.filter(c => !assignedCompanyIds.includes(c.id)).length === 0 ? (
              <p className="text-sm text-[var(--muted)] py-3 text-center">
                {companySearch ? 'No matching companies' : 'All companies assigned'}
              </p>
            ) : (
              companies
                .filter(c => !assignedCompanyIds.includes(c.id))
                .slice(0, 50)
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => onToggleCompany(c.id)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded hover:bg-[var(--card-hover)] transition-colors text-left"
                  >
                    <Plus size={12} className="text-[var(--muted)] shrink-0" />
                    <span className="truncate">{c.company_name}</span>
                  </button>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Page export with guard ─── */
export default function RolesPage() {
  return (
    <PageGuard pageKey="roles">
      <RolesContent />
    </PageGuard>
  );
}
