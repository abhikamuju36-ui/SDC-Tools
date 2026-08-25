# Performance baseline — SDC Tools ecosystem

Measured 2026-08-25 on **SERVER-APP1**, against the **production** builds and the
live PM2 processes. Every figure below is measured, not estimated; the method is
given so each can be re-run and compared after a change.

This document exists because the ecosystem had no performance baseline, which
made "is it faster?" unanswerable. Re-run §1 and §2 after any optimization and
append the new column rather than overwriting the old one.

---

## 0. Headline conclusion

**The backend is not the bottleneck.** Across all seven services, at rest:

| Metric | Range across all services |
|---|---|
| HTTP latency p50 | 0–2 ms |
| HTTP latency p95 | 1–15 ms |
| Event-loop latency p50 | 0.32–0.50 ms |
| Event-loop latency p95 | 1.55–1.90 ms |
| CPU | 0–2.5 % (of 10 cores) |
| Total RSS, all 8 processes | ~570 MB |

Nothing is CPU-starved, nothing is memory-pressured, and no event loop is
blocking. Anything a user experiences as slow is therefore either (a) **payload
and client-side render**, or (b) one of the few genuinely heavy operations
(Refresh Data, live Total ETO queries), not general server slowness.

Effort should go to payload size and client work. See §3.

> ⚠️ Caveat on the PM2 figures: they were captured at **~1.5–1.9 req/min**, i.e.
> effectively idle. They establish that there is no *baseline* resource problem;
> they are not a load test. A concurrent-user load test is listed as remaining
> work in §5.

---

## 1. Route baseline — `sdc-etc-planner` (port 4006)

Method: from an authenticated browser session on the server, for each route,
`fetch(route, {headers:{RSC:"1"}, cache:"no-store"})`, measuring time to first
byte, time to fully read the body, and body size. Three passes; figures below are
the steady-state (pass 2–3) values, which varied by <10%.

| Route | TTFB | Total | Payload | Budget (§18) |
|---|---|---|---|---|
| `/jobs` | 11 ms | 40 ms | 274 KB | ✅ |
| `/employees` | 11 ms | 43 ms | 58 KB | ✅ |
| `/audit-log` | 8 ms | 63 ms | 232 KB | ✅ |
| `/hours` | 9 ms | 132 ms | 205 KB | ✅ |
| `/etc` | 9 ms | ~200 ms | 659 KB | ✅ |
| `/quoted` | 9 ms | ~240 ms | **1,018 KB** | ⚠️ payload |
| `/build-readiness` | 8 ms | ~280 ms | **5,489 KB** | ❌ payload |
| `/tm` | 8 ms | 398 ms | 36 KB | ✅ |
| `/job-hours` | 9 ms | 234 ms | 428 KB | ✅ |
| `/job-cost-explorer` | 9 ms | ~600 ms | 120 KB | ⚠️ time |
| `/cash-flow` | 9 ms | **~1,260 ms** | 199 KB | ❌ time |

TTFB is uniformly 8–11 ms — the server starts responding essentially instantly on
every route. The cost is entirely in generating and transferring the body.

Cold-start note: the very first request to a route after process start is
noticeably slower (`/` measured 284 ms cold vs 40 ms warm; `/cash-flow` 2,545 ms
cold vs 1,260 ms warm). Compare warm-to-warm only.

## 1b. Other services

| Service | Port | Root route TTFB | Notes |
|---|---|---|---|
| sdc-assemblies | 4001 | 1.5 ms | 401 unauthenticated |
| sdc-readiness | 4002 | 1.4 ms | 401 unauthenticated |
| sdc-scheduler | 4003 | 2.0 ms | 200, 62.8 KB |
| sdc-statelogic | 4004 | 1.3 ms | 401 unauthenticated |
| sdc-calendar | 4005 | 2.7 ms | 200, 1.4 KB |
| sdc-etc-planner | 4006 | 3.2 ms | 307 → /login |

Measure over `127.0.0.1`, never `localhost` — the latter adds a ~200 ms IPv6
resolution penalty on this box and will make every service look 100× slower than
it is.

## 1c. Refresh Data

From the dashboard's own reporting: the full pass covers **9 sources in 17.7 s**,
scheduled hourly, and "Refresh Data" runs the identical pass on demand. This is
the heaviest routine operation in the ecosystem and is already within a
reasonable envelope for what it does.

## 1d. PM2 process baseline

| Process | RSS | CPU | Heap used / total | Restarts | `max_memory_restart` |
|---|---|---|---|---|---|
| sdc-etc-planner | 236.9 MB | 2.5 % | 184.8 / 191.0 MiB | 0 | **none** ⚠️ |
| sdc-scheduler | 50.3 MB | 1.1 % | 57.8 / 60.7 MiB | 2 | 400 M |
| sdc-readiness | 48.3 MB | 0.2 % | 31.4 / 34.1 MiB | 0 | 300 M |
| sdc-statelogic | 48.0 MB | 0.1 % | 15.2 / 19.8 MiB | 0 | 300 M |
| sdc-calendar | 47.9 MB | 0.7 % | 21.4 / 27.5 MiB | 0 | 300 M |
| sdc-assemblies | 47.9 MB | 0.0 % | 14.2 / 23.5 MiB | 0 | 300 M |
| sdc-updater-hub | 46.8 MB | 0.0 % | 12.4 / 16.8 MiB | 0 | 350 M |
| pm2-logrotate | 43.6 MB | 0.0 % | 11.4 / 14.1 MiB | 0 | 500 M |

High heap-*usage* percentages (92–97%) are not a leak signal on their own — V8
keeps the heap tight against its current total and grows on demand. The absolute
totals are all small. Treat a rising `Heap Size` *total* across days as the leak
signal, not the usage ratio.

Method: `pm2 jlist` from an **elevated** shell. PM2 runs as `NT AUTHORITY\SYSTEM`
here, so a normal `akamuju` session gets `EPERM` on `\\.\pipe\rpc.sock`. See
`docs/DEPLOYMENT.md` for the restart path that does not require elevation.

> **Do not paste raw `pm2 jlist` output into tickets or chats.** It dumps every
> process's full environment, which includes `ETO_PASSWORD` and other secrets in
> plaintext.

---

## 2. Ranked findings

### F1 — `/build-readiness` ships 5.48 MB to render 50 summary rows ❌

**Measured:** 5,611,698 chars. 50 job detail objects containing ~2,800
assemblies and **~15,000 part-level line items** (15,445 `qty` fields, 17,293
`expectedDate` fields, 2,760 `poNumber` fields).

**Root cause:** `getBuildReadinessData()`
(`src/lib/build-readiness-actions.ts:113`) selects `detailJson` for *every* row
of `BuildReadinessJobSnapshot` with no `WHERE` clause, parses it into `detail`,
and `build-readiness/page.tsx` hands the entire result to the
`BuildReadinessDashboard` client component as `initialData` — so all of it is
serialized into the RSC payload on every page load.

The bulk is `JobDetail.upcoming`. `build-readiness-sync.ts:340` writes
`incomingParts: [{ pn, qty }]` — **always a single-element array** — meaning one
`UpcomingDeliveryEntry` per part, ~15,000 of them, each additionally repeating
`jobId`, `jobName` and `assemblyLabel` that its parent job row already carries.

**Why it isn't simply removable:** `detail` is genuinely read across *all* jobs,
not only on drill-in — `BuildReadinessFilters.tsx:312` builds the supplier filter
list from `j.detail.vendors`, `BuildReadinessInsights.tsx:134,146,255` aggregates
blockers and assemblies cross-job, and `BuildReadinessDrillViews.tsx:401`
flat-maps blockers across jobs. Deleting the field breaks those panels.

**Fix (designed, not yet implemented):** move those cross-job aggregations
server-side and ship summary rows + small aggregates, fetching one job's full
`detail` on drill-in (precedent already exists in
`build-readiness-assembly-actions.ts`). Secondary, near-free win: drop the
redundant `jobId`/`jobName` from `UpcomingDeliveryEntry` and `BlockerEntry`, and
flatten `incomingParts` to scalar `pn`/`qty`.

**Expected:** 5,489 KB → under ~200 KB (>95% reduction).
**Risk:** the aggregations feed displayed operational figures. Requires
before/after equality checking on every panel, so it deserves its own pass.

### F2 — `/cash-flow` takes ~1.26 s ❌ (mostly inherent)

**Root cause:** two sequential awaits precede the parallel block —
`resolveAsOf(as)` then `getLatestSnapshotSummary()` — and only then does the
`Promise.all` start. But the dominant cost is `getCashFlowLines(asOf)` querying
Total ETO live, which is deliberate ("Current is always live against Total ETO").

**Fix:** `getProjectEstimates()` and `listSnapshots()` depend on neither `asOf`
nor `compareAsOf` and can be hoisted to start immediately, removing them from the
waterfall. This is a small, safe win; it does **not** address the ~1 s live
MSSQL query, which cannot be cached without showing a stale financial forecast
(§9: "do not improve speed by showing stale data").

**Priority:** low — one page, ELT-only audience, latency largely inherent.

### F3 — `sdc-etc-planner` has no `max_memory_restart` ⚠️

**Root cause:** `ecosystem.config.js` sets `max_memory_restart` on all seven
other PM2 apps but omits it on `sdc-etc-planner` — which is by far the largest
process (236.9 MB, 5× any other). If it ever leaks, nothing restarts it.

**Fix:** add `max_memory_restart: '600M'` (~2.5× current RSS, leaving headroom
for the 17.7 s refresh pass). One-line, low risk.

### F4 — `/quoted` ships 1,018 KB ⚠️

Not yet root-caused. Same investigation shape as F1.

### F5 — `newProjectsEnteringMonth` over-fetches and rescans 🔹

`src/lib/standard-pool-local.ts:105` loads **every** typed job with a
`startDate`, then discards all but one month's worth in JS
(`jobs.filter(...)`), then for each surviving job rescans the *entire*
`estimatedHours` array (`for (const job of entering) { for (const e of est) }`).

**Fix:** group `est` by `jobId` into a `Map` once — behaviour-identical. A DB-side
month filter would also help but risks a timezone-boundary shift in `monthOf()`,
so it needs care.

**Impact:** small at current data volumes; grows with job count.

### Non-findings — verified already optimized

Recorded so they are not re-investigated:

- **Client/Server boundaries are correct.** Zero `page.tsx` files are Client
  Components; every route entry is a Server Component, with 136 client *leaf*
  components. (`grep 'use client'` reports 144 files but only 136 have it as an
  actual directive — the rest match the phrase inside comments, including
  `(app)/layout.tsx`, which is an async Server Component.)
- **The two 1 MB dependencies are already code-split** behind `next/dynamic`:
  echarts (1,104 KB chunk) and ag-grid (1,061 KB), referenced as `import type`
  elsewhere. Total `.next/static` is 4.5 MB.
- **The Paylocity/Excel path is already tuned**, with figures in its own
  comments: ~12,600-row workbook ≈ 900 ms; an `onlyMonth` option cut a refresh
  5 s → 0.75 s; `prefetchedRows`/`prefetchedPoolHours` thread one shared parse
  through the whole pass instead of re-reading.
- **The per-row DB round-trips in `sync-actuals.ts` are deliberate**, not an N+1
  bug — see that file's comments at lines 284–306 and 377–380: the per-row
  `etcEntry` reads guard against the month being Submitted/Locked mid-sync and
  must not read a stale snapshot. Batching them naively breaks a documented
  concurrency guarantee.
- **`.next-verify*` are live dev tooling**, not stale build output, despite being
  ~138 MB — referenced in `.claude/launch.json`, `tsconfig.json`, `.gitignore`,
  and marked KEEP in `docs/CLEANUP_PHASE1_INVENTORY.md:346`.

---

## 3. Where effort should go

1. **F1** — the only finding worth a dedicated refactor. >95% payload cut on the
   heaviest page.
2. **F3** — one line, do it with anything else.
3. **F5**, **F2** waterfall — small, safe, cheap.
4. **F4** — root-cause it; likely the same shape as F1.

Explicitly *not* worth doing: a general memoization sweep, a bundle-splitting
pass, or an N+1 hunt. §2's non-findings show those are done or deliberate.

---

## 4. How to re-measure

Route baseline (§1), from an authenticated browser session:

```js
(async () => {
  const routes = ["/", "/employees", "/quoted", "/etc", "/job-hours",
    "/job-cost-explorer", "/hours", "/tm", "/build-readiness", "/cash-flow",
    "/jobs", "/audit-log"];
  const out = [];
  for (let pass = 0; pass < 3; pass++) for (const r of routes) {
    const t0 = performance.now();
    const res = await fetch(r, { headers: { RSC: "1" }, cache: "no-store" });
    const ttfb = performance.now() - t0;
    const buf = await res.arrayBuffer();
    out.push({ pass, r, status: res.status, ttfb: Math.round(ttfb),
      total: Math.round(performance.now() - t0),
      kb: Math.round(buf.byteLength / 1024) });
  }
  console.table(out);
})();
```

Discard pass 0 (cold). Service TTFB (§1b): `curl` against `127.0.0.1`, not
`localhost`. Process baseline (§1d): `pm2 jlist` from an elevated shell.

---

## 5. Remaining work / known gaps

- **No concurrent-user load test.** All figures are single-session at ~1.5
  req/min. Behaviour under 10–20 simultaneous users is unmeasured, and it is the
  most likely place for an undiscovered problem.
- **No long-session memory trend.** A leak would show as `Heap Size` *total*
  climbing over days; one snapshot cannot show it. Sample `pm2 jlist` daily.
- **Client render/hydration not yet profiled.** Given §0, this is where remaining
  user-perceived slowness most likely lives — needs a Performance-panel trace on
  `/build-readiness` and `/etc`, not just payload figures.
- **The other six apps have route-level baselines only** (§1b), not per-page
  figures. `sdc-scheduler` in particular is unmeasured beyond its root route.
