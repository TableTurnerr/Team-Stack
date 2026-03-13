# Local CRM Agent

A lightweight Windows desktop agent that monitors Zoom Phone call state via WASAPI (Windows Audio Session API) and serves reliable call signals to the CRM dashboard over WebSocket.

## Why This Exists

The CRM dashboard embeds Zoom Phone in an iframe. When the user's internet becomes unstable, Zoom fires false "disconnect" events even though the call is still active (Zoom uses a separate, more resilient connection). This causes recordings to stop prematurely.

The Local CRM Agent solves this by monitoring Zoom's audio sessions directly at the OS level. If Zoom has an active audio session, the call is live — regardless of what the iframe reports. The CRM dashboard connects to this agent and uses its signals to suppress false disconnects.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Local CRM Agent                    │
│                                                 │
│  ┌─────────────────┐   ┌─────────────────────┐  │
│  │ ZoomAudioMonitor│   │ ZoomWindowMonitor   │  │
│  │ (WASAPI)        │   │ (Win32 Window Title)│  │
│  │ Ground Truth    │   │ Supplementary       │  │
│  └────────┬────────┘   └──────────┬──────────┘  │
│           └──────────┬────────────┘              │
│              ┌───────▼────────┐                  │
│              │ CallStateFusion│                  │
│              │ (State Machine)│                  │
│              └───────┬────────┘                  │
│   ┌──────────────────┼──────────────────┐        │
│   │          ┌───────▼────────┐         │        │
│   │          │  AgentService  │         │        │
│   │          │ (Orchestrator) │         │        │
│   │          └───────┬────────┘         │        │
│   │  ┌───────────────┼─────────────┐    │        │
│   │  │       ┌───────▼────────┐    │    │        │
│   │  │       │ WebSocket Srv  │    │    │        │
│   │  │       │ localhost:9876 │    │    │        │
│   │  │       └───────┬────────┘    │    │        │
│   │  │               │             │    │        │
│   │  │  NetworkMonitor  TrayIcon   │    │        │
│   │  └─────────────────────────────┘    │        │
│   └─────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
                       │
              WebSocket (JSON)
                       │
              ┌────────▼────────┐
              │  CRM Dashboard  │
              │  (Browser)      │
              └─────────────────┘
```

## How It Works

### Signal Sources

| Signal | Source | Purpose |
|--------|--------|---------|
| **WASAPI Audio** | OS-level audio session API | **Ground truth** — if Zoom has an active audio session, the call is live |
| **Window Title** | Win32 `EnumWindows` + `GetWindowText` | Supplementary — detects ringing state, phone numbers, call timers |
| **Network Ping** | ICMP to 8.8.8.8 / 1.1.1.1 | Informational — latency, jitter, packet loss metrics |

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

- **Idle → Ringing**: Window title shows "Calling" / "Ringing"
- **Idle → Connected**: Audio session becomes active (skips ringing for fast pickups)
- **Ringing → Connected**: Audio session activates
- **Connected → Ended**: Audio inactive for 3 seconds
- **Ended → Idle**: 3-second cooldown
- **Ended → Connected**: New audio session starts (call reconnect)

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
  "version": "1.0.0",
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

## Configuration

All configuration is hardcoded (no config files needed):

| Setting | Value | Description |
|---------|-------|-------------|
| WebSocket port | `9876` | Localhost only |
| Audio inactive threshold | `3s` | Time before declaring call ended |
| Ended cooldown | `3s` | Time in "ended" before returning to idle |
| Ringing timeout | `60s` | Max time in ringing without answer |
| State poll interval | `500ms` | How often signals are checked |
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

1. **Auto-reconnect** with exponential backoff (1s → 30s max)
2. **Agent verification** on the session start page — must be running before starting a call session
3. **False disconnect suppression** — if the agent confirms the call is still active, iframe disconnect events are ignored
4. **Agent status indicator** in the dialer UI showing connection state
5. **Launch button** — triggers `crm-agent://launch` protocol handler to start the agent from the browser

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
    │   └── AgentService.cs        # Orchestrator, broadcast loops
    └── UI/
        └── TrayIconManager.cs     # System tray icon + context menu
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| NAudio | 2.2.1 | WASAPI audio session enumeration |
| Fleck | 1.2.0 | WebSocket server |
