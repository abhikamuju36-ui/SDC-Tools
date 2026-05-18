# SDC Centralized Calendar — Developer Guide

## Running

The app is managed by the SDC Tools shell launcher (port 4005). For standalone dev:

```bash
cd server
npm run dev        # node --watch server.js
```

Then open http://localhost:4005 in a browser.

## Key architecture decisions

**No build step.** The frontend loads React 18 and Babel Standalone from bundled files. Edit `frontend/app.jsx` and reload — no compile step.

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

## Files to know

| File | Purpose |
|------|---------|
| `frontend/app.jsx` | Entire React UI (~3000 lines) |
| `frontend/utils.js` | Date helpers, ICS export, recurring event expansion |
| `frontend/data.js` | Seeded events (holidays, pay days, birthdays) |
| `server/server.js` | Express app entry point |
| `server/middleware/requireAuth.js` | JWT auth + SKIP_AUTH shell bypass |
| `server/routes/events.js` | CRUD for shared events |
| `server/routes/scheduler.js` | Read-only bridge to SDC Scheduler DB |
| `server/sqlite.js` | SQLite helpers for the shared events table |
| `server/db.js` | NeDB user/role stores |
