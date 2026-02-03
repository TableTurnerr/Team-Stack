# @crm/hubspot

HubSpot CRM integration module for TableTurnerr. Automates schema setup and data migration.

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env and add your HUBSPOT_ACCESS_TOKEN

# 3. Create all custom properties in HubSpot
pnpm tsx src/setup-schema.ts

# 4. Test with a demo company
pnpm tsx src/migrate-companies.ts demo
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm tsx src/setup-schema.ts` | Creates all custom properties in HubSpot |
| `pnpm tsx src/migrate-companies.ts demo` | Creates a test company |
| `pnpm tsx src/migrate-companies.ts csv <file>` | Import companies from CSV |

## Custom Properties Created

### Companies (15 properties)
- `restaurant_status` - Dropdown: Cold No Reply, Replied, Warm, Booked, Paid, Client, Excluded
- `owner_name` - Text
- `instagram_handle` - Text
- `google_maps_link` - URL
- `google_rating` - Number (1.0-5.0)
- `google_review_count` - Number
- `pain_points` - Multi-line text
- `lead_source` - Dropdown: GMaps Scraper, Manual, Instagram, Cold Calling, Referral
- `current_ods` - Text (ordering systems used)
- `has_seo` - Checkbox
- `offers_direct_delivery` - Checkbox
- `first_contacted_date` - Date
- `last_contacted_date` - Date
- `contact_source` - Text
- `owner_email` - Email

### Contacts (3 properties)
- `contact_type` - Dropdown: Owner, Manager, Receptionist, Decision Maker
- `best_call_time` - Text
- `timezone` - Dropdown (US timezones)

### Deals (2 properties)
- `call_outcome` - Dropdown: Interested, Not Interested, Callback, No Answer, etc.
- `interest_level` - Number (1-10)

## HubSpot Setup Requirements

1. Create a **Private App** in HubSpot:
   - Go to Settings → Integrations → Private Apps
   - Create new app with these scopes:
     - `crm.schemas.custom.read`
     - `crm.schemas.custom.write`
     - `crm.objects.companies.read`
     - `crm.objects.companies.write`
     - `crm.objects.contacts.read`
     - `crm.objects.contacts.write`
     - `crm.objects.deals.read`
     - `crm.objects.deals.write`

2. Copy the access token to your `.env` file

## Files

```
packages/hubspot/
├── .env.example          # Environment template
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── HUBSPOT_CONTEXT.md    # Full schema documentation
├── README.md             # This file
└── src/
    ├── setup-schema.ts   # Property creation script
    └── migrate-companies.ts  # Company migration scaffold
```

## Related Docs

See [HUBSPOT_CONTEXT.md](./HUBSPOT_CONTEXT.md) for complete property mappings, pipeline configuration, and CSV import templates.
