# CRM System Upgrade - Testing Checklist

> Run these tests after implementation is complete but before version bump.

---

## 1. Database Tests (Agent 1)

### T1.1: Create Company Record
**Steps:**
1. Open PocketBase Admin UI → `companies` collection
2. Click "New record"
3. Fill: company_name="Test Restaurant", status="Cold No Reply"
4. Save

**Expected:** Record created with auto-generated ID, timestamps set

---

### T1.2: Create Phone Number for Company
**Steps:**
1. Open `phone_numbers` collection
2. Create record with company=(select Test Restaurant), phone_number="5551234567", label="Main Line"
3. Save

**Expected:** Record created, relation to company visible in expand

---

### T1.3: Create Call Log for Phone Number
**Steps:**
1. Open `call_logs` collection
2. Create: company=(Test Restaurant), phone_number_record=(5551234567), call_time=now, call_outcome="Interested"
3. Save

**Expected:** Record created with both relations populated

---

### T1.4: Create Follow-up from Call Log
**Steps:**
1. Open `follow_ups` collection
2. Create: call_log=(previous call), company=(Test Restaurant), scheduled_time=(tomorrow), client_timezone="America/New_York", status="pending"
3. Save

**Expected:** Record created with relations

---

### T1.5: Verify Cascade Delete - Phone Numbers
**Steps:**
1. Delete the Test Restaurant company
2. Check `phone_numbers` collection

**Expected:** Related phone_number record should be deleted (cascade)

---

### T1.6: Verify Cascade Delete - Follow-ups
**Steps:**
1. Create new company, phone, call_log, follow_up
2. Delete the call_log
3. Check `follow_ups`

**Expected:** Follow-up deleted when call_log deleted

---

### T1.7: Test API Rules - Unauthenticated
**Steps:**
1. Open browser dev tools → Console
2. Run: `fetch('http://localhost:8090/api/collections/companies/records').then(r => r.json()).then(console.log)`

**Expected:** Error 401 or empty results (auth required)

---

### T1.8: Test Admin-Only Delete
**Steps:**
1. Login as non-admin user
2. Try to delete a company record via API

**Expected:** Delete should fail for non-admin

---

### T1.9: Verify Indexes Created
**Steps:**
1. In PocketBase Admin, view each new collection
2. Check "Indexes" tab

**Expected:** All collections should have appropriate indexes (company, phone, timestamp)

---

### T1.10: Test All Select Field Values
**Steps:**
1. For `call_logs`, try each call_outcome value
2. For `follow_ups`, try each status value
3. For `interactions`, try each channel value

**Expected:** All enum values save correctly

---

## 2. TypeScript Types Tests (Agent 1)

### T2.1: PhoneNumber Interface Compiles
**Steps:**
1. In dashboard, create file `test-types.ts`
2. Add: `import { PhoneNumber } from '@/lib/types'; const p: PhoneNumber = {} as PhoneNumber;`
3. Run `pnpm build`

**Expected:** No TypeScript errors for PhoneNumber

---

### T2.2: CallLog Interface Compiles
**Steps:**
1. Add: `import { CallLog } from '@/lib/types'; const c: CallLog = {} as CallLog;`
2. Run `pnpm build`

**Expected:** No TypeScript errors for CallLog

---

### T2.3: FollowUp Interface Compiles
**Steps:**
1. Add: `import { FollowUp } from '@/lib/types'; const f: FollowUp = {} as FollowUp;`
2. Run `pnpm build`

**Expected:** No TypeScript errors for FollowUp

---

### T2.4: Expand Types Work
**Steps:**
1. Create: `const log: CallLog = { expand: { company: { company_name: 'Test' } } } as CallLog;`
2. Access: `log.expand?.company?.company_name`
3. Run `pnpm build`

**Expected:** Type inference works, no errors

---

### T2.5: Collection Constants Exist
**Steps:**
1. Import: `import { COLLECTIONS } from '@/lib/types';`
2. Use: `COLLECTIONS.PHONE_NUMBERS`, `COLLECTIONS.CALL_LOGS`, etc.
3. Run `pnpm build`

**Expected:** All new constants exist and compile

---

## 3. UI Component Tests (Agent 2)

### T3.1: InlineEditField - Click to Edit
**Steps:**
1. Navigate to company detail page
2. Click on company name field
3. Verify input appears

**Expected:** Field becomes editable input on click

---

### T3.2: InlineEditField - Type and Change Value
**Steps:**
1. While in edit mode, type "New Name"
2. Click outside or press Enter

**Expected:** Value updates to "New Name", field exits edit mode

---

### T3.3: InlineEditField - Ctrl+Z Undo
**Steps:**
1. Edit company name to "Changed"
2. Press Ctrl+Z

**Expected:** Value reverts to original, shows as unchanged

---

### T3.4: InlineEditField - localStorage Persistence
**Steps:**
1. Edit company name (don't save)
2. Refresh the page

**Expected:** Unsaved change is restored from localStorage

---

### T3.5: PhoneNumberCard - Displays Correctly
**Steps:**
1. View company with phone numbers
2. Observe phone number cards

**Expected:** Shows phone, label badge, location, receptionist name

---

### T3.6: PhoneNumberCard - Label Dropdown
**Steps:**
1. Click label on phone number card
2. Select different label ("Owner Direct")
3. Save

**Expected:** Label updates and saves to database

---

### T3.7: PhoneNumberCard - Call History Accordion
**Steps:**
1. Click "View Calls" or expand icon on phone card
2. Observe call history

**Expected:** Shows calls sorted by date (newest first)

---

### T3.8: CallLogForm - Opens Modal
**Steps:**
1. Click "Log Call" button on phone number
2. Observe modal

**Expected:** Modal opens with form fields

---

### T3.9: CallLogForm - All Fields Work
**Steps:**
1. Fill: outcome=Callback, owner_name="John", receptionist="Maria", notes="Will call back"
2. Submit

**Expected:** Call log created with all fields, modal closes

---

### T3.10: CallLogForm - Follow-up Scheduler
**Steps:**
1. In call log form, enable "Schedule Follow-up"
2. Set date/time and timezone
3. Submit

**Expected:** Both call_log and follow_up created

---

### T3.11: FollowUpAlert - Timezone Conversion
**Steps:**
1. Create follow-up for 2pm EST
2. View as user in PST

**Expected:** Shows "2pm EST (11am your time)" or similar

---

### T3.12: TimezoneClock - Add Clock
**Steps:**
1. In sidebar, click "Add Timezone"
2. Select "America/Los_Angeles"
3. Observe clock

**Expected:** Clock shows current PST time, updates live

---

### T3.13: TimezoneClock - Persist on Refresh
**Steps:**
1. Add a timezone clock
2. Refresh the page

**Expected:** Clock still present after refresh (localStorage)

---

### T3.14: BulkUploadModal - Opens
**Steps:**
1. Navigate to /recordings
2. Click "Bulk Upload" button

**Expected:** Modal opens with drag-drop zone

---

### T3.15: BulkUploadModal - Drag Files
**Steps:**
1. Drag 3 audio files into drop zone

**Expected:** Files listed with names and sizes

---

### T3.16: BulkUploadModal - Preview Mode
**Steps:**
1. Toggle to "Preview" mode
2. Observe table

**Expected:** Shows each file with matched company/phone

---

### T3.17: BulkUploadModal - Confirm Upload
**Steps:**
1. With files in preview, click "Confirm"
2. Wait for upload

**Expected:** Progress shown, recordings created, modal closes

---

## 4. Company Detail Page Tests (Agent 2)

### T4.1: Page Loads
**Steps:**
1. Navigate to `/companies`
2. Click on any company row

**Expected:** `/companies/[id]` page loads without error

---

### T4.2: Tabs Render
**Steps:**
1. On company detail page, observe tabs

**Expected:** Tabs visible: Overview, Phone Numbers, Notes, Timeline (or similar)

---

### T4.3: Overview Tab - Company Info
**Steps:**
1. Click Overview tab
2. Observe company data

**Expected:** Shows company_name, owner_name, status, instagram, email

---

### T4.4: Phone Numbers Tab - List
**Steps:**
1. Click Phone Numbers tab
2. Observe list

**Expected:** All phone numbers for company displayed as cards

---

### T4.5: Phone Numbers Tab - Add New
**Steps:**
1. Click "Add Phone Number"
2. Fill: number, label, location
3. Save

**Expected:** New phone appears in list

---

### T4.6: Phone Numbers Tab - Call History Per Number
**Steps:**
1. Expand a phone number card
2. Observe call history

**Expected:** Shows calls only for that phone number

---

### T4.7: Notes Tab - Pre-call Notes
**Steps:**
1. Click Notes tab
2. Observe notes list

**Expected:** Pre-call research notes displayed

---

### T4.8: Notes Tab - Add Note
**Steps:**
1. Click "Add Note"
2. Select type="pre_call", write content
3. Save

**Expected:** Note appears in list

---

### T4.9: Timeline Tab - All Interactions
**Steps:**
1. Click Timeline tab
2. Observe timeline

**Expected:** Shows calls, DMs, emails in chronological order

---

### T4.10: Save Button - Syncs Changes
**Steps:**
1. Edit multiple fields inline
2. Click "Save" button

**Expected:** All changes sync to database, save confirmation shown

---

### T4.11: Unsaved Indicator
**Steps:**
1. Edit a field (don't save)
2. Observe UI

**Expected:** Visual indicator shows "Unsaved changes"

---

### T4.12: Multiple Undo Stack
**Steps:**
1. Make 3 edits
2. Press Ctrl+Z three times

**Expected:** Each undo reverts one change in order

---

## 5. Recordings Page Tests (Agent 2)

### T5.1: Bulk Upload Button Exists
**Steps:**
1. Navigate to /recordings

**Expected:** "Bulk Upload" button visible in header area

---

### T5.2: Quick Upload Mode
**Steps:**
1. Open bulk upload modal
2. Ensure "Quick" mode selected
3. Drop files

**Expected:** Simple list view, no preview table

---

### T5.3: Preview Mode - Phone Matching
**Steps:**
1. Drop file named "2024-01-20_15-30_5551234567.mp3"
2. Switch to Preview mode

**Expected:** Shows matched company name for phone 5551234567

---

### T5.4: Preview Mode - Manual Match
**Steps:**
1. For file with no match, click "Select Company"
2. Search and select a company

**Expected:** Company assigned to that recording

---

### T5.5: Recording Links to Call Log
**Steps:**
1. View a recording that was uploaded with a call
2. Observe relations

**Expected:** Shows linked call_log (if exists)

---

## 6. Table Consistency Tests (Agent 2)

### T6.1: Companies Table - Column Selector
**Steps:**
1. Navigate to /companies
2. Look for column visibility icon

**Expected:** Column selector exists, works to hide/show columns

---

### T6.2: Recordings Table - Same Features
**Steps:**
1. Navigate to /recordings
2. Check for column selector, search, pagination

**Expected:** All same features as companies table

---

### T6.3: Pagination - Options
**Steps:**
1. On any table, find pagination
2. Check per-page options

**Expected:** Options for 25, 50, 100 per page

---

### T6.4: Hover States Match
**Steps:**
1. Hover over rows in companies table
2. Hover over rows in recordings table

**Expected:** Same background color on hover

---

### T6.5: Row Padding Consistent
**Steps:**
1. Visually compare row heights/padding across tables

**Expected:** All tables use consistent padding (py-3 px-4)

---

### T6.6: Search Bar Design
**Steps:**
1. Compare search bars across pages

**Expected:** Same icon, placeholder, border styling

---

## 7. Integration Tests (Both Agents)

### T7.1: Recording Auto-Match by Phone
**Steps:**
1. Create company with phone number
2. Upload recording with that phone in filename

**Expected:** Recording auto-linked to company

---

### T7.2: Call Log Updates last_called
**Steps:**
1. Note phone number's last_called value
2. Create new call_log for that phone
3. Check phone_number record

**Expected:** last_called updated to call_time

---

### T7.3: Callback Creates Follow-up
**Steps:**
1. Create call_log with outcome="Callback"
2. Check follow_ups collection

**Expected:** Follow-up auto-created for next day

---

### T7.4: Instagram Interaction in Timeline
**Steps:**
1. Create interaction: channel="instagram", company=(test)
2. View company timeline

**Expected:** Instagram icon shown, interaction in timeline

---

### T7.5: Email Interaction in Timeline
**Steps:**
1. Create interaction: channel="email"
2. View company timeline

**Expected:** Email icon shown in timeline

---

### T7.6: Follow-up Alert Appears
**Steps:**
1. Create follow-up scheduled for now
2. Observe dashboard/sidebar

**Expected:** Alert/notification for due follow-up

---

## Final Verification

- [ ] All database tests passing
- [ ] All TypeScript tests passing
- [ ] All UI component tests passing
- [ ] All page tests passing
- [ ] All table tests passing
- [ ] All integration tests passing
- [ ] No console errors in browser
- [ ] No TypeScript errors on build
- [ ] Visual consistency verified
