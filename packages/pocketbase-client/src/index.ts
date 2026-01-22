/**
 * CRM-Tableturnerr PocketBase Client
 * 
 * Shared SDK wrapper for both TypeScript (dashboard) and Python (agents) applications.
 */

import PocketBase, { RecordModel, ListResult, RecordListOptions, RecordOptions } from 'pocketbase';

// ============================================================================
// Type Definitions
// ============================================================================

export interface User extends RecordModel {
    name: string;
    email: string;
    role: 'admin' | 'operator' | 'member';
    status: 'online' | 'offline' | 'suspended';
    last_activity?: string;
}

export interface Company extends RecordModel {
    company_name: string;
    owner_name?: string;
    company_location?: string;
    google_maps_link?: string;
    phone_numbers?: string;
    source: 'cold_call' | 'manual' | 'instagram'; // Updated source types

    // NEW fields merged from leads
    instagram_handle?: string;
    email?: string;
    status?: 'Cold No Reply' | 'Replied' | 'Warm' | 'Booked' | 'Paid' | 'Client' | 'Excluded';
    first_contacted?: string;
    last_contacted?: string;
    notes?: string;
    contact_source?: string;
}

/** @deprecated Use Company instead. */
export interface Lead extends RecordModel {
    username: string;
    status: 'Cold No Reply' | 'Replied' | 'Warm' | 'Booked' | 'Paid' | 'Client' | 'Excluded';
    first_contacted?: string;
    last_updated?: string;
    notes?: string;
    email?: string;
    phone?: string;
    contact_source?: string;
    source: 'instagram' | 'cold_call';
}

export interface InstaActor extends RecordModel {
    username: string;
    owner: string; // Relation to users
    status: 'Active' | 'Suspended By Team' | 'Suspended By Insta' | 'Discarded';
    last_activity?: string;
    expand?: {
        owner?: User;
    };
}

export interface ColdCall extends RecordModel {
    company?: string; // Relation to companies
    caller_name?: string;
    recipients?: string;
    call_outcome?: 'Interested' | 'Not Interested' | 'Callback' | 'No Answer' | 'Wrong Number' | 'Other';
    interest_level?: number;
    objections?: string[]; // JSON array
    pain_points?: string[]; // JSON array
    follow_up_actions?: string[]; // JSON array
    call_summary?: string;
    call_duration_estimate?: string;
    model_used?: string;
    phone_number?: string;
    owner_name?: string;
    claimed_by?: string; // Relation to users
    expand?: {
        company?: Company;
        claimed_by?: User;
    };
}

export interface CallTranscript extends RecordModel {
    call: string; // Relation to cold_calls
    transcript: string;
    expand?: {
        call?: ColdCall;
    };
}

export interface EventLog extends RecordModel {
    event_type: 'Outreach' | 'Change in Tar Info' | 'Tar Exception Toggle' | 'User' | 'System' | 'Cold Call';
    actor?: string; // Relation to insta_actors
    user?: string; // Relation to users
    company?: string; // NEW: Relation to companies
    target?: string; // DEPRECATED: Relation to leads
    cold_call?: string; // Relation to cold_calls
    details?: string;
    source: 'instagram' | 'cold_call';
    expand?: {
        actor?: InstaActor;
        user?: User;
        company?: Company; // NEW
        target?: Lead; // DEPRECATED
        cold_call?: ColdCall;
    };
}

export interface OutreachLog extends RecordModel {
    event: string; // Relation to event_logs
    message_text?: string;
    sent_at?: string;
    expand?: {
        event?: EventLog;
    };
}

export interface Goal extends RecordModel {
    metric: 'Total Messages Sent' | 'Unique Profiles Contacted' | 'Replies Received' | 'Warm Leads Generated' | 'Bookings Made' | 'Payments Received' | 'Calls Made' | 'Calls Transcribed';
    target_value: number;
    frequency: 'Daily' | 'Weekly' | 'Monthly';
    assigned_to_user?: string;
    assigned_to_actor?: string;
    status: 'Active' | 'Pending Suggestion' | 'Rejected' | 'Archived';
    suggested_by?: string;
    start_date?: string;
    end_date?: string;
    expand?: {
        assigned_to_user?: User;
        assigned_to_actor?: InstaActor;
        suggested_by?: User;
    };
}

export interface Rule extends RecordModel {
    type: 'Frequency Cap' | 'Interval Spacing';
    metric: 'Total Messages Sent' | 'Unique Profiles Contacted' | 'Calls Made';
    limit_value: number;
    time_window_sec: number;
    severity?: string;
    assigned_to_user?: string;
    assigned_to_actor?: string;
    status: 'Active' | 'Pending Suggestion' | 'Rejected' | 'Archived';
    suggested_by?: string;
    expand?: {
        assigned_to_user?: User;
        assigned_to_actor?: InstaActor;
        suggested_by?: User;
    };
}

export interface Alert extends RecordModel {
    created_by: string;
    target_user: string;
    entity_type: 'cold_call' | 'lead' | 'goal';
    entity_id?: string;
    entity_label?: string;
    alert_time?: string;
    message?: string;
    is_dismissed: boolean;
    expand?: {
        created_by?: User;
        target_user?: User;
    };
}

export interface Note extends RecordModel {
    title: string;
    note_text: string;
    created_by: string;
    last_edited_by?: string;
    is_archived: boolean;
    is_deleted: boolean;
    deleted_at?: string;
    expand?: {
        created_by?: User;
        last_edited_by?: User;
    };
}

// ============================================================================
// Collection Names Constants
// ============================================================================

export const COLLECTIONS = {
    USERS: 'users',
    COMPANIES: 'companies',
    LEADS: 'leads',
    INSTA_ACTORS: 'insta_actors',
    COLD_CALLS: 'cold_calls',
    CALL_TRANSCRIPTS: 'call_transcripts',
    EVENT_LOGS: 'event_logs',
    OUTREACH_LOGS: 'outreach_logs',
    GOALS: 'goals',
    RULES: 'rules',
    ALERTS: 'alerts',
    NOTES: 'notes',
} as const;

// ============================================================================
// PocketBase Client Wrapper
// ============================================================================

export class CRMPocketBase {
    private pb: PocketBase;

    constructor(url?: string) {
        this.pb = new PocketBase(url || process.env.POCKETBASE_URL || 'http://localhost:8090');
    }

    /**
     * Get the underlying PocketBase instance
     */
    get client(): PocketBase {
        return this.pb;
    }

    /**
     * Check if user is authenticated
     */
    get isAuthenticated(): boolean {
        return this.pb.authStore.isValid;
    }

    /**
     * Get current user
     */
    get currentUser(): User | null {
        return this.pb.authStore.model as User | null;
    }

    /**
     * Authenticate with admin credentials (for server-side operations)
     */
    async authAsAdmin(email: string, password: string): Promise<void> {
        await this.pb.admins.authWithPassword(email, password);
    }

    /**
     * Authenticate user with email/password
     */
    async authWithPassword(email: string, password: string): Promise<User> {
        const result = await this.pb.collection(COLLECTIONS.USERS).authWithPassword(email, password);
        return result.record as User;
    }

    /**
     * Authenticate with OAuth2 provider
     */
    async authWithOAuth2(provider: string): Promise<User> {
        const result = await this.pb.collection(COLLECTIONS.USERS).authWithOAuth2({ provider });
        return result.record as User;
    }

    /**
     * Logout current user
     */
    logout(): void {
        this.pb.authStore.clear();
    }

    // ---------------------------------------------------------------------------
    // Companies
    // ---------------------------------------------------------------------------

    async getCompanies(options?: RecordListOptions): Promise<Company[]> {
        return await this.pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>(options);
    }

    async getCompany(id: string, options?: RecordOptions): Promise<Company> {
        return await this.pb.collection(COLLECTIONS.COMPANIES).getOne<Company>(id, options);
    }

    async findCompanyByPhone(phone: string): Promise<Company | null> {
        try {
            return await this.pb.collection(COLLECTIONS.COMPANIES).getFirstListItem<Company>(
                `phone_numbers ~ "${phone}"`
            );
        } catch {
            return null;
        }
    }

    async createCompany(data: Partial<Company>): Promise<Company> {
        return await this.pb.collection(COLLECTIONS.COMPANIES).create<Company>(data);
    }

    async updateCompany(id: string, data: Partial<Company>): Promise<Company> {
        return await this.pb.collection(COLLECTIONS.COMPANIES).update<Company>(id, data);
    }

    async getCompanyInteractionHistory(companyId: string): Promise<EventLog[]> {
        const result = await this.pb.collection(COLLECTIONS.EVENT_LOGS).getList<EventLog>(1, 100, {
            filter: `company = "${companyId}"`,
            sort: '-created',
            expand: 'actor,user,cold_call'
        });
        return result.items;
    }

    // ---------------------------------------------------------------------------
    // Cold Calls
    // ---------------------------------------------------------------------------

    async getColdCalls(options?: RecordListOptions): Promise<ColdCall[]> {
        return await this.pb.collection(COLLECTIONS.COLD_CALLS).getFullList<ColdCall>({
            sort: '-created',
            ...options,
        });
    }

    async getColdCall(id: string, options?: RecordOptions): Promise<ColdCall> {
        return await this.pb.collection(COLLECTIONS.COLD_CALLS).getOne<ColdCall>(id, options);
    }

    async createColdCall(data: Partial<ColdCall>): Promise<ColdCall> {
        return await this.pb.collection(COLLECTIONS.COLD_CALLS).create<ColdCall>(data);
    }

    async updateColdCall(id: string, data: Partial<ColdCall>): Promise<ColdCall> {
        return await this.pb.collection(COLLECTIONS.COLD_CALLS).update<ColdCall>(id, data);
    }

    // ---------------------------------------------------------------------------
    // Call Transcripts
    // ---------------------------------------------------------------------------

    async getTranscriptForCall(callId: string): Promise<CallTranscript | null> {
        try {
            return await this.pb.collection(COLLECTIONS.CALL_TRANSCRIPTS).getFirstListItem<CallTranscript>(
                `call = "${callId}"`
            );
        } catch {
            return null;
        }
    }

    async createTranscript(data: Partial<CallTranscript>): Promise<CallTranscript> {
        return await this.pb.collection(COLLECTIONS.CALL_TRANSCRIPTS).create<CallTranscript>(data);
    }

    // ---------------------------------------------------------------------------
    // Leads
    // ---------------------------------------------------------------------------

    async getLeads(options?: RecordListOptions): Promise<Lead[]> {
        return await this.pb.collection(COLLECTIONS.LEADS).getFullList<Lead>({
            sort: '-last_updated',
            ...options,
        });
    }

    async getLead(id: string): Promise<Lead> {
        return await this.pb.collection(COLLECTIONS.LEADS).getOne<Lead>(id);
    }

    async findLeadByUsername(username: string): Promise<Lead | null> {
        try {
            return await this.pb.collection(COLLECTIONS.LEADS).getFirstListItem<Lead>(
                `username = "${username}"`
            );
        } catch {
            return null;
        }
    }

    async createLead(data: Partial<Lead>): Promise<Lead> {
        return await this.pb.collection(COLLECTIONS.LEADS).create<Lead>(data);
    }

    async updateLead(id: string, data: Partial<Lead>): Promise<Lead> {
        return await this.pb.collection(COLLECTIONS.LEADS).update<Lead>(id, data);
    }

    // ---------------------------------------------------------------------------
    // Instagram Actors
    // ---------------------------------------------------------------------------

    async getInstaActors(options?: RecordListOptions): Promise<InstaActor[]> {
        return await this.pb.collection(COLLECTIONS.INSTA_ACTORS).getFullList<InstaActor>({
            expand: 'owner',
            ...options,
        });
    }

    async createInstaActor(data: Partial<InstaActor>): Promise<InstaActor> {
        return await this.pb.collection(COLLECTIONS.INSTA_ACTORS).create<InstaActor>(data);
    }

    async updateInstaActor(id: string, data: Partial<InstaActor>): Promise<InstaActor> {
        return await this.pb.collection(COLLECTIONS.INSTA_ACTORS).update<InstaActor>(id, data);
    }

    // ---------------------------------------------------------------------------
    // Event Logs
    // ---------------------------------------------------------------------------

    async getEventLogs(options?: RecordListOptions): Promise<ListResult<EventLog>> {
        return await this.pb.collection(COLLECTIONS.EVENT_LOGS).getList<EventLog>(1, 100, {
            sort: '-created',
            ...options,
        });
    }

    async createEventLog(data: Partial<EventLog>): Promise<EventLog> {
        return await this.pb.collection(COLLECTIONS.EVENT_LOGS).create<EventLog>(data);
    }

    // ---------------------------------------------------------------------------
    // Outreach Logs
    // ---------------------------------------------------------------------------

    async createOutreachLog(data: Partial<OutreachLog>): Promise<OutreachLog> {
        return await this.pb.collection(COLLECTIONS.OUTREACH_LOGS).create<OutreachLog>(data);
    }

    // ---------------------------------------------------------------------------
    // Goals
    // ---------------------------------------------------------------------------

    async getGoals(options?: RecordListOptions): Promise<Goal[]> {
        return await this.pb.collection(COLLECTIONS.GOALS).getFullList<Goal>(options);
    }

    async getActiveGoals(): Promise<Goal[]> {
        return await this.pb.collection(COLLECTIONS.GOALS).getFullList<Goal>({
            filter: 'status = "Active"',
        });
    }

    async createGoal(data: Partial<Goal>): Promise<Goal> {
        return await this.pb.collection(COLLECTIONS.GOALS).create<Goal>(data);
    }

    async updateGoal(id: string, data: Partial<Goal>): Promise<Goal> {
        return await this.pb.collection(COLLECTIONS.GOALS).update<Goal>(id, data);
    }

    // ---------------------------------------------------------------------------
    // Rules
    // ---------------------------------------------------------------------------

    async getRules(options?: RecordListOptions): Promise<Rule[]> {
        return await this.pb.collection(COLLECTIONS.RULES).getFullList<Rule>(options);
    }

    async getActiveRules(): Promise<Rule[]> {
        return await this.pb.collection(COLLECTIONS.RULES).getFullList<Rule>({
            filter: 'status = "Active"',
        });
    }

    async createRule(data: Partial<Rule>): Promise<Rule> {
        return await this.pb.collection(COLLECTIONS.RULES).create<Rule>(data);
    }

    async updateRule(id: string, data: Partial<Rule>): Promise<Rule> {
        return await this.pb.collection(COLLECTIONS.RULES).update<Rule>(id, data);
    }

    // ---------------------------------------------------------------------------
    // Alerts
    // ---------------------------------------------------------------------------

    async getAlerts(options?: RecordListOptions): Promise<Alert[]> {
        return await this.pb.collection(COLLECTIONS.ALERTS).getFullList<Alert>({
            expand: 'created_by,target_user',
            sort: '-alert_time',
            ...options,
        });
    }

    async getActiveAlerts(userId: string): Promise<Alert[]> {
        return await this.pb.collection(COLLECTIONS.ALERTS).getFullList<Alert>({
            filter: `target_user = "${userId}" && is_dismissed = false`,
            expand: 'created_by',
            sort: 'alert_time',
        });
    }

    async createAlert(data: Partial<Alert>): Promise<Alert> {
        return await this.pb.collection(COLLECTIONS.ALERTS).create<Alert>(data);
    }

    async dismissAlert(id: string): Promise<Alert> {
        return await this.pb.collection(COLLECTIONS.ALERTS).update<Alert>(id, { is_dismissed: true });
    }

    // ---------------------------------------------------------------------------
    // Notes
    // ---------------------------------------------------------------------------

    async getNotes(options?: RecordListOptions): Promise<Note[]> {
        return await this.pb.collection(COLLECTIONS.NOTES).getFullList<Note>({
            filter: 'is_deleted = false',
            expand: 'created_by,last_edited_by',
            sort: '-updated',
            ...options,
        });
    }

    async getArchivedNotes(): Promise<Note[]> {
        return await this.pb.collection(COLLECTIONS.NOTES).getFullList<Note>({
            filter: 'is_archived = true && is_deleted = false',
            expand: 'created_by',
        });
    }

    async getDeletedNotes(): Promise<Note[]> {
        return await this.pb.collection(COLLECTIONS.NOTES).getFullList<Note>({
            filter: 'is_deleted = true',
            expand: 'created_by',
        });
    }

    async createNote(data: Partial<Note>): Promise<Note> {
        return await this.pb.collection(COLLECTIONS.NOTES).create<Note>({
            ...data,
            is_archived: false,
            is_deleted: false,
        });
    }

    async updateNote(id: string, data: Partial<Note>): Promise<Note> {
        return await this.pb.collection(COLLECTIONS.NOTES).update<Note>(id, data);
    }

    async archiveNote(id: string): Promise<Note> {
        return await this.pb.collection(COLLECTIONS.NOTES).update<Note>(id, { is_archived: true });
    }

    async unarchiveNote(id: string): Promise<Note> {
        return await this.pb.collection(COLLECTIONS.NOTES).update<Note>(id, { is_archived: false });
    }

    async deleteNote(id: string): Promise<Note> {
        return await this.pb.collection(COLLECTIONS.NOTES).update<Note>(id, {
            is_deleted: true,
            deleted_at: new Date().toISOString(),
        });
    }

    async restoreNote(id: string): Promise<Note> {
        return await this.pb.collection(COLLECTIONS.NOTES).update<Note>(id, {
            is_deleted: false,
            deleted_at: null,
        });
    }

    async permanentlyDeleteNote(id: string): Promise<boolean> {
        return await this.pb.collection(COLLECTIONS.NOTES).delete(id);
    }

    // ---------------------------------------------------------------------------
    // Users
    // ---------------------------------------------------------------------------

    async getUsers(): Promise<User[]> {
        return await this.pb.collection(COLLECTIONS.USERS).getFullList<User>({
            sort: 'name',
        });
    }

    async getUser(id: string): Promise<User> {
        return await this.pb.collection(COLLECTIONS.USERS).getOne<User>(id);
    }

    async getUserByEmail(email: string): Promise<User | null> {
        try {
            return await this.pb.collection(COLLECTIONS.USERS).getFirstListItem<User>(
                `email = "${email}"`
            );
        } catch {
            return null;
        }
    }

    async updateUserActivity(id: string): Promise<User> {
        return await this.pb.collection(COLLECTIONS.USERS).update<User>(id, {
            last_activity: new Date().toISOString(),
            status: 'online',
        });
    }

    // ---------------------------------------------------------------------------
    // Real-time Subscriptions
    // ---------------------------------------------------------------------------

    subscribeToCollection<T>(
        collection: string,
        callback: (event: { action: 'create' | 'update' | 'delete'; record: T }) => void
    ): () => void {
        this.pb.collection(collection).subscribe('*', (data) => {
            callback({
                action: data.action as 'create' | 'update' | 'delete',
                record: data.record as T
            });
        });
        return () => this.pb.collection(collection).unsubscribe('*');
    }

    unsubscribeAll(): void {
        this.pb.realtime.unsubscribe();
    }
}

// ============================================================================
// Default Export
// ============================================================================

const defaultClient = new CRMPocketBase();

export default defaultClient;
export { PocketBase };
