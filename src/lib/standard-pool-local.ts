import "server-only";
import { prisma } from "@/lib/prisma";
import { round2, isValidMonth } from "@/lib/etc";
import { VALID_JOB_TYPES } from "@/lib/job-filters";
import { POOL_CATEGORIES, POOL_QUOTED_SECTION, type PoolCategory } from "@/lib/sections";
import { fetchJobHoursRowsWithIssues, type PoolHoursByMonth } from "@/lib/sharepoint-hours";

// The "Standard Fees By Department" pool ledger, computed from the app's OWN
// data instead of Power BI.
//
// ── Why ────────────────────────────────────────────────────────────────────
//
// The pools were the last figure on the Monthly ETC page still waiting on a
// Power BI ETC period. Upstream publishes those periods roughly two months
// behind, so for the month people are actually working in there was nothing to
// pull: the 6-hour pass ran, found no period, correctly wrote nothing, and the
// panel sat showing last month's numbers "as an estimate" — read-only, because
// with no row of its own for the month there was nothing to save a manual
// pulled-hours edit into. This closes that gap: every driver now comes from a
// feed the app already refreshes every 6 hours.
//
// ── The three drivers ──────────────────────────────────────────────────────
//
// Previous Month Pulled Hours — despite the name, the prior month's NEW ETC
//   HOURS, i.e. the remaining pool balance carried forward. Already local (see
//   sync-powerbi.ts's own note: verified across 28 archived month-pairs, 22
//   match prior-month New ETC exactly and ZERO match prior-month Hours Pulled).
//
// New Hours Added this Month — quoted hours in the pool's section, summed over
//   jobs whose Job.startDate falls in the month. Verified against Power BI's
//   [Standard Fees - Monthly Process - Hours Quoted by ETC Period] on
//   2026-07-31: EXACT in all 32 comparable cells (8 months x 4 categories,
//   2025-11 through 2026-06), including awkward values like 396.90, 1059.20 and
//   523.80 that no coincidence produces. See scripts/_recon_pool_*.ts.
//
//   Membership is anchored on startDate and nothing else. Type gates, billable
//   and excludedFromStandardFees were all tried during that verification and
//   every one of them made the match worse or left it unchanged — the upstream
//   measure counts a job from the month it starts, full stop.
//
// Hours Worked this Month — company-wide punches in the pool's phase/function,
//   from the same Paylocity export the ETC grid's Hours Worked already uses
//   (see sharepoint-hours.ts's PoolHoursByMonth for why these are tallied
//   separately from the job rollups). Not part of the formula chain — Hours
//   Available and New ETC Hours never read it — it is displayed, and it seeds
//   the default for the manual pulled cell on a brand-new month.
//
// ── What stays manual ──────────────────────────────────────────────────────
//
// Hours being pulled this month, and Rate. Preserved verbatim for any row that
// already exists; only the drivers and the figures derived from them are
// rewritten. Same contract syncCategoryPoolsFromPowerBi had, so a manager's
// decision is never overwritten by a background pass.

export type LocalPoolResult = {
  poolsUpserted: number;
  month: string;
  // Set when the month has no punch data yet (e.g. the export hasn't been
  // refreshed since the month began). The pools are still written — Hours
  // Worked is simply 0 — but the caller says so rather than reporting a
  // clean success over a figure nobody has data for.
  noPunchData: boolean;
};

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// New Hours Added, per pool, for `month` — the verified definition above.
export async function quotedHoursEnteringMonth(month: string): Promise<Record<PoolCategory, number>> {
  const jobs = await prisma.job.findMany({
    // Type gate as everywhere else: a job with no Type is noise and must never
    // reach a figure. It makes no difference to the verified match (every job
    // in the archived months is typed) but the rule is not conditional on that.
    where: { type: { in: [...VALID_JOB_TYPES] }, startDate: { not: null } },
    select: { id: true, startDate: true },
  });
  const entering = jobs.filter((j) => j.startDate && monthOf(j.startDate) === month).map((j) => j.id);

  const out = Object.fromEntries(POOL_CATEGORIES.map((c) => [c, 0])) as Record<PoolCategory, number>;
  if (entering.length === 0) return out;

  const est = await prisma.estimatedHours.findMany({
    where: { jobId: { in: entering }, section: { in: Object.values(POOL_QUOTED_SECTION) } },
    select: { section: true, quotedHours: true },
  });
  for (const category of POOL_CATEGORIES) {
    const section = POOL_QUOTED_SECTION[category];
    out[category] = round2(
      est.filter((e) => e.section === section).reduce((s, e) => s + Number(e.quotedHours), 0),
    );
  }
  return out;
}

// Recompute and persist `month`'s four pool rows from local data.
//
// `prefetchedPoolHours` lets the 6-hour pass hand over the tally from the parse
// it already did — the workbook is ~12,600 rows and costs ~900ms to read, and
// re-reading it here would undo the saving the shared-parse work bought.
//
// Callers are responsible for the ledger eligibility check
// (poolRefreshBlockedBy): a submitted month is frozen, and an archived month
// anchors every later month's starting balance.
export async function computeCategoryPoolsLocally(
  month: string,
  prefetchedPoolHours?: PoolHoursByMonth,
): Promise<LocalPoolResult> {
  if (!isValidMonth(month)) throw new Error(`"${month}" is not a valid month (expected YYYY-MM).`);

  const poolHours = prefetchedPoolHours ?? (await fetchJobHoursRowsWithIssues()).poolHours;
  const newHoursAdded = await quotedHoursEnteringMonth(month);

  const priorPools = await prisma.categoryPool.findMany({ where: { month: previousMonth(month) } });
  const priorByCategory = new Map(priorPools.map((p) => [p.category as PoolCategory, p]));

  let noPunchData = true;
  let poolsUpserted = 0;

  for (const category of POOL_CATEGORIES) {
    const prior = priorByCategory.get(category);
    // The ledger chain: this month opens on last month's remaining balance.
    // With no prior row at all (the very first month) there is no balance to
    // carry and the pool starts from what was added this month.
    const previousMonthPulledHours = prior ? Number(prior.newEtcHours) : 0;
    const newHoursAddedThisMonth = newHoursAdded[category];
    const hoursWorkedThisMonth = round2(poolHours.get(`${month}::${category}`) ?? 0);
    if (hoursWorkedThisMonth > 0) noPunchData = false;
    const hoursAvailable = round2(previousMonthPulledHours + newHoursAddedThisMonth);

    const existing = await prisma.categoryPool.findUnique({
      where: { category_month: { category, month } },
      select: { hoursPulledThisMonth: true, rate: true },
    });
    // Sheet margin notes: PM "Defaults to 450", the rest "Defaults to Hours
    // Worked This Month". Rate carries forward from the prior month.
    const defaultPulled = category === "ENGINEERING_PM" ? 450 : hoursWorkedThisMonth;
    const hoursPulledThisMonth = existing ? Number(existing.hoursPulledThisMonth) : defaultPulled;
    const rate = existing
      ? Number(existing.rate)
      : prior
        ? Number(prior.rate)
        : category.startsWith("ENGINEERING")
          ? 170
          : 140;

    const newEtcHours = round2(hoursAvailable - hoursPulledThisMonth);
    const standardFee = round2(newEtcHours * rate);

    await prisma.categoryPool.upsert({
      where: { category_month: { category, month } },
      update: {
        previousMonthPulledHours,
        newHoursAddedThisMonth,
        hoursAvailable,
        hoursWorkedThisMonth,
        newEtcHours,
        standardFee,
        source: "local",
      },
      create: {
        category,
        month,
        previousMonthPulledHours,
        newHoursAddedThisMonth,
        hoursAvailable,
        hoursWorkedThisMonth,
        hoursPulledThisMonth,
        newEtcHours,
        rate,
        standardFee,
        source: "local",
      },
    });
    poolsUpserted++;
  }

  return { poolsUpserted, month, noPunchData };
}
