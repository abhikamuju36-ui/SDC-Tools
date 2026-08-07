import "server-only";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { validJobTypeFilter } from "@/lib/job-filters";
import { SECTIONS, PARTS_COST_SECTION } from "@/lib/sections";
import { coveredMonths } from "@/lib/actual-hours";
import { getPartsCostSpentByJob, getPartsInvoicedByJob } from "@/lib/sync-totaleto";
import { effectiveNewEtc } from "@/lib/etc";
import { runDax } from "@/lib/powerbi-client";
import { withTimeoutOrNull } from "@/lib/with-timeout";
import type { HoursByYear, JobCostRow } from "@/lib/job-cost";

// ── Job Cost Explorer data assembly ─────────────────────────────────────────
//
// The standalone app this replaces (D:\AI Projects\new app) sourced every
// column from Power BI, live, on every load. Per the integration audit, only
// TWO things here still have no equivalent anywhere in this app and still go
// to Power BI: Sales Price (as a fallback — the primary source is the same
// manually-maintained inventory file the original app used) and nothing else.
// Everything else — job identity, actual hours by billing group, and parts
// cost — is read from this app's own, already-more-current pipelines.

// Billing-group bucket per section code, from the FULL section list (every
// phase), not the narrower ETC-grid-scoped subset — Job Cost Explorer's
// Actual/Eng/Shop/Other columns are whole-job totals across every phase.
const SECTION_BUCKET: Record<string, "eng" | "shop" | "other"> = {};
for (const s of SECTIONS) {
  SECTION_BUCKET[s.code] = ["ME", "CE", "General Engineering", "Engineering"].includes(s.group)
    ? "eng"
    : s.group === "Shop"
      ? "shop"
      : "other";
}

const LIFETIME_START = new Date(1990, 0, 1);
const LIFETIME_END_EXCLUSIVE = new Date(2100, 0, 1);

// A live TotalETO connection failure surfaced during integration testing
// (summing 35 years of AP-document history across every job is a heavier
// query than the single-job budget §69 measured for /job-hours). Bounded
// with the same withTimeoutOrNull pattern rather than left to hang or crash
// the whole page — a slow/unreachable Total ETO now degrades Parts
// Purchased/Invoiced to "—" instead of an error boundary. 25s is a
// considered starting point (batch, not per-job, so more generous than
// UPSTREAM_BUDGET_MS), not a measured number yet — revisit once this page
// has real usage to profile against.
const PARTS_BATCH_BUDGET_MS = 25_000;

type JobHoursTotals = {
  actualHours: number;
  engineeringHours: number;
  shopHours: number;
  otherHours: number;
  hoursByYear: HoursByYear;
};

/**
 * Per-job Actual/Engineering/Shop/Other hours and the per-year Eng/Shop
 * breakdown — the same three-era read `lib/actual-hours.ts` uses (migration
 * snapshot + frozen ETC for uncovered months + live punches for covered
 * months), bucketed by billing group and, for the frozen/punch eras, by the
 * year the work fell in. The migration-snapshot era carries no month, so it
 * contributes to the flat totals only, never to hoursByYear — matching how
 * the original app's Power BI year breakdown could never have covered
 * pre-tracking history either.
 */
async function loadJobHoursAndYears(jobPks: number[]): Promise<Map<number, JobHoursTotals>> {
  const out = new Map<number, JobHoursTotals>();
  if (jobPks.length === 0) return out;

  const covered = await coveredMonths();
  const [historical, frozen, punches] = await Promise.all([
    prisma.estimatedHours.findMany({
      where: { jobId: { in: jobPks } },
      select: { jobId: true, section: true, actualHistoricalHours: true },
    }),
    prisma.etcEntry.groupBy({
      by: ["jobId", "section", "month"],
      where: { jobId: { in: jobPks }, section: { not: PARTS_COST_SECTION }, month: { notIn: covered } },
      _sum: { hoursWorked: true },
    }),
    prisma.jobHoursDetail.groupBy({
      by: ["jobId", "section", "month"],
      where: { jobId: { in: jobPks }, month: { in: covered } },
      _sum: { hours: true },
    }),
  ]);

  function entry(jobPk: number): JobHoursTotals {
    let e = out.get(jobPk);
    if (!e) out.set(jobPk, (e = { actualHours: 0, engineeringHours: 0, shopHours: 0, otherHours: 0, hoursByYear: {} }));
    return e;
  }
  function addTotal(jobPk: number, section: string, hrs: number) {
    if (!hrs) return;
    const e = entry(jobPk);
    e.actualHours += hrs;
    const bucket = SECTION_BUCKET[section] ?? "other";
    if (bucket === "eng") e.engineeringHours += hrs;
    else if (bucket === "shop") e.shopHours += hrs;
    else e.otherHours += hrs;
  }
  // hoursByYear only ever tracks Eng/Shop, matching the original's
  // HOURS_BY_YEAR_DAX — "other" hours have no per-year rate to apply anyway.
  function addYear(jobPk: number, section: string, month: string, hrs: number) {
    if (!hrs) return;
    const bucket = SECTION_BUCKET[section];
    if (bucket !== "eng" && bucket !== "shop") return;
    const e = entry(jobPk);
    const year = month.slice(0, 4);
    const y = (e.hoursByYear[year] ??= { eng: 0, shop: 0 });
    y[bucket] += hrs;
  }

  for (const h of historical) addTotal(h.jobId, h.section, Number(h.actualHistoricalHours ?? 0));
  for (const f of frozen) {
    const hrs = Number(f._sum.hoursWorked ?? 0);
    addTotal(f.jobId, f.section, hrs);
    addYear(f.jobId, f.section, f.month, hrs);
  }
  for (const p of punches) {
    const hrs = Number(p._sum.hours ?? 0);
    addTotal(p.jobId, p.section, hrs);
    addYear(p.jobId, p.section, p.month, hrs);
  }
  return out;
}

export type LiveEtcReference = { engHours: number; shopHours: number; partsCost: number; month: string };

/**
 * A REFERENCE figure only — never fed into the cost/profit calc (that stays
 * on the static snapshot, per the integration decision to reconcile before
 * replacing). Per job, this app's own live ETC total (effectiveNewEtc summed
 * by billing group + the Parts Cost section) for the latest month that job
 * has any EtcEntry rows in — so it's always "current", not tied to whichever
 * month happens to be open right now.
 */
async function loadLiveEtcReference(jobPks: number[]): Promise<Map<number, LiveEtcReference>> {
  const out = new Map<number, LiveEtcReference>();
  if (jobPks.length === 0) return out;

  const latest = await prisma.etcEntry.groupBy({
    by: ["jobId"],
    where: { jobId: { in: jobPks } },
    _max: { month: true },
  });
  const pairs = latest
    .filter((r): r is { jobId: number; _max: { month: string } } => r._max.month != null)
    .map((r) => ({ jobId: r.jobId, month: r._max.month }));
  if (pairs.length === 0) return out;

  const entries = await prisma.etcEntry.findMany({
    where: { OR: pairs.map((p) => ({ jobId: p.jobId, month: p.month })) },
    select: { jobId: true, section: true, month: true, needsReview: true, newEtc: true, newEtcDraft: true, priorEtc: true, hoursWorked: true },
  });

  for (const e of entries) {
    let ref = out.get(e.jobId);
    if (!ref) out.set(e.jobId, (ref = { engHours: 0, shopHours: 0, partsCost: 0, month: e.month }));
    const value = effectiveNewEtc(e);
    if (e.section === PARTS_COST_SECTION) ref.partsCost += value;
    else if (SECTION_BUCKET[e.section] === "eng") ref.engHours += value;
    else if (SECTION_BUCKET[e.section] === "shop") ref.shopHours += value;
  }
  return out;
}

// ── The two hand-maintained snapshot files, relocated from the standalone
// app's root into this repo. Same lifecycle as before: someone regenerates
// them from Standard Fees.xlsx / the inventory export and drops the file in —
// nothing here writes to them.
const JOB_COST_DATA_DIR = path.join(process.cwd(), "src", "data", "job-cost");

async function readJsonFile<T>(name: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(JOB_COST_DATA_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type InventoryJob = { jobId: string; salesPrice?: number; percentComplete?: number };
type InventoryFile = { asOf?: string; jobs?: InventoryJob[] };

type EtcSnapshotJob = { jobId: string; etcEngHours?: number | null; etcShopHours?: number | null; etcPartsCost?: number | null };
type EtcSnapshotFile = { refreshedThru?: string; jobs?: EtcSnapshotJob[] };

async function loadInventoryOverrides(): Promise<{ map: Map<string, InventoryJob>; asOf: string | null }> {
  const raw = await readJsonFile<InventoryFile>("inventory-data.json");
  const map = new Map<string, InventoryJob>();
  for (const j of raw?.jobs ?? []) map.set(String(j.jobId), j);
  return { map, asOf: raw?.asOf ?? null };
}

async function loadEtcSnapshot(): Promise<{ map: Map<string, EtcSnapshotJob>; refreshedThru: string | null }> {
  const raw = await readJsonFile<EtcSnapshotFile>("etc-data.json");
  const map = new Map<string, EtcSnapshotJob>();
  for (const j of raw?.jobs ?? []) map.set(String(j.jobId), j);
  return { map, refreshedThru: raw?.refreshedThru ?? null };
}

// The one Power BI query this integration still needs — Sales Price, as a
// fallback for any job the inventory file doesn't cover. Ported from the
// original app's JOBS_DAX, narrowed to just this one measure since every
// other column now comes from this app's own data.
const SALES_PRICE_DAX = ["EVALUATE", "SUMMARIZECOLUMNS(", "  'Job'[Job Id],", '  "SalesPrice", [Sales Total Amount]', ")"].join("\n");

async function loadSalesPriceFallback(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const rows = (await runDax(SALES_PRICE_DAX)) as Record<string, unknown>[];
    for (const r of rows) {
      const jobId = String(r["Job[Job Id]"] ?? r["Job Id"] ?? "");
      const sales = Number(r["SalesPrice"]);
      if (jobId && Number.isFinite(sales)) map.set(jobId, sales);
    }
  } catch {
    // Power BI unreachable — fall through with an empty fallback, same
    // resilience the original app had ("serve what you have, don't blank
    // the page"). The inventory file's own coverage is unaffected.
  }
  return map;
}

export type JobCostData = {
  rows: JobCostRow[];
  inventoryAsOf: string | null;
  etcRefreshedThru: string | null;
  liveEtcByJobId: Map<string, LiveEtcReference>;
  partsCostAvailable: boolean;
};

export async function loadJobCostRows(): Promise<JobCostData> {
  const jobs = await prisma.job.findMany({
    where: validJobTypeFilter,
    select: { id: true, jobId: true, jobName: true, status: true, customer: true, startDate: true, completeDate: true },
  });
  const jobPks = jobs.map((j) => j.id);

  let partsFailed = false;
  const onPartsFail = (error: unknown) => {
    partsFailed = true;
    console.error("[job-cost-source] Total ETO parts query failed or timed out", error);
  };

  const [hoursByJobPk, partsPurchased, partsInvoiced, inventory, etcSnapshot, salesFallback, liveEtcByJobPk] = await Promise.all([
    loadJobHoursAndYears(jobPks),
    withTimeoutOrNull("Total ETO parts purchased (Job Cost Explorer)", PARTS_BATCH_BUDGET_MS, () => getPartsCostSpentByJob(), onPartsFail),
    withTimeoutOrNull("Total ETO parts invoiced (Job Cost Explorer)", PARTS_BATCH_BUDGET_MS, () => getPartsInvoicedByJob(LIFETIME_START, LIFETIME_END_EXCLUSIVE), onPartsFail),
    loadInventoryOverrides(),
    loadEtcSnapshot(),
    loadSalesPriceFallback(),
    loadLiveEtcReference(jobPks),
  ]);
  const partsPurchasedMap = partsPurchased ?? new Map<string, number>();
  const partsInvoicedMap = partsInvoiced ?? new Map<string, number>();

  const liveEtcByJobId = new Map<string, LiveEtcReference>();
  const rows: JobCostRow[] = jobs.map((j) => {
    const h = hoursByJobPk.get(j.id);
    const inv = inventory.map.get(j.jobId);
    const etc = etcSnapshot.map.get(j.jobId);
    const salesPrice = inv?.salesPrice ?? salesFallback.get(j.jobId) ?? null;

    const liveEtc = liveEtcByJobPk.get(j.id);
    if (liveEtc) liveEtcByJobId.set(j.jobId, liveEtc);

    return {
      jobId: j.jobId,
      jobName: j.jobName,
      status: j.status,
      customerName: j.customer ?? null,
      // No source has ever populated this — the original app's own comment
      // notes the Power BI model has no machine-type column on 'Job' either.
      machineType: null,
      actualHours: h?.actualHours || null,
      engineeringHours: h?.engineeringHours || null,
      shopHours: h?.shopHours || null,
      otherHours: h?.otherHours || null,
      partCost: partsPurchasedMap.get(j.jobId) ?? null,
      partInvoiced: partsInvoicedMap.get(j.jobId) ?? null,
      salesPrice,
      startDate: j.startDate ? j.startDate.toISOString().slice(0, 10) : null,
      completeDate: j.completeDate ? j.completeDate.toISOString().slice(0, 10) : null,
      percentComplete: inv?.percentComplete ?? null,
      hoursByYear: h?.hoursByYear ?? {},
      etcEngHours: etc?.etcEngHours ?? null,
      etcShopHours: etc?.etcShopHours ?? null,
      etcPartsCost: etc?.etcPartsCost ?? null,
    };
  });

  return { rows, inventoryAsOf: inventory.asOf, etcRefreshedThru: etcSnapshot.refreshedThru, liveEtcByJobId, partsCostAvailable: !partsFailed };
}
