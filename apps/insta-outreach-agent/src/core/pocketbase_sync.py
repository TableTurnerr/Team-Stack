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

    def log_outreach_event(self, 
                           actor_username: str, 
                           target_username: str, 
                           event_type: str, 
                           details: str, 
                           message_text: Optional[str] = None):
        """
        Log an outreach event to PocketBase.
        1. Find/Create Lead (target)
        2. Find Actor (source)
        3. Create Event Log
        4. Create Outreach Log (if message)
        """
        if not self.pb.is_authenticated:
            self.connect()

        try:
            # 1. Handle Lead
            lead = self.pb.find_lead_by_username(target_username)
            if not lead:
                lead = self.pb.create_lead({
                    'username': target_username,
                    'status': 'Cold No Reply',
                    'source': 'instagram',
                    'first_contacted': datetime.utcnow().isoformat() + 'Z',
                    'last_updated': datetime.utcnow().isoformat() + 'Z'
                })
            else:
                self.pb.update_lead(lead['id'], {
                     'last_updated': datetime.utcnow().isoformat() + 'Z'
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
                'target': lead['id']
            }
            if actor_id:
                event_data['actor'] = actor_id
            
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
