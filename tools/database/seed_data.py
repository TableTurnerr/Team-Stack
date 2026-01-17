#!/usr/bin/env python3
"""
CRM-Tableturnerr: Seed Sample Data

Populates PocketBase with sample data for testing and development.
Run this after importing the schema via PocketBase Admin UI.

Usage:
    python seed_data.py

Prerequisites:
    1. PocketBase running at configured URL
    2. Schema imported (pb_schema.json via Admin UI)
    3. Admin credentials in .env or environment
"""

import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List

import httpx
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
POCKETBASE_URL = os.getenv('POCKETBASE_URL', 'https://crm.tableturnerr.com')
PB_ADMIN_EMAIL = os.getenv('PB_ADMIN_EMAIL', '')
PB_ADMIN_PASSWORD = os.getenv('PB_ADMIN_PASSWORD', '')


class PocketBaseSeeder:
    """Seed PocketBase with sample data."""
    
    def __init__(self):
        self.url = POCKETBASE_URL
        self.client = httpx.Client(timeout=30.0)
        self.token = None
        self.id_maps: Dict[str, Dict[str, str]] = {}
        
    def authenticate(self, email: str, password: str):
        """Authenticate as admin (superuser)."""
        print(f"🔑 Authenticating with PocketBase at {self.url}...")
        # PocketBase 0.8+ uses _superusers collection for admin auth
        response = self.client.post(
            f"{self.url}/api/collections/_superusers/auth-with-password",
            json={'identity': email, 'password': password}
        )
        response.raise_for_status()
        self.token = response.json()['token']
        print("   ✓ Authenticated successfully")
    
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
        response.raise_for_status()
        return response.json()
    
    def seed_users(self):
        """Create sample team members."""
        print("\n👥 Creating users...")
        
        users = [
            {'email': 'admin@tableturnerr.com', 'name': 'Admin User', 'role': 'admin'},
            {'email': 'sarah@tableturnerr.com', 'name': 'Sarah Johnson', 'role': 'operator'},
            {'email': 'mike@tableturnerr.com', 'name': 'Mike Chen', 'role': 'operator'},
            {'email': 'emma@tableturnerr.com', 'name': 'Emma Davis', 'role': 'member'},
        ]
        
        self.id_maps['users'] = {}
        for user in users:
            try:
                rec = self.create_record('users', {
                    **user,
                    'password': 'Password123!',
                    'passwordConfirm': 'Password123!',
                    'status': 'online' if user['role'] == 'admin' else 'offline',
                    'last_activity': datetime.utcnow().isoformat() + 'Z'
                })
                self.id_maps['users'][user['email']] = rec['id']
                print(f"   ✓ Created user: {user['name']}")
            except Exception as e:
                if 'already exists' in str(e).lower():
                    print(f"   ⚠ User already exists: {user['email']}")
                else:
                    print(f"   ✗ Failed to create user {user['email']}: {e}")
    
    def seed_companies(self):
        """Create sample companies."""
        print("\n🏢 Creating companies...")
        
        companies = [
            {
                'company_name': 'Sunrise Restaurant',
                'owner_name': 'John Martinez',
                'company_location': 'Los Angeles, CA',
                'phone_numbers': '+1-310-555-0101',
                'source': 'Cold Call'
            },
            {
                'company_name': 'Golden Gate Bistro',
                'owner_name': 'Lisa Wong',
                'company_location': 'San Francisco, CA',
                'phone_numbers': '+1-415-555-0202',
                'source': 'Google Maps',
                'google_maps_link': 'https://maps.google.com/?q=Golden+Gate+Bistro'
            },
            {
                'company_name': 'Downtown Diner',
                'owner_name': 'Robert Smith',
                'company_location': 'New York, NY',
                'phone_numbers': '+1-212-555-0303, +1-212-555-0304',
                'source': 'Cold Call'
            },
            {
                'company_name': 'Coastal Kitchen',
                'owner_name': 'Maria Garcia',
                'company_location': 'Miami, FL',
                'phone_numbers': '+1-305-555-0404',
                'source': 'Instagram'
            },
            {
                'company_name': 'Mountain View Cafe',
                'owner_name': 'David Lee',
                'company_location': 'Denver, CO',
                'phone_numbers': '+1-720-555-0505',
                'source': 'Manual'
            },
        ]
        
        self.id_maps['companies'] = {}
        for i, company in enumerate(companies):
            try:
                rec = self.create_record('companies', company)
                self.id_maps['companies'][company['company_name']] = rec['id']
                print(f"   ✓ Created company: {company['company_name']}")
            except Exception as e:
                print(f"   ✗ Failed to create company: {e}")
    
    def seed_cold_calls(self):
        """Create sample cold calls with transcripts."""
        print("\n📞 Creating cold calls and transcripts...")
        
        cold_calls = [
            {
                'company': 'Sunrise Restaurant',
                'recipients': 'Owner (John)',
                'call_outcome': 'Interested',
                'interest_level': 8,
                'phone_number': '+1-310-555-0101',
                'owner_name': 'John Martinez',
                'call_summary': 'John was very interested in our tablet menu system. He mentioned they recently renovated and are looking to modernize their operations.',
                'objections': ['Price concerns', 'Training time for staff'],
                'pain_points': ['Paper menus get dirty quickly', 'Menu updates are expensive to print'],
                'follow_up_actions': ['Send pricing details', 'Schedule demo for next week'],
                'call_duration_estimate': '4 minutes 30 seconds',
                'model_used': 'gemini-2.5-flash',
                'transcript': """Caller: Hi, is this Sunrise Restaurant? I'm calling from TableTurnerr.
Recipient: Yes, this is John, the owner. What can I do for you?
Caller: Great to speak with you, John. We offer digital tablet menus for restaurants. I noticed you recently renovated - are you looking to modernize your menu experience?
Recipient: Actually, yes! We just finished our renovation and I've been thinking about going digital. What do you offer?
Caller: We have tablet-based menus that update instantly, show beautiful images, and even integrate with your POS system.
Recipient: That sounds interesting. Our paper menus get dirty so fast, and every time we update prices, we have to reprint everything.
Caller: Exactly the problems we solve. Can I send you our pricing and maybe schedule a demo?
Recipient: Yes, send me the information. I'm definitely interested in seeing a demo."""
            },
            {
                'company': 'Golden Gate Bistro',
                'recipients': 'Manager',
                'call_outcome': 'Callback',
                'interest_level': 6,
                'phone_number': '+1-415-555-0202',
                'owner_name': 'Lisa Wong',
                'call_summary': 'Spoke with the manager. Owner Lisa is not available until next week. Manager seemed interested and will pass along the information.',
                'objections': ['Owner not available'],
                'pain_points': ['Long wait times for ordering'],
                'follow_up_actions': ['Call back next Tuesday'],
                'call_duration_estimate': '2 minutes',
                'model_used': 'gemini-2.5-flash',
                'transcript': """Caller: Hi, I'm calling from TableTurnerr. Could I speak with the owner about our digital menu solutions?
Recipient: I'm the manager. Lisa, the owner, is out of town until next week.
Caller: I understand. We help restaurants modernize with tablet menus. Would you be able to pass along some information?
Recipient: Sure, what do you offer?
Caller: Interactive tablet menus that speed up ordering and improve the guest experience. I can send details.
Recipient: Sounds interesting. We do get complaints about wait times. I'll let Lisa know.
Caller: Perfect. I'll call back next Tuesday when she's available. Thank you!"""
            },
            {
                'company': 'Downtown Diner',
                'recipients': 'Receptionist',
                'call_outcome': 'Not Interested',
                'interest_level': 2,
                'phone_number': '+1-212-555-0303',
                'owner_name': 'Robert Smith',
                'call_summary': 'Owner declined immediately. Said they prefer traditional menus and are not interested in technology solutions.',
                'objections': ['Not interested in technology', 'Happy with current setup'],
                'pain_points': [],
                'follow_up_actions': [],
                'call_duration_estimate': '45 seconds',
                'model_used': 'gemini-2.5-flash',
                'transcript': """Caller: Hi, could I speak with the owner about our digital menu system?
Recipient: Hold on... This is Robert.
Caller: Hi Robert, I'm calling from TableTurnerr about our tablet menu solutions—
Recipient: Not interested. We've been doing paper menus for 30 years and that's not changing.
Caller: I understand. If you ever reconsider—
Recipient: I won't. Thanks anyway. Goodbye."""
            },
            {
                'company': 'Coastal Kitchen',
                'recipients': 'Owner (Maria)',
                'call_outcome': 'Interested',
                'interest_level': 9,
                'phone_number': '+1-305-555-0404',
                'owner_name': 'Maria Garcia',
                'call_summary': 'Maria is very tech-forward and already follows us on Instagram. She wants to be an early adopter and requested an in-person demo this week.',
                'objections': [],
                'pain_points': ['Wants better customer experience', 'Looking for competitive advantage'],
                'follow_up_actions': ['Schedule in-person demo', 'Prepare custom proposal'],
                'call_duration_estimate': '6 minutes',
                'model_used': 'gemini-2.5-flash',
                'transcript': """Caller: Hi Maria, this is a follow-up from TableTurnerr. I saw you've been engaging with our Instagram posts.
Recipient: Yes! I love what you're doing. I've been waiting for someone to call me.
Caller: That's great to hear! Our tablet menus could really enhance your coastal dining experience.
Recipient: I want to be ahead of my competitors. When can you come show me how it works?
Caller: I can do an in-person demo this week. Thursday work for you?
Recipient: Perfect. Come at 2pm before the dinner rush. I'm excited to see it in action.
Caller: Wonderful! I'll bring some custom mockups for your menu. See you Thursday!"""
            },
        ]
        
        self.id_maps['cold_calls'] = {}
        for call in cold_calls:
            try:
                company_id = self.id_maps['companies'].get(call['company'])
                transcript = call.pop('transcript')
                
                call_data = {
                    **call,
                    'company': company_id,
                }
                del call_data['company']  # Remove string key
                call_data['company'] = company_id  # Add ID
                
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
    
    def seed_leads(self):
        """Create sample leads."""
        print("\n🎯 Creating leads...")
        
        leads = [
            {'username': 'miami_foodie_blog', 'status': 'Warm', 'source': 'Instagram', 'email': 'contact@miamifoodie.com'},
            {'username': 'restaurant_tech_daily', 'status': 'Replied', 'source': 'Instagram', 'notes': 'Industry influencer, interested in partnership'},
            {'username': 'chefs_choice_nyc', 'status': 'Cold No Reply', 'source': 'Instagram'},
            {'username': 'la_dining_guide', 'status': 'Booked', 'source': 'Instagram', 'email': 'partnerships@ladining.com'},
            {'username': 'sf_restaurant_week', 'status': 'Paid', 'source': 'Instagram', 'notes': 'Signed up for annual plan'},
        ]
        
        for lead in leads:
            try:
                self.create_record('leads', {
                    **lead,
                    'first_contacted': (datetime.utcnow() - timedelta(days=14)).isoformat() + 'Z',
                    'last_updated': datetime.utcnow().isoformat() + 'Z'
                })
                print(f"   ✓ Created lead: @{lead['username']} ({lead['status']})")
            except Exception as e:
                if 'already exists' in str(e).lower():
                    print(f"   ⚠ Lead already exists: {lead['username']}")
                else:
                    print(f"   ✗ Failed to create lead: {e}")
    
    def seed_insta_actors(self):
        """Create sample Instagram actors."""
        print("\n📱 Creating Instagram actors...")
        
        # Need user IDs first
        sarah_id = self.id_maps.get('users', {}).get('sarah@tableturnerr.com')
        mike_id = self.id_maps.get('users', {}).get('mike@tableturnerr.com')
        
        if not sarah_id and not mike_id:
            print("   ⚠ No users found - skipping actors")
            return
        
        actors = [
            {'username': 'tableturnerr_official', 'owner': sarah_id, 'status': 'Active'},
            {'username': 'tableturnerr_sales', 'owner': sarah_id, 'status': 'Active'},
            {'username': 'restaurant_innovation', 'owner': mike_id, 'status': 'Active'},
            {'username': 'dining_tech_tips', 'owner': mike_id, 'status': 'Suspended By Team'},
        ]
        
        self.id_maps['actors'] = {}
        for actor in actors:
            if not actor['owner']:
                continue
            try:
                rec = self.create_record('insta_actors', {
                    **actor,
                    'last_activity': datetime.utcnow().isoformat() + 'Z'
                })
                self.id_maps['actors'][actor['username']] = rec['id']
                print(f"   ✓ Created actor: @{actor['username']} ({actor['status']})")
            except Exception as e:
                print(f"   ✗ Failed to create actor: {e}")
    
    def seed_notes(self):
        """Create sample notes."""
        print("\n📝 Creating notes...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        sarah_id = self.id_maps.get('users', {}).get('sarah@tableturnerr.com')
        
        if not admin_id:
            print("   ⚠ No admin user found - skipping notes")
            return
        
        notes = [
            {
                'title': 'Sales Strategy Q1',
                'note_text': '# Q1 Focus Areas\n\n1. Target restaurants that recently renovated\n2. Focus on health-conscious menus (allergy info display)\n3. Partner with POS providers\n\n## Key Metrics\n- 50 demos per month\n- 15% conversion rate goal',
                'created_by': admin_id,
                'is_archived': False,
                'is_deleted': False
            },
            {
                'title': 'Competitor Analysis',
                'note_text': '## Main Competitors\n\n- **MenuPad Pro**: Higher price, more features\n- **DigiMenu**: Budget option, less reliable\n- **TableTech**: Good for large chains\n\n## Our Advantages\n- Better UX/UI\n- Faster implementation\n- Local support',
                'created_by': sarah_id or admin_id,
                'is_archived': False,
                'is_deleted': False
            },
            {
                'title': 'Call Script Template',
                'note_text': '## Opening\n"Hi, is this [Restaurant Name]? I\'m [Name] from TableTurnerr."\n\n## Discovery Questions\n1. How often do you update your menu?\n2. Have you considered going digital?\n3. What\'s your biggest challenge with the current setup?\n\n## Closing\n"Can I send you some information and schedule a quick demo?"',
                'created_by': admin_id,
                'is_archived': True,
                'is_deleted': False
            },
        ]
        
        for note in notes:
            try:
                self.create_record('notes', note)
                print(f"   ✓ Created note: {note['title']}")
            except Exception as e:
                print(f"   ✗ Failed to create note: {e}")
    
    def seed_event_logs(self):
        """Create sample event logs."""
        print("\n📊 Creating event logs...")
        
        admin_id = self.id_maps.get('users', {}).get('admin@tableturnerr.com')
        actor_id = list(self.id_maps.get('actors', {}).values())[0] if self.id_maps.get('actors') else None
        
        if not admin_id:
            print("   ⚠ No users found - skipping event logs")
            return
        
        events = [
            {'event_type': 'Cold Call', 'details': 'Made call to Sunrise Restaurant - Interested', 'source': 'Cold Call'},
            {'event_type': 'User', 'details': 'Admin logged in', 'source': 'Cold Call'},
            {'event_type': 'Outreach', 'details': 'Sent DM to @miami_foodie_blog', 'source': 'Instagram'},
            {'event_type': 'System', 'details': 'Daily sync completed', 'source': 'Cold Call'},
        ]
        
        for event in events:
            try:
                self.create_record('event_logs', {
                    **event,
                    'user': admin_id,
                    'actor': actor_id if event['source'] == 'Instagram' else None
                })
                print(f"   ✓ Created event: {event['event_type']} - {event['details'][:40]}...")
            except Exception as e:
                print(f"   ✗ Failed to create event: {e}")
    
    def close(self):
        self.client.close()


def main():
    print("=" * 60)
    print("CRM-Tableturnerr: Seed Sample Data")
    print("=" * 60)
    
    if not PB_ADMIN_EMAIL or not PB_ADMIN_PASSWORD:
        print("\n❌ Error: Missing admin credentials.")
        print("Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD in environment or .env file")
        sys.exit(1)
    
    seeder = PocketBaseSeeder()
    
    try:
        seeder.authenticate(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
        
        # Seed in dependency order
        seeder.seed_users()
        seeder.seed_companies()
        seeder.seed_cold_calls()
        seeder.seed_leads()
        seeder.seed_insta_actors()
        seeder.seed_notes()
        seeder.seed_event_logs()
        
        print("\n" + "=" * 60)
        print("✅ Seeding Complete!")
        print("=" * 60)
        print("\nSample data created:")
        print(f"  • {len(seeder.id_maps.get('users', {}))} users")
        print(f"  • {len(seeder.id_maps.get('companies', {}))} companies")
        print(f"  • {len(seeder.id_maps.get('cold_calls', {}))} cold calls with transcripts")
        print(f"  • {len(seeder.id_maps.get('actors', {}))} Instagram actors")
        print("\nYou can now test the dashboard at:")
        print(f"  http://localhost:3000")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    finally:
        seeder.close()


if __name__ == '__main__':
    main()
