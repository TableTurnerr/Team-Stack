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
