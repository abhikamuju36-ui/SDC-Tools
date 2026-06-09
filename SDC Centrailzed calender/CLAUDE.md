# SDC Centralized Calendar — Developer Guide

## Running

The app is managed by the SDC Tools shell launcher (port 4005). For standalone dev:

```bash
# Terminal 1 — Express API server (port 4005)
cd server
npm run dev        # node --watch server.js

# Terminal 2 — Vite dev server with HMR (port 5174, proxies /api → 4005)
cd client
npm run dev
```

Then open http://localhost:5174 in a browser during development.

**Production build** (output goes to `dist/`, served by Express):

```bash
cd client
npm run build      # runs: vite build --config ../vite.config.js
```

Then start the server with `NODE_ENV=production node server.js` and open http://localhost:4005.

## Key architecture decisions

**Vite build pipeline.** `src/` contains proper ES modules. `client/package.json` manages Vite dev/build dependencies (separate from the root `package.json` which is for Electron). The legacy `frontend/` directory is still served in dev mode (`NODE_ENV !== 'production'`) for backward compatibility.

**Component structure.** `src/App.jsx` is the entry component; `src/components/` contains all sub-components extracted from the original monolithic `frontend/app.jsx`. `src/utils.js`, `src/data.js`, and `src/constants.js` are the ES module versions of `frontend/utils.js`, `frontend/data.js`, and inline constants.

**Auth bypass.** When run via the shell, `SKIP_AUTH=true` is injected into the process environment. `server/middleware/requireAuth.js` detects this and injects a hardcoded `SHELL_USER` admin context instead of checking JWT tokens. `frontend/app.jsx` has `LOCAL_MODE = true` which skips the login screen. Do not change these.

**SDC Scheduler integration.** `server/routes/scheduler.js` opens the SDC Scheduler SQLite DB at `../../SDC_Scheduler/scheduler.db` (relative to `server/routes/`) in read-only mode using the `sqlite3` npm package. If the file doesn't exist, the route returns `[]` gracefully — the calendar still works without it.

**Frontend state.** `schedulerEvents` (formerly `ssEvents`) holds tasks synced from the Scheduler. Persisted to `localStorage` under `sdc_scheduler_events`. Cleared by clicking "Clear Tasks" in the Scheduler Sync panel.

**Event sources.** Events have a `source` field:
- `undefined` — user-created calendar events (editable)
- `'seeded'` — holidays/paydays auto-generated from `data.js` (read-only)
- `'scheduler'` — tasks synced from SDC Scheduler (read-only, `readOnly: true`)

## Common tasks

**Add a new category** — Edit `CATEGORIES` in `frontend/utils.js`. Update `allowedCategories` in `server/middleware/requireAuth.js` `SHELL_USER` constant if it should be visible to shell users.

**Change the scheduler DB path** — Edit `SCHEDULER_DB` constant in `server/routes/scheduler.js`.

**Change the port** — The shell injects `PORT=4005` via `processManager.js`. For standalone, edit `server/.env`.

**Add a new API route** — Create `server/routes/myroute.js`, import it in `server/server.js`, mount with `app.use('/api/myroute', require('./routes/myroute'))`.

**Employee directory** — Employees are stored in `sdc_calendar.employees` (MySQL). On first run the frontend posts DEFAULT_EMPLOYEES to `POST /api/employees/seed` automatically. Edit employees via the Directory modal in the UI (admin/HR only writes; all users can read).

## Files to know

| File | Purpose |
|------|---------|
| `src/App.jsx` | Main React entry (auth shell + CalendarApp) |
| `src/components/` | Individual React components (20 files) |
| `src/utils.js` | ES module version of frontend/utils.js |
| `src/data.js` | ES module version of frontend/data.js (seeded events) |
| `src/constants.js` | API_URL, LOCAL_MODE, Icon, TWEAK_DEFAULTS, ACCENT_SWATCHES |
| `frontend/app.jsx` | Legacy monolithic UI (still works in direct-file mode) |
| `frontend/utils.js` | Date helpers, ICS export, recurring event expansion (legacy) |
| `frontend/data.js` | Seeded events + DEFAULT_EMPLOYEES (legacy) |
| `client/package.json` | Vite build dependencies (separate from Electron root) |
| `vite.config.js` | Vite config — root=src, outDir=dist, proxy /api → 4005 |
| `server/server.js` | Express app entry point |
| `server/middleware/requireAuth.js` | JWT auth + SKIP_AUTH shell bypass |
| `server/routes/events.js` | CRUD for shared events |
| `server/routes/employees.js` | CRUD for [calendar].[employees] table |
| `server/routes/scheduler.js` | Read-only bridge to SDC Scheduler DB |
| `server/mysqlDb.js` | MySQL connection pool (replaces azureDb.js) |
| `server/sqlite.js` | Events data layer — MySQL adapter (name kept for compatibility) |
| `server/db.js` | Users & roles data layer — MySQL adapter |
