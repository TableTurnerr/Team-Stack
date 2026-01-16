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
