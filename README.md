# SDC Tools

**Stevens Douglas Corp. — Engineering Applications Suite**

SDC Tools is a Windows desktop application (Electron) that bundles five internal engineering web apps into a single unified launcher. Each app runs as an in-process Node.js server on a dedicated localhost port; the Electron shell provides authentication, auto-update, and a central dashboard.

---

## Applications

| App | Port | Description |
|-----|------|-------------|
| **Assemblies Library** | 4001 | SolidWorks CAD assembly search, preview, and vault check-out |
| **Build Readiness Report** | 4002 | Live ETO project build status — parts, prints, and sign-offs |
| **SDC Scheduler** | 4003 | Gantt scheduling, resource loading, and two-way Smartsheet sync |
| **State Logic Builder** | 4004 | Visual PLC state-machine editor with Allen-Bradley L5X export |
| **SDC Calendar** | 4005 | Company-wide calendar — events, birthdays, paydays, Scheduler sync |

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22 LTS |
| npm | 10+ |

All sub-apps use **Azure SQL** (pure-JS `mssql` driver) — no native modules, no SQLite dependency.

---

## Quick Start (Development)

```bash
# 1. Clone the repo
git clone https://github.com/abhikamuju36-ui/SDC-Tools.git
cd SDC-Tools

# 2. Copy and fill in environment files
cp .env.example shell/.env                             # Azure AD credentials
cp .env.example "Assembilies library main/.env"        # Azure SQL
cp .env.example "Build_Readiness_Report/.env"
cp .env.example "SDC_Scheduler/.env"
cp .env.example "state_logic_builder/.env"
cp .env.example "SDC Centrailzed calender/server/.env"

# 3. Install all dependencies
npm install                 # root workspace (installs shell deps)
npm install --prefix "Assembilies library main"
npm install --prefix Build_Readiness_Report
npm install --prefix SDC_Scheduler
npm install --prefix state_logic_builder
npm install --prefix "SDC Centrailzed calender/server"

# 4. Run the Electron shell in dev mode
cd shell
npm run dev
```

The shell starts Vite on port 5173 for hot-reload, then launches Electron. Each sub-app starts automatically on its port when the launcher opens.

---

## Environment Variables

Copy `.env.example` to each sub-app directory and fill in the values.

### Azure SQL (all sub-apps)
```env
AZURE_SQL_SERVER=sdc-automation.database.windows.net
AZURE_SQL_DATABASE=free-sql-db-7038618
AZURE_SQL_USER=sdcadmin
AZURE_SQL_PASSWORD=your_password_here
```

### Shell (Azure AD authentication)
```env
AZURE_TENANT_ID=your_tenant_id
AZURE_CLIENT_ID=your_client_id
```

### Assemblies Library (delete protection)
```env
DELETE_PASSWORD=your_delete_password
```

### SDC Scheduler (Smartsheet sync)
```env
SMARTSHEET_API_TOKEN=your_token
SESSION_SECRET=your_session_secret
```

### SDC Calendar (Azure AD + Smartsheet)
```env
AZURE_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_jwt_secret
SESSION_SECRET=your_session_secret
SMARTSHEET_API_TOKEN=your_token
```

---

## Building the Installer

```bash
cd shell
npm run electron:build
```

Output: `shell/dist-electron/SDC-Tools-Setup-<version>.exe`

---

## Releasing a New Version

Releases are **fully automated** via GitHub Actions:

1. Bump `"version"` in `shell/package.json`
2. Commit and push to `master`

```bash
# Example: bump 1.0.3 → 1.1.0
# Edit shell/package.json, then:
git add shell/package.json
git commit -m "chore: release v1.1.0"
git push
```

GitHub Actions detects the version change, builds the Windows installer on a `windows-latest` runner, and publishes it to **GitHub Releases**. Every installed copy of SDC Tools will silently download and install the update within ~30 minutes.

---

## Project Structure

```
SDC-Tools/
├── shell/                          # Electron launcher (main process + React UI)
│   ├── electron/
│   │   ├── main.js                 # Electron entry — BrowserWindow, IPC, updater
│   │   ├── processManager.js       # Starts/stops sub-app servers in-process
│   │   ├── auth.js                 # Azure AD MSAL authentication
│   │   ├── preload.js              # Context-bridge (shell → renderer)
│   │   └── appPreload.js           # Context-bridge (sub-app WebViews)
│   ├── src/                        # React launcher UI (Vite + Tailwind-free)
│   │   ├── App.jsx                 # Root component — auth, status, layout
│   │   ├── components/
│   │   │   ├── AppCard.jsx         # Per-app card with status + open button
│   │   │   ├── AppGrid.jsx         # 4-column app grid
│   │   │   ├── NotificationCenter.jsx
│   │   │   ├── RecentActivity.jsx  # localStorage-backed activity log
│   │   │   ├── StatusBar.jsx       # Bottom status bar
│   │   │   ├── LogPanel.jsx        # Floating log viewer
│   │   │   └── UpdateBanner.jsx    # Auto-update notification strip
│   │   └── screens/
│   │       └── LoginScreen.jsx     # Azure AD sign-in screen
│   ├── electron-builder.yml        # Installer config + sub-app bundle paths
│   └── package.json
│
├── Assembilies library main/       # Assemblies Library (Express + React/Vite)
├── Build_Readiness_Report/         # Build Readiness (Express + React)
├── SDC_Scheduler/                  # SDC Scheduler (Express + vanilla JS)
├── state_logic_builder/            # State Logic Builder (Express + React/Vite)
├── SDC Centrailzed calender/       # SDC Calendar (Express + vanilla JS)
│
├── .github/workflows/
│   ├── release.yml                 # Auto-build + publish installer on version bump
│   └── ci.yml                      # PR checks
│
├── .env.example                    # Environment variable template
├── .gitignore
└── package.json                    # npm workspaces root
```

---

## Architecture Overview

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of how the shell loads sub-apps, the Azure SQL schema, the auto-update pipeline, and the authentication flow.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 35, electron-builder, electron-updater |
| Launcher UI | React 18, Vite 5 |
| Sub-app servers | Node.js 22, Express 4 |
| Sub-app frontends | React/Vite (Assemblies, State Logic, Build Readiness), Vanilla JS (Scheduler, Calendar) |
| Database | Azure SQL (shared instance, per-app schemas) via `mssql` |
| Authentication | Azure AD (MSAL Node) |
| External sync | Smartsheet API (Scheduler, Calendar) |
| CI/CD | GitHub Actions → GitHub Releases |

---

## Contributing

1. Branch off `master`
2. Make changes in the relevant sub-app directory
3. Test locally with `npm run dev` in `shell/`
4. Open a PR — CI runs automatically
5. Merge to `master` + bump version to trigger a release

---

*Stevens Douglas Corp. — Internal tooling. Not for public distribution.*
