# SDC Projects Reports

Replaces the `Project Planner Data Control.xlsx`, `End Of Month ETC Sheet.xlsx`,
and `Standard Fees.xlsx` workbooks with a single web app: monthly
Estimate-to-Complete tracking, the Projects (quoted hours) grid, and the
Standard Fees calculation — sourced live from Power BI (Fabric warehouse +
SharePoint) and TotalETO.

Next.js 16 (App Router) · React 19 · Prisma / MySQL · next-auth v5.

## Development

```bash
npm run dev        # dev server with hot reload, http://localhost:3010
```

Use `localhost:3010` (not the hostname) in dev — see the dev-origin note in
`next.config.ts`.

## Production

```bash
npm run build      # optimized build (also runs the type check)
npm start          # production server on port 3010
```

`npm start` runs the same server dev uses, minus hot-reload — faster, lower
memory, and it surfaces prod-only type/route errors at build time. The
6-hourly auto-sync (`src/instrumentation.ts`) runs under `npm start`
exactly as in dev.

**Run it as a durable service** (so it survives logout/reboot) rather than a
bare `npm start` in a terminal. On this Windows server the simplest options are
a scheduled task set to run at startup, or a process manager (e.g. `pm2` /
`nssm` wrapping `npm start`). The app must run on **SERVER-APP1** — it is the
MySQL host and the TotalETO SQL host (`10.0.0.7`), so both are local.

If a build ever fails the type check on a `/standard-sheet` route error, delete
the stale preview build dirs and rebuild: `rm -rf .next .next-preview*` then
`npm run build`. (They are git-ignored and tsconfig-excluded; this only matters
if an old dev:preview run left them behind.)

## Environment

All secrets live in `.env` (git-ignored): `DATABASE_URL`, the `PBI_*` Power BI
service-principal credentials, `TOTALETO_DB_*`, `AUTH_*` (next-auth + Entra),
and the Standard-Sheet / Audit-Log gate passwords. See `.env` for the full set.

## Tests

```bash
npm test           # node:test unit tests for the ETC / Standard Fees math
```

## Data sources & freshness

- **Hours worked** — read from the Paylocity export `Current_Job_Hours.xlsx`
  every 6 hours (`src/lib/sharepoint-hours.ts`). Preferred source is the
  OneDrive-synced copy on local disk (`JOB_HOURS_LOCAL_PATH`); Microsoft Graph
  is the fallback. Reading a file needs no token, which is what lets the sync
  work from a service in Windows session 0 — see §12 of `DEVLOG.md`.
  **The OneDrive folder must stay pinned "Always keep on this device"**, or it
  reverts to a placeholder that only hydrates in an interactive session.
- **Parts costs / jobs / costing** — synced from TotalETO directly
  (`src/lib/sync-totaleto.ts`).
- **Quoted hours** — owned by this app (the Projects tab), no longer pulled.
- **ETC history / category pools** — on-demand backfills only, via Power BI DAX
  (`src/lib/sync-etc-history.ts`) and the Fabric warehouse. Power BI is not in
  the live path for any figure the ETC grid shows.
- The ETC header shows how fresh the hours feed is ("Hours Refreshed Thru", the
  latest work date in the export) alongside when the app last pulled it.

Two multi-day silent stale-hours outages happened in July, so failures are now
surfaced rather than logged and forgotten. The ETC page shows a red banner when
either the feed (`hours_actual`) or the step that writes the grid's own numbers
(`etc_hours_worked`) last failed — they are tracked separately because the first
can succeed while the second throws, which is exactly how the grid went stale
behind a header that said everything was fine.

An amber banner reports time booked without a valid job number (`"Not Defined"`
and similar). That time cannot appear in any figure on the page — there is no
job to put it against — so it is stated rather than left as an unexplained gap
between the app's totals and payroll.

> To check the data against its source rather than trusting the header, run
> `scripts/archive/_recon_kpi_vs_truth.ts` (stored vs a fresh pull) or
> `scripts/archive/_recon_july_2026.ts` (the app's transforms vs Power BI's measures).

The committed `Job Hours Report - *.Report` / `.SemanticModel` folders are the
Power BI source of truth this app replicates; the `.SemanticModel` TMDL holds
every measure's DAX and was used to verify the app's calculations 1:1.
