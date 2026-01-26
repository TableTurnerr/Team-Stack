# Call Recorder V2

Automated call recording application for Zoom Phone with PocketBase integration.

## Features

- **Window Monitoring**: Select any window (Zoom Phone) for monitoring
- **OCR-based Detection**: Automatically detects call state via screen capture and OCR
- **Audio Recording**: Records both microphone and desktop audio as MP3
- **Sidebar UI**: Floating/dockable sidebar for entering call metadata
- **PocketBase Sync**: Uploads recordings and metadata to dashboard
- **Offline Support**: Local SQLite storage with sync queue

## Requirements

- Windows 10/11 (64-bit)
- .NET 8.0 Runtime
- Zoom Phone desktop app
- Stereo Mix (or virtual audio cable) for desktop audio capture

## Setup

### 1. Install Dependencies

```bash
# Restore NuGet packages
dotnet restore
```

### 2. Download Tesseract Data

Download `eng.traineddata` from:
https://github.com/tesseract-ocr/tessdata/blob/main/eng.traineddata

Place it in: `src/CallRecorder.App/Resources/tessdata/eng.traineddata`

### 3. Enable Stereo Mix

For desktop audio recording:
1. Right-click speaker icon → Sounds
2. Recording tab → Right-click → Show Disabled Devices
3. Enable "Stereo Mix"

### 4. Build & Run

```bash
cd tools/call-recorder-v2
dotnet build
dotnet run --project src/CallRecorder.App
```

## Usage

1. **Start the app** - Main window appears
2. **Select Zoom Phone** - Pick from window list
3. **Click "Start Monitoring"** - App begins watching for calls
4. **Make a call** - Sidebar appears when call detected
5. **Enter metadata** - Fill in receptionist name, notes, etc.
6. **Call ends** - 10-second countdown, then auto-save

## Project Structure

```
call-recorder-v2/
├── CallRecorder.sln
├── src/
│   ├── CallRecorder.App/        # WPF Application
│   │   ├── Views/
│   │   │   ├── MainWindow.xaml  # Window selection
│   │   │   └── SidebarWindow.xaml  # Recording sidebar
│   │   └── Resources/
│   │
│   ├── CallRecorder.Core/       # Business Logic
│   │   ├── Models/
│   │   │   ├── CallState.cs
│   │   │   ├── CallRecord.cs
│   │   │   └── AppConfig.cs
│   │   └── Services/
│   │       ├── WindowService.cs       # Window enumeration
│   │       ├── ScreenCaptureService.cs # Screen capture
│   │       ├── OcrService.cs          # Tesseract OCR
│   │       ├── CallStateService.cs    # State detection
│   │       └── AudioRecorderService.cs # Audio recording
│   │
│   └── CallRecorder.Infrastructure/  # Data Layer
│       ├── Data/
│       │   └── LocalDbContext.cs      # SQLite storage
│       └── PocketBase/
│           └── PocketBaseClient.cs    # API client
│
└── installer/                   # NSIS installer scripts
```

## Configuration

Settings are stored per-user in:
`%APPDATA%\CallRecorder\`

Key settings:
- `AutoRecordOnCall` - Skip prompt, record immediately
- `PostCallCountdownSeconds` - Seconds before auto-save (default: 10)
- `AudioBitrate` - MP3 bitrate in kbps (default: 128)

## API Integration

The app connects to the same PocketBase instance as the dashboard.

Collections used:
- `users` - Authentication
- `phone_numbers` - Phone → Company matching
- `companies` - Company info
- `recordings` - Recording storage

## Troubleshooting

### OCR not detecting phone numbers

1. Check `eng.traineddata` is present in tessdata folder
2. Ensure Zoom Phone window is not minimized
3. Check debug output for OCR text

### No desktop audio

1. Enable Stereo Mix in Windows Sound settings
2. Try a virtual audio cable (VB-Cable, etc.)
3. Check microphone permissions

### Recording file too large

- Default is 128kbps MP3, adjust `AudioBitrate` setting
- 128kbps ≈ 1MB per minute

## Tech Stack

- **.NET 8** - Framework
- **WPF** - Windows Presentation Foundation
- **Material Design** - UI Components
- **NAudio** - Audio capture
- **NAudio.Lame** - MP3 encoding
- **Tesseract.NET** - OCR engine
- **EF Core + SQLite** - Local database
- **System.Net.Http** - PocketBase API
