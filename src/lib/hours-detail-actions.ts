"use server";

import { auth } from "@/lib/auth";
import { isValidMonth } from "@/lib/etc";
import { getEtcMonthHoursDetail, type JobHoursDetail } from "@/lib/job-hours-detail";
import { getPartsSpentDetail, type PartsSpentDetail } from "@/lib/parts-spent";
import { getJobPartsCost, type JobPartsCost } from "@/lib/sync-totaleto";

// The punch drill-through behind the Monthly ETC cards, fetched WHEN IT IS OPENED.
//
// ── Why this action exists (2026-08-04, performance pass) ────────────────────
//
// The ETC page used to load this with the page, every single time, for a panel that
// is CLOSED until somebody clicks "Detail". Measured on 2026-07 (49 jobs):
//
//     1,092 punch rows + the whole 120-row employee roster
//     46ms of database time — the single slowest query on the page
//     serialised into the RSC payload of every render
//
// "Every render" is the part that hurts. The route is re-rendered far more often
// than it is navigated to: a background refresh every 45s, a refetch on focus, one
// per filter change, and — until this same pass — one per realtime change event
// from any colleague. So the cost of a panel nobody had opened was being paid tens
// of times per session, on the heaviest page in the app.
//
// The unattributed-hours drill on the same strip already worked this way, with the
// reason stated in EtcMonthKpiCards: "fetched on click, not with the page —
// re-parsing it on every open would make the panel feel broken". This is the same
// judgement applied to the bigger of the two datasets.
//
// Behaviour is unchanged once open: same function, same scoping to the jobs the
// grid is rendering, same MAX_ROWS truncation flag.
export async function loadEtcMonthHoursDetail(month: string, jobIds: number[]): Promise<JobHoursDetail> {
  // Signed-in only. Every page is already behind auth (the (app) layout awaits it),
  // but a server action is a public endpoint of its own and has to say so itself.
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}".`);
  // The caller passes the jobs the grid is rendering, so the drill matches the card
  // that opened it. Validated rather than trusted: these go straight into a WHERE
  // clause, and an unbounded list from a hand-posted request would be a way to ask
  // for the entire punch table. The cap is far above any real month (the ETC grid
  // renders ~50 jobs).
  const ids = jobIds.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (ids.length === 0) return { rows: [], total: 0, sections: [], truncated: false };
  return getEtcMonthHoursDetail(month, ids);
}

// The same treatment for the "Parts spent" card, which until now was the one figure on
// the strip with nothing behind it. Fetched on open, scoped to the jobs the grid is
// rendering, and validated identically — a server action is a public endpoint whatever
// the component that calls it looks like.
export async function loadPartsSpentDetail(month: string, jobIds: number[]): Promise<PartsSpentDetail> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  if (!isValidMonth(month)) throw new Error(`Invalid month "${month}".`);
  const ids = jobIds.filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  return getPartsSpentDetail(month, ids);
}

// ── The SECOND level: what one job's parts money was actually spent on ───────
//
// "Job 1142 spent $1,065,713" is where the first level stops, and it is not where the
// question stops — the next thing anybody asks is what was bought. This returns the
// purchase-order lines behind that figure, straight from TotalETO: supplier, part
// number, description, quantity, unit price, and what has been invoiced.
//
// Reuses getJobPartsCost, which the Job Hour Details page already renders — so the
// deeper drill and that page cannot tell different stories about the same job.
//
// Note what this is NOT scoped to: the MONTH. getJobPartsCost returns the job's whole
// purchase history, because a part invoiced in July may have been ordered in March and
// the PO is the thing being examined. The panel says so rather than implying the lines
// sum to the month's figure.
export async function loadJobPartsLines(jobNumber: string): Promise<JobPartsCost> {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in.");
  // Job numbers are digits in this app ("1142"); anything else is a crafted request,
  // and this value reaches a SQL parameter.
  if (!/^\d{1,10}$/.test(jobNumber)) throw new Error(`Invalid job number "${jobNumber}".`);
  return getJobPartsCost(jobNumber);
}
