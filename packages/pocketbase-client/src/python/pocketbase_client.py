"""
CRM-Tableturnerr PocketBase Python Client

Shared SDK wrapper for Python applications (transcriber, insta-outreach-agent).
Uses httpx for HTTP requests to PocketBase API.
"""

import os
import httpx
from typing import Optional, Dict, List, Any, TypedDict
from datetime import datetime


# ============================================================================
# Type Definitions
# ============================================================================

class User(TypedDict, total=False):
    id: str
    name: str
    email: str
    role: str  # 'admin' | 'operator' | 'member'
    status: str  # 'online' | 'offline' | 'suspended'
    last_activity: Optional[str]
    created: str
    updated: str


class Company(TypedDict, total=False):
    id: str
    company_name: str
    owner_name: Optional[str]
    company_location: Optional[str]
    google_maps_link: Optional[str]
    phone_numbers: Optional[str]
    source: str  # 'cold_call' | 'manual'
    created: str
    updated: str


class ColdCall(TypedDict, total=False):
    id: str
    company: Optional[str]  # Relation ID
    caller_name: Optional[str]
    recipients: Optional[str]
    call_outcome: Optional[str]
    interest_level: Optional[int]
    objections: Optional[List[str]]
    pain_points: Optional[List[str]]
    follow_up_actions: Optional[List[str]]
    call_summary: Optional[str]
    call_duration_estimate: Optional[str]
    model_used: Optional[str]
    phone_number: Optional[str]
    owner_name: Optional[str]
    claimed_by: Optional[str]
    created: str
    updated: str


class CallTranscript(TypedDict, total=False):
    id: str
    call: str  # Relation ID to cold_calls
    transcript: str
    created: str


class Lead(TypedDict, total=False):
    id: str
    username: str
    status: str
    first_contacted: Optional[str]
    last_updated: Optional[str]
    notes: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    contact_source: Optional[str]
    source: str  # 'instagram' | 'cold_call'
    created: str
    updated: str


class EventLog(TypedDict, total=False):
    id: str
    event_type: str
    actor: Optional[str]
    user: Optional[str]
    target: Optional[str]
    cold_call: Optional[str]
    details: Optional[str]
    source: str  # 'instagram' | 'cold_call'
    created: str


class OutreachLog(TypedDict, total=False):
    id: str
    event: str  # Relation ID
    message_text: Optional[str]
    sent_at: Optional[str]
    created: str


class Goal(TypedDict, total=False):
    id: str
    metric: str
    target_value: int
    frequency: str
    assigned_to_user: Optional[str]
    assigned_to_actor: Optional[str]
    status: str
    suggested_by: Optional[str]
    start_date: Optional[str]
    end_date: Optional[str]
    created: str


class Rule(TypedDict, total=False):
    id: str
    type: str
    metric: str
    limit_value: int
    time_window_sec: int
    severity: Optional[str]
    assigned_to_user: Optional[str]
    assigned_to_actor: Optional[str]
    status: str
    suggested_by: Optional[str]
    created: str


class PhoneNumber(TypedDict, total=False):
    id: str
    company: str  # Relation ID
    phone_number: str
    label: Optional[str]
    location_name: Optional[str]
    location_address: Optional[str]
    receptionist_name: Optional[str]
    last_called: Optional[str]
    created: str
    updated: str


class CallLog(TypedDict, total=False):
    id: str
    company: str  # Relation ID
    phone_number_record: str  # Relation ID
    caller: Optional[str]  # Relation ID
    call_time: str
    duration: Optional[int]
    call_outcome: Optional[str]
    owner_name_found: Optional[str]
    receptionist_name: Optional[str]
    post_call_notes: Optional[str]
    interest_level: Optional[int]
    status_changed_to: Optional[str]
    has_recording: bool
    created: str
    updated: str


class FollowUp(TypedDict, total=False):
    id: str
    call_log: Optional[str]  # Relation ID
    company: str  # Relation ID
    scheduled_time: str
    client_timezone: str
    assigned_to: Optional[str]  # Relation ID
    notes: Optional[str]
    status: str  # 'pending' | 'completed' | 'dismissed'
    completed_at: Optional[str]
    created: str
    updated: str


class CompanyNote(TypedDict, total=False):
    id: str
    company: str  # Relation ID
    phone_number_record: Optional[str]  # Relation ID
    note_type: str  # 'pre_call' | 'research' | 'general'
    content: str
    created_by: str  # Relation ID
    created: str
    updated: str


class Interaction(TypedDict, total=False):
    id: str
    company: str  # Relation ID
    channel: str  # 'phone' | 'instagram' | 'email'
    direction: str  # 'outbound' | 'inbound'
    timestamp: str
    user: Optional[str]  # Relation ID
    summary: Optional[str]
    call_log: Optional[str]  # Relation ID
    created: str
    updated: str


class Recording(TypedDict, total=False):
    id: str
    phone_number: Optional[str]
    uploader: Optional[str]  # Relation ID
    file: Optional[str]
    note: Optional[str]
    recording_date: Optional[str]
    duration: Optional[int]
    call_log: Optional[str]  # Relation ID
    company: Optional[str]  # Relation ID
    phone_number_record: Optional[str]  # Relation ID
    created: str
    updated: str


# ============================================================================
# Collection Names
# ============================================================================

COLLECTIONS = {
    'USERS': 'users',
    'COMPANIES': 'companies',
    'LEADS': 'leads',
    'INSTA_ACTORS': 'insta_actors',
    'COLD_CALLS': 'cold_calls',
    'CALL_TRANSCRIPTS': 'call_transcripts',
    'EVENT_LOGS': 'event_logs',
    'OUTREACH_LOGS': 'outreach_logs',
    'GOALS': 'goals',
    'RULES': 'rules',
    'ALERTS': 'alerts',
    'NOTES': 'notes',
    # New CRM collections
    'PHONE_NUMBERS': 'phone_numbers',
    'CALL_LOGS': 'call_logs',
    'FOLLOW_UPS': 'follow_ups',
    'COMPANY_NOTES': 'company_notes',
    'INTERACTIONS': 'interactions',
    'RECORDINGS': 'recordings',
}


# ============================================================================
# PocketBase Client
# ============================================================================

class CRMPocketBase:
    """
    PocketBase client for CRM-Tableturnerr Python applications.
    """

    def __init__(self, url: Optional[str] = None):
        self.url = url or os.getenv('POCKETBASE_URL', 'http://localhost:8090')
        self.token: Optional[str] = None
        self.user: Optional[User] = None
        self._client = httpx.Client(timeout=30.0)

    def _headers(self) -> Dict[str, str]:
        """Get request headers with auth token if available."""
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = self.token
        return headers

    def _get(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        """Make GET request to PocketBase API."""
        response = self._client.get(
            f"{self.url}/api{endpoint}",
            headers=self._headers(),
            params=params
        )
        response.raise_for_status()
        return response.json()

    def _post(self, endpoint: str, data: Dict) -> Any:
        """Make POST request to PocketBase API."""
        response = self._client.post(
            f"{self.url}/api{endpoint}",
            headers=self._headers(),
            json=data
        )
        response.raise_for_status()
        return response.json()

    def _patch(self, endpoint: str, data: Dict) -> Any:
        """Make PATCH request to PocketBase API."""
        response = self._client.patch(
            f"{self.url}/api{endpoint}",
            headers=self._headers(),
            json=data
        )
        response.raise_for_status()
        return response.json()

    def _delete(self, endpoint: str) -> bool:
        """Make DELETE request to PocketBase API."""
        response = self._client.delete(
            f"{self.url}/api{endpoint}",
            headers=self._headers()
        )
        response.raise_for_status()
        return True

    # -------------------------------------------------------------------------
    # Authentication
    # -------------------------------------------------------------------------

    def auth_as_admin(self, email: str, password: str) -> None:
        """Authenticate as admin for server-side operations."""
        result = self._post('/admins/auth-with-password', {
            'identity': email,
            'password': password
        })
        self.token = result['token']

    def auth_with_password(self, email: str, password: str) -> User:
        """Authenticate user with email/password."""
        result = self._post(f'/collections/{COLLECTIONS["USERS"]}/auth-with-password', {
            'identity': email,
            'password': password
        })
        self.token = result['token']
        self.user = result['record']
        return self.user

    def logout(self) -> None:
        """Clear authentication."""
        self.token = None
        self.user = None

    @property
    def is_authenticated(self) -> bool:
        """Check if client is authenticated."""
        return self.token is not None

    # -------------------------------------------------------------------------
    # Companies
    # -------------------------------------------------------------------------

    def get_companies(self, filter_str: Optional[str] = None) -> List[Company]:
        """Get all companies."""
        params = {}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["COMPANIES"]}/records', params)
        return result.get('items', [])

    def get_company(self, id: str) -> Company:
        """Get company by ID."""
        return self._get(f'/collections/{COLLECTIONS["COMPANIES"]}/records/{id}')

    def find_company_by_phone(self, phone: str) -> Optional[Company]:
        """Find company by phone number."""
        result = self._get(f'/collections/{COLLECTIONS["COMPANIES"]}/records', {
            'filter': f'phone_numbers ~ "{phone}"'
        })
        items = result.get('items', [])
        return items[0] if items else None

    def create_company(self, data: Dict) -> Company:
        """Create new company."""
        return self._post(f'/collections/{COLLECTIONS["COMPANIES"]}/records', data)

    def update_company(self, id: str, data: Dict) -> Company:
        """Update company."""
        return self._patch(f'/collections/{COLLECTIONS["COMPANIES"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Cold Calls
    # -------------------------------------------------------------------------

    def get_cold_calls(self, filter_str: Optional[str] = None, sort: str = '-created') -> List[ColdCall]:
        """Get cold calls."""
        params = {'sort': sort}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["COLD_CALLS"]}/records', params)
        return result.get('items', [])

    def get_cold_call(self, id: str, expand: Optional[str] = None) -> ColdCall:
        """Get cold call by ID."""
        params = {}
        if expand:
            params['expand'] = expand
        return self._get(f'/collections/{COLLECTIONS["COLD_CALLS"]}/records/{id}', params)

    def create_cold_call(self, data: Dict) -> ColdCall:
        """Create new cold call."""
        return self._post(f'/collections/{COLLECTIONS["COLD_CALLS"]}/records', data)

    def update_cold_call(self, id: str, data: Dict) -> ColdCall:
        """Update cold call."""
        return self._patch(f'/collections/{COLLECTIONS["COLD_CALLS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Call Transcripts
    # -------------------------------------------------------------------------

    def get_transcript_for_call(self, call_id: str) -> Optional[CallTranscript]:
        """Get transcript for a specific call."""
        result = self._get(f'/collections/{COLLECTIONS["CALL_TRANSCRIPTS"]}/records', {
            'filter': f'call = "{call_id}"'
        })
        items = result.get('items', [])
        return items[0] if items else None

    def create_transcript(self, data: Dict) -> CallTranscript:
        """Create new transcript."""
        return self._post(f'/collections/{COLLECTIONS["CALL_TRANSCRIPTS"]}/records', data)

    # -------------------------------------------------------------------------
    # Leads
    # -------------------------------------------------------------------------

    def get_leads(self, filter_str: Optional[str] = None, sort: str = '-last_updated') -> List[Lead]:
        """Get leads."""
        params = {'sort': sort}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["LEADS"]}/records', params)
        return result.get('items', [])

    def find_lead_by_username(self, username: str) -> Optional[Lead]:
        """Find lead by username."""
        result = self._get(f'/collections/{COLLECTIONS["LEADS"]}/records', {
            'filter': f'username = "{username}"'
        })
        items = result.get('items', [])
        return items[0] if items else None

    def create_lead(self, data: Dict) -> Lead:
        """Create new lead."""
        return self._post(f'/collections/{COLLECTIONS["LEADS"]}/records', data)

    def update_lead(self, id: str, data: Dict) -> Lead:
        """Update lead."""
        return self._patch(f'/collections/{COLLECTIONS["LEADS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Event Logs
    # -------------------------------------------------------------------------

    def get_event_logs(self, filter_str: Optional[str] = None, limit: int = 100) -> List[EventLog]:
        """Get event logs."""
        params = {'sort': '-created', 'perPage': limit}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["EVENT_LOGS"]}/records', params)
        return result.get('items', [])

    def create_event_log(self, data: Dict) -> EventLog:
        """Create new event log."""
        return self._post(f'/collections/{COLLECTIONS["EVENT_LOGS"]}/records', data)

    # -------------------------------------------------------------------------
    # Outreach Logs
    # -------------------------------------------------------------------------

    def create_outreach_log(self, data: Dict) -> OutreachLog:
        """Create new outreach log."""
        return self._post(f'/collections/{COLLECTIONS["OUTREACH_LOGS"]}/records', data)

    # -------------------------------------------------------------------------
    # Goals
    # -------------------------------------------------------------------------

    def get_goals(self, filter_str: Optional[str] = None) -> List[Goal]:
        """Get goals."""
        params = {}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["GOALS"]}/records', params)
        return result.get('items', [])

    def get_active_goals(self) -> List[Goal]:
        """Get active goals."""
        return self.get_goals('status = "Active"')

    def create_goal(self, data: Dict) -> Goal:
        """Create new goal."""
        return self._post(f'/collections/{COLLECTIONS["GOALS"]}/records', data)

    def update_goal(self, id: str, data: Dict) -> Goal:
        """Update goal."""
        return self._patch(f'/collections/{COLLECTIONS["GOALS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Rules
    # -------------------------------------------------------------------------

    def get_rules(self, filter_str: Optional[str] = None) -> List[Rule]:
        """Get rules."""
        params = {}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["RULES"]}/records', params)
        return result.get('items', [])

    def get_active_rules(self) -> List[Rule]:
        """Get active rules."""
        return self.get_rules('status = "Active"')

    def create_rule(self, data: Dict) -> Rule:
        """Create new rule."""
        return self._post(f'/collections/{COLLECTIONS["RULES"]}/records', data)

    def update_rule(self, id: str, data: Dict) -> Rule:
        """Update rule."""
        return self._patch(f'/collections/{COLLECTIONS["RULES"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Users
    # -------------------------------------------------------------------------

    def get_users(self) -> List[User]:
        """Get all users."""
        result = self._get(f'/collections/{COLLECTIONS["USERS"]}/records', {'sort': 'name'})
        return result.get('items', [])

    def get_user_by_email(self, email: str) -> Optional[User]:
        """Find user by email."""
        result = self._get(f'/collections/{COLLECTIONS["USERS"]}/records', {
            'filter': f'email = "{email}"'
        })
        items = result.get('items', [])
        return items[0] if items else None

    def update_user_activity(self, id: str) -> User:
        """Update user's last activity timestamp."""
        return self._patch(f'/collections/{COLLECTIONS["USERS"]}/records/{id}', {
            'last_activity': datetime.utcnow().isoformat() + 'Z',
            'status': 'online'
        })

    # -------------------------------------------------------------------------
    # Phone Numbers
    # -------------------------------------------------------------------------

    def get_phone_numbers(self, filter_str: Optional[str] = None) -> List[PhoneNumber]:
        """Get phone numbers."""
        params = {}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["PHONE_NUMBERS"]}/records', params)
        return result.get('items', [])

    def find_phone_number(self, phone: str) -> Optional[PhoneNumber]:
        """Find phone number record by phone number."""
        result = self._get(f'/collections/{COLLECTIONS["PHONE_NUMBERS"]}/records', {
            'filter': f'phone_number ~ "{phone}"'
        })
        items = result.get('items', [])
        return items[0] if items else None

    def create_phone_number(self, data: Dict) -> PhoneNumber:
        """Create new phone number record."""
        return self._post(f'/collections/{COLLECTIONS["PHONE_NUMBERS"]}/records', data)

    def update_phone_number(self, id: str, data: Dict) -> PhoneNumber:
        """Update phone number record."""
        return self._patch(f'/collections/{COLLECTIONS["PHONE_NUMBERS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Call Logs
    # -------------------------------------------------------------------------

    def get_call_logs(self, filter_str: Optional[str] = None, sort: str = '-created') -> List[CallLog]:
        """Get call logs."""
        params = {'sort': sort}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["CALL_LOGS"]}/records', params)
        return result.get('items', [])

    def get_call_log(self, id: str, expand: Optional[str] = None) -> CallLog:
        """Get call log by ID."""
        params = {}
        if expand:
            params['expand'] = expand
        return self._get(f'/collections/{COLLECTIONS["CALL_LOGS"]}/records/{id}', params)

    def create_call_log(self, data: Dict) -> CallLog:
        """Create new call log."""
        return self._post(f'/collections/{COLLECTIONS["CALL_LOGS"]}/records', data)

    def update_call_log(self, id: str, data: Dict) -> CallLog:
        """Update call log."""
        return self._patch(f'/collections/{COLLECTIONS["CALL_LOGS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Follow Ups
    # -------------------------------------------------------------------------

    def get_follow_ups(self, filter_str: Optional[str] = None, sort: str = 'scheduled_time') -> List[FollowUp]:
        """Get follow ups."""
        params = {'sort': sort}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["FOLLOW_UPS"]}/records', params)
        return result.get('items', [])

    def get_pending_follow_ups(self) -> List[FollowUp]:
        """Get pending follow ups."""
        return self.get_follow_ups('status = "pending"')

    def create_follow_up(self, data: Dict) -> FollowUp:
        """Create new follow up."""
        return self._post(f'/collections/{COLLECTIONS["FOLLOW_UPS"]}/records', data)

    def update_follow_up(self, id: str, data: Dict) -> FollowUp:
        """Update follow up."""
        return self._patch(f'/collections/{COLLECTIONS["FOLLOW_UPS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Company Notes
    # -------------------------------------------------------------------------

    def get_company_notes(self, company_id: str) -> List[CompanyNote]:
        """Get notes for a company."""
        return self._get(f'/collections/{COLLECTIONS["COMPANY_NOTES"]}/records', {
            'filter': f'company = "{company_id}"',
            'sort': '-created'
        }).get('items', [])

    def create_company_note(self, data: Dict) -> CompanyNote:
        """Create new company note."""
        return self._post(f'/collections/{COLLECTIONS["COMPANY_NOTES"]}/records', data)

    # -------------------------------------------------------------------------
    # Interactions
    # -------------------------------------------------------------------------

    def get_interactions(self, filter_str: Optional[str] = None, sort: str = '-timestamp') -> List[Interaction]:
        """Get interactions."""
        params = {'sort': sort}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["INTERACTIONS"]}/records', params)
        return result.get('items', [])

    def create_interaction(self, data: Dict) -> Interaction:
        """Create new interaction."""
        return self._post(f'/collections/{COLLECTIONS["INTERACTIONS"]}/records', data)

    # -------------------------------------------------------------------------
    # Recordings
    # -------------------------------------------------------------------------

    def get_recordings(self, filter_str: Optional[str] = None, sort: str = '-created') -> List[Recording]:
        """Get recordings."""
        params = {'sort': sort}
        if filter_str:
            params['filter'] = filter_str
        result = self._get(f'/collections/{COLLECTIONS["RECORDINGS"]}/records', params)
        return result.get('items', [])

    def update_recording(self, id: str, data: Dict) -> Recording:
        """Update recording."""
        return self._patch(f'/collections/{COLLECTIONS["RECORDINGS"]}/records/{id}', data)

    # -------------------------------------------------------------------------
    # Cleanup
    # -------------------------------------------------------------------------

    def close(self) -> None:
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# ============================================================================
# Convenience function
# ============================================================================

def create_client(url: Optional[str] = None) -> CRMPocketBase:
    """Create a new PocketBase client instance."""
    return CRMPocketBase(url)
