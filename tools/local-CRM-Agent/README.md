# Local CRM Agent

A lightweight Windows desktop agent that monitors Zoom Phone call state via WASAPI (Windows Audio Session API) event callbacks and serves reliable call signals to the CRM dashboard over a localhost WebSocket.

## Why This Exists

The CRM dashboard embeds Zoom Phone in an iframe. When the user's internet becomes unstable, Zoom fires false "disconnect" events even though the call is still active (Zoom uses a separate, more resilient connection). This causes recordings to stop prematurely.

The Local CRM Agent solves this by monitoring Zoom's audio sessions directly at the OS level using event-driven WASAPI callbacks. When a Zoom audio session starts or stops, Windows notifies the agent **instantly** — no polling delay, no internet dependency. The CRM dashboard connects to this agent over a localhost WebSocket (`ws://127.0.0.1:9876`) and uses its signals as ground truth for call state.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              Local CRM Agent                         │
│                                                      │
│  ┌──────────────────────┐   ┌─────────────────────┐  │
│  │  ZoomAudioMonitor    │   │ ZoomWindowMonitor   │  │
│  │  (WASAPI Events)     │   │ (Win32 Window Title)│  │
│  │  Event-driven +      │   │ Supplementary       │  │
│  │  500ms fallback poll │   │                     │  │
│  │  Ground Truth        │   │                     │  │
│  └────────┬─────────────┘   └──────────┬──────────┘  │
│           └──────────┬─────────────────┘              │
│              ┌───────▼────────┐                       │
│              │ CallStateFusion│                       │
│              │ (State Machine)│                       │
│              └───────┬────────┘                       │
│   ┌──────────────────┼──────────────────┐             │
│   │          ┌───────▼────────┐         │             │
│   │          │  AgentService  │         │             │
│   │          │ (Orchestrator) │         │             │
│   │          └───────┬────────┘         │             │
│   │  ┌───────────────┼─────────────┐    │             │
│   │  │       ┌───────▼────────┐    │    │             │
│   │  │       │ WebSocket Srv  │    │    │             │
│   │  │       │ localhost:9876 │    │    │             │
│   │  │       └───────┬────────┘    │    │             │
│   │  │               │             │    │             │
│   │  │  NetworkMonitor  TrayIcon   │    │             │
│   │  └─────────────────────────────┘    │             │
│   └─────────────────────────────────────┘             │
└──────────────────────────────────────────────────────┘
                       │
              WebSocket (JSON) — localhost only
              Sub-millisecond latency (~0.1ms)
                       │
              ┌────────▼────────┐
              │  CRM Dashboard  │
              │  (Browser)      │
              └─────────────────┘
```

## How It Works

### Connection Model

The agent communicates with the CRM dashboard entirely over **localhost** (`ws://127.0.0.1:9876`). This means:

- **Zero internet dependency** — packets never leave the machine; it's a loopback connection
- **Sub-millisecond latency** (~0.1ms) — just inter-process memory copies via the OS loopback interface
- **No DNS, no TLS, no routing** — direct process-to-process communication
- **Always-open persistent WebSocket** — no per-message connection overhead
- **Immune to network issues** — works even if the internet is completely down

### Signal Sources

| Signal | Source | Detection Model | Purpose |
|--------|--------|-----------------|---------|
| **WASAPI Audio** | OS-level audio session API | **Event-driven** (instant callbacks) + 500ms fallback poll | **Ground truth** — if Zoom has an active audio session, the call is live |
| **Window Title** | Win32 `EnumWindows` + `GetWindowText` | Polled alongside fusion evaluation | Supplementary — detects ringing state, phone numbers, call timers |
| **Network Ping** | ICMP to 8.8.8.8 / 1.1.1.1 | Polled every 3s | Informational — latency, jitter, packet loss metrics |

### Event-Driven WASAPI Detection

Instead of polling audio sessions on a timer, the agent registers **OS-level event callbacks** via NAudio's WASAPI interface:

| WASAPI Event | Fires When | Agent Response |
|--------------|-----------|----------------|
| `OnSessionCreated` | Zoom opens a new audio stream (call starts) | Attaches listener, evaluates state immediately |
| `OnStateChanged` | Audio session goes Active/Inactive/Expired | Evaluates state immediately (call connected/ended) |
| `OnSessionDisconnected` | Audio session is destroyed | Evaluates state immediately (call fully ended) |

Windows fires these callbacks the **instant** the audio session state changes — no polling delay. A 500ms fallback poll runs as a safety net to catch edge cases (device changes, COM threading).

### State Machine

```
idle ──▶ ringing ──▶ connected ──▶ ended ──▶ idle
  │                      ▲           │
  └──────────────────────┘           │
  (audio session detected)           │
                                     │
  ┌──────────────────────────────────┘
  │ (new audio session = reconnect)
  └──▶ connected
```

- **Idle -> Ringing**: Window title shows "Calling" / "Ringing"
- **Idle -> Connected**: Audio session becomes active (skips ringing for fast pickups)
- **Ringing -> Connected**: Audio session activates
- **Connected -> Ended**: Audio inactive for 0.3 seconds (confirmed by event + fallback poll)
- **Ended -> Idle**: 1-second cooldown
- **Ended -> Connected**: New audio session starts (call reconnect)

### End-to-End Detection Latency

| Step | Latency | Internet Required? |
|------|---------|-------------------|
| Zoom call ends -> Windows tears down audio session | ~0ms | No |
| WASAPI fires `OnStateChanged` callback | ~0ms | No |
| CallStateFusion evaluates + transitions to "ended" | ~1ms | No |
| WebSocket broadcasts to dashboard (localhost) | ~0.1ms | No |
| React state update + re-render | ~16ms (one frame) | No |
| **Total** | **~20ms** | **No** |

Compare to previous polling-based approach (~6.5s worst case).

### WebSocket Messages

The agent broadcasts JSON messages to `ws://127.0.0.1:9876`:

**Call State** (every 1s when connected):
```json
{
  "type": "callState",
  "state": "connected",
  "phoneNumber": "+15551234567",
  "direction": "inbound",
  "duration": 45,
  "confidence": "high",
  "timestamp": 1710300000000
}
```

**Heartbeat** (every 5s):
```json
{
  "type": "heartbeat",
  "version": "1.0.9",
  "uptime": 3600,
  "zoomDetected": true,
  "connectedClients": 1,
  "timestamp": 1710300000000
}
```

**Network Quality** (every ~10s):
```json
{
  "type": "networkQuality",
  "latencyMs": 25.5,
  "jitter": 3.2,
  "packetLoss": 0.0,
  "isStable": true,
  "timestamp": 1710300000000
}
```

## Call Recording & GoHighLevel Upload

Beyond serving call-state signals, the agent records each call's audio locally
(one clip per call) and attaches it to the matching **GoHighLevel** contact:

- **Capture** — WASAPI loopback (system / remote party) mixed with the mic into a
  mono WAV, converted to MP3 (WAV kept as a fallback on conversion failure).
- **Upload** — once converted, the clip is POSTed to the `zoomphone-bridge`
  worker's `/recordings/ingest`, which matches the GHL contact by phone and
  attaches the audio. GHL is the CRM; the agent holds no GHL credentials, only a
  worker URL + shared agent token. See **[RECORDING-UPLOAD.md](RECORDING-UPLOAD.md)**.
- **Web-phone calls** — a Zoom call placed from the browser is detected by the
  Lead Scraper Chrome extension, which triggers the agent over Chrome Native
  Messaging. See **[NATIVE-MESSAGING.md](NATIVE-MESSAGING.md)**.

## Configuration

Call-state detection is tuned by the constants below. Recording **upload** is
provisioned separately (worker URL + shared token + rep id) via
`%AppData%\CrmAgent\agent-config.json`, environment variables, or the
`setWorkerConfig` WebSocket command — see [RECORDING-UPLOAD.md](RECORDING-UPLOAD.md).

| Setting | Value | Description |
|---------|-------|-------------|
| WebSocket port | `9876` | Localhost only |
| Detection model | Event-driven | WASAPI callbacks fire instantly on session state change |
| Fallback poll interval | `500ms` | Safety net poll in case events are missed |
| Audio inactive threshold | `0.3s` | Confirmation window before declaring call ended |
| Ended cooldown | `1.0s` | Time in "ended" before returning to idle |
| Ringing timeout | `60s` | Max time in ringing without answer |
| Network ping interval | `3s` | How often network is measured |
| Zoom processes | `zoom`, `cpthost`, `zoomphone` | Process names to detect |

## System Tray

The agent runs as a system tray icon with a colored dot:

| Color | State |
|-------|-------|
| Gray | Idle |
| Gold | Ringing |
| Green | Connected |
| Blue | Ended |

Right-click the tray icon for status info (call state, connected CRM clients, Zoom detection). Double-click for a status balloon notification.

## CRM Dashboard Integration

The dashboard connects to the agent via the `LocalAgentProvider` context (`local-agent-context.tsx`):

1. **Localhost WebSocket** — `ws://127.0.0.1:9876`, sub-millisecond latency, zero internet dependency
2. **Auto-reconnect** with exponential backoff (1s → 30s max)
3. **Agent verification** on the session start page — must be running before starting a call session
4. **Instant end detection** — Zoom iframe "ended" events are processed immediately; agent WASAPI events provide parallel confirmation
5. **Agent status indicator** in the dialer UI showing connection state
6. **Launch button** — triggers `crm-agent://launch` protocol handler to start the agent from the browser

## Development

### Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- Windows 10/11

### Build & Run

```bash
cd tools/local-CRM-Agent
dotnet run --project src/LocalCrmAgent/LocalCrmAgent.csproj
```

### Build Release

```bash
cd tools/local-CRM-Agent
build-release.bat
```

This produces a self-contained single-file executable at `dist/LocalCrmAgent.exe` (~75MB) with no .NET runtime dependency. The `dist/` folder also includes `install.bat` and `uninstall.bat` for team distribution.

### Project Structure

```
tools/local-CRM-Agent/
├── build-release.bat              # Build script (produces dist/)
├── install.bat                    # End-user installer
├── uninstall.bat                  # End-user uninstaller
├── LocalCrmAgent.sln
└── src/LocalCrmAgent/
    ├── LocalCrmAgent.csproj
    ├── Program.cs                 # Entry point, single-instance, registry setup
    ├── Models/
    │   ├── CallState.cs           # State enums, CallStateInfo
    │   └── Messages.cs            # WebSocket message DTOs
    ├── Services/
    │   ├── ZoomAudioMonitor.cs    # WASAPI audio session detection
    │   ├── ZoomWindowMonitor.cs   # Win32 window title parsing
    │   ├── NetworkMonitor.cs      # ICMP ping quality metrics
    │   ├── CallStateFusion.cs     # State machine (core logic)
    │   ├── WebSocketServer.cs     # Fleck WS server on :9876
    │   ├── AudioRecorderService.cs    # Per-call WASAPI capture → WAV → MP3
    │   ├── RecordingStorageManager.cs # Local clip manifest + upload queue
    │   ├── RecordingUploadService.cs  # Upload clips to the GHL worker ingest
    │   ├── NativeMessagingHost.cs     # Chrome host: web-phone START/STOP relay
    │   ├── StartupRegistrar.cs        # Run key, crm-agent://, native host manifest
    │   ├── AgentConfig.cs             # Persisted settings + worker upload config
    │   └── AgentService.cs        # Orchestrator, broadcast loops
    └── UI/
        └── TrayIconManager.cs     # System tray icon + context menu
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| NAudio | 2.2.1 | WASAPI audio session events + enumeration |
| Fleck | 1.2.0 | WebSocket server |
