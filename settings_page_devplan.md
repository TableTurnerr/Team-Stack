# Settings Page Development Plan - Tableturnerr CRM

## Context & Instructions for AI Agent

You are implementing a comprehensive Settings page for **Tableturnerr CRM**, a full-stack sales operations platform for restaurant/business outreach. The settings page currently exists as a placeholder at `/apps/dashboard/src/app/(dashboard)/settings/page.tsx`.

### Tech Stack
- **Framework**: Next.js 15 with App Router, React 19
- **Backend**: PocketBase 0.21.0 (self-hosted SQLite)
- **Styling**: Tailwind CSS 4.0 with CSS custom properties (see `globals.css`)
- **Icons**: Lucide React (import from `lucide-react`)
- **Theme**: `next-themes` for light/dark mode
- **Auth**: PocketBase auth with roles (`admin` | `operator` | `member`)
- **No external UI library** - build custom components matching existing style

### Design System Reference
Follow the existing design patterns in the codebase:
- Cards use `bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl`
- Buttons use `btn-primary`, `btn-danger`, `btn-ghost` classes
- Text colors: `text-[var(--foreground)]` for primary, `text-[var(--muted)]` for secondary
- Inputs use custom styling from `globals.css`
- Use skeleton loaders for loading states (see existing skeleton patterns)

---

## Settings Page Architecture

Create a tabbed/sectioned settings interface with the following structure:

```
/settings
├── Profile           (all users)
├── Account           (all users)
├── Appearance        (all users)
├── Notifications     (all users)
├── Preferences       (all users)
├── Team Management   (admin only)
├── Integrations      (admin only)
└── Data & Privacy    (all users)
```

Use a sidebar navigation pattern within the settings page (similar to GitHub/Discord settings).

---

## Section 1: Profile Settings

### Purpose
Allow users to manage their personal profile information.

### Fields to Implement

| Field | Type | Validation | Notes |
|-------|------|------------|-------|
| Display Name | text input | required, 2-50 chars | Updates `users.name` |
| Email | text input | valid email format | Updates `users.email`, may require verification |
| Avatar | file upload | image only, max 2MB | Store in PocketBase files, show preview |
| Bio/Description | textarea | optional, max 500 chars | New field if not exists |
| Phone Number | text input | optional, phone format | For contact purposes |

### UI Components Needed
- Avatar upload with drag-drop and preview
- Form with inline validation
- Success/error toast notifications
- "Save Changes" button with loading state

### Code Reference
- Auth context: `/apps/dashboard/src/contexts/auth-context.tsx`
- User type: `/apps/dashboard/src/lib/types.ts` (search for `User` interface)
- PocketBase client: `/apps/dashboard/src/lib/pocketbase.ts`

---

## Section 2: Account Security

### Purpose
Manage authentication and security settings.

### Features to Implement

#### 2.1 Password Change
- Current password field
- New password field with strength indicator
- Confirm password field
- Show/hide password toggle
- Validation: min 8 chars, at least 1 number, 1 special char

#### 2.2 Active Sessions
- List all active sessions (if PocketBase supports this)
- Show: device type, browser, IP, last active
- "Sign out all other sessions" button
- "Sign out" button per session

#### 2.3 Two-Factor Authentication (Future)
- Placeholder section with "Coming Soon" badge
- Brief description of what 2FA will provide

#### 2.4 Connected Accounts
- Show Google OAuth connection status
- "Connect" / "Disconnect" buttons
- Visual indicator (green checkmark when connected)

### UI Components Needed
- Password input with visibility toggle
- Password strength meter (weak/medium/strong)
- Session list with action buttons
- Confirmation modal for dangerous actions

---

## Section 3: Appearance Settings

### Purpose
Customize the visual experience of the application.

### Features to Implement

#### 3.1 Theme Selection
- Light mode
- Dark mode
- System (auto-detect from OS)
- Use `next-themes` `useTheme()` hook

#### 3.2 Display Density
- Comfortable (default, more padding)
- Compact (reduced padding, more data visible)
- Store preference in localStorage

#### 3.3 Sidebar Timezone Clocks
The sidebar shows timezone clocks. Allow configuration:
- Add/remove timezones (up to 4)
- Reorder timezones
- Timezone search/picker component
- Store in localStorage (see existing `TimezoneClock` component)

#### 3.4 Accent Color (Optional/Future)
- Preset color options for primary accent
- Modifies `--primary` CSS variable

### UI Components Needed
- Theme toggle buttons with icons (Sun, Moon, Monitor)
- Timezone picker with search
- Drag-to-reorder list for timezones
- Color swatch selector

### Code Reference
- Theme provider: check `layout.tsx` for ThemeProvider usage
- Timezone clock: `/apps/dashboard/src/components/timezone-clock.tsx`

---

## Section 4: Notification Settings

### Purpose
Control how and when users receive alerts and notifications.

### Features to Implement

#### 4.1 In-App Notifications
| Setting | Type | Default |
|---------|------|---------|
| Follow-up reminders | toggle | ON |
| Team activity updates | toggle | ON |
| New recording alerts | toggle | ON |
| System announcements | toggle | ON |

#### 4.2 Email Notifications
| Setting | Type | Default |
|---------|------|---------|
| Daily follow-up digest | toggle | OFF |
| Weekly performance summary | toggle | OFF |
| New team member joined | toggle | ON (admin only) |
| Important system updates | toggle | ON |

#### 4.3 Notification Sound
- Enable/disable notification sounds
- Sound selection dropdown (if multiple options)
- Volume slider

#### 4.4 Do Not Disturb
- Schedule quiet hours (start time, end time)
- Day selection (weekdays only, etc.)

### UI Components Needed
- Toggle switches with labels
- Time picker for quiet hours
- Day-of-week checkbox group
- Section dividers with descriptions

### Database Consideration
May need a new `user_preferences` or `notification_settings` collection in PocketBase, or store as JSON in user record.

---

## Section 5: Preferences (Workflow Settings)

### Purpose
Customize default behaviors and workflow preferences.

### Features to Implement

#### 5.1 Table Defaults
| Setting | Type | Options |
|---------|------|---------|
| Default page size | dropdown | 10, 25, 50, 100 |
| Default sort order | dropdown | Newest first, Oldest first, Alphabetical |
| Remember column visibility | toggle | ON/OFF |

#### 5.2 Follow-Up Defaults
| Setting | Type | Notes |
|---------|------|-------|
| Default reminder time | time picker | e.g., 9:00 AM |
| Default follow-up interval | dropdown | 1 day, 3 days, 1 week |
| Auto-create follow-up on "Callback" outcome | toggle | |

#### 5.3 Cold Call Defaults
| Setting | Type | Notes |
|---------|------|-------|
| Default call outcome | dropdown | None, No Answer |
| Auto-start recording | toggle | |
| Show transcript panel by default | toggle | |

#### 5.4 Company View Defaults
| Setting | Type | Notes |
|---------|------|-------|
| Default status filter | multi-select | Which statuses to show |
| Expanded/collapsed view | toggle | |

### Storage
Use localStorage for non-critical preferences, PocketBase for important ones that should sync across devices.

### Code Reference
- Column visibility hook: `/apps/dashboard/src/hooks/use-column-visibility.ts`
- Follow-up types: check `types.ts` for `FollowUp` interface

---

## Section 6: Team Management (Admin Only)

### Purpose
Allow admins to manage team members, roles, and permissions.

### Access Control
- Only visible to users with `role === 'admin'`
- Redirect non-admins who try to access directly

### Features to Implement

#### 6.1 Team Members List
- Table with: Name, Email, Role, Status, Last Active, Actions
- Search/filter functionality
- Pagination

#### 6.2 Role Management
| Action | Description |
|--------|-------------|
| Change role | Dropdown: admin, operator, member |
| Suspend user | Sets status to `suspended` |
| Reactivate user | Sets status back to `offline` |
| Remove from team | Soft delete or full removal |

#### 6.3 Invite New Members
- Email input field
- Role selection
- "Send Invite" button
- Pending invites list

#### 6.4 Role Permissions Display
Show a permissions matrix:

| Permission | Admin | Operator | Member |
|------------|-------|----------|--------|
| View all companies | ✓ | ✓ | ✓ |
| Edit companies | ✓ | ✓ | ✗ |
| Delete companies | ✓ | ✗ | ✗ |
| Manage team | ✓ | ✗ | ✗ |
| Access settings | ✓ | ✓ | ✓ |
| View reports | ✓ | ✓ | ✗ |

### UI Components Needed
- User table with role badges
- Role selector dropdown
- Confirmation modals for dangerous actions
- Invite form with validation
- Status badges (online/offline/suspended)

### Code Reference
- Team page: `/apps/dashboard/src/app/(dashboard)/team/page.tsx`
- User roles: defined in `types.ts`

---

## Section 7: Integrations (Admin Only)

### Purpose
Manage external service connections and API settings.

### Features to Implement

#### 7.1 Instagram Actors Management
- List connected Instagram accounts
- Status indicators (active/rate-limited/disconnected)
- Quick link to full Actors page
- Add new actor shortcut

#### 7.2 API Configuration (Future)
- API key generation and management
- Webhook URL configuration
- Rate limit display

#### 7.3 PocketBase Connection
- Connection status indicator
- Server URL display (read-only)
- "Test Connection" button
- Last sync timestamp

#### 7.4 Export/Import Configuration
- Export all settings as JSON
- Import settings from JSON file
- Reset to defaults button (with confirmation)

### Code Reference
- Actors page: `/apps/dashboard/src/app/(dashboard)/actors/page.tsx`
- PocketBase client: `/apps/dashboard/src/lib/pocketbase.ts`

---

## Section 8: Data & Privacy

### Purpose
Give users control over their data.

### Features to Implement

#### 8.1 Data Export
- "Export My Data" button
- Downloads JSON/CSV with:
  - Profile information
  - Activity history
  - Companies they created
  - Call logs they made
- Show progress indicator during export

#### 8.2 Activity Log
- List of recent account activities:
  - Login/logout events
  - Password changes
  - Settings changes
- Filterable by date range
- Paginated list (last 100 entries)

#### 8.3 Privacy Settings
| Setting | Description |
|---------|-------------|
| Show online status | Toggle whether others see you as online |
| Activity visibility | Who can see your activity (team/admins only) |

#### 8.4 Delete Account
- "Delete My Account" button (members only, not admins)
- Requires password confirmation
- Clear warning about data loss
- 30-day grace period mention

### UI Components Needed
- Download button with progress
- Activity timeline/list
- Danger zone section styling (red border)
- Multi-step deletion confirmation modal

---

## Implementation Guidelines

### File Structure
Create the following file structure:

```
/apps/dashboard/src/app/(dashboard)/settings/
├── page.tsx                    # Main settings layout with sidebar nav
├── loading.tsx                 # Skeleton loader
├── layout.tsx                  # Optional: settings-specific layout
└── components/
    ├── settings-nav.tsx        # Sidebar navigation
    ├── profile-section.tsx     # Profile settings
    ├── account-section.tsx     # Account security
    ├── appearance-section.tsx  # Theme & display
    ├── notifications-section.tsx
    ├── preferences-section.tsx
    ├── team-section.tsx        # Admin only
    ├── integrations-section.tsx # Admin only
    └── data-privacy-section.tsx
```

### State Management
- Use React `useState` and `useEffect` for local state
- Use `useAuth()` context for user data
- Use PocketBase SDK for data persistence
- Use localStorage for non-critical preferences

### Form Handling Pattern
```tsx
// Recommended pattern for settings forms
const [formData, setFormData] = useState(initialData)
const [isLoading, setIsLoading] = useState(false)
const [isDirty, setIsDirty] = useState(false)
const [error, setError] = useState<string | null>(null)
const [success, setSuccess] = useState(false)

// Track changes
useEffect(() => {
  setIsDirty(JSON.stringify(formData) !== JSON.stringify(initialData))
}, [formData, initialData])

// Show "unsaved changes" warning if navigating away while dirty
```

### Toast/Notification Pattern
Create or use a toast component for success/error feedback:
- Success: green background, checkmark icon
- Error: red background, X icon
- Auto-dismiss after 3-5 seconds
- Stack multiple toasts

### Responsive Design
- Settings sidebar collapses to dropdown on mobile
- Form fields stack vertically on small screens
- Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)

### Accessibility Requirements
- All form inputs have associated labels
- Use `aria-describedby` for help text
- Focus management when switching sections
- Keyboard navigation support
- Sufficient color contrast

### Loading States
- Show skeleton loaders when fetching initial data
- Show spinner on buttons during save operations
- Disable form while saving
- Optimistic updates where appropriate

---

## Priority Order for Implementation

### Phase 1 (Core - Must Have)
1. Settings page layout with navigation
2. Profile section
3. Appearance section (theme toggle)
4. Account section (password change)

### Phase 2 (Important)
5. Preferences section
6. Notifications section
7. Team Management (admin)

### Phase 3 (Enhancement)
8. Integrations section
9. Data & Privacy section
10. Advanced features (2FA placeholder, etc.)

---

## Testing Checklist

After implementation, verify:

- [ ] All sections render without errors
- [ ] Theme switching works and persists
- [ ] Profile changes save to PocketBase
- [ ] Password change validation works
- [ ] Admin-only sections are hidden from non-admins
- [ ] Form validation shows appropriate errors
- [ ] Success/error toasts appear correctly
- [ ] Loading states display during async operations
- [ ] Settings persist after page refresh
- [ ] Responsive design works on mobile
- [ ] Keyboard navigation works
- [ ] No console errors or warnings

---

## Additional Notes

- The existing sidebar component is at `/apps/dashboard/src/components/sidebar.tsx` - reference its styling
- Check `globals.css` for existing button, input, and card styles before creating new ones
- The auth context provides `user`, `logout`, and role information
- PocketBase collections are documented in `/packages/pocketbase-client/planned_schema.dbml`
- When in doubt about styling, look at existing pages like `/companies` or `/cold-calls` for patterns

---

## Questions to Consider During Implementation

1. Should settings sync across devices via PocketBase or stay local?
2. What's the backup/restore strategy for user settings?
3. How should we handle settings migrations when adding new options?
4. Do we need audit logging for admin actions in team management?

---

Good luck with the implementation! The goal is a clean, intuitive settings experience that matches the existing design language of Tableturnerr CRM.
