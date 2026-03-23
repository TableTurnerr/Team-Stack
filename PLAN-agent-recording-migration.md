# Plan: Migrate Call Recording & Monitoring to Local Agent

## Context

The CRM dashboard currently handles call recording via browser APIs (`getDisplayMedia()` + `getUserMedia()` + Web Audio API) and call monitoring via Zoom iframe `postMessage()` events. This architecture causes instability and glitching during heavy calling sessions — the browser struggles with simultaneous screen sharing, audio mixing, and UI rendering while making rapid calls via the power dialer.

The goal is to shift **all call monitoring and recording** to the local Windows desktop agent (`.NET 8 C#`), making the CRM dashboard a thin UI control layer that stays synchronized with the agent. Recordings are stored locally on the user's device and uploaded to PocketBase in the background.

---

## Current Architecture (What Exists Today)

### Browser-Based Recording (`apps/dashboard/src/hooks/use-call-recorder.ts`)
- `getDisplayMedia()` captures system audio (requires screen share permission)
- `getUserMedia()` captures microphone
- Web Audio API mixes both streams
- `MediaRecorder` records as WebM/Opus with 250ms timeslice
- Deferred mode queues recordings in memory for batch submission
- Uploads directly to PocketBase `recordings` collection via FormData
- Auto-starts on ringing/connected, auto-stops on ended

### Zoom Phone Dialer (`apps/dashboard/src/contexts/zoom-phone-context.tsx`)
- Zoom Phone iframe embedded in dashboard
- `postMessage()` events: ringing, connected, ended, failed
- Phone number extraction from Zoom event payloads
- Call direction detection (outbound intent, own-number filtering)
- 500ms ended→idle delay for form submission window

### Local Windows Agent (`tools/local-CRM-Agent/`)
- .NET 8 C# application with Fleck WebSocket server at `ws://127.0.0.1:9876`
- **Already has**: WASAPI audio session monitoring (`ZoomAudioMonitor.cs`, 584 lines), window title parsing for phone numbers (`ZoomWindowMonitor.cs`), network quality monitoring, call state fusion (idle/ringing/connected/ended with confidence levels)
- **Current messages**: `callState`, `networkQuality`, `heartbeat`, `zoomAction`
- **Current commands**: `launchZoom`, `checkZoom`
- Agent call state is currently display-only — not used for call gating (was removed to avoid re-renders)

### Standalone Desktop Recorder (`tools/audio-recorder/recorder.py`)
- Python tool with WASAPI loopback capture, 440Hz beep detection, MP3 export
- Filename format: `recording_DD-MM-YYYY_HH-MM-SS_PHONENUMBER.mp3`
- **Not integrated** with the .NET agent or CRM — proves the pattern works on Windows

### Database (`packages/pocketbase-client/pb_db_schema.json`)
- `recordings` collection: `{id, phone_number, uploader, file (max 100MB), note, recording_date, duration, call_log (relation), company, phone_number_record, original_filename}`
- `call_logs` collection: `{has_recording (boolean), ...}`
- Recordings linked to call_logs via `call_log` relation field

---

## New Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CRM Dashboard                         │
│  (UI controls, call form, power dialer, recordings list) │
│                                                          │
│  Sends commands:   startRecording, stopRecording,        │
│                    linkRecording, setAutoRecord,          │
│                    setUploadConfig                        │
│                                                          │
│  Receives state:   recordingState, recordingCompleted,   │
│                    recordingUploaded, callState,          │
│                    uploadQueueStatus                      │
└──────────────────────┬──────────────────────────────────┘
                       │ WebSocket (ws://127.0.0.1:9876)
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Local Windows Agent                     │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ CallStateFusion  │  │ AudioRecorderService (NEW)   │  │
│  │ (WASAPI monitor) │──│ WASAPI loopback capture      │  │
│  │ idle/ring/conn/  │  │ WAV → MP3 conversion         │  │
│  │ ended detection  │  │ Auto-start/stop on call      │  │
│  └─────────────────┘  │ state changes                 │  │
│                        └──────────────┬───────────────┘  │
│                                       │                   │
│  ┌─────────────────┐  ┌──────────────▼───────────────┐  │
│  │ RecordingStorage │  │ RecordingUploadService (NEW) │  │
│  │ Manager (NEW)    │──│ Background PocketBase upload  │  │
│  │ Local files +    │  │ Retry with exponential backoff│  │
│  │ JSON manifest    │  │ Auth token relay from CRM     │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│                                                          │
│  Local Storage: %USERPROFILE%\Documents\CRM Recordings\  │
│  Files: {yyyy-MM-dd_HH-mm-ss-fff}_{phoneNumber}.mp3     │
└──────────────────────────────────────────────────────────┘
                       │
                       │ HTTP REST (background)
                       ▼
              ┌─────────────────┐
              │   PocketBase     │
              │   recordings     │
              │   collection     │
              └─────────────────┘
```

---

## Phase 1: Agent-Side Recording Infrastructure

### 1.1 New Dependency

Add `NAudio.Lame` NuGet package for MP3 encoding. The agent already uses `NAudio 2.2.1` for WASAPI session monitoring.

**File**: `tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj`

### 1.2 New Service: `AudioRecorderService.cs`

**Location**: `tools/local-CRM-Agent/src/LocalCrmAgent/Services/AudioRecorderService.cs`

**Responsibilities**:
- WASAPI loopback capture using `WasapiLoopbackCapture` (targets default render device — same device `ZoomAudioMonitor` already monitors)
- Records to temporary WAV via `WaveFileWriter`, converts to MP3 on stop via NAudio.Lame
- State machine: `Idle → Recording → Stopping → Idle`
- Subscribes to `CallStateFusion.StateChanged` for auto-record triggers
- Exposes `StateChanged` event for WebSocket broadcasting

**Key interface**:
```csharp
public enum RecordingState { Idle, Recording, Stopping, Error }

public (bool success, string? error) StartRecording(string phoneNumber);
public (bool success, string filePath) StopRecording();
public void DiscardRecording();

// Properties
public RecordingState CurrentState { get; }
public string? CurrentFilePath { get; }
public int DurationSeconds { get; }
public string? CurrentPhoneNumber { get; }

// Events
public event Action<RecordingState, string?>? StateChanged;
```

**Auto-record integration with CallStateFusion**:
- `Ringing → Connected`: Auto-start recording (if `autoRecordEnabled`)
- `Connected → Ended`: Auto-stop recording
- `Ringing → Ended` (unanswered): Discard recording
- Configurable: `autoRecordEnabled`, `recordOnRinging` vs `recordOnConnected`

### 1.3 New Service: `RecordingStorageManager.cs`

**Location**: `tools/local-CRM-Agent/src/LocalCrmAgent/Services/RecordingStorageManager.cs`

**Responsibilities**:
- Default directory: `%USERPROFILE%\Documents\CRM Recordings\`
- File naming: `{yyyy-MM-dd_HH-mm-ss-fff}_{phoneNumber}.mp3`
  - Example: `2026-03-19_14-30-15-123_18085551234.mp3`
  - Millisecond precision for unique identification
  - Phone number sanitized (digits and `+` only)
- JSON manifest file (`recordings.json`) tracking all recordings:
  ```json
  {
    "fileName": "2026-03-19_14-30-15-123_18085551234.mp3",
    "phoneNumber": "+18085551234",
    "startTime": "2026-03-19T14:30:15.123Z",
    "durationSeconds": 145,
    "fileSizeBytes": 1234567,
    "uploaded": false,
    "uploadedAt": null,
    "pocketbaseRecordingId": null,
    "callLogId": null,
    "retryCount": 0,
    "error": null
  }
  ```
- Manifest loaded on startup, persisted on every change
- Enables offline resilience: recordings are safe locally regardless of CRM/PocketBase availability

---

## Phase 2: Extended WebSocket Protocol

### 2.1 New Messages: Agent → Dashboard

**`recordingState`** (broadcast every 1s during recording):
```json
{
  "type": "recordingState",
  "state": "idle | recording | stopping | error",
  "fileName": "2026-03-19_14-30-15-123_18085551234.mp3",
  "phoneNumber": "+18085551234",
  "duration": 45,
  "error": null,
  "timestamp": 1710859815123
}
```

**`recordingCompleted`** (broadcast once when recording finishes):
```json
{
  "type": "recordingCompleted",
  "fileName": "2026-03-19_14-30-15-123_18085551234.mp3",
  "phoneNumber": "+18085551234",
  "duration": 145,
  "fileSizeBytes": 1234567,
  "startTime": "2026-03-19T14:30:15.123Z",
  "timestamp": 1710859960123
}
```

**`recordingUploaded`** (broadcast once when background upload completes):
```json
{
  "type": "recordingUploaded",
  "fileName": "2026-03-19_14-30-15-123_18085551234.mp3",
  "pocketbaseRecordingId": "abc123def456",
  "callLogId": "xyz789",
  "success": true,
  "error": null,
  "timestamp": 1710860000000
}
```

**`uploadQueueStatus`** (broadcast periodically or on change):
```json
{
  "type": "uploadQueueStatus",
  "pendingCount": 3,
  "failedCount": 1,
  "currentUpload": "2026-03-19_14-30-15-123_18085551234.mp3",
  "timestamp": 1710860000000
}
```

### 2.2 New Commands: Dashboard → Agent

| Command | Payload | Purpose |
|---------|---------|---------|
| `startRecording` | `{ phoneNumber }` | Manual recording start |
| `stopRecording` | `{}` | Manual recording stop |
| `discardRecording` | `{}` | Discard current recording |
| `setAutoRecord` | `{ enabled, onRinging }` | Configure auto-record behavior |
| `getRecordingStatus` | `{}` | Request current recording state |
| `linkRecording` | `{ fileName, callLogId }` | Link recording to call_log before upload |
| `uploadRecording` | `{ fileName }` | Manually trigger upload for a file |
| `setUploadConfig` | `{ pocketbaseUrl, authToken, uploaderId }` | Relay PocketBase auth for uploads |

### 2.3 Heartbeat Extension

Extend the existing `heartbeat` message to include recording/upload health:
```json
{
  "type": "heartbeat",
  "version": "2.0.0",
  "uptime": 3600,
  "zoomDetected": true,
  "connectedClients": 1,
  "isRecording": true,
  "recordingDuration": 45,
  "uploadsPending": 2,
  "uploadsFailed": 0,
  "timestamp": 1710860000000
}
```

### 2.4 Files to Modify

**`tools/local-CRM-Agent/src/LocalCrmAgent/Services/WebSocketServer.cs`**: Extend `HandleClientMessage()` switch with all new command cases. Add `AudioRecorderService` and `RecordingUploadService` as constructor dependencies. Add recording state broadcasting to the periodic broadcast loop.

**`tools/local-CRM-Agent/src/LocalCrmAgent/Models/Messages.cs`**: Add all new message model classes.

---

## Phase 3: Background Upload System

### 3.1 New Service: `RecordingUploadService.cs`

**Location**: `tools/local-CRM-Agent/src/LocalCrmAgent/Services/RecordingUploadService.cs`

**Responsibilities**:
- Background thread processes upload queue from `RecordingStorageManager` manifest
- Uses PocketBase REST API directly via `HttpClient` (no SDK needed)
- Authenticates using token relayed from dashboard via `setUploadConfig`

### 3.2 Upload API Call

```
POST {pocketbaseUrl}/api/collections/recordings/records
Content-Type: multipart/form-data
Authorization: {authToken}

FormData:
  file:                  (binary MP3)
  phone_number:          "+18085551234"
  uploader:              "{uploaderId}"
  original_filename:     "2026-03-19_14-30-15-123_18085551234.mp3"
  duration:              145
  recording_date:        "2026-03-19T14:30:15Z"
  note:                  "Recorded by CRM Agent on 2026-03-19 at 14:30"
  call_log:              "{callLogId}"           // if linked
  phone_number_record:   "{phoneNumberRecordId}" // looked up
  company:               "{companyId}"           // looked up
```

### 3.3 Phone Number Resolution

Before uploading, look up the phone number record:
```
GET {pocketbaseUrl}/api/collections/phone_numbers/records?filter=phone_number~"{phone}"&expand=company
```
This resolves `phone_number_record` and `company` relations — same logic currently in `use-call-recorder.ts` lines 213-224.

### 3.4 Retry Logic

- On failure: increment `retryCount` in manifest, set `error` message
- Exponential backoff: 10s → 30s → 60s → 5m → 15m → 30m (max)
- After 10 retries: mark as `failed`, stop retrying
- Manual retry: `RetryFailed()` resets all failed items
- On 401 (auth expired): broadcast `uploadAuthExpired`, dashboard re-sends fresh token

### 3.5 Call Log Linking Strategy

**Primary flow (recommended)**:
1. Call ends → agent completes recording → broadcasts `recordingCompleted` with `fileName`, `phoneNumber`, `startTime`
2. Dashboard stores latest recording metadata in React context
3. User fills out call form → dashboard creates `call_log` record in PocketBase
4. Dashboard sends `linkRecording` command: `{ fileName, callLogId }`
5. Agent updates manifest entry with `callLogId`
6. Agent uploads recording WITH the `call_log` relation set
7. Agent calls `PATCH /api/collections/call_logs/records/{callLogId}` with `{ has_recording: true }`

**Fallback (if link is missed, e.g. page refresh)**:
- Recording uploads WITHOUT `call_log` link
- Dashboard can later match recordings to call_logs by `phone_number` + `recording_date` within a 2-minute window of `call_time`
- Manual linking from recordings page

---

## Phase 4: Dashboard Refactoring

### 4.1 Files to Remove/Replace

| File | Action |
|------|--------|
| `apps/dashboard/src/hooks/use-call-recorder.ts` (737 lines) | **Replace entirely** with `use-agent-recorder.ts` (~150 lines) |
| `apps/dashboard/src/contexts/call-recording-context.tsx` | **Rewrite** to proxy agent state instead of managing browser streams |
| `apps/dashboard/src/components/call-recorder-controls.tsx` | **Modify** — same UI, different data source (agent WebSocket vs browser MediaRecorder) |

### 4.2 New Hook: `use-agent-recorder.ts`

**Location**: `apps/dashboard/src/hooks/use-agent-recorder.ts`

Wraps agent WebSocket communication for recording. Consumes data from `LocalAgentContext`.

```typescript
interface UseAgentRecorderReturn {
  // Status (mirrors existing interface for UI compatibility)
  status: 'idle' | 'recording' | 'stopping' | 'uploading' | 'success' | 'error';
  duration: number;
  error: string | null;
  isAgentRecording: boolean;

  // Commands (sent to agent via WebSocket)
  startRecording: () => void;
  stopRecording: () => void;
  discardRecording: () => void;

  // Linking
  latestRecording: { fileName: string; phoneNumber: string; startTime: string } | null;
  linkRecordingToCallLog: (callLogId: string) => void;

  // Upload status
  uploadPendingCount: number;
  uploadFailedCount: number;

  // Config
  autoRecordEnabled: boolean;
  setAutoRecord: (enabled: boolean) => void;

  // Connectivity
  agentConnected: boolean;
}
```

### 4.3 Rewrite `call-recording-context.tsx`

**Remove**:
- `startSession()` / `endSession()` — no browser screen share session
- All deferred mode logic (`enterDeferredMode`, `submitDeferredRecording`, `submitOldestDeferredRecording`)
- `setPhoneNumber()` — agent gets phone number from `CallStateFusion`
- All browser media API usage (`getDisplayMedia`, `getUserMedia`, `MediaRecorder`, `AudioContext`)

**Add**:
- `agentConnected` boolean (replaces `isSessionActive`)
- `linkRecordingToCallLog(callLogId)` — sends WebSocket command
- `latestRecording` — metadata from last `recordingCompleted` broadcast

### 4.4 Modify `call-recorder-controls.tsx`

Visual UI stays the same. Underlying logic changes:
- Recording state comes from agent `recordingState` WebSocket messages (not browser `MediaRecorder` state)
- Duration comes from agent (not local timer)
- Start/stop buttons send WebSocket commands
- Auto-record toggle sends `setAutoRecord` to agent
- Agent connection indicator replaces "Session Active" green dot
- When agent disconnected: show "Agent not connected" + "Launch Agent" button

### 4.5 Modify `session/page.tsx` (form submission)

**Current** (lines 1566-1576):
```typescript
submitOldestDeferredRecording(callLog.id).then(recordingId => {
    if (recordingId) {
        pb.collection(COLLECTIONS.CALL_LOGS).update(callLog.id, { has_recording: true });
    }
});
```

**New**:
```typescript
if (latestRecording) {
    linkRecordingToCallLog(callLog.id);
    // Agent handles upload + has_recording flag
}
```

### 4.6 Extend `local-agent-context.tsx`

Add new state fields and message handlers for recording messages:
- `recordingState` in the WebSocket `onmessage` handler
- `recordingCompleted` → store as `latestRecording`
- `recordingUploaded` → update UI indicators
- `uploadQueueStatus` → update pending/failed counts
- `sendCommand()` helper for sending commands to agent

### 4.7 Auth Token Relay

On WebSocket connection (or reconnection), dashboard sends `setUploadConfig`:
```typescript
// In local-agent-context.tsx, after WebSocket connects:
ws.send(JSON.stringify({
  type: 'setUploadConfig',
  pocketbaseUrl: process.env.NEXT_PUBLIC_POCKETBASE_URL,
  authToken: pb.authStore.token,
  uploaderId: pb.authStore.model?.id,
}));
```

On PocketBase auth refresh, re-send the config.

### 4.8 No Browser Recording Fallback

When `agentConnected = false`:
- Recording controls show "Agent offline" with launch button
- Call monitoring falls back to Zoom iframe events (existing behavior)
- Users can still make calls and log outcomes, just without recording
- When agent reconnects, dashboard re-sends `setUploadConfig`

**Rationale**: The entire point is eliminating browser recording instability. Keeping it as fallback defeats the purpose.

---

## Phase 5: Call Monitoring Enhancement

### 5.1 Agent as Primary Call State Source

**Modify `zoom-phone-context.tsx`**:

When `agentConnected = true`:
- Trust agent `callState` for state transitions (idle/ringing/connected/ended)
- Use Zoom iframe events for **phone number extraction** and **direction detection** (richer data than window title parsing)
- Suppress Zoom "ended" events if agent says call is still connected (prevents false disconnects)

When `agentConnected = false`:
- Zoom iframe events are sole source (current behavior, no change)

**Optimization**: Use refs for agent call state comparison (not React state). Only trigger React state updates when fused state actually changes — avoids the re-render problem that caused agent integration to be removed previously.

### 5.2 Phone Number Sync

- Agent gets phone numbers from Zoom window title (`ZoomWindowMonitor`)
- Dashboard gets phone numbers from Zoom iframe `postMessage`
- **Preference**: Dashboard phone number (more reliable) → agent phone number (fallback)
- Agent includes phone number in recording filenames regardless

### 5.3 Call Direction

- Dashboard continues to determine call direction (outbound intent, own-number filtering)
- Agent's direction field is supplementary
- If needed, dashboard can send determined direction to agent for recording metadata

---

## Phase 6: Service Wiring & Integration

### 6.1 Modify `Program.cs`

Wire new services into composition root:
```csharp
var storageManager = new RecordingStorageManager();
var recorder = new AudioRecorderService(storageManager, fusion);
var uploader = new RecordingUploadService(storageManager);
var wsServer = new AgentWebSocketServer(fusion, networkMonitor, audioMonitor, recorder, uploader);
```

### 6.2 Modify `AgentService.cs`

- Add recording duration broadcasts to periodic loop (1s interval during recording)
- Wire `AudioRecorderService` and `RecordingUploadService`
- Add cleanup on shutdown

### 6.3 Tray Icon Enhancements

In `TrayIconManager.cs`, add context menu items:
- "Recording: Active (2:45)" / "Recording: Idle"
- "Upload Queue: 3 pending"
- "Open Recordings Folder"

---

## Implementation Order

| Step | Phase | Description | Depends On |
|------|-------|-------------|------------|
| 1 | 1 | `AudioRecorderService` + `RecordingStorageManager` | — |
| 2 | 2 | WebSocket message models + protocol extension | Step 1 |
| 3 | 2 | `WebSocketServer` command handlers + broadcasts | Step 2 |
| 4 | 4 | `use-agent-recorder.ts` hook | Step 3 |
| 5 | 4 | Rewrite `call-recording-context.tsx` | Step 4 |
| 6 | 4 | Modify `call-recorder-controls.tsx` + `session/page.tsx` | Step 5 |
| 7 | 5 | Agent as primary call state in `zoom-phone-context.tsx` | Step 3 |
| 8 | 3 | `RecordingUploadService` + auth relay | Steps 3, 5 |
| 9 | 6 | Service wiring in `Program.cs` + `AgentService.cs` | Steps 1-8 |
| 10 | 6 | Tray icon enhancements | Step 9 |
| 11 | — | End-to-end integration testing | All |

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| WASAPI loopback captures ALL system audio, not just Zoom | Minor background noise in recordings | Acceptable for call recording (dominant audio is Zoom). Future: capture only Zoom process audio via Audio Session API |
| Auth token expiry during upload | Uploads fail | PocketBase tokens are long-lived (14 days). Dashboard re-sends on reconnect. Agent broadcasts `uploadAuthExpired` on 401 |
| Large recordings filling disk | Disk space | MP3 at 128kbps = ~1MB/min. Add configurable retention policy (delete after upload + N days). Show disk usage in tray |
| Agent crash during recording | Partial recording lost | `WaveFileWriter` flushes periodically. On restart, detect incomplete WAV files and attempt conversion |
| Dashboard refresh before linking recording | Recording uploads without call_log link | Fallback: timestamp + phone number matching within 2-minute window. Manual linking from recordings page |
| Re-render storm from agent state | UI performance | Use refs for comparison, only update React state on actual changes |

---

## Verification Plan

1. **Agent recording**: Start agent → make a Zoom call → verify WAV capture + MP3 conversion → check file in `%USERPROFILE%\Documents\CRM Recordings\`
2. **WebSocket protocol**: Connect dashboard → verify `recordingState` broadcasts during call → verify `recordingCompleted` after call
3. **Dashboard controls**: Click start/stop → verify commands reach agent → verify UI reflects agent state
4. **Auto-record**: Enable auto-record → make call → verify recording starts automatically on ringing/connected
5. **Call log linking**: Complete call → fill form → submit → verify `linkRecording` sent → verify recording uploads with `call_log` relation
6. **Background upload**: Make 3+ calls → verify all recordings upload in background → verify `has_recording` flags set on call_logs
7. **Offline resilience**: Disconnect PocketBase → make calls → verify recordings saved locally → reconnect → verify uploads resume
8. **Agent offline**: Disconnect agent → verify CRM shows "Agent offline" → verify call monitoring falls back to Zoom iframe
9. **Power dialer**: Run 10+ call queue → verify recordings created per call → verify no instability or glitching

---

## Key Files Reference

### Agent (Modify)
- `tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj` — add NAudio.Lame
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/WebSocketServer.cs` — extend commands
- `tools/local-CRM-Agent/src/LocalCrmAgent/Models/Messages.cs` — new message types
- `tools/local-CRM-Agent/src/LocalCrmAgent/Program.cs` — wire new services
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/AgentService.cs` — broadcast loop
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/TrayIconManager.cs` — recording menu items

### Agent (Create)
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/AudioRecorderService.cs`
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/RecordingStorageManager.cs`
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/RecordingUploadService.cs`

### Dashboard (Modify)
- `apps/dashboard/src/contexts/local-agent-context.tsx` — new message handlers + sendCommand
- `apps/dashboard/src/contexts/call-recording-context.tsx` — complete rewrite
- `apps/dashboard/src/components/call-recorder-controls.tsx` — agent-based controls
- `apps/dashboard/src/app/(dashboard)/session/page.tsx` — new linking flow
- `apps/dashboard/src/contexts/zoom-phone-context.tsx` — agent as primary call state

### Dashboard (Create)
- `apps/dashboard/src/hooks/use-agent-recorder.ts`

### Dashboard (Remove)
- `apps/dashboard/src/hooks/use-call-recorder.ts` — replaced entirely

### Reference (Read-Only)
- `tools/audio-recorder/recorder.py` — proven WASAPI loopback patterns
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/ZoomAudioMonitor.cs` — existing WASAPI infrastructure
- `tools/local-CRM-Agent/src/LocalCrmAgent/Services/CallStateFusion.cs` — call state machine
- `packages/pocketbase-client/pb_db_schema.json` — recordings collection schema

---
---

# Part 2: Automated Testing Plan

## Testing Infrastructure Overview

### Current State
- **Dashboard E2E**: 14 Playwright spec files (4,130 lines), fully functional
- **Agent Unit Tests**: None (zero test coverage on .NET agent)
- **CI/CD**: Build-only workflows, no automated test execution
- **Test Helpers**: `mock-agent.ts` (mock WebSocket), `virtual-dialer.ts` (simulated Zoom telephony), `pb-client.ts` (PocketBase admin), `test-data.ts` (prefixed cleanup)

### What We're Adding
1. **.NET Agent Unit Tests** (xUnit) — new test project for all agent services
2. **.NET Agent Integration Tests** (xUnit) — WebSocket protocol, recording pipeline
3. **Dashboard E2E Tests** (Playwright) — new spec files for agent-based recording workflow
4. **Extended Mock Agent** — new helper functions for recording message simulation
5. **CI/CD Integration** — automated test runs for both agent and dashboard

---

## Layer 1: .NET Agent Unit Tests (xUnit)

### 1.1 Test Project Setup

**Create**: `tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/LocalCrmAgent.Tests.csproj`

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.*" />
    <PackageReference Include="xunit" Version="2.*" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.*" />
    <PackageReference Include="Moq" Version="4.*" />
    <PackageReference Include="FluentAssertions" Version="6.*" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\LocalCrmAgent\LocalCrmAgent.csproj" />
  </ItemGroup>
</Project>
```

**Test runner command**: `dotnet test tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/`

---

### 1.2 CallStateFusion Tests

**File**: `tests/LocalCrmAgent.Tests/Services/CallStateFusionTests.cs`

These tests validate the core state machine that drives all call detection. Each test uses mock `ZoomAudioMonitor` and `ZoomWindowMonitor` to simulate WASAPI and window events.

#### State Transition Tests

| Test | Initial State | Trigger | Expected State | Expected Confidence |
|------|--------------|---------|---------------|-------------------|
| `IdleToRinging_WhenWindowShowsCalling_NoAudio` | Idle | Window: "Calling +15551234567", Audio: inactive | Ringing | Low |
| `IdleToConnected_WhenAudioSessionActive` | Idle | Audio: session active, peak > 0.001 | Connected | High |
| `RingingToConnected_WhenAudioStarts` | Ringing | Audio: session active, peak > 0.001 | Connected | High |
| `RingingToEnded_WhenTimeout60s` | Ringing | 60s elapsed, no audio ever started | Ended | Low |
| `RingingToEnded_WhenWindowStopsCallingNoAudio` | Ringing | Window: no "calling"/"timer", Audio: inactive | Ended | Low |
| `ConnectedToEnded_WhenAudioInactive300ms` | Connected | Audio: inactive for ≥300ms | Ended | Medium |
| `ConnectedToEnded_NotTriggered_Under300ms` | Connected | Audio: inactive for 200ms then active | Connected (no change) | High |
| `EndedToIdle_After1sCooldown` | Ended | 1.0s elapsed, no new audio | Idle | — |
| `EndedToConnected_WhenNewAudioStarts` | Ended | Audio: session active within cooldown | Connected | High |

#### Phone Number & Direction Tests

| Test | Scenario | Expected |
|------|----------|----------|
| `PhoneNumber_LatchedFromWindow` | Window shows "+15551234567" during Ringing | `phoneNumber = "+15551234567"` persists through Connected and Ended |
| `PhoneNumber_UpdatesEachCycle` | Window title changes mid-call | Phone number updates on each evaluation |
| `Direction_LatchedOnIncoming` | Window shows "incoming" during Ringing | `direction = "inbound"` persists even after title changes |
| `Direction_NullForOutbound` | Window shows "calling" (no "incoming") | `direction = null` (dashboard determines direction) |
| `Duration_CalculatedFromConnectTime` | Connected at T=0, Ended at T=42s | `durationSeconds = 42` |

#### Confidence Level Tests

| Test | Audio State | Window State | Expected Confidence |
|------|------------|-------------|-------------------|
| `Confidence_High_AudioFlowing` | Active, peak > 0.001 | Any | High |
| `Confidence_Medium_SessionActiveNoPeak` | Active, peak = 0 | Any | Medium |
| `Confidence_Low_WindowOnly` | Inactive/null | Calling detected | Low |

#### Edge Case Tests

| Test | Scenario | Expected |
|------|----------|----------|
| `ConcurrentEvaluations_ThreadSafe` | 10 threads calling Evaluate() simultaneously | No exceptions, consistent state |
| `AudioMonitorReturnsNull_ZoomNotRunning` | `GetZoomAudioState()` returns null | Stays in Idle (or transitions to Ended if was Connected) |
| `RapidStateChanges_NoSkippedStates` | Audio flickers active/inactive rapidly | State transitions are sequential (no Idle→Ended skip) |
| `FallbackPoll_CatchesMissedEvents` | Event-driven callback not fired | 500ms poll triggers same evaluation |
| `StateCleared_OnEndedToIdleTransition` | Ended → Idle | phoneNumber, direction, connectedAt all reset to null |

---

### 1.3 AudioRecorderService Tests

**File**: `tests/LocalCrmAgent.Tests/Services/AudioRecorderServiceTests.cs`

These tests use a mock `WasapiLoopbackCapture` wrapper (interface extraction needed) and mock `RecordingStorageManager`.

#### Recording Lifecycle Tests

| Test | Action | Expected |
|------|--------|----------|
| `StartRecording_ReturnsSuccess` | Call `StartRecording("+15551234567")` | `success = true`, `CurrentState = Recording`, `CurrentPhoneNumber = "+15551234567"` |
| `StartRecording_WhileAlreadyRecording_ReturnsFalse` | Start, then Start again | Second call returns `success = false, error = "Already recording"` |
| `StopRecording_ReturnsFilePath` | Start, then Stop | `success = true`, `filePath` contains phone number and timestamp |
| `StopRecording_WhenNotRecording_ReturnsFalse` | Stop without Start | `success = false` |
| `DiscardRecording_DeletesTempFile` | Start, then Discard | Temp WAV file deleted, state returns to Idle |
| `Duration_IncrementsWhileRecording` | Start, wait 2s | `DurationSeconds >= 2` |
| `StateChanged_EventFired_OnAllTransitions` | Full lifecycle | Events fired for: Idle→Recording, Recording→Stopping, Stopping→Idle |

#### Auto-Record Integration Tests

| Test | CallStateFusion Event | autoRecordEnabled | Expected |
|------|----------------------|-------------------|----------|
| `AutoStart_OnRingingToConnected` | Ringing → Connected | true | Recording starts, phone number from fusion |
| `AutoStop_OnConnectedToEnded` | Connected → Ended | true | Recording stops, file saved |
| `AutoDiscard_OnRingingToEnded` | Ringing → Ended (unanswered) | true | Recording discarded, no file saved |
| `NoAutoStart_WhenDisabled` | Ringing → Connected | false | No recording starts |
| `ManualOverride_WhenAutoEnabled` | Manual Stop during auto-record | true | Recording stops normally |

#### File Naming Tests

| Test | Input | Expected Filename Pattern |
|------|-------|--------------------------|
| `FileName_IncludesTimestampAndPhone` | phone: "+18085551234" | `2026-03-19_14-30-15-123_18085551234.mp3` |
| `FileName_SanitizesPhoneNumber` | phone: "(808) 555-1234" | `..._8085551234.mp3` (digits only) |
| `FileName_HandlesInternationalNumbers` | phone: "+442071234567" | `..._442071234567.mp3` |
| `FileName_MillisecondPrecision` | two recordings same second | Different filenames (milliseconds differ) |

---

### 1.4 RecordingStorageManager Tests

**File**: `tests/LocalCrmAgent.Tests/Services/RecordingStorageManagerTests.cs`

Uses a temporary directory for isolation.

| Test | Action | Expected |
|------|--------|----------|
| `CreateDirectory_OnInit_IfMissing` | Init with non-existent path | Directory created |
| `LoadManifest_OnInit` | Init with existing `recordings.json` | Manifest loaded into memory |
| `AddEntry_PersistsToManifest` | Add recording entry | `recordings.json` contains new entry |
| `UpdateEntry_PersistsChange` | Update `uploaded = true` | Change persisted to disk |
| `GetPendingUploads_FiltersCorrectly` | Mix of uploaded/pending/failed | Only returns `uploaded = false, error = null` |
| `GetFailedUploads_FiltersCorrectly` | Mix with errors | Only returns entries with `error != null` |
| `ManifestSurvivesRestart` | Write, dispose, new instance | Same entries loaded |
| `ConcurrentWrites_ThreadSafe` | 5 threads adding entries | All entries present, no corruption |

---

### 1.5 RecordingUploadService Tests

**File**: `tests/LocalCrmAgent.Tests/Services/RecordingUploadServiceTests.cs`

Uses a mock `HttpMessageHandler` to intercept HTTP requests.

#### Upload Flow Tests

| Test | Scenario | Expected |
|------|----------|----------|
| `Upload_Success_MarksUploaded` | Mock 200 response with `{ id: "abc123" }` | Manifest entry: `uploaded = true, pocketbaseRecordingId = "abc123"` |
| `Upload_Failure_IncrementsRetry` | Mock 500 response | `retryCount = 1, error = "Server error"` |
| `Upload_401_BroadcastsAuthExpired` | Mock 401 response | `UploadAuthExpired` event fired |
| `Upload_MaxRetries_MarksAsFailed` | 10 consecutive failures | Entry marked failed, stops retrying |
| `Upload_SendsCorrectFormData` | Capture request | Multipart form includes: file, phone_number, uploader, original_filename, duration, recording_date |
| `Upload_IncludesCallLogRelation` | Entry has `callLogId` | FormData includes `call_log` field |
| `Upload_UpdatesHasRecordingFlag` | Successful upload with callLogId | PATCH request sent to call_logs collection |
| `Upload_PhoneNumberResolution` | Entry has phoneNumber | GET request sent to phone_numbers collection before upload |
| `SetAuth_EnablesUploads` | Set auth, enqueue upload | Upload proceeds with Authorization header |
| `NoAuth_QueuesWithoutUploading` | Enqueue without SetAuth | Entry queued but not uploaded until auth set |

#### Retry Logic Tests

| Test | Retry Count | Expected Backoff |
|------|-------------|-----------------|
| `Backoff_1stRetry` | 1 | ~10s delay |
| `Backoff_2ndRetry` | 2 | ~30s delay |
| `Backoff_3rdRetry` | 3 | ~60s delay |
| `Backoff_6thRetry` | 6 | ~15m delay |
| `Backoff_MaxCap` | 7+ | ~30m max |

#### Queue Persistence Tests

| Test | Scenario | Expected |
|------|----------|----------|
| `PendingUploads_SurviveRestart` | Enqueue, dispose, new instance | Pending uploads re-enqueued on start |
| `InFlightUpload_RetryOnRestart` | Crash during upload | Entry still pending after restart |

---

### 1.6 ZoomWindowMonitor Tests

**File**: `tests/LocalCrmAgent.Tests/Services/ZoomWindowMonitorTests.cs`

These test the regex patterns and parsing logic without actual window enumeration (extract parsing logic into testable methods).

#### Phone Number Regex Tests

| Test | Input Title | Expected Phone |
|------|------------|---------------|
| `USPhone_Standard` | "Zoom Phone - Calling (808) 555-1234" | "(808) 555-1234" or "+18085551234" |
| `USPhone_Dashes` | "555-867-5309 - Zoom" | "555-867-5309" |
| `USPhone_Dots` | "555.867.5309" | "555.867.5309" |
| `USPhone_WithCountryCode` | "+1 555 867 5309" | "+1 555 867 5309" |
| `International_UK` | "+442071234567" | "+442071234567" |
| `International_France` | "+33123456789" | "+33123456789" |
| `NoPhone_JustText` | "Zoom Meeting" | null |

#### Call State Keyword Tests

| Test | Input Title | Calling? | Ringing? | Incoming? |
|------|------------|----------|----------|-----------|
| `Calling_Detected` | "Calling 555-1234" | true | false | false |
| `Ringing_Detected` | "Ring - 555-1234" | false | true | false |
| `Incoming_Detected` | "Incoming call from 555-1234" | false | false | true |
| `Timer_Detected` | "12:45 - 555-1234" | false | false | false (but IsTimerDetected = true) |
| `NoKeywords` | "Zoom Phone" | false | false | false |

#### Timer Parsing Tests

| Test | Input | Expected TimeSpan |
|------|-------|------------------|
| `Timer_Standard` | "12:45" | 12m 45s |
| `Timer_SingleDigitMinute` | "0:30" | 0m 30s |
| `Timer_NoTimer` | "Calling" | null |

---

### 1.7 NetworkMonitor Tests

**File**: `tests/LocalCrmAgent.Tests/Services/NetworkMonitorTests.cs`

#### Stability Calculation Tests

| Test | Latency | Jitter | PacketLoss | Expected isStable |
|------|---------|--------|------------|------------------|
| `Stable_GoodConnection` | 25ms | 3ms | 0% | true |
| `Unstable_HighLatency` | 250ms | 3ms | 0% | false (>200ms) |
| `Unstable_HighJitter` | 25ms | 60ms | 0% | false (>50ms) |
| `Unstable_HighPacketLoss` | 25ms | 3ms | 15% | false (>10%) |
| `EdgeCase_ExactThresholds` | 200ms | 50ms | 10% | true (at boundary) |

#### Jitter Calculation Tests

| Test | Latency Series | Expected Jitter |
|------|---------------|----------------|
| `Jitter_Constant` | [25, 25, 25, 25] | 0ms |
| `Jitter_Oscillating` | [10, 50, 10, 50] | 40ms |
| `Jitter_Increasing` | [10, 20, 30, 40] | 10ms |

---

### 1.8 WebSocket Message Serialization Tests

**File**: `tests/LocalCrmAgent.Tests/Models/MessageSerializationTests.cs`

| Test | Message Type | Assertion |
|------|-------------|-----------|
| `CallStateMessage_SerializesCamelCase` | CallStateMessage | JSON has `"type": "callState"`, `"phoneNumber"`, `"confidence"` |
| `RecordingStateMessage_SerializesCorrectly` | RecordingStateMessage | JSON has `"type": "recordingState"`, all fields present |
| `RecordingCompletedMessage_IncludesAllFields` | RecordingCompletedMessage | JSON has fileName, phoneNumber, duration, fileSizeBytes, startTime |
| `RecordingUploadedMessage_IncludesRelations` | RecordingUploadedMessage | JSON has pocketbaseRecordingId, callLogId |
| `HeartbeatMessage_IncludesRecordingFields` | HeartbeatMessage (extended) | JSON has isRecording, recordingDuration, uploadsPending, uploadsFailed |
| `EnumValues_LowercaseInJson` | CallState.Connected | Serializes as `"connected"` not `"Connected"` |

---

## Layer 2: Dashboard E2E Tests (Playwright)

### 2.1 Extended Mock Agent Helper

**File**: `apps/dashboard/tests/helpers/mock-agent.ts` — extend existing

Add new functions to simulate recording messages from the agent:

```typescript
// ─── NEW: Recording message helpers ─────────────────────────────────

export interface MockRecordingState {
    state: 'idle' | 'recording' | 'stopping' | 'error';
    fileName?: string;
    phoneNumber?: string;
    duration?: number;
    error?: string;
}

export interface MockRecordingCompleted {
    fileName: string;
    phoneNumber: string;
    duration: number;
    fileSizeBytes: number;
    startTime: string;
}

export interface MockRecordingUploaded {
    fileName: string;
    pocketbaseRecordingId: string;
    callLogId?: string;
    success: boolean;
    error?: string;
}

export interface MockUploadQueueStatus {
    pendingCount: number;
    failedCount: number;
    currentUpload?: string;
}

/** Send a recordingState message through the mock WebSocket. */
export async function sendAgentRecordingState(
    page: Page, state: MockRecordingState
) { ... }

/** Send a recordingCompleted message through the mock WebSocket. */
export async function sendAgentRecordingCompleted(
    page: Page, completed: MockRecordingCompleted
) { ... }

/** Send a recordingUploaded message through the mock WebSocket. */
export async function sendAgentRecordingUploaded(
    page: Page, uploaded: MockRecordingUploaded
) { ... }

/** Send an uploadQueueStatus message through the mock WebSocket. */
export async function sendAgentUploadQueueStatus(
    page: Page, status: MockUploadQueueStatus
) { ... }

/** Capture commands sent TO the mock agent from the dashboard. */
export async function captureAgentCommands(page: Page): Promise<any[]> {
    return page.evaluate(() => (window as any).__mockAgentCommands ?? []);
}

/** Clear captured agent commands. */
export async function clearAgentCommands(page: Page) { ... }
```

Also update `setupMockAgent()` to:
- Capture `ws.send()` calls into `window.__mockAgentCommands` array
- Include recording fields in heartbeat: `isRecording: false, recordingDuration: 0, uploadsPending: 0, uploadsFailed: 0`
- Send `setUploadConfig` acknowledgement automatically

---

### 2.2 New Spec: `15-agent-recording.spec.ts`

**File**: `apps/dashboard/tests/15-agent-recording.spec.ts`

This spec covers the complete agent-based recording workflow using mock WebSocket messages.

#### Recording State Display Tests

| Test | Mock Message | Expected UI |
|------|-------------|------------|
| `recording indicator shows when agent reports recording` | `recordingState: { state: 'recording', duration: 5 }` | Pulsing red dot or "Recording" text visible |
| `recording duration updates in real-time` | Send recordingState every 1s with incrementing duration | Duration counter increments on screen |
| `recording indicator hides when agent reports idle` | `recordingState: { state: 'idle' }` | Recording indicator disappears |
| `recording error shows error message` | `recordingState: { state: 'error', error: 'Device not found' }` | Error message displayed to user |

#### Recording Controls Tests

| Test | User Action | Expected Command Sent to Agent |
|------|-------------|-------------------------------|
| `manual start recording sends startRecording command` | Click "Start Recording" button | `{ type: 'startRecording', phoneNumber: '...' }` captured |
| `manual stop recording sends stopRecording command` | Click "Stop Recording" button | `{ type: 'stopRecording' }` captured |
| `auto-record toggle sends setAutoRecord command` | Toggle auto-record switch | `{ type: 'setAutoRecord', enabled: true/false }` captured |
| `discard recording sends discardRecording command` | Click "Discard" button | `{ type: 'discardRecording' }` captured |

#### Recording-to-CallLog Linking Tests

| Test | Scenario | Expected |
|------|----------|----------|
| `form submit sends linkRecording after recording completed` | Agent broadcasts `recordingCompleted` → user submits form | `{ type: 'linkRecording', fileName: '...', callLogId: '...' }` sent |
| `linkRecording includes correct fileName from latest recording` | Two calls, submit second form | linkRecording fileName matches second call's recording |
| `no linkRecording sent when no recording exists` | Call without recording → submit form | No linkRecording command sent |

#### Upload Status Display Tests

| Test | Mock Message | Expected UI |
|------|-------------|------------|
| `upload queue count shows in UI` | `uploadQueueStatus: { pendingCount: 3, failedCount: 1 }` | "3 pending, 1 failed" visible |
| `upload completed updates indicator` | `recordingUploaded: { success: true }` | Success indicator shown |
| `upload failed shows error` | `recordingUploaded: { success: false, error: 'Network error' }` | Error indicator shown |

---

### 2.3 New Spec: `16-agent-recording-call-flow.spec.ts`

**File**: `apps/dashboard/tests/16-agent-recording-call-flow.spec.ts`

Full call lifecycle with agent recording integration. Uses BOTH `setupVirtualDialer()` and `setupMockAgent()` together.

#### Single Call Flow

```
Test: "complete call with agent recording: dial → record → end → link → upload"

1. Start virtual session (with mock agent connected)
2. Dial TEST_PHONE_1 via virtual dialer
3. Wait for ringing → verify agent receives startRecording (if auto-record on)
4. Wait for connected → send recordingState { state: 'recording', duration: 0 }
5. Verify recording indicator visible
6. Send incremental recordingState messages (duration 1, 2, 3...)
7. End call via simulateCallEnd()
8. Send recordingCompleted { fileName, phoneNumber, duration, startTime }
9. Wait for call form
10. Fill and submit form
11. Verify linkRecording command sent with correct fileName and callLogId
12. Send recordingUploaded { success: true, pocketbaseRecordingId: 'rec_123' }
13. Verify call_log has has_recording = true in PocketBase
```

#### Multi-Call Flow (Rapid Succession)

```
Test: "3 rapid calls each create separate recordings"

1. Start session with mock agent
2. For each of 3 calls:
   a. Dial number
   b. Agent sends recordingState { recording }
   c. Call ends
   d. Agent sends recordingCompleted with UNIQUE fileName
   e. Submit form
   f. Verify linkRecording sent with MATCHING fileName
3. Verify 3 distinct call_logs in PocketBase
4. Verify 3 distinct linkRecording commands with different fileNames
```

#### No-Answer Call (No Recording)

```
Test: "no-answer call discards recording"

1. Start session with mock agent
2. Dial number, call fails to connect (shouldConnect: false)
3. Agent sends recordingState { recording } on ringing
4. Call ends without connecting
5. Verify discardRecording or no linkRecording command sent
6. Submit form with "No Answer"
7. Verify no recording linked to call_log
```

#### Agent Disconnection Mid-Call

```
Test: "agent disconnect during call shows warning but doesn't crash"

1. Start session with mock agent
2. Dial number, call connects
3. Agent sends recordingState { recording }
4. Disconnect mock agent (simulateAgentDisconnect)
5. Verify UI shows "Agent offline" warning
6. End call normally
7. Submit form
8. Verify no linkRecording sent (agent offline)
9. Verify call_log still created (recording just missing)
```

---

### 2.4 New Spec: `17-power-dialer-recording.spec.ts`

**File**: `apps/dashboard/tests/17-power-dialer-recording.spec.ts`

Power dialer workflow with agent recording — the most critical integration test.

#### Power Dialer Queue Execution with Recording

```
Test: "power dialer runs 3-number queue with recordings per call"

Setup:
- Create 3 test companies with phone numbers in PocketBase
- Start session with virtual dialer + mock agent

Flow:
1. Load 3 numbers into power dialer queue
2. Start power dialer
3. For each number in queue:
   a. Virtual dialer fires ringing → connected → ended
   b. Mock agent mirrors with recordingState { recording } → recordingCompleted
   c. Call form appears
   d. Fill outcome, submit form
   e. Verify linkRecording command sent with correct fileName
   f. Power dialer advances to next number

Assertions:
- 3 call_logs created in PocketBase
- 3 linkRecording commands captured (unique fileNames)
- Each linkRecording has correct callLogId matching its call_log
- Session metrics: total_dials >= 3
```

#### Negative Delay Overlap with Recording

```
Test: "negative delay: next call starts before form submit, recordings stay linked"

Setup:
- Configure power dialer with delay = -5s
- 2 numbers in queue

Flow:
1. Call 1 dials, connects, ends → recordingCompleted for call 1
2. After |delay|, call 2 dials (user still on call 1 form)
3. Agent sends recordingState { recording } for call 2
4. User submits call 1 form
5. Verify linkRecording for call 1 uses call 1's fileName (NOT call 2's)
6. Call 2 ends → recordingCompleted for call 2
7. Submit call 2 form
8. Verify linkRecording for call 2 uses call 2's fileName

Assertions:
- Recording fileNames are correctly matched to their respective call_logs
- No cross-contamination between overlapping calls
```

#### Auto-Hangup with Recording

```
Test: "auto-hangup at 15s cancels recording for unanswered call"

Setup:
- Auto-hangup enabled at 15s
- shouldConnect: false (never answers)

Flow:
1. Dial number → ringing
2. Agent sends recordingState { recording } on ringing
3. After 15s auto-hangup fires → call ends
4. Verify discardRecording command (or no linkRecording)
5. Form appears → submit with "No Answer"
6. Verify no recording uploaded for this call
```

#### Queue Completion and Session End

```
Test: "power dialer completes queue, all recordings upload in background"

Flow:
1. Run 3-number queue to completion
2. Verify 3 linkRecording commands sent
3. Send uploadQueueStatus { pendingCount: 3 }
4. Progressively send recordingUploaded for each (success: true)
5. Send uploadQueueStatus { pendingCount: 0 }
6. End session
7. Verify all 3 call_logs exist with correct data
```

---

### 2.5 New Spec: `18-agent-connectivity.spec.ts`

**File**: `apps/dashboard/tests/18-agent-connectivity.spec.ts`

Tests for agent connection lifecycle, auth relay, and graceful degradation.

| Test | Scenario | Expected |
|------|----------|----------|
| `setUploadConfig sent on connect` | Mock agent connects | `{ type: 'setUploadConfig', pocketbaseUrl, authToken, uploaderId }` captured |
| `setUploadConfig re-sent on reconnect` | Disconnect → reconnect mock agent | setUploadConfig sent again with fresh token |
| `recording controls disabled when agent offline` | No mock agent, navigate to session | "Agent offline" message, recording buttons disabled |
| `recording controls enable when agent connects` | Start without agent, then inject mock agent | Controls transition from disabled to enabled |
| `agent primary call state: suppress false Zoom ended` | Agent says connected, Zoom says ended | Call stays connected (agent is ground truth) |
| `agent offline: Zoom iframe is sole source` | No agent connected | Zoom iframe events drive call state normally |
| `heartbeat shows recording status` | Agent heartbeat with `isRecording: true, uploadsPending: 2` | Recording indicator + "2 pending uploads" visible |

---

### 2.6 Updated Spec: `14-local-agent.spec.ts` (Extend)

Add tests to the existing file for the new recording message types:

| Test | Description |
|------|-------------|
| `agent heartbeat with recording fields updates UI` | Send heartbeat with `isRecording: true, recordingDuration: 45` → verify UI reflects |
| `recordingCompleted stores latest recording in context` | Send `recordingCompleted` → verify context has the metadata |
| `uploadQueueStatus visible in session page` | Send queue status → verify pending/failed counts shown |

---

## Layer 3: Agent Integration Tests

### 3.1 WebSocket Protocol Tests

**File**: `tests/LocalCrmAgent.Tests/Integration/WebSocketProtocolTests.cs`

Uses a real Fleck WebSocket server + a test WebSocket client to verify the full protocol.

| Test | Client Sends | Expected Server Response |
|------|-------------|------------------------|
| `StartRecording_Command_BroadcastsRecordingState` | `{ type: 'startRecording', phoneNumber: '5551234567' }` | Receives `recordingState { state: 'recording' }` |
| `StopRecording_Command_BroadcastsCompleted` | `{ type: 'stopRecording' }` | Receives `recordingCompleted { fileName, duration }` |
| `SetAutoRecord_Command_Acknowledged` | `{ type: 'setAutoRecord', enabled: true }` | No error, auto-record behavior enabled |
| `LinkRecording_Command_UpdatesManifest` | `{ type: 'linkRecording', fileName: '...', callLogId: '...' }` | Manifest entry updated with callLogId |
| `SetUploadConfig_Command_StoresAuth` | `{ type: 'setUploadConfig', pocketbaseUrl: '...', authToken: '...' }` | Upload service has auth configured |
| `GetRecordingStatus_Command_ReturnsState` | `{ type: 'getRecordingStatus' }` | Receives `recordingState` with current state |
| `UnknownCommand_DoesNotCrash` | `{ type: 'nonexistent' }` | No response, no crash |
| `MalformedJson_DoesNotCrash` | `"not valid json"` | No response, no crash |
| `MultipleClients_AllReceiveBroadcasts` | 3 clients connected, recording starts | All 3 receive `recordingState` |

### 3.2 Recording Pipeline Integration Test

**File**: `tests/LocalCrmAgent.Tests/Integration/RecordingPipelineTests.cs`

End-to-end test of the recording pipeline (with a mock audio source instead of real WASAPI).

```
Test: "full recording pipeline: start → capture → stop → convert → manifest"

1. Create AudioRecorderService with mock loopback capture
2. Create RecordingStorageManager with temp directory
3. StartRecording("+15551234567")
4. Feed 3 seconds of mock PCM audio data
5. StopRecording()
6. Assert:
   - MP3 file exists in temp directory
   - Filename matches pattern: {timestamp}_{phone}.mp3
   - File size > 0
   - Manifest has entry with correct metadata
   - Duration approximately 3 seconds
```

### 3.3 Upload Pipeline Integration Test

**File**: `tests/LocalCrmAgent.Tests/Integration/UploadPipelineTests.cs`

Uses `MockHttpMessageHandler` to simulate PocketBase responses.

```
Test: "upload pipeline: auth → resolve phone → upload → update call_log"

1. Create RecordingUploadService with mock HTTP handler
2. SetAuth(url, token, uploaderId)
3. Add manifest entry with callLogId
4. EnqueueUpload(fileName)
5. Assert HTTP requests made:
   a. GET phone_numbers (resolve phone number record)
   b. POST recordings/records (multipart upload with correct fields)
   c. PATCH call_logs/records/{callLogId} (set has_recording = true)
6. Assert manifest entry: uploaded = true, pocketbaseRecordingId set
```

---

## Layer 4: Regression Tests

### 4.1 Existing Tests Must Still Pass

All 14 existing Playwright specs must pass unchanged after the migration. Key regressions to watch:

| Existing Spec | Potential Breakage | Mitigation |
|---------------|-------------------|------------|
| `05-session.spec.ts` | Session start flow changed (no screen share) | Update to use agent-connected gating instead of "Connect Audio" with screen share |
| `09-recordings.spec.ts` | Recordings page may show different upload source | Verify agent-uploaded recordings appear in list |
| `12-live-call-flow.spec.ts` | Real calls now need agent for recording | Skip recording assertions if agent not available |
| `13-virtual-call-flow.spec.ts` | Recording pipeline completely different | **Major rewrite needed** — replace browser recording assertions with agent recording message assertions |
| `14-local-agent.spec.ts` | Extended with new message types | Backward compatible (new tests added, old tests preserved) |

### 4.2 Virtual Dialer Recording Tests Migration

`13-virtual-call-flow.spec.ts` "Recording Pipeline" section (lines 155-263) must be rewritten:

**Before**: Tests verify `MediaRecorder` starts, stops, and uploads via browser.
**After**: Tests verify `startRecording`/`stopRecording` commands sent to agent, and `linkRecording` sent on form submit.

The existing helpers (`setupVirtualDialer`, `startVirtualSession`, `executeCallCycle`, `fillAndSubmitCallForm`) remain unchanged — only the recording verification logic changes.

---

## Layer 5: Test Execution Strategy

### 5.1 Test Commands

```bash
# Agent unit tests (fast, no dependencies)
dotnet test tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/ --filter "Category!=Integration"

# Agent integration tests (needs temp directories)
dotnet test tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/ --filter "Category=Integration"

# Dashboard E2E — all (needs PocketBase + Next.js running)
pnpm test

# Dashboard E2E — agent recording only
pnpm --filter dashboard exec playwright test tests/15-agent-recording.spec.ts tests/16-agent-recording-call-flow.spec.ts tests/17-power-dialer-recording.spec.ts tests/18-agent-connectivity.spec.ts

# Dashboard E2E — regression (existing tests)
pnpm --filter dashboard exec playwright test tests/01-auth.spec.ts tests/13-virtual-call-flow.spec.ts tests/14-local-agent.spec.ts

# Full suite
dotnet test tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/ && pnpm test
```

### 5.2 Test Execution Order

| Priority | Tests | When to Run | Duration |
|----------|-------|-------------|----------|
| P0 | Agent unit tests (CallStateFusion, AudioRecorder, StorageManager) | Every commit | ~10s |
| P1 | Agent integration tests (WebSocket protocol, recording pipeline) | Every PR | ~30s |
| P2 | Dashboard recording E2E (15, 16, 17, 18) | Every PR | ~3min |
| P3 | Dashboard regression E2E (13, 14 updated) | Every PR | ~2min |
| P4 | Full dashboard E2E suite (all 18 specs) | Pre-release | ~10min |

### 5.3 CI/CD Integration

**File**: `.github/workflows/test.yml` (new)

```yaml
name: Tests
on: [push, pull_request]

jobs:
  agent-tests:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with: { dotnet-version: '8.0.x' }
      - run: dotnet test tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/

  dashboard-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g pnpm && pnpm install
      - run: npx playwright install chromium
      # PocketBase would need to be started here (docker or binary)
      - run: pnpm test
```

---

## Layer 6: Test Data & Cleanup Strategy

### 6.1 Test Prefixes

| Test Suite | Prefix | Purpose |
|-----------|--------|---------|
| Existing virtual dialer | `TPW{N}_VD_` | Virtual dialer call flow |
| Existing agent | `TPW{N}_AGT_` | Agent integration |
| New agent recording | `TPW{N}_AREC_` | Agent recording controls |
| New call flow recording | `TPW{N}_ACFL_` | Agent + call flow integration |
| New power dialer recording | `TPW{N}_APDR_` | Power dialer + recording |
| New connectivity | `TPW{N}_ACON_` | Agent connectivity |

### 6.2 Cleanup Order

Tests create data in this order: companies → phone_numbers → sessions → call_logs → recordings → follow_ups

Cleanup must reverse: follow_ups → recordings → call_logs → sessions → phone_numbers → companies

All test suites use `afterAll()` with explicit ID tracking + prefix-based sweep as safety net.

### 6.3 Test Isolation

- Playwright workers = 1 (sequential, prevents PocketBase conflicts)
- Each test creates fresh data with unique prefix
- Agent unit tests use isolated temp directories per test
- WebSocket integration tests bind to random available port (not 9876)

---

## Key Files to Create

### Agent Tests
| File | Tests |
|------|-------|
| `tools/local-CRM-Agent/tests/LocalCrmAgent.Tests/LocalCrmAgent.Tests.csproj` | Test project config |
| `tests/LocalCrmAgent.Tests/Services/CallStateFusionTests.cs` | ~25 state machine tests |
| `tests/LocalCrmAgent.Tests/Services/AudioRecorderServiceTests.cs` | ~15 recording lifecycle tests |
| `tests/LocalCrmAgent.Tests/Services/RecordingStorageManagerTests.cs` | ~10 manifest tests |
| `tests/LocalCrmAgent.Tests/Services/RecordingUploadServiceTests.cs` | ~15 upload + retry tests |
| `tests/LocalCrmAgent.Tests/Services/ZoomWindowMonitorTests.cs` | ~12 regex + parsing tests |
| `tests/LocalCrmAgent.Tests/Services/NetworkMonitorTests.cs` | ~8 stability calculation tests |
| `tests/LocalCrmAgent.Tests/Models/MessageSerializationTests.cs` | ~8 JSON serialization tests |
| `tests/LocalCrmAgent.Tests/Integration/WebSocketProtocolTests.cs` | ~10 protocol tests |
| `tests/LocalCrmAgent.Tests/Integration/RecordingPipelineTests.cs` | ~3 end-to-end pipeline tests |
| `tests/LocalCrmAgent.Tests/Integration/UploadPipelineTests.cs` | ~3 upload pipeline tests |

### Dashboard Tests
| File | Tests |
|------|-------|
| `apps/dashboard/tests/helpers/mock-agent.ts` | Extend with recording helpers |
| `apps/dashboard/tests/15-agent-recording.spec.ts` | ~12 recording UI/control tests |
| `apps/dashboard/tests/16-agent-recording-call-flow.spec.ts` | ~6 full call lifecycle tests |
| `apps/dashboard/tests/17-power-dialer-recording.spec.ts` | ~5 power dialer + recording tests |
| `apps/dashboard/tests/18-agent-connectivity.spec.ts` | ~7 connectivity + auth tests |

### CI/CD
| File | Purpose |
|------|---------|
| `.github/workflows/test.yml` | Automated test execution on push/PR |

**Total new tests: ~130 across agent unit, integration, and dashboard E2E layers.**
