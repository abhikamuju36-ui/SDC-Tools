# SDC ETC Planner & Standard Fees — Development Log

This document captures the full history of how these two apps came to be: the
original spreadsheet system they replace, every architectural decision, every
bug found and fixed, and the current state of both apps as of this writing.

---

## 1. Background — what existed before

Three Excel workbooks in `D:\AI Projects\sheets`:

1. **`End Of Month ETC Sheet.xlsx`** — the hub. `Managers Fill Out` tab is
   where managers enter monthly Estimate-to-Complete (ETC) hours per job/section.
   `Monthly ETC Process` / `Monthly ETC Process - Costs` are PivotTables wired
   to a Power BI semantic model (Paylocity for hours, TotalETO for costs).
2. **`Project Planner Data Control.xlsx`** — a parallel/superset workbook with
   an `Employees` tab, `Estimated Hours` tab (job costing ledger), and monthly
   archive tabs (`ETC 2025-02` … `ETC 2025-08`).
3. **`Standard Fees.xlsx`** — downstream. Per-job Execution Rates (ENGR/Shop/
   Parts), a "Standard Fees By Department" section (company-wide monthly hour
   pools per category: Engineering PM/Warranty, Shop Manufacturing/Warranty),
   and a "Submit All ETC and Standard Fees" macro/script chain that Dan
   described as unreliable ("sometimes it works, sometimes it doesn't").

### The meeting with Dan (transcript reviewed early in this project)
Key points that shaped everything below:
- Confidentiality: Standard Fees data must stay separate from the general ETC
  tool — only Dan and Lisa should see it. **Non-negotiable, confirmed two apps
  is the right split.**
- Employee/department lists were manual and drifting from reality — should
  sync from Paylocity. Departed employees' historical hours must never
  disappear (soft-delete, not hard-delete).
- Job/estimate data was manually re-typed into the Planner sheet when a
  project sold; Dan wanted this automated from "the project release" (a
  scheduling-tool concept, distinct from any of the three sheets above).
- The core ETC math: **New ETC = Prior ETC − Hours Worked This Month**, with
  a carry-forward rule (no hours worked ⇒ New ETC = Prior ETC), and manager
  override on top of the system suggestion.
- Dan flagged a stale/orphaned external link in `Project Planner Data
  Control.xlsx` referencing a file called "End of Month Numbers.xlsx" that he
  didn't recognize — confirmed later to be dead/irrelevant.

---

## 2. Decision: replace with two web apps

- **App 1 — SDC ETC Planner** (`D:\AI Projects\sdc-etc-planner`, runs on
  `localhost:3010`): open to managers, tracks jobs and monthly ETC entries.
- **App 2 — SDC Standard Fees** (`D:\AI Projects\sdc-standard-fees`, runs on
  `localhost:3011`): restricted to an allowlist (Dan + Lisa), tracks execution
  rates, fee allotments, category pools, and monthly snapshots.

**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS v4 + Prisma ORM +
MySQL 9.7 (local instance at `D:\AI Projects\MYSQL Database`, databases
`sdc_etc_planner` and `sdc_standard_fees`, kept separate from the pre-existing
`sdc_scheduler` database). Auth via NextAuth (Credentials provider,
email+password, bcrypt-hashed) — a placeholder for eventual Microsoft/Azure AD
SSO, chosen deliberately so it can be swapped without touching the rest of the
app (`User.id` is what everything else keys off).

### Why this design survives future changes
- `Job.source` / `EstimatedHours` / `JobMonthlyActualHours.source` /
  `JobHoursDetail.source` fields are tagged (`'manual'`, `'migration'`,
  `'totaleto_sync'`, `'power_bi'`, `'sharepoint'`) so ingestion method can
  change without touching UI or calculation logic.
  **Caveat found 2026-07-31:** `syncActualHours` sets `source` on INSERT only,
  never on UPDATE, so a row first written by Power BI and since overwritten by
  the SharePoint pull still reads `power_bi`. The column records the *original*
  writer, not what maintains it — `JobMonthlyActualHours` shows 1,148
  `power_bi` against 5 `sharepoint` for that reason alone. Do not answer
  lineage questions from it without reading the sync code first.
- Prisma migrations are tracked in git-equivalent files — every schema change
  is reversible and versioned, unlike hand-edited Excel formulas.
- The ETC calculation (`src/lib/etc.ts`) is a pure function, decoupled from
  wherever the underlying hours came from.

---

## 3. Schema evolution (chronological)

### `sdc_etc_planner`
| Model | Purpose | Added when |
|---|---|---|
| `User` | Auth (credentials) | Initial scaffold |
| `Employee` | Synced from Paylocity eventually; soft-delete via `active` flag | Initial scaffold |
| `Job` | Core job record | Initial scaffold |
| `EstimatedHours` | Per-job, per-section hours | Initial scaffold, **redesigned** later |
| `EtcEntry` | Monthly manager-submitted ETC (replaces "Managers Fill Out") | Initial scaffold |
| `ActualHours` | Per-employee/job/month worked hours (source-tagged) | Initial scaffold — **dropped 2026-07-31**, superseded by `JobHoursDetail` (finer grain) + `JobMonthlyActualHours` (rollup); never held a row |
| `Job.customer`, `Job.type` | Confirmed from archive tabs (`ETC 2025-03/05/06`) — needed to show Completed-status jobs, which only exist in this data | After discovering jobs list showed 0 completed projects |
| `EstimatedHours` redesign | Changed from single `hours` field to three: `quotedHours`, `actualHistoricalHours`, `estimateToCompleteHours` — confirmed real structure from the "Estimated Hours" tab | When migrating that tab |
| `JobTask` | Per-employee task assignments (`taskName` + hours, keyed by `slot` 1-11) — free-text data, not fixed section codes | Same migration |
| `Job.startDate/completeDate/includeInTypeCalc/costQuoted/costActualHistorical` | Confirmed from "Estimated Hours" tab columns | Same migration |
| `Job.totEtoEstEngHours/totEtoActEngHours/totEtoEstMfgHours/totEtoActMfgHours/totEtoSyncedAt` | Live TotalETO sync fields | Live-sync build-out |
| `JobMonthlyActualHours` | Live Power BI actual-hours-by-month | Live-sync build-out |

### `sdc_standard_fees`
| Model | Purpose |
|---|---|
| `AllowedUser` | Hard access-control allowlist (Dan + Lisa only), with `passwordHash` |
| `Job` | Mirrors jobId/jobName/status (kept independent from App 1's DB) |
| `ExecutionRate` | Per-job ENGR/Shop/Parts rates — confirmed **not** a global constant; the sheet shows per-job override capability (orange-highlighted exceptions) |
| `FeeAllotment` | Per-job, per-category hour allotments — designed but the real sheet data didn't cleanly map here (see below). **Dropped 2026-07-31**, never held a row |
| `CategoryPool` | Company-wide monthly hour pools per category (Engineering PM/Warranty, Shop Manufacturing/Warranty) — the *actual* structure found in "Standard Fees By Department", added after `FeeAllotment` was found not to match reality |
| `MonthlySnapshot` | Replaces the "Submit All ETC and Standard Fees" script chain — one atomic DB transaction |

---

## 4. Migrations run (one-time, from the .xlsx files)

All read-only against the source files, never modified them.

1. **Employees** ← `Project Planner Data Control.xlsx` "Employees" tab → 122
   rows processed, 111 unique (duplicates collapsed on Paylocity ID — matches
   Dan's data-quality complaint).
2. **Jobs + Execution Rates** ← `Standard Fees.xlsx` "Standard Fees" tab →
   confirmed per-job rate structure (170/140/1.2 defaults, overridable).
   **Bug found and fixed:** initial migration read past the real job table
   (rows 8-60) into unrelated summary rows below, treating text like
   `"Engineering"` in column 0 as a fake Job Id → fixed by requiring `row[0]`
   to be numeric.
3. **Category Pools** ← same file, rows 68-100 ("Standard Fees By Department")
   → 4 rows (Engineering PM/Warranty, Shop Manufacturing/Warranty), confirmed
   exact dollar match to the sheet ($416,500 / $301,393 / $324,800 / $105,714,
   total $1,148,407).
4. **ETC Entries** ← `End Of Month ETC Sheet.xlsx` "Managers Fill Out" tab →
   458 entries across 16 auto-detected section blocks (detected by scanning
   for repeating "Prior ETC" column headers rather than hardcoding positions).
5. **Completed jobs + Customer/Type** ← `Project Planner Data Control.xlsx`
   archive tabs `ETC 2025-03/05/06` → the *only* place `Complete` status,
   `Customer`, and `Type` exist in the source data. Found because the app
   showed zero completed projects and investigation traced it to scope gaps
   in migrations 1-4.
6. **Estimated Hours tab (full)** ← `Project Planner Data Control.xlsx`
   "Estimated Hours" tab → 225 jobs updated with Quoted/Actual
   Historical/Estimate-to-Complete hours per section (1,803 rows), 57
   per-employee `JobTask` assignments, Cost Quoted/Actual, Start/Complete
   dates. This is the richest single source found — confirmed to be the
   literal upstream of the Power BI `Job` table (`Job[Data Source]` =
   `"Estimated Hours"`).

---

## 5. Live data integrations (replacing manual-entry stubs)

Discovered mid-project: real, working MCP server implementations already
existed at `N:\MCP_SERVERS\` for both Power BI and TotalETO (Claude Desktop
extensions, not wired into this session's tools directly, but their
credentials/queries were reusable):

- **Power BI** (`N:\MCP_SERVERS\Powerbi MCP`): interactive Entra login,
  DPAPI-cached token, REST `executeQueries` against workspace
  `d57acc39-0718-434d-a17c-1261d95a4d18` / dataset
  `5a47445c-a1c3-45b9-93e5-a9df3c465b29` (the same semantic model the original
  spreadsheet's `GETPIVOTDATA` formulas pulled from).
- **TotalETO** (`N:\MCP_SERVERS\TotalETO_Claude_Connector`): direct SQL Server
  connection (NTLM auth) to the production `SDC` database at
  `SERVER-APP1.stevendouglas.local`. Reused their hand-built, tested SQL
  queries (`vwProjects`, `vwProjectActualsVSEstimates`) rather than
  reverse-engineering the schema.

### Sync jobs built (all manual-trigger buttons on the App 1 dashboard, per
explicit choice — no scheduled/automatic sync yet)

1. **"Sync Jobs from TotalETO"** — pulls active ("Sold") projects + Est/Actual
   Engineering & Manufacturing hours from `vwProjects` /
   `vwProjectActualsVSEstimates`.
2. **"Sync Actual Hours from Power BI"** — DAX `SUMMARIZECOLUMNS` against the
   `Job` and `Date` tables with the `[Hours Actual]` measure → per-job,
   per-month actual hours (`JobMonthlyActualHours`).
3. **"Sync Quoted Hours & Cost from Power BI"** — `Hours Estimated` table
   (`Hours Quoted`, `Hours Estimated to Complete` per section) and `Cost
   Estimated` table (`Cost Quoted`) — confirmed to match the frozen migration
   values exactly (e.g. Job 788 Cost Quoted = $538,610 in both). **Cost Actual
   Historical was deliberately left un-synced** — no equivalent single Power
   BI measure exists for it (only a parts-specific `Part Cost Actual
   Historical` measure was found), so guessing at a reconstruction was
   rejected in favor of leaving the frozen, known-correct value in place.

### Critical policy: Type-gating on all live syncs
TotalETO has **no** "Type" (Custom/Duplicate/Hybrid/Service) field at all.
Early versions of the TotalETO sync created new `Job` rows for every active
TotalETO project, all with `type = NULL` — 247 phantom jobs. Per explicit
instruction, **a job must have a valid Type
(`Custom`/`Duplicate`/`Hybrid`/`Service`) to ever be imported or shown.**
Fixed by:
- `src/lib/job-filters.ts` — a shared `VALID_JOB_TYPES` constant and
  `validJobTypeFilter` Prisma where-clause, applied to every job-listing
  query app-wide (Dashboard, Jobs list, CSV export, Quoted tab).
- `syncFromTotalEto` now only **updates** jobs that already exist with a
  valid Type — it never creates a new job (since it can't set one correctly).
- The 247 already-created phantom jobs were deleted (cascading through
  `jobmonthlyactualhours`, `etcentry`, `estimatedhours`, `actualhours`,
  `jobtask` first to satisfy FK constraints).
- 2 legacy jobs from the original spreadsheet migration that also lack a
  Type (source data gap, not sync noise) were **kept** — they have real
  linked `EstimatedHours`/`JobMonthlyActualHours` data — but are filtered
  from every display view via the same `validJobTypeFilter`.
- The "New Job" manual-entry form now requires selecting a Type, closing the
  loophole for future manual entries too.

---

## 6. UI build-out

### App 1 — SDC ETC Planner
- **Design system**: SDC brand blue (`#0f6fb8`) + navy sidebar
  (`src/components/AppShell.tsx`), real SDC logo (`public/brand/`, copied from
  `D:\AI Projects\new app\logo`), route-group layout (`src/app/(app)/`) so
  every authenticated page gets the shell automatically.
- **Dashboard** (`/`): stat cards (Total/Active Jobs, Active Employees, ETC
  entries needing review), sync buttons with last-synced timestamps, recent
  jobs list.
- **Jobs** (`/jobs`): flat table (converted from a list view per explicit
  request) with search + auto-submitting status filter dropdown (fixed a UX
  bug where the filter required a separate button click), CSV export,
  Customer/Type columns, Complete/Active badges. Nav shortcuts: **All Jobs**,
  **Active Jobs**, **Completed Jobs**.
- **Job detail** (`/jobs/[id]`): month-selector tabs (fixed a bug where the
  page defaulted to the current calendar month even when a job's only data
  was in a past month — now defaults to the most recent month with data),
  ETC entries with confirm/needs-review workflow, Cost Quoted/Actual cards,
  "Live from TotalETO" card, "Actual Hours by Month (Power BI)" table,
  "Estimated Hours by Section" table (Quoted/Actual Historical/Estimate to
  Complete side by side), "Task Assignments" table.
- **Quoted** (`/quoted`): new flat wide table (24 columns) — Job Id, Name,
  Status, Start/Complete Date, Customer, Type, all 17 section-code quoted-hour
  columns, Cost Quoted, Cost Actual. Sticky first column for horizontal
  scrolling.
- **New Job** (`/jobs/new`): manual entry form, now requires a valid Type.

### App 2 — SDC Standard Fees
- Same design system, red "Restricted access" badge in the sidebar to
  visually distinguish it from the open ETC Planner.
- **Dashboard**: Jobs/Rates count, Category Pool count + latest month's total
  Standard Fee dollar figure (confirmed matches sheet exactly), Monthly
  Snapshot count, category pool breakdown table.
- **Jobs & Execution Rates**: flat table, per-job ENGR/Shop/Parts rate editing
  (inputs linked to off-table `<form>` elements via the `form` attribute,
  since HTML forbids `<form>` as a direct child of `<tr>`), search.
- **Fee Allotments**: category-color-coded table, manual entry form.
- **Monthly Snapshots**: submit button recalculates totals from Fee
  Allotments × Execution Rates as one atomic transaction, replacing the
  "Submit All ETC and Standard Fees" script chain Dan flagged as unreliable.

---

## 7. Bugs found and fixed (chronological)

1. **Migration row-bounds bug** — non-numeric Job Id values from summary rows
   below the real job table were treated as real jobs. Fixed with a `typeof
   row[0] !== "number"` guard.
2. **Cross-origin dev-resource block** — accessing via `server-app1:3010`
   instead of `localhost:3010` silently broke client-side hydration (Next.js
   blocks cross-origin requests to `/_next/*` dev resources by default). Fixed
   with `allowedDevOrigins` in `next.config.ts` on both apps.
3. **Interlaced PNG breaking Next Image optimizer** — the SDC logo file is
   interlaced, which the dev-mode Squoshi/WASM image optimizer can't handle
   (`400 Bad Request`). Fixed with the `unoptimized` prop.
4. **Middleware not excluding `/brand/*` static assets** — unauthenticated
   requests for the logo image got redirected to `/login` and served HTML
   with a `200` status instead of the actual image (silent failure, not an
   error). Fixed by adding `brand/` to the middleware matcher's negative
   lookahead on both apps.
5. **Job detail page defaulting to the wrong month** — always showed the
   current calendar month, so any job whose only data was in a past month
   (e.g. migrated data tagged `2026-06` while "today" is `2026-07`) appeared
   empty. Fixed to default to the most recent month with actual data.
6. **Status filter requiring an extra click** — the dropdown visually showed
   a selection but did nothing until a separate "Filter" button was clicked.
   Fixed with a small client component (`StatusFilterSelect.tsx`) that
   auto-submits the form `onChange`.
7. **`<form>` as a direct child of `<tr>`** — invalid HTML (the parser would
   silently hoist it out of the table, breaking layout). Fixed by rendering
   forms outside the `<table>` and linking inputs/buttons via the `form=`
   attribute.
8. **TotalETO sync creating 247 type-less phantom jobs** — see §5 above.

---

## 8. Explicit design decisions / things intentionally deferred

- **Two apps, not one** — confidentiality requirement from Dan; cannot be
  merged.
- **Manual-trigger sync buttons, not scheduled jobs** — user's explicit
  choice, to keep control/visibility while trusting the new live sources.
- **FeeAllotment vs CategoryPool** — initially assumed fee data was per-job
  (`FeeAllotment`); the real sheet data turned out to be company-wide monthly
  pools (`CategoryPool`). Both models were kept for a while, `FeeAllotment`
  against a hypothetical future per-job breakdown.
  **Reversed 2026-07-31:** it was dropped. Fourteen months on it had never held
  a row and nothing referenced it, so it was carrying no option value — only the
  suggestion to a future reader that per-job allotments are a supported concept
  here. The `FeeCategory` enum stays, since `CategoryPool` uses it.
- **Cost Actual Historical not synced live** — no verified Power BI measure
  exists for the whole-job figure; left as the frozen, confirmed-correct
  migration value rather than reconstructed and potentially wrong.
- **Two still-open questions from the original Dan meeting, now largely
  resolved by the Power BI/TotalETO integration work**: the "Paylocity report
  scope" gap and the "job/estimate upstream source" question both turned out
  to be answerable directly from Power BI/TotalETO rather than needing a
  meeting with John — though the exact reconciliation between TotalETO's
  Sold-project list and the spreadsheet-derived Type/Customer classification
  is still evolving (see the Type-gating policy in §5).

---

## 9. Current state (as of this log)

- Both apps run locally: App 1 on port 3010, App 2 on port 3011.
- App 1: 228 jobs in DB (226 shown with valid Type, 2 hidden-but-preserved
  legacy rows), live sync buttons for TotalETO jobs/hours, Power BI actual
  hours, and Power BI quoted hours/cost.
- App 2: real Execution Rates, Category Pools (confirmed matching sheet
  totals), Monthly Snapshot workflow, restricted to Dan + Lisa via
  `AllowedUser` allowlist.
- Auth: temporary passwords set for testing (`abhikamuju36@gmail.com` on App
  1; Dan on App 2) — **real password resets still needed before handoff to
  actual users.**
- No production hosting yet — both run via `npm run dev` locally.

---

## 10. Data-accuracy audit, corruption fixes, and production hardening (2026-07-14)

A full-day accuracy audit against the real manager-signed workbooks
(`Old ETC Sheets/` and `old standard sheets/` — April/May/June 2026
snapshots), followed by end-to-end testing that found and fixed four distinct
historical-month corruption vectors. Summary (full detail in the session
memory files under `reopen-run-report-corruption-fix` and friends):

### Data corrections
- **June 2026 ETC** had drifted (163 wrong cells, one job's data missing, two
  unreviewed jobs' quoted costs injected) because Power BI hadn't archived
  June yet and a test submission froze live/suggested values. Rebuilt
  April/May/June `EtcEntry` from the workbooks' `ETC Export`/`Managers Fill
  Out` tabs — verified 0 mismatches per month afterward.
- **Standard Fees.xlsx itself was found stale** (its per-job Execution ETC
  VLOOKUP never refreshed — byte-identical across 3 months). The app's live
  computation was correct; froze `StandardSheetSnapshot` for April–June from
  it, pulling per-job Contingency (the one live column) from the workbook.
- **CategoryPool history** verified against Power BI's `Standard Fees` archive
  (0 mismatches, 2025-10…2026-03). 2025-06's `needsReview` migration oversight
  fixed. July 2026 started via the real workflow (carry-forward verified).

### Corruption vectors found by testing, all fixed
1. **Run Report on a reopened historical month** re-seeded/pruned it against
   TODAY's job roster and actuals (proven: 42 real entries deleted, 62 wrong
   ones injected). → `isSafeForLiveEtcSync` guard (`etc.ts`); Run Report and
   Clear ETC now refuse any month but the single current one.
2. **Submit and Lock on a reopened historical month** pruned entries for
   since-completed jobs (366→323 rows, proven live). → `getEtcMonthJobWhere`
   renders historical months from their own entries even while unlocked;
   `submitMonth` never prunes historical months.
3. **Empty New ETC inputs on resubmit** were replaced with recomputed
   suggestions, erasing manager overrides. → historical `submitMonth` keeps
   stored values when inputs are empty/missing.
4. **The grid auto-fill seeded zero-worked cells with Prior ETC** (and blank
   for worked cells), so a no-touch UI resubmit posted wrong overrides (135
   cells at risk in April; ~120 corrupted once, restored). → `EtcSectionCells`
   /Parts Cost inputs seed from the stored confirmed value on historical
   months (`initialConfirmed`); reopen+resubmit proven a true no-op through
   the real `submitMonth`.

### Other hardening in this batch
- `StandardSheetLive` crashed on month switches (state seeded once from
  props; different month = different job set → `rates[jobId]` undefined).
  Fixed with safe fallbacks + backfill effect, AND at the root: both grids
  now remount per month (`key={month}`), which also fixes stale typed values
  surviving soft navigation in the ETC grid.
- Historical sync (`sync-etc-history.ts`) now detects months that are locked
  in-app but have since gained a real Power BI archive, and flags them in the
  audit log (`monthsOwnedWithPbiHistoryNow`, pools too) instead of silently
  trusting a premature lock forever.
- `middleware.ts` → `proxy.ts` (Next 16 deprecation); auth gating verified
  intact (307 to /login, /brand + /login still open).
- Audit Log gate brought up to the Standard Sheet gate's standard: refuses
  the default password in production, HMAC unlock cookie, constant-time
  compares.
- `?month=` params validated on /etc and /standard-sheet; all Standard Sheet
  month actions go through one validating choke point, so a crafted month
  can never freeze snapshot rows under a garbage key.
- `.gitignore` now excludes the local `.xlsx` source workbooks and design
  folders (company financial data stays out of the repo).

### Test coverage added
- `tests/etc.test.ts` grew to 23 tests: `isSafeForLiveEtcSync`,
  `hasPublishedHistory`, `groupStandardFeesRows` regression suites.
- One-off (not committed) harnesses exercised every server action against the
  real DB with request-scoped bits stubbed — 37/37 checks passed (validation,
  guards, writes, cleanup) — plus data-helper edge cases and a full
  reopen→submit round-trip through the real `submitMonth`.

### Known remaining gaps (deliberate, documented)
- `ExecutionRate` is not month-scoped: editing a rate affects the open
  month's live view (frozen snapshots immune). Schema change deferred.
- June 2026 has no independent source of truth until Power BI archives it —
  treat as provisional; "Sync History" will flag it when the archive lands.
- Cost Actual Historical stays frozen at migration values (no verified
  Power BI measure) — unchanged policy.

---

## 11. Standard Sheet consolidated into the Monthly ETC page (2026-07-15)

The separate `/standard-sheet` tab (App 1's confidential Standard Fees view)
was **retired** and its entire workflow folded into the Monthly ETC page's
password-gated Standard view. Committed as `27fb135`, `60a304d`, `64f5bc3`.

### Hidden entry point
- The Standard Sheet password box no longer appears on `/etc`. It renders only
  with a secret `?standards=1` flag, reached by **clicking the "Monthly ETC"
  sidebar item three times** (≤1.5s window). The real security is unchanged —
  the HMAC unlock cookie in `standard-sheet-gate.ts`; this only hides the door.

### Global execution rates (was per-job)
- The per-job ENGR/Shop/Parts rate columns were removed. Rates are now a single
  **global** set entered via an **"ETC Rates"** toolbar button, stored on the
  `StandardSheetSetting` singleton (migration `add_global_standard_rates` added
  `engrRate`/`shopRate`/`partsMarkup`; `contingencyRate` already lived there and
  joined the same popover). Applied to every job on the page.
- **Semantic shift to confirm with Dan/Lisa:** historical per-job rate
  exceptions (the sheet's orange overrides) are no longer applied — every job
  freezes at the global rate.

### Grid layout changes
- Column order in the grid: **Total (New ETC) now precedes Parts Cost**.
- The inline Standard block dropped its Eng/Shop/Parts ETC columns; it now runs
  Total ETC · % Total | Standard Fees | Contingency | Total Std Fees | Notes,
  with the sheet's heavy gray dividers between each block.

### Standard Fees By Department panel + full workflow on /etc
- A **side panel** next to the grid shows the department pool block, with the
  same carry-forward fallback the old tab used (also now applied to the inline
  fee math, so the two never disagree / collapse to $0).
- The panel is **editable** (Hours pulled + Rate) and hosts **Refresh Pools**
  (Power BI), **Save Pool Cells**, **Submit & Lock**, and **Reopen** (admin).
- Per-job **Contingency $ and Notes** are editable inline (autosave, one server
  action per field so neither clobbers the other).
- The month **freeze** (`submitStandardSheetMonth`) now stamps the **global**
  rates instead of per-job `ExecutionRate` rows. A **submitted month renders
  the frozen snapshot inline** (`StandardRatesProvider` `frozenRows`), immune to
  later rate/pool edits — the freeze-integrity guarantee the tab had.
- All actions moved to `src/lib/standard-sheet-actions.ts` (revalidate `/etc`).

### Deleted
- `/standard-sheet` route (`page.tsx`, `layout.tsx`) and the now-dead
  `StandardSheetLive`, `MonthSelect`, `ExecutionRateInput`, and
  `saveExecutionRateField`. Nav tab removed from the sidebar.

### Not yet done / caveats
- **Not verified live** — the migration touches the financial freeze but the dev
  preview can't authenticate past the external login, so the end-to-end
  Refresh→edit→Submit→Reopen flow still needs a real user pass before trust.
- `StandardSheetSnapshot` still carries per-row `engrRate/shopRate/partsMarkup`
  columns; they now just hold the global value for every row.

---

## 12. Hours sync taken off Microsoft Graph; dead schema removed (2026-07-31)

### The symptom, and why it was misread at first
A manager reported the Monthly ETC KPI card and its own drill-through
disagreeing: the Engineering card read 2,087 while the punch table beneath it
totalled 2,079. The two read different tables — the card sums
`EtcEntry.hoursWorked`, the drill sums `JobHoursDetail` — so an 8-hour gap
looked like a two-table consistency bug.

It wasn't. Pulling the source fresh and comparing both against it showed the
real picture:

| 2026-07 | Engineering | Shop |
|---|---|---|
| Source of truth (fresh pull) | 2368.85 | 2526.38 |
| `EtcEntry.hoursWorked` (the card) | 2086.54 (−282.31) | 2396.28 (−130.10) |
| `JobHoursDetail` (the drill) | 2082.02 (−286.83) | 2402.62 (−123.76) |

Both were stale by ~280h and ~125h. The 8-hour disagreement everyone was
looking at was noise next to a 280-hour error neither number revealed. Lesson
recorded because it nearly sent the fix in the wrong direction: **when two
figures disagree, check both against the source before assuming one is right.**

### Root cause: the same session-0 wall, again
Every sync had been failing since 2026-07-30 08:50 EDT with the DPAPI
token-cache error from §"GRAPH-APP-ONLY-SETUP" — the identical failure that
silently killed 2026-07-24..29. The delegated token cache is DPAPI-encrypted
`CurrentUser` and cannot be decrypted by a PM2 process in Windows session 0.

Re-running `sdc-powerbi-mcp.exe login` does **not** fix it. Proven, not assumed:
the recon scripts queried both Graph and Power BI successfully from an
interactive shell using that very cache, while PM2 kept failing. The credential
was always fine; the consumer was in the wrong session.

Everything user-session-bound fails identically here, which is worth stating
once so it stops being re-litigated: the DPAPI cache, a WebDAV-mapped drive
(invisible to session 0), and unpinned OneDrive placeholders (they hydrate only
via the client in an interactive session). Only app-only auth or a genuinely
materialised local file works.

### The fix
The SharePoint library is synced to disk by OneDrive, so the same export exists
as an ordinary file. `fetchJobHoursRows()` now prefers `JOB_HOURS_LOCAL_PATH`
and falls back to Graph when it is unset or unreadable. Reading a file needs no
token, so it works in session 0 — **and needs no Sites.Selected admin consent**,
which had been the blocker.

Verified through the app's own code path: 12,821 rows in ~950ms, 2026-07
Engineering 2368.85 / Shop 2526.38 — zero delta against the Graph download it
replaces.

**The folder must stay pinned "Always keep on this device."** Unpinned it is a
Files-On-Demand placeholder (`OFFLINE + RECALL_ON_DATA_ACCESS`) and a service
cannot hydrate it. Check with
`[int](Get-Item -LiteralPath $p -Force).Attributes -band 0x80000`.

This is a stopgap that removes the *urgency* of the app-only grant, not a
replacement for it. It trades an auth failure for silent staleness: if the
account logs off, OneDrive stops syncing and the file quietly ages — the same
failure class it fixes. `readLocalWorkbook()` warns past 24h, but console-only
warnings are exactly what failed twice already (see "still open" below).

### Also verified while in there
`scripts/_recon_july_2026.ts` had never actually been runnable from the CLI — it
died on a missing `dotenv/config` before reaching any comparison. Fixed. It now
confirms the off-Power-BI transforms still reproduce Power BI exactly for
2026-07: hours **141/141** job/section rows, parts **49/49** app-tracked jobs.

### Auto-sync cadence: 10 minutes -> 6 hours
The export refreshes on a daily-ish rhythm, so a 10-minute poll re-downloaded
and re-parsed a ~14k-row workbook ~144×/day for the same data. Note the trade:
a failed sync now waits 6 hours to retry rather than 10 minutes, and there is
**no retry policy** — the interval is happy-path spacing only.

### Dead schema removed
Each verified empty AND unreferenced immediately before the migration:

- `ActualHours` — superseded by `JobHoursDetail` (adds `workDate`) and
  `JobMonthlyActualHours`. Its FK to `Employee` was actively wrong for this
  data: punches are keyed by raw Paylocity id *because* some ids have no roster
  row (leavers — 2 of 69 on 2026-07-30), and a hard FK would reject exactly
  those rows.
- `FeeAllotment` — see §8.
- `StandardFeeSnapshot` — a month-level total that is a SUM over
  `StandardSheetSnapshot` (93 live rows).
- `powerbi-refresh.ts` — zero importers since live data moved off Power BI.
- The `PowerBiFreshness` row `source = 'dataset_refresh'`, written by that
  module and read by nothing. It sat on
  "Failed: ModelRefreshFailed_CredentialsNotSpecified" since 2026-07-19 and
  read as a live incident; it was only the last trace of a removed module. The
  ETC header only ever reads the `hours_actual` row.

Kept on purpose: `ProjectRelease`, `saved_views`, `StandardSheetSetting` are
empty but have live code behind them — shipped features nobody has exercised
yet, not dead weight.

### Phantom hours — found in the post-deploy audit, fixed same day
With the sync healthy again, stored hours were compared row-by-row against a
live pull. Three rows disagreed, two of them substantively:

```
1104::10-211   stored=8.00  live=0.00   Andi 1 & Andi 2 Replacement Line
1145::10-412   stored=1.68  live=0.00   Primary Packaging Load Automation
1161::10-312   stored=0.23  live=0.22   (10-311 split rounding)
```

`syncHoursWorked` looped only over keys **present in the export**, so a
(job, section) whose hours moved away upstream — a booking reassigned to
another job, or deleted — was never revisited and kept its last synced value
indefinitely. The rule "Hours Worked always reflects the source" was only ever
enforced in the direction of hours *appearing*.

Small in absolute terms (9.68h against ~4,700), but one-directional: the error
can only inflate, and it compounds every month it goes uncorrected.

Fixed with a second pass that zeroes pending rows absent from the export.
**Guarded on `spentByKey.size > 0`** — that map is empty when the rolling
window has moved past the month or the fetch returned nothing usable, and
zeroing on that basis would wipe the month wholesale. Absence of the month from
the export is not evidence nobody worked; it is evidence the export cannot
answer the question. Submitted rows (`needsReview: false`) and `PARTS_COST`
(dollars, owned by `syncPartsCost`) are both excluded.

Dry-run before applying showed exactly the 2 expected rows, 1.2% of pending —
a large percentage there would have meant the export was wrong, not the
database. After applying, stored vs live agrees to 0.01/−0.02, which is the
10-311 split's rounding floor.

### `recordHoursSyncFailure()` silently failing — root-caused and fixed
Every sync failure logged to the console, yet `hours_actual` kept
`status=null`. The cause, proven by replaying the exact write:

`status` was `varchar(191)` (Prisma's MySQL default for `String?`), while the
function writes `` `Failed: ${message.slice(0, 300)}` `` — up to 308 chars. The
real DPAPI message is ~440 chars, so **every** failure threw
"The provided value for the column is too long for the column's type" — and the
bare `catch {}` swallowed it.

So the one mechanism built to make stale data visible was itself silently
broken, by a `catch` that hid its own failure. Both halves fixed: the column
widened to `@db.Text`, and the catch now logs. A diagnostic field must never be
the thing that fails to record a diagnosis, and an error handler that cannot
report its own errors is not a handler.

### Hours booked to non-job values — now reported instead of vanishing
`String(Number("Not Defined"))` is `"NaN"`, and the importer wrote that straight
into the job id, producing rows that matched no `Job` and disappeared with no
trace. Non-numeric job values are now counted and skipped explicitly, with a
warning naming each one.

The first run of the fixed importer counted **every** rejected row and reported
~2,251h across the 7-month window. That figure was wrong — or rather, it
answered the wrong question. It included time on sections the ETC grid does not
track at all (PM 10-111, Manufacturing 10-413, the Warranty phase), which is
absent from the grid whether or not its job number is valid. Counting it as
"lost to a bad job number" overstated what fixing the job number would recover.

Now scoped to rows that would OTHERWISE have been imported:

```
2026-07 alone : "Not Defined"  170.77h across 56 entries
all 7 months  : 535.30h across 7 month/label combinations
```

That 170.77h for July reconciles exactly with the independent gap analysis run
earlier the same day, which found 170.77h attributable to `NaN` job ids across
10-211/10-312/10-313/10-411 — two different measurements agreeing to the
hundredth.

The `SERVICE` variants (`"2026 SERVICE"`, `"2025 SERVICE"`, `"2023_SER"`) look
like job *names* typed where a number belongs — job 10001 is literally named
"2025 Service" — so those may be recoverable by mapping, unlike "Not Defined".
This is an upstream Paylocity data-entry problem, not a code bug; the code's
only fault was hiding it.

### Both remaining gaps closed
`syncHoursWorked` now keeps its own freshness record under source
`etc_hours_worked`, separate from `hours_actual`. The separation is the point:
`syncActualHours` can succeed and stamp the feed healthy while this step throws,
leaving every Hours Worked cell stale behind a header that says the data is
current — which is exactly what happened through 2026-07-30. It deliberately
does NOT stamp on the locked-month early return, since doing nothing because a
month is frozen is correct behaviour rather than a fresh sync, and claiming
currency there would be a lie by omission.

Rejected rows are persisted to `HoursImportIssue` and surfaced on the Monthly
ETC page as an amber banner naming each label for the displayed month. Replaced
wholesale each sync, so a label corrected upstream disappears here too.

### Still open
- **Nothing watches the OneDrive copy's age** beyond a console warning.
- **Pre-2026-01 hours cannot be regenerated.** `JobHoursDetail` starts at
  2026-01 because the export is a rolling window; the 1,148 older
  `JobMonthlyActualHours` rows came from Power BI, which is no longer pulled.
  That history exists only as previously-imported rows — worth backing up.
- **EtcEntry has no 2025-07 or 2025-08.** Months run 2025-06, then jump to
  2025-09. Unknown whether they never existed or were lost.
- **Jobs have no live source** — all 234 are `migration` (228) or `manual` (6).
- App-only Graph (`GRAPH_*` + Sites.Selected) remains the durable fix.

### Added
- `scripts/etl_job_hours.py` — standalone Excel -> MySQL loader (app-only Graph
  or `--file`, with `--month` / `--dry-run`). Transform mirrors
  `sharepoint-hours.ts` rule for rule and independently reproduces the same
  totals. Writes `JobHoursDetail` **only** — the grid and KPI figures come from
  `EtcEntry.hoursWorked` via `syncHoursWorked()`, so it alone would fix the
  drill and leave the headline numbers frozen.
- `scripts/_recon_kpi_vs_truth.ts` — compares both tables behind the KPI cards
  against a freshly fetched source. This is what produced the table above.

---

## 13. The Prior ETC carry-forward, and the drafts derived from it (2026-08-04)

Reported as two complaints one morning: *"why is the New ETC filled out for
parts for July?"* and *"June isn't saved correctly, the Prior ETC for July isn't
correct still."* One cause underneath both — **July's Prior ETC was frozen at
figures that later moved, and the New ETC drafts derived from those figures were
frozen with it.**

### What actually happened, from the audit log

```
16:32  etc.submitMonth 2026-07   Submitted 457 entries      -> July LOCKS
16:37  etc.submitMonth 2026-06   "carry-forward stopped at locked month 2026-07"
16:38  etc.reopenMonth 2026-07   Reopened
```

`cascadePriorEtcForward` was right to stop: rewriting a submitted row is the
July-2026 history-corruption bug (§10). But stopping is only half an answer. The
month it stopped at was left holding a Prior ETC derived from a June that had
just changed underneath it, and **reopening did not re-derive anything** — so the
manager was handed the stale opening balance to plan against. 16 hours cells were
wrong, in both directions (1122's three sections were 120 short, 1104's were
carrying 40/8/8/80 that June had since confirmed to 0).

### And a second, independent balance reset in the parts column

`syncPartsCost` looked only at `previousMonth(month)` for a job's parts balance,
falling back to the job's Parts Cost Quoted when it found nothing. That is the
exact bug `latestPriorEtcByKey` was written to fix for hours (see the note on
job 1104 there) — still live on the money side. A job with **no parts row in the
immediately preceding month reopened at its full original quote:**

| Job | Parts balance actually worked down to | July opened at |
|-----|---------------------------------------|----------------|
| 1105 | 0, confirmed May 2026 | **$636,234** |
| 979  | 0, confirmed April 2026 | **$8,600** |

$644,834 of phantom parts budget, on the page, in the totals, and in the
Standard Fees dollars downstream of it.

### Why the New ETC column was filled with figures nobody typed

`saveAllNewEtcDrafts` persists whatever the New ETC box *contains*, and on a
zero-spend cell the box arrives pre-filled with the carry-forward. Job 979's
parts cell was saved at 11:02 while its Prior ETC was still 0 — a draft of 0,
correct at that moment. A later Refresh moved the Prior to $8,600 and the stale 0
stayed, so the cell read "spend nothing, plan nothing" over a live balance, and
Submit would have written the 0 into history. 1159 was the same at $25,000.

A draft is supposed to record a manager's judgement. A figure the server put in
the box is not a judgement, and it must not outlive the number it came from.

### The fixes

- **`priorEtcForMonth`** (lib/etc.ts) — the one rule for what a month opens at:
  a carried balance from the LATEST earlier month wins over the quote, a carried
  **zero** still wins (the job finished; it did not restart), no history at all
  falls back to the quote, and a job whose Start Date is in the month opens at
  its quote regardless. `seedMonth`, the cascade, `reopenMonth` and
  `syncPartsCost` all call it now, so the four cannot disagree.
- **`redrivenDraft`** (lib/etc.ts) — a draft that merely echoes the suggestion
  computed from the OLD Prior ETC moves when that Prior moves. Exact-match only:
  a draft off by a cent is a manager's own number and is never touched.
- **`lib/etc-prior-etc.ts`** — `derivePriorEtcForMonth` extracted as the single
  writer of the column, and `cascadePriorEtcForward` reduced to a walk over it.
  This is also what gave the cascade the starts-this-month rule it never had:
  it would have walked jobs 1159/1160 back down to the 0 their pre-quote June
  rows carried, undoing `repair-july-start-prior-etc.ts`.
- **`reopenMonth` re-derives on the way back in.** Reopening is precisely the
  moment those rows become unsubmitted and therefore safe to touch, which closes
  the gap the cascade's stop-at-locked rule leaves open. Then it walks forward,
  since later months can be stranded the same way.

### The data repair

`scripts/repair-july-2026-carryforward.ts` (dry-run by default) applied the same
result to the rows that were already wrong, through the shared writer so the
script cannot drift from what a reopen does: 22 Prior ETC re-derived, 2
carry-forward drafts restored. July's 458 rows now agree with the rule on every
one, and a second run is a no-op.

Worth recording: 13 of July's zero drafts were left alone deliberately. They had
been flagged as suspicious ("an explicit 0 over a non-zero Prior"), and they
turn out to have been **right all along** — it was the Prior ETC above them that
was stale-high. Fixing the Prior made the 0s correct rather than the other way
round.

### Still open
- **Parts Cost New ETC always shows a figure** on a reopened month, and Clear ETC
  skips the column (both by request, 2026-08-03). That is why the column reads as
  filled while every hours cell beside it is blank. It is a decision, not a bug,
  but it is the thing that makes the column look wrong at a glance.
- **Save still hardens an untouched seed into a draft.** `redrivenDraft` now
  keeps such a draft honest as its inputs move, which removes the damage; not
  writing it at all would be better still, but the server would have to
  reconstruct the exact seed the page rendered to know the box was untouched.
