# Shared Database Architecture

## My Recommendation: Hybrid Model

**Short answer:** Don't consolidate everything into one database, but don't keep everything
completely separate either. Use a **shared MSSQL database** for the handful of concepts that
truly cross app boundaries, and let each app keep its own store for its domain-specific data.

---

## Why Not Full Consolidation

Here is why merging all 4 apps into one database is a bad idea:

| Problem | Detail |
|---------|--------|
| **ETO/MSSQL is read-only** | Build Readiness reads from an existing enterprise ERP (ETO). You don't own those tables and can't add columns or create FKs into them. |
| **SQLite is embedded by design** | Assemblies Library runs its SQLite file on the N: drive alongside the CAD files. This is intentional — the scanner writes metadata next to the files it indexes. |
| **State Logic Builder data is a document** | A PLC diagram is deeply nested JSON (nodes, edges, signals, actions, waypoints). This belongs in a document store or a JSONB column — not normalized relational tables. Trying to normalize it would be painful and gain nothing. |
| **One DB = one point of failure** | If the shared DB is unreachable, all 4 apps go down instead of one. |
| **Schema coupling** | A migration in Scheduler's task schema would require coordinating with State Logic Builder deployments. Bad. |

---

## Why Not Keep Everything Separate

| Problem | Detail |
|---------|--------|
| **"Project" is the same thing everywhere** | Scheduler has `project` (TEXT), Assemblies has `job_id` (TEXT), Build Readiness has `ProjectID` (INT from ETO). Three different identifiers for the same real-world project. No way to join or cross-reference. |
| **No shared auth** | Scheduler has its own users table. Assemblies, Build Readiness, and State Logic Builder have no auth at all. Every new user requires separate setup per app (or worse, is unauthenticated). |
| **No cross-app audit trail** | Who changed a task schedule? Who modified an assembly? Who updated PLC logic for a project? Currently impossible to answer in aggregate. |
| **No cross-app notifications** | Scheduler can't tell the Assemblies Library "this project moved to next phase — expect new CAD files." |

---

## The Hybrid Model

```
┌─────────────────────────────────────────────────────────────────┐
│            SDCShared (new MSSQL database on existing server)    │
│                                                                 │
│  projects ── project_phases ── users ── audit_log               │
│  notifications ── app_config ── sessions                        │
│                                                                 │
│  All apps read/write here for shared concepts only.             │
└───────────┬──────────────┬──────────────┬───────────────────────┘
            │              │              │
            ▼              ▼              ▼
    ┌───────────┐  ┌───────────┐  ┌────────────────┐
    │ Scheduler │  │ Assemblies│  │  State Logic   │
    │  SQLite   │  │  SQLite   │  │  SQLite / JSON │
    │ (tasks,   │  │(assemblies│  │  (diagrams,    │
    │ financials│  │ audit_log)│  │   standards)   │
    └───────────┘  └───────────┘  └────────────────┘
                                         ▲
                              ┌──────────┴───────────┐
                              │  Build Readiness     │
                              │  READ-ONLY from ETO  │
                              │  MSSQL (tblSpec,     │
                              │  tblEngProductStruct)│
                              └──────────────────────┘
```

Each app has a `project_id` column (FK to `SDCShared.projects.id`) as the common thread.
Everything else stays domain-local.

---

## Why MSSQL for the Shared Database

You already have a SQL Server instance running for Build Readiness (ETO).
That means:

- **Zero new infrastructure** — create one new database `SDCShared` on the same server.
- **Same `mssql` npm driver** already a dependency in the stack.
- **Concurrent writes** — unlike SQLite, SQL Server handles simultaneous writes from all 4 app servers cleanly.
- **Team already knows it** — SQL Server management, backups, and monitoring are already in place.
- **Transactions across shared tables** — auth + audit in one atomic write.

---

## What Goes in the Shared Database

These are the only things that need to cross app boundaries.

### Table: `projects`

```sql
CREATE TABLE SDCShared.dbo.projects (
    id           INT           NOT NULL,   -- matches ETO vwProjects.ProjectID
    code         NVARCHAR(50)  NOT NULL,   -- short code used in Scheduler + Assemblies
    name         NVARCHAR(255) NOT NULL,
    customer     NVARCHAR(255),
    status       NVARCHAR(50)  DEFAULT 'active',  -- active | complete | on_hold
    created_at   DATETIME2     DEFAULT GETDATE(),
    updated_at   DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT PK_projects PRIMARY KEY (id)
);
```

**How it's populated:** Nightly sync job reads `vwProjects` from ETO and upserts here.
This table is the single authoritative project list for all apps.

---

### Table: `users`

```sql
CREATE TABLE SDCShared.dbo.users (
    id            INT           IDENTITY(1,1) NOT NULL,
    username      NVARCHAR(50)  NOT NULL UNIQUE,
    email         NVARCHAR(255) NOT NULL UNIQUE,
    display_name  NVARCHAR(100),
    password_hash NVARCHAR(255) NOT NULL,
    role          NVARCHAR(20)  NOT NULL DEFAULT 'viewer',
                  -- admin | manager | editor | viewer
    active        BIT           NOT NULL DEFAULT 1,
    created_at    DATETIME2     DEFAULT GETDATE(),
    last_login_at DATETIME2,
    CONSTRAINT PK_users PRIMARY KEY (id)
);
```

**Migration:** Migrate Scheduler's existing `users` table here.
All 4 apps authenticate against this one table.

---

### Table: `sessions`

```sql
CREATE TABLE SDCShared.dbo.sessions (
    id         NVARCHAR(128) NOT NULL,
    user_id    INT           NOT NULL,
    app_id     NVARCHAR(30)  NOT NULL,  -- 'assemblies'|'readiness'|'scheduler'|'statelogic'
    data       NVARCHAR(MAX),           -- serialized session JSON
    expires_at DATETIME2     NOT NULL,
    created_at DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT PK_sessions PRIMARY KEY (id),
    CONSTRAINT FK_sessions_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IX_sessions_user_app ON SDCShared.dbo.sessions(user_id, app_id);
CREATE INDEX IX_sessions_expires  ON SDCShared.dbo.sessions(expires_at);
```

---

### Table: `audit_log`

```sql
CREATE TABLE SDCShared.dbo.audit_log (
    id          BIGINT        IDENTITY(1,1) NOT NULL,
    app_id      NVARCHAR(30)  NOT NULL,
    project_id  INT,
    user_id     INT,
    action      NVARCHAR(50)  NOT NULL,  -- 'create'|'update'|'delete'|'export'|'login'
    entity_type NVARCHAR(50)  NOT NULL,  -- 'task'|'assembly'|'diagram'|'user'...
    entity_id   NVARCHAR(128),
    summary     NVARCHAR(500),
    diff        NVARCHAR(MAX),           -- JSON {before: {...}, after: {...}}
    ip_address  NVARCHAR(45),
    timestamp   DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT PK_audit PRIMARY KEY (id),
    CONSTRAINT FK_audit_users    FOREIGN KEY (user_id)   REFERENCES users(id),
    CONSTRAINT FK_audit_projects FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IX_audit_project  ON SDCShared.dbo.audit_log(project_id, timestamp DESC);
CREATE INDEX IX_audit_user     ON SDCShared.dbo.audit_log(user_id, timestamp DESC);
CREATE INDEX IX_audit_app      ON SDCShared.dbo.audit_log(app_id, timestamp DESC);
```

**This replaces:** Scheduler's `task_history` table and Assemblies' `audit_log` table.
Both can be migrated here and each app stops maintaining its own.

---

### Table: `notifications`

```sql
CREATE TABLE SDCShared.dbo.notifications (
    id         INT           IDENTITY(1,1) NOT NULL,
    user_id    INT           NOT NULL,
    from_app   NVARCHAR(30)  NOT NULL,
    project_id INT,
    title      NVARCHAR(200) NOT NULL,
    body       NVARCHAR(1000),
    link_url   NVARCHAR(500),           -- deep-link into the originating app
    read_at    DATETIME2,               -- NULL = unread
    created_at DATETIME2     DEFAULT GETDATE(),
    CONSTRAINT PK_notifications PRIMARY KEY (id),
    CONSTRAINT FK_notif_users    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT FK_notif_projects FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IX_notif_user_unread ON SDCShared.dbo.notifications(user_id, read_at)
    WHERE read_at IS NULL;
```

---

### Table: `app_config`

```sql
CREATE TABLE SDCShared.dbo.app_config (
    app_id     NVARCHAR(30)   NOT NULL,
    key        NVARCHAR(100)  NOT NULL,
    value      NVARCHAR(MAX)  NOT NULL,
    updated_at DATETIME2      DEFAULT GETDATE(),
    updated_by INT,
    CONSTRAINT PK_app_config PRIMARY KEY (app_id, key),
    CONSTRAINT FK_config_users FOREIGN KEY (updated_by) REFERENCES users(id)
);
```

Stores things like: `assemblies/SHARED_BASE`, `scheduler/smartsheet_token_expiry`,
`readiness/cache_ttl_seconds`. Replaces hardcoded constants and `.env` magic values.

---

## What Stays Per-App

### Assemblies Library — keeps SQLite on N: drive

**Keep as-is:**
```
assemblies (id, project_id→shared, job_id, partno, description, category,
            model_link, thumbnail, path, status, ...)
```

**Changes:**
- Add `project_id INT` column (FK reference to `SDCShared.projects.id`)
- Map existing `job_id` TEXT values to `project_id` INT during migration
- Remove local `audit_log` table — write to `SDCShared.audit_log` instead

**Why keep SQLite here:** The scanner reads from the filesystem and updates the DB at high frequency.
SQLite embedded on N: drive is the right tool — it's co-located with the files it indexes.

---

### SDC Scheduler — keeps SQLite / PostgreSQL

**Keep as-is:**
```
tasks, team_members, project_financials, settings
```

**Changes:**
- Remove local `users` table → replaced by `SDCShared.users`
- Remove local `task_history` table → replaced by `SDCShared.audit_log`
- Add `project_id INT` to `tasks` and `project_financials` (FK to shared projects)
- Map existing `project` TEXT to `project_id` INT during migration

**Why keep domain tables here:** Tasks, milestones, predecessors, financials, and Gantt
metadata are rich relational data that only Scheduler cares about. Putting them in a shared DB
adds coupling with no benefit.

---

### State Logic Builder — migrate from localStorage to SQLite

**New local SQLite database** (`statelogic.db` in `%APPDATA%\SDC State Logic Builder\`):

```sql
CREATE TABLE projects (
    id         TEXT    PRIMARY KEY,  -- UUID
    project_id INT,                  -- FK to SDCShared.projects.id (nullable)
    name       TEXT    NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);

CREATE TABLE diagrams (
    id         TEXT    PRIMARY KEY,  -- UUID (current nanoid)
    project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    definition TEXT    NOT NULL,     -- JSON blob of nodes/edges/devices/signals
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT    NOT NULL
);

CREATE TABLE diagram_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    diagram_id TEXT    NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    definition TEXT    NOT NULL,     -- snapshot at this version
    saved_by   TEXT,                 -- username
    saved_at   TEXT    NOT NULL
);
```

**Why this instead of localStorage:**
- Removes the 5–10 MB localStorage limit
- Enables undo/redo history that survives refresh
- Enables named version snapshots
- Can still work offline (SQLite is embedded, no network needed)

---

### Build Readiness Report — stays read-only + adds cache tables

**No changes to ETO tables** (you don't own them).

**Add in `SDCShared`** (optional caching layer):

```sql
CREATE TABLE SDCShared.dbo.readiness_cache (
    project_id     INT          NOT NULL,
    spec_id        INT          NOT NULL,
    spec_desc      NVARCHAR(255),
    bom_total      INT,
    bom_received   INT,
    readiness_pct  DECIMAL(5,2),
    cached_at      DATETIME2    NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_readiness_cache PRIMARY KEY (project_id, spec_id),
    CONSTRAINT FK_rc_projects FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

This cache replaces the N+1 query pattern with a background refresh job.
The frontend reads the cache; a cron job refreshes it from ETO every 5 minutes.

---

## The Shared Service Layer

Each app shouldn't directly write SQL to `SDCShared`. Instead, expose a small
**shared Node.js module** that all apps import:

```
c:\Projects\Centrailized library\
└── shared/
    ├── package.json
    ├── db.js          ← MSSQL connection pool (singleton)
    ├── auth.js        ← login, validateSession, createUser
    ├── audit.js       ← logAction(appId, userId, action, entity, diff)
    ├── notify.js      ← createNotification, getUnread
    └── projects.js    ← getAll, getById, syncFromETO
```

Example usage in any app:

```js
// Any app's server — replaces its own auth middleware
const { validateSession } = require('../../shared/auth')
const { logAction }       = require('../../shared/audit')

app.use('/api', async (req, res, next) => {
  const user = await validateSession(req.cookies.sessionId, 'scheduler')
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  req.user = user
  next()
})
```

---

## Migration Plan

### Phase 1 — Shared DB setup (2–3 days)

- [ ] Create `SDCShared` database on existing SQL Server
- [ ] Run `CREATE TABLE` scripts for `projects`, `users`, `sessions`, `audit_log`, `notifications`, `app_config`
- [ ] Write sync job: seed `projects` from ETO `vwProjects` (run nightly via `node-cron`)
- [ ] Create `shared/` npm package with `db.js`, `auth.js`, `audit.js`

### Phase 2 — Auth migration (2–3 days)

- [ ] Migrate Scheduler's `users` table → `SDCShared.users`
- [ ] Update Scheduler auth middleware to use `shared/auth.js`
- [ ] Add `shared/auth.js` middleware to Assemblies Library (currently no auth)
- [ ] Add `shared/auth.js` middleware to Build Readiness (currently no auth)
- [ ] Add `shared/auth.js` middleware to State Logic Builder (currently no auth)
- [ ] Update shell launcher to pass JWT from shared auth into each app window URL

### Phase 3 — Project ID alignment (1–2 days)

- [ ] Add `project_id INT` column to Scheduler `tasks` table
- [ ] Add `project_id INT` column to Assemblies `assemblies` table
- [ ] Write one-time migration script: map `project` TEXT → `project_id` INT via name match
- [ ] Write one-time migration script: map `job_id` TEXT → `project_id` INT
- [ ] Update all API queries to filter by `project_id`

### Phase 4 — Audit log unification (1 day)

- [ ] Remove `task_history` table from Scheduler; write to `SDCShared.audit_log` instead
- [ ] Remove `audit_log` from Assemblies Library; write to `SDCShared.audit_log` instead
- [ ] Add audit writes to State Logic Builder on project save/export

### Phase 5 — State Logic Builder persistence (2–3 days)

- [ ] Create `statelogic.db` SQLite schema (`projects`, `diagrams`, `diagram_history`)
- [ ] Migrate Zustand `localStorage` store → SQLite on first launch (one-time import)
- [ ] Update all store actions to persist to SQLite instead of localStorage
- [ ] Add diagram version history on every save

### Phase 6 — Build Readiness cache (1 day)

- [ ] Create `readiness_cache` table in `SDCShared`
- [ ] Write background refresh job (every 5 min) that reads ETO and writes cache
- [ ] Update Build Readiness routes to read from cache instead of ETO directly

---

## Data Flow Diagram

```
ETO MSSQL (read-only)
     │
     │  nightly sync
     ▼
SDCShared.projects ◄──────────────── all apps read project list from here
                                            │
           ┌────────────────────────────────┼────────────────────────┐
           │                               │                         │
           ▼                               ▼                         ▼
   SDCShared.users                 SDCShared.audit_log      SDCShared.notifications
   (shared auth)                   (cross-app trail)        (cross-app alerts)
           │
           ├─── Scheduler reads/writes ──► tasks, financials (own SQLite)
           ├─── Assemblies reads/writes ──► assemblies (own SQLite on N:)
           ├─── State Logic reads/writes ──► diagrams (own SQLite in AppData)
           └─── Build Readiness reads ────► readiness_cache (SDCShared)
                                            ▲
                                    ETO MSSQL (5 min refresh)
```

---

## Tradeoffs Summary

| Approach | Pros | Cons |
|----------|------|------|
| **Full consolidation** (one DB) | Simple backup, one migration to manage | ETO is read-only, diagram JSON is not relational, coupling risk, single point of failure |
| **Full separation** (keep as-is) | Maximum isolation, independent deployments | No shared project IDs, duplicate auth, no cross-app features possible |
| **Hybrid (recommended)** | Shared auth + project IDs unlock cross-app features; each app keeps its own domain data; failure-isolated | More moving parts upfront; requires `shared/` package and migration scripts |

---

## Final Verdict

**Use `SDCShared` MSSQL for:** `projects`, `users`, `sessions`, `audit_log`,
`notifications`, `app_config`, `readiness_cache`.

**Keep per-app:** Everything domain-specific — Scheduler tasks/financials, Assemblies file
metadata, State Logic diagrams, ETO raw data.

The single biggest win is the **`projects` table** — once all 4 apps share a `project_id`,
cross-app reports, search, and navigation become possible. That alone is worth the effort of
Phase 1–3 of the migration plan above.
