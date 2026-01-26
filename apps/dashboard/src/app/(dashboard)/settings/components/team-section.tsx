'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { User, COLLECTIONS } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { Loader2, UserPlus, Shield, ShieldAlert, ShieldCheck, MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_STYLES: Record<string, { bg: string; text: string; icon: typeof ShieldCheck }> = {
    admin: { bg: 'bg-[var(--primary-subtle)]', text: 'text-[var(--primary)]', icon: ShieldCheck },
    operator: { bg: 'bg-[var(--warning-subtle)]', text: 'text-[var(--warning)]', icon: ShieldAlert },
    member: { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]', icon: Shield },
};

const STATUS_STYLES = {
    online: { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
    offline: { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
    suspended: { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
};

export function TeamSection() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const [members, setMembers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionUserId, setActionUserId] = useState<string | null>(null);
    const [showRoleModal, setShowRoleModal] = useState(false);
    const [showSuspendModal, setShowSuspendModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [newRole, setNewRole] = useState<'admin' | 'member'>('member');

    const fetchMembers = async () => {
        try {
            const records = await pb.collection(COLLECTIONS.USERS).getFullList<User>({
                sort: '-created',
            });
            setMembers(records);
        } catch (error) {
            console.error('Failed to fetch team members:', error);
            addToast('error', 'Failed to load team members');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchMembers();
    }, []);

    const handleRoleChange = async () => {
        if (!selectedUser) return;

        setActionUserId(selectedUser.id);
        try {
            await pb.collection(COLLECTIONS.USERS).update(selectedUser.id, { role: newRole });
            setMembers(prev => prev.map(m => m.id === selectedUser.id ? { ...m, role: newRole } : m));
            addToast('success', `Changed ${selectedUser.name}'s role to ${newRole}`);
        } catch (error) {
            console.error('Failed to change role:', error);
            addToast('error', 'Failed to change role');
        } finally {
            setActionUserId(null);
            setShowRoleModal(false);
            setSelectedUser(null);
        }
    };

    const handleSuspendToggle = async () => {
        if (!selectedUser) return;

        const newStatus = selectedUser.status === 'suspended' ? 'offline' : 'suspended';
        setActionUserId(selectedUser.id);

        try {
            await pb.collection(COLLECTIONS.USERS).update(selectedUser.id, { status: newStatus });
            setMembers(prev => prev.map(m => m.id === selectedUser.id ? { ...m, status: newStatus } : m));
            addToast('success', newStatus === 'suspended' ? `Suspended ${selectedUser.name}` : `Reactivated ${selectedUser.name}`);
        } catch (error) {
            console.error('Failed to update status:', error);
            addToast('error', 'Failed to update user status');
        } finally {
            setActionUserId(null);
            setShowSuspendModal(false);
            setSelectedUser(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--muted)]" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">Team Management</h2>
                    <p className="text-sm text-[var(--muted)] mt-1">
                        Manage team members and their roles
                    </p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg btn-primary">
                    <UserPlus size={16} />
                    Invite Member
                </button>
            </div>

            {/* Permissions Matrix */}
            <div className="bg-[var(--card-hover)] rounded-lg p-4 text-sm">
                <h4 className="font-medium mb-3">Role Permissions</h4>
                <div className="grid grid-cols-4 gap-2 text-xs">
                    <div className="font-medium text-[var(--muted)]">Permission</div>
                    <div className="font-medium text-center">Admin</div>
                    <div className="font-medium text-center">Member</div>
                    <div></div>

                    <div>View all companies</div>
                    <div className="text-center text-[var(--success)]">✓</div>
                    <div className="text-center text-[var(--success)]">✓</div>
                    <div></div>

                    <div>Edit companies</div>
                    <div className="text-center text-[var(--success)]">✓</div>
                    <div className="text-center text-[var(--success)]">✓</div>
                    <div></div>

                    <div>Delete companies</div>
                    <div className="text-center text-[var(--success)]">✓</div>
                    <div className="text-center text-[var(--error)]">✗</div>
                    <div></div>

                    <div>Manage team</div>
                    <div className="text-center text-[var(--success)]">✓</div>
                    <div className="text-center text-[var(--error)]">✗</div>
                    <div></div>
                </div>
            </div>

            {/* Members List */}
            <div className="border border-[var(--card-border)] rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-[var(--table-header)]">
                        <tr>
                            <th className="text-left px-4 py-3 font-medium">Member</th>
                            <th className="text-left px-4 py-3 font-medium">Role</th>
                            <th className="text-left px-4 py-3 font-medium">Status</th>
                            <th className="text-right px-4 py-3 font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--table-border)]">
                        {members.map((member) => {
                            const roleStyle = ROLE_STYLES[member.role] || ROLE_STYLES.member;
                            const statusStyle = STATUS_STYLES[member.status] || STATUS_STYLES.offline;
                            const RoleIcon = roleStyle.icon;
                            const isCurrentUser = member.id === user?.id;
                            const isLoading = actionUserId === member.id;

                            return (
                                <tr key={member.id} className="hover:bg-[var(--table-row-hover)]">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-xs font-medium">
                                                {member.name?.charAt(0).toUpperCase() || 'U'}
                                            </div>
                                            <div>
                                                <p className="font-medium">{member.name}</p>
                                                <p className="text-xs text-[var(--muted)]">{member.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', roleStyle.bg, roleStyle.text)}>
                                            <RoleIcon size={12} />
                                            {member.role || 'Member'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize', statusStyle.bg, statusStyle.text)}>
                                            {member.status || 'offline'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {!isCurrentUser && (
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => {
                                                        setSelectedUser(member);
                                                        setNewRole(member.role === 'admin' ? 'member' : 'admin');
                                                        setShowRoleModal(true);
                                                    }}
                                                    disabled={isLoading}
                                                    className="px-2 py-1 text-xs rounded btn-ghost border border-[var(--card-border)]"
                                                >
                                                    Change Role
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setSelectedUser(member);
                                                        setShowSuspendModal(true);
                                                    }}
                                                    disabled={isLoading}
                                                    className={cn(
                                                        'px-2 py-1 text-xs rounded border',
                                                        member.status === 'suspended'
                                                            ? 'btn-ghost border-[var(--card-border)]'
                                                            : 'text-[var(--error)] border-[var(--error)] hover:bg-[var(--error-subtle)]'
                                                    )}
                                                >
                                                    {member.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                                                </button>
                                            </div>
                                        )}
                                        {isCurrentUser && (
                                            <span className="text-xs text-[var(--muted)]">You</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Role Change Modal */}
            <ConfirmationModal
                isOpen={showRoleModal}
                onClose={() => { setShowRoleModal(false); setSelectedUser(null); }}
                onConfirm={handleRoleChange}
                title="Change Role"
                message={`Are you sure you want to change ${selectedUser?.name}'s role to ${newRole}?`}
                confirmText="Change Role"
                variant="warning"
                isLoading={!!actionUserId}
            />

            {/* Suspend Modal */}
            <ConfirmationModal
                isOpen={showSuspendModal}
                onClose={() => { setShowSuspendModal(false); setSelectedUser(null); }}
                onConfirm={handleSuspendToggle}
                title={selectedUser?.status === 'suspended' ? 'Reactivate User' : 'Suspend User'}
                message={selectedUser?.status === 'suspended'
                    ? `Are you sure you want to reactivate ${selectedUser?.name}? They will regain access to the platform.`
                    : `Are you sure you want to suspend ${selectedUser?.name}? They will be unable to access the platform.`
                }
                confirmText={selectedUser?.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                variant={selectedUser?.status === 'suspended' ? 'default' : 'danger'}
                isLoading={!!actionUserId}
            />
        </div>
    );
}
