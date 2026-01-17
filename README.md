# CRM-Tableturnerr

A unified, full-stack CRM and Outreach platform designed to streamline sales operations by integrating cold call monitoring, automated transcription, and Instagram outreach management into a single cohesive system.

This monorepo contains the complete ecosystem including a modern Next.js dashboard, a shared PocketBase backend, and specialized Python tools for data capture and processing.

## 🏗️ Architecture

The system follows a modular architecture:

```
CRM-Tableturnerr/
├── apps/
│   ├── dashboard/             # 🖥️ Unified Web Interface (Next.js 15, React 19, Tailwind)
│   └── insta-outreach-agent/  # 🤖 Python desktop agent for Instagram DM automation
├── packages/
│   └── pocketbase-client/     # 📦 Shared SDK wrapper & schema definitions for PocketBase
└── tools/
    ├── audio-recorder/        # 🎙️ Desktop audio recording tool (PyQt) with hotkey support
    ├── transcriber/           # 🧠 AI Transcription service (Gemini API) for cold calls
    └── database/              # 🗄️ Database seeding and migration scripts
```

## 🚀 Key Features

- **Unified Dashboard**: View cold calls, companies, leads, and team performance in one place.
- **Cold Call Intelligence**: 
    - Desktop audio recorder captures calls properly.
    - AI Transcriber (Gemini) converts audio to text, extracting summary, objections, and sentiment.
- **Instagram Outreach**: 
    - Automated agent manages DM workflows.
    - Tracks actor status and outreach performance.
- **Team Management**: Role-based access and activity tracking for sales reps.

## 🛠️ Quick Start

### 1. Prerequisites
- **Node.js** v18+ (with pnpm)
- **Python** 3.10+
- **PocketBase** (v0.22+ recommended)

### 2. Install Dependencies
```bash
# Install Node.js dependencies
pnpm install

# Install Python dependencies (in respective tool folders)
cd tools/database && pip install -r requirements.txt
```

### 3. Backend Setup (PocketBase)
1. Start PocketBase: `pocketbase serve` (default: http://localhost:8090)
2. Import schema from `packages/pocketbase-client/pb_schema.json` via the Admin UI.
3. Seed sample data:
   ```bash
   cd tools/database
   cp .env.example .env # Configure your admin credentials
   python seed_data.py
   ```

### 4. Start Dashboard
```bash
cd apps/dashboard
cp .env.example .env.local # Configure NEXT_PUBLIC_POCKETBASE_URL
pnpm dev
```
Visit http://localhost:3000 to access the dashboard.

## 📘 Documentation

- **[Setup Guide](SETUP_GUIDE.md)**: Detailed step-by-step installation, testing, and production deployment guide.
- **Data Schema**: See `packages/pocketbase-client` for database structure.

## 🧩 Components Detail

### Dashboard (`apps/dashboard`)
A modern, responsive web application built with Next.js App Router. Features include:
- **Authentication**: Secure login via PocketBase.
- **Interactive Tables**: filtering, sorting, and inline editing for Leads and Companies.
- **Visualizations**: Activity charts and performance metrics.

### Transcriber (`tools/transcriber`)
A standalone Python service that watches for new audio files, sends them to Google's Gemini Flash model for analysis, and updates the CRM record with transcripts, summaries, and structured data (objections, outcome).

### Audio Recorder (`tools/audio-recorder`)
A lightweight system tray application that allows sales reps to record calls with a global hotkey, automatically naming and saving files for the Transcriber to pick up.

## 📄 License

MIT