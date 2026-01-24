# CRM System Upgrade - Task Checklist

## Agent 1: Backend & Schema (Database, Types, Integrations)

### 1.1 Database Schema
- [ ] Update `pb_schema_exported.json` with `phone_numbers` collection
- [ ] Update `pb_schema_exported.json` with `call_logs` collection
- [ ] Update `pb_schema_exported.json` with `follow_ups` collection
- [ ] Update `pb_schema_exported.json` with `company_notes` collection
- [ ] Update `pb_schema_exported.json` with `interactions` collection
- [ ] Add `call_log`, `company`, `phone_number_record` fields to `recordings` collection
- [ ] Upload updated schema to PocketBase

### 1.2 TypeScript Types
- [ ] Add `PhoneNumber` interface to `types.ts`
- [ ] Add `CallLog` interface to `types.ts`
- [ ] Add `FollowUp` interface to `types.ts`
- [ ] Add `CompanyNote` interface to `types.ts`
- [ ] Add `Interaction` interface to `types.ts`
- [ ] Update `Recording` interface with new relations
- [ ] Add new collection constants to `COLLECTIONS`

### 1.3 Transcriber Integration
- [ ] Update transcriber to create `call_logs` instead of `cold_calls`
- [ ] Add receptionist name extraction to Gemini prompt
- [ ] Auto-create `follow_ups` when transcript mentions callback
- [ ] Link recordings to `call_logs`

### 1.4 Security Hardening
- [ ] Add input sanitization for filter strings
- [ ] Audit console.log for sensitive data
- [ ] Review and update PocketBase API rules

---

## Agent 2: Frontend & UI (Components, Pages, Styling)

### 2.1 Core UI Components
- [ ] Create `InlineEditField` component with undo (Ctrl+Z) and localStorage
- [ ] Create `PhoneNumberCard` component with label dropdown
- [ ] Create `CallLogForm` modal component
- [ ] Create `FollowUpAlert` component with timezone display
- [ ] Create `TimezoneClock` component for sidebar
- [ ] Create `BulkUploadModal` with preview table and toggle

### 2.2 Company Detail Page
- [ ] Create `/companies/[id]/page.tsx` route
- [ ] Implement Overview tab with inline editing
- [ ] Implement Phone Numbers tab with CRUD
- [ ] Implement Call History tab (per phone number)
- [ ] Implement Notes tab (pre-call research)
- [ ] Implement Timeline tab (all interactions)
- [ ] Add localStorage persistence for unsaved changes
- [ ] Add Save button to sync changes

### 2.3 Sidebar Enhancements
- [ ] Add timezone clocks section at bottom
- [ ] Implement add/remove timezone functionality
- [ ] Persist timezone preferences in localStorage

### 2.4 Recordings Page Updates
- [ ] Add bulk upload button
- [ ] Implement drag-drop file zone
- [ ] Add toggle for quick vs preview mode
- [ ] Show preview table with phone matching
- [ ] Link recordings to call_logs

### 2.5 Table Consistency
- [ ] Audit all tables for consistent padding/styling
- [ ] Ensure column selector on all tables
- [ ] Standardize search bar design
- [ ] Unify pagination controls (25/50/100)
- [ ] Match hover states across all tables

---

## Testing Checklist

> **See [testing_checklist.md](./testing_checklist.md) for detailed test cases with steps and expected outcomes.**

Quick summary:
- **Database Tests** (T1.1-T1.10): Records, relations, cascade delete, API rules
- **TypeScript Tests** (T2.1-T2.5): Interfaces compile, expand types work
- **UI Components** (T3.1-T3.17): InlineEdit, PhoneCard, CallLogForm, BulkUpload
- **Company Detail Page** (T4.1-T4.12): Tabs, CRUD, timeline, undo stack
- **Recordings Page** (T5.1-T5.5): Bulk upload, preview, matching
- **Table Consistency** (T6.1-T6.6): Columns, search, pagination, styling
- **Integration** (T7.1-T7.6): Auto-match, follow-ups, multi-channel

---

## Version Bumping (After All Tasks Complete)

### Dashboard
- [ ] Bump version in `apps/dashboard/package.json`
- [ ] Update changelog with new features

### PocketBase Client
- [ ] Bump version in `packages/pocketbase-client/package.json`
- [ ] Document schema changes

### Tools (if modified)
- [ ] Bump `tools/transcriber` version (if applicable)
- [ ] Bump `tools/audio-recorder` version (if applicable)

---

## Definition of Done

- [ ] All Agent 1 tasks completed
- [ ] All Agent 2 tasks completed
- [ ] All tests passing
- [ ] README.md updated with new features
- [ ] No TypeScript errors in dashboard
- [ ] UI matches design (black/white with accent colors)
