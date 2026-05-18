# SDC Tools — Architecture

## Table of Contents
1. [High-Level Overview](#high-level-overview)
2. [Electron Shell](#electron-shell)
3. [In-Process Sub-App Loading](#in-process-sub-app-loading)
4. [Azure SQL — Shared Database](#azure-sql--shared-database)
5. [Authentication Flow](#authentication-flow)
6. [Auto-Update Pipeline](#auto-update-pipeline)
7. [IPC Contract (Electron ↔ Renderer)](#ipc-contract-electron--renderer)
8. [Sub-App Details](#sub-app-details)
9. [Release & CI/CD](#release--cicd)
10. [Directory Layout](#directory-layout)

---

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Shell                          │
│                                                             │
│  ┌──────────────────┐    ┌──────────────────────────────┐  │
│  │  BrowserWindow   │    │     processManager.js         │  │
│  │  (React UI)      │◄──►│  require() each sub-app      │  │
│  │  localhost:5173  │    │  startServer({ port })        │  │
│  │  (dev)           │    │                               │  │
│  └──────────────────┘    │  assemblies  :4001  running  │  │
│                           │  readiness   :4002  running  │  │
│  ┌──────────────────┐    │  scheduler   :4003  running  │  │
│  │  WebView / BrowserView  statelogic  :4004  running  │  │
│  │  Opens sub-apps  │    │  calendar    :4005  running  │  │
│  │  in new window   │    └──────────────────────────────┘  │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
  Azure AD (MSAL)             Azure SQL
  Authentication              Shared database
                              Per-app schemas
```

All five sub-apps run **inside the same Electron process** as in-process Node.js servers. There are no child processes. Each server exports a `startServer({ port })` function that the shell calls via `require()`.

---

## Electron Shell

### Entry Point — `shell/electron/main.js`

Responsibilities:
- Creates the `BrowserWindow` (launcher UI)
- Initialises `processManager` and starts all 5 sub-apps
- Handles Azure AD authentication via MSAL
- Registers IPC handlers (status, logs, open-app, restart, stop, update)
- Sets up `electron-updater` for auto-updates (checks every 30 min)

### Process Manager — `shell/electron/processManager.js`

```
ProcessManager
├── _servers: Map<id, { port, status, logs[] }>    in-process require() servers
├── _processes: Map<id, ChildProcess>               spawn fallback (native mismatch)
└── _spawnFallback: Set<id>                         apps permanently in spawn mode
```

**Start sequence:**
1. Try `require(appPath)` and call `startServer({ port })`
2. On native module mismatch (e.g. `NODE_MODULE_VERSION`) → add to `_spawnFallback` and retry via `child_process.spawn('node.exe', [appPath])`
3. Poll the app's `/health` endpoint every 2 s until it responds 200 (status → `running`)

**Why in-process instead of spawn?**
- No inter-process serialisation overhead
- Single Node.js heap → lower memory
- stdout/stderr captured synchronously → no pipe buffering glitches
- Sub-apps can be stopped by calling `server.close()` directly

---

## In-Process Sub-App Loading

Each sub-app exposes:

```js
// server.js (in each sub-app)
function startServer({ port }) {
  const server = app.listen(port, () => { ... })
  return server   // shell calls server.close() to stop
}
module.exports = { startServer }
```

The shell calls:
```js
const { startServer } = require(resolvedPath)
const srv = startServer({ port: cfg.port })
```

**Packaged app paths** (after `electron-builder`):
```
resources/
  app.asar.unpacked/        (asarUnpack: ["**"] in electron-builder.yml)
  apps/
    assemblies/             from: "../Assembilies library main"
    readiness/              from: "../Build_Readiness_Report"
    scheduler/              from: "../SDC_Scheduler"
    statelogic/             from: "../state_logic_builder"
    calendar/               from: "../SDC Centrailzed calender"
```

The shell uses `process.resourcesPath` to resolve paths in production, and `path.join(__dirname, '../../<app>')` in development.

---

## Azure SQL — Shared Database

All five apps share **one Azure SQL instance** using per-app schemas to isolate data:

```
free-sql-db-7038618 (Azure SQL Database)
├── [assemblies].[assemblies]       Assemblies Library
├── [scheduler].[tasks]             SDC Scheduler
├── [scheduler].[team_members]
├── [scheduler].[settings]
├── [scheduler].[project_financials]
├── [readiness].[...]               Build Readiness Report
├── [statelogic].[...]              State Logic Builder
└── [calendar].[events]             SDC Calendar
```

**Connection pattern** (every sub-app):
```js
// azureDb.js
const sql = require('mssql')

const pool = await sql.connect({
  server:   process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user:     process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options:  { encrypt: true, trustServerCertificate: false },
  pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 },
})
```

**Why Azure SQL over SQLite?**
- Multi-user: all engineers share one live dataset (no per-machine DB files)
- No native module: `mssql` is pure JS → no `NODE_MODULE_VERSION` mismatch in Electron
- Built-in backups, geo-redundancy, and monitoring via Azure Portal
- Works from any machine on the network without file-share access

---

## Authentication Flow

```
User opens SDC Tools
        │
        ▼
auth.js checks MSAL token cache
        │
   ┌────┴─────┐
   │ cached?  │
   └────┬─────┘
   yes  │  no
        │  ├─► Show LoginScreen (React)
        │  │   User clicks "Sign in with Microsoft"
        │  │   MSAL opens popup → Azure AD OAuth2
        │  │   Token stored in MSAL cache
        │  │
        ▼  ▼
   authUser = { name, email, token }
        │
        ▼
   processManager.start() — sub-apps launch
   Shell UI shows launcher dashboard
```

- **Library**: `@azure/msal-node` (MSAL for Node.js)
- **Flow**: Authorization Code + PKCE via a loopback redirect
- **Token storage**: MSAL in-memory cache (session only; no token persisted to disk)
- **Dev bypass**: if `AZURE_TENANT_ID` is not set, shell auto-authenticates as `Dev Mode`

---

## Auto-Update Pipeline

```
Developer bumps version in shell/package.json
        │
git push → master
        │
GitHub Actions (windows-latest runner)
        ├── check-version: compare HEAD vs HEAD~1
        │   └── should_release = true (version changed)
        │
        ├── Install deps (npm ci for sub-apps, npm install for shell)
        ├── Build frontends (Vite build)
        ├── electron-builder --win --publish always
        │   ├── Compiles NSIS installer
        │   ├── Uploads SDC-Tools-Setup-<version>.exe to GitHub Releases
        │   └── Uploads latest.yml (electron-updater feed)
        │
        └── Upload installer as 90-day workflow artifact
                │
                ▼
        Installed app polls for updates every 30 min
        electron-updater reads latest.yml from GitHub Releases
        If new version found → silently downloads in background
        Banner appears: "Click Restart & Install"
        User restarts → NSIS installs new version
```

**Key settings** (`shell/electron/main.js`):
```js
autoUpdater.autoDownload = true         // download silently in background
autoUpdater.autoInstallOnAppQuit = false // never install without user action
// Check interval: 30 minutes
```

**Triggering a release** — only a version bump on `master` starts the build:
```bash
# bump shell/package.json "version" then:
git commit -m "chore: release v1.X.Y"
git push
```

No manual tagging required. The `check-version` job diffs `shell/package.json` between the last two commits.

---

## IPC Contract (Electron ↔ Renderer)

The preload script exposes `window.shellAPI` to the React renderer:

| Method | Direction | Description |
|--------|-----------|-------------|
| `getStatus()` | renderer → main | Returns current status of all apps |
| `onStatusChange(cb)` | main → renderer | Push updates when any app status changes |
| `openApp(id)` | renderer → main | Opens the app in a new BrowserWindow |
| `retryApp(id)` | renderer → main | Retries a failed app |
| `stopAll()` | renderer → main | Stops all sub-app servers |
| `restartAll()` | renderer → main | Restarts all sub-app servers |
| `getLogs(id)` | renderer → main | Returns buffered log lines for an app |
| `onAppLog(cb)` | main → renderer | Push new log lines in real time |
| `getAppVersion()` | renderer → main | Returns current app version string |
| `onUpdateStatus(cb)` | main → renderer | Push auto-update phase changes |
| `updateDownload()` | renderer → main | Trigger manual download (legacy) |
| `updateInstall()` | renderer → main | Quit and install downloaded update |
| `getLaunchOnStartup()` | renderer → main | Returns Windows startup setting |
| `setLaunchOnStartup(v)` | renderer → main | Enables/disables Windows startup |
| `authGetStatus()` | renderer → main | Returns `{ isAuthenticated, user }` |
| `authLogin()` | renderer → main | Triggers MSAL interactive login |
| `authLogout()` | renderer → main | Clears MSAL token cache |
| `getNotifications()` | renderer → main | Returns notification list |
| `onNotificationsUpdated(cb)` | main → renderer | Push notification updates |

---

## Sub-App Details

### Assemblies Library (port 4001)
- **Backend**: Express + `mssql` → `[assemblies].[assemblies]`
- **Frontend**: React + Vite (built to `client/dist/`, served statically by Express)
- **Key feature**: Fuzzy search — broad SQL `LIKE` filter → JS scoring + pagination. No native module (fully migrated from SQLite to Azure SQL).
- **Sync**: File-system scanner syncs SolidWorks vault directory to Azure SQL on schedule

### Build Readiness Report (port 4002)
- **Backend**: Express + `mssql`
- **Frontend**: React served statically
- **Key feature**: ETO project readiness checklist — pulls from Smartsheet, displays sign-off status per project

### SDC Scheduler (port 4003)
- **Backend**: Express + SQLite (`node:sqlite` built-in) for local task data + `mssql` for Azure sync
- **Frontend**: Vanilla HTML/JS (no build step)
- **Key feature**: Full Gantt chart with predecessor scheduling (FS/SS/FF/SF + lag in business days), resource loading, two-way Smartsheet sync
- **Performance**: cascade scheduler uses batched transactions; all hot queries are indexed

### State Logic Builder (port 4004)
- **Backend**: Express + `mssql`
- **Frontend**: React + Vite (ReactFlow for canvas)
- **Key feature**: Visual PLC state-machine editor that exports Allen-Bradley ControlLogix L5X files ready for Studio 5000 import

### SDC Calendar (port 4005)
- **Backend**: Express + `mssql` → `[calendar]` schema; Azure AD for identity
- **Frontend**: Vanilla HTML/JS
- **Key feature**: Company-wide calendar with Smartsheet sync, scheduler task overlay, event notifications

---

## Release & CI/CD

### `.github/workflows/release.yml`
```
Trigger: push to master where shell/package.json version changed
Runner:  windows-latest

Steps:
  1. check-version (ubuntu)   — fast diff, sets should_release output
  2. build-and-release (win)  — only if should_release == true
     a. Checkout
     b. Setup Node 22
     c. npm ci --omit=dev  for each sub-app
     d. npm run build       for Vite frontends
     e. npm install         for shell
     f. npm run build       for shell Vite UI
     g. electron-builder --win --publish always
     h. Upload .exe as 90-day artifact
```

### `.github/workflows/ci.yml`
- Runs on every pull request
- Installs deps and runs any available tests

---

## Directory Layout

```
SDC-Tools/
│
├── .github/
│   └── workflows/
│       ├── release.yml             Auto-build installer on version bump
│       └── ci.yml                  PR checks
│
├── shell/                          Electron launcher
│   ├── build/
│   │   ├── icon.ico                App icon
│   │   └── icon.png
│   ├── electron/
│   │   ├── main.js                 Main process entry
│   │   ├── processManager.js       In-process sub-app lifecycle manager
│   │   ├── auth.js                 MSAL Azure AD authentication
│   │   ├── preload.js              Launcher renderer bridge
│   │   └── appPreload.js           Sub-app WebView bridge
│   ├── src/                        React launcher UI
│   ├── electron-builder.yml        Build + bundle config
│   ├── vite.config.js
│   └── package.json
│
├── Assembilies library main/       Assemblies Library
│   ├── client/                     React/Vite frontend
│   ├── server/
│   │   ├── azureDb.js              Azure SQL connection pool
│   │   ├── controllers/
│   │   ├── routes/
│   │   └── services/
│   │       ├── db.service.js       Azure SQL CRUD (replaces SQLite)
│   │       ├── scanner.service.js  Vault file-system scanner
│   │       └── sync.service.js     Scheduled sync orchestrator
│   └── package.json
│
├── Build_Readiness_Report/
│   ├── client/
│   ├── server/
│   └── package.json
│
├── SDC_Scheduler/
│   ├── public/                     Vanilla JS frontend
│   ├── server.js                   Express server + all API routes
│   ├── db.js                       SQLite schema + migrations
│   ├── azureDb.js                  Azure SQL pool (for sync routes)
│   └── package.json
│
├── state_logic_builder/
│   ├── src/                        React/Vite frontend
│   ├── server.js
│   ├── azureDb.js
│   └── package.json
│
├── SDC Centrailzed calender/
│   ├── frontend/                   Vanilla JS frontend
│   ├── server/
│   │   ├── server.js
│   │   ├── azureDb.js
│   │   ├── auth.js
│   │   └── routes/
│   └── package.json
│
├── .env.example                    Environment variable template
├── .gitignore
├── package.json                    npm workspaces root
├── package-lock.json
├── README.md
└── ARCHITECTURE.md                 ← this file
```
