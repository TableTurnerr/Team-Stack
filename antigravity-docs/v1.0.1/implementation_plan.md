# CRM System Upgrade - Implementation Plan

## Dual-Agent Execution Strategy

Tasks are divided between two agents that can work **independently**:

| Agent | Focus | Dependencies |
|-------|-------|--------------|
| **Agent 1** | Backend: Database schema, TypeScript types, Transcriber | None - can start immediately |
| **Agent 2** | Frontend: UI components, Pages, Styling | Needs Agent 1's TypeScript types (coordinate via types.ts) |

> [!IMPORTANT]
> **Coordination Point**: Agent 2 should wait for Agent 1 to complete TypeScript types (Section 1.2) before starting component development. Agent 2 can start with table consistency work immediately.

---

## Agent 1: Backend & Schema

### 1.1 Update pb_schema_exported.json

Add 5 new collections to the schema JSON:

#### phone_numbers
```json
{
    "name": "phone_numbers",
    "type": "base",
    "fields": [
        { "name": "company", "type": "relation", "required": true },
        { "name": "phone_number", "type": "text", "required": true },
        { "name": "label", "type": "text" },
        { "name": "location_name", "type": "text" },
        { "name": "location_address", "type": "text" },
        { "name": "receptionist_name", "type": "text" },
        { "name": "last_called", "type": "date" }
    ]
}
```

#### call_logs
```json
{
    "name": "call_logs",
    "fields": [
        { "name": "company", "type": "relation", "required": true },
        { "name": "phone_number_record", "type": "relation", "required": true },
        { "name": "caller", "type": "relation" },
        { "name": "call_time", "type": "date", "required": true },
        { "name": "duration", "type": "number" },
        { "name": "call_outcome", "type": "select" },
        { "name": "owner_name_found", "type": "text" },
        { "name": "receptionist_name", "type": "text" },
        { "name": "post_call_notes", "type": "text" },
        { "name": "interest_level", "type": "number" },
        { "name": "status_changed_to", "type": "select" },
        { "name": "has_recording", "type": "bool" }
    ]
}
```

#### follow_ups
```json
{
    "name": "follow_ups",
    "fields": [
        { "name": "call_log", "type": "relation" },
        { "name": "company", "type": "relation", "required": true },
        { "name": "scheduled_time", "type": "date", "required": true },
        { "name": "client_timezone", "type": "text", "required": true },
        { "name": "assigned_to", "type": "relation" },
        { "name": "notes", "type": "text" },
        { "name": "status", "type": "select", "required": true },
        { "name": "completed_at", "type": "date" }
    ]
}
```

#### company_notes
```json
{
    "name": "company_notes",
    "fields": [
        { "name": "company", "type": "relation", "required": true },
        { "name": "phone_number_record", "type": "relation" },
        { "name": "note_type", "type": "select", "required": true },
        { "name": "content", "type": "text", "required": true },
        { "name": "created_by", "type": "relation", "required": true }
    ]
}
```

#### interactions
```json
{
    "name": "interactions",
    "fields": [
        { "name": "company", "type": "relation", "required": true },
        { "name": "channel", "type": "select", "required": true },
        { "name": "direction", "type": "select", "required": true },
        { "name": "timestamp", "type": "date", "required": true },
        { "name": "user", "type": "relation" },
        { "name": "summary", "type": "text" },
        { "name": "call_log", "type": "relation" }
    ]
}
```

### 1.2 TypeScript Types

**File**: `apps/dashboard/src/lib/types.ts`

Add interfaces for all new collections with proper expand types.

### 1.3 Transcriber Updates

**File**: `tools/transcriber/transcribe_calls.py`

- Update to create `call_logs` records
- Add receptionist extraction to prompt
- Auto-create follow_ups on callback detection

---

## Agent 2: Frontend & UI

### 2.1 Components

| Component | File | Purpose |
|-----------|------|---------|
| InlineEditField | `components/inline-edit-field.tsx` | Editable field with undo, localStorage |
| PhoneNumberCard | `components/phone-number-card.tsx` | Phone with label, call history |
| CallLogForm | `components/call-log-form.tsx` | Modal for logging calls |
| FollowUpAlert | `components/follow-up-alert.tsx` | Alert with timezone conversion |
| TimezoneClock | `components/timezone-clock.tsx` | Clock widget |
| BulkUploadModal | `components/bulk-upload-modal.tsx` | Drag-drop with preview |

### 2.2 Pages

| Page | File | Purpose |
|------|------|---------|
| Company Detail | `app/(dashboard)/companies/[id]/page.tsx` | Tabbed detail view |

### 2.3 Modifications

| File | Changes |
|------|---------|
| `components/sidebar.tsx` | Add timezone clocks section |
| `app/(dashboard)/recordings/page.tsx` | Add bulk upload, link to call_logs |
| `app/(dashboard)/companies/page.tsx` | Navigate to detail on click |

---

## Files Changed Summary

### Agent 1 Files
| Type | Path |
|------|------|
| MODIFY | `packages/pocketbase-client/pb_schema_exported.json` |
| MODIFY | `apps/dashboard/src/lib/types.ts` |
| MODIFY | `tools/transcriber/transcribe_calls.py` |

### Agent 2 Files
| Type | Path |
|------|------|
| NEW | `apps/dashboard/src/components/inline-edit-field.tsx` |
| NEW | `apps/dashboard/src/components/phone-number-card.tsx` |
| NEW | `apps/dashboard/src/components/call-log-form.tsx` |
| NEW | `apps/dashboard/src/components/follow-up-alert.tsx` |
| NEW | `apps/dashboard/src/components/timezone-clock.tsx` |
| NEW | `apps/dashboard/src/components/bulk-upload-modal.tsx` |
| NEW | `apps/dashboard/src/app/(dashboard)/companies/[id]/page.tsx` |
| MODIFY | `apps/dashboard/src/components/sidebar.tsx` |
| MODIFY | `apps/dashboard/src/app/(dashboard)/recordings/page.tsx` |
| MODIFY | `apps/dashboard/src/app/(dashboard)/companies/page.tsx` |

---

## Verification Plan

### Agent 1 Verification
1. Upload schema to PocketBase Admin UI
2. Create test records via Admin UI
3. Run `pnpm build` - verify no TypeScript errors
4. Run transcriber on test recording - verify call_log created

### Agent 2 Verification
1. Run `pnpm dev` in dashboard
2. Navigate to each new component - verify renders
3. Test inline editing with Ctrl+Z undo
4. Test bulk upload with preview table
5. Manual visual consistency check

---

## README Updates Required

After both agents complete, update `/README.md` with:
- New features list
- Updated architecture diagram
- New data model documentation
