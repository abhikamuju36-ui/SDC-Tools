# SDC Unified App — Improvement Areas

> Comprehensive audit across all layers: shell launcher, four apps, shared infrastructure,
> security, performance, UX, and developer experience.
> Items marked 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low

---

## Table of Contents

1. [Shell / Launcher App](#1-shell--launcher-app)
2. [Security (All Apps)](#2-security-all-apps)
3. [Error Handling & Reliability](#3-error-handling--reliability)
4. [Performance & Scalability](#4-performance--scalability)
5. [Frontend & UX](#5-frontend--ux)
6. [Per-App Specific Issues](#6-per-app-specific-issues)
7. [Data & Persistence](#7-data--persistence)
8. [Testing](#8-testing)
9. [Infrastructure & DevOps](#9-infrastructure--devops)
10. [Developer Experience & Code Quality](#10-developer-experience--code-quality)
11. [Integration & Interoperability](#11-integration--interoperability)
12. [Accessibility](#12-accessibility)
13. [Feature Gaps](#13-feature-gaps)

---

## 1. Shell / Launcher App

### Process Management

| Priority | Issue | Fix |
|----------|-------|-----|
| 🔴 | Port-occupied → assumed "running" without verifying the process is the right server | Probe `GET /` and check response instead of just a TCP connect |
| 🟠 | `spawn()` with `shell: false` on Windows: `node` may not be on PATH in packaged builds | Use `process.execPath` to locate Node, or embed a runtime |
| 🟠 | If a server crashes and auto-restarts the port, it stays "error" forever — no auto-retry | Add exponential-backoff restart logic (max 3 attempts) |
| 🟡 | `stopAll()` is fire-and-forget — `before-quit` does not await it | Use `app.on('before-quit', e => { e.preventDefault(); stopAll().then(() => app.quit()) })` |
| 🟡 | Server stdout/stderr goes only to main process console, invisible to users | Expose a "Logs" view per app in the launcher with last N lines |
| 🟡 | Hardcoded ports 4001–4004 can conflict with other running software | Auto-detect free ports and pass them to app servers |

### Window Management

| Priority | Issue | Fix |
|----------|-------|-----|
| 🟠 | App window positions/sizes are not remembered across sessions | Use `electron-store` to persist bounds per `appId` |
| 🟠 | Closing the launcher destroys all app windows with no warning | Ask user to confirm if any app windows are open |
| 🟡 | `sandbox: false` set in launcher BrowserWindow security options | Change to `sandbox: true`; only loosen if a specific feature requires it |
| 🟡 | App windows have no menu bar suppressed, may show Electron default File/Edit menus | Call `win.setMenuBarVisibility(false)` or use `autoHideMenuBar: true` |
| 🟡 | No system tray icon — launcher disappears when minimized | Add tray icon so launcher stays accessible without taking taskbar space |
| 🟢 | No app-specific loading splash inside app windows — blank white before page loads | Set `backgroundColor` matching each app's theme on BrowserWindow |

### Launcher UI/UX

| Priority | Issue | Fix |
|----------|-------|-----|
| 🟠 | No "Restart All" or "Stop All" action | Add control buttons in the header |
| 🟡 | Status shows only after first IPC reply — if Electron is slow to start servers, UI is blank for 1–2 s | Show skeleton cards immediately on render |
| 🟡 | No keyboard navigation — cannot Tab between cards or press Enter to open | Add `tabIndex`, `onKeyDown` Enter/Space handlers |
| 🟡 | No per-app server log viewer — errors are invisible to users | Add a collapsible log panel per card showing last 20 lines |
| 🟡 | App cards have no version number visible | Display version from each app's `package.json` |
| 🟢 | No drag-to-reorder or pin/favourite support | Allow user to customize card order |
| 🟢 | No "last opened" timestamp per app | Track and display last-used time per app |

---

## 2. Security (All Apps)

### Authentication

| Priority | Issue | Location |
|----------|-------|----------|
| 🔴 | **No authentication** on Build Readiness Report — anyone on the network can read project data | `Build_Readiness_Report/server/index.js` |
| 🔴 | **No authentication** on State Logic Builder API — projects and PLC code readable/writable by any local user | `state_logic_builder/server.js` |
| 🔴 | SDC Scheduler: `SESSION_SECRET` falls back to hardcoded `"sdc_secret_key"` in production — sessions are forgeable | `SDC_Scheduler/server.js:27` |
| 🟠 | SDC Scheduler: `NODE_ENV=test` disables all auth middleware — a misconfig exposes the entire API | `SDC_Scheduler/server.js:44` |
| 🟠 | No shared/unified login across the 4 apps — each has separate or no auth | Implement SSO or a shared token (see §11) |

### CORS & Network Exposure

| Priority | Issue | Location |
|----------|-------|----------|
| 🔴 | State Logic Builder: `Access-Control-Allow-Origin: *` — any webpage can call the API | `state_logic_builder/server.js:50` |
| 🟠 | Assemblies Library rate-limiting keys only on `req.path`, not IP — trivially bypassed | `Assembilies library main/server/index.js:45` |
| 🟠 | No `helmet` middleware on any app — missing `X-Content-Type-Options`, `X-Frame-Options`, `HSTS` | Add `helmet()` as first middleware in all Express apps |
| 🟡 | No rate limiting at all on Build Readiness Report or State Logic Builder | Add `express-rate-limit` per app |
| 🟡 | SDC Scheduler: no rate limiting on `POST /api/login` — brute-force passwords are possible | Add per-IP rate limit: 5 attempts per 15 min |

### Input Validation

| Priority | Issue | Location |
|----------|-------|----------|
| 🟠 | Build Readiness: `parseInt(req.params.projectId)` with no `isNaN` check — `NaN` reaches SQL queries | `routes/readiness.js:13`, `routes/bom.js:12, 28` |
| 🟠 | State Logic Builder: filename regex allows spaces (`/^[a-zA-Z0-9_\- .]+\.json$/`) — can break path joins | `state_logic_builder/server.js:55` |
| 🟡 | Assemblies Library passes raw error messages to the client for 5xx errors | Only pass `"Internal server error"` to client; log details server-side |
| 🟡 | SDC Scheduler has no schema validation library (`zod`/`joi`) — all body parsing is manual | Add `zod` validation on all POST/PUT endpoints |

---

## 3. Error Handling & Reliability

### Missing Global Error Handlers

All 4 Express apps lack a **global JSON error handler** (`app.use((err, req, res, next) => ...)`).
When an unhandled exception occurs inside a route, Express returns an HTML error page instead of JSON,
breaking every API client silently.

```js
// Add to every app's server entry (after all routes)
app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' })
})
```

| Priority | Issue | Location |
|----------|-------|----------|
| 🔴 | No global Express error handler in any app | All `server/index.js` files |
| 🟠 | Assemblies Library route handlers have no `try/catch` wrappers | `routes/assemblies.js` — only `getAll` has error handling |
| 🟠 | Build Readiness: `Promise.all()` used for independent DB calls — one failure kills the entire response | `routes/readiness.js:16` — use `Promise.allSettled()` |
| 🟠 | SDC Scheduler: SQLite session store (`sessions.db`) corruption causes server crash with no recovery | Wrap session store init in try/catch; fallback to memory store |
| 🟡 | Shell: IPC handlers (`ipcMain.handle`) have no try/catch — unhandled errors silently drop IPC calls | Wrap each `ipcMain.handle` callback |
| 🟡 | State Logic Builder: `readBody()` has no request timeout — slow/infinite client body hangs the thread | Add `req.setTimeout(5000)` |
| 🟡 | Assemblies Library: backup failure is caught and logged but never alerts the user | Surface backup status in the app UI |
| 🟢 | Unhandled Promise rejections in Node.js processes crash silently | Add `process.on('unhandledRejection', ...)` in all server entry points |

---

## 4. Performance & Scalability

### Database & Queries

| Priority | Issue | Location |
|----------|-------|----------|
| 🔴 | **N+1 query pattern**: Build Readiness loops specs and fetches `getTopNode()` + `getBomRows()` per spec individually | `routes/readiness.js:35–61` — batch-fetch all in two queries |
| 🟠 | Build Readiness Report hits MSSQL on every request with no caching layer | Add in-memory cache (LRU or `node-cache`) with 30 s TTL |
| 🟠 | Assemblies Library database is on a network drive (N:) — every query has network latency | Add a read-through local SQLite cache; sync from N: in the background |
| 🟡 | SDC Scheduler has no database connection pooling for PostgreSQL production mode | Configure `pg` pool with `max: 10` |
| 🟡 | No database query timeout set on any app — a slow query blocks the event loop | Set `commandTimeout` (MSSQL) / `statement_timeout` (PG) per request |
| 🟢 | No database indexes documented or enforced in SDC Scheduler migrations | Add `EXPLAIN ANALYZE` review and index audit |

### Frontend Rendering

| Priority | Issue | Location |
|----------|-------|----------|
| 🟠 | Assemblies Library: 13 separate `useState` calls for filters cause cascading re-renders | Consolidate into one `useReducer` or `useState({})` filter object |
| 🟡 | No virtual scrolling on large assembly lists — rendering 500+ rows freezes the browser | Use `@tanstack/react-virtual` or `react-window` |
| 🟡 | No `useMemo`/`useCallback` on heavy filter/sort operations in Assemblies Library | Memoize filtered results |
| 🟢 | Build Readiness Report client is plain HTML/JS — no bundle splitting or lazy loading | Migrate to Vite + React for code splitting and HMR |

---

## 5. Frontend & UX

### Design Consistency

| Priority | Issue |
|----------|-------|
| 🟠 | Each app has its own design language — no shared color palette, typography, or component library |
| 🟡 | Build Readiness Report uses plain HTML/CSS while other apps use React — jarring user experience |
| 🟡 | No unified loading spinner, toast/notification, or modal pattern across apps |
| 🟢 | Dark/light mode not available in the launcher or any app |

### Shell UX Gaps

| Priority | Issue |
|----------|-------|
| 🟡 | No deep-link support — cannot bookmark/link directly to a specific app screen |
| 🟡 | No "Home" button injected into app windows to return to launcher |
| 🟡 | When an app server is "starting", the Open button is disabled with no ETA — add progress indicator |
| 🟡 | No notification when an app finishes loading and is ready to open |
| 🟢 | No search bar in launcher for quick app switching |
| 🟢 | No app usage statistics (most used, last opened) |

### Responsiveness

| Priority | Issue |
|----------|-------|
| 🟠 | SDC Scheduler and Build Readiness Report are not tested on smaller screens (laptops 1366×768) |
| 🟡 | Launcher grid becomes cramped below 900 px width |
| 🟢 | No mobile/tablet support (lower priority given desktop-only deployment) |

---

## 6. Per-App Specific Issues

### Assemblies Library

| Priority | Issue |
|----------|-------|
| 🔴 | App is entirely non-functional if N: network drive is unavailable — no offline mode |
| 🟠 | Thumbnail extraction depends on SolidWorks COM automation — fails silently on machines without SolidWorks |
| 🟠 | Database is a single SQLite file on a shared network drive — no concurrent write protection; two users saving simultaneously can corrupt data |
| 🟠 | No pagination — all assemblies are loaded in a single API call regardless of dataset size |
| 🟡 | Sync service has no conflict resolution strategy when local and remote records diverge |
| 🟡 | Thumbnail cache is never pruned — grows indefinitely |
| 🟡 | Hardcoded IP ranges for access control don't cover VPN/remote access scenarios |
| 🟢 | Search only covers the `description` field — cannot search by job number, part number, or category in one query |

### Build Readiness Report

| Priority | Issue |
|----------|-------|
| 🔴 | No authentication — any machine on the network can access confidential project cost and readiness data |
| 🟠 | Frontend is vanilla HTML/CSS/JS — no component reuse, difficult to maintain |
| 🟠 | No real-time updates — users must manually refresh to see latest data |
| 🟠 | MSSQL connection string is in `.env` — if `.env` is missing on deployment, server crashes with no clear error |
| 🟡 | No export to PDF or Excel — users print the browser page manually |
| 🟡 | No date range filtering — always shows current state |
| 🟡 | `emails.js` route exists but no frontend UI to trigger or schedule email reports |
| 🟢 | No charting/visualization beyond tabular data |

### SDC Scheduler

| Priority | Issue |
|----------|-------|
| 🔴 | `SESSION_SECRET` defaults to `"sdc_secret_key"` — any deployment without the env var is insecure |
| 🔴 | SQLite `db.js` parameter substitution logic (`?` → `$n`) appears broken at line 49 — the first replace is immediately overwritten | 
| 🟠 | Node.js v22.5+ required for `node:sqlite` — this will break on machines without the exact Node version |
| 🟠 | No password reset flow — users locked out must contact an admin to recreate their account |
| 🟠 | SQLite in production with concurrent users can cause write contention and `SQLITE_BUSY` errors |
| 🟡 | Smartsheet sync direction is unclear — if bidirectional, conflict resolution is undefined |
| 🟡 | `node-cron` email digest job has no dead-letter queue — if email fails, the send is silently dropped |
| 🟡 | Session max age (30 days) hardcoded — should be configurable and reset on activity |
| 🟢 | No drag-and-drop reordering of tasks in the Gantt view |
| 🟢 | No timezone handling — business day calculations assume server timezone |

### State Logic Builder

| Priority | Issue |
|----------|-------|
| 🔴 | No authentication on server — any user can overwrite another user's PLC projects |
| 🟠 | Project data stored in `localStorage` — 5–10 MB limit; large diagrams will silently fail to save |
| 🟠 | Auto-updater is embedded in the State Logic Builder's own Electron — conflicts with unified shell updater |
| 🟠 | Server serves `dist/` static files — if `npm run build` hasn't been run, the app opens a blank page with no error |
| 🟡 | Undo/redo history is session-only — browser refresh loses all history |
| 🟡 | No diagram versioning — overwriting a project file is irreversible (backups are auto-saved but not user-visible) |
| 🟡 | `nanoid` IDs in diagram nodes are not deterministic — duplicate imports create orphaned nodes |
| 🟡 | L5X export has no schema validation before writing — malformed exports corrupt Studio 5000 projects |
| 🟢 | No diagram diff view — cannot compare two versions of the same state machine |
| 🟢 | No multi-diagram tab support — only one project open at a time |

---

## 7. Data & Persistence

| Priority | Issue |
|----------|-------|
| 🔴 | No automated backup verification — backups are written but never tested for restore validity |
| 🟠 | Three different database technologies across 4 apps (SQLite, MSSQL, localStorage/Zustand) — no unified migration or backup strategy |
| 🟠 | No data export format shared across apps — each uses ad-hoc CSV, Excel, or JSON |
| 🟠 | State Logic Builder uses `localStorage` for project data — this is cleared by browser privacy tools and has no persistence guarantee |
| 🟡 | No cross-app data model — a "project" in Scheduler and a "project" in Build Readiness are silently unrelated |
| 🟡 | No audit trail — no record of who changed what and when in any app |
| 🟡 | Assemblies Library backup is triggered server-side daily but not surfaced to users |
| 🟢 | No data archival policy — old projects/assemblies accumulate indefinitely |
| 🟢 | No GDPR / data retention controls (lower priority for internal tooling, but worth documenting) |

---

## 8. Testing

| Priority | Issue |
|----------|-------|
| 🔴 | SDC Scheduler: `jest` version `^30.4.2` in package.json doesn't exist (Jest max is ~29) — test suite may never have run | 
| 🟠 | Build Readiness Report: zero automated tests — no unit, integration, or E2E |
| 🟠 | Assemblies Library: Playwright E2E tests require a live N: network share — cannot run in CI |
| 🟠 | No integration tests for the unified shell — server start/stop lifecycle is untested |
| 🟡 | State Logic Builder L5X exporter has no automated correctness tests — manual verify in Studio 5000 only |
| 🟡 | SDC Scheduler test database seed has a timing issue (schema created at line 196, queried before that) |
| 🟡 | No load / stress tests for MSSQL connection pool (Build Readiness) or SQLite concurrency (Scheduler) |
| 🟡 | Test coverage metrics not tracked or enforced via CI thresholds |
| 🟢 | No contract/schema tests between frontend and backend API for any app |
| 🟢 | No accessibility tests (axe-core / Lighthouse CI) |

---

## 9. Infrastructure & DevOps

### Build & Packaging

| Priority | Issue |
|----------|-------|
| 🟠 | Shell packaged build requires each app's `node_modules` to be pre-installed — no automated step for this |
| 🟠 | Native modules (`better-sqlite3`, `bcrypt`) must be rebuilt for the target Electron Node ABI — no `electron-rebuild` step in build scripts |
| 🟠 | State Logic Builder requires `npm run build` before the server can serve its UI — not automated in the unified build |
| 🟡 | No code-signing for Windows installer — Windows Defender flags the app as untrusted on first install |
| 🟡 | Auto-update feed URL is not configured in the shell's `electron-builder.yml` |
| 🟡 | Assemblies Library and State Logic Builder each have their own auto-updater — will conflict when embedded in the shell |
| 🟢 | No delta/differential updates — every update is a full reinstall |

### CI/CD

| Priority | Issue |
|----------|-------|
| 🟠 | No CI pipeline for the unified shell (no `.github/workflows/` in the root) |
| 🟡 | Individual apps have GitHub Actions but they don't gate on test passage |
| 🟡 | No automated version bump or changelog generation |
| 🟢 | No staging / preview environment for testing before release |

### Logging & Observability

| Priority | Issue |
|----------|-------|
| 🟠 | Build Readiness and State Logic Builder have no request logging at all |
| 🟡 | Assemblies Library logs to a file on the N: network share — unavailable if drive is offline |
| 🟡 | No centralized log aggregation across all 4 apps — debugging requires opening 4 separate log files |
| 🟡 | No health check endpoint (`GET /health`) on Build Readiness, State Logic Builder |
| 🟢 | No performance metrics (request latency, DB query time) collected anywhere |
| 🟢 | No error tracking service (e.g., Sentry) — production errors go unnoticed until a user complains |

---

## 10. Developer Experience & Code Quality

### Configuration

| Priority | Issue |
|----------|-------|
| 🟠 | Magic numbers scattered across all apps (session max-age, rate-limit windows, timeouts) — should be centralized in config |
| 🟡 | No `.env.example` files in any app — new developers don't know what env vars to set |
| 🟡 | Some apps use `dotenv` while others read env vars directly — no consistent approach |
| 🟢 | No shared config schema validation — `zod.parse(process.env)` at startup would catch missing vars immediately |

### Code Quality

| Priority | Issue |
|----------|-------|
| 🟠 | SDC Scheduler `db.js` parameter substitution is broken and potentially allows SQL injection |
| 🟡 | Assemblies Library has 13 separate `useState` filter calls instead of a reducer |
| 🟡 | No ESLint or Prettier config enforced across the monorepo — code style diverges per app |
| 🟡 | No shared utility library — date formatting, error helpers, and validation logic are duplicated |
| 🟢 | No JSDoc or TypeScript types in any app — refactoring is risky without type safety |
| 🟢 | `console.log` used for structured logging — should use a proper logger (`pino`, `winston`) |

### Monorepo Tooling

| Priority | Issue |
|----------|-------|
| 🟡 | Root `package.json` workspaces only includes `shell` — the 4 app directories are not managed |
| 🟡 | No shared `node_modules` hoisting — duplicate copies of React, Express, etc. in each app |
| 🟡 | No `turborepo` or `nx` for build orchestration — `build:all` runs sequentially |
| 🟢 | No changelogs or release notes per app |

---

## 11. Integration & Interoperability

### Single Sign-On (SSO)

Currently, Scheduler has its own bcrypt session auth, while the other three have no auth.
A unified auth layer would give users one login across all four tools.

**Options ranked by effort:**
1. **Shared JWT middleware** — lightest lift; shell injects a short-lived JWT as a query param when opening each app window. Each app validates it.
2. **Dedicated auth microservice** — a 5th tiny Express server issues/validates tokens shared across apps.
3. **OAuth2/OIDC** (e.g., Azure AD) — most robust; appropriate if the company already uses Active Directory.

### Cross-App Data Sharing

| Priority | Opportunity |
|----------|-------------|
| 🟡 | Scheduler projects and Build Readiness projects are the same concept but unlinked — opening a project in one should offer to open it in the other |
| 🟡 | No shared "Project" entity; adding one would enable cross-app search and reporting |
| 🟢 | Assemblies can be referenced in Scheduler tasks — no link currently |

### API Gateway

| Priority | Issue |
|----------|-------|
| 🟡 | 4 separate Express servers on 4 ports — no unified API surface; frontend code has to know about individual ports |
| 🟢 | No API versioning (`/api/v1/`) in any app — breaking changes cannot be deployed without coordinating all consumers |

---

## 12. Accessibility

| Priority | Issue |
|----------|-------|
| 🟠 | Shell launcher has no keyboard navigation — Tab, Enter, and arrow keys do not work |
| 🟠 | No `aria-label` on icon-only buttons in Assemblies Library or State Logic Builder |
| 🟡 | Color is used as the only status indicator (red/green dots) — add text label for color-blind users (already partially done in the shell) |
| 🟡 | No focus-visible ring on interactive elements in any app |
| 🟡 | Launcher and apps are not screen reader tested |
| 🟢 | No `prefers-reduced-motion` media query for the pulsing animation on status dots |
| 🟢 | Contrast ratio not validated against WCAG AA on dark backgrounds |

---

## 13. Feature Gaps

### Shell-Level Features

| Priority | Feature |
|----------|---------|
| 🟠 | **Notification center** — toasts from each app aggregated in launcher (e.g., "Scheduler: 3 tasks due today") |
| 🟠 | **Crash recovery** — if a server crashes, auto-restart it and notify the user |
| 🟡 | **Quick-launch keyboard shortcut** — global hotkey to bring launcher to front |
| 🟡 | **App version display** — each card shows the app's current version |
| 🟡 | **Startup order control** — some apps depend on others; allow dependency ordering |
| 🟢 | **Activity timeline** — cross-app feed of recent actions |
| 🟢 | **Search across all apps** — global search bar in launcher delegates to each app's search API |

### Assemblies Library

| Priority | Feature |
|----------|---------|
| 🟡 | Full-text search across all fields (not just description) |
| 🟡 | Offline mode with sync-on-reconnect |
| 🟢 | Assembly comparison view (diff between two revisions) |
| 🟢 | Bulk export to Excel/CSV |

### Build Readiness Report

| Priority | Feature |
|----------|---------|
| 🟠 | Real-time data via WebSocket or Server-Sent Events (currently requires manual refresh) |
| 🟡 | PDF export of readiness reports |
| 🟡 | Email report scheduling via UI (the route exists but has no frontend) |
| 🟡 | Historical trend charts — readiness % over time |
| 🟢 | Drill-down from summary to individual BOM item issues |

### SDC Scheduler

| Priority | Feature |
|----------|---------|
| 🟡 | Password reset flow |
| 🟡 | Real-time collaboration (two users editing the same schedule simultaneously) |
| 🟡 | Calendar export (`.ics`) for personal calendar sync |
| 🟢 | Mobile-responsive Gantt view |
| 🟢 | Dependency visualization (critical path highlighting) |

### State Logic Builder

| Priority | Feature |
|----------|---------|
| 🟠 | Cloud / file-system project persistence to replace localStorage |
| 🟡 | Persistent undo/redo history (survives browser refresh) |
| 🟡 | Diagram version history (named snapshots) |
| 🟡 | Multi-tab project support |
| 🟢 | L5X import (parse existing PLC code back into a diagram) |
| 🟢 | Diagram diff / comparison view |

---

## Quick-Win Summary (≤ 1 day each)

These have the best effort-to-impact ratio and should be done first:

1. 🔴 Add global JSON error handler to all 4 Express apps (30 min each)
2. 🔴 Validate `SESSION_SECRET` is set in SDC Scheduler — throw on startup if missing (15 min)
3. 🟠 Add `helmet()` to all Express apps (5 min each)
4. 🟠 Replace `Promise.all()` with `Promise.allSettled()` in Build Readiness routes (15 min)
5. 🟠 Add `isNaN` guard on all `parseInt(req.params)` calls (30 min across all apps)
6. 🟠 Add rate limiting to SDC Scheduler login endpoint (20 min)
7. 🟡 Add `.env.example` files to all 4 apps (20 min each)
8. 🟡 Add `process.on('unhandledRejection', ...)` to all server entry points (10 min each)
9. 🟡 Fix Jest version in SDC Scheduler `package.json` (5 min)
10. 🟡 Set `sandbox: true` in shell launcher `BrowserWindow` options (5 min)
