# SDC Unified App — Architecture

> Living document. Update when structure changes significantly.

---

## Overview

A monorepo containing an Electron **shell launcher** that hosts four independent web apps as child Node.js processes. The launcher opens each app in its own `BrowserWindow`, manages server lifecycle, and provides a unified UI.

```
C:\Projects\Centrailized library\
├── shell/                        ← Electron launcher (entry point)
├── Assembilies library main/     ← App 1: CAD assembly search
├── Build_Readiness_Report/       ← App 2: ETO project dashboard
├── SDC_Scheduler/                ← App 3: Gantt + Smartsheet sync
├── state_logic_builder/          ← App 4: PLC state machine → L5X
├── ARCHITECTURE.md               ← This file
├── IMPROVEMENTS.md               ← Audit of all issues + priorities
├── IMPLEMENTATION.md             ← Phase-by-phase build plan
├── SHARED_DATABASE_ARCHITECTURE.md ← Recommended data model
└── package.json                  ← Root monorepo (npm workspaces)
```

---

## Shell / Launcher

**Location:** `shell/`  
**Entry:** `electron/main.js` → Electron main process  
**UI:** React 18 + Vite (`src/`) served at `localhost:5173` in dev, `dist/index.html` in prod

### Process Model

```
Electron Main Process (main.js)
  ├── ProcessManager (processManager.js)  — spawns/stops child servers
  │     ├── node server/index.js  → Assemblies Library  :4001
  │     ├── node server/index.js  → Build Readiness     :4002
  │     ├── node server.js        → SDC Scheduler       :4003
  │     └── node server.js        → State Logic Builder :4004
  └── BrowserWindows
        ├── Launcher UI           → localhost:5173 (dev) / dist/ (prod)
        └── Per-app windows       → localhost:400x
```

### IPC API (preload.js → shellAPI)

| Method | Direction | Description |
|--------|-----------|-------------|
| `getStatus()` | renderer → main | Get status of all 4 servers |
| `getLogs(appId)` | renderer → main | Get last 100 log lines for an app |
| `openApp(appId)` | renderer → main | Open or focus the app BrowserWindow |
| `retryApp(appId)` | renderer → main | Restart a failed server |
| `stopAll()` | renderer → main | Stop all 4 servers |
| `restartAll()` | renderer → main | Stop then restart all servers |
| `stopApp(appId)` | renderer → main | Stop one server |
| `restartApp(appId)` | renderer → main | Restart one server |
| `onStatusChange(cb)` | main → renderer | Push server status updates |
| `onAppLog(cb)` | main → renderer | Stream real-time log lines |

### Server Status States

```
stopped → starting → running
                   ↘ error → (retry with exponential backoff, max 3 attempts)
```

### Key Files

| File | Purpose |
|------|---------|
| `electron/main.js` | BrowserWindow creation, IPC handlers, system tray, graceful quit |
| `electron/preload.js` | Context bridge — exposes `window.shellAPI` to renderer |
| `electron/processManager.js` | Spawn/stop child servers, log buffering, auto-retry on crash |
| `src/App.jsx` | Root launcher UI — skeleton cards, Stop All / Restart All |
| `src/components/AppCard.jsx` | Single app tile with keyboard navigation, log button |
| `src/components/LogPanel.jsx` | Per-app collapsible log viewer (last 100 lines) |
| `src/components/StatusBar.jsx` | Footer showing all server states |

---

## App 1 — Assemblies Library

**Location:** `Assembilies library main/`  
**Stack:** Express.js + React (Vite) + SQLite  
**Port:** 4001 (shell-managed)

### Data Flow

```
SolidWorks files (N: drive)
  ↓ scanner.service.js (COM automation)
SQLite DB (N:\assemblies.db)
  ↓ db.service.js
Express API (server/index.js)
  ↓ HTTP
React Client (client/src/)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/index.js` | Express setup, security, rate limiting, error handler |
| `server/routes/assemblies.js` | GET /api/assemblies (filtering, pagination) |
| `server/routes/sync.js` | POST /api/sync (trigger CAD file scan) |
| `server/services/db.service.js` | SQLite queries + backup |
| `server/services/scanner.service.js` | SolidWorks COM → metadata extraction |
| `server/config/paths.js` | All path constants (N: drive, thumb cache, etc.) |

### Known Constraints

- Requires N: network drive to be online; degrades gracefully with warnings if offline
- SQLite on a shared network drive has no concurrent write protection — single-writer assumption
- Thumbnails extracted via SolidWorks COM; fails silently on machines without SolidWorks
- Rate limiting keys on `req.path`, not IP — trivially bypassable (tracked in IMPROVEMENTS.md)

---

## App 2 — Build Readiness Report

**Location:** `Build_Readiness_Report/`  
**Stack:** Express.js + Vanilla HTML/CSS/JS + MSSQL (read-only)  
**Port:** 4002 (shell-managed)

### Data Flow

```
ETO MSSQL (read-only)
  ↓ services/eto.js   (mssql driver)
  ↓ services/demoData.js (fallback when ETO unreachable)
Express API (server/index.js)
  ↓ HTTP
Vanilla JS Client (client/)
```

### Key Files

| File | Purpose |
|------|---------|
| `server/index.js` | Express setup, security headers, global error handler |
| `server/routes/readiness.js` | GET /api/readiness/:projectId — full report per project |
| `server/routes/bom.js` | GET /api/bom/:projectId/:specId — BOM tree and flat list |
| `server/routes/emails.js` | Email report generation (no frontend UI yet) |
| `server/services/eto.js` | MSSQL queries against ETO database |
| `server/services/demoData.js` | JSON-file fallback for offline/demo mode |
| `server/lib/bomTree.js` | BOM tree building, readiness summary, PO action list |

### Known Constraints

- No authentication — any LAN user can read all project cost data (tracked in IMPROVEMENTS.md §2)
- Frontend is vanilla HTML/JS — no hot reload, no component reuse
- MSSQL hit on every request (no cache layer)

---

## App 3 — SDC Scheduler

**Location:** `SDC_Scheduler/`  
**Stack:** Express.js + SQLite (dev) / PostgreSQL (prod) + Vanilla JS frontend  
**Port:** 4003 (shell-managed)  
**Requires:** Node.js ≥ 22.5 (uses built-in `node:sqlite`)

### Data Flow

```
Smartsheet API
  ↓ smartsheetService.js
SQLite / PostgreSQL (db.js)
  ↓ Express API (server.js)
  ↓ HTTP + session auth
Vanilla JS frontend (public/)
```

### Authentication

Session-based (express-session + bcrypt). Roles: `admin`, `manager`, `editor`, `viewer`.

```
POST /api/login   → verify bcrypt → set req.session.user
All /api/*        → requireAuth middleware
Admin routes      → requireRole(['admin'])
```

### Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express app, all routes, session config, cron digest |
| `db.js` | Universal DB layer (SQLite ↔ PostgreSQL abstraction) |
| `smartsheetService.js` | Smartsheet API client — find sheet, import tasks |
| `utils/businessDays.js` | Business-day arithmetic for predecessor scheduling |
| `utils/excelExport.js` | Excel export via exceljs |
| `scripts/email-digest.js` | Daily email digest (node-cron, nodemailer) |

### Known Constraints

- `SESSION_SECRET` must be set via env var — server now refuses to start in production without it
- `node:sqlite` requires Node ≥ 22.5
- SQLite can cause write contention under concurrent users (WAL mode enabled)
- No password reset flow for locked-out users

---

## App 4 — State Logic Builder

**Location:** `state_logic_builder/`  
**Stack:** Node.js built-in HTTP server + React 18 + Vite + Zustand  
**Port:** 4004 (shell-managed)  
**Detailed docs:** `state_logic_builder/CLAUDE.md`, `docs/architecture.md`

### Data Flow

```
React Canvas (React Flow + Zustand)
  ↓ localStorage (in-browser, session state)
  ↓ /api/projects/:filename (server.js)
JSON files (projects/ dir on disk or network share)
  → L5X export (lib/l5xExporter.js)
```

### Key Files

| File | Purpose |
|------|---------|
| `server.js` | Pure Node.js HTTP server — project CRUD, standards library, static serve |
| `src/store/useDiagramStore.js` | Zustand store — all diagram state + undo/redo |
| `src/components/Canvas.jsx` | React Flow canvas, state number computation |
| `src/components/edges/RoutableEdge.jsx` | Custom orthogonal draggable edge |
| `src/lib/l5xExporter.js` | Diagram → Allen-Bradley L5X XML |
| `src/lib/edgeRouting.js` | Auto-route, manual-route, node clearance enforcement |
| `electron/main.js` | Standalone Electron wrapper (optional; not used in shell mode) |

### Known Constraints

- No authentication — any user can overwrite any project file
- CORS restricted to localhost (was wildcard `*`)
- Project data saved to disk as JSON; localStorage used only for UI state
- Requires `npm run build` before the server can serve the frontend
- Electron auto-updater in this app conflicts with the shell — do not run both

---

## Ports Reference

| App | Dev Port | Shell Port |
|-----|----------|------------|
| Assemblies Library | (varies) | 4001 |
| Build Readiness | 3000 | 4002 |
| SDC Scheduler | 3001 | 4003 |
| State Logic Builder | 3131 | 4004 |
| Shell Vite dev server | 5173 | — |

---

## Security Posture

| Layer | Status | Notes |
|-------|--------|-------|
| Assemblies: IP allowlist | ✅ | LAN + localhost only |
| Assemblies: Rate limiting | ✅ | Per-path, not per-IP |
| Assemblies: Error handler | ✅ | Returns `"Internal server error"` to client |
| Scheduler: Session auth | ✅ | bcrypt + express-session |
| Scheduler: Login rate limit | ✅ | 5 per 15 min per IP (in-memory) |
| Scheduler: SESSION_SECRET guard | ✅ | Refuses start if missing in production |
| All apps: Security headers | ✅ | X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| All apps: Global error handler | ✅ | JSON response, no stack traces to client |
| All apps: unhandledRejection | ✅ | Logged, process stays alive |
| Build Readiness: Auth | ❌ | No auth — any LAN user can read data |
| State Logic Builder: Auth | ❌ | No auth — any user can overwrite projects |
| CORS | ⚠️ | Assemblies: configured; State Logic: localhost-only; others: N/A (same-origin) |

---

## Dependency Map

```
shell/
  ├── electron ^33
  ├── react ^18 + vite ^5
  └── electron-builder ^25

Assembilies library main/
  ├── express ^4
  ├── better-sqlite3 (or sqlite3)
  ├── cors
  └── dotenv

Build_Readiness_Report/
  ├── express ^4
  ├── mssql ^11
  └── dotenv

SDC_Scheduler/
  ├── express ^4
  ├── node:sqlite (built-in, Node ≥ 22.5)
  ├── pg ^8 (PostgreSQL, prod)
  ├── bcrypt ^6
  ├── express-session ^1
  ├── connect-sqlite3
  ├── node-cron ^4
  ├── nodemailer ^8
  └── exceljs ^4

state_logic_builder/
  ├── (no server deps — pure Node built-ins)
  └── client: react ^18, @xyflow/react, zustand, vite
```

---

## Monorepo Setup

Root `package.json` uses npm workspaces. Currently only `shell` is listed.
To add all apps as managed workspaces, update the root `package.json`:

```json
{
  "workspaces": [
    "shell",
    "Assembilies library main",
    "Build_Readiness_Report",
    "SDC_Scheduler",
    "state_logic_builder"
  ]
}
```

---

## Development Workflow

```
# Start everything in dev mode:
cd shell
npm run dev          # starts Vite (5173) + Electron; Electron spawns all 4 servers

# Individual app dev:
cd SDC_Scheduler && npm run dev
cd Build_Readiness_Report && npm run dev
cd "Assembilies library main" && npm run dev
cd state_logic_builder && npm run dev   # then npm run build for the UI

# Production build:
cd shell && npm run electron:build      # outputs installer to shell/dist/
```

---

## Outstanding Critical Issues

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the full audit. Top 🔴 items:

1. **No auth on Build Readiness or State Logic Builder** — any LAN user has full access
2. **No unified SSO** — Scheduler has its own auth; others have none
3. **No automated backup verification** — backups written but never tested
4. **Assemblies Library offline mode** — app completely fails if N: drive unavailable
5. **SQLite write contention** — shared SQLite file on network drive has no write protection

---

*Last updated: 2026-05-14*
