# HubSpot CRM Context & Mapping Guide

> **Purpose**: This document provides comprehensive context for migrating from Google Sheets and PocketBase to HubSpot CRM. Use this as a reference for HubSpot API integrations, CSV imports, and form lead configurations.

---

## Table of Contents

1. [Business Context](#business-context)
2. [Current Data Sources Summary](#current-data-sources-summary)
3. [HubSpot Object Mapping](#hubspot-object-mapping)
4. [Detailed Property Definitions](#detailed-property-definitions)
5. [Deal Pipeline Configuration](#deal-pipeline-configuration)
6. [Custom Objects (If Needed)](#custom-objects-if-needed)
7. [API Integration Considerations](#api-integration-considerations)
8. [CSV Import Templates](#csv-import-templates)
9. [Form Integration Guidelines](#form-integration-guidelines)

---

## Business Context

### What Your Team Does
- **Restaurant Owner Outreach**: Cold calling and Instagram DM outreach to restaurant owners
- **Lead Qualification**: Multi-channel sales pipeline tracking (cold → warm → booked → paid → client)
- **Call Recording & Transcription**: Tracking call outcomes, transcriptions, and follow-ups
- **KPI Tracking**: Daily call volumes, owner connection rates, submission rates, fumble tracking

### Outreach Channels
| Channel | Description |
|---------|-------------|
| **Phone** | Cold calls to restaurant owners/receptionists |
| **Instagram** | DM outreach via multiple actor accounts |
| **Email** | Follow-up communication |

### Team Structure
- Multiple team members performing outreach
- "Instagram Actors" (accounts used for DM outreach)
- Admin roles for management

---

## Current Data Sources Summary

### From Google Sheets (Owner Outreach - Master List)

| Column | HubSpot Mapping | Notes |
|--------|-----------------|-------|
| Date | `first_contacted` | First contact timestamp |
| Restaurant | `company_name` | Company object |
| Owner/Receptionist | `owner_name` / `receptionist_name` | Contact properties |
| Note | `notes` | Activity/note |
| Pain Points / Pre Call Notes | `pain_points` (custom) | Custom company property |
| Email | `email` | Contact property |
| Phone No | `phone` | Contact property |
| Status | `deal_stage` or `lifecycle_stage` | Pipeline stage |
| Source | `lead_source` | How lead was found |
| Location | `city` / `state` | Address properties |
| Rating | `google_rating` (custom) | Custom company property |
| Reviews | `google_review_count` (custom) | Custom company property |

#### Status Values → HubSpot Deal Stages
| Current Status | HubSpot Deal Stage |
|---------------|-------------------|
| Cold | `cold` |
| Callback | `callback_scheduled` |
| Interested | `interested` |
| Submitted | `submitted` |
| Unqualified | `unqualified` (closed-lost) |
| Nurture | `nurture` |
| Close | `closed_won` |
| Close Lost | `closed_lost` |
| Fumbled | `fumbled` (custom) |
| Rejected | `rejected` (closed-lost) |
| Hard Rejected | `hard_rejected` (closed-lost) |
| Dead End | `dead_end` (closed-lost) |
| Already Client | `existing_customer` |

### From PocketBase Schema

#### Core Collections → HubSpot Objects

| PocketBase Collection | HubSpot Object | Notes |
|----------------------|----------------|-------|
| `companies` | **Companies** | Primary business entity |
| `phone_numbers` | Company property (multi-value) | Multiple phones per company |
| `cold_calls` | **Engagements (Calls)** | Call activities |
| `call_logs` | **Engagements (Calls)** | Detailed call tracking |
| `call_transcripts` | Engagement attachment/note | Call transcript text |
| `recordings` | Engagement attachment | Audio file attachments |
| `interactions` | **Engagements** | Multi-channel activity tracking |
| `follow_ups` | **Tasks** | Scheduled callback reminders |
| `notes` | **Notes** | General notes |
| `company_notes` | **Notes** (associated to Company) | Company-specific notes |
| `insta_actors` | Custom Object or Contact | Instagram accounts used for outreach |
| `event_logs` | Timeline activities | Audit trail |
| `outreach_logs` | Engagement activities | Message tracking |
| `goals` | Custom Object or Reports | KPI targets |
| `rules` | N/A (internal) | Rate limiting rules |
| `alerts` | N/A (internal) | System alerts |

---

## HubSpot Object Mapping

### Companies Object

```
HubSpot Companies = PocketBase companies + Google Sheets restaurant data
```

#### Standard Properties
| Property | Internal Name | Type | Required | Source |
|----------|--------------|------|----------|--------|
| Company Name | `name` | Text | ✅ | `company_name` |
| Company Domain | `domain` | Text | | Extracted from website |
| Phone Number | `phone` | Phone | | `phone_numbers` (primary) |
| City | `city` | Text | | `company_location` |
| State/Region | `state` | Text | | `company_location` |
| Industry | `industry` | Dropdown | | Set to "Restaurants" |
| Website URL | `website` | URL | | Website column |
| Owner Email | `owner_email` (custom) | Email | | `email` |

#### Custom Properties (Create in HubSpot)
| Property | Internal Name | Type | Options/Format |
|----------|--------------|------|----------------|
| Restaurant Status | `restaurant_status` | Dropdown | Cold No Reply, Replied, Warm, Booked, Paid, Client, Excluded |
| Owner Name | `owner_name` | Text | |
| Instagram Handle | `instagram_handle` | Text | |
| Google Maps Link | `google_maps_link` | URL | |
| Google Rating | `google_rating` | Number (1 decimal) | 1.0 - 5.0 |
| Google Review Count | `google_review_count` | Number | |
| Pain Points | `pain_points` | Multi-line text | |
| Lead Source | `lead_source` | Dropdown | GMaps Scraper, Manual, Instagram, Cold Calling, Referral |
| Current ODS (Ordering System) | `current_ods` | Text | e.g., "DoorDash, UberEats, Slice" |
| Has SEO | `has_seo` | Checkbox | |
| Offers Direct Delivery | `offers_direct_delivery` | Checkbox | |
| First Contacted Date | `first_contacted_date` | Date | |
| Last Contacted Date | `last_contacted_date` | Date | |
| Contact Source | `contact_source` | Text | |

---

### Contacts Object

```
HubSpot Contacts = Restaurant owners/decision makers
```

#### Standard Properties
| Property | Internal Name | Required | Source |
|----------|--------------|----------|--------|
| First Name | `firstname` | ✅ | Owner name (parsed) |
| Last Name | `lastname` | | Owner name (parsed) |
| Email | `email` | | Email column |
| Phone Number | `phone` | | Phone No column |
| Job Title | `jobtitle` | | "Owner", "Manager", "Receptionist" |

#### Custom Properties
| Property | Internal Name | Type | Notes |
|----------|--------------|------|-------|
| Contact Type | `contact_type` | Dropdown | Owner, Manager, Receptionist, Decision Maker |
| Best Call Time | `best_call_time` | Text | e.g., "Mon-Fri 2pm" |
| Timezone | `timezone` | Dropdown | US timezones |

---

### Deals Object

```
HubSpot Deals = Sales opportunities per company
```

#### Standard Properties
| Property | Internal Name | Source |
|----------|--------------|--------|
| Deal Name | `dealname` | Company name + "Outreach" |
| Pipeline | `pipeline` | Use "Restaurant Outreach" pipeline |
| Deal Stage | `dealstage` | Status mapping (see below) |
| Amount | `amount` | Service pricing |
| Close Date | `closedate` | Expected close |
| Deal Owner | `hubspot_owner_id` | Team member |

---

## Deal Pipeline Configuration

### Pipeline: "Restaurant Outreach"

| Stage Name | Internal Name | Probability | Type | Old Status Mapping |
|------------|--------------|-------------|------|-------------------|
| Cold - No Reply | `cold_no_reply` | 10% | Open | Cold |
| Callback Scheduled | `callback_scheduled` | 20% | Open | Callback |
| Replied | `replied` | 30% | Open | Replied |
| Warm | `warm` | 40% | Open | Warm, Interested |
| Submitted | `submitted` | 60% | Open | Submitted |
| Demo Booked | `demo_booked` | 75% | Open | Booked |
| Paid / Trial | `paid` | 90% | Open | Paid |
| Closed Won - Client | `closed_won` | 100% | Won | Client, Close |
| Closed Lost - Rejected | `closed_lost_rejected` | 0% | Lost | Rejected, Hard Rejected |
| Closed Lost - Unqualified | `closed_lost_unqualified` | 0% | Lost | Unqualified |
| Closed Lost - Fumbled | `closed_lost_fumbled` | 0% | Lost | Fumbled |
| Closed Lost - Dead End | `closed_lost_dead_end` | 0% | Lost | Dead End |
| Nurture | `nurture` | 15% | Open | Nurture |
| Excluded | `excluded` | 0% | Lost | Excluded |

---

## Custom Objects (If Needed)

### Instagram Actors (Custom Object)

If you want to track Instagram actor accounts in HubSpot:

| Property | Type | Description |
|----------|------|-------------|
| Username | Text (Primary) | Instagram handle |
| Owner (Team Member) | Association | User who owns this account |
| Status | Dropdown | Active, Suspended By Team, Suspended By Insta, Discarded |
| Last Activity | Date | Last outreach date |

### Call Recordings (Custom Object)

For detailed call tracking beyond standard engagements:

| Property | Type | Description |
|----------|------|-------------|
| Phone Number | Text | Called number |
| Recording File | File/URL | Link to audio |
| Duration | Number | Seconds |
| Call Outcome | Dropdown | Interested, Not Interested, Callback, No Answer, Wrong Number |
| Transcript | Multi-line text | Call transcript |
| Interest Level | Number | 1-10 scale |
| Status Changed To | Dropdown | Status after call |

---

## API Integration Considerations

### HubSpot API Endpoints You'll Need

```
# Companies
POST /crm/v3/objects/companies
PATCH /crm/v3/objects/companies/{companyId}
GET /crm/v3/objects/companies/{companyId}

# Contacts
POST /crm/v3/objects/contacts
GET /crm/v3/objects/contacts/search

# Deals
POST /crm/v3/objects/deals
PATCH /crm/v3/objects/deals/{dealId}

# Engagements (Calls)
POST /crm/v3/objects/calls
POST /crm/v3/objects/notes
POST /crm/v3/objects/tasks

# Associations
PUT /crm/v3/objects/{objectType}/{objectId}/associations/{toObjectType}/{toObjectId}/{associationType}
```

### Required Scopes
```
crm.objects.companies.read
crm.objects.companies.write
crm.objects.contacts.read
crm.objects.contacts.write
crm.objects.deals.read
crm.objects.deals.write
crm.objects.custom.read
crm.objects.custom.write
```

### Association Types
- Company ↔ Contact: `company_to_contact`
- Company ↔ Deal: `company_to_deal`
- Contact ↔ Deal: `contact_to_deal`
- All Objects ↔ Engagement: `{object}_to_call`, `{object}_to_note`

---

## CSV Import Templates

### Companies Import Template

```csv
name,phone,website,city,state,industry,owner_name,instagram_handle,google_maps_link,google_rating,google_review_count,pain_points,lead_source,current_ods,restaurant_status
"Big Fellas Pizza","+1 315-214-4258","bigfellas57.com","Newark","NJ","Restaurants","Antoine","","","4.5","234","no seo","Cold Calling","DoorDash","Interested"
```

### Contacts Import Template

```csv
firstname,lastname,email,phone,jobtitle,contact_type,company_name
"Antoine","","","13152144258","Owner","Owner","Big Fellas Pizza"
```

### Deals Import Template

```csv
dealname,pipeline,dealstage,amount,closedate,associated_company
"Big Fellas Pizza - Outreach","Restaurant Outreach","interested","","","Big Fellas Pizza"
```

---

## Form Integration Guidelines

### Lead Capture Form Fields

For HubSpot forms capturing new restaurant leads:

| Field Label | HubSpot Property | Required | Type |
|------------|-----------------|----------|------|
| Restaurant Name | `company` (creates company) | ✅ | Text |
| Owner Name | `owner_name` (company property) | | Text |
| Phone Number | `phone` | ✅ | Phone |
| Email | `email` | | Email |
| Instagram Handle | `instagram_handle` | | Text |
| Website | `website` | | URL |
| Location/City | `city` | | Text |
| How did you hear about us? | `lead_source` | | Dropdown |
| Current Ordering System | `current_ods` | | Text |
| What challenges are you facing? | `pain_points` | | Textarea |

### Automation Triggers

After form submission:
1. Create Company record
2. Create associated Deal in "Cold - No Reply" stage
3. Create Task for follow-up call
4. Notify assigned team member

---

## Data Migration Checklist

- [ ] Create custom properties in HubSpot (Companies, Contacts, Deals)
- [ ] Create "Restaurant Outreach" pipeline with all stages
- [ ] Set up Instagram Actors custom object (optional)
- [ ] Prepare CSV exports from Google Sheets
- [ ] Map status values to deal stages
- [ ] Import Companies first
- [ ] Import Contacts and associate to Companies
- [ ] Create Deals for active opportunities
- [ ] Import historical call activities as engagements
- [ ] Set up forms for new lead capture
- [ ] Configure API integration for real-time sync

---

## Quick Reference: Status Mapping

| Old System Status | HubSpot Deal Stage | HubSpot Lifecycle Stage |
|-------------------|-------------------|------------------------|
| Cold | cold_no_reply | Lead |
| Callback | callback_scheduled | Lead |
| Interested | warm | Marketing Qualified Lead |
| Submitted | submitted | Sales Qualified Lead |
| Booked | demo_booked | Sales Qualified Lead |
| Paid | paid | Opportunity |
| Client | closed_won | Customer |
| Rejected | closed_lost_rejected | Other |
| Fumbled | closed_lost_fumbled | Other |
| Unqualified | closed_lost_unqualified | Other |
| Nurture | nurture | Marketing Qualified Lead |

---

## Notes for Future Development

1. **Multi-Phone Support**: Companies often have multiple phone numbers. Consider using a custom multi-value property or a separate Phone Numbers custom object.

2. **Call Outcomes**: HubSpot's native call engagement has limited outcome options. Use custom properties for detailed tracking like "Fumbled", "Wrong Number", etc.

3. **Instagram Actor Tracking**: If tracking which Instagram account performed outreach is important, create a custom object with associations to both team members and companies.

4. **KPI Reporting**: Use HubSpot's reporting for:
   - Calls made per day/week
   - Owner connection rate
   - Submission/conversion rate
   - Stage-by-stage conversion funnel

5. **Integration with PocketBase**: If continuing to use PocketBase for real-time call recording, set up webhooks to sync data to HubSpot.

---

*Last Updated: 2026-02-03*
*Version: 1.0*
