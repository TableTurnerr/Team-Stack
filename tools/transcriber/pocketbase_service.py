"""
CRM-Tableturnerr PocketBase Service

Thin wrapper that imports from the shared SDK in packages/pocketbase-client.
This allows the transcriber to use the same client as other Python apps.
"""

import os
import re
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Add the shared SDK to path
SDK_PATH = Path(__file__).parent.parent.parent / "packages" / "pocketbase-client" / "src" / "python"
sys.path.insert(0, str(SDK_PATH))

# Re-export from shared SDK
from pocketbase_client import (
    CRMPocketBase,
    create_client,
    COLLECTIONS,
    # Type definitions
    Company,
    ColdCall,
    CallTranscript,
    CallLog,
    PhoneNumber,
    FollowUp,
    Interaction,
    EventLog,
    CompanyNote,
    Recording,
)

# Load environment variables
from dotenv import load_dotenv
load_dotenv()


def get_authenticated_client() -> CRMPocketBase:
    """
    Create and authenticate a PocketBase client using environment variables.
    
    Returns:
        CRMPocketBase: Authenticated client ready for API calls.
    """
    url = os.getenv('POCKETBASE_URL', 'http://localhost:8090')
    email = os.getenv('PB_ADMIN_EMAIL')
    password = os.getenv('PB_ADMIN_PASSWORD')
    
    if not email or not password:
        raise ValueError(
            "PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set in environment "
            "or .env file"
        )
    
    client = create_client(url)
    client.auth_as_admin(email, password)
    return client


def find_or_create_company(
    client: CRMPocketBase,
    company_name: str,
    phone_number: str = None,
    owner_name: str = None,
    location: str = None
) -> Company:
    """
    Find existing company by phone number or create a new one.
    
    Args:
        client: Authenticated PocketBase client
        company_name: Name of the company
        phone_number: Phone number to search by
        owner_name: Owner/decision maker name
        location: Company location
        
    Returns:
        Company: The found or created company record
    """
    # Try to find by phone number first
    if phone_number:
        existing = client.find_company_by_phone(phone_number)
        if existing:
            # Update with any new info
            updates = {}
            if owner_name and not existing.get('owner_name'):
                updates['owner_name'] = owner_name
            if location and not existing.get('company_location'):
                updates['company_location'] = location
            
            if updates:
                return client.update_company(existing['id'], updates)
            return existing
    
    # Create new company
    data = {
        'company_name': company_name,
        'source': 'Cold Call',
    }
    if phone_number:
        data['phone_numbers'] = phone_number
    if owner_name:
        data['owner_name'] = owner_name
    if location:
        data['company_location'] = location
    
    return client.create_company(data)


def create_cold_call_with_transcript(
    client: CRMPocketBase,
    company_id: str,
    transcript_text: str,
    analysis: dict,
    model_used: str = "gemini-2.5-flash"
) -> tuple[ColdCall, CallTranscript]:
    """
    Create a cold call record with its transcript.

    Args:
        client: Authenticated PocketBase client
        company_id: ID of the related company
        transcript_text: Full transcript text
        analysis: Dict with extracted call analysis data
        model_used: AI model used for transcription

    Returns:
        tuple: (ColdCall record, CallTranscript record)
    """
    # Create cold call record
    call_data = {
        'company': company_id,
        'recipients': analysis.get('recipients', ''),
        'call_outcome': analysis.get('call_outcome', 'Other'),
        'interest_level': analysis.get('interest_level', 5),
        'objections': analysis.get('objections', []),
        'pain_points': analysis.get('pain_points', []),
        'follow_up_actions': analysis.get('follow_up_actions', []),
        'call_summary': analysis.get('call_summary', ''),
        'call_duration_estimate': analysis.get('call_duration_estimate', ''),
        'model_used': model_used,
        'phone_number': analysis.get('phone_number', ''),
        'owner_name': analysis.get('owner_name', ''),
    }

    cold_call = client.create_cold_call(call_data)

    # Create transcript record linked to the call
    transcript_data = {
        'call': cold_call['id'],
        'transcript': transcript_text,
    }

    transcript = client.create_transcript(transcript_data)

    return cold_call, transcript


def find_or_create_phone_number(
    client: CRMPocketBase,
    company_id: str,
    phone_number: str,
    receptionist_name: str = None,
    location_name: str = None,
) -> PhoneNumber:
    """
    Find existing phone number record or create a new one.

    Args:
        client: Authenticated PocketBase client
        company_id: ID of the parent company
        phone_number: The phone number to find/create
        receptionist_name: Name of receptionist (updates record if found)
        location_name: Location/branch name

    Returns:
        PhoneNumber: The found or created phone number record
    """
    # Clean phone number - keep only digits
    clean_phone = re.sub(r'\D', '', phone_number) if phone_number else ''

    if not clean_phone:
        # Create a placeholder phone record
        return client.create_phone_number({
            'company': company_id,
            'phone_number': 'Unknown',
            'label': 'Main Line',
        })

    # Try to find existing phone number
    existing = client.find_phone_number(clean_phone)

    if existing:
        # Update with any new info
        updates = {}
        if receptionist_name and receptionist_name != existing.get('receptionist_name'):
            updates['receptionist_name'] = receptionist_name
        if location_name and not existing.get('location_name'):
            updates['location_name'] = location_name
        updates['last_called'] = datetime.utcnow().isoformat() + 'Z'

        return client.update_phone_number(existing['id'], updates)

    # Create new phone number record
    return client.create_phone_number({
        'company': company_id,
        'phone_number': clean_phone,
        'label': 'Main Line',
        'receptionist_name': receptionist_name,
        'location_name': location_name,
        'last_called': datetime.utcnow().isoformat() + 'Z',
    })


def create_call_log_with_transcript(
    client: CRMPocketBase,
    company_id: str,
    phone_number_record_id: str,
    transcript_text: str,
    analysis: dict,
    model_used: str = "gemini-2.5-flash"
) -> tuple[CallLog, CallTranscript, FollowUp | None]:
    """
    Create a call log record with its transcript and optional follow-up.

    This is the NEW workflow that replaces create_cold_call_with_transcript.

    Args:
        client: Authenticated PocketBase client
        company_id: ID of the related company
        phone_number_record_id: ID of the phone_numbers record
        transcript_text: Full transcript text
        analysis: Dict with extracted call analysis data
        model_used: AI model used for transcription

    Returns:
        tuple: (CallLog record, CallTranscript record, FollowUp record or None)
    """
    # Parse duration estimate to seconds if possible
    duration_seconds = None
    duration_str = analysis.get('call_duration_estimate', '')
    if duration_str:
        # Try to parse "X minutes Y seconds" format
        import re
        minutes_match = re.search(r'(\d+)\s*minute', duration_str, re.IGNORECASE)
        seconds_match = re.search(r'(\d+)\s*second', duration_str, re.IGNORECASE)
        minutes = int(minutes_match.group(1)) if minutes_match else 0
        seconds = int(seconds_match.group(1)) if seconds_match else 0
        if minutes or seconds:
            duration_seconds = minutes * 60 + seconds

    # Create call log record
    call_log_data = {
        'company': company_id,
        'phone_number_record': phone_number_record_id,
        'call_time': datetime.utcnow().isoformat() + 'Z',
        'duration': duration_seconds,
        'call_outcome': analysis.get('call_outcome', 'Other'),
        'owner_name_found': analysis.get('owner_name', ''),
        'receptionist_name': analysis.get('receptionist_name', ''),
        'post_call_notes': analysis.get('call_summary', ''),
        'interest_level': analysis.get('interest_level', 5),
        'has_recording': False,  # Will be updated if recording is linked
    }

    call_log = client.create_call_log(call_log_data)

    # Create transcript record linked to the call (reusing cold_calls transcript structure)
    transcript_data = {
        'call': call_log['id'],  # Note: This uses the call_transcripts collection which links to cold_calls
        'transcript': transcript_text,
    }

    transcript = client.create_transcript(transcript_data)

    # Create interaction record for unified timeline
    client.create_interaction({
        'company': company_id,
        'channel': 'phone',
        'direction': 'outbound',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'summary': analysis.get('call_summary', ''),
        'call_log': call_log['id'],
    })

    # Auto-create follow-up if callback outcome detected
    follow_up = None
    call_outcome = analysis.get('call_outcome', '').lower()
    follow_up_actions = analysis.get('follow_up_actions', [])
    callback_requested = analysis.get('callback_requested', False)

    if call_outcome == 'callback' or callback_requested or any('call' in action.lower() for action in follow_up_actions):
        # Schedule follow-up for next business day at 2 PM (default timezone America/New_York)
        tomorrow = datetime.utcnow() + timedelta(days=1)
        # Set to 2 PM in the default timezone
        follow_up_time = tomorrow.replace(hour=19, minute=0, second=0, microsecond=0)  # 7 PM UTC = 2 PM EST

        follow_up_notes = analysis.get('callback_notes', '')
        if not follow_up_notes and follow_up_actions:
            follow_up_notes = '; '.join(follow_up_actions)

        follow_up = client.create_follow_up({
            'call_log': call_log['id'],
            'company': company_id,
            'scheduled_time': follow_up_time.isoformat() + 'Z',
            'client_timezone': 'America/New_York',  # Default, can be updated later
            'notes': follow_up_notes,
            'status': 'pending',
        })

    return call_log, transcript, follow_up
