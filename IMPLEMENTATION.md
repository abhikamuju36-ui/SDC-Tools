# SDC Unified Desktop Application — Implementation Plan

## Overview

Build a single Windows desktop application (Electron-based) that serves as a unified shell
hosting all 4 SDC tools. A central launcher lets the user select and open any app; each app
runs in its own window or view with its full backend intact.

---

## The 4 Apps

| # | Name | Purpose | Current Stack |
|---|------|---------|---------------|
| 1 | **Assemblies Library** | CAD assembly search & sync (SolidWorks) | React + Electron + Express + SQLite |
| 2 | **Build Readiness Report** | ETO project dashboard | Express + MSSQL + static frontend |
| 3 | **SDC Scheduler** | Gantt + task scheduling + Smartsheet sync | Express + SQLite/PG + session auth |
| 4 | **State Logic Builder** | Visual state machine → Allen-Bradley L5X PLC code | React + Electron + Zustand + Express |

---

## Architecture

### Pattern: Electron Shell + Managed Child Servers

```
┌───────────────────────────────────────────────────────┐
│                  SDC Unified Shell (Electron)         │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │          Launcher UI (React + Vite)             │  │
│  │                                                 │  │
│  │   [Assemblies]  [Build Report]  [Scheduler]    │  │
│  │                  [State Logic]                  │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Main Process manages child server processes:         │
│  ├── assemblies-server  → http://localhost:4001       │
│  ├── readiness-server   → http://localhost:4002       │
│  ├── scheduler-server   → http://localhost:4003       │
│  └── statelogic-server  → http://localhost:4004       │
│                                                       │
│  Each app opens in its own BrowserWindow              │
└───────────────────────────────────────────────────────┘
```

**Why this pattern:**
- Zero code changes inside the 4 apps — they keep running as-is.
- Apps with existing Electron shells (Assemblies, State Logic Builder) can optionally be
  loaded directly; their Express servers are started by the parent shell instead.
- Simple to add more apps in the future.
- Single installer bundles everything.

---

## Folder Structure (Monorepo)

```
c:\Projects\Centrailized library\
├── package.json                    ← root monorepo (npm workspaces)
├── IMPLEMENTATION.md               ← this file
│
├── shell/                          ← NEW: Electron shell app
│   ├── package.json
│   ├── electron/
│   │   ├── main.js                 ← Electron main process
│   │   ├── processManager.js       ← starts/stops child servers
│   │   └── preload.js
│   ├── src/
│   │   ├── App.jsx                 ← Launcher UI root
│   │   ├── components/
│   │   │   ├── AppCard.jsx         ← single app tile
│   │   │   ├── AppGrid.jsx         ← 2x2 grid layout
│   │   │   └── StatusBar.jsx       ← shows which servers are running
│   │   ├── assets/
│   │   │   ├── icon-assemblies.png
│   │   │   ├── icon-readiness.png
│   │   │   ├── icon-scheduler.png
│   │   │   └── icon-statelogic.png
│   │   ├── main.jsx
│   │   └── index.css
│   ├── vite.config.js
│   ├── electron-builder.yml
│   └── build/                      ← shell app icon, NSIS assets
│
├── Assembilies library main/       ← existing, unchanged
├── Build_Readiness_Report/         ← existing, unchanged
├── SDC_Scheduler/                  ← existing, unchanged
└── state_logic_builder/            ← existing, unchanged
```

---

## Shell App — Detailed Spec

### `shell/electron/main.js`

Responsibilities:
1. Create the launcher `BrowserWindow` (fixed size, no frame optional).
2. On `app.ready`, call `processManager.startAll()` to boot all 4 servers.
3. Listen for IPC messages from the renderer:
   - `open-app <appId>` → create or focus a `BrowserWindow` for that app.
   - `get-status` → return which servers are running and their URLs.
4. On `app.quit`, call `processManager.stopAll()`.

### `shell/electron/processManager.js`

```js
// Manages 4 child_process.spawn calls — one per app server
// Exposes: startAll(), stopAll(), getStatus()
// Maps app IDs to { port, cwd, command, process }
```

**Port & launch config:**

| App ID | cwd | Command | Port |
|--------|-----|---------|------|
| `assemblies` | `../Assembilies library main` | `node server/index.js` | 4001 |
| `readiness` | `../Build_Readiness_Report/server` | `node index.js` | 4002 |
| `scheduler` | `../SDC_Scheduler` | `node server.js` | 4003 |
| `statelogic` | `../state_logic_builder` | `node server.js` | 4004 |

Each server's `PORT` env var is overridden so all 4 can coexist without conflicts.

### `shell/electron/preload.js`

Exposes a safe IPC bridge:
```js
contextBridge.exposeInMainWorld('shellAPI', {
  openApp: (appId) => ipcRenderer.invoke('open-app', appId),
  getStatus: ()    => ipcRenderer.invoke('get-status'),
  onStatusChange: (cb) => ipcRenderer.on('status-change', (_, data) => cb(data)),
})
```

### `shell/src/App.jsx` — Launcher UI

```
┌─────────────────────────────────────────────────┐
│  SDC Tools                              [─][□][×]│
├─────────────────────────────────────────────────┤
│                                                 │
│   ┌──────────────┐   ┌──────────────┐           │
│   │  Assemblies  │   │    Build     │           │
│   │   Library    │   │  Readiness   │           │
│   │  [● ready]   │   │  [● ready]   │           │
│   │   [OPEN]     │   │   [OPEN]     │           │
│   └──────────────┘   └──────────────┘           │
│                                                 │
│   ┌──────────────┐   ┌──────────────┐           │
│   │    SDC       │   │    State     │           │
│   │  Scheduler   │   │   Logic      │           │
│   │  [● ready]   │   │   Builder    │           │
│   │   [OPEN]     │   │  [● ready]   │           │
│   └──────────────┘   └──────────────┘           │
│                                                 │
│  Status: All 4 services running                 │
└─────────────────────────────────────────────────┘
```

- Green dot = server running, Red = starting/error.
- Clicking OPEN creates a new `BrowserWindow` sized appropriately per app.
- Each app window is independent; closing it does not stop its server.

---

## Implementation Phases

### Phase 1 — Monorepo Setup (1 day)

- [ ] Create root `package.json` with `workspaces: ["shell", "Assembilies library main", ...]`
- [ ] Verify all 4 existing apps still build independently (`npm install` in each)
- [ ] Confirm all 4 servers can run on different ports simultaneously
- [ ] Document any `.env` changes needed per app

### Phase 2 — Process Manager (1 day)

- [ ] Create `shell/electron/processManager.js`
- [ ] Test starting/stopping all 4 servers from a Node.js script (no Electron yet)
- [ ] Handle stdout/stderr piping so logs appear in shell's DevTools console
- [ ] Handle port-conflict detection (retry with +1 if port taken)
- [ ] Handle graceful shutdown (SIGTERM → wait 3s → SIGKILL)

### Phase 3 — Electron Shell Scaffold (1–2 days)

- [ ] Init Vite + React project in `shell/`
- [ ] Create `electron/main.js` with launcher window + IPC handlers
- [ ] Wire `processManager` into Electron lifecycle
- [ ] Create `preload.js` with `shellAPI`
- [ ] Smoke test: shell boots, 4 servers start, shell opens Assemblies in a new window

### Phase 4 — Launcher UI (2 days)

- [ ] `AppCard.jsx` — icon, name, description, status dot, OPEN button
- [ ] `AppGrid.jsx` — 2×2 grid, responsive
- [ ] `StatusBar.jsx` — bottom bar showing all server states
- [ ] Design: dark SDC theme matching existing apps
- [ ] Animated status dot (pulsing yellow while starting, solid green when ready)
- [ ] Show error state + "Retry" button if a server fails to start

### Phase 5 — Per-App Window Config (1 day)

Define preferred window sizes and behaviors per app:

| App | Width | Height | Resizable | Notes |
|-----|-------|--------|-----------|-------|
| Assemblies Library | 1280 | 800 | Yes | Full Electron app |
| Build Readiness Report | 1400 | 900 | Yes | Data-heavy dashboard |
| SDC Scheduler | 1400 | 900 | Yes | Gantt needs width |
| State Logic Builder | 1440 | 900 | Yes | Canvas editor |

- [ ] Per-app `BrowserWindow` config in `main.js`
- [ ] Remember last window position/size per app (using `electron-store`)
- [ ] Each app window shows its own taskbar entry

### Phase 6 — Packaging & Installer (1–2 days)

- [ ] Configure `electron-builder.yml` to include all 4 apps in the ASAR bundle
- [ ] NSIS installer with SDC branding
- [ ] Auto-updater using `electron-updater` (reuse pattern from Assemblies/State Logic)
- [ ] Single `.exe` installer ~< 300MB
- [ ] Sign the installer (if code-signing cert is available)

---

## Root `package.json` (Monorepo)

```json
{
  "name": "sdc-tools",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "shell",
    "Assembilies library main",
    "Build_Readiness_Report",
    "SDC_Scheduler",
    "state_logic_builder"
  ],
  "scripts": {
    "dev":        "npm run dev --workspace=shell",
    "build":      "npm run build:all && npm run electron:build --workspace=shell",
    "build:all":  "npm run build --workspace=\"Assembilies library main\" && npm run build --workspace=state_logic_builder",
    "install:all":"npm install --workspaces"
  }
}
```

---

## `electron-builder.yml` (shell)

```yaml
appId: com.sdc.tools
productName: SDC Tools
directories:
  buildResources: build
  output: dist
files:
  - from: .
    filter:
      - "**/*"
      - "!node_modules"
  # Include all 4 apps (their built dist/ and server files)
  - from: "../Assembilies library main"
    to: apps/assemblies
    filter: ["server/**", "client/dist/**", "package.json"]
  - from: "../Build_Readiness_Report"
    to: apps/readiness
    filter: ["server/**", "client/**", "package.json"]
  - from: "../SDC_Scheduler"
    to: apps/scheduler
    filter: ["**/*", "!node_modules", "!tests", "!__tests__"]
  - from: "../state_logic_builder"
    to: apps/statelogic
    filter: ["dist/**", "server.js", "package.json"]
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: build/icon.ico
  installerHeaderIcon: build/icon.ico
```

---

## Environment Variables

Each app server needs `PORT` overridden. The process manager sets these before spawning:

```js
const APP_CONFIG = {
  assemblies: { port: 4001, cwd: 'apps/assemblies', cmd: 'node', args: ['server/index.js'] },
  readiness:  { port: 4002, cwd: 'apps/readiness',  cmd: 'node', args: ['server/index.js'] },
  scheduler:  { port: 4003, cwd: 'apps/scheduler',  cmd: 'node', args: ['server.js'] },
  statelogic: { port: 4004, cwd: 'apps/statelogic', cmd: 'node', args: ['server.js'] },
}
```

**Required `.env` changes in existing apps:**
- Assemblies Library: already reads `PORT` from env — no change needed.
- Build Readiness Report: hardcoded port 3000 — add `process.env.PORT || 3000` to `server/index.js`.
- SDC Scheduler: hardcoded port 3001 — add `process.env.PORT || 3001` to `server.js`.
- State Logic Builder: check `server.js` — apply same pattern.

---

## Key Technical Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| MSSQL driver (Build Readiness) needs SQL Server reachable | Shell shows "connecting..." state; app opens even if DB is unavailable |
| Scheduler uses `node:sqlite` (requires Node v22.5+) | Bundle Node 22 runtime with Electron, or use Electron's Node version |
| Assemblies Library reads from N: drive (network share) | Keep working directory resolution relative; shell sets `ASSEMBLY_ROOT` env var |
| Electron ASAR bundles clash if apps share `node_modules` | Bundle each app's deps separately in `apps/<name>/node_modules` |
| State Logic Builder auto-updater conflicts with shell updater | Disable per-app auto-updater; shell handles all updates |
| Port conflicts on first launch | Process manager does `net.createServer` probe before spawning |

---

## Optional Enhancements (Post-MVP)

- **Unified navigation bar** injected into each app window (via `BrowserWindow.webContents.executeJavaScript`) showing a "Home" button to return to the launcher.
- **Activity log** in the launcher showing recent actions across all apps.
- **Single sign-on** — pass a shared user identity from shell into apps via environment variables.
- **Global search** — cross-app search bar in the launcher.
- **Notification center** — aggregate toasts from all running apps into one system tray area.

---

## Estimated Timeline

| Phase | Work | Days |
|-------|------|------|
| 1 | Monorepo setup | 1 |
| 2 | Process manager | 1 |
| 3 | Electron shell scaffold | 2 |
| 4 | Launcher UI | 2 |
| 5 | Per-app window config | 1 |
| 6 | Packaging & installer | 2 |
| **Total** | | **~9 days** |

---

## Getting Started (First Steps)

```powershell
# 1. Create the monorepo root package.json
cd "c:\Projects\Centrailized library"
# (create package.json as shown above)

# 2. Create the shell scaffold
mkdir shell
cd shell
npm create vite@latest . -- --template react
npm install electron electron-builder electron-store concurrently --save-dev

# 3. Verify all 4 servers run on different ports
cd "..\Assembilies library main" && $env:PORT=4001; node server/index.js
cd "..\Build_Readiness_Report\server" && $env:PORT=4002; node index.js
cd "..\SDC_Scheduler"               && $env:PORT=4003; node server.js
cd "..\state_logic_builder"         && $env:PORT=4004; node server.js
```
