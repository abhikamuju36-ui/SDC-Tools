# Power BI / Fabric continuity — runbook

Written **2026-07-30**. Companion to [GRAPH-APP-ONLY-SETUP.md](GRAPH-APP-ONLY-SETUP.md),
which covers the SharePoint hours sync. This one covers the two things that are
*working today but on a clock*.

## The two clocks

| | window | consequence when it fires |
|---|---|---|
| **Power BI trial expiring** | **2 days** (banner, 2026-07-30) | Workspace loses capacity. `runDax` and the Fabric warehouse path both fail. |
| **`PBI_CLIENT_SECRET` expiring** | **unknown — nobody has checked** | Same, plus it takes the SharePoint fix down with it. |

### Why the secret matters more than it looks

One secret authenticates **three** things:

1. `runDax` → the Power BI semantic model (`powerbi-client.ts`)
2. The Fabric Data Warehouse direct-SQL path (`fabric-warehouse.ts`)
3. The app-only Graph fix for the hours sync, once consented — it uses the same
   registration (`GRAPH_CLIENT_SECRET` = `PBI_CLIENT_SECRET`)

When it lapses, all three stop **on the same day**. TotalETO and the app's own
MySQL keep working, so the app will not look broken — it will look *stale*. That
is exactly the failure mode that went unnoticed from 2026-07-24 to 07-29.

**Action, five minutes, no approvals needed:** Entra admin centre →
**App registrations** → **SDC Sheet** → **Certificates & secrets** → read the
secret's **Expires** date. Put it in a calendar reminder 30 days early. Do this
before anything else in this document.

While there, consider swapping the secret for a **client certificate**: longer
lived, and not a copyable string sitting in `.env`. It's a small change to the
`ConfidentialClientApplication` config in both `powerbi-client.ts` and
`sharepoint-hours.ts` (`clientCertificate` instead of `clientSecret`).

---

## What actually depends on Power BI

Only three modules call `runDax`. This is the complete blast radius:

| caller | what it reads | if the model goes away |
|---|---|---|
| `sync-powerbi.ts` | `[Cost Quoted]` → `Job.costQuoted`; category pools (`[Hours being pulled this month]`, `[Previous Month Pulled Hours]`, `[Hours Available]`, `[Rate]`, `[Standard Fee]`) | **Job cost budget + the Standard Fees pool panel stop updating.** Stored values persist. |
| `sync-etc-history.ts` | `[ETC Historical Hours/Costs]`, `…Prior Month`, `…Left`, `[ETC Name]`, `[ETC Begin Date]` | **Backfill only.** The 10 months already backfilled are in MySQL. Nothing live breaks. |
| `parts-budget-projection.ts` | `[Part Cost Estimated To Complete]` | **Nothing.** As of 2026-07-30 this is reconciliation-only — the projection was moved onto the app's own Parts New ETC. |
| `job-bom.ts` | the `Assembly` table (BOM cost hierarchy on `/jobs/[id]`) | **BOM cost report stops.** No app-owned equivalent. |

What does **not** depend on Power BI at all: hours (SharePoint), parts cost
(TotalETO), the whole ETC month lifecycle, employees, the Scheduler links.

So a lapsed trial degrades the app; it does not stop it. The daily ETC workflow
survives. Know this before paying under time pressure.

---

## Decision to make before the trial lapses

### Option A — buy the licence / capacity

Simplest. Nothing in the code changes. Choose this if the BOM cost report and
live quoted-cost sync matter, which they probably do.

Note what's actually needed: the workspace needs **capacity**, and the service
principal needs its workspace role (SDC Sheet is already an Admin on
`SDC Reports`) plus the tenant's *"service principals can use Fabric APIs"*
switch, which is already on. Buying a per-user Pro licence for one person is
**not** necessarily the same thing as keeping a workspace's capacity — confirm
with whoever owns the tenant which SKU restores the `executeQueries` path.

### Option B — move to the Fabric warehouse (`fabric-warehouse.ts`)

`fabric-warehouse.ts` already exists, reads the **same warehouse the semantic
model imports from**, uses the same service principal with a
`database.windows.net`-scoped token, and was verified against the live warehouse
on 2026-07-19. **Nothing imports it** — it is finished, unwired code.

It removes the dataset's scheduled refresh and the gateway from the chain, which
is strictly fewer moving parts for the same data. What it has today:

- `getEtcPeriods()` → `dbo.EstimateToClosePeriod`
- `getEstimateToClose()` → the ETC/Standard-Fees history rows
- `queryWarehouse<T>(sql)` → arbitrary read-only T-SQL

**Important:** Option B is not an escape from the trial. The Fabric SQL endpoint
lives on the same capacity. If capacity lapses, this path lapses with it. Option
B buys resilience against *refresh and gateway* failure, not against
*licensing*. Don't confuse the two — that mistake is easy to make here.

### Option C — accept the degradation

Let the trial lapse, keep the stored values, lose the BOM report and live quoted
sync. Defensible if the BOM report isn't being used. Requires a deliberate
decision, not a default.

**Recommendation:** A now (it's a deadline), then B afterwards on your own
schedule, because B removes the refresh/gateway fragility regardless of
licensing.

---

## Verification — run these first, and after any change

Both scripts check each stage separately and name the one that failed, rather
than surfacing an opaque 401:

```bash
npx tsx scripts/check-powerbi-auth.ts
```

Checks: env vars → token → workspace visible → dataset visible →
`executeQueries` returns rows.

```bash
npx tsx scripts/check-graph-auth.ts
```

Checks: env vars → token → `roles` claim → site lookup → file download. Use this
to confirm the SharePoint consent landed *before* restarting anything.

**Run `check-powerbi-auth.ts` today**, while the trial is still alive, so you
have a known-good baseline to compare against after it lapses. Without that
baseline you won't be able to tell a licensing failure from a secret expiry —
they present almost identically.

---

## Order of operations

1. **Read the secret's expiry date.** Five minutes, unblocks nothing else but
   removes the largest unquantified risk.
2. **Run both check scripts** and save the output as a baseline.
3. **Decide on the trial** (A / B / C above) — 2 days.
4. **Get admin consent** for `Sites.Selected` (Step 1 of
   [GRAPH-APP-ONLY-SETUP.md](GRAPH-APP-ONLY-SETUP.md)), then Step 2's per-site
   grant, then the `GRAPH_*` env vars and a restart. This fixes the live outage.
5. **Stopgap until 4 lands:** `pm2 kill` then start PM2 from an interactive
   `akamuju` logon. Restores the hours sync until that session ends. It is not a
   fix, and if you log off it breaks again.

Items 1–2 need no approvals. Item 3 needs a budget holder. Item 4 needs an Entra
admin plus someone with site admin / `Sites.FullControl.All`.
