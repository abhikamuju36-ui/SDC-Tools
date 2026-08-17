import { prisma } from "@/lib/prisma";
import { VALID_JOB_TYPES, etcActiveJobFilter } from "@/lib/job-filters";
import { runDax } from "@/lib/powerbi-client";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION, SERVICE_AND_SPARE_PARTS_CODES } from "@/lib/sections";
import { calcHoursLeft, round2, isMonthLocked, latestPriorEtcByKey, priorEtcForMonth, redrivenDraft, monthWindowUtc } from "@/lib/etc";
import { getPartsCostBookedByJob } from "@/lib/sync-totaleto";
import { resolveEtcPeriodName } from "@/lib/etc-period";
import {
  fetchJobHoursRows,
  fetchJobHoursRowsWithIssues,
  hoursByJobSection,
  latestWorkDate,
  type HoursImportIssue,
  type JobHoursRow,
  type PoolHoursByMonth,
} from "@/lib/job-hours-source";

// One read of the hours feed, shared by the two syncs that use it. Exported so a
// caller running both (auto-sync's pass, the ETC Refresh Data button) can fetch
// once and hand the same object to each.
export type HoursExport = { rows: JobHoursRow[]; issues: HoursImportIssue[]; poolHours: PoolHoursByMonth };

// Actual hours worked per job per month, upserted into JobMonthlyActualHours
// (the job-level rollup the dashboard / job detail use), summed across every
// tracked section.
//
// Sourced from Power BI's `Hours Actual` since 2026-08-03 (job-hours-source.ts);
// before that it was the OneDrive-synced Paylocity workbook, and before that Power
// BI again. The two were proven identical on 1,127 of 1,127 job/section/month
// cells before the switch.
//
// Covers EVERY job the hours were booked to, Complete and Active alike — the job
// lookup below filters on nothing but the job ids present in the feed.
//
// `prefetched` lets a caller that also runs syncHoursWorked hand both functions
// the SAME read. That read is now ~18 DAX round-trips (one per month), so sharing
// it matters more than it did when it was one workbook parse. Omit it and this
// fetches its own copy, so no caller is obliged to care.
export async function syncActualHours(prefetched?: HoursExport): Promise<{
  rowsUpserted: number;
  jobsNotFound: number;
  rowsSkippedOverridden: number;
  detailRowsWritten: number;
}> {
  const { rows } = prefetched ?? (await fetchJobHoursRowsWithIssues());
  // Undefined hours are NOT recorded here any more (2026-08-05, §42.14 stage 10).
  // They moved to their own refresh step — lib/paylocity-import.ts recordUndefinedHours
  // — for two reasons: it writes the punch-level rows as well as the totals, in one
  // transaction, which is what makes the KPI and its drill-through reconcile by
  // construction; and it is a stage a manager watching a refresh should see named
  // ("Calculating Undefined Hours…") rather than buried inside "Actual hours".
  // Sum every tracked section to a per-job, per-month total — except Service/Spare
  // Parts (2026-08-17). Those two were just added to HOURS_IMPORT_CODES so the Hours
  // tab can see them, but they have no SECTIONS row at all, unlike PM/Warranty/
  // Manufacturing — so letting them into this sum would grow JobMonthlyActualHours
  // (Job detail's "Actual Hours by Month") while the Job Hour Details dashboard and
  // Projects grid, which only ever iterate the 17 SECTIONS codes, stayed blind to
  // why. Excluding them here keeps every one of those pages byte-identical to
  // today; JobHoursDetail (below) still gets every row, unfiltered.
  const byJobMonth = new Map<string, number>(); // `${jobId}::${YYYY-MM}` -> hours
  for (const r of rows) {
    if (SERVICE_AND_SPARE_PARTS_CODES.has(r.section)) continue;
    const monthStr = `${r.year}-${String(r.month).padStart(2, "0")}`;
    const key = `${r.jobId}::${monthStr}`;
    byJobMonth.set(key, (byJobMonth.get(key) ?? 0) + r.hours);
  }

  let rowsUpserted = 0;
  let jobsNotFound = 0;
  let rowsSkippedOverridden = 0;

  // Prefetch the whole working set in two queries instead of two per key: this
  // loop spans EVERY job × EVERY month the feed holds (18 months of
  // history), so the old per-key job.findUnique + overridden findUnique meant
  // thousands of serial round-trips per Refresh — multi-minute, timeout-prone.
  const jobIdStrs = [...new Set([...byJobMonth.keys()].map((k) => k.split("::")[0]))];
  const jobRows = await prisma.job.findMany({ where: { jobId: { in: jobIdStrs } }, select: { id: true, jobId: true } });
  const jobByJobId = new Map(jobRows.map((j) => [j.jobId, j]));
  // Mirrors the legacy "Actual Hours Override" tab: a manually corrected month
  // must not be silently clobbered by the next sync.
  const overriddenRows = await prisma.jobMonthlyActualHours.findMany({
    where: { jobId: { in: jobRows.map((j) => j.id) }, overridden: true },
    select: { jobId: true, month: true },
  });
  const overriddenSet = new Set(overriddenRows.map((o) => `${o.jobId}::${o.month}`));

  for (const [key, hours] of byJobMonth) {
    const [jobId, monthStr] = key.split("::");
    const job = jobByJobId.get(jobId);
    if (!job) {
      jobsNotFound++;
      continue;
    }
    if (overriddenSet.has(`${job.id}::${monthStr}`)) {
      rowsSkippedOverridden++;
      continue;
    }

    await prisma.jobMonthlyActualHours.upsert({
      where: { jobId_month: { jobId: job.id, month: monthStr } },
      update: { actualHours: hours, syncedAt: new Date() },
      create: { jobId: job.id, month: monthStr, actualHours: hours, source: "power_bi" },
    });
    rowsUpserted++;
  }

  const detailRowsWritten = await syncJobHoursDetail(rows, jobByJobId);

  await syncHoursRefreshedThrough(rows);

  return { rowsUpserted, jobsNotFound, rowsSkippedOverridden, detailRowsWritten };
}

// Punch-level rows behind those rollups — one per employee/day/job/section —
// feeding the in-app Hours Detail drill (the Power BI drillthrough page's
// equivalent). Same `rows` the rollups were summed from, so the drill can never
// disagree with the total you clicked to open it.
//
// Replace-by-(job, month) rather than upsert-per-row: at ~13k rows an upsert
// apiece is thousands of round-trips, and a month present in the feed is wholly
// described by it, so deleting and re-inserting that month is both faster and
// self-healing (a punch deleted upstream disappears here too, which an
// upsert-only pass would leave behind forever).
//
// Months absent from the feed are left untouched. That mattered more when the
// source was a rolling-window file reaching back only to 2026-01; the Power BI
// feed returns its whole span (2025-02 onward), so in practice every month is
// rewritten each pass. The rule stays because "absent" must never mean "delete" —
// a failed or partial read would otherwise erase history.
export async function syncJobHoursDetail(
  rows: JobHoursRow[],
  jobByJobId: Map<string, { id: number; jobId: string }>,
  // Exported (and given this param) for scripts/backfill-hours-2025.ts, which writes the
  // exact same replace-by-(job, month) shape from a different source file and needs the
  // provenance to say so rather than claim "power_bi" for rows that came from a workbook.
  // Every existing caller is unaffected — the default is unchanged.
  source = "power_bi",
): Promise<number> {
  // job pk + month -> the rows for it
  const byJobMonth = new Map<string, { jobPk: number; month: string; rows: JobHoursRow[] }>();
  for (const r of rows) {
    const job = jobByJobId.get(r.jobId);
    if (!job) continue; // counted as jobsNotFound by the caller already
    const month = `${r.year}-${String(r.month).padStart(2, "0")}`;
    const key = `${job.id}::${month}`;
    const bucket = byJobMonth.get(key);
    if (bucket) bucket.rows.push(r);
    else byJobMonth.set(key, { jobPk: job.id, month, rows: [r] });
  }

  let written = 0;
  for (const { jobPk, month, rows: monthRows } of byJobMonth.values()) {
    // Collapse to the unique key before writing: the export is already one row
    // per employee/day/job/section, but the 10-311 → 312/313 split can emit two
    // rows for the same key if a person books that function twice in a day.
    const merged = new Map<string, { section: string; workDate: Date; employeeId: string; hours: number }>();
    for (const r of monthRows) {
      const day = new Date(Date.UTC(r.date.getUTCFullYear(), r.date.getUTCMonth(), r.date.getUTCDate()));
      const k = `${r.section}::${day.toISOString().slice(0, 10)}::${r.employeeId}`;
      const cur = merged.get(k);
      if (cur) cur.hours += r.hours;
      else merged.set(k, { section: r.section, workDate: day, employeeId: r.employeeId, hours: r.hours });
    }

    await prisma.$transaction([
      prisma.jobHoursDetail.deleteMany({ where: { jobId: jobPk, month } }),
      prisma.jobHoursDetail.createMany({
        data: [...merged.values()].map((m) => ({
          jobId: jobPk,
          section: m.section,
          month,
          workDate: m.workDate,
          employeeId: m.employeeId,
          hours: round2(m.hours),
          source,
        })),
      }),
    ]);
    written += merged.size;
  }
  return written;
}

// Actual hours worked per job PER SECTION for `month`, overwriting
// EtcEntry.hoursWorked directly — the per-department grain the ETC grid
// needs. Always overwrites on refresh; "Hours Worked" is meant to always
// reflect the source, not be independently typed in.
//
// Source is Power BI's `Hours Actual` (job-hours-source.ts). It was the
// OneDrive-synced Paylocity workbook from 2026-07-19 until 2026-08-03; the two
// were verified to agree by job/section to the hundredth (May 2026, 127/127, and
// again across all of 2026 before the switch back).
//
// When there are hours in a tracked section the job has no entry for (work
// charged to a section that was never quoted, so startMonth didn't seed it),
// the entry is CREATED rather than the hours silently dropped. Prior ETC for
// these comes from the previous month's entry if one exists, else 0.
// `prefetchedRows` — see syncActualHours: one parse shared between the two.
export async function syncHoursWorked(
  month: string,
  prefetchedRows?: JobHoursRow[],
): Promise<{ rowsUpdated: number; rowsSkipped: number; rowsZeroed: number }> {
  // Re-checked here, not just trusted from the caller's earlier check — this
  // sync does one DB round-trip per row, so it can run long enough for a
  // manager to Submit and Lock this exact month mid-sync. A locked month is
  // frozen history (same rule as the submission path / syncPowerBiForEtc)
  // and must never be rewritten by a background refresh.
  const monthEntriesAtStart = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  const monthStartedAtStart = monthEntriesAtStart.length > 0;
  if (monthStartedAtStart && isMonthLocked(monthEntriesAtStart)) {
    return { rowsUpdated: 0, rowsSkipped: 0, rowsZeroed: 0 };
  }

  const [year, monthNum] = month.split("-").map(Number);
  const allRows = prefetchedRows ?? (await fetchJobHoursRows());
  const spentByKey = hoursByJobSection(allRows, year, monthNum);

  // Resolve every job once, up front (one query), instead of the same
  // job.findUnique repeated per section row. The per-row EtcEntry reads below
  // stay live on purpose — they guard against this exact month being locked /
  // a row being submitted mid-sync, and must not be served from a stale snapshot.
  const jobIdStrs = [...new Set([...spentByKey.keys()].map((k) => k.split("::")[0]))];
  const jobRows = await prisma.job.findMany({
    where: { jobId: { in: jobIdStrs } },
    select: { id: true, jobId: true, status: true, completeDate: true, type: true },
  });
  const jobByJobId = new Map(jobRows.map((j) => [j.jobId, j]));

  let rowsUpdated = 0;
  let rowsSkipped = 0;

  for (const [key, hours] of spentByKey) {
    const [jobId, section] = key.split("::");
    if (!ETC_TRACKED_CODES.has(section)) continue; // ignore codes the ETC grid doesn't track

    const job = jobByJobId.get(jobId);
    if (!job) {
      rowsSkipped++;
      continue;
    }

    const entry = await prisma.etcEntry.findUnique({
      where: { jobId_section_month: { jobId: job.id, section, month } },
    });

    if (!entry) {
      // Unquoted-section hours: create the entry so the work is visible, but
      // only for jobs the grid actually shows, only once the month has been
      // started, and only when there are real hours to show. Also refuses to
      // add a fresh needsReview row into a month that's already fully locked
      // — that would silently "unlock" it (isMonthLocked requires every
      // entry to be reviewed) behind the manager's back.
      const qualifies =
        job.status === "Active" && job.completeDate === null && VALID_JOB_TYPES.includes(job.type as (typeof VALID_JOB_TYPES)[number]);
      if (!monthStartedAtStart || !qualifies || hours === 0) {
        rowsSkipped++;
        continue;
      }

      // Re-checked per-row, right before creating: monthStartedAtStart is a
      // top-of-function snapshot, and this loop can run long enough for the
      // month to have been fully locked since — a fresh needsReview:true row
      // would silently "unlock" it the moment it lands.
      const monthEntriesNow = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
      if (isMonthLocked(monthEntriesNow)) {
        rowsSkipped++;
        continue;
      }

      const priorEntry = await prisma.etcEntry.findUnique({
        where: { jobId_section_month: { jobId: job.id, section, month: previousMonth(month) } },
        select: { newEtc: true },
      });
      const priorEtc = priorEntry ? Number(priorEntry.newEtc) : 0;

      await prisma.etcEntry.create({
        data: {
          jobId: job.id,
          section,
          month,
          priorEtc,
          hoursWorked: hours,
          hoursLeftCalc: round2(calcHoursLeft(priorEtc, hours)),
          newEtc: priorEtc,
          needsReview: true,
        },
      });
      rowsUpdated++;
      continue;
    }

    // Re-checked per-row: this specific entry could have been submitted
    // (needsReview -> false) since the loop started, even if the month as a
    // whole wasn't locked yet at the top-of-function check.
    if (!entry.needsReview) {
      rowsSkipped++;
      continue;
    }

    const priorEtc = Number(entry.priorEtc);
    // newEtc is deliberately NOT written here — it's manager-entered
    // (submitMonth falls back to the suggestion only at submission time).
    // Hours Left is always the plain Prior ETC − Hours Worked difference.
    await prisma.etcEntry.update({
      where: { id: entry.id },
      data: {
        hoursWorked: hours,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, hours)),
      },
    });
    rowsUpdated++;
  }

  // Rows the export no longer accounts for.
  //
  // The loop above only visits keys PRESENT in the export, so a (job, section)
  // whose hours moved away upstream — a booking reassigned to another job, or
  // deleted — is never revisited and keeps its last synced value forever.
  // Measured live 2026-07-31: job 1104 held 8.00h and job 1145 1.68h that the
  // export had already dropped. Small individually, but the error is
  // one-directional (it can only inflate) and compounds every month.
  //
  // "Hours Worked always reflects the source, it is never independently typed
  // in" is the rule this restores. The main loop only ever enforced it in the
  // direction of hours appearing, never hours going away.
  //
  // GUARDED on the export actually covering this month. `spentByKey` is empty
  // when the rolling window has moved past `month`, or when the fetch returned
  // nothing usable — and zeroing every row on that basis would wipe the month's
  // hours wholesale. Absence of the month from the export is not evidence that
  // nobody worked; it is evidence the export cannot answer the question.
  let rowsZeroed = 0;
  if (spentByKey.size > 0) {
    const candidates = await prisma.etcEntry.findMany({
      where: {
        month,
        needsReview: true, // never touch a submitted row, same rule as above
        hoursWorked: { not: 0 },
      },
      select: { id: true, section: true, priorEtc: true, job: { select: { jobId: true } } },
    });

    for (const entry of candidates) {
      // Parts Cost is dollars from TotalETO and owned by syncPartsCost; the
      // hours export knows nothing about it and must never zero it.
      if (entry.section === PARTS_COST_SECTION) continue;
      if (!ETC_TRACKED_CODES.has(entry.section)) continue;
      if (spentByKey.has(`${entry.job.jobId}::${entry.section}`)) continue; // still in the export

      const priorEtc = Number(entry.priorEtc);
      await prisma.etcEntry.update({
        where: { id: entry.id },
        // newEtc deliberately untouched, exactly as in the update above — it is
        // manager-entered, and a source correction must not silently rewrite it.
        data: { hoursWorked: 0, hoursLeftCalc: round2(calcHoursLeft(priorEtc, 0)) },
      });
      rowsZeroed++;
    }
  }

  // Its own freshness record, separate from "hours_actual".
  //
  // Those two syncs read the same file but write different things, and they
  // fail independently: syncActualHours can succeed (stamping hours_actual as
  // healthy) while this one throws, leaving the ETC grid stale behind a header
  // that says everything is fine. That gap is precisely how the numbers aged
  // unnoticed, so the grid's own hours get their own record.
  //
  // Deliberately NOT recorded on the locked-month early return above: doing
  // nothing because a month is frozen is correct behaviour, not a fresh sync,
  // and stamping it would report currency this function never established.
  await recordSyncSuccess("etc_hours_worked", latestWorkDate(allRows));

  return { rowsUpdated, rowsSkipped, rowsZeroed };
}

// "Parts Cost" — a real block in the sheet (Prior ETC / Money Spent Month /
// Money Left / New ETC / Diff, in dollars, no Engineering/Shop split).
// Modeled as an EtcEntry row with section = PARTS_COST_SECTION rather than a
// new table, since the shape matches the hours departments exactly.
//
// Money Spent Month comes DIRECTLY from TotalETO now (getPartsCostBookedByJob,
// the AP-document basis — see §41 below), not Power BI, and it removes the
// last PBI/gateway dependency for the live month. Prior ETC is the app's own prior-
// month confirmed New ETC (the authoritative running balance now that the
// monthly review lives in the app); no prior entry -> opens at 0.
// Creates the row if it doesn't exist yet (unlike the hours sync, which only
// updates existing rows) since Parts Cost has no EstimatedHours-seeded
// counterpart from startMonth().
export async function syncPartsCost(month: string): Promise<{ rowsUpserted: number }> {
  // Same re-check as syncHoursWorkedFromPowerBi: a locked month must never be
  // rewritten, even if it got locked after the caller's own check but before
  // (or during) this function's run.
  const monthEntriesAtStart = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (monthEntriesAtStart.length > 0 && isMonthLocked(monthEntriesAtStart)) {
    return { rowsUpserted: 0 };
  }

  // One definition of "which dates are this month", shared and tested — see
  // monthWindowUtc. Half-open [start, endExclusive), UTC.
  const { start: monthStart, endExclusive: monthEndExclusive } = monthWindowUtc(month);
  // §41: the AP-document basis, reconciled to the Total ETO report — see
  // getPartsCostBookedByJob for the date, the amount, the sign rule and the measured
  // reasons Extra Costs stay out. This SUPERSEDES §30's purchased-date basis
  // (getPartsCostPurchasedByJob), which was internally consistent but $30,117 away from
  // the business's own report for July 2026, and off by multiples on individual jobs.
  //
  // getPartsCostSpentByJob is still used, but only by Profitability's "Parts
  // Purchased" column (src/lib/job-cost-source.ts), which is a lifetime
  // committed-spend measure and a different question. (Corrected 2026-08-15,
  // audit finding: this comment previously said "the Projects grid's
  // cumulative Parts Cost Actual column" — stale since 2026-08-10, when
  // syncPartsCostActual switched that column to getPartsActualByJob instead.)
  const booked = await getPartsCostBookedByJob(monthStart, monthEndExclusive);
  const spentByJobId = booked.net;
  // An AP line with no ProjectID belongs to nobody and would silently vanish. Surfaced in
  // the sync log rather than reassigned (§41.6); it was 0 lines for July 2026.
  if (booked.unmatchedLines > 0) {
    console.warn(
      `[parts-cost] ${month}: ${booked.unmatchedLines} AP line(s) totalling ` +
        `${booked.unmatchedAmount.toFixed(2)} carry no ProjectID and are in NO job's Money Spent.`,
    );
  }

  // costQuoted comes along now: it is the Parts Cost Quoted column on the
  // Projects tab, and it is what a job's FIRST parts month opens at.
  const jobs = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true, jobId: true, costQuoted: true, startDate: true } });

  // Prior ETC = the app's own prior-month confirmed Parts New ETC (same chain
  // rule as hours and pools). NO prior entry -> the job's Parts Cost Quoted from
  // the Projects tab, which is the parts equivalent of what seeding already does
  // for hours (quoted hours when there is no ETC history — see seedMonth).
  //
  // It used to open at 0, on the reasoning that "a brand-new job's Parts New ETC
  // is manager-entered anyway". That was wrong twice over (found 2026-08-03):
  // Parts Cost Quoted IS the manager's entry, typed on the Projects tab; and
  // because the loop below skips any job with no balance and no spend, a job
  // starting this month got NO PARTS ROW AT ALL — nothing to plan, nothing to
  // review. Measured on July: 1164 ($1,336,100 quoted), 1165 ($50,000) and 1166
  // ($101,220) all had a quote on Projects and no parts row here.
  // EVERY earlier month, not just previousMonth (fixed 2026-08-04) — the same
  // correction latestPriorEtcByKey already made for hours, still outstanding
  // here. A job with no parts row in the immediately preceding month fell
  // through to `costQuoted` and REOPENED AT ITS FULL ORIGINAL QUOTE, wiping out
  // however far its parts balance had actually been worked down.
  //
  // Measured on July 2026: job 1105 had spent its parts budget down to a
  // confirmed 0 by May and had no June row, so July opened it at $636,234 —
  // a phantom balance larger than any real figure on the page. Job 979 was the
  // same at $8,600 (April confirmed 0). The `.has` check below reads as "a job
  // that confirmed 0 has finished buying and must not be reopened at its
  // quote", which was exactly right and exactly one month too short-sighted.
  const priorMonthParts = await prisma.etcEntry.findMany({
    where: { month: { lt: month }, section: PARTS_COST_SECTION },
    select: { jobId: true, section: true, month: true, newEtc: true },
  });
  const latestPartsByKey = latestPriorEtcByKey(priorMonthParts);

  let rowsUpserted = 0;

  // One PARTS_COST row per active job that has either an opening balance or
  // money spent this month — skip the all-zero jobs (nothing to show), same
  // spirit as the history backfill's skip rule.
  for (const job of jobs) {
    // A job whose Start Date falls IN this month opens at its quote, whatever the
    // chain says — the same rule seedMonth applies to hours, so both halves of a
    // job's first month agree. See the note there (jobs 1159/1160).
    const startsThisMonth =
      job.startDate != null &&
      `${job.startDate.getUTCFullYear()}-${String(job.startDate.getUTCMonth() + 1).padStart(2, "0")}` === month;
    // `undefined`, not `?? 0`: a job whose latest parts month genuinely
    // confirmed 0 has finished buying, and must NOT be reopened at its original
    // quote. Same precedence as hours — priorEtcForMonth in lib/etc.ts.
    const priorEtc = priorEtcForMonth({
      startsThisMonth,
      carried: latestPartsByKey.get(`${job.id}-${PARTS_COST_SECTION}`),
      quoted: Number(job.costQuoted ?? 0),
    });
    const moneySpent = spentByJobId.get(job.jobId) ?? 0;

    const existing = await prisma.etcEntry.findUnique({
      where: { jobId_section_month: { jobId: job.id, section: PARTS_COST_SECTION, month } },
      select: { needsReview: true, priorEtc: true, newEtcDraft: true },
    });

    if (existing) {
      // Re-checked per-row, same reason as syncHoursWorkedFromPowerBi: this
      // entry could have been submitted since the loop started.
      if (!existing.needsReview) continue;
    } else {
      if (priorEtc === 0 && moneySpent === 0) continue; // nothing worth a row yet
      // A brand-new needsReview:true row would silently "unlock" an otherwise
      // fully-locked month — refuse if the month is locked right now.
      const monthEntriesNow = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
      if (isMonthLocked(monthEntriesNow)) continue;
    }

    await prisma.etcEntry.upsert({
      where: { jobId_section_month: { jobId: job.id, section: PARTS_COST_SECTION, month } },
      // newEtc deliberately not written — same manager-entered rule as hours.
      update: {
        priorEtc,
        hoursWorked: moneySpent,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, moneySpent)),
        // A draft that merely echoed the suggestion from the OLD Prior ETC moves
        // with it (see redrivenDraft). This is where the stale zeros came from:
        // July's parts cells were saved while their Prior was still 0, and the
        // 0 outlived the figure it was derived from.
        //
        // Only written when this run actually read the row. If `existing` is null
        // the update branch can still fire — a concurrent writer created the row
        // between the read and here — and touching a draft this run never saw
        // would be guessing.
        ...(existing
          ? {
              newEtcDraft: redrivenDraft({
                draft: existing.newEtcDraft != null ? Number(existing.newEtcDraft) : null,
                oldPriorEtc: Number(existing.priorEtc),
                newPriorEtc: priorEtc,
                hoursWorked: moneySpent,
              }),
            }
          : {}),
      },
      create: {
        jobId: job.id,
        section: PARTS_COST_SECTION,
        month,
        priorEtc,
        hoursWorked: moneySpent,
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, moneySpent)),
        newEtc: priorEtc,
        needsReview: true,
      },
    });
    rowsUpserted++;
  }

  return { rowsUpserted };
}

interface CategoryPoolRow {
  "Standard Fees[Billing Group]": string;
  "Standard Fees[Department]": string;
  PrevPulled: number | null;
  HoursQuoted: number | null;
  HoursActual: number | null;
}

const POOL_CATEGORY: Record<string, "ENGINEERING_PM" | "ENGINEERING_WARRANTY" | "SHOP_MANUFACTURING" | "SHOP_WARRANTY"> = {
  "Engineering|PM": "ENGINEERING_PM",
  "Engineering|Warranty": "ENGINEERING_WARRANTY",
  "Shop|Manufacturing": "SHOP_MANUFACTURING",
  "Shop|Warranty": "SHOP_WARRANTY",
};

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// NOTE: this function is no longer on any automatic path. The 6-hour pass and
// the panel's Refresh button both compute the pools from app data now — see
// standard-pool-local.ts. It is kept for comparison against upstream and for
// any future backfill, and it is the reason etc-period.ts exists.
//
// Refreshes the company-wide "Standard Fees By Department" category pools,
// scoped to the requested month's ETC period. Which period THAT is now comes
// from etc-period.ts, resolved by [ETC Begin Date].
//
// The rule here used to be "filter by [ETC Name], NEVER [ETC Begin Date]",
// on the basis of a 2026-07-16 audit. Upstream has moved since: measured
// against the punch export on 2026-07-31, each period's figures line up with
// its Begin Date month, and name-as-month was wrong in all 24 department-months
// tested. Resolving by Begin Date is also stable if the labelling moves again.
//
// Excel-free data flow (the workbook's Export-tab write-back loop is retired):
// - "Previous Month Pulled Hours" (misleading name) = OUR OWN prior month's
//   NEW ETC HOURS — the remaining pool balance, not the pulled amount.
//   Verified against the real 'Standard Fees' archive 2026-07-17: across all
//   28 archived month-pairs, 22 match prior-month New ETC exactly and ZERO
//   match prior-month Hours Pulled (the 6 outliers are small manual Excel
//   tweaks). Power BI's own column is used only as a fallback when no local
//   prior-month row exists (e.g. the very first month).
// - New Hours Added (sold-job quotes) and Hours Worked (Paylocity) still come
//   from Power BI — genuinely external data.
// - "Hours being pulled this month" and "Rate" are manual decisions. Existing
//   values are preserved on refresh; a NEW month row gets the sheet's own
//   documented defaults: PM pulls 450, the others pull Hours Worked This
//   Month, and Rate carries forward from the prior month (170/140 failing that).
// Derived fields mirror the sheet: Available = Prev + Added,
// New ETC = Available - Pulled, Standard Fee = New ETC x Rate.
// `periodFound` is false when Power BI has no ETC period for this month at all,
// which is NOT the same as "nothing changed" and must not be reported as a
// successful refresh. Verified 2026-07-31: upstream's latest published period is
// May 2026, so a July refresh matched zero rows, wrote nothing, and returned
// without complaint — which is exactly why the panel kept telling people to
// click a Refresh button that could not possibly help.
export async function syncCategoryPoolsFromPowerBi(
  month: string,
): Promise<{ poolsUpserted: number; periodFound: boolean }> {
  // Resolved from the period's Begin Date, not its name — see etc-period.ts.
  // Filtering on monthToEtcName(month) now selects the period BEFORE the one
  // wanted, so this pulled the wrong month's drivers.
  const etcName = await resolveEtcPeriodName(month);
  if (!etcName) return { poolsUpserted: 0, periodFound: false };
  const dax = `
    EVALUATE
    SUMMARIZECOLUMNS(
      'Standard Fees'[Billing Group],
      'Standard Fees'[Department],
      FILTER(ALL('Estimated to Complete Period'), 'Estimated to Complete Period'[ETC Name] = "${etcName}"),
      "PrevPulled", [Standard Fees - Monthly Process - Previous Month Pulled Hours],
      "HoursQuoted", [Standard Fees - Monthly Process - Hours Quoted by ETC Period],
      "HoursActual", [Standard Fees - Monthly Process - Hours Actual by ETC Period]
    )
  `;
  const rows = (await runDax(dax)) as CategoryPoolRow[];
  // No period upstream -> nothing to map. Returning early keeps the "wrote
  // nothing" case distinguishable from "wrote nothing because nothing moved".
  if (rows.length === 0) return { poolsUpserted: 0, periodFound: false };

  const priorPools = await prisma.categoryPool.findMany({ where: { month: previousMonth(month) } });
  const priorByCategory = new Map(priorPools.map((p) => [p.category, p]));

  let poolsUpserted = 0;

  for (const row of rows) {
    const category = POOL_CATEGORY[`${row["Standard Fees[Billing Group]"]}|${row["Standard Fees[Department]"]}`];
    if (!category) continue;

    const prior = priorByCategory.get(category);
    // The ledger chain carries the REMAINING POOL BALANCE forward: this
    // month's starting hours = prior month's New ETC Hours (see the archive
    // verification note above — NOT prior month's pulled hours, despite the
    // column's name). PBI's echo is only a first-month fallback.
    const previousMonthPulledHours = prior ? Number(prior.newEtcHours) : row.PrevPulled ?? 0;
    const newHoursAddedThisMonth = row.HoursQuoted ?? 0;
    const hoursWorkedThisMonth = row.HoursActual ?? 0;
    const hoursAvailable = round2(previousMonthPulledHours + newHoursAddedThisMonth);

    const existing = await prisma.categoryPool.findUnique({
      where: { category_month: { category, month } },
      select: { hoursPulledThisMonth: true, rate: true },
    });
    // Sheet margin notes: PM "Defaults to 450", the rest "Defaults to Hours
    // Worked This Month". Rate carries forward from the prior month.
    const defaultPulled = category === "ENGINEERING_PM" ? 450 : round2(hoursWorkedThisMonth);
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
        source: "power_bi",
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
        source: "power_bi",
      },
    });
    poolsUpserted++;
  }

  return { poolsUpserted, periodFound: true };
}

// How current the underlying Paylocity feed itself is (distinct from when the app last
// asked) — the freshness figure managers see, rendered on the Monthly ETC header as
// "Hours through <date>". The latest Work Date in Lisa's workbook (the direct
// equivalent of the old [Hours Refreshed Thru] measure). Takes the already-fetched rows
// so it doesn't re-read the file.
//
// This is the figure that explains the §43 report: the app reads the file, the Power BI
// report reads a semantic model that refreshes separately, so the two are routinely at
// different vintages and the app is usually ahead. Measured 2026-08-05 — file through
// 08-04, model through 07-31, worth 138.83h of July Engineering alone.
async function syncHoursRefreshedThrough(rows: JobHoursRow[]): Promise<void> {
  const refreshedThrough = latestWorkDate(rows);
  if (!refreshedThrough) return;

  await prisma.powerBiFreshness.upsert({
    where: { source: "hours_actual" },
    // status: null clears any previously recorded failure — this pull just
    // proved the feed is healthy again.
    update: { refreshedThrough: new Date(refreshedThrough), checkedAt: new Date(), status: null },
    create: { source: "hours_actual", refreshedThrough: new Date(refreshedThrough) },
  });
}

// Marks a sync source healthy. `status: null` clears any recorded failure —
// this run just proved the path works again.
//
// Exported for auto-sync.ts, which stamps the sources whose own sync function
// has no natural "refreshed through" date of its own (parts, TotalETO jobs, the
// Scheduler roster) and passes the moment of the successful read. The hours
// sources deliberately stamp themselves instead: their refreshedThrough is the
// latest WORK DATE in the export, which says how current the data is rather than
// when we last asked — re-stamping those with `now` would throw that away.
export async function recordSyncSuccess(source: string, refreshedThrough: Date | null): Promise<void> {
  if (!refreshedThrough) return; // refreshedThrough is required; nothing to claim
  try {
    await prisma.powerBiFreshness.upsert({
      where: { source },
      update: { refreshedThrough, checkedAt: new Date(), status: null },
      create: { source, refreshedThrough },
    });
  } catch (err) {
    console.error(`[sync] could not record ${source} freshness: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// recordImportIssues() lived here until 2026-08-05. It wrote HoursImportIssue — the
// per-month/label TOTALS the KPI card reads — and nothing else, which is precisely why
// the drill-through had to recompute the punch rows from the source and could disagree
// with the card.
//
// Its replacement is recordUndefinedHours() in lib/paylocity-import.ts, which writes
// the totals AND the punch rows from one pass in one transaction. See §42.9-42.12 and
// the header of lib/unattributed-hours.ts.

// Records that an hours sync FAILED, so the staleness is visible in the app
// instead of only in a console log nobody reads. Without this, a broken feed
// leaves the last good "Hours Refreshed Thru" date sitting in the ETC header
// looking authoritative while the numbers behind it quietly age (exactly what
// happened 2026-07-24..29 — see job-hours-source.ts).
//
// Deliberately update-only, never create: refreshedThrough is required and a
// failed pull has no date to put there. If the row doesn't exist yet the feed
// has simply never succeeded, and there's no stale figure to warn about.
// Best-effort — a logging failure must never mask the original sync error.
// Records that a source is BLOCKED on something upstream rather than broken.
// The distinction is the point: a red "failed" for data the source has simply
// not published yet trains people to ignore red, while a green "ok" for a step
// that wrote nothing is the silent staleness this whole file exists to prevent.
// Readers key off the "Failed:" prefix, so this deliberately does not use it.
export async function recordSyncNote(source: string, note: string): Promise<void> {
  try {
    await prisma.powerBiFreshness.updateMany({
      where: { source },
      data: { status: `Waiting: ${note.slice(0, 300)}`, checkedAt: new Date() },
    });
  } catch (err) {
    console.error(`[sync] could not record ${source} note: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function recordSyncFailure(err: unknown, source = "hours_actual"): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await prisma.powerBiFreshness.updateMany({
      where: { source },
      data: { status: `Failed: ${message.slice(0, 300)}`, checkedAt: new Date() },
    });
  } catch (writeErr) {
    // Best-effort, so still non-fatal — but NOT silent. A bare `catch {}` here
    // hid a real bug for weeks: `status` was varchar(191) while this writes up
    // to 308 chars, so every failure threw "value too long for the column's
    // type" and vanished. The header kept showing a confident last-good date
    // while the numbers aged, which is the exact outcome this function exists
    // to prevent. Widened to @db.Text 2026-07-31; the log stays so that if this
    // path ever breaks again it says so instead of pretending to work.
    console.error(
      `[sync] could not record the hours-sync failure (the failure itself is reported separately): ${
        writeErr instanceof Error ? writeErr.message : String(writeErr)
      }`
    );
  }
}

interface HoursEstimatedRow {
  "Hours Estimated[Job Id]": string;
  "Hours Estimated[Section-Function Code]": string;
  "Hours Estimated[Hours Quoted]": number | null;
  "Hours Estimated[Hours Estimated to Complete]": number | null;
}

interface CostEstimatedRow {
  "Cost Estimated[Job Id]": string;
  "Cost Estimated[Cost Quoted]": number | null;
}

// Pulls Quoted hours by section + Estimate-to-Complete hours from the live
// 'Hours Estimated' table, and Cost Quoted from 'Cost Estimated' — confirmed
// matching the spreadsheet's frozen "Estimated Hours" tab migration exactly
// (e.g. Job 788 Cost Quoted = 538,610 in both). Cost Actual Historical has no
// equivalent single measure in this model, so it is intentionally left as the
// frozen migration value rather than guessed at.
//
// Only updates jobs that already exist with a valid Type — never creates new
// jobs (same policy as the TotalETO sync), since this data alone can't
// classify a job's Type.
export async function syncQuotedFromPowerBi(): Promise<{
  sectionsUpdated: number;
  jobsUpdated: number;
  jobsNotFound: number;
}> {
  const [hoursRows, costRows] = await Promise.all([
    runDax(`EVALUATE 'Hours Estimated'`) as Promise<HoursEstimatedRow[]>,
    runDax(`EVALUATE 'Cost Estimated'`) as Promise<CostEstimatedRow[]>,
  ]);

  const validJobs = await prisma.job.findMany({
    where: { type: { in: [...VALID_JOB_TYPES] } },
    select: { id: true, jobId: true, costQuoted: true },
  });
  const jobByJobId = new Map(validJobs.map((j) => [j.jobId, j]));

  // Rows a manager has hand-edited on the Projects tab must not have that
  // edit silently overwritten by this sync — quotedHours is skipped for
  // those; estimateToCompleteHours still refreshes either way.
  const manuallyEditedKeys = new Set(
    (await prisma.estimatedHours.findMany({ where: { quotedHoursManuallyEdited: true }, select: { jobId: true, section: true } })).map(
      (e) => `${e.jobId}::${e.section}`
    )
  );

  let sectionsUpdated = 0;
  let jobsNotFoundCount = 0;
  const notFoundJobIds = new Set<string>();

  for (const row of hoursRows) {
    const rawJobId = row["Hours Estimated[Job Id]"];
    const section = row["Hours Estimated[Section-Function Code]"];
    const quotedHours = row["Hours Estimated[Hours Quoted]"];
    const estimateToCompleteHours = row["Hours Estimated[Hours Estimated to Complete]"];
    if (rawJobId == null || section == null) continue;

    const jobId = String(Number(rawJobId));
    const job = jobByJobId.get(jobId);
    if (!job) {
      notFoundJobIds.add(jobId);
      continue;
    }
    if ((quotedHours ?? 0) === 0 && (estimateToCompleteHours ?? 0) === 0) continue;

    // Quoted hours are ENTERED, not synced (policy 2026-08-03: Jessica enters new
    // projects and their quoted hours). So this seeds a section row that doesn't
    // exist yet — useful for a job arriving from TotalETO — and never updates the
    // figure on one that does.
    //
    // The quotedHoursManuallyEdited flag is no longer what protects a manager's
    // number; not writing it at all is. The flag is kept because the Projects grid
    // still sets it and it records who owns a row, but this sync no longer needs
    // to consult it. Left in the query above rather than deleted so the intent is
    // visible in one place if quoted hours ever become synced again.
    void manuallyEditedKeys;
    await prisma.estimatedHours.upsert({
      where: { jobId_section: { jobId: job.id, section } },
      update: {
        // estimateToCompleteHours only — nobody types this one, and it is not one
        // of the four figures the policy assigns to a person.
        estimateToCompleteHours: estimateToCompleteHours ?? 0,
      },
      create: {
        jobId: job.id,
        section,
        quotedHours: quotedHours ?? 0,
        actualHistoricalHours: 0,
        estimateToCompleteHours: estimateToCompleteHours ?? 0,
      },
    });
    sectionsUpdated++;
  }

  // Parts Cost Quoted (Job.costQuoted) is ENTERED, not synced — same policy
  // (2026-08-03). It used to be written from 'Cost Estimated'[Cost Quoted] here
  // unless costQuotedManuallyEdited was set; now it is seeded only where the app
  // has no figure at all, so a job arriving from TotalETO starts with the quote
  // rather than a blank, and Jessica's number is never overwritten.
  let jobsUpdated = 0;
  for (const row of costRows) {
    const rawJobId = row["Cost Estimated[Job Id]"];
    const costQuoted = row["Cost Estimated[Cost Quoted]"];
    if (rawJobId == null || costQuoted == null) continue;

    const jobId = String(Number(rawJobId));
    const job = jobByJobId.get(jobId);
    if (!job) {
      notFoundJobIds.add(jobId);
      continue;
    }

    // Seed-only. `null` means nobody has said anything about this job's parts
    // quote yet; a stored 0 is a statement and is left alone.
    if (job.costQuoted != null) continue;
    await prisma.job.update({ where: { id: job.id }, data: { costQuoted } });
    jobsUpdated++;
  }

  jobsNotFoundCount = notFoundJobIds.size;
  return { sectionsUpdated, jobsUpdated, jobsNotFound: jobsNotFoundCount };
}
