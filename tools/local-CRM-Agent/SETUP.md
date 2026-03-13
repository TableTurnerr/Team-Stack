# CRM Local Agent - Setup Guide

## For Team Members (End Users)

### Quick Install

1. Download the **CRM-Agent.zip** file shared with you
2. Extract the zip to any folder (e.g., your Desktop)
3. Double-click **`install.bat`**
4. Done!

The installer will:
- Install the agent to your computer
- Set it to start automatically when you log in
- Launch it immediately

### Verifying It's Running

Look for a **small colored dot** in your system tray (bottom-right corner of your screen, near the clock). You may need to click the **^** arrow to see it.

| Dot Color | Meaning |
|-----------|---------|
| Gray | Idle (no active call) |
| Gold | Ringing |
| Green | Call connected |
| Blue | Call just ended |

You can also verify from the CRM dashboard:
- Go to the **Session** page
- Click **Start Session**
- The "CRM Local Agent" card should show a **green checkmark**

### Troubleshooting

**"Agent not detected" on the CRM dashboard:**
1. Check your system tray for the agent icon
2. If not there, go to `%LocalAppData%\TableTurnerr\LocalCrmAgent\` and run `LocalCrmAgent.exe`
3. If it still doesn't connect, try restarting your browser

**Agent isn't starting on login:**
1. Open **Task Manager** → **Startup** tab
2. Make sure **LocalCrmAgent** is **Enabled**
3. If it's not listed, run `install.bat` again

**Zoom not detected by the agent:**
- Make sure Zoom Workplace is running (not just the web version)
- The agent only detects the **desktop Zoom app**

### Uninstalling

1. Open the folder where you extracted the zip
2. Double-click **`uninstall.bat`**

This removes the agent, its auto-start entry, and all related files.

---

## For Developers

### Building a New Release

From the repo root:
```bash
cd tools/local-CRM-Agent
build-release.bat
```

This creates `dist/` with:
- `LocalCrmAgent.exe` — self-contained, no .NET install needed (~75MB)
- `install.bat` — end-user installer
- `uninstall.bat` — end-user uninstaller

### Distributing to the Team

1. Run `build-release.bat`
2. Zip the `dist/` folder
3. Rename to `CRM-Agent.zip`
4. Share with the team (Slack, email, Google Drive, etc.)

### What the Installer Does

The `install.bat` script performs these steps (no admin rights needed):

1. **Copies** `LocalCrmAgent.exe` to `%LocalAppData%\TableTurnerr\LocalCrmAgent\`
2. **Registers auto-start** in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
3. **Registers `crm-agent://` protocol handler** so the CRM can launch the agent from the browser
4. **Starts** the agent

### Updating the Agent

To push an update to the team:

1. Make your code changes
2. Run `build-release.bat`
3. Zip and share the new `dist/` folder
4. Team members extract and run `install.bat` again — it will stop the old version and replace it

### How the CRM Dashboard Connects

The dashboard integration lives in these files:

| File | Purpose |
|------|---------|
| `apps/dashboard/src/contexts/local-agent-context.tsx` | WebSocket client, auto-reconnect, state management |
| `apps/dashboard/src/contexts/zoom-phone-context.tsx` | Uses agent state to suppress false iframe disconnects |
| `apps/dashboard/src/app/(dashboard)/layout.tsx` | Wraps app in `LocalAgentProvider` |
| `apps/dashboard/src/app/(dashboard)/session/page.tsx` | Agent verification on session start |
| `apps/dashboard/src/components/zoom-phone-dialer.tsx` | Agent status indicator in dialer UI |

**Connection flow:**
1. Dashboard opens WebSocket to `ws://127.0.0.1:9876`
2. Agent sends current state immediately on connect
3. Agent broadcasts state updates, heartbeats, and network quality
4. If connection drops, dashboard retries with exponential backoff (1s, 2s, 4s, 8s, 15s, 30s)
5. If agent not running, dashboard shows "Click to launch" which triggers `crm-agent://launch`

### Requirements

- **End users**: Windows 10/11 (no other dependencies — the exe is self-contained)
- **Developers**: .NET 8 SDK for building
