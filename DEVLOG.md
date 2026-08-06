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

### Parts Cost New ETC stops auto-filling (2026-08-04, later the same day)

Requested directly: *"Do not automatically fill the New ETC cells when there is a
value in the Money Spent Month column. Instead, highlight those cells in yellow so
managers can enter the values manually, just like they do for the hours cells."*

This withdraws the 2026-08-03 request in the "Still open" list above. The two are
the same question asked from opposite ends — **is a dollar estimate carried over
from last submission an answer, or a starting point?** — and the answer is now the
one the hours columns already gave: money spent means the next figure is a
judgement nobody has made yet.

The implementation is the removal of a single flag. `reopenAsksAgain` was
introduced the day before specifically to exempt Parts Cost; every caller now
leaves it at the default, so `precision` ("exact", because dollars keep their
cents) is the only thing still separating a Parts Cost cell from an hours cell.
One flag, and all four behaviours followed it back: the yellow, the clearability,
the count on the Clear ETC button, and what Clear ETC actually writes.

Unchanged, deliberately: **a cell with NO money spent still carries the balance
forward on its own and reads as neutral.** `isNewEtcCellDecided` returns true on
zero spend, so nothing was needed for that half — and it is the half worth
keeping, since there is no judgement to make when nothing moved.

Diff was already right for this. It prints "—" rather than $0 when nothing is
decided (a $0 would read as "on plan"), and the row's own Diff cell repaints from
the live store as the manager types — that was the fix in `e046db6`, which turns
out to have been the groundwork for this one.

`scripts/clear-parts-cost-new-etc.ts` applied the new rule to the values the OLD
rule had already put in July's boxes: 39 cells cleared, all of them auto-seeds
(draft identical to the confirmed figure — not one had been typed), 15 zero-spend
cells left carrying forward, 0 decisions touched. Column-scoped rather than a
click of Clear ETC, because that button would also have swept the hours cells
holding today's in-progress work. Same rule, same fields, same audit trail, so any
figure can be read back out of the log.

---

## 14. Saved values invisible to other users (2026-08-04)

Reported as *"When I change a value in any cell, other users are not seeing the
updated value — the issue appears across all tabs."* Two independent causes, and
the dangerous one was not a display problem at all.

### The leading theory was wrong, and it is worth recording why

The obvious suspect was the `revalidatePath` calls removed from the hot save paths
on 2026-08-03 for speed. **Re-adding them would have fixed nothing.**

- Every route in this app is DYNAMICALLY rendered. `app/(app)/layout.tsx` awaits
  next-auth's `auth()`, which reads cookies, forcing the whole `(app)` group
  dynamic. The production build agrees: only `/login` and `/_not-found` are static.
- Nothing uses a Next server-side cache — no `unstable_cache`, no `"use cache"`, no
  route-segment `revalidate`, and `fetch` is uncached by default in this version.
  Every page reads through Prisma, which is outside Next's caching entirely.

So there was never a stale server cache to invalidate. Every `revalidatePath` call
in the codebase is, server-side, a no-op; its only real effect is to make the
calling action's own response carry a fresh render **for the caller** — which is
exactly why the person saving always saw their own change and nobody else did.

### Cause 1 — one tab silently reverted another (the data loss)

The Monthly ETC grid is one `<form>`, autosave posted `new FormData(form)` — all
~450 New ETC cells — and the server decided what had changed by comparing each
posted value against the **database**. A second manager's page-load values
therefore read as deliberate edits and were written. The next time they typed
anywhere in the grid, their snapshot went back over every cell the first manager
had saved since. And their client re-baselined from its own posted FormData, so
that tab never self-corrected.

The colleague's value was not stale on screen. **It was deleted from the database.**
That is why it looked permanent rather than like a refresh problem.

`/quoted` had the same shape via `MoneyCell`: `raw` came from `useState` (mount-time,
frozen) while `data-baseline` re-stated the live server prop every render, so a
colleague's change moved the baseline, the cell read as "edited", and the stale
value was posted back over them.

### Cause 2 — nothing ever asked the server again

No polling, no websocket, no refetch-on-focus, and no save path calling
`router.refresh()`. A page was a photograph taken when it loaded. This is the "all
tabs" half, and it is uniform across all eight pages.

### Cause 3 — the cells could not have shown a fresh value anyway

Every editable cell held its value in `useState(initialValue)` and never re-synced.
`router.refresh()` is documented to preserve `useState`, so even a perfectly fresh
payload left the box showing its birth value. The only remount trigger in the app
was `key={month}`.

### The fix — three rules, one mechanism

1. **Post only what this user touched.** `changedEtcFormData` (etc-dirty-tracker)
   sends the dirty cells and nothing else. The server already treated an absent
   field as "leave it alone" — that was always the contract; the client was ignoring
   it. This mirrors what `/quoted` had done since 2026-08-03 for performance; same
   rule, now for correctness.
2. **Refuse a stale write.** Every changed cell also declares the value it believed
   was stored (`newEtcBase__*` on ETC, `__base__*` on Projects). If the database has
   moved since, the write is refused, audited, reported to the manager, and NOT
   re-baselined — so the cell stays dirty and the chip cannot claim it saved.
   `isStaleDraftWrite` (lib/etc.ts) and `beliefIsStale` (quoted-actions) are the
   shared rules. This is what holds even against a tab running an older bundle.
   `submitMonth` gets the same treatment: for a cell the manager did not touch it
   prefers the stored draft, because Submit writes *confirmed history* and a stale
   snapshot frozen there is not something a later save can put right.
3. **Converge.** `components/LiveRefresh.tsx`, mounted once in the `(app)` layout,
   calls `router.refresh()` on focus/visibility and on a 45s interval while visible
   (hidden tabs do nothing; suppressed while a save is in flight or a grid has
   unsaved typing). The cells then **adopt** a changed server value only when the
   box still holds exactly what the server last sent — so a colleague's figure
   appears, and this user's own unsaved edit is never touched. Adopting also moves
   the dirty-tracker baseline, or the adopted cell would read dirty, get posted, be
   refused, and report a phantom conflict on a cell nobody edited.

### Performance

The property the 2026-08-03 work bought is kept: the draft save still does no
`revalidatePath`, so a keystroke is ~10ms of writes and no render. The full-month
render now happens at most once per 45s per *visible* tab.

### Also fixed, found by the review pass

- Comparing the stale-write guard at 2dp while the hours cells seed from
  `Math.round(n)` would have called a fractional stored draft a conflict — refused,
  blamed on a colleague, unrecoverable. It now compares at the precision the cell
  displays. (0 fractional drafts in the data today; reachable by typing 93.5.)
- The Standard Fees block (pool Hours Pulled / Rate, Contingency, Notes) was missed
  in the first pass and would have been the one stale patch on the page.
- Typing in a Parts Cost cell scheduled **no autosave at all** — the delegated
  listener matched on field name and that input has none (the name is on the hidden
  input beside it). It opts in by `data-etc-autosave` now.
- A refused cell stays dirty by design, which would have deadlocked that tab's
  background refresh forever. Refusals are tracked separately and excluded from the
  refresh interlock (`hasUnrefusedEtcEdits`) while still counting as unsaved work.

### Still open

- `/quoted`'s plain text/date/enum cells are uncontrolled inputs: once a user has
  typed in one, the DOM's dirty-value flag stops it tracking the server prop, so the
  display cannot adopt in place. The server-side `__base__` token is what protects
  the data there, and it is in place — but the *display* of such a cell stays stale
  until reload.
- Verification with two real signed-in users is still outstanding.

---

## 15. Realtime collaboration: presence, change feed, cell history (2026-08-04)

Four items from the enhancement spec, in dependency order.

### §13 — why the bottom totals were not updating

Not the live-totals store, which was working. `Total New ETC` in the footer was
wrapped in `monthComplete ? … : "—"` in four places, and `EtcLiveTotals` reproduced
the same gate — so on any month whose Paylocity actuals were not yet through
month-end, every New ETC total rendered a dash, **and no amount of typing could
move a dash.**

The gate is right on a CELL (it stops a partial figure looking final — see
`newEtcSeedText`) and wrong on a TOTAL, whose whole contract is to equal the sum of
what is displayed above it. Removed from the four total cells and from the repaint;
`EtcLiveTotals` no longer takes the prop at all.

### §6 — cell-level change history

`AuditLog` gained nine columns (`userName`, `tab`, `rowRef`, `columnName`,
`previousValue`, `newValue`, `changeType`, `appVersion`, `changeId`) plus a
composite index on `(tab, rowRef, columnName, createdAt)`. They were in `metadata`
JSON before, which reads fine in a log viewer and is useless for the thing actually
asked for — "review the history of a specific cell" — because you cannot index a
JSON blob by column name in MySQL without a generated column per field.

Migration `20260804134505_audit_cell_change_fields`, additive only (nullable columns
+ indexes), applied online. **`prisma generate` could not run** — the production
process holds `node_modules/.prisma/client` open (EPERM), which is the documented
deploy dance for this app. So `lib/change-log.ts` writes through a parameter-bound
`$executeRaw` rather than the typed client: it works against the schema as it
actually is, does not wait for a deploy window, and is a reasonable permanent shape
for an append-only log. Verified end to end against the live table.

`recordChanges()` is the ONE place a cell change is recorded. It writes the audit
rows AND publishes to the realtime hub, deliberately in one function — a change
that is announced but not recorded (or the reverse) is what makes an audit trail
untrustworthy. Wired into `saveAllNewEtcDrafts`, including the REJECTED writes, so
a refused stale write is in the history too.

### §3 + §5 — presence and the change banner

A new subsystem, not a change. Architecture:

```
browser ──POST /api/realtime/presence──▶ realtime-hub (in-process)
browser ◀─SSE /api/realtime/stream──── realtime-hub
                                            ▲
                          recordChanges() ──┘   (publishChanges)
```

- **`lib/realtime-hub.ts`** — one in-process fan-out. Presence is a map keyed
  `session::cell` with a 30s TTL swept lazily; change events broadcast to every
  subscriber. Presence is sent as a WHOLE SET rather than deltas, because a client
  that missed a delta would show a colleague editing a cell they left ten minutes
  ago, and a stale "someone is here" is worse than none.
- **`app/api/realtime/stream/route.ts`** — SSE. 20s comment pings (this network's
  proxies close idle connections), `X-Accel-Buffering: no`, and `cancel()` releases
  the session's cells immediately rather than waiting out the TTL.
- **`app/api/realtime/presence/route.ts`** — `enter` / `leave` / `leaveAll`. The
  display name comes from the SESSION, never the request body, so a client cannot
  claim to be somebody else.
- **`components/RealtimeProvider.tsx`** — one EventSource per tab, module-scope
  stores read through `useSyncExternalStore`, exponential-backoff reconnect, and
  `sendBeacon` on `pagehide` so a closed tab releases its cells. Identity is
  per-TAB (`sessionStorage`), so one manager with two windows is two editors.
- **`components/CellPresence.tsx`** — the marker, absolutely positioned so it cannot
  resize a 64px cell. Initials + count, full sentence in the tooltip.
- **`components/ChangeNotifications.tsx`** — the banner. A stack (queued, not
  replaced), capped at 4 on screen with a "+N more", `pointer-events-none` on the
  container so it cannot swallow clicks meant for the grid, and an offline notice
  that is careful to say edits are still being saved.

Spec 3 lists five ways an indicator must clear — left the cell, saved, cancelled,
disconnected, went inactive. The first three are one `leave` signal, the fourth is
the subscription ending, the fifth is the TTL plus the client not beating while the
tab is hidden. All five have tests.

**The load-bearing assumption, stated loudly:** the hub is in-process, which is only
correct because `ecosystem.config.js` runs ONE non-cluster instance. Add
`instances: 2` and presence silently partitions — users would see only the
colleagues who landed on the same worker. `realtime-hub.ts` logs a hard error if
`NODE_APP_INSTANCE` is anything but 0, and the interface is narrow so the swap to
Redis pub/sub touches that one file.

`import "server-only"` is deliberately NOT used on the hub: it is a Next build-time
alias with no package behind it, so it makes a module untestable with this repo's
`tsx --test` runner (which is why the gate modules have no tests). A runtime
`typeof window` throw is stronger for our purposes — it fails just as loudly if the
module is ever bundled to the browser, and it let the 14 concurrency tests exist.
One of them immediately found a real gap: `subscribe()`'s two initial frames were
not guarded the way `broadcast()`'s are, so subscribing over an already-closed
stream would throw into the route handler.

---

## 16. The yellow cell, and clearing a value (2026-08-04)

Two reports, one root cause each, both about the same column — the New ETC cells on
Monthly ETC (hours) and Parts Cost (dollars).

### 16.1 "Cells stay yellow even when they already contain a value"

Yellow means "somebody has to type something here". It was computed by
`isNewEtcCellDecided`, and that function was answering TWO questions at once,
because Clear ETC had been scoped off it:

```
decided = hasValue && !(reopened month && the value equals what was submitted)
```

The second clause is right for Clear ETC — that button exists to empty exactly the
cells still carrying last submission's figure — but as a COLOUR rule it means every
cell on a reopened month renders yellow with a number sitting in it. Which is what
was reported, and it is a fair complaint: yellow is an instruction, and those cells
were not asking for anything.

Split into two predicates in `lib/etc.ts`:

- **`isNewEtcCellDecided`** — the colour, and nothing else:
  `yellow ⇔ isNewEtcDecisionRequired(state) && !hasNewEtcValue(text)`. A decision is
  required when hours (or money) were booked this month; blank is null/undefined/
  empty/whitespace. **0 and "0" are values** — a section planned at zero has been
  answered, and `hasNewEtcValue` is now the one place in the app that draws that
  line.
- **`isNewEtcCarriedFromSubmission`** — what Clear ETC acts on. Identical logic to
  the old second clause, so the SET of cells the button empties is unchanged; it
  just no longer picks a background colour. `isNewEtcClearable` is built on it.

Both read the LIVE input text, which is what makes the colour honest with no save,
refresh or remount: it clears on the keystroke that fills the cell and returns on
the keystroke that empties it. Clear ETC's own copy stopped describing its targets
as "the yellow cells", because they are not yellow until it has run.

### 16.2 "I cleared a value, saved, refreshed, and it came back"

Three bugs wearing one coat, all of them the same missing distinction: a New ETC
that is empty because nobody filled it in, versus one that is empty because
somebody emptied it.

1. **An empty posted field had no agreed meaning.** `saveAllNewEtcDrafts` compared
   the posted value against the stored DRAFT and skipped when they matched. A
   cleared cell posts `""` → next draft `null`; and on the two cases that matter
   most the stored draft was ALREADY null:
   - a reopened month (the box seeds from `newEtc`, the confirmed value)
   - a zero-hours cell (the box seeds from `priorEtc`, the carry-forward)

   `null === null` → `continue`. **The save wrote nothing at all.** Not a caching
   problem, not a refresh problem: the clear never left the browser.
2. **Even when the draft WAS nulled, the seed put the figure back.**
   `newEtcSeedText` falls through draft → confirmed → carry-forward, so nulling the
   draft alone re-rendered the removed number from the row's other columns.
   `newEtcClearedAt` already existed for exactly this (Clear ETC needed it), but a
   manual clear never set it.
3. **Create-cells dropped empties outright.** A cell for a section the job was never
   quoted for posts `newEtcCreate__<job>__<section>`, and keeps posting under that
   name until the page re-renders with the new entry id. `parseNewEtcCreateFields`
   skipped empty fields, so clearing a cell you had just filled in, in the same page
   session, wrote nothing.

The fix is one idea in three places:

- **`parseNewEtcField(raw)`** in `lib/etc.ts` — the single parse for every New ETC
  value arriving from a browser. Four outcomes, deliberately distinct:
  `absent` (not in the request — no opinion, leave the stored value alone),
  `clear` (present and empty — a real edit), `value` (a number, **0 included**),
  `invalid` (not a number this column takes — refused, never coerced to 0 and never
  silently replaced by the previous value). This is the rule that makes
  `if (value) save(value)` impossible to write here.
- **A clear writes both fields:** `newEtcDraft: null, newEtcClearedAt: now()`, with
  no condition on the draft having been non-null. The cell was showing a figure —
  that is why the user emptied it and why the field is in the payload — and where
  that figure came from is not something the save needs to know.
- **Create-cells get the same treatment** once a row exists behind them, including
  storing a typed `0`. A 0 still never CREATES a row (that is the backstop that
  stopped Submit timing out on ~350 empty cells on 2026-08-03).

Around the fix:

- **A clear is defended from an older save.** `isStaleDraftWrite` takes
  `storedCleared`: if a client believed a figure was stored and the stored null is a
  deliberate clear, that client predates the clear and its write is refused. Two
  users both clearing the same cell is NOT a conflict — they agree.
- **Removals are recorded and announced** like any other change, now for both field
  namespaces (create-cells were never in the change log before). The previous value
  named in the audit row is the stored draft, or — when there wasn't one — the figure
  the client declared as its baseline, i.e. what was actually on the manager's
  screen: `Abhi removed New ETC (Mech Gen) value 60 for 1165 in Monthly ETC`.
- **Invalid values are reported instead of vanishing.** `invalidFields` comes back to
  the client, which keeps those cells dirty (excluded from the re-baseline, so every
  unsaved-changes guard still covers them) and says so in a toast. Autosave marks
  them the way it marks refusals, so one uncorrectable cell cannot deadlock the
  background refresh.
- **Escape cancels an edit** (`ExcelCellFocus`), restoring the last value the SERVER
  sent. Cells declare it in `data-baseline` — the same attribute `lib/dirty-form.ts`
  already used — so this needed no per-grid wiring. Written through the native value
  setter plus an `input` event, or React would paint its own state back over it.

Delete/Backspace already cleared a cell (focus selects the whole value, so either
key empties the box) — what was missing was everything after the keystroke.

### What did NOT change, on purpose

- **Submit still resolves a blank cell to the suggestion.** `newEtc` is the confirmed
  figure for the month and cannot be null, so an empty box submits as
  `suggestNewEtc(prior, worked)` — which is what the cell's own tooltip has always
  said. On a zero-hours cell that is the carry-forward, so submitting a deliberately
  cleared zero-hours cell does re-confirm the prior balance. Clearing is a
  draft-state operation; the submitted column has to hold a number.
- **`effectiveNewEtc` still falls back to the suggestion**, so Total New ETC / Total
  ETC $ / Standard Fees answer "what would this month be if submitted as-is". Only
  DIFF reads a blank as zero. The totals do move the instant a cell is cleared —
  they just move to the suggestion, not to nothing.
- **`savePools` still treats a blanked Rate / Hours-Pulled cell as "keep the stored
  value".** Blank is not a valid state for those two (the schema is non-null, and a 0
  Rate collapses a department's Standard Fee to $0), so "cleared" has no meaning
  there. An explicit 0 is still saveable by typing it.

---

## 17. Performance: measured, then fixed (2026-08-04)

Reported as "the application feels slow and laggy — tabs take too long, filter
selections respond slowly, filter menus close unexpectedly, buttons do not react".

### 17.1 The baseline, before anything was changed

Two instruments, because the app has two very different halves.

**Database** — `scripts/perf-baseline.ts` (committed, re-runnable) times the actual
queries each tab performs, grouped into the *waves* the page awaits them in. A wave
costs its slowest member; waves are serial.

| Tab | queries | serial waves | critical path |
|---|---|---|---|
| Monthly ETC | 18 | 9 | 135ms |
| Projects | 5 | 3 | 144ms |
| Employees | 1 | 1 | 5ms |
| Audit Log | 2 | 1 | 57ms |
| Dashboard | 9 | 1 | 11ms |

**The database was not the bottleneck anywhere.** Nothing exceeded 144ms.

**Browser** (dev build, in-app browser, live data — 49 jobs / 438 entries):

| Measure | Before |
|---|---|
| Monthly ETC route render + payload | **613ms / 854 KB** |
| ETC DOM | 6,827 nodes · 4,150 cells · 1,180 inputs |
| Filter tick — checkbox visibly changes | **~800ms** |
| Tab switch, first visit (dev, includes compile) | / 103ms · employees 771ms · projects 1,502ms |
| Tab switch, revisit | ~101ms |
| Duplicate requests per navigation | none found |

So the slowness was never SQL and never (mostly) navigation. It was **how much work
one user action caused**, in three specific places.

### 17.2 Root cause 1 — a colleague's keystroke re-rendered your whole page

`RealtimeProvider` called `requestLiveRefresh()` on **every** change event. On Monthly
ETC that is an 854 KB payload and a ~600ms server render of 4,150 cells. One colleague
autosaving a column of eight cells was eight of those, in every open tab, while people
were typing in them. The app's response to its most frequent event was its most
expensive operation.

Fixed by making the update incremental:

- `CellChange` / `ChangeEvent` now carry `cellKey` (+ `altCellKey`, because a New ETC
  cell is addressed by entry id once a row exists and by job+section before that, and
  two browsers can legitimately hold different names for the same cell).
- **`lib/etc-remote-values.ts`** — a module store keyed by cell name. Each cell reads
  its OWN key through `useSyncExternalStore`, so a value arriving for one cell
  re-renders one cell; the other 1,179 run a Map lookup, get the same string, and React
  skips them. A whole batch is one notification.
- The cells apply it through the SAME clean/dirty rule they already used for a server
  render, so it can never overwrite typing in progress.
- **A full render always wins.** A remote value is a patch on top of the last render,
  so the cell drops it the moment its server-rendered value moves — a payload is newer
  and more complete than any single event (it can carry changes whose events this tab
  never saw). That is what stops a cached event reinstating a value the database no
  longer holds, cleared values included.
- The route refetch survives only as a fallback for events that name no cell (a bulk
  sync, another tab), and it is now throttled: leading edge, then one trailing refresh
  per 5s window, so a burst costs one refresh instead of twenty.

### 17.3 Root cause 2 — the page loaded a panel nobody had opened

The punch drill-through under the KPI cards was fetched with the page, every time:
**1,092 rows + the whole employee roster, 46ms — the slowest query on the page** —
serialised into the payload of a panel that starts closed. Paid on every one of those
realtime refetches, every 45s interval, and every filter change.

Now fetched when a drill is opened (`lib/hours-detail-actions.ts`), which is what the
unattributed-hours drill beside it already did. The card gets 49 job IDs instead of
1,092 rows.

### 17.4 Root cause 3 — the filter checkbox waited for the whole grid

`EtcViewMenu` navigated on every tick with `checked` read from a server prop, so the
tick could not appear until the server had re-rendered 49 jobs × 13 sections and
shipped it back: **~800ms of nothing, then the box moved**. Five ticks were five full
re-renders, and each one re-rendered the toolbar under the open panel.

Converted to `useDraftParamsMenu` — the hook the Projects toolbar has used since
2026-07-30 for exactly this. The tick lands in local state on the same frame; the URL
follows once, 250ms after the last change; the panel stays open and closing it flushes
anything still pending. Unticking the last section group restores both rather than
leaving a selection the grid cannot render.

### 17.5 Also fixed

- **Nine serial query waves → seven** on Monthly ETC: four independent reads (hidden-job
  punches, HeadStart jobs, the Scheduler lookup, the Standard gate) were awaited one
  after another. Critical path 135ms → 97ms.
- **One click, one action** on the two irreversible buttons. `Submit ETC` and
  `Reopen month` called `requestSubmit()` with nothing to stop a second click; both now
  disable and say "Submitting…" / "Reopening…" until the navigation lands. Nothing was
  ever corrupted (the server's `isMonthLocked` guard rejected the second one) but the
  manager got a thrown error page for a double-click they were entitled to make.
- **A reverted edit stops claiming to be unsaved.** `useAutosave` set `pending` on the
  keystroke and only cleared it by saving, so typing a value and undoing it (or pressing
  Escape) left "Unsaved changes" on screen forever. Found live while verifying §16.

### 17.6 After

| Measure | Before | After |
|---|---|---|
| ETC route render + payload | 613ms / 854 KB | **~565ms / 656 KB** (−23% payload) |
| ETC database critical path | 135ms (18 q, 9 waves) | **97ms** (17 q, 7 waves) |
| Colleague's save → your grid | full refetch: 854 KB + ~600ms | **one cell, 0 bytes** |
| Burst of 20 colleague saves | 20 full refetches | 1 cell update each, 0 refetches |
| Filter tick (checkbox moves) | ~800ms | **2.7ms**, menu stays open |
| Filter ticks → navigations | 1 each | 1 per burst (250ms debounce) |
| One cell edit (main thread) | — | **22ms** across 4,150 cells |
| Opening the punch drill | (paid on every page load) | 49ms, only when opened |

### 17.7 What was NOT done, and what is not proven

- **The 565ms is a DEV build.** No production timing was taken — that needs a
  `next start` process with its own `AUTH_URL` and a login. Treat the dev figures as
  upper bounds and as before/after comparisons on identical footing, not as what users
  see.
- **No virtualization.** 4,150 cells still render. Row/column virtualization of this
  grid means rebuilding a sticky, frozen-column, rowSpan'd table whose totals sum cells
  that would no longer be mounted — a project, not a pass, and the remaining cost is
  server render time rather than scroll jank (one cell edit is 22ms).
- **The incremental realtime path was verified end-to-end once** (a second tab picked
  up "77" with zero network requests) and by unit tests, but not repeatedly: this dev
  server stopped fanning out SSE frames entirely part-way through — presence included,
  which no change here touches — after a long run of Fast Refresh rebuilds. The hub
  holds module-scope state, and HMR duplicating that module is the known hazard
  documented in §15. It cannot happen in production (one build, one process).
- **Audit Log still loads 1,000 rows** for client-side AG Grid paging (57ms). Left
  alone: it was not part of the report and the grid's filtering depends on having them.
- **The Scheduler tab is a separate app** (`SDC_Scheduler`, port 4003) and is not
  touched by any of this.

---

## 18. One month, one submission; no manual saves (2026-08-04)

Four requirements landed together, and they are one change: the month had two
submissions and three save buttons, and every one of them was a way for the figures on
screen to differ from the figures in the database.

### 18.1 Clear ETC is gone (§14)

Removed outright: the toolbar button, `clearYellowNewEtc`, the two predicates that
existed only to scope it (`isNewEtcClearable`, `isNewEtcCarriedFromSubmission`), the
`reopenAsksAgain` flag, the confirmation popover, the `clearableCount` computation on
the page, the two one-off scripts written against it, and the dead `clearMonth` action
(the original sheet's "Clear ETC" script parity, which no UI had called for months).

**`EtcEntry.newEtcClearedAt` STAYS, and is load-bearing.** It is not part of the button
— it is what makes clearing an INDIVIDUAL cell survive a reload, because a null draft
otherwise falls through `newEtcSeedText` to the confirmed value or the carry-forward.
See §16. Individual clearing, its autosave and its audit trail are untouched; verified
live afterwards (cell cleared → reload → still cleared).

The yellow rule kept its simplification from §16 and now has exactly one job.

### 18.2 One submission, one transaction (§15, §16)

Before, a month was finalised by two independent buttons:

```
Submit ETC             -> EtcEntry            (etc-actions.ts, read from the FORM)
Submit Standard Sheet  -> StandardSheetSnapshot (standard-sheet-actions.ts)
```

Nothing tied them together, so **half-submitted was the normal state of a month**: the
ETC figures could be frozen while the fees derived FROM them were still live and
moving, or the reverse. July 2026 was exactly that when somebody asked why the same
button existed twice.

Now: **`Submit {Month} Report`** — one button, label following the month picker
("Submit July Report"), in the toolbar. `lib/monthly-report.ts` + `lib/monthly-report-actions.ts`:

- **Validated first, in detail.** Every issue names section · job · department · column ·
  reason. The required New ETC values are defined by the SAME rule that paints the cell
  yellow, so the checklist on screen and the thing blocking submission cannot be two
  different sets. Measured on July 2026 the day it shipped: 180 outstanding values, the
  first 25 listed with "…and 155 more", the Submit button disabled behind them.
- **Atomic.** ETC entries and the fee snapshot are written in ONE transaction. A failure
  anywhere leaves the month exactly as it was.
- **Idempotent.** The client generates a submission id; a double-click or a retried
  request returns the first outcome instead of finalising twice.
- **Recorded.** `MonthlyReportSubmission` (new table, new migration) holds month, year,
  user, timestamp, app version, status, submission id, the validation result, the
  sections included and the failure reason — for refused attempts as well, because "why
  could I not submit at 4pm" cannot be reconstructed later.
- **Announced** to every connected browser (recordChanges → the change banner + a
  throttled route refresh, which is the right instrument here: a submission moves every
  figure on the page, not one cell).
- **Reopen is unified too.** One Reopen unfreezes both tables and re-derives Prior ETC.
  Leaving two would have recreated by hand the half-submitted month this removes.

**It reads the DATABASE, not the form.** That is the structural half of the fix and it
retires two long-standing hazards: a stale tab could no longer freeze its own DOM
snapshot over colleagues' saved work (so `injectEtcBaselineFields` is gone), and a
Columns/Billable filter no longer makes the month unsubmittable — those inputs simply
are not part of the submission any more.

### 18.3 No manual Save anywhere (§17)

- The grid's **Save** button is gone. Every edit — new value, edit, replace, clear, 0,
  paste — autosaves ~0.8s after the last keystroke, which has been true since §16; the
  button was the last thing telling managers their work needed a click.
- The Standard panel's **Save Pool Cells** is gone (`PoolAutosave`, same
  `useAutosave` machinery as the grid). These were the last manual-save cells in the
  app, and the figures the whole grid's Standard Fees are computed from — so an unsaved
  pool was both a data-loss risk and the thing that used to disable the old submission.
- **Per-cell save state** (`lib/etc-save-state.ts`): saving / saved / failed / conflict,
  as a ring on the cell with a tooltip that says what happened to *that* value. One
  toolbar chip could say "All changes saved" while a single refused cell sat on screen
  looking exactly like its saved neighbours — unusable on a grid with 1,180 inputs.
  Verified live: a typed value shows the saving ring, then "Saved", then fades.
- **Ordering** was already safe and is now stated: saves are serialised (one in flight,
  at most one follow-up), each request reads the CURRENT DOM value rather than a
  captured one, and the server refuses a write whose believed baseline has moved. So the
  100→90→80 case cannot end at 90 — there is no in-flight "90" request to lose a race.

### 18.4 The one behaviour change to know about

**A month can no longer be submitted with outstanding New ETC values.** That is what
§16.5 asks for ("prevent submission when required information is incomplete") and it is
a real workflow gate: July 2026 has 180 such cells today, and every one of them must be
filled (or the month reopened later) before the report can be submitted. The old
behaviour — silently submitting the machine's suggestion for a cell nobody had answered
— is what made the yellow checklist advisory rather than meaningful.

---

## 19. Exporting the two grids (2026-08-04)

Requested: Excel and CSV export from the Projects page and the Monthly ETC page, matching
whatever the table is currently showing (§24).

### 19.1 What was there before

One route — `/api/jobs/export` — linked from the Jobs page as "Export CSV". Seven columns,
no XLSX, it ignored the Projects grid's filters entirely, and **it had no authentication
check of its own**: the whole job list was one unauthenticated URL away. It is now a 410
with a pointer to the replacement (rather than a 404, because that URL has been shipping
in the UI for months).

### 19.2 Shape

```
lib/export/sheet.ts      the SheetSpec both formats render, + filename/sheet-name rules
lib/export/csv.ts        RFC 4180 + BOM + CRLF + the formula-injection guard
lib/export/xlsx.ts       exceljs: number formats, merged group headers, freeze panes, widths
lib/export/projects-export.ts   65 columns  (identity, totals, costs, per-section Q/A/Remaining)
lib/export/etc-export.ts        76 columns  (6 identity + 14 × 5 for 13 sections + Parts Cost)
api/export/[report]/route.ts    auth + audit + Content-Disposition
components/ExportMenu.tsx       Export ▾ on both pages
```

**One spec, two writers** is the load-bearing decision: the CSV and the XLSX cannot
disagree about what the month contains, because they render the same rows, in the same
order, with the same blanks. `null`, `0` and `""` stay three different things all the way
into the file — which is the §16 clearing distinction carried through to Excel.

**The export matches the view because the page and the export build the same query.** The
Projects filter rules moved out of `quoted/page.tsx` into `lib/projects-query.ts`, which
both now call. Two copies reading the same query string would have agreed on the day they
were written and drifted the first time a default changed.

### 19.3 Details worth recording

- **Monthly ETC exports every column**, including the ~60 the on-screen table only reaches
  by scrolling sideways, and adds a "Needs New ETC" column — the export's stand-in for the
  yellow highlight, since a colour cannot survive a CSV ("7 cells awaiting New ETC").
- **CSV headers are flattened** exactly as the requirement asked:
  `ME Gen (Engineering) - Prior ETC`.
- **New ETC exports what the CELL SHOWS** (`newEtcSeedText`) — so a cleared cell is blank —
  while the New ETC TOTAL sums `effectiveNewEtc`, i.e. what the month would submit as. That
  is the one column whose total deliberately does not equal the sum of the visible cells,
  for the same reason the grid's own total row doesn't; the smoke test skips it explicitly
  rather than fudging it.
- **Totals are rounded on the way out.** Summing 49 rows of Decimal-derived floats printed
  `1572.6299999999999` in the totals row, which makes a reader distrust the whole file.
- **Formula injection**: a text cell starting `= + - @` is prefixed with `'`. These files
  are opened by people who did not create them, and job/customer names come from upstream
  systems.
- **Auth + audit on the server.** Every download writes an `export.download` audit row with
  the user, report, format, row count, app version and the full query string, so "which
  view was this file" is answerable exactly.
- **The ETC export flushes autosave first** (`flushEtcAutosave`), because it reads the
  database — the same step the monthly submission takes, for the same reason.
- **fetch + blob rather than a plain `<a download>`**: a link cannot show progress, cannot
  tell a 500 from a success, and cannot wait for the flush. The page never navigates.

### 19.4 Verified

`scripts/export-smoke.ts` (committed, re-runnable) builds both exports against the real
database and asserts the things unit tests cannot:

```
Projects: 51 rows × 65 columns, 57 numeric totals all equal their column
ETC 2026-07: 49 rows × 76 columns, 56 numeric totals all equal their column
             15 of 49 first-section New ETC cells blank (null, never 0)
both: xlsx re-parses with exceljs, frozen panes present, numeric cells hold numbers
```

Live through the running app: `.xlsx` arrives as a real ZIP (PK header, correct MIME,
`Monthly_ETC_July_2026_2026-08-04.xlsx`), the CSV carries the UTF-8 BOM at byte level
(EF BB BF), and the Projects CSV names its own filters in the subtitle
(`Projects_Active_Billable_2026-08-04.csv`).

### 19.5 Not done

- **`exceljs` is a new dependency** (4.4.0, +~1 MB). `npm audit` reports one MODERATE
  advisory reachable through it (`uuid` v3/v5 buffer bounds, which exceljs does not use
  that way); the app's other advisories are pre-existing. A hand-rolled XLSX writer would
  avoid the dependency but would mean owning number formats, merged cells and freeze panes.
- **No "Export All Records" option** (§24.7 says "where useful"). The default —
  the filtered view — is implemented; a second scope selector on a grid whose filters are
  already one click away seemed like a way to hand somebody the wrong file.
- **Large exports are not streamed.** 51 and 49 rows build in ~90ms and ~55ms; the sheet is
  assembled in memory. If a month ever needs tens of thousands of rows this becomes a
  streaming job, and exceljs supports that when it does.

## 20. Motion, transitions and visual stability (2026-08-04)

Requested: make every animation and transition in the app feel smooth, fluid and
responsive, and stop it feeling laggy, jumpy or visually glitchy (§36).

### 20.1 What was there before

Motion existed in nine components and nowhere else, and no two of them agreed:
`transition-all` with no duration on three shared button classes (so Tailwind's 150ms
default), `transition-colors` on three more, `transition-shadow` on the card and the
input, `duration-150` on the sidebar width and on two chevrons, `duration-200` on a panel
that could never animate, and `duration-500` on a chart. The toasts, the change banner,
the confirmation modal, the KPI cards, the loading state and every grid cell had no motion
at all. That is exactly the "different arbitrary animation values in each component"
§36.17 forbids, and it is how it happens: nobody chose it.

Three things were actively wrong rather than merely inconsistent:

- **The Refresh Data button changed width by up to 130px.** Its label WAS the stage
  read-out, so "Refresh Data" (78px) became "Parts costs from TotalETO… (2 of 5)" (210px)
  and back. It appears in the sidebar on every page and in the Monthly ETC toolbar, where
  it shoved the Export menu sideways for twenty seconds and back again.
- **Collapsing the sidebar made the nav icons leap 114px.** `justify-center` was added on
  the frame of the click, while the panel was still 276px wide, so each icon jumped to the
  middle of a wide panel and the panel then narrowed around it.
- **The dashboard's bar chart animated `height` for 500ms.** Twenty bars, thirty frames of
  full-chart layout, and each bar's value label rode up with it — so the numbers were
  unreadable for half a second every time the data changed.

### 20.2 Shape

```
lib/motion.ts              the tokens as numbers, + every rule worth testing
components/useMotion.ts    useReducedMotion, useValueFlash, useExitList
app/globals.css            the same tokens as CSS properties, the motion-* classes,
                           the keyframes, and the prefers-reduced-motion block
tests/motion.test.ts       22 tests, including the two regression guards below
```

The durations live in **two** places on purpose: CSS needs them as custom properties so a
class can use them with no JavaScript, and TypeScript needs them as numbers because two
timers have to outlast an animation (the exit-list drop, the flash clear). A test reads
`globals.css` and asserts the two files hold the same numbers, so changing one without the
other fails the suite rather than dropping a toast mid-fade.

One token per §36.2 band, not a range — a range is how the drift started:

```
--motion-press   80ms   button press feedback        (§36.2: 50–100ms)
--motion-hover  120ms   hover / focus                (§36.2: 100–150ms)
--motion-menu   150ms   dropdowns, filter panels     (§36.2: 120–180ms)
--motion-panel  200ms   tabs, cards, modals, banners (§36.2: 150–250ms)
--motion-flash  600ms   "this value changed"         (§36.6, §36.8 — see below)
--motion-loading-delay 120ms  how long a loading state waits before painting (§36.9)
```

### 20.3 The decisions that are not obvious

**`transform` alone was not enough.** Tailwind v4 compiles `translate-x-[10px]` to
`translate: …` and `rotate-180` to `rotate: 180deg` — the standalone properties, not the
`transform` shorthand. Verified in the built stylesheet. With only `transform` in
`.motion-interactive`'s transition-property list, every toggle knob and every dropdown
chevron in the app would have snapped instead of moving, and nothing would have said so.

**Three things are deliberately NOT animated.** The row-hover highlight, because
`tbody tr:hover > td` paints an inset box-shadow with a 9999px spread and transitioning it
would repaint every cell in a row on every pointer move (§36.15). Width, except on the two
panels where the width IS the state change (the sidebar's rail, the pool panel) — those are
enumerated in the CSS rather than left to judgement. And numbers: no count-up tweening,
because §36.8 forbids delaying the latest value and on a grid where a total is what gets
submitted, a figure that is briefly wrong on purpose is worse than a static one.

**The flash is an outline, not a background wash.** The cells it lands on already carry
meaning in their fill — the Diff gradient, the yellow needs-attention flag — so a
background flash would be overwriting information with decoration. An inset outline costs
no layout at all: measured, a flashing cell is 64×22.67px before and during.

**Which cells may flash is a decision, not a side effect.** §36.6 asks for a highlight on
an updated cell and, two lines later, forbids animating every cell during a large refresh.
Both apply to `EtcLiveTotals`, because one function paints in both situations — a keystroke
moves two or three totals, a Refresh Data can move all of them. So the painter records what
each cell last held and asks `changedForFlash()`: above 12 changes it is a bulk update and
nothing flashes at all. A cell seen for the first time is never a change, so the first paint
is silent. And the comparison is on the rendered TEXT, so a change that rounds to the same
whole hour does not flash.

**Removals get to leave.** React unmounts a dismissed toast on the spot, so an exit
animation on it never ran. `mergeExiting()` keeps a departed item mounted and marked
`leaving`, **in the slot it already occupied**, so a toast in the middle of a stack fades
where it stands instead of jumping to the end while it does. A key that comes back while it
is leaving is restored rather than duplicated — the same change can be re-announced on the
realtime feed.

**The loading delay is CSS, not state.** `.motion-loading-reveal` starts at opacity 0 and
fades in after 120ms, so a navigation that resolves sooner paints nothing. No timer to
clear, and nothing left behind if the route lands mid-delay, because the element unmounts
with the fallback. The same 120ms is on the per-link pending dot, so a prefetched route
that lands immediately shows neither.

**One running label on Refresh Data, not two.** "Refresh running…" (somebody else's pass)
is gone from the visible label, and that is a trade rather than an oversight: measured in
the running app, "Refresh running… 12/12" beside a spinner needs a 184px slot against
"Refreshing… 12/12"'s 148px, so keeping it meant either a permanently 222px-wide button
whose resting label is "Refresh Data", or a button that changes width. The tooltip and the
sr-only live region still say whose refresh it is, and the outcome is identical either way —
the pass is application-wide and everyone gets its result. The step counter is what the
width buys instead.

### 20.4 Verified

Live, in the running app, against the real database:

```
Refresh Data (ETC toolbar)   188px in all four states, no clipping — was 78→210px
Refresh Data (sidebar)       128px button / 98px slot, both states fit
Show all / Reset switch      133px across all five labels
Sidebar collapse             nav icon at x=24 expanded, mid-collapse AND collapsed;
                             moved 0px — was a 114px leap
KPI strip                    6 cards, all exactly 49px tall; Detail/Hide links all 36px
Dropdowns                    all 5 toolbar menus carry motion-menu-panel; the nested
                             group <details> correctly do not
Grid cells                   685 New ETC cells carry motion-cell (169 currently yellow)
Painter hooks                100 group + 13 section + 48 parts-row + 2 parts-footer
Flash                        attaches, 1 iteration, outline-offset -2px, zero layout change
Navigation                   link hint goes pending, then the shell paints with 52
                             skeleton blocks and aria-busy; the sidebar stays present and
                             every link stays clickable throughout
Progress bar                 caught a real refresh mid-pass: scaleX(0.4286) against
                             "step 4 of 7", sr-only reading "Parts cost actual (TotalETO)"
Console                      no errors on /etc, /quoted or /job-hours
```

Caught during that pass and fixed: the sidebar's Refresh label was being clipped to
"Refresh runni…" at 128px (hence the `dense` prop), and the first reservation was 6px too
narrow for a two-digit source count — found by probing every state's width with the real
font rather than reasoning about it.

`tests/motion.test.ts` also carries two regression guards that are the point of the whole
exercise: **no file under `src/` may contain a `transition-*` or `duration-<n>` utility**
(comments stripped first, since several of them quote the classes they replaced), and
**every `motion-*` class referenced anywhere in `src/` must exist in `globals.css`** — a
typo there animates nothing and errors nowhere, which is indistinguishable from the
un-animated app this set out to fix.

### 20.5 Not done

- **No live frame-rate profiling.** §36.18 asks for it and §36.19 sets a 60 FPS target. The
  work here removes the specific causes it names — layout-property animations,
  `transition: all` on shadowed buttons, a 500ms height animation on twenty bars, unbounded
  per-cell flashing — and each is verified structurally. A trace under a real editing
  session on a 4,150-cell month is still worth doing.
- **The reduced-motion path is the one the verification browser exercised.** Headless
  Chrome reports `prefers-reduced-motion: reduce`, so every computed duration read live was
  the collapsed 0.01ms — which does prove the §36.16 block works, and that the spinner
  keeps its 1.6s infinite animation through it. The normal-motion values were verified from
  the CSSOM (the authored rules) and by the token-agreement test, not by watching them play.
- **A leaving notification still collapses its slot in one step** once its animation ends.
  Smoothing that away needs a height animation on the card, which §36.15 rules out for
  better reasons than this one is worth.
- **No visual-regression or slow-network test suite.** §36.20 asks for one. What exists is
  22 unit tests over the decidable rules plus the live measurements above; screenshot
  diffing and throttled-network runs would need a browser harness this repo does not have.
- **`window.confirm` is still the unsaved-changes prompt** in the sidebar (three call
  sites) and in `ConfirmSubmit`. §36.11 is about the report-submission modal, which is a
  real in-app dialog and now animates; the native confirms cannot be styled or animated at
  all, and replacing them is a behaviour change rather than a motion one.

## 21. Six KPI cards became one summary card (2026-08-04)

Requested: combine the KPI cards at the top of the Monthly ETC page into one unified
summary card, without removing or changing any existing functionality (§37). Six named
KPIs stay: Engineering hours, Shop hours, Parts spent, People booked, Undefined hours,
Hours off the grid.

The request is visual, and §37 spends a page — §37.12, twenty acceptance criteria — saying
what must survive it. That emphasis is right. A consolidation is exactly the edit that
loses a KPI, points two blocks at the same drill-through, or drops a tone, and none of
those read as anything but "moved some divs" in the diff.

### 21.1 The strip is data now

`EtcMonthKpiCards` held six hand-written cards: two `GroupCard`s, four `Card`s, and the
`Variance` / `Unplanned` pair that decided how a second line was painted. Each card chose
its own content inline, which meant each one also chose which vintage of a figure to read
— the mistake §28 was written about, where the Parts tooltip quoted a page-load operand
beside a live variance.

So the strip's content moved to `lib/etc-kpi-strip.ts` as a pure function:

```
buildKpiBlocks({ kpis, importIssues, offGridJobs }, { hours, usd }) -> KpiBlock[]
```

It computes no KPI. Every figure arrives already reconciled by `reconcileEtcKpis`, which
stays the single authority on live-versus-synced. The module selects, labels and formats,
and the component renders what comes back — so there is no longer a per-card choice to get
wrong, and the six-blocks-with-six-drills property is a test rather than a claim
(`tests/etc-kpi-strip.test.ts`, 39 cases).

Two smaller rules moved with it, for the same reason:

- `offGridTotalHours` / `undefinedHoursTotals` — the block and the drill panel that opens
  from it now read one sum, so §37.13 #6 (a KPI reconciles with its own detail) holds by
  construction rather than by coincidence.
- `kpiDetailState(blockDrill, openDrill, lanes)` — which block is fetching, and which one
  failed. Three lanes serve six blocks (punch detail for Engineering / Shop / People,
  parts, hours export), and a block reports a state only when ITS drill is the open one.
  Nothing is fetched for a closed drill, so at most one block is ever non-idle and the
  other five keep their confirmed values — §37.9's "one slow KPI must not block the
  others", as an assertion.

`KpiBlock` is deliberately FLAT — every field a primitive. That is what lets the component
spread a block into a `React.memo`'d `MetricBlock` and have the shallow comparison work. A
nested `status` object would be a fresh identity every render, so all six blocks would
re-render whenever any one figure moved: §37.4 and §37.11 satisfied on paper and false in
the profiler.

### 21.2 What the card looks like

One `<section>` owns the border, the background and the shadow. The blocks inside have
none of their own — the dividers are the grid's `gap-px` letting the container's colour
through. That beats a per-block border for a reason worth writing down: a left border on
each block leaves a stray line at the start of every wrapped row, and this grid wraps at
three widths.

A tone tints its block's background instead of bordering it (amber for Undefined hours, red
for Hours off the grid), which reads as a section of one card rather than a card inside a
card. Both toned blocks also carry a ⚠ and an sr-only "Needs attention" / "Action needed",
because §37.10 forbids communicating status through colour alone and the tint was the only
signal those two had.

Each block is label / value / (status + Detail):

```
ENGINEERING HOURS
3,015
▲ 4 under                 Detail
```

The value gets its own line, which the six separate cards did not give it. Side by side —
as they had it — there is no room at six blocks across: "$1,432,857" beside
"▼ $1,084,643 over" needs ~180px and gets ~155px on a 1280px screen, so one of the two had
to clip, and §37.7/§37.8 forbid clipping either. The Detail link moved down beside the
status for the same reason: sharing the top line with the label left the label 94px of
169px, which truncated "Engineering hours" and both toned labels (measured live, not
guessed). Nothing in the card clips now at any width.

Every block is 68px tall and stays 68px whatever its figures do — the value line and the
status line both have reserved heights, because the status swaps between a variance, an
unplanned figure and a neutral note as cells are filled in (§36.14, §37.7).

Three lines instead of two costs ~19px of height against the old strip. At xl that is one
row, so the whole card is 69px against the old 49px; below xl it wraps to two or three
rows as before.

### 21.3 The statuses, and one honest tooltip

Four of the six blocks had no visible status at all before — their explanation was a
`title` attribute nobody hovers. §37.1 asks for status text on every metric, so the short
version is now on the card and the full version stays in the tooltip:

| block            | status                 |
|------------------|------------------------|
| Engineering/Shop | `▲ 4 under` / `4,070 unplanned` / `On plan` |
| Parts spent      | `▼ $189 over`          |
| People booked    | `24 eng · 21 shop`     |
| Undefined hours  | `25 entries` / `None outstanding` |
| Hours off the grid | `5 jobs not listed`  |

Making the People split visible exposed something the tooltip had been wrong about. July
reads 49 people against 24 eng · 21 shop, and the old sentence explained only one direction
of that gap ("counts each person once even if they booked to both"). It can fall either
way: somebody whose sections belong to neither billing group — the pool sections the ETC
grid excludes — is in the headline and in neither figure. The tooltip now says both, and
quotes the headline it is reconciling against.

### 21.4 Verified

Live, in the running app, on July 2026 with real data:

```
Unified card         ONE <section>, one border, one shadow — 0 descendants with either
Blocks               6, all exactly 68px tall, 1px dividers, zero per-block borders
Clipping             0 clipped elements at 1585px, 1009px and 558px
Layout               1585px -> 6 columns (--kpi-cols: 6)
                     1009px -> 3 columns, two rows
                      375px -> 1 column, stacked
Values               3,015 / 2,675 / $361,074 / 49 / 179 / 296
Drill: Engineering   "Engineering hours — 2026-07", 648 lines, eng sections only
Drill: Shop          "Shop hours — 2026-07", 444 lines
Drill: Parts         "Parts spent — 2026-07, by job", footer $361,074 = the block
Drill: People        "Hours Detail — 2026-07", 1,092 lines, total 5,690 = 3,015 + 2,675
Drill: Undefined     "Undefined hours — 2026-07", 25 of 25 lines, total 179 = the block
Drill: Off the grid  "296 hours on 5 jobs", total 296 = the block
Detail links         one per block; only the clicked block flips to "Hide"/aria-expanded
Accessible names     "Show the Engineering hours detail", … — six distinct names, not
                     six buttons called "Detail"
Hide summary         hides the whole card, stores "0", keeps the open drill and its data;
                     Show brings every value back with no reload
Refresh Data         caught a refresh mid-pass (2/7 -> 4/7): all six values stayed visible
Console              no errors
```

Plus 39 unit tests over the decidable criteria: all six KPIs present in order, each with
its own value / status / drill; changing one KPI leaves the other five blocks deep-equal;
a live New ETC edit moves that group's status and nothing else; synced figures never move
when somebody types; the parts tooltip's subtraction produces the variance beside it; a
slow or failed lane marks only its own block; the grid stacks at base and follows the block
count at xl; Hide/Show round-trips and touches nothing but its own preference key.

### 21.5 Not done

- **The live-typing path was not exercised in the browser.** Autosave fires 800ms after the
  last keystroke, and this dev server talks to the production database — so typing a New
  ETC to watch a block move would write a real value to the July month managers are
  working in. The reconcile-to-block mapping is covered by unit tests that drive
  `reconcileEtcKpis` with published cells (including "a live edit in one group leaves the
  other blocks untouched"), and the expression feeding the card is the same one it was
  before this change. Worth doing against a scratch database.
- **The page is unusable below ~900px, and that is not new.** At a 375px viewport the
  card correctly stacks to one column, but the content area is 39px wide — the sidebar is
  a 276px fixed flex sibling that never collapses, so the page's own `<h1>` measures 39px
  too. The card is as responsive as §37.8 asks; the shell around it has no mobile
  breakpoint. Out of scope here, and it affects every page equally.
- **No visual-regression coverage.** Same gap §20.5 records: 39 unit tests plus the live
  measurements above, no screenshot diffing.

## 22. The app froze for four and a half seconds (2026-08-04)

Reported: the application "frequently becomes unresponsive or reacts very slowly" when
the pointer moves, a button is clicked, a cell is selected, a filter or dropdown is
opened. Fix it across the whole app; the first click must never be ignored (§38).

Two distinct defects, both measured rather than guessed at. One made the app ignore
everything for 4.5 seconds after every load of the Monthly ETC page; the other made a
single click on a grid cell do nothing at all, by design.

### 22.1 Measure first — six suspects were wrong

§38 lists thirty-odd plausible causes, and reading the code produced six good ones: the
document-level `pointermove` in ColumnResize, the coarse presence subscription that
notifies every one of ~830 cell indicators, `LiveRefresh`'s polling, the sidebar's
`setState` in an effect, 367 stray `<table hidden>` nodes left in the body by React's
streaming, and the sheer size of the route (2,030 KB of HTML, 7,328 DOM nodes, 4,150
cells, 1,179 inputs).

Every one of them was wrong, or too small to matter. What settled it was a production
build (`.next-perf`, port 3024 — a dev server's numbers are meaningless here, React dev
builds and HMR add hundreds of ms production does not have) with a `PerformanceObserver`
on `longtask` and `event`:

```
/etc      first-contentful-paint  60ms
          long task               162ms  at 622ms
          long task             4,347ms  at 784ms      <-- the whole bug
          total blocking        ~4,459ms

/quoted   1,194 inputs (fifteen MORE than /etc), 7,596 nodes
          worst long task         159ms
          total blocking          109ms
```

The Projects grid has the same number of inputs and a slightly bigger DOM, and blocks the
main thread for 109ms. Monthly ETC blocks it for 4,459ms. So it was never the cell count,
the payload or the node count — it was something /etc does and /quoted does not.

The page painted at 60ms and then ignored every click until 5,131ms. That is exactly the
report, including why it reads as intermittent: a user who takes half a second to reach
for the mouse loses their first click, and one who takes five seconds does not.

### 22.2 One publish, one repaint — not one repaint per cell

Every New ETC cell publishes itself to `lib/etc-live-totals.ts` on mount. The store's
`emit()` notified every listener **synchronously, on every publish**. One of those
listeners is not React: `EtcLiveTotals` repaints the grid's rollup cells imperatively,
reading their text and writing new text and classes.

So mounting a month's grid cost ~880 synchronous DOM-read-then-write passes over ~150
cells — ~880 forced style recalculations inside one commit — plus ~880 re-render
notifications to the KPI strip and to the Standard Fees columns, whose subtree is the
whole grid. O(cells) repaints of an O(cells) structure, in the commit phase, with the page
already on screen.

The fix is four lines: `emit()` bumps the version counter synchronously and schedules ONE
notification per animation frame (a microtask under node, where the tests run).

```
/etc after   long tasks 67ms, 212ms, 63ms
             worst              212ms   (was 4,347ms)
             total blocking     187ms   (was ~4,459ms)
             first paint         80ms   (was 60ms — unchanged within noise)
```

**18× off the worst block, 96% off total blocking time**, on the same page with the same
1,179 inputs and 4,150 cells.

Two properties have to hold together, and `tests/interaction-latency.test.ts` pins both:

- the **version counter stays synchronous**, so anything reading between a publish and
  the notification — React rendering for another reason, the painter's own first pass —
  sees the new figures rather than a stale cache. Deferring the notification is safe;
  deferring the data would be a correctness bug.
- a burst is **one** notification. 880 publishes, one repaint. A month switch (880
  unmounts plus 880 mounts) is also one.

The listener set is copied before iterating, because a month switch unsubscribes cells
while the deferred notification is being delivered.

### 22.3 The first click was suppressed on purpose

`DragScroll` called `preventDefault()` on mousedown over any unfocused grid input, so a
press on a grid full of inputs panned the view instead of dropping a caret into live data.
Double-click was made the way into a cell.

But focus is this grid's **only** selection model — the input IS the cell — so suppressing
focus suppressed selection, and a single click on a cell genuinely did nothing. §38.1
forbids that outright ("the first click must never be ignored") and §38.16 #3 asks for the
opposite.

Worse, it was the same `preventDefault` that caused the §34.2 stale-border bug (it
suppresses the whole focus change, including moving focus AWAY from the cell that had it),
which had been treated by adding a rule to blur the old cell explicitly. That fixed the
border and left the ignored click, because the border was only the visible half.

The gesture is now separated by MOVEMENT, which is what actually distinguishes a pan from
a click:

- press, don't move → the browser focuses the cell. Selected, first time, no handler.
- press, move >3px → blur, drop the text selection, pan.

`shouldBlurOnCellPress` and its whole rule are gone: focus transfers the way the browser
transfers it, so no cell can be left outlined after the pointer moves on — the §34.2 bug
cannot recur because its cause is gone, not because a rule compensates for it.
`pressKindFor` replaces it and is exhaustively tested, plus a source-level guard that
`onMouseDown` contains no `preventDefault` — the fix is the ABSENCE of a call, which no
unit test can otherwise express.

Verified live: one click on `newEtcOverride__50479` focused it and drew the active-cell
outline (`2px solid rgb(21,116,196)`); a 150px drag panned the grid from `scrollLeft` 0 to
281 with no text selected, focus released, and the grab cursor restored.

### 22.4 An instrument, so the next report starts from a number

`lib/interaction-metrics.ts` (pure: §38.13's budgets, the over-budget decision, a safe
control label, a bounded ring buffer) and `components/InteractionMetrics.tsx` (the
observers) record any interaction that misses its §38.13 target, any long task over 50ms,
and any layout shift over 0.1 — with the page, the control, the action, the duration, the
budget and how many requests were in flight.

- **Nothing is sent anywhere.** No endpoint, no beacon. The last 50 records sit on
  `window.__sdcInteractions`.
- **Labels are structural only.** `value`, `title` and `placeholder` are excluded by
  allowlist and asserted excluded by test, because this app's grids hold live commercial
  figures and §38.14's "do not expose sensitive information in client logs" is a warning
  about the grids, not about telemetry.
- **Dormant in production** until somebody adds `?perf=1` (remembered for the tab), so a
  manager reporting a slow afternoon can read the log out of the console without a deploy.
  Confirmed dormant on the production build: `__sdcInteractions` undefined, `fetch`
  unpatched. With the flag it recorded two long tasks (149ms, 109ms) and the fields above.

The fetch wrapper that counts in-flight requests decrements in a `finally`, so a rejected
request cannot drift the count upward for the life of the tab — §38.12's own rule, applied
to the instrument.

### 22.5 Verified

```
Hydration block   4,347ms -> 212ms worst; 4,459ms -> 187ms total blocking
First click       ignored -> focuses the cell and draws its outline
Drag to pan       still pans (scrollLeft 0 -> 281), no text selected, cursor restored
Hover             pointerover/pointerenter handler processing 0ms
Diagnostics       dormant by default; ?perf=1 records page/control/action/duration/requests
Tests             545 pass (30 new across interaction-latency and cell-focus-transfer)
```

The residual 163ms input delays measured on hover all carry `processingMs: 0` — they are
clicks and moves queueing behind what is left of hydration, not handlers doing work.

### 22.6 Not done

- **The grid is not virtualized.** §38.9 offers it "where appropriate" and it is the only
  remaining lever on the 212ms: 4,150 cells and 1,179 inputs are still all mounted.
  Virtualizing a grid with frozen columns, five header bands and a live footer is a
  rewrite of `etc/page.tsx`, and the measured payoff after this change is ~150ms.
- **No web worker.** §38.4 suggests one for CPU-heavy work. After this change there is no
  CPU-heavy client work left to move: the totals recomputation is ~880 additions.
- **Not every control in §38.2 was individually timed.** The approach was to measure
  app-wide long tasks and input delay, fix what dominated, and leave an instrument
  running. The Standard Fees panel, the modals and Export were exercised but not
  profiled one by one.
- **§38.15's browser-level matrix is not automated.** Rapid clicks, virtualized rows,
  listener leaks across repeated navigation and memory growth need a DOM harness this
  repo does not have. What exists is 30 unit tests over the decidable rules plus the
  live measurements above.
- **Two leftover `next dev` servers were found running on ports 3021 and 3022** on the
  same box that serves production, each with its own file watcher, its own auto-sync
  scheduler and its own in-process realtime hub, all pointed at the production database.
  Left alone rather than killed, but they are a real drain and only one instance should
  be running.

## 23. One type system, and the two controls it turned out to be hiding (2026-08-04)

Requested: review the whole application and make the typography consistent — one family,
one scale, no scattered overrides (§39).

The family was already right. The scale was not, and consolidating it uncovered two
shipped controls that had never worked.

### 23.1 Twenty-two font sizes

Counted across `src/`:

```
216 × text-[10px]     168 × text-xs        140 × text-[11px]     135 × text-sm
 16 × text-[9px]       11 × text-[13px]      8 × text-[12px]      19 × text-lg
  3 × text-[11.5px]     2 × text-[9.5px]     2 × text-[10.5px]     2 × text-[12.5px]
  2 × text-[15px]       2 × text-[8px]       1 × text-[7px]        1 × text-[13.5px]
  1 × text-[16px]       1 × text-[22px]      1 × text-[27px]     + base/xl/2xl
```

Twenty-two, several within half a pixel of each other. At the 15px root, `text-[11px]`,
`text-xs` (11.25px) and `text-[11.5px]` are three names for the same thing, and 311 sites
used them interchangeably.

Now ten, every one a theme step: three new tokens for the sizes Tailwind lacks —
`--text-micro` (9px), `--text-label` (10px), `--text-note` (11px) — plus Tailwind's own
`xs / sm / base / lg / xl / 2xl / 3xl / 4xl`. 412 replacements across 45 files.

Measured on the built app afterwards, the Projects page renders **seven** distinct sizes,
all of them steps: 10.2 (table text), 11.25, 11.0, 10.0, 15, 13.125, 22.5.

### 23.2 The scale is in rem, and that is the actual fix

The sidebar's Text size control sets the ROOT font size (`AppTextSize`, default 15px), and
Tailwind's steps are rem, so they scaled with it. **The hundreds of `text-[10px]` values did
not** — they are absolute pixels. Turning the control up grew the body text and left every
grid label, column header and KPI caption exactly where it was. It was half a control.

The three new tokens are exact fractions of 15px (`0.6rem`, `0.6667rem`, `0.7333rem`), so at
the default they are pixel-identical to the values they replaced — the migration moved
nothing on screen — and away from the default the whole interface now scales together.

`tests/typography.test.ts` asserts that identity directly: each token must resolve to the
pixel size it replaced, and the handful of deliberate exceptions are listed with their
deltas (12.5px → text-xs is the widest at 1.25px; 7px and 8px were RAISED to the 9px floor,
because §39.15 does not allow a size nobody can read).

No token carries a default line-height, deliberately. An arbitrary `text-[10px]` inherits
its line-height and the grids depend on that — they set `leading-none` per row to hit a
density the user also controls. Attaching a default would have changed the height of every
row in the app.

### 23.3 The first-visit reflow

The root font size was only ever applied by JavaScript: the pre-paint script sets it *only
when a saved preference exists*, and `AppTextSize`'s effect runs after mount. So a first
visit rendered the entire app at the browser's 16px and snapped to 15px on hydration — a
6.7% reflow of every page, on every new browser. `html { font-size: 15px }` in globals.css
fixes it; the script and the effect now only ever override a default that is already right.
The test pins the CSS value and `AppTextSize`'s `DEFAULT` to the same number.

### 23.4 A weight the app does not have

`font-extrabold` (800) was used in five places. next/font loads 400/500/600/700, so the
browser **synthesised** 800 — those five rendered as a smeared faux bold matching nothing
else on screen. Replaced with `font-bold`, and the test now reads the loaded weight list out
of layout.tsx and rejects any class outside it.

### 23.5 The charts were using a different font

`components/charts/theme.ts` carried its own copy of the stack:

```
const FONT = "Montserrat, -apple-system, 'Segoe UI', system-ui, sans-serif";
```

Two things wrong. It is a second definition of something §39.17 says to declare once, and
the literal `"Montserrat"` is **not the font the app uses** — next/font self-hosts the file
under a generated family name, so that string resolved to whatever Montserrat the machine
happened to have installed, or to the fallback. Chart labels could render in a different
face from every other label on the same screen.

ECharts needs a real string (it writes `ctx.font` for canvas text, where `var()` means
nothing), so it now resolves the family from the document — the stack the body is actually
using, generated name included — memoised, and guarded by a test that nothing outside
globals.css and layout.tsx may name a font face.

AG Grid was already correct: `fontFamily: "inherit"`. Pinned by a test so it stays that way.

### 23.6 Eleven currency formatters

`toLocaleString(undefined, { style: "currency", … })` appeared eleven times outside
`ui/format.ts`, in three shapes — and three files had the identical *pair* of helpers under
the identical names (`currency` / `currencyExact`). Five of the eleven used
`minimumFractionDigits: 2`, which `usd2()` does not, so **$5 printed as "$5.00" in some
places and "$5" in others**.

Added `usdExact()` to `ui/format.ts` for the exactly-two-decimals case and routed all
eleven through the shared functions — the three duplicate pairs became one import line each,
so no call site changed.

### 23.7 The Monthly ETC Text size stepper had never worked

globals.css carries `table, table * { font-size: …!important }` for app-wide table
uniformity. The ETC grid's own Text size stepper wrote `--etc-font-size` and applied it with
`[&_td]:text-[length:var(--etc-font-size,10px)]` utilities, whose comment claimed they
"beat each cell's hardcoded size with no `!`". True of the cell's own class — and irrelevant,
because an important declaration outside any layer beats a normal one inside
`@layer utilities` whatever its specificity.

Measured live: **setting `--etc-font-size` to 22px moved a cell from 10.2px to 10.2px.**

Two attempts were needed, and the first one is worth recording because it looked right:

1. Have the grid set `--table-font-size: var(--etc-font-size, 0.68rem)` on its table and let
   the blanket rule resolve it. Written as an arbitrary-property utility
   (`[--table-font-size:var(--etc-font-size,0.68rem)]`) it **emitted no CSS at all** —
   Tailwind's arbitrary-property parser does not take a nested `var()` containing a comma.
   The class was on the element and the variable still resolved to the default. A class that
   generates nothing is the worst kind of fix, because the diff looks correct.
2. Moved to an inline style, which did set the variable — and the cells still did not move.
   With that indirection, writing `--etc-font-size` on `<html>` updates the variable
   (`getComputedStyle` confirms it) but does not invalidate `font-size` on the descendants.

What works is a rule of the same weight and higher specificity that reads the variable
**directly**: `table[data-grid="etc"], table[data-grid="etc"] *`. The grid's table carries
that attribute; every other table keeps the shared default.

Verified on the real path — a saved preference of 18, applied by the pre-paint script:

```
before   cells 10.2px, headers 10.2px, inputs 10.2px   (at every stepper setting)
after    cells 18px,   headers 18px,   inputs 18px
cleared  back to 10.2px
```

### 23.8 Verified

Computed styles read off the built app:

```
/etc      ONE family across h1, sidebar, buttons, table headers, cells, inputs,
          selects, KPI label, KPI value, banners — distinct families: ["Montserrat"]
          inputs and selects inherit it (no browser-default leak)
          4,067 of 4,067 body cells render tabular-nums
          root 15px, declared in CSS
/quoted   ONE family across h1/th/td/input/select/button/menu
          SEVEN distinct rendered sizes on the whole page, all theme steps
/audit-log buttons and inputs Montserrat (AG Grid inherits)
Tests     556 pass, 11 new in tests/typography.test.ts
```

### 23.9 Not done

- **No visual-regression suite.** §39.20 asks for one; this repo has no screenshot
  harness. What exists is the size-identity proof in the test (a rename cannot move text),
  11 structural guards, and the computed-style measurements above.
- **Capitalization (§39.12) was not swept.** Button and header casing was spot-checked and
  looked consistent, but "one style per UI category" was not audited label by label across
  every control.
- **Tailwind generates CSS for classes that appear only in comments.** Its content scanner
  reads every non-ignored file, so `.text-\[10px\]` is still in the built stylesheet purely
  because comments and tests quote it. Harmless — nothing carries those classes — but it
  means the built CSS is not proof that a class is unused; the source guard in
  `tests/typography.test.ts` is.
- **The blanket table rule still overrides in-table size utilities.** That is deliberate
  (§39.4 wants one size per grid) but it does mean a `text-note` on a `<td>` does nothing,
  which is how the app accumulated sizes nobody could see the effect of. Worth revisiting
  as a scoped rule rather than `table *`.

---

## 24. The filters that asked the server for something it had already sent (2026-08-04)

Reported as §40: "filters, buttons, tables and tab navigation are still slow; selecting or
unselecting a filter option does not update results quickly; transitions between tabs take
too long or occasionally remain stuck loading."

§17 and §22 had already been through this page twice. What was left was one specific
mistake, and it was structural rather than a missed optimisation.

### 24.1 The baseline — first production numbers this app has ever had

§17.7 flagged that every figure to date was from a dev server and should be treated as an
upper bound. That gap is now closed: built with `NEXT_DIST_DIR=.next-perf`, served by
`next start`, live data (49 ETC jobs / 438 entries; Projects 51 rows of 233).

| Route | server render | payload |
|---|---|---|
| `/quoted` (Projects) | 214ms | **953 KB** |
| `/` (Dashboard) | 210ms | 57 KB |
| `/etc` (Monthly ETC) | 148ms | 596 KB |
| `/job-hours` | 114ms | 249 KB |
| `/audit-log` | 62ms | 149 KB |
| `/employees` | 12ms | 39 KB |

Database critical path, re-run with `scripts/perf-baseline.ts`: ETC 89ms, Projects 140ms,
Audit 63ms, Dashboard 5ms, Employees 3ms. **Still not the bottleneck anywhere**, which is
now the third consecutive pass to find that.

Page load is healthy — `/etc` first contentful paint 96ms, worst long task 166ms. The
4,347ms hydration block from §22 has stayed fixed.

### 24.2 What was actually wrong

A filter tick, measured per interaction:

| Page | Control | checkbox | server | results | DOM mutations | blocked |
|---|---|---|---|---|---|---|
| ETC | View to Shop (section columns) | 2ms | 17-47ms | 218-404ms | **4,113** | 29-97ms |
| ETC | View to Job Name column | 2ms | 20-50ms | 104-242ms | **3,649** | 66-118ms |
| Projects | Sections to one info column | 4ms | ~31ms | 231-258ms | **3,330** | 262-440ms |

The checkbox was already instant — that was §17.4's fix, and it held. The server was never
slow. **The cost was three and a half thousand DOM mutations to stop showing a column that
was already on the screen.**

These filters are *presentational*. Hiding the Job Name column does not change which jobs
are fetched or what any figure is; it changes what you can see. Yet each tick was a full
route navigation: a fresh RSC payload, and React reconciling all 4,272 cells against a tree
that differed by one column.

### 24.3 The fix: render once, hide with a stylesheet

**`lib/grid-view.ts`** + **`components/GridViewProvider.tsx`**. The grid is rendered
complete; every cell carries `data-col` with the keys that can hide it; visibility is one
generated `<style>` element. Hiding a column is a single text update to one node, so it
costs the same whether the grid has 50 cells or 5,000.

The URL still carries the view — Export re-runs the query server-side from the query
string, saved Views snapshot it, and a shared link has to open the same thing — written with
`history.replaceState`, which Next supports for exactly this and which syncs
`useSearchParams` with no server re-render
(`node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md`).

Two details that are load-bearing rather than incidental:

- **Banded header colSpans.** A colSpan is a number in the DOM and no stylesheet can change
  it, so each band declares the leaf columns it spans and its colSpan is recomputed. That is
  the only per-change DOM work and it is O(bands) — 18 cells on this grid, not 4,272. It is
  also computed **server-side for the first render** (`bandProps` in etc/page.tsx), so a URL
  that already hides a group does not paint a sheared header before hydration.
- **A band's entries are the leaf's FULL key set, not its section code.** The first version
  compared codes only, so hiding a billing *group* hid all its cells but shrank none of the
  bands above them: the phase row spanned 78 columns over a 58-column body and the whole
  header sheared sideways. Caught in the browser, now pinned by a test.

### 24.4 Why only some filters moved

This is the whole safety argument, and it is per-filter rather than per-page.

**Moved (nothing derives a figure from them):**

- ETC `dept` — `totals` iterates `ETC_SECTIONS`, every section, not the visible ones; and
  `sectionGrandTotals` is keyed per section code. Verified empirically: all **48 footer
  figures byte-identical** with Shop hidden and again after restoring it.
- ETC `jobname`, Projects `hide` (the seven info columns).

**Deliberately left navigating:**

- ETC `billables` — filters ROWS, and `visibleJobs` decides the job count, the KPI card
  figures and the grand totals.
- Projects `cols` — hiding a section changes the Engineering and Shop hour totals, which the
  page sums over the visible sections only (`engCodes`/`shopCodes`).

Hiding either of those with CSS would leave a *wrong* number on a financial report rather
than a slow one. Reimplementing that arithmetic in the browser is a second source of truth
for money, which is not a trade worth making for 200ms.

### 24.5 After

| Interaction | Before | After |
|---|---|---|
| ETC section columns — mutations | 4,113 | **10** |
| ETC section columns — requests | 1 (596 KB) | **0** |
| ETC section columns — results | 218-404ms | **6-7ms** |
| ETC Job Name column — mutations | 3,649 | **0** |
| Projects info column — mutations | 3,330 | **4** |
| Projects info column — requests | 1 (953 KB) | **0** |
| Header alignment, every state | — | body/header/footer agree in all states |
| Footer figures across a toggle | — | 48/48 identical |

One filter action is one request where it needs one, and none where it does not.

### 24.6 Two of my own measurements were wrong, and it mattered

Recorded because both would have sent this work in the wrong direction.

- **A "3.1 second" filter result was my instrument.** The first probe polled
  `querySelectorAll('td,th')` every 8ms — a 4,000-node query 125x/second, competing with the
  render it was timing. Replacing it with a MutationObserver gave 231ms for the same click.
  Anything that polls the DOM to time the DOM is measuring itself.
- **"15 duplicate fetches for one filter click" did not exist.** A patched `window.fetch`
  counter was accumulating SSE stream chunks and the previous test's traffic. Measured
  properly with a `PerformanceObserver` on resources, one server-side filter click is
  **exactly one request** (930 KB, 657ms).

The general lesson, and it is the same one as §22: find the control case before believing
the number. Idle observation windows over the same duration recorded **zero** long tasks,
which is what established that the ~75ms tasks per toggle are real.

### 24.7 What was NOT done, and what is not proven

- **The remaining ~225ms per toggle is browser style+layout, not React.** Three long tasks of
  ~57-101ms follow each toggle, with the result painted at 69-101ms. That is the cost of
  recalculating a 4,272-cell table's layout when its column count changes, and it did not go
  away — the old path paid it too, on top of the reconciliation. Total main-thread time per
  toggle is not obviously lower than before; what collapsed is the network, the payload and
  the mutation count. A cheaper mechanism exists (`<colgroup>` + `visibility: collapse`, or
  `table-layout: fixed`) and both are riskier than this pass could verify.
- **An intermittent ~3s stall was observed twice in ~15 ticks and never reproduced on
  demand.** Server responded in 20ms; React committed at 3,077ms. It correlates with
  `SLOW_AFTER_MS = 3_000` — a watchdog timer firing would flush a parked transition, which
  fits the shape exactly — but that is a hypothesis, not a diagnosis. The two controls it was
  seen on no longer navigate at all, so it cannot occur for them; whether it can still occur
  on `billables`, `cols` or a month change is **unproven**.
- **The page twice navigated to `/` on its own** during rapid scripted clicking, and did not
  reproduce under deliberate stepping (six consecutive toggles, no `pushState`, no
  `popstate`, URL correct throughout). Unexplained; possibly the automation. Recorded rather
  than claimed fixed.
- **Payload grew slightly** — `/etc` 596 to 615 KB, `/quoted` 953 to 961 KB — because every
  column is now always printed. `?dept=Engineering` costs the same as the full grid where it
  used to cost less. That is the intended trade: pay once on load, nothing per toggle.
- **Tab navigation misses §40.18's 200ms shell target on the two big grids.** URL and active
  state change in 12-52ms, and no route hangs, but the shell appears at 465ms (Projects) and
  530ms (ETC). A revisit costs the same as a first visit (485ms) because every route under
  `(app)` is dynamic via the layout's `auth()` — the constraint §14 documented. Nothing here
  changed that.
- **Dashboard is 210ms of server render on 5ms of database and a 57 KB payload.** ~200ms is
  unaccounted for and was not investigated. It is the clearest remaining backend lead.
- **Two `replaceState` calls per toggle.** The second is Next's own router sync (confirmed
  from the stack), not this code. Harmless: same URL, no history entry, no request.
- **Not covered by this pass at all:** row/column virtualization (still none, same reasoning
  as §17.7), the Audit Log's 1,000-row load, responsive breakpoint and browser zoom testing,
  and the Scheduler (a separate app on port 4003).

### 24.8 Tests added

`tests/grid-view.test.ts` (11) and `tests/etc-view.test.ts` (7). Both exist because of bugs
this pass actually produced rather than bugs it imagined:

- `nextHiddenGroups` had its boolean inverted, so clicking the box hid nothing and raised no
  error — an inert filter, which is the exact complaint §40 is about.
- `bandColSpan` compared section codes only, which sheared the banded header.
- A band with every leaf hidden must report 0 so the caller hides it, because `colSpan={0}`
  means "span to the end of the column group" in HTML rather than "span nothing".
- `etcViewWriteParams` must CLEAR a param that is no longer needed; a stale `dept` would
  survive a reload and re-hide a column the user had just restored.
- Keys reach a stylesheet from the query string, so an unsafe key is dropped rather than
  escaped.

Suite: 574 passing, `tsc --noEmit` clean, lint clean on every new file.

---

## 25. Money Spent Month reconciled to Total ETO (2026-08-05)

Reported as §41: the Money Spent Month figures in the app do not match the Total ETO
report. They did not, by $30,117 for July 2026 and by multiples on individual jobs.

### 25.1 The reference

A Total ETO pivot for July 2026 — `Sum of Debit Amt / Sum of Credit Amt / Sum of Net
DR/CR`, 35 jobs, grand total **$420,656 net** ($423,240 debit less $2,584 credit). It is
an accounting report, and the credits are real and material.

Transcribed into `scripts/parts-spent-recon.ts` as the reconciliation reference. The
transcription is self-checking: the per-job nets must sum to the pivot's own printed grand
total or the script refuses to run, so a misread digit cannot silently become the expected
answer. It checks out exactly.

### 25.2 What the app was doing, and why both of its formulas were wrong

Two formulas existed in `sync-totaleto.ts`, and the app had used each in turn.

**`getPartsCostSpentByJob`** sums `[Total Price]`, which is
`remaining-uninvoiced-balance + everything-invoiced-to-date`. That is a point-in-time PO
snapshot, not a monthly flow: a job carrying a large open purchase order contributes the
PO's whole undelivered value to any month it was touched in.

| Job | ETO pivot | this formula | over by |
|---|---|---|---|
| 1142 | $113,101 | **$1,065,713** | $952,612 |
| 1130 | $79,211 | $101,546 | $22,335 |
| 1148 | $71,899 | $81,984 | $10,085 |
| 1143 | $5,385 | $12,114 | $6,729 |
| 1157 | $11,772 | $16,397 | $4,625 |

Those five jobs are exactly the rows flagged in red on the sheet that came with the
report, so somebody had already found the symptom.

**`getPartsCostPurchasedByJob`** (§30) sums the committed PO value on
`POH.PurchaseDate`. Stable, defensible, internally consistent — the stored grid values
matched it to one cent — and *not what the business measures*. July: $361,074 against the
pivot's $420,656, and per-job it is not close (1160: app $103,231, pivot $17,427).

So the answer was neither of them.

### 25.3 The corrected formula

`getPartsCostBookedByJob`, and it is now the only Money Spent Month definition.

| | |
|---|---|
| DATE | `APBD.APDocDate` — on the BATCH DOCUMENT table |
| AMOUNT | `APDocQty × APDocUnitPrice × (1 − APDocItemPctDisc) × APDocCurrRate` |
| SIGN | kept — a credit memo is a negative line and nets off |
| JOB | `APDD.ProjectID`, straight off the AP line |
| SCOPE | part-cost AP lines only; Extra Costs excluded |
| DEDUPE | none — the grain is already one row per booked AP line |

Qty, price and line discount live on the DETAIL; the currency rate and the date live on
the BATCH DOCUMENT. Mixing those up fails with `Invalid column name 'APDocCurrRate'`,
which is how the first attempt was caught.

**Naming trap worth recording.** §41.3 asks for "Purchased Date, not Invoice Date", and
the business calls the pivot's date the Purchased Date — but it is `APDocDate`, not
`POH.PurchaseDate`. On this basis a part bought in June and billed in July lands in
**July**, which is the opposite of §41.3's worked example. The reference report's rule
won, because §41.2 makes the report the reconciliation reference and §41.29.1 makes
matching it the acceptance criterion. This reverses §30.

### 25.4 The reconciliation

| | July 2026 |
|---|---|
| Total ETO pivot (net) | $420,656 |
| App before | $361,074 |
| **App after** | **$420,616** |
| Residual | **−$40 (0.0095%)** |

**31 of 35 jobs to the dollar.** The four that miss are 1118 (−$9), 1130 (−$6), 1153
(−$2), 1161 (−$23) — all in the same direction, the app slightly lower.

Two candidate explanations were tested and **eliminated**:

- *Unattributed AP lines.* Zero AP lines in July carry a null `ProjectID`, so nothing is
  missing from job mapping (§41.6 clean for this month). `getPartsCostBookedByJob`
  reports `unmatchedLines`/`unmatchedAmount` and `syncPartsCost` warns on them, so if that
  ever stops being true it will say so rather than silently drop the money.
- *Extra Costs.* July has $39,987 of shipping/fees/tariffs across 23 jobs, and including
  any of it moves the four jobs the WRONG way — 1153 carries $624.85 of extra costs while
  sitting $2 below the pivot, and 1161 carries none while sitting $23 below. So excluding
  Extra Costs is correct, and now measured rather than assumed.

The most likely remaining explanation is timing: all four gaps run the same direction, and
a credit memo posted after the pivot was exported would produce exactly that. Not proven.

Verified end to end in the running app: KPI strip "Parts spent" **$420,616** = bottom-row
Money Spent Month **$420,616**, and Money Left $3,993,063 = $4,413,679 − $420,616.

### 25.5 Also done

- **`monthWindowUtc`** extracted into `lib/etc.ts` and tested: half-open `[start,
  endExclusive)`, UTC, throwing on a malformed month. It was inline arithmetic in one
  place; it is now one definition, and the December→January rollover and the
  every-month-abuts-the-next property are pinned by tests.
- **`scripts/parts-spent-audit.ts`** — separates the four possible causes of a
  disagreement (basis / scope / staleness / job mapping) for any month, changes nothing.
- **`scripts/parts-spent-recon.ts`** — the §41.9 reconciliation, re-runnable.

### 25.6 Two scope corrections I had to make to my own audit

Both produced a confident wrong number before being caught, and both were the same
mistake: comparing totals across different job sets.

- The first audit reported "5 stale jobs, $29,465 drift" between the stored values and the
  app's own formula. That was entirely a scope mismatch — `stored` has rows for jobs the
  ETC grid no longer shows, `purchased` does not. Scoped correctly, the drift was **one
  cent**, on one job.
- Then the same bug in a different column: `tApp` summed stored values for jobs outside the
  pivot, making a reconciled month read $29,425 over.

A total is only a total of something. Both fixes are commented in the scripts.

### 25.7 Not done

- **§41.12–41.26 — the entire UI half is untouched.** No KPI card relayout, no Refresh
  Data relocation, no button tokens, no table-edge work, no responsive testing.
- The **six** KPI blocks (not five) were already consolidated into one card by §37.1, but
  they render as a 2×3 grid, so §41.13's single parallel row remains real work.
- **Refresh Data already exists in the sidebar** (`Sidebar.tsx`), and §29 deliberately put
  a second copy in the ETC toolbar and hides the sidebar one on that route. §41.16 asks to
  reverse that; it has not been done.
- **§41.10 needed nothing.** An undecided New ETC already contributes 0 to Diff and the
  cell renders empty — Money Left is never printed as Diff. I initially misread the
  history in `etc.ts` and thought this had to change; the rule directly below the one I
  read is the current, third revision. Now pinned by tests.
- **Only July 2026 is reconciled, and history is deliberately NOT restated.** Measured,
  because the decision needed evidence rather than caution: recomputing the eight most
  recent months on the new basis moves them by up to $1.8M, in BOTH directions —

  | Month | Stored | Corrected (AP) | Delta |
  |---|---|---|---|
  | 2026-06 | $1,001,070 | $1,436,342 | +$435,272 |
  | 2026-05 | $970,559 | $637,650 | −$332,908 |
  | 2026-04 | $266,173 | $969,842 | +$703,669 |
  | 2026-03 | $1,008,916 | $407,441 | −$601,475 |
  | 2026-02 | $2,698,803 | $1,051,194 | −$1,647,609 |
  | 2026-01 | $852,487 | $549,953 | −$302,534 |
  | 2025-12 | $107,121 | $1,939,202 | +$1,832,081 |

  Swinging both ways rules out one systematic basis error, and §26/§14 explain why: those
  figures have MIXED provenance — a Power BI "ETC Historical" backfill, June's import from
  the team's working Excel (which matched it to the dollar), and both TotalETO formulas at
  different times. There is exactly ONE pivot to reconcile against and it covers July, so a
  blind resync would replace signed-off, Excel-reconciled numbers with a recomputation
  nobody can check. It would also be recomputing a moving target: an AP ledger for a closed
  month legitimately changes as late documents post.

  `syncPartsCost`'s `isMonthLocked` guard already prevents it, and it stays. Restating any
  month is a per-month exercise needing that month's own ETO pivot;
  `scripts/parts-spent-audit.ts <YYYY-MM>` shows the gap for any of them without writing.
- No database indexes were added; the AP query is a monthly aggregate over an indexed date
  and was not slow.

---

## 26. The KPI card's parallel row, and one Refresh Data (2026-08-05)

The UI half of §41. Two of its asks turned out to be already done, one was done but not
working where it mattered, and one reverses a decision from §29.

### 26.1 Already in place

- **§41.12, consolidate the KPI cards.** Done by §37.1. Worth noting the count: there are
  **six** blocks, not the five §41 describes — Engineering hours, Shop hours, Parts spent,
  People booked, Undefined hours, and Hours off the grid (which appears conditionally).
- **§41.10, blank New ETC.** Already correct: an undecided cell contributes 0 to Diff and
  the cell renders empty via `isNewEtcDecided`, so Money Left is never printed as Diff.
  Now pinned by tests in `tests/money-spent-month.test.ts`.

### 26.2 §41.13 — the parallel row, and why it was not working

The strip already reached one row, at Tailwind's `xl`. `xl` is a **1280px viewport**, and
this card is not the viewport: it is inset by a sidebar that is ~276px expanded. So a
1440px laptop gives the card **1089px**, under the breakpoint, and the card fell back to
three columns and two rows on exactly the "normal desktop" width the requirement is about.
The breakpoint was measuring the wrong box.

Fixed by making the section a `@container` and replacing the whole breakpoint ladder — and
the `--kpi-cols` variable — with one rule:

    repeat(auto-fit, minmax(175px, 1fr))

`auto-fit` rather than a container-query threshold, because **the block count varies**.
"One row from 1100px" is right for six blocks (183px each) and wrong for seven (157px,
which clips), and a container query cannot read the block count in its condition — so any
single threshold is wrong for one of the two cases. A per-block minimum is right for both,
and it deleted `kpiGridStyle` along with the arbitrary-property class.

**175px is measured, not chosen.** Forcing the real card to N-across and checking every
text node for overflow: at 180px nothing clips; at 154px "24 eng · 21 shop" and "5 jobs not
listed" both do. (Two elements report overflow at every width — they are `sr-only` spans
with a 1px client width, and mistaking them for clipping is easy.)

Measured after, by constraining the card and reading the laid-out geometry:

| Card width | Rows | Per row | Equal height | Clipped | Detail links |
|---|---|---|---|---|---|
| 1089 (1440px viewport) | **1** | **6** | yes | 0 | 6 |
| 1180 | 1 | 6 | yes | 0 | 6 |
| 1000 | 2 | 3 | yes | 0 | 6 |
| 820 | 2 | 3 | yes | 0 | 6 |
| 560 | 2 | 3 | yes | 0 | 6 |
| 420 | 3 | 2 | yes | 0 | 6 |
| 340 | 6 | 1 | yes | 0 | 6 |

All six Detail drill-throughs survive at every width, nothing clips anywhere, and no width
needs horizontal scrolling. Browser zoom needs no separate handling: zoom changes the
card's effective width, so the same rule covers 80%–200%.

### 26.3 §41.16 — one Refresh Data, in the sidebar

Removed from the Monthly ETC toolbar; the sidebar copy is no longer route-gated.

This reverses §29, which had moved it INTO that toolbar on the reasoning that "one button
on every page beats one per page. True in the abstract, wrong in practice: this is the grid
people refresh, the sidebar collapses to a rail, and a control nobody can find is not a
control."

That objection is real, and it is answered by the rail rather than by a second button:
`compact={collapsed}` renders it as an icon with its label as a tooltip, so it never
disappears. There was only ever ONE refresh path (`lib/refresh-actions` →
`refresh-service` → `runAllSyncs`); every one of these changes has been about how many
buttons point at it. Verified on `/etc`: exactly one Refresh Data on screen, zero in
`<main>`, sitting beside Collapse as §41.17 asks.

`tests/refresh-data-placement.test.ts` counts call sites across the routes, because this
placement has now been reversed three times (§25, §29, §41.16) and each reversal looked
like "moved a button" in the diff while the actual failure mode was two buttons for one
action.

### 26.4 Not done

**§41.19–41.22 (button size tokens) and §41.23–41.25 (table edges) were not started.** No
shared size tokens per button category, no compaction pass, no table border/radius/edge
alignment work. §41.26's responsive sweep was done for the KPI card only — the buttons and
tables were not tested at the listed breakpoints or zoom levels.

---

## 27. Button geometry and table edges (2026-08-05)

§41.19–41.26. Both were framed as "make it consistent", so the first step was measuring
what was actually rendered rather than reading class strings — and the measurement found
§41.21's own worked example sitting in the Projects toolbar.

### 27.1 The audit

Every control in the Projects toolbar band, measured on the running production build:
**eight distinct heights and four distinct corner radii in one row.**

| Height | Controls |
|---|---|
| 15px | Select all, Clear (x2 groups) |
| 23px | − / + zoom steppers |
| 26px | Save current as view, Set as Team default |
| 28px | nested menu group summaries |
| **30px** | **Show all** |
| **34px** | **Read-only, Filters, Dates, Sections, Display, Views** |
| **39px** | **Export** |
| 42px | Start Date / Complete Date inputs |

The three bolded rows are the same visual line: six triggers at 34px, Export 5px taller,
and Show all 4px shorter between them. §41.21 lists "one unusually tall button beside
smaller controls" as the thing to avoid, and it was there literally.

Two other findings from the same pass:

- **`BUTTON_PRIMARY_SM`, `BUTTON_GHOST` and `BUTTON_DANGER` had zero call sites.** Three of
  the six categories §41.22 asks to standardise did not exist in the rendered UI at all.
- **"Select all" / "Clear" were 15px tall** — a bare underlined span, the text line and
  nothing else. §41.20 rules that out as a click target outright.

### 27.2 Tokens, and why the height is in rem

Height, radius and horizontal padding are no longer written per button:

| Category | Height | Radius | Padding |
|---|---|---|---|
| Standard — toolbar triggers, primary, secondary | `BTN_H_STANDARD` 2.4rem = **36px** | rounded-lg | px-3.5 |
| Compact — in-menu, in-row | `BTN_H_COMPACT` 1.9rem = ~28px | rounded-md | px-2.5 |

**rem, not px, and 2.4rem rather than `h-9`.** The root font-size is 15px and the sidebar's
Text size control moves it between 12 and 20 — a px height would stop matching its own
label the moment anyone touched that control, which is the same rem-vs-px trap the frozen
grid columns hit. And `h-9` is 2.25rem = 33.75px at the default root, *under* §41.20's 36px
floor, which is why the token is an explicit rem instead of a Tailwind step.

Note this is a **reduction**, per §41.19: primary and secondary were `px-5 py-2.5` → 39-40px
tall with 19px of side padding, and are now 36px with 13px.

Three dead tokens deleted, replaced by one live `BUTTON_COMPACT` (+ a danger variant and
`BUTTON_MENU_LINK` for the understated in-menu actions, which keeps the text-link look but
carries the compact height and a padded hit box).

### 27.3 After

Measured on the same toolbar, at the real 100% zoom with the default root font:

| | Before | After |
|---|---|---|
| Main toolbar row heights | 34, 34, 34, 34, 34, 34, **39**, **30** | **36 × 8** |
| Distinct radii in that row | 4 | **1** (7.5px) |
| Select all / Clear | **15px** | **29px** |

Zoom 80 / 100 / 125 / 150 / 200%: the row keeps a single uniform height at every level
(31, 40, 49, 59px as it scales), with zero clipped labels and zero overlapping controls.

Heights that remain different are all *inside dropdown panels* — the zoom steppers (23px),
the Views menu's two actions (26px), the nested group summaries (28px) and the date inputs
(42px). Those are separate categories in separate containers, which §41.21 allows; see
§27.5 for the ones that are still under an accessible target.

### 27.4 Table edges

The two big grids had drifted into two different treatments, and the shared `TABLE_CARD`
token was used by **neither** of them:

| | Corners | Border |
|---|---|---|
| Monthly ETC | sharp | `sdc-border` on three sides, `#808080` on top |
| Projects | `rounded-xl` | `sdc-border` all round |

The colour is not a taste call. `TABLE_GRID` gives every cell a **bottom and left** border
only, so the topmost cells have no top edge and the rightmost have no right edge — the
CONTAINER's border is literally the grid's top and right gridline. A different colour makes
the frame two-toned and the corners fail to meet, which is §41.23's "grid lines meet
cleanly" and "left and right table edges are visually complete". The ETC grid had noticed
half of this and matched its top border only; Projects had not noticed at all.

One `GRID_SCROLLER` token now, used by both: `#808080` on all four sides (from a named
`GRID_LINE_BORDER`, so the hex exists once), square corners, one `shadow-sm` on the frame.
Square because `rounded-xl` on a scroll container clips the corner cells' gridlines —
§41.23's "scroll containers do not cut off rounded corners incorrectly". A rounded frame
and a square grid cannot both be right, and the grid wins: these read as spreadsheets.

Verified on Projects: all four borders `rgb(128,128,128)`, identical to the cells' own
gridline colour, radius `0px`, one shadow. §41.25 needed nothing — there was never a
per-cell shadow or a blur.

### 27.5 Not done

- **The in-menu controls still under an accessible target.** The zoom steppers (23px) and
  the Views menu's two actions (26px) were measured but not resized. They are inside
  panels rather than the toolbar row, so they are not part of the §41.21 symmetry defect,
  but 23px is small for a click target and §41.20 would want them larger.
- **§41.26 was run on Projects only.** The zoom sweep and the width sweep covered that
  toolbar and grid plus the KPI card (§26.2); the ETC toolbar, the Employees and Audit Log
  tables and the modals were not measured at the listed breakpoints.
- **Row and header heights across tables were not normalised** (§41.24's "consistent header
  heights / row heights / cell padding" between tables). The two grids share `TABLE_GRID`
  and now share a frame, but their row density is still set per page.
- `tests/control-tokens.test.ts` pins the token relationships (one height per category, one
  radius, compact < standard, the 36px floor, rem not px, frame colour equals gridline
  colour, square corners, both pages on the shared scroller). It cannot check rendered
  geometry — that was the browser measurement above.

---

## 28. Hours read from Lisa's workbook again; Undefined Hours reconciled (2026-08-05)

Reported as "the refreshed hours, Undefined Hours KPI and its drill-through are not updating
correctly" (§42), with an explicit instruction not to apply a frontend refresh workaround.
That instruction was right, and for a reason nobody had established yet.

Full report, including all seventeen §42.31 deliverables: **`PAYLOCITY-INGESTION.md`**.

### 28.1 The app was never stale. The model it read was.

Hours moved to Power BI's `Hours Actual` on 2026-08-03 (§12 territory), on the evidence that
the two sources agreed on **1,127 of 1,127** job × section × month cells. That equivalence was
real. It was also measured across **settled months only**, so it could not show the one
property that mattered — the model lags the file:

```
                workbook      Power BI      database
2026-06        7,357.98h     7,357.98h     7,358.01h      0 cells differ
2026-07        6,823.60h     6,673.07h     6,673.07h     46 cells differ
2026-08          293.50h         0.00h         0.00h     56 cells differ
```

Workbook latest work date 2026-08-04; Power BI latest 2026-07-31. **Power BI → database was
exact.** The app imported faithfully; all the staleness was upstream of it. So no cache fix,
no refetch, no UI change could have helped — the data was not there to fetch.

June matching to the penny with **zero** differing cells is what made the switch back safe:
for a settled month the file and the model are the same data, and the file is days earlier.

### 28.2 Three traps, all of which present as "nearly right"

**Punch segments are not duplicates.** 7,460 `(employee, date, job, section)` keys repeat, and
only 21 differ by any other column. The rest look like `hours [1.5, 7.5]` — one clock-in/out
pair each. A duplicate detector would have discarded 7,439 legitimate rows and understated
every month. At this grain the file genuinely cannot distinguish a duplicate from two equal
segments, so idempotency rests on the content hash and the replace-by-`(job, month)` write
instead. Caught because the count looked absurd next to a June total that was nonetheless
exact.

**Aggregate-then-round versus round-then-aggregate, twice in one day.** First as a false
alarm: comparing raw workbook sums against pre-rounded stored rows reported 31–47 differing
cells a month while every month total agreed to within 0.07h on ~7,000h — six settled months
flagged as history rewrites that were nothing of the kind. Then as a real defect: the KPI
total was summed raw and rounded once while the drill summed individually-rounded rows,
mismatching by +0.04h (2026-06) and +0.01h (2026-07). Small, but §42.11 makes any mismatch a
calculation failure, and the new reconciliation banner duly showed it in red on its first live
run. Round at the storage grain first, then sum.

**`prisma migrate diff` wanted to `DROP COLUMN RefreshRun.currentStage`.** The column is live
and used by raw SQL in `refresh-service.ts`, but had never been declared in `schema.prisma`.
Applying the generated migration unreviewed would have broken refresh progress — the feature
§42.15 asks to extend. Read the generated SQL before applying it.

### 28.3 The shape now

`lib/hours-feed.ts` is the single entry point. It reads `lib/paylocity-workbook.ts` (sheet
`Report`, headers by name, sha256 identity, stat-read-stat atomicity, typed failure stages)
and there is deliberately **no fallback to Power BI on failure** — the model runs behind, so
falling back would overwrite fresh figures with stale ones, the "mixed old and new metrics"
§42.19 forbids. `HOURS_SOURCE=power_bi` reverts by hand. Power BI still supplies the Function
Hierarchy code→column map, which is static metadata rather than hours, and still owns
2025-02…2025-12, which the workbook does not reach.

`lib/undefined-hours-rules.ts` is THE Undefined Hours definition and has no I/O at all — that
is what makes "one centralized definition" structural rather than a convention, and it is the
only reason the rules are unit-testable at all (tests can import server-only modules only as
erased `import type`). `UndefinedHoursRow` persists the punch rows and `HoursImportIssue` the
totals, **written from one pass in one transaction**, so KPI = SUM(drill) by construction. The
drill also stopped costing a live DAX round-trip per click.

### 28.4 Verified

```
2026-07   6,673.07h -> 6,825.98h   (+152.91)
2026-08       0.00h ->   520.23h   (+520.23)
2025-12   5,964.29h -> 5,964.29h   (history untouched)

KPI vs drill   2026-06  matches 240.47h    2026-07  matches 195.80h    2026-08  matches 8.00h
idempotency    a second consecutive import: 0.00h delta on every month, status "unchanged"
suite          621 tests, 621 pass
```

### 28.5 Not done

The visual pass is partial. The Undefined Hours drill was rebuilt (`UndefinedHoursPanel`:
reason breakdown with corrective actions, affected-employee count, reconciliation banner,
per-reason filtering, source row numbers) and the `failed`/`invalid` cell states were
separated — they had been rendering identically despite demanding opposite responses. **Not**
done: the §42.24/§42.26 table, header and bottom-totals pass; §42.29 responsive and zoom
testing, including of the new panel; §42.32 visual-regression tests, for which this repo has
no harness.

One unexplained thing worth chasing: a full `refreshAllData()` pass hung for over ten minutes
on the TotalETO or Scheduler step. Both are external and unrelated to §42, so the hours path
was verified on its own — but the hang is real and is not diagnosed.

### 28.6 "The hours don't match Power BI" — they aren't supposed to (§43, same day)

Reported hours later: the report shows July Engineering 3,020 / Shop 2,680 /
Manufacturing 676; the grid footer shows 3,154 / 2,698. Asked to correct the formulas so
the two match exactly.

Nothing was corrected, because nothing was wrong. Both gaps close to the penny:

```
ENG    3,153.81  app        SHOP   2,697.91  app
        +  5.00  Warranty            +  4.86  Warranty 4.78 + Service 0.08
      = 3,158.81  ≙ PBI def         = 2,702.77  ≙ PBI def exactly
        −138.83  freshness           − 22.77  freshness
      = 3,020.00  the report        = 2,680.00  the report
```

Two causes, both correct behaviour. **Freshness:** the app reads Lisa's file (through
08-04) while the report reads a model that refreshes separately (through 07-31), so the
app is *ahead* by ~161h of July. **Definition:** Power BI buckets by FUNCTION regardless of
phase, so Warranty and Service land inside its Engineering and Shop figures; the ETC grid's
fixed 9+4-code formula excludes them, as signed off on 2026-07-31. Manufacturing is not
missing either — all 688.62h is imported, off the grid by design in the
`SHOP_MANUFACTURING` pool.

The import itself is faithful to **0.02h**. No missing records, no duplicates, no mapping
error.

Two traps worth knowing before anyone reconciles these again. `Job.id` is an autoincrement
surrogate and `Job.jobId` is the job number; `JobHoursDetail.jobId` references the
surrogate while the workbook carries the number, so joining on the wrong one reports a
clean **0.00h** rather than an error — it cost two runs. And the workbook must be parsed
**raw** for this comparison: `readPaylocityWorkbook` has already applied
`mapPunchToColumns`, and checking the app's mapping against itself proves nothing.

Confirmed with the user: change neither difference. Instead the vintage is now stated —
the ETC header reads "Hours through 2026-08-04" with a tooltip covering both causes, and
the refresh toast says "Hours are complete through 2026-08-04". Full decomposition in
`PAYLOCITY-INGESTION.md` §43.

## 29. One universal zoom, and the six controls it replaced (2026-08-05)

Reported as §45: "Replace all separate text-size and density controls with one universal app
zoom control." One `− 100% +` in the sidebar, on every page, scaling *everything*.

### 29.1 What was actually there: six axes, one of which was half a control

| Control | Where | Wrote | Range |
|---|---|---|---|
| Text size | Sidebar footer | root `font-size` | 12–20px |
| Font size | Monthly ETC → View | `--etc-font-size` | 4–24px |
| Row height | Monthly ETC → View | `--etc-row-py` | 0–16px |
| Column width | Monthly ETC → View | `--etc-col-px` | 0–16px |
| Row height | Projects → Display | `--quoted-row-py` | 0–16px |
| Column width | Projects → Display | `--quoted-col-px` | 0–16px |

Six independent axes, five localStorage keys, five mount effects to restore them, and a sixth
key for the root size. Four of the six were **per-tab**, which is the thing §45 names outright:
Monthly ETC could sit at one density and Projects at another, in the same app, for the same
user.

And the sidebar "Text size" only ever did half its job. It moved the root font size, so it
reached everything written in `rem` and **nothing** written in px — and this app's chrome is
deliberately in px. Turning it up grew the grids and left the sidebar, the toolbars and the nav
exactly where they were. The sidebar even carried a comment defending that: *"Sizes are in px,
not rem, deliberately… letting the app chrome grow with it made the nav crowd the content."*
Which is a sound argument against a root-font-size control, not for one.

### 29.2 Why CSS `zoom`, decided by measurement rather than preference

Three candidates. `transform: scale()` was ruled out on principle: it scales *after* layout, so
sticky headers stop sticking where they should, scroll containers keep their unscaled
`scrollHeight`, and hit-testing drifts from what you see — on an app that is two large frozen
grids, that is not a trade-off, it is a break. A root-font-size control is what was already
there, and §29.1 is its obituary.

`zoom` participates in layout and scales the used value of *every* length — padding, borders,
icon boxes, widths, gaps — not just the ones that happen to be in `rem`. So it is the only one
of the three that is genuinely "one lever over all visible application content".

Before writing any of it, a probe page measured what `zoom` on `<html>` actually does in this
browser, because two things had to be true and one of them was not:

```
zoom   viewport   height:100vh   fixed inset-0
1.0      720px        720px          720px      ✓
0.75     720px        540px          720px      ← vh is NOT corrected
1.25     720px        900px          720px      ← 180px below the fold
1.5      720px       1080px          720px
```

`position: fixed` needs no help at all — a `fixed inset-0` overlay covers the viewport exactly
at every level, so every modal, toast and notification stack was already correct. But **`vh`
resolves against the unzoomed viewport and is then scaled with everything else**, so a
`h-screen` sidebar hangs a quarter of a screen off the bottom at 125%.

That is the whole catch, and it is fixed centrally:

```css
--app-zoom: 1;
--app-vh: calc(100vh / var(--app-zoom));
--app-vw: calc(100vw / var(--app-zoom));
html { font-size: 15px; zoom: var(--app-zoom); }
```

Twenty-one viewport-relative lengths across sixteen files now read those two variables instead
of `vh`/`vw` — the sidebar, both grid scrollers, the AG Grid host, four `JobProcurement`
panels, three modals, two filter popovers, the pool panel, the password gate, the error and 404
pages, the login page and the toast stack. `tests/app-zoom.test.ts` fails the build if a
component reaches for a raw `vh`/`vw` again, because `h-screen` looks correct and is wrong at
six of the seven levels.

### 29.3 Nothing on screen moved at 100%

The constraint that made this safe to ship: every retired variable is replaced by the value it
already defaulted to, so 100% is the old app. Verified live, not assumed:

| | before | after |
|---|---|---|
| ETC body cell padding | `var(--etc-row-py, 4px)` → 4px | `0.2667rem` → **4.0005px** |
| Projects body cell padding | `var(--quoted-row-py, 6px)` → 6px | `0.4rem` → **6px** |
| Projects data column | `calc(max(4.7rem,72px) + 2*4px)` → 80px | **80px** |
| ETC grid text | `var(--etc-font-size, 0.68rem)` → 10.2px | **10.2px** |

`--app-vh` is `calc(100vh / 1)` at the default, so every converted length is identical too: the
ETC scroller still computes 537px against a 720px viewport.

The `table[data-grid="etc"]` font-size rule went with the Font size box that §39.14 had added it
for. Worth remembering *why* that rule existed: the stepper had never worked, because
globals.css carries an un-layered `table, table * { font-size: … !important }` and an important
declaration outside any layer beats a normal one inside `@layer utilities` whatever the
specificity. Setting `--etc-font-size` to 22px moved a cell from 10.2px to 10.2px.

### 29.4 Measured at all seven levels, on the real grids

Monthly ETC (49 jobs × 83 columns), scrolled to (1200, 400) at each level:

```
zoom                 75%    80%    90%   100%   110%   125%   150%
row height          17.2   18.3   20.4   22.7   24.9   28.2   34.3  px  (proportional)
sidebar = viewport     ✓      ✓      ✓      ✓      ✓      ✓      ✓       (exactly one screen)
column drift, rows     0      0      0      0      0      0      0  px  (first vs last row)
column drift, totals   0      0      0      0      0      0      0  px  (tfoot vs body)
frozen cols pinned   0.7    0.7    0.7    0.7    0.7    0.7    1.3  px  (= the 1px border)
sticky header top    0.7    0.7    0.7    0.7    0.7    0.7    1.3  px
page h-overflow        0      0      0      0      0      0      0  px
```

Frozen columns, the sticky header and the pinned totals row hold to **zero** drift at every
level — the property `transform: scale()` would have cost.

Also verified: **cell editing** at 125% — `elementFromPoint` at a cell's visual centre resolves
to that cell's own input, the input still fills its `td` exactly, arrow keys move down and back
within the column, typing is accepted. **Dropdowns** scale rather than drift (the View menu's
panel sits 7.5px below its trigger at 100% and 11.3px at 150% — exactly ×1.5 — and stays inside
the viewport). **The collapsed rail** keeps all three controls inside its 60px and they still
work. **Persistence** across a client-side tab switch (90% held, one navigation entry, no
reload) and across a hard reload (125% restored by the pre-paint script, `navType: "navigate"`).
**KPI cards** wrap without a single element escaping `main`.

And the requirement that matters most for how it feels — a full 75% → 150% → 100% sweep issued
**zero network requests and zero navigations**. Zoom is one custom-property write on `<html>`;
no React state, no re-render of a cell, no refetch.

### 29.5 The one real bug it surfaced, and the one it did not

The hours drill-through pushed a **138px horizontal scrollbar onto the whole page at 125%**. The
cause was not zoom: a native `<select>` sizes itself to its widest option, and as a flex item it
defaults to `min-width: auto`, so the job filter — whose longest option is a full job name —
demanded 360px inside a ~500px column and could not shrink. `flex-wrap` on the row does not
help; the row can wrap, one un-shrinkable item cannot.

Proved pre-existing by reproducing it at **100% zoom in a 1090px window** (124px of overflow —
the same available width). Zooming in narrows the effective viewport, which is why it surfaced
there first; anyone on a small laptop already had it. Fixed with `min-w-0 max-w-[14rem]` on that
control.

At 150% in a 1360px window there is still ~229px of page overflow, and that one is **left alone
deliberately**. 150% leaves the app ~907 layout px, and the same page overflows by 157px in a
907px window at 100% zoom: the drill panel's two-column `flex gap-3` has no narrow-width layout
to fall back to. Giving it one is a redesign of that panel, not a zoom fix. Nothing is clipped
or unreachable — the page scrolls — and every other page is at zero overflow at every level.

### 29.6 Two smaller decisions worth recording

**The steppers step from the DOM, not from React state.** `useSyncExternalStore` gives the label
and the two disabled ends, but a handler closed over that value holds whatever the last render
saw — so two clicks landing before a re-render would both compute `stepZoom(sameValue, +1)` and
the second would be swallowed. `currentZoom()` reads the applied custom property, which cannot
be stale because setting it *is* the operation. The retired density steppers had reasoned this
out already: *"the CSS variable itself is the only source of truth, read straight off the DOM on
every click."*

**Zoom is not part of a saved View.** `ProjectViewsMenu` used to snapshot Grid Size, and the
temptation was to snapshot zoom in its place. A view is a claim about which figures you are
looking at; loading one should not resize somebody's whole application. `ViewConfig.grid` is
kept as a deprecated graveyard field so views already published still parse and re-publish
without dropping data.

Not taken: Ctrl+/Ctrl− key bindings. §45 asks that browser zoom keep working independently, and
those are the browser's own shortcuts — they compose with this one for free.

## 30. The collapsed sidebar, audited (2026-08-05)

Reported as §46 from a screenshot: "controls are clipped, labels overlap, content begins too
close to the sidebar, bottom controls are partially hidden". Audited in the running app before
changing anything. Nine defects, four of them invisible in the screenshot.

### 30.1 What was actually wrong

| | Defect | Measured |
|---|---|---|
| D1 | Footer buttons `flex-1` inside a `flex-col` | Refresh **h=14**, Expand **h=14** (both declared `h-[30px]`) |
| D2 | `RefreshDataButton` compact rendered the WORDS "Refresh Data" | 73px span in a 59px button → clipped to "Refresh Dat" |
| D3 | Collapsed state in localStorage, invisible to the server | SSR returned `<aside style="width:276px">` with every label, the search field and the version |
| D4 | Labels unmounted rather than hidden | link accessible name gone; `title` the only source |
| D5 | Sign out and the user identity were expanded-only | **no way to sign out without expanding first** |
| D6 | Nav padded `14px` a side in a 60px rail | click targets 31px wide; a click 10px inside the rail hit nothing |
| D7 | Group `gap-5` kept after hiding the headings | 36/37px between items vs **52/53px** between groups |
| D8 | Active accent bar on a 31px item's left edge | sat at x=14 — floating mid-rail, pointing at nothing |
| D9 | No `aria-current` anywhere in the app | the current page was three visual cues and nothing else |

D1 is the screenshot. It is worth stating precisely, because the symptom looks nothing like the
cause: the aside is a fixed-height column (`h-[var(--app-vh)]`) with the nav as `flex-1`, and
the two footer buttons carried `flex-1` so they could share a row when expanded. Collapsed, the
footer becomes a `flex-col` — and there `flex-1` is a rule about HEIGHT. `flex: 1 1 0%` sets
`flex-basis: 0`, which beats `h-[30px]` on the main axis. So both 30px buttons rendered 14px
tall, and the label inside the shorter one was clipped by the button's own `overflow-hidden`.

The fix is structural: the footer is `shrink-0`, and `flex-1` is applied only in the state that
wants it. Both buttons now measure **h=30** in the rail.

### 30.2 The state had to move to a cookie

D3 cannot be fixed inside the component. The flash happens before any of it runs: the server
does not know the sidebar is collapsed, so it renders the expanded one, and the rail appears
when the store reads localStorage after hydration. §46.14 forbids exactly that ("do not briefly
expand it during route transitions").

So collapse and width are cookies now (`lib/sidebar-prefs.ts`), read in the (app) layout and
handed to `AppShell` → `Sidebar` as the external store's **server snapshot**. The value React
hydrates with is the value already painted. Verified: a request with the flag set now returns
`<aside style="width:4rem">`, no search field, and the Refresh label as `sr-only` rather than a
visible truncating span.

§45's zoom preference deliberately stayed in localStorage, and that is not a contradiction. Zoom
is applied by a pre-paint script writing one custom property — the HTML is identical at every
level, so the server never needs to know. The sidebar changes the markup. And the cookie is
free here: the (app) layout already awaits `auth()`, which reads cookies and is what makes every
route under it dynamic.

### 30.3 Two bugs the audit found that nobody had reported

**The rail's scrollbar was un-centring the icons.** At 150% app zoom on an 820px viewport the
nav overflows and scrolls — which is what §46.5 asks for. But a classic scrollbar takes its
width out of the CONTENT box: measured `offsetWidth 59, clientWidth 49`, so every nav icon sat
5px left of the rail's centre while the footer icons, in a container that does not scroll,
stayed centred. Two columns of icons, visibly misaligned, and only when the rail happened to
overflow. `.rail-scroll` hides the scrollbar so the content box is the full rail at all times;
the wheel and Tab still scroll it. (`scrollbar-gutter: stable both-edges` centres correctly and
was rejected: it reserves 2 × 10px permanently out of a 60px rail, which is less room than the
32px targets D6 had just fixed.)

**The sidebar had opted itself out of the app's focus ring.** globals.css carries
`.bg-sdc-navy :focus-visible { outline-color: #fff }` because the default ring is `--sdc-blue`,
which on this panel is blue on navy. The sidebar spelled its background as the arbitrary value
`bg-[#061D39]` — the same colour as the token, `--sdc-navy: #061d39` — so the override had never
matched it. Confirmed in the running app: `aside.closest('.bg-sdc-navy')` was `null`. One class
change, no visual change to the panel (`rgb(6, 29, 57)` either way), and a real Tab press now
reports `outline: solid 2px rgb(255, 255, 255)` on the focused rail link. That matters more in
the rail than anywhere else in the app: the label is hidden there, so focus is the only cue.

### 30.4 Hidden, never removed

Every label that disappears in the rail is now `sr-only` instead of unmounted — nav labels, the
wordmark, group headings, Back, the toggle, Sign out, the version string. §46.15 asks for it
outright ("do not remove navigation labels from screen readers when visually hiding them"), and
it also fixes D4's quieter consequence: a control whose text is gone has no accessible name but
its `title`, which the same clause rules out.

Added while there: `aria-current="page"` on the active link (D9 — missing app-wide, not just in
the rail), and `aria-expanded` + `aria-controls` on the toggle. Result: 14 focusables in the
rail, **0 without an accessible name**, DOM order matching visual order, no positive tabindex.

### 30.5 Verified

Collapsed, on all seven §45 zoom levels:

```
zoom              75%   80%   90%  100%  110%  125%  150%
rail width         45    48    54    60    66    75    90  px
escaping the rail   0     0     0     0     0     0     0
overlapping         0     0     0     0     0     0     0
past the viewport   0     0     0     0     0     0     0
max off-centre    0.3   0.3   0.3   0.3   0.3   0.3   0.7  px
nav scrollbar       0     0     0     0     0     0     0  px
```

At 150% the nav scrolls (14 of 16 controls on screen, the rest one wheel-tick away) and the
footer stays fully visible — §46.5's "controlled internal sidebar scroll area without hiding
essential actions". Same at a 600px-tall viewport: Zoom, Refresh, Expand and Sign out all
fully visible, nav scrolling.

All six pages collapsed — Dashboard, Employees, Projects, Monthly ETC, Job Hour Details, Audit
Log — report rail 60px, 0 escaping, 0 overlaps, `main` at exactly 60 and **0 content elements
overlapping the rail**, with the collapse surviving every client-side navigation.

The transition (§46.10), frame by frame with the reduced-motion suppression lifted:
`276 → 178 → 80 → 60` over ~200ms, and the gap between the aside's right edge and `main`'s left
edge was **0 on every intermediate frame**. It cannot be otherwise — `main` is `flex-1` off the
aside's width, so there is one animation and the content cannot lag it.

Performance (§46.16), collapse + expand on Monthly ETC with 4,150 cells: **0 new requests, 0 SSE
reconnects, scroll position preserved exactly (900, 250), identical cell count, and the
scroller node never remounted.**

`--sidebar-w` is published on the shell as §46.9 asks. Worth recording that the clause's real
concern did not apply: no page has ever had a hardcoded sidebar margin — the offset is
structural. The variable's own hazard was the one it warns about, and it was mine: rendered from
the server's value, it would have read 276px forever after a client-side collapse. `Sidebar`
updates it on change, and both writers derive it from `sidebarWidthCss` so there is one formula.

### 30.6 Not changed

The search field is still unmounted in the rail rather than `sr-only`. Everything else that
disappears is static text; this is a focusable text input, and leaving a keyboard-reachable
invisible field in a 60px rail — which Ctrl+K would then focus — is worse than not offering it.

The 30px gap between the rail and page content is unchanged, and is the same gap the expanded
sidebar has. It comes from each page's own padding, so content begins at the identical offset in
both states, which is what §46.1 asks for.

## 31. The drill-throughs, redesigned from the KPI reference (2026-08-05)

Reference: `KPI Card Redesign/KPI Summary Card.dc.html`, with the drill panel screenshotted
as the target. §47.

### 31.1 The reference's palette is not in the app, deliberately

The mockup is drawn in a warm-gray scheme — `#f4f4f2` ground, `#e2e0d9` borders, `#16233a`
ink, `#2b5f8e` links — in Inter Tight and IBM Plex Mono. None of that shipped. This app has
a committed brand palette and one type scale, both test-guarded (§39), and a second palette
living inside one component is precisely the "duplicate theme definitions" §39.16 forbids —
it is how the charts came to render in a different font from the rest of the app.

So the reference's **structure, spacing, hierarchy and interaction** were adopted and its hex
values were mapped:

```
#16233a ink        -> text-sdc-navy        #e2e0d9 panel border -> border-sdc-border
#22221c row name   -> text-sdc-gray-700    #eeece5 section rule -> border-sdc-border
#8b8b82 secondary  -> text-sdc-muted       #f3f2ec row hairline -> border-sdc-border-soft
#2b5f8e link       -> text-sdc-blue-dark   #f4f3ee chip tray    -> bg-sdc-gray-100
IBM Plex Mono      -> font-mono            Inter Tight          -> the app's font-sans
```

Two of its tiers were dropped rather than mapped. `#9a998f` (2.87:1) and `#a9a89f` (2.39:1)
fail WCAG AA, and this panel renders financial figures at 10–11px; the mockup's own darker
`#8b8b82` is 3.44:1 and also fails. Everything secondary uses one AA-passing tone instead.
`tests/drill-design.test.ts` fails the build if any of those fourteen hex values appears in a
drill component.

### 31.2 The muted tone the app never had

Applying the reference's hierarchy surfaced the reason it had never read that way:
**`sdc-gray-500` was written 107 times across 39 files and was never declared.**

Tailwind v4 needs a value in `:root` and a `--color-*` alias in `@theme`; `sdc-gray-500` had
neither, so `.text-sdc-gray-500` emitted no CSS at all. Verified in the running app — the
class matched no rule and the element inherited its parent's colour:

```
.text-sdc-gray-500 rule in stylesheet : (NONE)
computed colour                       : rgb(35, 31, 32)   ← full body ink
parent colour                         : rgb(35, 31, 32)
```

So every "secondary" line in the app — panel subtitles, group counts, helper text, the
drill-throughs' entire second tier — had been rendering at the same weight as primary text.
Not a subtle regression: the hierarchy those 107 call sites were asking for simply was not
there, and no amount of restyling the drills would have produced it.

It is **not** called `gray-500`. The neutral ramp runs 50 → 100 → 400 → 600 → 700
light-to-dark, so a monotonic "500" would have to be darker than `#3d3d3d`, which is not
muted at all — the name was the reason nobody noticed it was missing. It gets a semantic name
like `--sdc-red-text` and `--sdc-yellow-text` already have, and the 107 call sites were
renamed to `text-sdc-muted`.

`#6e6a6b` is a literal tint of the brand Black toward the brand Gray, chosen by contrast
rather than by eye: **5.33:1 on white, 5.11:1 on gray-50, 4.76:1 on gray-100** — AA on every
surface the app puts it on, asserted arithmetically in the test rather than by a comment.

### 31.3 Three drills, three designs, agreeing on none of five decisions

| | HoursDetailPanel | UndefinedHoursPanel | DataQualityDrill |
|---|---|---|---|
| header row | navy fill, white bold caps | grey `TABLE_HEADER_ROW` | navy fill, white bold caps |
| row separation | zebra stripes | hairlines | zebra stripes |
| cell borders | `TABLE_GRID` — every cell | none | none |
| caret | `▶` rotated | `▼`/`▶` glyph swap | n/a |
| total row | `bg-gray-100`, "Total" | `border-t-2 border-navy`, "Shown" | n/a |

Five decisions, made three times. So the design moved into `components/ui/Drill.tsx` and the
panels supply data — which is also what makes the redesign hold rather than drift again.

The distinction it encodes is worth stating, because it is why the grid tokens were left
alone: **grids read as spreadsheets, drills read as reports.** Monthly ETC and Projects keep
`TABLE_GRID` and `GRID_SCROLLER` — full gridlines, sharp corners, every cell bordered — and
that stays (§41.23); people edit them. A drill is read, not edited; it is a rollup, not a
matrix; its columns are few and wide. Hairlines between rows only, and hierarchy from type.
A test now fails if a drill reaches for a grid token, or a grid treatment.

One structural fix came with it. The group rows and the punch lines inside them have
different column counts, which the old code solved with a `colSpan={groupBy.length + 1}`
nested table — a hand-counted number that does not error when it is wrong, it just puts the
total in the wrong column. The rollup is a CSS grid now, and one `template()` supplies the
header, every group row and the total, so they cannot disagree.

### 31.4 What was NOT taken from the reference

**Single-select group tabs.** The mockup offers five radio tabs (Department / Employee /
Section / Job / None). The app's grouping is multi-level and click-ordered — "Department ›
Employee" is a real question, and the ordinal prefixes say which level is which. The tray
takes the reference's LOOK (inset well, selected option raised to white) and keeps the app's
behaviour, with `aria-pressed` saying which it is. Its "None" became "Lines", which is what
it shows, and it moved INTO the tray — replacing a separate Ungroup button, so one control
answers "how is this rolled up" including the answer "not at all".

**"All lines" as a collapsed group.** The mockup's ungrouped view is a single group row you
must expand. These panels have always shown the lines on arrival; making that a click is a
step backwards, so ungrouped still renders the list directly, with its total in the table's
own `<tfoot>` where it cannot drift from the column it totals.

### 31.5 The footer, which is new behaviour

The reference's footer links are real now. "Open full report" goes to Job Hour Details, and
only where there is a fuller report to open — on the per-job drill this panel already IS the
job's full punch list, so the link would point at itself.

"Export CSV" writes what is **on screen**: the filtered rows, which is the point of exporting
from a drill rather than from the page. Always the punch lines, never the rollup, whatever the
grouping — a CSV of "Mechanical Engineering, 56" is not something anyone can work with, and
the rollup is a pivot away in whatever they open it in. It goes through `lib/export/csv.ts`'s
`csvRow`, with the UTF-8 BOM the grid exports already write so Excel does not mangle the em
dashes in job names.

### 31.6 Verified

Measured in the running app against the reference, on the Engineering hours drill:

```
                        reference          shipped
heading                 15px / 600         15px / 600
meta line               secondary tone     rgb(110,106,107)  ← the muted token, resolving
column header           10px 600 .1em up   10.0px 600 1.0px uppercase
group row cell borders   none               0px
total row               faint fill         rgb(250,250,250)
footer                  2 links            Open full report · Export CSV
```

Structure, on real data: `3 groups by department · 678 of 678 lines`, group rows
`▶ Mechanical Engineering · 262 lines · 1,337`, total `3,154` — which is the figure on the
card that opened it. Expansion: 270px max-height with its own scroll, indented 22.5px,
sticky sub-header, and the grouped dimension correctly absent from the line columns
(`Date · Job · Employee · Section · Hours` when grouped by department). The caret rotates
90° — checked on the `rotate` property, not `transform`, because Tailwind v4 emits the
standalone property and reading `transform` reports "none" on a caret that is rotating
perfectly well.

Undefined hours, same design: `4 groups by department · 49 of 49 records`, total **196**,
matching its KPI and its own reconciliation line. No navy band and no `border-t-2` rule left
in either panel. Zero page overflow.

### 31.7 Not done

`DataQualityDrill`'s three tables took the report treatment — muted header, hairlines, no
zebra — but they are still plain `<table>`s rather than the shared components. They have no
groups to hang off `DrillGroup`, so routing them through it would mean widening the
component's contract to earn nothing; the header treatment is spelled out there instead, with
a comment pointing at the one it must match. If a fourth drill appears, that is the moment to
make the flat case a component too.

## 32. Show Standards, made instant (2026-08-05)

Reported as §48: the Standard Fees card takes too long to appear after the password. Audited
first. The wait had nothing to do with the card.

### 32.1 Measured before touching anything

```
first sidebar click -> password box on screen   6,077ms    8 requests
submit -> answer                                2,911ms    4 requests   190KB
```

Nine seconds, and every millisecond of it was work unrelated to what the user asked for.

**Opening the box cost four page renders.** The gesture was three clicks inside 1500ms and
then `router.push("/etc?standards=1")` — but the sidebar item is a `<Link href="/etc">`, so
each of the three *counting* clicks navigated as well. Four full renders of the heaviest
page in the app (49 jobs × 83 columns, the KPI card, every query behind them) to show a
text input. It was also why the gesture felt unreliable: the round trip ate most of the
1500ms window, so the third click regularly arrived after the streak had reset.

**Submitting it cost a fifth.** `unlockStandardSheet` ended in `revalidatePath("/etc")`, so
revealing the card re-rendered the whole page — including on the WRONG password, which paid
the same 190KB to say "wrong password".

### 32.2 After

```
first sidebar click -> password box               7ms    0 requests
submit -> answer                                 94ms    1 request    0KB
12 rapid clicks                             1 prompt    0 requests
```

The gesture sets a boolean (`lib/standards-reveal.ts`) and `preventDefault` stops the click
navigating; already on /etc there is **no request at all**. Validation is one server action
returning `{ ok }` instead of revalidating a route. Nothing else on the page is asked to
re-render, which is how the grid's scroll position, filters, focused cell and unsaved edits
survive — not by preserving them, but by never disturbing them. Verified in the same run:
same table node, same 4,150 cells, scroll preserved at (700, 260), the focused cell still in
the document.

Two clicks now, not three, inside 600ms rather than 1500. Shorter is both safer and
steadier once there is no navigation in the way.

### 32.3 The card loads only itself

`StandardPoolPanel`'s props were computed inside the page's `if (showStandards)` block, so
the only way to make the card appear was to make the server render everything else too.
`lib/standard-fees-card.ts` now gathers that card's own inputs and nothing else — four
independent reads in one wave — and `StandardFeesCard` holds the visibility, the data, the
dedupe (one request per month in flight, answers for a month no longer shown discarded) and
the shell-with-spinner for when the figures are not in hand yet.

An **already-unlocked** visitor pays nothing: the page passes the figures it already
computed as `initialData`, so there is no action call and no spinner at all.

### 32.4 The security model is unchanged, and one line of it is load-bearing

The phrase is still compared server-side in constant time and never reaches the browser; the
new action returns one boolean, which tells an attacker exactly what a 200-vs-error already
told them. The HMAC cookie is still the authority.

§48 asks to "preload or **safely** cache the Standard Fees data when the Monthly ETC page
loads". Safely is doing real work in that sentence: `initialData` is non-null **only when
the request that rendered the page already carried the cookie**. Preloading the figures for
a locked visitor so their reveal could be instant would hand the confidential numbers to
precisely the person the gate exists to keep them from. Verified: locked, the card renders
nothing and the page ships no figures.

`getStandardFeesCard` calls `assertStandardSheetUnlocked()` before reading a single value —
a server action is directly callable by anyone who captures its id, so that check, not the
page's decision to render, is the boundary. A test asserts the guard precedes every read.

The old `<form action={unlockStandardSheet}>` is kept for the `?standards=1` URL only, as
the no-JavaScript path: behind this control sits a page of confidential figures, and losing
the way in to a bundle that failed to load would be a poor trade for deleting nine lines.

### 32.5 Not verified by me

The **correct**-password path. Exercising it needs the live phrase, and reading
`STANDARD_SHEET_PASSWORD` out of `.env` to type into a browser is not something to do for a
convenience test — the attempt was correctly refused, and the alternative (a throwaway
phrase on the same origin so the session survives) needs a restart of a launch config the
running server holds locked.

So the success path is covered by construction and by test rather than by observation: the
wrong-password path is verified live end to end, `markStandardsUnlocked()` is unit-tested to
close the prompt and reveal in one step, and the card's fetch/dedupe/failure paths are
tested. **Worth one human click-through before this is trusted in front of the team.**

Also unchanged: the Standard columns inside the grid still come from a server render. They
are part of the table, and shipping them hidden so they could be revealed client-side would
put the confidential figures in every locked visitor's HTML — the §44 CSS-hiding trick is
right for dept/jobname and wrong here. The card, which is what §48 asked for, no longer
waits on that.

---

## 33. The summary card stopped stretching (2026-08-05)

Reported as §49: when a drill-through opens beside the KPI summary card, the summary card
grows a large empty area to match it. Reverse that, cap the drill instead, and scroll it
internally.

### 33.1 The empty area was the previous instruction, read the other way

The drill has opened *beside* the summary card since §26, which was the fix for a drill
pushing the grid down by a whole panel every time somebody looked at a figure. That layout
first shipped with `items-start`; it was then changed to flex's default `stretch`, with a
`[&>*]:h-full` on the drill column to finish the job, on the instruction that "the two
cards must line up at the top **and at the bottom**".

Which is the same requirement §49 states, minus one detail: equal height has a loser.
Stretch gives a card the ROW's height without giving it any more content, and the drill is
a table of up to forty-five jobs. So five KPI rows sat above a couple of hundred pixels of
empty grey — the card's own background, showing through the space its blocks did not fill.
A card cannot be equal-height with a forty-five-row table and still read as a card.

### 33.2 Two halves, and neither works alone

```
items-start                 each card its own height, aligned at the top
.drill-cap                  max-height: clamp(18rem, calc(100vh - 12rem), 34rem)
DRILL_BODY                  the one scrolling region inside the card
```

Independent heights **without** a ceiling is the §26 problem again: the drill sets the row's
height and the grid goes off the screen. A ceiling **without** independent heights never
binds, because `h-full` resolves to the row height and overrides `max-height` outright.
That is why `[&>*]:h-full` had to go rather than being worked around, and why the test
guards both halves in one place.

**All three bounds of the clamp are measured, and the first attempt got the middle one
wrong.** It shipped as `max(18rem, calc(100vh - 12rem))` — "as much of the window as is
left below the toolbar" — which sounds right and is too greedy. Measured live on a 950px
viewport:

| ceiling | parts drill | grid pushed by | grid visible |
|---|---|---|---|
| `100vh - 12rem` (770px) | 770px | **516px** | no — off the screen |
| clamped to 34rem (510px) | 510px | 213px | yes |

The greedy version reintroduces the §26 complaint *inside its own fix*: the drill
displacing the thing people came for. 34rem is about twice the summary card beside it and
still holds a dozen-odd rows. The window bound stays as the *other* limit, for short
laptops where 34rem would overflow the viewport.

**The 18rem floor is not decoration.** Browser zoom shrinks the viewport in CSS pixels and
leaves `rem` where it is: at 400% zoom `100vh` is ~225px against 12rem = 180px, and a
little further out the window bound goes **negative**, `max-height` clamps to zero, and the
drill vanishes. At high zoom and nowhere else — the kind of bug reported as "the Detail
link stopped working". Verified on a 380px-tall viewport: the floor held the panel at 270px
and its body still scrolled.

It is a CSS class in `globals.css` rather than a `max-h-[clamp(...)]` arbitrary value
because a value carrying commas inside a nested function is the one Tailwind construct this
app has already been bitten by (§39: a nested `var()` with a comma emitted no CSS at all,
silently). Confirmed in the built stylesheet rather than assumed:

```
.basis-\[28rem\]{flex-basis:28rem}
.drill-cap{max-height:clamp(18rem,100vh - 12rem,34rem)}   /* lightningcss drops the
                                                             redundant calc() — the clamp
                                                             arguments are calc-sums */
```

### 33.3 Wrapping, not a breakpoint

`flex-wrap` plus `basis-[28rem]` on the drill column, not `xl:flex-row`. §26.2 is the
reason and it cost a whole round of "the parallel row is not working": Tailwind's
breakpoints measure the **viewport**, and this row is not the viewport — it is inset by a
sidebar that is ~276px expanded, so `xl` (1280px) fires on a box that is ~1000px wide and
the drill would be squeezed to ~490px on exactly the "normal desktop" width the requirement
is about. A flex-basis measures the actual box: side by side while both fit, drill on its
own full-width line when they do not, and zoom needs no separate handling.

A basis rather than a `min-width`, because a min-width also refuses to shrink *after*
wrapping — which on a genuinely narrow window is horizontal page scroll, not a stacked
layout.

**The drill column is now rendered only when a drill is open.** It did not need to be while
it was `flex-1` (an empty column just took the slack), but 28rem of hypothetical width
wraps: on a narrower row an *empty* column dropped to a second line and left a 12px row gap
under the card. A phantom shift with nothing in it, on the layout whose whole job is not to
shift.

### 33.4 One ceiling, four cards, one scrollbar each

There are four drill cards: `DrillPanel` (the hours drills), `UndefinedHoursPanel`, and the
two hand-rolled ones on the Monthly ETC strip (parts, off-grid). All four now read the same
two classes, so "how tall may a drill be" is one decision. Inside each, the header and
controls keep their content height — a flex item's automatic minimum size means they cannot
be squeezed — and the body is the only child that can absorb the difference.

Two nested scrollers came out with it: the flat punch list in `HoursDetailPanel` (24rem) and
in `UndefinedHoursPanel` (20rem). Both predate the ceiling, and both left the ungrouped
Lines view capped *shorter* than the rollup it toggles with, on the same screen. The sticky
header and total row work against the panel's scroller exactly as they did against theirs.

`DrillGroup`'s own 18rem scroller stays, and the test says so explicitly: it bounds the
lines inside ONE expanded group so the group list's total row stays reachable, which is a
different job from bounding the card.

**This reaches `/job-hours` as well**, deliberately: `HoursDetailPanel` is the same
component there, so the section drill-through under the chart is now capped and scrolls
internally too. Its grouped rollup was previously unbounded and its flat punch list was
capped at 24rem — one bound each way, from two different rules. Both are now the one
ceiling, which is the whole point of §47 having a single panel component. The Monthly ETC
card is the only caller that also needed the row above it changed.

Two traps worth naming, both of which look like "the drill is empty":

- **`flex-1` on the body.** It sets `flex-basis: 0`, so an auto-height flex column computes
  its height from a zero-height body and the card collapses to its header instead of growing
  to its content and then capping. `basis-auto` is the fix, and the test pins it.
- **No `min-h-0`.** A flex item refuses to go below its own content height, so the card
  overflows its ceiling instead of scrolling.

`UndefinedHoursPanel` deliberately does **not** get `overflow-hidden` alongside its ceiling.
Its fixed region is the tallest of the four — heading, four figures, and the reconciliation
line §42.28 requires — and at extreme zoom that can exceed the ceiling's own floor on its
own. Clipping there would make the table unreachable; overflowing is untidy and the page
scrolls.

### 33.5 Measured live, all six drills

Every KPI Detail view, on a 1600×950 viewport, with the summary card at its natural 254px:

| Detail view | panel | top-aligned | card stretched | scrolls internally | grid pushed | grid still visible |
|---|---|---|---|---|---|---|
| Engineering hours | 297px | yes | no | not needed | 0px | yes |
| Shop hours | 297px | yes | no | not needed | 0px | yes |
| Parts spent | 510px (at cap) | yes | no | **yes** | 213px | yes |
| People booked | 366px | yes | no | not needed | 69px | yes |
| Undefined hours | 510px (at cap) | yes | no | **yes** | 213px | yes |
| Hours off the grid | 437px | yes | no | not needed | 140px | yes |

The card is **254px in all six** and never scrolls; its top never moves as drills open,
switch or close; exactly one scrolling region per panel; and no horizontal page scroll
anywhere. Scrolling the parts and undefined-hours bodies to the bottom left Close, the group
tray, the filters, Export CSV and the sticky Total row all in place.

Other widths, same page:

| Viewport | row width | layout | ceiling | result |
|---|---|---|---|---|
| 1600×950 | 1249px | side by side | 510px | as above |
| 1280×800 | **929px** | **stacked** | 510px | drill takes the full 929px |
| 900×700 | 549px | stacked | 510px | no horizontal scroll, Close reachable |
| 1600×380 | 1249px | side by side | **270px** (floor) | body 63px and scrolling |

The 1280×800 row is the §26.2 lesson paying for itself: the viewport is `xl`, so a
breakpoint would have gone side-by-side and squeezed the drill into ~400px. The row is
929px, the wrap fires, and the drill gets the whole width instead.

Guarded by seven tests in `tests/drill-design.test.ts`: no stretch and no `h-full`; a basis
rather than a breakpoint; the ceiling is bounded at both ends; every card has a ceiling and
exactly one scrolling region (counted, not just present); the body is `basis-auto` with
`min-h-0`; the total row is pinned; and no panel nests a fixed-height scroller inside its
body again. Types clean, 704 tests pass, lint clean on every touched file.

**Not verified:** `/job-hours`, which gets the same ceiling through `HoursDetailPanel`
(§33.4). The Monthly ETC drills were all exercised; that page's section drill-through was
not opened.

---

## 34. "Punches", not "lines" (2026-08-05)

One row in an hours drill is one Paylocity punch. The panel called them lines, which named
the shape of the table rather than the thing in it — and it was already inconsistent with
itself: `UndefinedHoursPanel`, running the same rollup through the same shared components,
printed its group counts as "23 punches" while the hours drill beside it printed "262
lines".

Renamed everywhere it is read:

| Where | Was | Is |
|---|---|---|
| meta line | `3 groups by department · 678 of 678 lines` | `… 678 of 678 punches` |
| group row count | `262 lines` | `262 punches` |
| group tray option | `Lines` | `Punches` |
| group row tooltip | `Show the 262 lines behind this` | `Show the 262 punches behind this` |
| empty filters | `No lines match these filters.` | `No punches match these filters.` |
| truncation note | `oldest lines omitted` | `oldest punches omitted` |

Two things did **not** change. `HoursGroup.lines` keeps its name — it counts rows of the
rollup's input and `tests/hours-detail-grouping.test.ts` asserts on it, so renaming the
field would be churn in the arithmetic to relabel a caption. And `UndefinedHoursPanel`
keeps "records" for its own count: those rows are faults to be corrected, which is
deliberately not the same word as a punch you are reading (§42.27).

The ungrouped meta line is not a straight substitution. "Every booked punch this month ·
678 of 678 punches" says punch twice, so the scope moved to the tail: `678 of 678 punches
booked this month`.

**One real bug fell out of it.** `DrillGroup`'s tooltip took the domain word from the
caller's `count` when the group was CLOSED and hardcoded `"lines"` when it was OPEN — so
the undefined-hours drill, which has always said punches, still said "Hide these lines" the
moment you expanded a row. Both states read from `count` now, and the fallbacks say "rows"
rather than picking a domain, since that is the shared design layer.

Verified live: tray reads `Department · Employee · Section · Job · Punches`, meta reads
`3 groups by department · 678 of 678 punches`, group rows read `262 punches` / `323
punches` / `93 punches`, tooltips read `Show the 262 punches behind this`. The only
remaining "line" on screen is a job name — *Andi 1 & Andi 2 Replacement Line*.

---

## 35. Show Actuals shows both figures again (2026-08-05)

Reported as §50: with Show Actuals on, the section cells should read **quoted / actual**.

### 35.1 This reverses §47.2

§47's wording was "replace the quoted-hours values in the section columns with actual-hours
values", and §31 implemented exactly that: ON hid the quoted input, the separator and the
totals' quoted span, and the actual took the cell. Before that it had appended.

The literal reading is the one being reversed, and the reason is what the column is for.
Over/under is a **comparison**. A cell showing `2352` alone does not make it — you have to
remember the quoted figure you were looking at a click ago. The cell's background tone
already encodes over/under (`quotedCellTone`); the pair is what explains the tone.

§47's other constraint was never in tension with this and still holds: **"do not add
duplicate actual-hours columns."** The actual rides inside the section cell as a suffix, so
the grid's column count — and the phase header `colSpan`s — are identical in both states.

### 35.2 Three deleted rules, not three inverted ones

The whole change is CSS, because the actual figures were never conditional markup: every
cell has always rendered its `.actual-suffix`, and `hide-actuals` on the `<table>` decides
whether it shows. That is why the switch can flip it on the click with no render (§47.6),
and it is untouched here.

```
input[type="number"]   was display:none   ->  the quoted half is the point
[data-total-quoted]    was display:none   ->  same, for the ENG/SHOP totals
.actual-sep            was display:none   ->  the "/" the request names
```

Gone, not inverted — so there is no `:not(.hide-actuals)` block at all now. ON is simply the
base layout the cell was always built for: the quoted `<input>` pinned to 1.9rem so it can
share the cell, `.actual-suffix` inline-block beside it. `.hide-actuals` remains the only
state with rules of its own. `tests/quoted-view.test.ts` asserts the **absence** of those
three rules, against comment-stripped CSS — it failed on its own explanatory note first run,
which is worth knowing before writing the next CSS assertion in that file.

### 35.3 The asymmetric slash

Found while verifying: `.actual-suffix` had `margin-left: 0.15rem` and nothing on the other
side, so a section cell read `1800 /1913` while the ENG/SHOP total beside it — whose markup
carries literal spaces — read `1800 / 1913`. One separator, two spacings, in the grid's
densest cell, and the request is specifically about that "/". Fixed with a scoped
`margin-right` on `.actual-sep` inside `td.quoted-actual-cell`, so it does not double up on
the totals' own spaces.

Measured before adding it, because 4 digits either side of a slash in a 79px column is not
obviously safe: the tightest real pair used 59px of 79px. After: **0 of 663 cells clip**,
tightest slack 18px, no horizontal overflow on the table or the page.

### 35.4 Verified live

| | ON | OFF |
|---|---|---|
| `hide-actuals` on the table | absent | present |
| URL | `?actuals=1` | param deleted |
| quoted input | shown, 29px | shown, 79px (full cell) |
| `.actual-suffix` | shown | `display: none` |
| section cell | `700 / 634` | `700` |
| ENG / SHOP total | `4560 / 2754` | `4560` |

Job 1101 Coil Staker, ME GEN: `700 / 634` — the 700 matches the quoted figure that was on
screen before the change. The quoted input stays editable in both states (Show Actuals still
does not touch Edit Mode), and flipping the switch remains one class on one element with no
navigation.

Types clean, 705 tests pass, lint clean on every touched file.

---

## 36. Department ETC sign-off (2026-08-05)

Reported as §50: a checklist above the KPI card where each department ticks a box to say
it has finished entering its ETC for the month, feeding the submission gate.

### 36.1 Five departments, on one line

Shipped first as §50 described — six departments, stacked vertically, each with a status
caption ("Not complete", "Completed by Lisa at 2:35 PM") and a running count. Both were
revised the same day, by request, and both revisions are improvements worth recording
rather than corrections to hide:

- **Six became five.** "Electrical Build" and "Wire" merged into **Electrical Build and
  Wire**. `EMPLOYEE_TEAMS` already folds Machine Wiring into Electrical Build — one team,
  both Paylocity department strings — because they are one group of people who finish
  together. Two boxes were asking one team to answer twice. The stored CODE stayed
  `elec-build`; only the label moved, which is the entire reason code and label are
  separate fields, and is now test-guarded.
- **Vertical became one line.** Five rows with captions is ~150px above the grid, spent
  restating what five ticked boxes already say, on the page whose recurring complaint
  (§26, §44, §49) is things pushing the grid down. It is now a 28px strip. Who and when
  are not lost — they moved into each box's tooltip.

```
DEPARTMENT ETC COMPLETE   PM   ME   CE   Mechanical Build   Electrical Build and Wire
```

`flex-wrap`, not a fixed row: at a narrow window or 150% zoom the boxes wrap to a second
line rather than pushing a horizontal scrollbar onto the page — the §49 rule again.

**Sized to its content, at toolbar height** (a third revision, same day). A `<section>` is
a block, so the strip ran the full width of the page with ~555px of empty white after the
last checkbox — it looked like a banner rather than what it is, a group of five controls.
`w-fit` ends it at its content, and `BTN_MIN_H_STANDARD` puts it at the same 2.4rem as
View / Export in the row above (measured after: strip 654px x 36px, Export 36px), with
`rounded-lg` and `px-3.5` to match those too.

The height token is a new one, and it is a `min-h` for a reason: `flex-wrap` has to stay
for the narrow case above, and a fixed `h-` would clip the second row. It sits next to
`BTN_H_STANDARD` in classnames.ts with a test asserting the two are the same number —
Tailwind's scanner needs both class names to appear literally, so one cannot be derived
from the other, and two literals that can drift are exactly the failure §41.21 was about.

### 36.2 The permission model, stated honestly

§50 asks that "users should update only the departments they are permitted to manage" and
that authorization be enforced on the backend. The second half is done properly. The first
half ran into a fact worth writing down:

**This app has two permission tiers and no third.** Signed in, and ADMIN — and ADMIN gates
exactly one thing (the audit log page). Every ETC cell, the Projects grid and the month
submission are `!!session?.user`, deliberately: §32 records that requiring ADMIN for month
corrections "just meant corrections didn't happen".

**There is also no link from a User to an Employee.** `User` has {email, name, role};
`Employee` has {name, department} and no email. So the app cannot answer "which department
does this signed-in person belong to" from data, and inferring it by fuzzy name match is
how you get a manager who cannot tick their own box — the Scheduler grouping sync matches
48 of 52 names, and those four misses would be four people locked out of a control that is
theirs.

So ownership is **configured, not inferred**, through one environment variable:

```
ETC_DEPARTMENT_OWNERS="pm:lisa@sdc.com|dan@sdc.com,ce:xiao@sdc.com"
```

| state | who may tick |
|---|---|
| department listed | those addresses, plus any ADMIN |
| department not listed | any signed-in user — the app's existing grain |
| variable unset | as above, for all five |

Unset is the shipped default, so the feature works the day it lands rather than after
someone fills in a table. The parser is deliberately lenient (a stray comma, a missing
colon, a department that no longer exists) because a typo in a `.env` on a server must
degrade to "unconfigured", never to "nobody" — tested against eight malformed strings.

The checkbox's `disabled` attribute reads the same policy, purely so a box the server
would refuse arrives greyed out. It is not the check: `setDepartmentCompletion` re-derives
all of it from the session on every call, because a server action is a public endpoint
whatever renders it.

### 36.3 Absolute writes, not toggles

The client sends the state it WANTS, never "flip it". That one decision is what satisfies
both multi-user clauses §50 names:

- *"Stale sessions must not overwrite a newer completion status."* From a stale view a
  toggle produces the opposite of what was clicked — you see unticked, a colleague ticks
  it, your click unticks it. An absolute write produces what the user asked for whatever
  they were looking at.
- *"Duplicate events must not create incorrect status changes."* Writing the same value
  twice changes nothing. The store returns `changed: false` and the caller then records
  **no audit row and sends no broadcast** — verified: a duplicate tick left the original
  completer's name in place rather than overwriting it with the second caller's.

### 36.4 The realtime bug this found

First cut derived the live state by folding `useRealtimeChanges()` during render — tidier
than mirroring into state, and lint-clean. It was wrong for a reason only two browsers
reveal:

**That queue is the notification banner's buffer.** It is capped at 40 and every entry is
dismissed seven seconds after arrival (`ChangeNotifications`' `AUTO_DISMISS_MS`). So a
colleague's tick appeared and then *un-appeared* seven seconds later, when the event aged
out and the derived value fell back to the server render underneath it. Every reading in
the first test happened after the queue had drained, so the box simply never moved.

Diagnosing it was worth the detour, because the obvious suspects were all innocent:

```
audit row written            yes — the action ran
event on tab 2's wire        yes — cellKey deptEtcComplete__2026-07__elec-build
an ETC cell edit propagated  yes — the hub, the SSE route and the stream all work
```

The fix is to **accumulate** events into state as they arrive and keep them, subscribing
through `subscribeChanges`/`readChanges` and calling setState from the store's callback —
which is the shape React's set-state-in-effect rule explicitly allows. Mirroring in an
effect *body* is what it forbids, and that distinction is exactly the difference between
reacting to a change and re-deriving on every render.

Newest-wins per department, by timestamp, which is what makes a replay harmless and an
out-of-order delivery a no-op — one comparison instead of a seen-set that only covers the
first hazard.

### 36.5 The submission gate

`Submit {Month} Report` will not open while any department is outstanding, and the
readiness line names them in §50's words:

```
Submission blocked: CE and Wire have not completed their ETC review.
```

It leads ahead of the missing-New-ETC count, deliberately: an unfinished department is a
message to send to a person, where a missing cell is something to go and type. The longer
pole leads — and the cells are not hidden, they ride in the detail line.

`incompleteDepartments` is its own field on `MonthlyReportValidation` rather than something
derived from `issues`, because `issues` is capped at `MAX_REPORTED_ISSUES`: a month with 25
missing cells would push the department rows off the end, so the blocker would stop naming
them in exactly the situation where the most is wrong. It is **required, not optional** —
this gates the one irreversible action in the app, and making it required immediately
flushed out all five places that build a validation object.

§50's warning is respected: **the checkbox is not proof the cells are valid.** Nothing in
the existing validation changed. A month with all five ticked and one missing New ETC is
refused by the rule it always was, and that is a test.

### 36.6 Audit

`recordChanges` — the app's one place where a change is both recorded and announced —
covers §50's audit list with nothing added:

```
15:08:36  Mechanical Build — 2026-07   Not complete -> Complete
          userId 1 · Abhi Kamuju · appVersion 1.0.0 · changeId 06926862-...
```

department, report month and year, previous status, new status, user id, user name,
timestamp, application version, unique change id. Using it rather than a bespoke logger is
what makes it impossible to ship a status change other tabs can see but the audit log never
heard about.

### 36.7 Verified live, in two browsers

| | result |
|---|---|
| position | below the toolbar, above the KPI card, 28px tall |
| five boxes on one line | yes — every checkbox on the same y |
| tick / untick saves | immediately, no navigation |
| persists across refresh | yes |
| month scoped | July shows its ticks; August shows none |
| live to a second tab | ticked in tab 1, on in tab 2 in under 10s, `navigations: 1` |
| ...and it STAYS | probed at 3s, 9s and 15s — past the 7s dismissal that broke v1 |
| untick propagates | tab 2 unticked ME; tab 1 followed, no refresh |
| duplicate write | `changed: false`, completer not overwritten, nothing logged |
| audit | every field above, read back from the real table |

`tests/etc-departments.test.ts` adds 25 tests over the list, the rename, the key
round-trip, the permission policy and the wording; `tests/monthly-report-submit.test.ts`
adds 5 over the gate. 735 pass, types and lint clean.

**Not verified live:** the readiness line itself, which lives in the Standard Fees card
behind the Standards password gate. Both sides of it are covered —
`readIncompleteDepartments` against the real table, and `departmentIssues` as a pure
function extracted from `validateMonthlyReport` precisely so the judgement is testable
(that function can only run inside Next; its dependency chain reaches `server-only`). The
two lines joining them are straight-line code. **Worth one human click-through** with the
Standards card open.

### 36.8 Deployment, and the test data that was cleaned up

`20260805170000_add_department_etc_completion` is **already applied** to
`sdc_etc_planner` — the database was clean beforehand, so `migrate deploy` applied exactly
this one. The table is read and written by raw SQL, like `MonthlyReportSubmission` and
`RefreshRun`, so it needs no `prisma generate` and therefore no deploy window.

Two pieces of test data were left behind and removed: all five July sign-offs were
unticked, and `EtcEntry 50324` (job 979, ME Gen) was restored to `0` after being set to `7`
while proving the realtime hub worked — with an `etc.cellRestore` audit row saying so.

---

## 37. The TOTAL (NEW ETC) rollup is all-or-nothing (2026-08-05)

Reported as §51, and it arrived from a question about the previous section: why is Diff
-22 when Hours Left is 1,017 and Total New ETC is 205?

### 37.1 The answer, and why it justified a change

It was arithmetically right and unreadable. Measured on job 1101, 2026-07 Engineering:

| section | Hours Left | New ETC | answered? | contributed to Diff |
|---|---|---|---|---|
| 10-312 Design & Drawings | -22 | 0 | yes | **-22** |
| 10-313 Software | -51 | — | no | 0 |
| 10-515 HMI | 40 | 40 | yes | 0 |
| 10-516 Robot | 92 | — | no | 0 |
| 10-517 Vision | 80 | 80 | yes | 0 |
| 40-211 ME & CE | 793 | — | no | 0 |
| 50-211 ME & CE | 85 | 85 | yes | 0 |

Total New ETC (205) and Diff (-22) both counted only the four answered sections —
183 - 205 = -22, internally consistent. **Hours Left (1,017) counted all seven**,
including 834 hours in three nobody had planned. Two columns meaning "planned" and one
meaning "everything", adjacent, with nothing on screen to say so.

§51's answer is better than a tooltip: if the rollup is not ready, **show nothing**.
Blank states the true fact, and once the group IS complete all three columns agree,
because every cell then feeds all of them.

### 37.2 The rule, and what "required" means

`rollupNewEtc` in `lib/etc.ts` — one pure function, called by the server render and by
the live store, so the first paint and the first keystroke cannot disagree.

```
complete  <=>  every cell in the group that needs an answer has one
newEtc    =    null while incomplete, else Σ max(cell, 0)
diff      =    null while incomplete, else hoursLeft − newEtc
hoursLeft =    always a figure — Prior and Worked are synced facts, not decisions
```

The vocabulary already existed and did not need inventing, which is most of why this was
a small change:

- **required** — `isNewEtcDecisionRequired`: hours were booked here this month.
- **answered** — `hasNewEtcValue`: the box holds any text, *including "0"*. That
  function already normalised `"0"`, `"0.00"` and `-0` as values and `""`, `"   "` and
  `null` as blanks, which is §51's "Blank and Zero Handling" section verbatim.

So the blocking set is exactly the YELLOW cells, and therefore exactly the set
`validateMonthlyReport` counts as `missingNewEtc`. "This rollup is blank" and "the month
cannot be submitted" are now one fact with one cause — pinned by a test that asserts the
two expressions agree across four cell states.

Sections with nothing booked never block, which is what stops the ~350 sections no job
was ever quoted for from holding every block hostage forever.

### 37.3 Scope was the hard part, not the arithmetic

§51 arrived in two halves and the second narrowed the first to the circled block only.
That restriction is load-bearing: the same `newEtc` and `diff` sums also feed the KPI
strip, where a partial figure is correct — a card reporting the month is not waiting for
a row to be finished.

So `GroupTotals` gained a `rollup` field **beside** the existing sums rather than
replacing them. The block reads `rollup`; the KPI cards keep reading `newEtc` / `diff` /
`plannedNewEtc` untouched. Verified on the running grid after the change: the 13
per-section footer totals all still populated, Parts Cost footer still -$35,370.

### 37.4 The bottom totals

Only rows that HAVE a figure contribute — not zero, not their Hours Left, no fallback
(§51 #7, #8). Verified live that the footer still foots to the rows above it:

| | rows shown | rows blank | Σ of shown rows | footer |
|---|---|---|---|---|
| Engineering | 17 | 31 | 1,854 | 1,854 |
| Shop | 46 | 2 | 24,562 | 24,562 |

Worth expecting: **the ENG footer drops a long way** on a month mid-entry, because most
Engineering rows are waiting on a section. That is the requirement working, not a
regression — it now totals what has been decided rather than mixing decided figures with
suggestions.

### 37.5 A blank has to explain itself

A blank cell with no tooltip reads as missing data or a broken formula. Both cells carry
one naming what is outstanding:

```
Waiting on 2 sections: Robot, ME & CE. Total New ETC and Diff appear once every
section here has a New ETC — 0 counts as an answer.
```

"0 counts" is said outright because typing a zero is the first thing anyone will try
when a rollup refuses to appear, and it works.

The Diff cell's colour is cleared with its text. A leftover tint on an empty cell would
imply a variance that is not being reported at all — worse than a stale number.

### 37.6 Verified live, one keystroke at a time

Job 1101, Engineering, two sections outstanding:

| step | Total New ETC | Diff |
|---|---|---|
| two sections outstanding | blank | blank |
| filled the **first** of two (50) | blank | blank |
| filled the **last** with a **zero** | **295** | **722** |
| cleared one again | blank | blank |

`1,017 − 295 = 722` — the block subtracts on screen, which is what the original question
was about. The footer moved by exactly this row's contribution in both directions
(+295 / +722, then back), and the Diff cell's tint went with the number.

18 tests in `tests/etc-rollup-dependency.test.ts` cover §51 #12's list: blanks, nulls,
zeros (`0`, `"0"`, `"0.00"`, `-0`), partial completion, full completion, clearing, and
edit order. Two of them are the ones that matter most:

- **the blocking set equals the submission gate's missing set** — so the two can never
  drift apart;
- **a complete group's Diff equals the old per-cell sum** — which is what makes this safe
  to ship: no already-complete row's figure moves.

753 tests pass, types and lint clean.

### 37.7 Test data, and a cleanup mistake worth recording

Two cells on job 1101 (Robot, ME & CE) were typed into to prove the live path and then
restored. The first restore was **wrong**, and the way it was wrong is instructive.

Those cells had been **deliberately cleared** — `newEtcClearedAt` set — which is the only
state in which a cell holding a confirmed 95.5 renders blank ("cleared beats confirmed",
`newEtcSeedText`). The audit trail showed `previousValue: null`, which reads as "never
touched", so the flag was removed as part of tidying up. Two blank cells started showing
96 and 793, and a rollup that should have been outstanding completed itself.

Caught by re-reading the grid after the cleanup rather than trusting it. The flag is
restored; both cells are blank again with the same two sections outstanding. **The
original clear TIMESTAMP is unrecoverable** — every read of that column in the codebase
is a null-check, so behaviour is exactly restored and only the forensic "when" is lost.
Both the mistake and the correction are in the audit log under `etc.cellRestore`.

The lesson for next time: `previousValue: null` in the change log means "the box was
empty", not "the row was untouched". They are different states, and this app has a column
specifically to tell them apart.

---

## 38. The Monthly ETC header, in two lines (2026-08-05)

Three lines of header sat above a grid people come here to scroll: one wrapping toolbar
that had outgrown itself, and the department checklist on a row of its own.

### 38.1 Split by what a thing IS, not by what fit

The old row held the month picker, View, Export, the Standards pair, the status badge,
the issues chip and the sync metadata — controls and readouts mixed, wrapping wherever
they happened to run out of room. So the split is by kind:

```
row 1   everything you can PRESS      month · year · View · Export · [Standards] · the checklist
row 2   everything the page TELLS you  status · issues · last synced · hours through · working days
```

The checklist moved up because ticking a box is an action. `Report for:` went entirely —
the select beside it reads "July — in progress", which is what the label was saying.

Measured after, at the 1,209px the expanded sidebar leaves:

| | height | width used | headroom |
|---|---|---|---|
| controls row | 36px | 934px | 275px |
| state row | 29px | — | — |
| **header block** | **65px** | | |

### 38.2 Making it survive Standards being unlocked

That headroom is not decoration. With Standards unlocked — which is the state the report
came from — the row gains two more buttons. Measured by cloning a real `BUTTON_SECONDARY`
and swapping its text rather than guessing: **Hide Standards 131px + ETC Rates 95px + 24px
of gaps = 250px**, against 275px available. It fits, with 25px to spare, and `flex-wrap`
handles anything narrower by dropping to a second line instead of overflowing.

Getting there took ~90px out of the checklist, and where it came from matters:

- **The caption**, "Department ETC complete" -> "ETC complete". The two words it lost were
  the two doing least; the full sentence is still the section's accessible name.
- **`EtcDepartment.short`**, a new field: "Mech Build" and "Elec Build & Wire" in the
  toolbar, where three of the five names are already as short as a name gets and those two
  cost 281px between them.

`short` is not an abbreviation invented for the space — they are the ETC grid's own column
names for the same work (10-411 "Mech Build", 10-412 "Elec Build"). And nothing is lost:
`label` stays the full "Electrical Build and Wire" everywhere it is *said* rather than
*labelled* — the submission blocker, the audit log's rowRef, the checkbox tooltip and its
accessible name. Two tests pin that split: the short names must be distinct and no longer
than the label, and the blocked-submission sentence must use the full one.

### 38.3 One rhythm across the row, not five widths

Reported next: the controls are all different widths. They were — and two of them had
never adopted the §41.21 tokens at all, which is why:

| | before | after |
|---|---|---|
| month select | 169px, **34px tall** | 169px, 36px |
| year select | 76px, **34px tall** | **98px**, 36px |
| View | 76px, **34px tall, rounded-md** | **98px**, 36px, rounded-lg |
| Export | 95px, 36px | **98px**, 36px |
| Hide Standards | 131px | **98px** — see below |
| ETC Rates | 95px | **98px** |

`EtcViewMenu` was hand-rolling `rounded-md border px-3.5 py-1.5` with no height token,
and `MonthYearSelect` had its own `py-1.5` — so a row that §41.21 had supposedly
standardised still held 34px controls with a smaller radius next to 36px ones. Both take
`TOOLBAR_BTN` / `BTN_H_STANDARD` now. Measured after: **one distinct height (36px) and one
distinct top across every control in the row.**

`TOOLBAR_MIN_W` (6.5rem) is the new part, and it is a FLOOR rather than a fixed width:
pulling everything out to the widest label adds ~130px to a row with ~25px of slack, and a
row that wraps is a worse answer to "make them even" than one that does not. What the
floor removes is the bottom of the range — nothing sits at 76px beside something at 131px
any more.

**"Hide Standards" became "Standards"**, styled `TOOLBAR_BTN_ACTIVE` while showing. The
label names the thing and the colour says it is on — which is how View reports being
filtered two controls to its left, and the reasoning ProjectsShowActualsSwitch already
records ("a switch already says which way it is set, so the label can just name the thing
it controls"). It was also the one control keeping the row over budget: 131px against a
98px floor. With it, the unlocked toolbar needs 220px against 228px available.

### 38.4 Verified

Header is two rows, 36px + 29px. Every control in the controls row is 36px tall on one
baseline; the four short ones are all 98px. The row uses 981 of 1,209px, and 220 of the
228px remaining when Standards is unlocked — so it stays one line in both states, and
`flex-wrap` still catches anything narrower.

Ticking a box still saves and still reads back "CE (Controls Engineering) — Completed by
Abhi Kamuju at 4:08 PM" from its new home in the toolbar. 758 tests pass — two new ones
pin every control in this row to the shared tokens, because this is the second time this
row has drifted — types and lint clean.

---

## 39. The three Job-Hours charts in one row; Parts Cost redesigned (2026-08-06)

Reported as §52 then refined by §54. The Job Hour Details page stacked its two hours charts
in one row (`lg:grid-cols-[2fr_1fr]`) and dropped the **Parts Cost** block onto its own
full-width row below (`PartsCostSummary` rendered directly by the page). §52 asked for all
three side by side; §54 asked for the Parts Cost visual to go vertical and for the three
cards to look like one aligned row.

### 39.1 Parts Cost stopped being a page-level block and became a chart card

`PartsCostSummary` was a standalone `<div className="mt-6 …">` the page placed after
`<JobHoursDashboard>`. It now composes as the dashboard's third grid column: the page passes
its inputs down as a single `parts` prop (`JobHoursDashboardParts`) and the dashboard renders
the card inside the same grid as the two hours charts, so there is one row to align rather
than a row plus an orphan.

The card lost its outer `mt-6 space-y-3` wrapper and now shares the exact `card("p-4")` +
`flex h-full flex-col` treatment as the other two — same padding, radius, border and shadow —
which is most of what §54.4 asks for. Its title dropped from `text-lg` to `text-base` to match
the two chart titles beside it, and its subtitle moved to the same right-aligned
`text-note text-sdc-gray-400` slot the other two use for their captions.

### 39.2 The bar: horizontal 5-bar ECharts → one CSS bullet → one VERTICAL bullet

Three shapes in two days, and both changes were narrowings:

- **Was** a 4-5 row horizontal ECharts bar (`partsCostBarOption`: Estimated / Purchased /
  Paid / Left to pay / Projection). Five bars made "how do Invoiced, Spent and Projection
  relate" a multi-glance read.
- **§52** replaced it with one hand-rolled CSS bullet bar — a filled track for Amount
  Invoiced with two dashed markers (Total Parts Cost Spent, Projection) crossing it on one
  shared scale. Hand-rolled, not ECharts, because a single bar plus two threshold markers has
  no natural ECharts option shape, and this component already hand-rolls comparable bars (the
  variance meter below it, and `SectionHierarchyChart`).
- **§54** turned that bar vertical: the fill now grows up from the baseline, the two markers
  are horizontal dashed lines crossing it at their own heights, and the legend moved beside
  the bar. `partsCostBarOption` was deleted from `charts/theme.ts` (only `PARTS_BAR` colours
  remain, now feeding CSS rather than an ECharts series). The `EChart` import went with it.

**No calculation changed** (§52.5, §54.2). `purchased` / `paid` / `budgetProjection` /
`estimated` and the Projection-vs-Estimated variance meter are byte-identical; only the two
KPIs the old bar also drew (Estimated, Left to pay) stopped having their own bar — Estimated
still feeds the variance baseline, Left to pay was `purchased − paid` and is implicit in the
gap between the two figures now shown. Exact dollar values are stated in the legend row, so
nothing that was readable became unreadable.

### 39.3 One aligned row — stretch by default, independent only when a drill is open

The grid is `items-stretch` by default, so idle all three cards are the tallest one's height
exactly — verified live at 1600px: **497.875px tall and 403.7px wide, all three, top and
bottom edges identical, zero overflow on any card.** The one exception is while chart 1's
section drill-through is open: that content genuinely needs the room (§54.5 "unless
absolutely required by content"), so the grid flips to `items-start` for that state only,
rather than stretching the other two cards to match a much taller one — the same empty-space
trap §33 fixed for the KPI summary card. Each card is `flex h-full flex-col` so it fills the
stretched height; the Parts Cost bar sits in a `flex-1` centring region so it never looks
stranded in a taller card.

The row falls back to the old `lg:grid-cols-[2fr_1fr]` two-column ratio when there is no Parts
Cost to show (Total ETO unreachable, or the >12-job cap), rather than leaving an empty third
cell. Below `lg` all three stack to one column (verified at 900px: one column, no overflow).

Types clean, 758 tests pass, lint clean on the touched files (one pre-existing
`set-state-in-effect` warning in `SectionHierarchyChart`'s entrance animation is unrelated and
predates this change).

### 39.4 The first card fully visible, no internal scroll (§55, 2026-08-06)

At three equal columns the first card (`Estimate to Complete vs Actual`) was ~349px of
content while its tiered section chart carried a hard `min-w-[640px]` floor — so the card
scrolled horizontally and hid half the sections behind an internal scrollbar. §55: show it
in full, give it the width, let the other two shrink.

Two changes, and the second is what makes the first safe:

- **The row is now `lg:grid-cols-[2fr_1fr_1fr]`** — the first card takes half the row, the
  billing-group and Parts Cost cards a quarter each. Measured at 1440px: 526 / 263 / 263px,
  all three still top- and bottom-aligned (stretch unchanged), no page overflow.
- **The chart shrinks to fit instead of scrolling.** `SectionHierarchyChart` dropped
  `min-w-[640px]` for `w-full min-w-0`, its columns went from `minmax(60px, 1fr)` to
  `minmax(0, 1fr)`, and the bars themselves became responsive: `w-5` (a fixed 20px, which was
  the real cause of the 640px floor) became `flex-1 min-w-0 max-w-5` on a `w-full` fill, so a
  bar fills whatever its column gives it up to its old 20px and shrinks below that rather than
  overflowing. Wide columns look exactly as before (capped at 20px); narrow ones narrow the
  bars, never clip them.

Verified with 12 sections (the job's full template, the worst case) at two widths:

```
viewport   first card   internal scroll   bar width   pair overflow   page overflow
1440px       526px            none          16.1px         none            none
1280px       445px            none          12.7px         none            none
```

Every section, its bars, the per-bar value labels, the diff labels and all three tier rows
(section / dept / phase) render inside the card at both widths. Nothing in the chart's data,
tooltip, hover, legend, drill-through or the other two cards changed — only the widths and the
bar sizing. 758 tests pass, types clean, lint clean on the touched file (the one remaining
`set-state-in-effect` warning is the pre-existing entrance-animation effect, unrelated).

---

## 40. The Job-Hours header in one compact row (2026-08-06)

Reported as §57. The page header was two stacked blocks: a tall `p-4` project-title card
(number + name, then customer · status) with a lot of empty vertical space, and below it a
four-card KPI grid (Active Jobs, Hours Refreshed Thru, Latest ETC Month, **Eng
Design-to-Debug Ratio**). §57: one compact row, the ratio card gone.

### 40.1 One grid, owned by the page

The title card lived in `job-hours/page.tsx` (it needs the scheduler-link context and the
aggregate-vs-single-job branch) and the KPI cards lived inside `JobHoursDashboard`. Putting
them on one line meant one of them had to move; the KPI cards moved UP into the page, because
the page already has `data.kpis` and owns the title card, so the whole row is now built in one
place. `JobHoursDashboard` lost its KPI grid and its now-unused `IndicatorCard` import; its
first child is the Hours-Type / phase-filter control row.

The row is `grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]`: the title card takes 2fr (widest,
because it carries the most text — a full job name), each summary card 1fr. Measured at
1552px: **462 / 231 / 231 / 231px, all four at height 71px, all four top-aligned at y=106** —
`items-stretch` (the grid default) equalises the heights and the title card is
`flex flex-col justify-center` so its two lines sit centred in that height instead of leaving
the p-4 block's empty space below them. The `2xl` KPI value and the title card's two compact
lines land at the same card height with no card taller or shorter than the others.

### 40.2 Removed, and responsive

The "Eng Design-to-Debug Ratio" card is gone from the render (`data.kpis.designToDebugRatio`
is left computed and untouched — §57 asked only to remove the card, not change data). Verified
live: the string "Design-to-Debug" no longer appears on the page.

Narrow screens: the title card is `col-span-2 lg:col-span-1`, so below `lg` it spans the full
two-column width and the three summary cards wrap beneath it; everything stacks below `sm`.
Verified at 768px — title full-width, summary cards wrapping, no horizontal page overflow.

No data or behaviour changed for the title, Active Jobs, Hours Refreshed Thru or Latest ETC
Month — only the layout. 758 tests pass, types clean, lint clean on the touched files (the one
remaining `set-state-in-effect` warning is the pre-existing entrance-animation effect in
`SectionHierarchyChart`, unrelated).

### 40.3 Parts Cost as a single STACKED bar (§58, 2026-08-06)

§54 turned the Parts Cost visual into a vertical pill-shaped bullet (a `rounded-full` track
with a filled portion and two dashed markers). §58: make it a proper rectangular stacked bar
chart instead.

The redesign leans on a fact the pill was ignoring — the three figures are **nested**, not
independent: `paid ≤ purchased ≤ projection` always (you invoice a subset of what's on a PO,
and you have committed a subset of what you project). That is precisely the shape a stacked
bar is for, so each business value became the cumulative **top** of a segment:

```
projection ─┐ amber   projection − purchased   (projected, not yet spent)
purchased  ─┤ blue    purchased  − paid        (spent, not yet invoiced)
paid       ─┤ green   paid                     (Amount Invoiced — the main fill)
0          ─┘
```

The bar's full height IS the projection, so the segments sum to 100% by construction — no
scale to pick, no headroom to leave (the two things §33/§38 kept getting wrong elsewhere).
It is a real chart column now: `rounded-t-md` + `overflow-hidden` rounds only the top so it
stands on a faint bottom-border axis line, rather than the capsule shape §58 called out.

The legend sits beside the bar, top-to-bottom in stacking order, each row carrying the
cumulative dollar value its segment tops out at (`$1,591,916 / $1,566,916 / $1,522,142` on
job 1142) with a tooltip spelling out the increment. That is what keeps it readable when two
of the three are close: a nearly-complete job stacks as a fat green base under two thin
slivers, and the exact figures are still stated to the dollar in the legend rather than left
to be eyeballed off 3px of bar. Measured live on job 1142: 60×210px column, segments
200.2 / 5.9 / 3.3px summing to the bar height, no card overflow, still aligned with the two
chart cards beside it.

No calculation changed — `paid` / `purchased` / `budgetProjection` and the untouched
Projection-vs-Estimated variance meter below are the same numbers (§58.5). Segments and legend
rows are defensively clamped (`Math.max`) and filtered so a null projection or a zero-spend job
degrades cleanly rather than rendering an inverted or empty stack. 758 tests pass, types clean,
lint clean on the touched file.

### 40.4 Parts Cost bars: proportional scaling + centred (§60, 2026-08-06)

§58's stacked bar was reported as mis-scaled: Amount Invoiced $43,502 and Total Parts Cost
Spent $43,743 (near-equal) rendered as a full-height green bar next to a barely-visible blue
sliver. That was not a rounding or min-height bug — it is intrinsic to stacking NESTED values.
The three figures are cumulative (`paid ≤ purchased ≤ projection`), so a stack draws the
middle segment as the INCREMENT `purchased − paid` = **$241**, which is correctly tiny and
also completely useless for comparing the two $43k figures the labels show. No amount of
segment tweaking fixes that; stacked increments can never make two near-equal cumulative
totals look near-equal.

So the visual changed from one stacked bar to **three grouped bars**, each drawn from a zero
baseline on ONE shared linear scale (`scaleMax = max(paid, purchased, projection)`), height
strictly `(value / scaleMax) × BAR_AREA` — no min-height, no per-bar normalisation, no
headroom fudge (§60.1/§60.2). Two near-equal values are now two near-equal bars. Measured live
on job 1142 (the near-equal case): Invoiced $1,522,142 → 168.3px, Spent $1,566,916 → 173.2px,
Projection $1,591,916 → 176px — exactly proportional, and the three read as almost the same
height, which is the truth of the numbers.

Centred (§60.3): the bar group is `flex-1 items-end justify-center`, so it hangs off a common
baseline and sits centred in the card both ways — verified 16px of gap on each side, equal.
Each column carries its exact value above and its name below; still a rectangular bar (§58),
still vertical (§54), just no longer stacked.

`PARTS_BAR` colours unchanged (green Invoiced / blue Spent / amber Projection); the
Projection-vs-Estimated variance meter below is untouched (§60.4). No business calculation
changed. 758 tests pass, types clean, lint clean on the touched file.

### 40.5 Parts Cost back to ONE stacked bar, incremental (§61, 2026-08-06)

§60 (grouped bars) was reverted by request. §61 wants a single vertical stacked bar again —
and clarifies the intent §60 had muddied: the segments are **incremental**, so the blue
"spent" segment IS meant to be the small `purchased − paid` increment ($241 in §61's own
example), not a full-height bar. §60 had read that thin segment as a scaling bug; §61 confirms
it is the point — the bar shows the progression invoiced → spent → projected.

So the visual is the §58 stack again, with the framing made explicit and defensive:

```
orange = projection − purchased   (top)     ┐
blue   = purchased  − paid                  ├ increments, NOT raw totals
green  = paid       (base)                  ┘
total  = projection  (the full bar height)
```

§61's "Important Rule" — do not stack the raw values (43,502 + 43,743 + 51,743) — is exactly
what the increments avoid: the segments sum to the projection, and each boundary lands on a
business figure (top-of-green = Invoiced, top-of-blue = Total Spent, top-of-orange =
Projection). Heights are a strict share of the total, no min-height, `Math.max` guards keep
the increments ≥ 0.

Layout: ONE bar, centred in the card (`flex-1 flex-col items-center justify-center` — verified
equal 115px side gaps), `rounded-t-md` + bottom border so it reads as a bar on an axis, with a
legend directly beneath stating the three CUMULATIVE values exactly ($1,591,916 / $1,566,916 /
$1,522,142 on job 1142) so a thin increment never loses its number; each segment also carries
a tooltip. Measured live: segments 3.0 / 5.5 / 185.8px summing to the 195px bar (13rem at this
app's 15px root), no card overflow.

Colours unchanged (green/blue/orange = PARTS_BAR.paid/purchased/projection); the
Projection-vs-Estimated meter untouched; no business calculation changed (§61 preserve rule).
758 tests pass, types + lint clean.

**Design-history note for the next person:** this visual has now been stacked (§58) → grouped
(§60) → stacked (§61). The tension is real and worth stating once: a stacked bar of these
nested values makes near-equal Invoiced/Spent look very different (thin middle increment);
grouped bars make them look similar but lose the "one bar, cumulative progression" reading.
§61 is the settled answer — single stacked bar, increments, with the legend carrying the exact
cumulative numbers so the thin-segment downside is covered by text rather than by changing the
shape. Do not "fix" the thin blue segment by re-scaling; it is correct.

### 40.6 Parts Cost tooltips, via a shared portal-based box (§59, 2026-08-06)

Reported (with a screenshot of an older build) as missing/inconsistent tooltips across the
Job Hour Details charts. Audited each chart named in §59 against the CURRENT code (post
§39-§40's redesign, not the screenshot's older layout):

* **Estimate to Complete vs Actual** — already has its own inline hover tooltip (name, phase ·
  dept, Quoted/Actual/Diff), built for the hover-dim interaction that chart already needs. No
  gap.
* **Quoted and Actual by Billing Group** — ECharts' own tooltip (`groupedBarOption` in
  `charts/theme.ts`), styled to the app's box (white bg, `sdc-border`, shadow, `chartFont()`).
  No gap.
* **Parts Cost / Projection vs Estimated** — the actual gap. Both relied on the native
  `title` attribute: no styling, a multi-second OS-controlled delay before it appears, no touch
  support, and — the sharpest problem — the hit target on the thin stacked-bar segments (a few
  px tall when Invoiced ≈ Spent, per §60/§61) made it hard to land the browser's own tiny native
  tooltip on the value that needed explaining most.

### New shared primitive: `components/charts/ChartTooltip.tsx`

One hook, `useChartTooltip()`, for every hand-rolled (non-ECharts) chart element in the app
that isn't already OK:

* **Rendered through a portal to `document.body`**, which is what makes several of §59's
  interaction rules hold structurally rather than by convention: it can never be clipped by a
  card's `overflow`/rounded corners (it isn't inside one), and it can't be hidden behind another
  element (last in the DOM, `z-[100]`).
* **`pointer-events-none`**, so it can never block a click, a drill, or a hover on the thing
  under it — §59's "must not block clicks or other chart interactions" is enforced by the one
  style rather than by every caller remembering not to intercept.
* **`position: fixed` at the pointer, clamped to the viewport** on both axes (flips above/left
  of the cursor near an edge, per §59's "remain inside the viewport… must follow… without
  covering the value"). Never moves the chart it describes — no layout shift, since it isn't a
  sibling of anything being measured.
* **Mouse hover shows/follows; a non-mouse pointerdown (touch/pen) toggles it** — §59's
  "touch users must be able to tap a value to open the tooltip," without binding a click handler
  that would fight a chart element's own click-to-drill behaviour.
* **The trigger is spread onto the LEGEND row, not just the bar segment** — `Amount Invoiced`,
  `Total Parts Cost Spent` and `Projection` legend lines share the same `TooltipData` as their
  segment, so the thin blue/orange increments (as little as a few px tall) still have a full-row
  hover target. This is §59's "sufficiently large hover target" fix for exactly the case the
  original screenshot's circle was pointing at.

Content follows §59's own examples: metric name, exact amount, job context ("Selected job" /
"Summed across N jobs"), and the related benchmark's difference where one applies — Total Parts
Cost Spent shows the amount committed-but-not-invoiced; Projection and the variance meter show
Estimated and the signed over/under dollar amount, colour-matched to the app's red-over/
green-under convention.

Verified live (real pointer hover, not synthetic events — an early synthetic-`MouseEvent` test
against the thin 3px segment intermittently failed to fire React's enter/leave synthesis and is
a test-harness artifact, not a product bug; a real `computer.hover` on the same segment showed
the tooltip correctly): tooltip renders in `document.body` (`parentIsBody: true`), `position:
fixed`, `z-index: 100`, `pointer-events: none`, fully inside the viewport, and disappears on
pointer-leave.

One lint issue surfaced and was fixed rather than suppressed: an SSR "mounted" gate
(`useState` + `useEffect(() => setMounted(true), [])`) around the portal tripped
`react-hooks/set-state-in-effect`. Removed rather than patched — the gate was solving a problem
that can't occur: the tooltip only ever renders because a mouse/touch handler already fired,
and no such event fires during a server render, so `document` is always available by the time
the component body runs.

No calculation changed (§59 didn't ask for any); the two existing charts' tooltips are
untouched. 758 tests pass, types clean, lint clean on both touched files.

---

## 41. Procurement stayed expanded after a job switch — a stale-mount bug (§53, 2026-08-06)

Reported with a screenshot of nested assemblies (nine levels deep) all expanded on page load.
The collapsed-by-default feature itself was already built — `AssembliesTab`'s
`collapsed` state initializes to `new Set(allKeys)` (every node collapsed), and every nested
`AssemblyRow`/`PartsDetailTable` is truly conditionally rendered (`{isOpen && (...)}`, not just
CSS-hidden) — so a fresh page load already collapsed correctly, verified live.

### 41.1 The actual bug: switching jobs without a full reload

`<AssembliesTab bom={bom} .../>` at the call site had no `key`. Selecting a different job
through the `Jobs` picker changes `?jobs=` via client-side navigation — the page Server
Component re-renders and streams a new `bom`, but `AssembliesTab` sits at the same position in
the same element type, so React reconciles it as the **same instance** and just updates its
props. `useState(() => new Set(allKeys))`'s lazy initializer runs **once**, on the very first
mount, and never again — so after a job switch, `collapsed` still holds the *previous* job's
node keys. None of those match the new job's tree, `collapsed.has(newKey)` is false for every
node, and every row renders open. Reproduced live: expanded one row on job 1142, switched to
job 1101 via the picker, and it rendered with a node open that had never been clicked on 1101 —
the exact bug, on the exact mechanism.

Fixed with `key={bom.jobId}` on `AssembliesTab`. Procurement only ever renders for a single
selected job (the `isMulti` branch above it skips Procurement entirely for a multi-job
selection), so `jobId` alone identifies "is this a different tree" — no separate reset effect
needed, and nothing else in `JobProcurement` (the Parts List tab, its filters, column widths)
is disturbed, since the key is scoped to `AssembliesTab` alone rather than the whole drawer.

### 41.2 Verified live, the reported scenario exactly

```
job 1142, fresh load            0 open rows
expand "1142-A-000"             1 open row (that one only)
switch to job 1101 (picker)     0 open rows   ← was leaking the prior job's expand state
switch back to 1142             0 open rows
```

Expand All / Collapse All are unchanged (`setCollapsed(new Set())` / `setCollapsed(new Set(allKeys))`)
and still work on the freshly-keyed instance. All part-level detail was already loaded in one
server-side `getJobBom` call — collapsing/expanding is pure client state over already-fetched
data, so there was never a second network request to avoid; the fix is entirely about not
reusing stale REACT state across a job switch, not about data fetching.

### 41.3 Not touched

A section's **loose parts not belonging to any assembly** (`section.parts`) render
unconditionally, with no collapse toggle of their own — pre-existing, unrelated to this bug, and
out of §53's report (which showed nested *assembly* expansion). Worth a separate ask if the team
also wants those collapsed by default; noted here rather than silently left findable only by
reading the component.

758 tests pass, types clean; the lint run on this file surfaces 6 pre-existing issues (Date.now()
called during render in three places, `document.body.style` mutated outside an effect in the
column-resize drag handler) — all at line numbers that exist unchanged in `HEAD`, confirmed
unrelated to this change.

---

## 42. Drill-throughs simplified: no footer, no row counts (§62, 2026-08-06)

Reported with a screenshot circling "Open full report" / "Export CSV" and the "680 of 680
punches" subtitle, asking for both gone across every Monthly ETC drill-through. Since Monthly
ETC's six drills (Engineering, Shop, Parts Spent, People Booked, Undefined Hours, Hours off
the grid) all route through two components — `HoursDetailPanel` for five of them,
`UndefinedHoursPanel` for the sixth — and both build on the shared `ui/Drill.tsx`, the fix
landed once at the shared layer plus each caller's own count text, rather than six times.

### 42.1 The footer: removed from the shared shell, not just unused by its one caller

`DrillPanel`'s `footer` prop and its rendering block are gone entirely, along with the
`DrillLink`/`DrillAction` exports that only ever fed it — `HoursDetailPanel`'s `exportCsv`
function and its `csvRow` import went with them (nothing else used either). Removed from the
component rather than left unused by every current caller: a future drill built on this shared
shell now has nowhere to reintroduce a footer without editing `Drill.tsx` itself, which is the
whole point of "one place to change it" (§47). No leftover footer band — the scrolling table
region is now the last thing in the card.

### 42.2 Counts: removed from the shared `DrillGroup`, plus each caller's own subtitle text

`DrillGroup`'s `count` prop (rendered as "262 punches" beside a group's name, and fed into the
expand/collapse tooltip as "Show the 262 punches behind this") is gone from the component, so
no caller can pass one back in. Each panel's own subtitle line changed to name the rollup
without counting it:

```
HoursDetailPanel        "3 groups by department · 680 of 680 punches" -> "Grouped by department"
                         "678 of 678 punches booked this month"        -> "Every punch booked this month"
UndefinedHoursPanel      "3 groups by department · 45 of 45 records"   -> "Grouped by department"
                                                              (ungrouped)-> "All records"
```

Two more counts turned up beyond the ticket's own examples, in the same spirit and fixed the
same way: the "Why these are undefined" reason chips said "180h · 45 entries" (now just the
hours), and the correctly-excluded disclosure said "Hide 45 correctly-excluded records
(1,501h)" (now "Hide correctly-excluded records (1,501h)"). Both are group-label counts of the
exact kind §62 asks to remove, just not literally in its example list.

### 42.3 What did NOT change

- **Hours and totals.** Every `hoursCell`/`fmtHours`/`usd` value, every group's total, the
  grand total, and the KPI reconciliation banner on Undefined Hours are untouched — none of
  this ticket's edits touch arithmetic, only which strings sit next to the numbers.
- **The header stat tiles** ("Records affected", "Employees affected" on Undefined Hours) —
  these are KPI-style number tiles in their own labelled grid, not a count buried in a
  subtitle/row/group-label, so they stay for the same reason "Total hours" stays.
- **The "Punches" grouping option** in the tray — that names a GROUPING DIMENSION ("show
  individual lines, not rolled up"), not a count of anything; only digits attached to a
  punch/record/line word were in scope.
- **Grouping, filtering, expand/collapse, Close, real-time updates.** None of the state or
  data-fetching changed — this was a text/markup change over already-working interaction.

### 42.4 Verified live

Engineering hours drill, job set unfiltered: subtitle reads exactly "Grouped by department";
group rows read "Mechanical Engineering 1,337" / "Controls Engineering 1,487" / "Service
Engineering 339" with no count anywhere; no "Open full report" or "Export CSV" in the DOM;
expanding a group still renders its 262 punch-line rows and its tooltip now reads the generic
"Hide these rows"; the total (3,162) still matches the KPI card above it. Undefined Hours drill:
subtitle "Grouped by department", reason chip "Job Not Found 180" with no entry count, excluded
disclosure "Hide correctly-excluded records (1,501)", reconciliation banner unchanged ("✓
Drill-through total matches KPI: 179.8 hours").

The one pre-existing thing this surfaced rather than caused: Engineering's three department
rows (1,337 + 1,487 + 339 = 3,163) sum to one hour more than the drill's own total (3,162) — a
sum-of-independently-rounded-parts artifact, unrelated to this change (no rounding or
arithmetic was touched) and not something §62 asked to fix.

Replaced the one test that asserted Export CSV existed with four regression guards in
`tests/drill-design.test.ts`: no footer prop on `DrillPanel`, no "Open full report"/"Export
CSV" text in any drill, no `count` prop on `DrillGroup`, and no `${x.length}`-driven
punch/record/line/group count pattern in either panel — so none of this can drift back in
through a future edit. 761 tests pass (four added, one retired), types clean, lint clean on
every touched file.

---

## 43. Undefined Hours drill: no top strip, no bottom footer (§63, 2026-08-06)

Reported with a screenshot circling the four-figure header strip (Undefined Hours / Records
Affected / Employees Affected / Correctly Excluded) and the bottom footer (the
correctly-excluded disclosure and the "From Current_Job_Hours.xlsx" provenance line), asking
for both gone from the Undefined Hours drill specifically.

### 43.1 What came out, and what stayed

Removed exactly what was named:

* The four-`Stat` header grid — the `Stat` component itself is now unused and deleted with it.
* The correctly-excluded disclosure ("Show correctly-excluded records (…)" and its expanded
  reason list) and the provenance line beneath it.

**Kept, because the ticket's own removal list did not name it and §42.28 requires it:** the
reconciliation banner ("✓ Drill-through total matches KPI: 179.8 hours"). It now sits directly
under the header's own bottom border instead of under the Stat grid's — no blank band where
the grid was, since the element was deleted rather than hidden.

Two pieces of now-dead state and styling went with the removed disclosure: `showExcluded`
(nothing reads or sets it any more) and `REASON_TONE.excluded` (the disclosure was its only
consumer; `REASON_TONE.fault`, used by the reason chips, stays).

### 43.2 Verified live

Opened the Undefined Hours drill: no "Records affected" / "Employees affected" / "Correctly
excluded" anywhere in the panel, no "correctly-excluded records" button, no
"Current_Job_Hours.xlsx" provenance line, and the reconciliation line is still there and still
correct. The panel now reads header → Close → reconciliation → "Why these are undefined" →
group tray → table → total, with no gap where the removed sections were.

Confirmed nothing else broke: expanding "Mechanical Engineering" still renders its 38
punch-line rows; typing into the search box still filters live (a real keystroke test — "Robert"
narrowed the table to "showing 0 of the 180 total" with "No records match these filters" and a
working Clear filters button); grouping, Close and the KPI figure are unchanged. Data,
grouping, search, totals and real-time behavior were never touched — this removed rendering
only. 761 tests pass, types clean, lint clean.

---

## 44. People Booked retired; its split moved onto Engineering and Shop (§64, 2026-08-06)

Reported with a screenshot circling the People Booked row, asking for it gone and its
eng/shop split shown inline on the two hours rows instead — `24 engineers` between the
status and the figure on Engineering, `21 shop` on Shop.

### 44.1 Not a new figure — the ticket's own caution, checked rather than assumed

§64 explicitly warns not to "simply move the existing People Booked value without
validating the Engineering and Shop split." Checked before touching anything: `GroupKpi.people`
(the count now surfacing on each row) was **already** computed in `getEtcMonthKpis` — from
`JobHoursDetail` filtered to the identical `month` and `jobIds` the hours figures beside it
use, split by the same `SECTION_GROUP` billing-group map the hours split uses. It was never
the People Booked block's own headline value (`peopleTotal`, the DISTINCT-overall count,
49 on 2026-07) — it was always the number behind that block's "24 eng · 21 shop" hint. So this
is not "move 49 into two boxes"; it's surfacing a figure that already existed, already scoped
identically to the hours it now sits beside.

**Reconciled live**, not just argued structurally: opened the Engineering drill, grouped by
Employee, counted 24 distinct groups. Same for Shop: 21. Both match the new inline labels
exactly.

### 44.2 What changed, and where

* `lib/etc-kpi-strip.ts` — `KpiBlock` gained `countLabel: string | null`; the `group()`
  helper builds it (`"24 engineers"` / `"21 shop"` — Engineering gets the full word since it
  reads naturally either way, Shop gets the ticket's own explicitly-sanctioned shorter form
  since "shopper" fits nobody). The whole `{ id: "people", ... }` block is deleted, and with
  it `KpiBlockId`'s `"people"` member and `DrillScope`'s `"All"` (the unscoped drill only
  the People block ever opened).
* `components/EtcMonthKpiCards.tsx` — `MetricBlock` renders `countLabel` between the status
  and the figure, exactly the ticket's ordering. Two `drill === "All"` branches (the
  unfiltered `scopedDetail` case and the drill title) simplified to their non-"All" arm, since
  nothing can produce that value any more.
* `tests/etc-kpi-strip.test.ts` — every list/count that assumed six blocks or the `"All"`
  scope updated to five and to the two remaining hours scopes; four new tests pin the
  headcount label's format, its singular case, that it reads the untouched `g.people` field
  (not a re-derived one), and that changing one group's headcount moves only that block
  (§37.4's property, extended to the new field).

### 44.3 The one real layout bug this surfaced

First attempt at "wrap cleanly on a narrow screen" put `flex-wrap` on the status/count/value/
Detail cluster but left it `shrink-0` — which is precisely what stops wrapping from ever
happening: `shrink-0` refuses to let the browser narrow that cluster at all, so under space
pressure the whole ROW overflows sideways rather than the cluster wrapping internally.
Verified live at both faults: with `shrink-0`, a forced-narrow row measured `overflowX: true`
at a fixed 36px height (clipped, not wrapped); swapping it for `min-w-0` (letting the cluster
shrink before it wraps) measured `overflowX: false` at 118px (three lines, nothing clipped).
The label's own `flex-1 truncate` still absorbs ordinary space pressure first, so this only
engages once even a fully truncated label leaves no room.

### 44.4 Verified live

Card shows exactly five rows (Engineering, Shop, Parts, Undefined, Off-grid). Engineering
reads `▼ 1,567 over  24 engineers  3,162  Detail`; Shop reads `On plan  21 shop  2,705
Detail` — both matching §64's example layouts character for character. At a realistic
narrow width (768px) every row stays one line with zero overflow. Nothing else on the card
moved: Parts/Undefined/Off-grid rows, their values, tones and Detail links are byte-identical
to before. 765 tests pass (4 added), types clean, lint clean.

**Left alone, deliberately:** `EtcMonthKpis.peopleTotal` and the `allPeople` Set that
computes it, in `lib/etc-month-kpis.ts` — still computed, still part of the reconciled type,
still tested in `etc-kpi-live.test.ts`. It is genuinely dead for display now (nothing reads
it), but it is backend computation rather than the "unused frontend component logic" §64 asks
to remove, and the ticket's own caution runs the other way — "do not remove shared
employee-count calculations if still required" — so it stays rather than being pruned as a
guess at a second request that was not made.
