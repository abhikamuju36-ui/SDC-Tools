# SDC Tools

**Stevens Douglas Corp. — Engineering Applications Suite**

SDC Tools is a Windows desktop application (Electron) that bundles five internal engineering web apps into a single unified launcher. Each app runs as a Node.js/Express server on a dedicated port on the company server (SERVER-APP1); the Electron shell provides a dashboard, authentication, auto-update, and one-click access to every app.

---

## Applications

| App | Port | Description | Backend DB |
|-----|------|-------------|------------|
| **Assemblies Library** | 4001 | SolidWorks CAD assembly search, preview & vault management | SQLite (`assemblies.db`) |
| **Build Readiness Report** | 4002 | Live ETO project build status — parts, prints, sign-offs | ETO on-prem SQL Server + Smartsheet |
| **SDC Scheduler** | 4003 | Gantt scheduling, resource loading, Smartsheet sync | SQLite + Smartsheet |
| **State Logic Builder** | 4004 | Visual PLC state-machine editor → Allen-Bradley L5X export | File-based (JSON projects) |
| **SDC Calendar** | 4005 | Company-wide calendar — events, birthdays, paydays, Scheduler sync | SQLite + Smartsheet |

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22 LTS |
| npm | 10+ |
| PM2 | latest (`npm install -g pm2`) |

---

## Quick Start (Development)

```bash
# 1. Clone the repo
git clone https://github.com/abhikamuju36-ui/SDC-Tools.git
cd SDC-Tools

# 2. Install all workspace dependencies
npm install

# 3. Set up environment files (see Environment Variables section below)

# 4. Run the Electron shell in dev mode (connects to SERVER-APP1 backends)
cd shell
npm run dev
```

The shell starts Vite on port 5173 for hot-reload, then launches Electron. Each sub-app is accessed via its port on SERVER-APP1.

---

## Server Setup (PM2 — SERVER-APP1)

All five backends run on the company server via PM2:

```bash
# First-time setup on SERVER-APP1
npm install
pm2 startOrRestart ecosystem.config.js
pm2 save
pm2 startup   # follow printed command to auto-start on boot
```

**Auto-updates are fully automatic** — each app has a dedicated PM2 updater process that polls GitHub every 2–5 minutes and restarts the app when new code is available. No manual `git pull` needed.

| Updater process | Polls | Trigger port |
|-----------------|-------|--------------|
| `sdc-updater` | `abhikamuju36-ui/SDC-Tools` (master) | — |
| `sdc-brr-updater` | `abhikamuju36-ui/Build_Readiness_Report` | 4012 |
| `sdc-scheduler-updater` | `danbelliveau2/SDC_Scheduler` (main) | 4013 |
| `sdc-statelogic-updater` | `danbelliveau2/state_logic_builder` (releases) | 4014 |

---

## Environment Variables

### Assemblies Library (`Assembilies library main/.env`)
```env
SHARED_BASE=\\stevendouglas.local\dfs\Company\Job Folder\_Assembilies_Library_Application
DELETE_PASSWORD=your_delete_password
```

### Build Readiness Report (`Build_Readiness_Report/.env`)
```env
# ETO on-prem SQL Server (required)
ETO_HOST=SERVER-APP1.stevendouglas.local
ETO_DATABASE=SDC
ETO_USER=your_user
ETO_PASSWORD=your_password
ETO_DOMAIN=stevendouglas
ETO_PORT=1433

# Smartsheet (optional — enriches build dates)
SMARTSHEET_API_KEY=your_token

PORT=3000
```

### SDC Scheduler (`SDC_Scheduler/.env`)
```env
SMARTSHEET_API_TOKEN=your_token
SESSION_SECRET=your_session_secret
```

### State Logic Builder (`state_logic_builder/.env`)
```env
STANDARDS_DIR=N:\AI Folder\State Logic Diagrams\standards
```

### SDC Calendar (`SDC Centrailzed calender/server/.env`)
```env
SMARTSHEET_API_TOKEN=your_token
JWT_SECRET=your_jwt_secret
SESSION_SECRET=your_session_secret
FRONTEND_URL=http://SERVER-APP1:4005
SERVER_IP=SERVER-APP1
```

### Shell / Electron (`shell/.env`)
```env
SDC_SERVER_HOST=SERVER-APP1
AZURE_TENANT_ID=your_tenant_id
AZURE_CLIENT_ID=your_client_id
```

---

## Releasing a New Shell Version

Releases are **fully automated** via GitHub Actions:

1. Bump `"version"` in `shell/package.json`
2. Commit and push to `master`

```bash
# Edit shell/package.json version, then:
git add shell/package.json
git commit -m "chore: release v1.3.0"
git push
```

GitHub Actions detects the version change, builds the Windows NSIS installer on a `windows-latest` runner, and publishes it to **GitHub Releases**. Every installed copy of SDC Tools silently downloads and installs the update on next quit (within ~2 minutes of release).

> **Backend updates** (BRR, Scheduler, State Logic Builder) do **not** need a new shell release — the per-app auto-updaters handle them independently.

---

## Project Structure

```
SDC-Tools/
├── shell/                          # Electron launcher (main process + React UI)
│   ├── electron/
│   │   ├── main.js                 # Entry — BrowserWindow, IPC, auto-updater
│   │   ├── processManager.js       # Connects to sub-app servers
│   │   ├── auth.js                 # Azure AD (MSAL) authentication
│   │   ├── preload.js              # Context-bridge: shell renderer
│   │   └── appPreload.js           # Context-bridge: sub-app windows
│   ├── src/                        # React launcher UI (Vite)
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── AppCard.jsx         # Per-app card — status, logs, open, update
│   │   │   ├── AppGrid.jsx
│   │   │   ├── NotificationCenter.jsx
│   │   │   ├── RecentActivity.jsx
│   │   │   ├── StatusBar.jsx
│   │   │   ├── LogPanel.jsx
│   │   │   └── UpdateBanner.jsx    # Shell auto-update notification strip
│   │   └── screens/LoginScreen.jsx
│   ├── build/                      # Electron icon assets
│   ├── electron-builder.yml        # Installer config (publish → GitHub Releases)
│   └── package.json
│
├── Assembilies library main/       # Assemblies Library (Express + React/Vite + SQLite)
├── Build_Readiness_Report/         # Build Readiness (Express + React, ETO SQL + Smartsheet)
├── SDC_Scheduler/                  # SDC Scheduler (Express + vanilla JS + SQLite)
├── state_logic_builder/            # State Logic Builder (Express + React/Vite)
├── SDC Centrailzed calender/       # SDC Calendar (Express + vanilla JS)
│
├── scripts/
│   └── server-auto-update.js       # Root monorepo updater (git pull + pm2 restart)
│
├── .github/workflows/
│   ├── release.yml                 # Build + publish installer on shell version bump
│   └── ci.yml                      # PR checks
│
├── ecosystem.config.js             # PM2 process definitions for SERVER-APP1
├── .env.example                    # Environment variable reference
├── .gitignore
├── package.json                    # npm workspaces root
└── ARCHITECTURE.md                 # Detailed architecture & IPC reference
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 35, electron-builder, electron-updater |
| Launcher UI | React 18, Vite 5 |
| Sub-app servers | Node.js 22, Express 4 |
| Sub-app frontends | React/Vite (Assemblies, State Logic, BRR), Vanilla JS (Scheduler, Calendar) |
| Databases | SQLite/better-sqlite3 (Assemblies, Scheduler, Calendar), ETO on-prem MSSQL (BRR) |
| Authentication | Azure AD — MSAL Node (shell only) |
| External sync | Smartsheet API (Scheduler, Calendar, BRR) |
| CI/CD | GitHub Actions → GitHub Releases (shell installer) |
| Process management | PM2 (SERVER-APP1) |

---

*Stevens Douglas Corp. — Internal tooling. Not for public distribution.*
