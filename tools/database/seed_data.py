#!/usr/bin/env python3
"""
CRM-Tableturnerr: Seed Sample Data

Populates PocketBase with sample data for testing and development.
Run this after importing the schema via PocketBase Admin UI.

Usage:
    python seed_data.py          # Create sample data
    python seed_data.py --clean  # Remove previously created sample data

Prerequisites:
    1. PocketBase running at configured URL
    2. Schema imported (pb_schema.json via Admin UI)
    3. Admin credentials in .env or environment
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Set

import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
POCKETBASE_URL = os.getenv('POCKETBASE_URL', 'http://127.0.0.1:8090')
PB_ADMIN_EMAIL = os.getenv('PB_ADMIN_EMAIL', '')
PB_ADMIN_PASSWORD = os.getenv('PB_ADMIN_PASSWORD', '')

# Path for the seed log file
CurrentDir = os.path.dirname(os.path.abspath(__file__))
SEED_LOG_FILE = os.path.join(CurrentDir, 'seed_log.json')


class PocketBaseSeeder:
    """Seed PocketBase with sample data."""
    
    def __init__(self):
        self.url = POCKETBASE_URL
        self.client = httpx.Client(timeout=30.0)
        self.token = None
        self.id_maps: Dict[str, Dict[str, str]] = {}
        # Track created records by collection
        self.seeded_records: Dict[str, List[str]] = {}
        
    def authenticate(self, email: str, password: str):
        """Authenticate as admin (superuser)."""
        print(f"🔑 Authenticating with PocketBase at {self.url}...")
        try:
            # PocketBase 0.8+ uses _superusers collection for admin auth
            response = self.client.post(
                f"{self.url}/api/collections/_superusers/auth-with-password",
                json={'identity': email, 'password': password}
            )
            response.raise_for_status()
            self.token = response.json()['token']
            print("   ✓ Authenticated successfully")
        except Exception as e:
            print(f"   ✗ Authentication failed: {e}")
            raise
    
    def _headers(self) -> Dict[str, str]:
        return {
            'Content-Type': 'application/json',
            'Authorization': self.token
        }
    
    def create_record(self, collection: str, data: dict) -> dict:
        """Create a record in PocketBase."""
        response = self.client.post(
            f"{self.url}/api/collections/{collection}/records",
            headers=self._headers(),
            json=data
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            print(f"Error creating record in {collection}: {e.response.text}")
            raise

        rec = response.json()
        
        # Track ID
        if collection not in self.seeded_records:
            self.seeded_records[collection] = []
        self.seeded_records[collection].append(rec['id'])
        
        return rec
    
    def delete_record(self, collection: str, record_id: str):
        """Delete a record from PocketBase."""
        try:
            response = self.client.delete(
                f"{self.url}/api/collections/{collection}/records/{record_id}",
                headers=self._headers()
            )
            # 204 No Content is success, 404 means already gone
            if response.status_code == 404:
                return  # Already deleted
            response.raise_for_status()
            print(f"   ✓ Deleted {collection}/{record_id}")
        except Exception as e:
            print(f"   ✗ Failed to delete {collection}/{record_id}: {e}")

    def save_seed_log(self):
        """Save seeded record IDs to log file."""
        existing_data = {}
        if os.path.exists(SEED_LOG_FILE):
            try:
                with open(SEED_LOG_FILE, 'r') as f:
                    existing_data = json.load(f)
            except Exception:
                pass  # Ignore read errors
        
        # Merge new records into existing data
        for col, ids in self.seeded_records.items():
            if col not in existing_data:
                existing_data[col] = []
            # Add only unique new IDs
            existing_set = set(existing_data[col])
            for new_id in ids:
                if new_id not in existing_set:
                    existing_data[col].append(new_id)

        try:
            with open(SEED_LOG_FILE, 'w') as f:
                json.dump(existing_data, f, indent=2)
            print(f"\n📄 Saved record IDs to {SEED_LOG_FILE}")
        except Exception as e:
            print(f"\n⚠️ Failed to save seed log: {e}")

    def cleanup_seeded_data(self):
        """Remove previously seeded data using the log file."""
        if not os.path.exists(SEED_LOG_FILE):
            print(f"\nℹ️ No seed log found at {SEED_LOG_FILE}. Nothing to clean.")
            return

        print("\n🧹 Cleaning up seeded data...")
        try:
            with open(SEED_LOG_FILE, 'r') as f:
                data = json.load(f)
            
            # Delete in reverse order of dependency
            priority_order = [
                'outreach_logs', 'alerts', 'rules', 'goals', 'event_logs',
                'call_transcripts', 'cold_calls', 'call_logs', 'recordings',
                'interactions', 'company_notes', 'notes',
                'insta_actors', 'phone_numbers', 'companies', 'users'
            ]
            
            # Sort collections by priority (if not in list, put at end)
            collections = sorted(data.keys(), key=lambda x: priority_order.index(x) if x in priority_order else 999)

            for col in collections:
                ids = data[col]
                if not ids:
                    continue
                print(f"   Cleaning {col} ({len(ids)} records)...")
                for record_id in ids:
                    self.delete_record(col, record_id)
            
            # Clear the log file content
            with open(SEED_LOG_FILE, 'w') as f:
                json.dump({}, f)
                
            print("\n✅ Cleanup complete!")
            
        except Exception as e:
            print(f"\n❌ Error during cleanup: {e}")

    def seed_users(self):
        """Create sample team members."""
        print("\n👥 Creating users...")
        
        users = [
            {'email': 'admin@tableturnerr.com', 'name': 'Admin User', 'role': 'admin'},
            {'email': 'sarah@tableturnerr.com', 'name': 'Sarah Johnson', 'role': 'member'},
        ]
        
        self.id_maps['users'] = {}

        for user in users:
            try:
                # Prepare data matching schema
                user_data = {
                    'email': user['email'],
                    'name': user['name'],
                    'password': 'Password123!',
                    'passwordConfirm': 'Password123!',
                    'role': user['role'],
                    'status': 'online' if user['role'] == 'admin' else 'offline',
                    'last_activity': datetime.now(timezone.utc).isoformat() + 'Z'
                }
                
                rec = self.create_record('users', user_data)
                self.id_maps['users'][user['email']] = rec['id']
                print(f"   ✓ Created user: {user['name']}")
            except Exception as e:
                # If user exists, try to fetch to populate id_map
                if 'already exists' in str(e).lower() or '400' in str(e):
                    print(f"   ⚠ User likely exists: {user['email']}")
                    try:
                        res = self.client.get(f"{self.url}/api/collections/users/records", 
                                            params={'filter': f'email="{user["email"]}"'}, 
                                            headers=self._headers())
                        items = res.json().get('items', [])
                        if items:
                            self.id_maps['users'][user['email']] = items[0]['id']
                    except:
                        pass
                else:
                    print(f"   ✗ Failed to create user {user['email']}: {e}")
    
    def seed_companies_and_phones(self):
        """Create sample companies and their phone numbers."""
        print("\n🏢 Creating companies and phone numbers...")
        
        # Leads are now companies with specific statuses
        companies = [
            {
                'company_name': 'Sunrise Restaurant',
                'owner_name': 'John Martinez',
                'company_location': 'Los Angeles, CA',
                'phone_numbers_text': '+1-310-555-0101', # Legacy text field
                'source': 'Cold Call',
                'status': 'Warm',
                'contact_source': 'Research',
                'phones': [
                    {'phone_number': '+1-310-555-0101', 'label': 'Main', 'location_name': 'LA Branch'}
                ]
            },
            {
                'company_name': 'Golden Gate Bistro',
                'owner_name': 'Lisa Wong',
                'company_location': 'San Francisco, CA',
                'phone_numbers_text': '+1-415-555-0202',
                'source': 'Google Maps',
                'google_maps_link': 'https://maps.google.com/?q=Golden+Gate+Bistro',
                'status': 'Cold No Reply',
                'phones': [
                    {'phone_number': '+1-415-555-0202', 'label': 'Manager', 'receptionist_name': 'Mark'}
                ]
            },
            {
                'company_name': 'Tech Diner',
                'owner_name': 'Alice Chen',
                'company_location': 'Seattle, WA',
                'phone_numbers_text': '+1-206-555-0909',
                'source': 'Instagram',
                'status': 'Client',
                'email': 'alice@techdiner.com',
                'phones': [
                    {'phone_number': '+1-206-555-0909', 'label': 'Owner Cell', 'location_name': 'HQ'}
                ]
            }
        ]
        
        self.id_maps['companies'] = {}
        self.id_maps['phone_numbers'] = {} # map phone number string to record ID

        for company in companies:
            phones = company.pop('phones', [])
            # Map 'phone_numbers_text' to schema field 'phone_numbers'
            if 'phone_numbers_text' in company:
                company['phone_numbers'] = company.pop('phone_numbers_text')
                
            try:
                rec = self.create_record('companies', company)
                self.id_maps['companies'][company['company_name']] = rec['id']
                print(f"   ✓ Created company: {company['company_name']} ({company['status']})")
                
                # Create associated phone number records
                for phone in phones:
                    phone_data = {
                        'company': rec['id'],
                        'phone_number': phone['phone_number'],
                        'label': phone.get('label', ''),
                        'location_name': phone.get('location_name', ''),
                        'receptionist_name': phone.get('receptionist_name', ''),
                        'last_called': datetime.now(timezone.utc).isoformat() + 'Z'
                    }
                    phone_rec = self.create_record('phone_numbers', phone_data)
                    self.id_maps['phone_numbers'][phone['phone_number']] = phone_rec['id']
                    print(f"      → Added phone: {phone['phone_number']}")
                    
            except Exception as e:
                print(f"   ✗ Failed to create company {company['company_name']}: {e}")
                # Try to fetch if exists to keep map populated
                if 'already exists' in str(e).lower():
                    try:
                        res = self.client.get(f"{self.url}/api/collections/companies/records", 
                                            params={'filter': f'company_name="{company["company_name"]}"'}, 
                                            headers=self._headers())
                        items = res.json().get('items', [])
                        if items:
                            self.id_maps['companies'][company['company_name']] = items[0]['id']
                    except: pass

    def seed_cold_calls(self):
        """Create sample cold calls with transcripts."""
        print("\n📞 Creating cold calls and transcripts...")
        
        cold_calls = [
            {
                'company_name': 'Sunrise Restaurant',
                'recipients': 'Owner (John)',
                'call_outcome': 'Interested',
                'interest_level': 8,
                'phone_number': '+1-310-555-0101',
                'owner_name': 'John Martinez',
                'call_summary': 'John was interested in modernizing menu operations. Requested pricing.',
                'objections': ['Price concerns'],
                'pain_points': ['Paper menus get dirty', 'Reprinting costs'],
                'follow_up_actions': ['Send pricing', 'Schedule demo'],
                'call_duration_estimate': '4m 30s',
                'model_used': 'gemini-2.5-flash',
                'transcript': """Caller: Hi, is this Sunrise Restaurant?
Recipient: Yes, this is John.
Caller: Hi John, calling from TableTurnerr. We offer digital menus.
Recipient: Interesting, our paper ones are a hassle.
Caller: We can help with that. Can I send info?
Recipient: Yes please."""
            },
            {
                'company_name': 'Golden Gate Bistro',
                'recipients': 'Manager',
                'call_outcome': 'Callback',
                'interest_level': 6,
                'phone_number': '+1-415-555-0202',
                'owner_name': 'Lisa Wong',
                'call_summary': 'Spoke with manager. Owner out of town. Call back next week.',
                'objections': ['Owner not available'],
                'pain_points': ['Wait times'],
                'follow_up_actions': ['Call back Tuesday'],
                'call_duration_estimate': '2m',
                'model_used': 'gemini-2.5-flash',
                'transcript': """Caller: May I speak to the owner?
Recipient: She is not in. I am the manager.
Caller: I see. We provide digital menus.
Recipient: Call back next week when Lisa is here."""
            }
        ]
        
        self.id_maps['cold_calls'] = {}
        
        for call in cold_calls:
            try:
                company_name = call.pop('company_name')
                company_id = self.id_maps['companies'].get(company_name)
                
                if not company_id:
                    print(f"   ⚠ Skipping call for {company_name}: Company not found")
                    continue
                    
                transcript = call.pop('transcript')
                
                call_data = {
                    **call,
                    'company': company_id,
                }
                
                rec = self.create_record('cold_calls', call_data)
                self.id_maps['cold_calls'][call['phone_number']] = rec['id']
                print(f"   ✓ Created cold call: {call['phone_number']} ({call['call_outcome']})")
                
                # Create transcript
                self.create_record('call_transcripts', {
                    'call': rec['id'],
                    'transcript': transcript
                })
                print(f"      → Created transcript")
                
            except Exception as e:
                print(f"   ✗ Failed to create cold call: {e}")

    def seed_company_notes(self):
        """Create company specific notes."""
        print("\n📝 Creating company notes...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        if not admin_id: return

        notes = [
            {
                'company_name': 'Sunrise Restaurant',
                'phone': '+1-310-555-0101',
                'note_type': 'research',
                'content': 'They have a 4.5 star rating on Yelp. Renovated last month.',
                'created_by': admin_id
            }
        ]

        for note in notes:
            company_id = self.id_maps['companies'].get(note['company_name'])
            phone_record_id = self.id_maps['phone_numbers'].get(note['phone'])
            
            if not company_id: continue

            try:
                data = {
                    'company': company_id,
                    'phone_number_record': phone_record_id,
                    'note_type': note['note_type'],
                    'content': note['content'],
                    'created_by': note['created_by']
                }
                self.create_record('company_notes', data)
                print(f"   ✓ Created note for {note['company_name']}")
            except Exception as e:
                print(f"   ✗ Failed to create company note: {e}")

    def seed_interactions(self):
        """Create sample interactions."""
        print("\n🤝 Creating interactions...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        if not admin_id: return

        interactions = [
            {
                'company_name': 'Tech Diner',
                'channel': 'email',
                'direction': 'inbound',
                'summary': 'Received signed contract via email.',
                'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }
        ]

        for interaction in interactions:
            company_id = self.id_maps['companies'].get(interaction['company_name'])
            if not company_id: continue

            try:
                data = {
                    'company': company_id,
                    'channel': interaction['channel'],
                    'direction': interaction['direction'],
                    'summary': interaction['summary'],
                    'timestamp': interaction['timestamp'],
                    'user': admin_id
                }
                self.create_record('interactions', data)
                print(f"   ✓ Created interaction for {interaction['company_name']}")
            except Exception as e:
                print(f"   ✗ Failed to create interaction: {e}")

    def seed_insta_actors(self):
        """Create sample Instagram actors."""
        print("\n📱 Creating Instagram actors...")
        
        sarah_id = self.id_maps.get('users', {}).get('sarah@tableturnerr.com')
        if not sarah_id:
            # Fallback to admin if sarah not found
            sarah_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        
        if not sarah_id: return

        actors = [
            {'username': 'tableturnerr_official', 'owner': sarah_id, 'status': 'Active'},
        ]
        
        self.id_maps['actors'] = {}
        for actor in actors:
            try:
                rec = self.create_record('insta_actors', {
                    **actor,
                    'last_activity': datetime.now(timezone.utc).isoformat() + 'Z'
                })
                self.id_maps['actors'][actor['username']] = rec['id']
                print(f"   ✓ Created actor: @{actor['username']}")
            except Exception as e:
                if 'already exists' in str(e).lower():
                   try:
                       res = self.client.get(f"{self.url}/api/collections/insta_actors/records", 
                                             params={'filter': f'username="{actor["username"]}"'}, 
                                             headers=self._headers())
                       items = res.json().get('items', [])
                       if items:
                           self.id_maps['actors'][actor['username']] = items[0]['id']
                   except: pass
                else:
                    print(f"   ✗ Failed to create actor: {e}")
    
    def seed_notes(self):
        """Create generic system notes."""
        print("\n🗒️ Creating generic notes...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        if not admin_id: return
        
        notes = [
            {
                'title': 'Sales Strategy Q1',
                'note_text': '# Q1 Strategy\nFocus on recently renovated restaurants.',
                'created_by': admin_id,
                'is_archived': False,
                'is_deleted': False
            }
        ]
        
        for note in notes:
            try:
                self.create_record('notes', note)
                print(f"   ✓ Created generic note: {note['title']}")
            except Exception as e:
                print(f"   ✗ Failed to create note: {e}")
    
    def seed_goals_rules_alerts(self):
        """Create goals, rules, and alerts."""
        print("\n🎯 Creating goals, rules, and alerts...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        actor_id = list(self.id_maps.get('actors', {}).values())[0] if self.id_maps.get('actors') else None
        
        if not admin_id: return

        # Goal
        try:
            self.create_record('goals', {
                'metric': 'Total Messages Sent',
                'target_value': 50,
                'frequency': 'Daily',
                'assigned_to_user': admin_id,
                'assigned_to_actor': actor_id,
                'status': 'Active',
                'start_date': datetime.now(timezone.utc).date().isoformat(),
                'end_date': (datetime.now(timezone.utc).date() + timedelta(days=30)).isoformat()
            })
            print(f"   ✓ Created goal")
        except Exception as e:
            print(f"   ✗ Failed goal: {e}")

        # Rule
        try:
            self.create_record('rules', {
                'type': 'Frequency Cap',
                'metric': 'Total Messages Sent',
                'limit_value': 30,
                'time_window_sec': 3600,
                'severity': 'High',
                'assigned_to_user': admin_id,
                'status': 'Active'
            })
            print(f"   ✓ Created rule")
        except Exception as e:
            print(f"   ✗ Failed rule: {e}")

        # Alert
        try:
            self.create_record('alerts', {
                'created_by': admin_id,
                'target_user': admin_id,
                'entity_type': 'goal',
                'entity_label': 'Daily Limit Warning',
                'alert_time': datetime.now(timezone.utc).isoformat() + 'Z',
                'message': 'Approaching daily message limit.',
                'is_dismissed': False
            })
            print(f"   ✓ Created alert")
        except Exception as e:
            print(f"   ✗ Failed alert: {e}")

    def seed_event_logs(self):
        """Create sample event logs."""
        print("\n📊 Creating event logs...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        if not admin_id: return
        
        events = [
            {'event_type': 'System', 'details': 'Seed data initialized', 'source': 'System'}
        ]
        
        for event in events:
            try:
                self.create_record('event_logs', {
                    **event,
                    'user': admin_id
                })
                print(f"   ✓ Created event log")
            except Exception as e:
                print(f"   ✗ Failed to create event: {e}")

    def close(self):
        self.client.close()


def main():
    parser = argparse.ArgumentParser(description='Seed PocketBase with sample data.')
    parser.add_argument('--clean', action='store_true', help='Remove previously created sample data')
    parser.add_argument('--url', default=POCKETBASE_URL, help='PocketBase URL')
    args = parser.parse_args()

    print("=" * 60)
    print("CRM-Tableturnerr: Seed Sample Data")
    print("=" * 60)
    
    if not PB_ADMIN_EMAIL or not PB_ADMIN_PASSWORD:
        print("\n❌ Error: Missing admin credentials.")
        print("Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD in environment or .env file")
        sys.exit(1)
    
    seeder = PocketBaseSeeder()
    if args.url:
        seeder.url = args.url
    
    try:
        seeder.authenticate(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
        
        if args.clean:
            seeder.cleanup_seeded_data()
        else:
            # Seed in dependency order
            seeder.seed_users()
            seeder.seed_companies_and_phones()
            seeder.seed_cold_calls()
            seeder.seed_insta_actors()
            seeder.seed_company_notes()
            seeder.seed_interactions()
            seeder.seed_notes()
            seeder.seed_event_logs()
            seeder.seed_goals_rules_alerts()
            
            # Save the log of created IDs
            seeder.save_seed_log()
            
            print("\n" + "=" * 60)
            print("✅ Seeding Complete!")
            print("=" * 60)
            print("\nSample data created and logged to seed_log.json")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    finally:
        seeder.close()


if __name__ == '__main__':
    main()