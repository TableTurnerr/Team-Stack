import os
import logging
from datetime import datetime
from typing import Optional, Dict, Any
from .pocketbase_client import CRMPocketBase, COLLECTIONS

class PocketBaseSync:
    def __init__(self):
        self.pb = CRMPocketBase()
        self.logger = logging.getLogger(__name__)

    def connect(self):
        email = os.getenv('PB_ADMIN_EMAIL')
        password = os.getenv('PB_ADMIN_PASSWORD')
        if email and password:
            try:
                self.pb.auth_as_admin(email, password)
                self.logger.info("Connected to PocketBase as admin")
            except Exception as e:
                self.logger.error(f"Failed to connect to PocketBase: {e}")
        else:
            self.logger.warning("No admin credentials found in environment")

    def find_or_create_company_by_instagram(self, username: str) -> Dict[str, Any]:
        """Find company by instagram_handle or create new one"""
        # Search for existing company using filter
        companies = self.pb.get_companies(filter_str=f'instagram_handle = "{username}"')

        if companies:
            return companies[0]

        # Create new company with Instagram as source
        return self.pb.create_company({
            'instagram_handle': username,
            'source': 'instagram',
            'status': 'Cold No Reply',
            'first_contacted': datetime.utcnow().isoformat() + 'Z',
            'last_contacted': datetime.utcnow().isoformat() + 'Z'
        })

    def log_outreach_event(self, 
                           actor_username: str, 
                           target_username: str, 
                           event_type: str, 
                           details: str, 
                           message_text: Optional[str] = None):
        """
        Log an outreach event to PocketBase.
        1. Find/Create Company (was Lead)
        2. Find Actor (source)
        3. Create Event Log
        4. Create Outreach Log (if message)
        """
        if not self.pb.is_authenticated:
            self.connect()

        try:
            # 1. Handle Company (Unification of Leads)
            company = self.find_or_create_company_by_instagram(target_username)
            if company:
                # Update last_contacted
                self.pb.update_company(company['id'], {
                     'last_contacted': datetime.utcnow().isoformat() + 'Z'
                })

            # 2. Handle Actor
            actor_id = None
            try:
                 # Direct API call since client doesn't have specific actor methods yet
                 result = self.pb._get(f'/collections/{COLLECTIONS["INSTA_ACTORS"]}/records', {
                    'filter': f'username = "{actor_username}"'
                })
                 if result.get('items'):
                     actor_id = result['items'][0]['id']
                     # Update actor activity
                     self.pb._patch(f'/collections/{COLLECTIONS["INSTA_ACTORS"]}/records/{actor_id}', {
                         'last_activity': datetime.utcnow().isoformat() + 'Z'
                     })
            except Exception as e:
                self.logger.error(f"Error finding/updating actor {actor_username}: {e}")

            # 3. Create Event Log
            event_data = {
                'event_type': event_type,
                'details': details,
                'source': 'instagram',
                'company': company['id'] if company else None, # Changed from target
                'actor': actor_id
            }
            
            event = self.pb.create_event_log(event_data)

            # 4. Create Outreach Log
            if message_text:
                self.pb.create_outreach_log({
                    'event': event['id'],
                    'message_text': message_text,
                    'sent_at': datetime.utcnow().isoformat() + 'Z'
                })
                
            return event

        except Exception as e:
            self.logger.error(f"Error logging outreach event: {e}")
            raise e
