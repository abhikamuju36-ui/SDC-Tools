"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { calcHoursLeft, suggestNewEtc, isMonthLocked, round2, nextMonth, isValidMonth, isSafeForLiveEtcSync, latestPriorEtcByKey, priorEtcForMonth, redrivenDraft, isNewEtcClearable, type NewEtcCellState } from "@/lib/etc";
import { derivePriorEtcForMonth, cascadePriorEtcForward } from "@/lib/etc-prior-etc";
import { etcActiveJobFilter } from "@/lib/job-filters";
import { syncActualHours, syncHoursWorked, syncPartsCost } from "@/lib/sync-powerbi";
import { fetchJobHoursRowsWithIssues } from "@/lib/job-hours-source";
import { syncEtcHistoryFromPowerBi } from "@/lib/sync-etc-history";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION } from "@/lib/sections";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { matchesConfirmPassword } from "@/lib/confirm-password";

// Submit and Lock's confirmation gate — an "are you sure" step before
// freezing a month's numbers, not a real access boundary, so the password is
// fixed rather than env-configurable. Checked here (not client-side) so it
// can't be read out of the page JS bundle.
const SUBMIT_LOCK_PASSWORD = "sdcautomation";

function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", "cmp").update(a).digest();
  const db = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(da, db);
}

// The sheet physically had one working month; the app must not let an
// arbitrary past/future month be seeded out of order — Prior ETC carries
// forward from the previous month's New ETC, so seeding ahead of an
// unsubmitted month would bake in-flight numbers into history. Re-seeding an
// already-started month is always fine (that's what Refresh does).
async function assertMonthSeedable(month: string): Promise<void> {
  const alreadyStarted = (await prisma.etcEntry.count({ where: { month } })) > 0;
  if (alreadyStarted) return;

  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  if (!latest) return; // very first month ever — anything goes

  const latestEntries = await prisma.etcEntry.findMany({ where: { month: latest.month }, select: { needsReview: true } });
  if (!isMonthLocked(latestEntries)) {
    throw new Error(`${latest.month} is still in progress — submit and lock it before starting a new month.`);
  }
  const expected = nextMonth(latest.month);
  if (month !== expected) {
    throw new Error(`The next ETC month after ${latest.month} is ${expected} — months must be started in order.`);
  }
}

// `newEtcCreate__<jobPk>__<section>` — a New ETC typed into a cell that has no
// EtcEntry yet, because startMonth only seeds sections the job was QUOTED for.
// 357 of July's 754 cells were in that state (2026-08-03), rendering as a dead
// "—" that no manager could plan. The grid renders them as ordinary editable
// cells now; this is how the row behind one comes into existence.
//
// Shared by Save and Submit so the two cannot disagree about what a typed value
// in one of those cells means.
//
// Returns only cells with a REAL value: an empty one is the normal state of most
// of the grid, and creating a row for each would add ~350 empty entries a month,
// move no figure, and quietly widen what the month contains.
export type TypedNewCell = { jobId: number; section: string; value: number };

function parseNewEtcCreateFields(formData: FormData): TypedNewCell[] {
  const out: TypedNewCell[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("newEtcCreate__")) continue;
    const rest = key.slice("newEtcCreate__".length);
    const sep = rest.indexOf("__");
    if (sep === -1) continue;
    const jobId = Number(rest.slice(0, sep));
    const section = rest.slice(sep + 2);
    if (!Number.isInteger(jobId)) continue;
    // Only sections the grid tracks — a hand-posted field must not be able to
    // invent a row for a code the app does not model.
    if (!ETC_TRACKED_CODES.has(section)) continue;
    const trimmed = String(raw).trim();
    if (trimmed === "") continue;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) continue;
    // Zero creates nothing. A row that never existed, planned at 0, is a row
    // saying "no hours needed for a section nobody quoted" — it moves no figure
    // and only adds noise.
    //
    // It is also a hard backstop for the class of bug that took Submit down on
    // 2026-08-03: the create-cells briefly rendered a literal "0" instead of an
    // empty box, so every one of ~350 unquoted sections posted a value and Submit
    // tried to create them all in one transaction. That render bug is fixed in
    // EtcSectionCells, but nothing downstream should depend on it.
    if (value === 0) continue;
    out.push({ jobId, section, value: round2(value) });
  }
  return out;
}

// Deletes unsubmitted entries the grid can never render — either the job no
// longer qualifies (completed, deactivated, or type-invalidated since
// seeding), or the section isn't one the grid tracks (relics from before the
// section list matched the real sheet). The app-side equivalent of the
// sheet's Refresh deleting rows for jobs gone from the source. Confirmed
// history (needsReview=false) is never pruned.
async function pruneStaleEntries(month: string): Promise<number> {
  const qualifying = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true } });
  // Zero qualifying jobs means something is wrong upstream (empty Job table,
  // broken filter) — `notIn: []` would delete EVERY unsubmitted entry. Bail.
  if (qualifying.length === 0) return 0;
  const result = await prisma.etcEntry.deleteMany({
    where: {
      month,
      needsReview: true,
      OR: [
        { jobId: { notIn: qualifying.map((j) => j.id) } },
        { section: { notIn: [...ETC_TRACKED_CODES, PARTS_COST_SECTION] } },
      ],
    },
  });
  return result.count;
}

// Seeds one EtcEntry per Active job's EstimatedHours section for `month`, carrying
// Prior ETC forward from the previous month's confirmed New ETC (or the original
// quoted Estimate to Complete if this job has no prior month yet). Idempotent and
// safe to re-run: already-submitted entries for `month` are left untouched, and
// not-yet-submitted ones get their Prior ETC refreshed in case EstimatedHours changed.
//
// Only seeds the 13 departments the real "Managers Fill Out" sheet actually
// tracks (ETC_SECTIONS) — confirmed by decoding its header formulas; PM,
// Manufacturing, and the whole Warranty phase have no ETC column there.
export async function startMonth(month: string, _formData: FormData) {
  await seedMonth(month);
  await logAudit({ action: "etc.startMonth", entityType: "EtcMonth", entityId: month, summary: `Started ETC month ${month}` });
  revalidatePath("/etc");
}

async function seedMonth(month: string) {
  if (!isValidMonth(month)) {
    throw new Error(`"${month}" is not a valid ETC month (expected YYYY-MM).`);
  }
  await assertMonthSeedable(month);
  await pruneStaleEntries(month);

  // Must be the exact filter the grid renders with — a job seeded here but
  // hidden there leaves entries no form input can ever confirm.
  const jobs = await prisma.job.findMany({
    where: etcActiveJobFilter,
    include: { estimatedHours: true },
  });
  const jobIds = jobs.map((j) => j.id);

  await prisma.$transaction(
    async (tx) => {
      // Read INSIDE the transaction, not before it — this snapshot is what
      // decides which rows are safe to touch (existing.needsReview), so it
      // must be as fresh as possible relative to the writes below. Reading
      // it before the transaction started left a window where a concurrent
      // Submit and Lock (committing between the pre-read and this write)
      // wouldn't be reflected here, and this loop can run long enough
      // (every active job × tracked section, up to the 20s timeout) for
      // that window to matter.
      const [priorEntries, existingEntries] = await Promise.all([
        // EVERY earlier month, not just prevMonth — a job that skipped a period
        // must resume from where its ETC actually left off, never from quoted.
        // See latestPriorEtcByKey for the balance-reset this fixed (job 1104,
        // 2026-08-02). Four narrow columns, so the extra rows are cheap.
        tx.etcEntry.findMany({
          where: { month: { lt: month }, jobId: { in: jobIds } },
          select: { jobId: true, section: true, month: true, newEtc: true },
        }),
        tx.etcEntry.findMany({ where: { month, jobId: { in: jobIds } } }),
      ]);
      const priorByKey = latestPriorEtcByKey(priorEntries);
      const existingByKey = new Map(existingEntries.map((e) => [`${e.jobId}-${e.section}`, e]));

      // Collected, then written in two shapes: one createMany for the rows that
      // don't exist yet, and an update per row that genuinely CHANGED.
      //
      // This used to issue an upsert per TRACKED job/section — 380 of them on
      // the current data, awaited one at a time inside this transaction, on
      // every Refresh Data click. Almost all of them wrote values identical to what was
      // already stored, because Prior ETC only moves when last month's New ETC
      // does. Now a repeat refresh writes nothing at all, and the transaction
      // holds open for a fraction of the time — which matters more than the
      // milliseconds, since submitMonth contends for these same rows.
      const toCreate: {
        jobId: number;
        section: string;
        month: string;
        priorEtc: number;
        hoursWorked: number;
        hoursLeftCalc: number;
        newEtc: number;
        needsReview: boolean;
      }[] = [];
      const toUpdate: { id: number; priorEtc: number; hoursLeftCalc: number; newEtcDraft: number | null }[] = [];

      // Sections that carry a balance forward but have no QUOTE behind them.
      //
      // Seeding used to iterate job.estimatedHours alone, so a section the job was
      // never quoted for could never be seeded — even when the previous month left
      // a New ETC sitting on it. That is now reachable: the grid lets a manager
      // plan any section (see parseNewEtcCreateFields), so a June cell at
      // Prior 0 / Worked 0 / New ETC 1 must arrive in July as Prior 1, exactly
      // like every quoted section. Without this it would be stranded — the
      // balance would simply vanish at the month boundary.
      //
      // Built from priorEntries rather than by parsing priorByKey's composite
      // keys: section codes contain a hyphen and so does the key separator.
      const priorSectionsByJob = new Map<number, Set<string>>();
      for (const p of priorEntries) {
        if (!ETC_TRACKED_CODES.has(p.section)) continue;
        let set = priorSectionsByJob.get(p.jobId);
        if (!set) priorSectionsByJob.set(p.jobId, (set = new Set()));
        set.add(p.section);
      }

      // A job whose Start Date falls IN this month opens at its quote, whatever
      // the carry-forward chain says (2026-08-03, by request).
      //
      // The rule used to be "no ETC history -> quoted", which is only a proxy for
      // this one and diverges exactly where it matters. Jobs 1159 and 1160 both
      // started in July but already had rows from earlier months — seeded before
      // anyone had entered their quote, so those rows carried 0. July then
      // inherited 0 against quotes of 100, 260 and 150, and 1160 read Hours Left
      // -175 on a job that had simply never been given its estimate.
      //
      // This is also Power BI's own rule: [ETC Historical Hours Prior Month] uses
      // [Hours Quoted] for a job whose Start Date falls in the period.
      //
      // Confirmed history is still untouched — the needsReview check below is what
      // guarantees that, so this can only ever correct an open month.
      const monthOfDate = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

      for (const job of jobs) {
        const startsThisMonth = job.startDate != null && monthOfDate(job.startDate) === month;
        const quotedBySection = new Map<string, number>();
        for (const eh of job.estimatedHours) {
          if (!ETC_TRACKED_CODES.has(eh.section)) continue;
          quotedBySection.set(eh.section, Number(eh.quotedHours));
        }
        // The union: everything quoted, plus everything with ETC history. A
        // section in both is visited once.
        const sectionsToSeed = new Set<string>([...quotedBySection.keys(), ...(priorSectionsByJob.get(job.id) ?? [])]);

        for (const section of sectionsToSeed) {
          const key = `${job.id}-${section}`;
          const existing = existingByKey.get(key);
          if (existing && !existing.needsReview) continue; // already submitted — don't touch confirmed history

          const carried = priorByKey.get(key);
          // NO ETC history at all -> QUOTED hours, not estimate-to-complete:
          // the report's own [ETC Historical Hours Prior Month] measure
          // (SemanticModel TMDL, verified 2026-07-17) uses [Hours Quoted] for
          // a job whose Start Date falls in the prior period. The two are
          // usually equal for a brand-new job, but ETC can drift from quoted
          // before the job's first ETC month — quoted is the report's rule.
          //
          // "No history at all" is the operative phrase, and it used to read
          // "no row in the immediately preceding month" — which reset a
          // worked-down balance back to full quote every time a job skipped a
          // period. See latestPriorEtcByKey.
          // A history-only section has no quote to fall back to — but `carried`
          // is always defined for it by construction, so the fallback is never
          // reached there. The ?? 0 is belt-and-braces, not a real branch.
          // startsThisMonth WINS over the carried balance — see the note above.
          //
          // Now the shared rule (lib/etc.ts) rather than this expression, so
          // cascadePriorEtcForward and reopenMonth cannot answer it differently.
          const priorEtc = priorEtcForMonth({ startsThisMonth, carried, quoted: quotedBySection.get(section) ?? 0 });
          const hoursWorked = existing ? Number(existing.hoursWorked) : 0;

          // newEtc is deliberately NOT written for an existing row — it's a
          // manager-entered value (submitMonth falls back to the suggestion only
          // at submission time). Rows display the live suggestion as a
          // placeholder until then; nothing needs to overwrite the column on
          // every startMonth/Refresh Data click before that.
          if (!existing) {
            toCreate.push({
              jobId: job.id,
              section,
              month,
              priorEtc,
              hoursWorked: 0,
              hoursLeftCalc: priorEtc,
              newEtc: priorEtc,
              needsReview: true,
            });
            continue;
          }

          const hoursLeftCalc = round2(calcHoursLeft(priorEtc, hoursWorked));
          // Compare on the ROUNDED figures actually stored, not raw Decimals:
          // Number(Decimal) round-trips can differ in the last bit, and treating
          // that as a change would write all 380 rows every time and defeat the
          // point of comparing at all.
          const unchanged =
            round2(Number(existing.priorEtc)) === round2(priorEtc) &&
            round2(Number(existing.hoursLeftCalc)) === hoursLeftCalc;
          if (unchanged) continue;
          // A draft that merely echoed the suggestion from the OLD Prior ETC moves
          // with it — see redrivenDraft. Without this, a Save taken before the
          // Prior settled froze that moment's figure into the cell for good.
          const newEtcDraft = redrivenDraft({
            draft: existing.newEtcDraft != null ? Number(existing.newEtcDraft) : null,
            oldPriorEtc: Number(existing.priorEtc),
            newPriorEtc: priorEtc,
            hoursWorked,
          });
          toUpdate.push({ id: existing.id, priorEtc, hoursLeftCalc, newEtcDraft });
        }
      }

      // One round-trip for every new row. skipDuplicates covers the narrow race
      // where a concurrent writer created the same (job, section, month) between
      // this transaction's read and this write: the other row wins, which is the
      // same outcome the per-row upsert gave.
      if (toCreate.length > 0) {
        await tx.etcEntry.createMany({ data: toCreate, skipDuplicates: true });
      }
      // Still one statement per changed row — each carries different values — but
      // now only for rows that moved, which on a repeat refresh is none.
      for (const u of toUpdate) {
        await tx.etcEntry.update({
          where: { id: u.id },
          data: { priorEtc: u.priorEtc, hoursLeftCalc: u.hoursLeftCalc, newEtcDraft: u.newEtcDraft },
        });
      }
      console.log(
        `[seedMonth] ${month}: ${toCreate.length} created, ${toUpdate.length} updated (of ${jobs.length} active jobs)`,
      );
    },
    { timeout: 20000 },
  );

  revalidatePath("/etc");
}

// Bulk-confirms every entry in `month` in one atomic transaction. Validates every
// row before writing anything — a single bad value rejects the whole submission
// rather than leaving the month half-confirmed.
export async function submitMonth(month: string, formData: FormData) {
  const submittedPassword = String(formData.get("submitLockPassword") ?? "");
  if (!safeEqual(submittedPassword, SUBMIT_LOCK_PASSWORD)) {
    throw new Error("Incorrect password — Submit and Lock was not run.");
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  // Cells typed into a section that had no row yet, materialised BEFORE the read
  // below so they take part in this submission like any other entry.
  //
  // Without this, a manager who typed into one of those cells and hit Submit
  // before autosave fired would lose the value silently — Submit only ever walked
  // rows that already existed. They are created as drafts (needsReview true); the
  // normal path below is what confirms them.
  //
  // Skipped on a locked month: the guard below is what rejects the submission, and
  // creating rows first would leave them behind after it throws.
  const lockedAlready = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  const typedNewCells = isMonthLocked(lockedAlready) ? [] : parseNewEtcCreateFields(formData);
  if (typedNewCells.length > 0) {
    await prisma.$transaction(
      typedNewCells.map((c) =>
        prisma.etcEntry.upsert({
          where: { jobId_section_month: { jobId: c.jobId, section: c.section, month } },
          update: { newEtcDraft: c.value },
          create: {
            jobId: c.jobId,
            section: c.section,
            month,
            priorEtc: 0,
            hoursWorked: 0,
            hoursLeftCalc: 0,
            newEtc: 0,
            newEtcDraft: c.value,
            needsReview: true,
          },
        }),
      ),
    );
  }
  // Keyed for the Hours Worked lookup below: a row created a moment ago has no
  // `hoursWorked__<id>` field in this form (its id did not exist when the page
  // rendered), and its hours are 0 by definition.
  const createdKeys = new Set(typedNewCells.map((c) => `${c.jobId}::${c.section}`));

  const allEntries = await prisma.etcEntry.findMany({ where: { month } });

  // A locked month is frozen history — a stale tab re-POSTing this form (or a
  // direct action call) must never silently rewrite it. Same guard as
  // syncPowerBiForEtc/clearMonth; reopenMonth (admin-only) is the way back in.
  if (isMonthLocked(allEntries)) {
    throw new Error(`${month} is already submitted and locked — reopen it first if a correction is needed.`);
  }

  // A reopened HISTORICAL month (a newer month exists) is a correction pass,
  // not a live workflow: its job universe is its own entries, period. The
  // current-month branch below prunes entries whose jobs dropped out of
  // TODAY's etcActiveJobFilter — correct for the in-progress month (the grid
  // renders that same filter, so pruned rows had no form inputs), but on a
  // reopened historical month it silently deleted real history for jobs that
  // completed since (proven live 2026-07-14: re-submitting a reopened April
  // shrank it 366 → 323 rows / 43 → 36 jobs before the data was restored
  // from the source workbook). getEtcMonthJobWhere applies the same
  // historical rule to what the grid renders, so grid and submit agree.
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  const isHistorical = latest != null && month < latest.month;

  const renderable = (section: string) => section === PARTS_COST_SECTION || ETC_TRACKED_CODES.has(section);
  let staleIds: number[] = [];
  let entries: typeof allEntries;
  if (isHistorical) {
    // Never delete anything from history; lock every entry the month has.
    entries = allEntries.filter((e) => renderable(e.section));
  } else {
    // Scope to the same job universe the grid renders — entries on jobs that
    // stopped qualifying since the last Refresh have no form inputs and must
    // be pruned (if unsubmitted) rather than fail validation. Confirmed
    // entries on since-hidden jobs are history and are left untouched.
    const qualifying = await prisma.job.findMany({ where: etcActiveJobFilter, select: { id: true } });
    const qualifyingIds = new Set(qualifying.map((j) => j.id));
    staleIds = allEntries.filter((e) => e.needsReview && (!qualifyingIds.has(e.jobId) || !renderable(e.section))).map((e) => e.id);
    entries = allEntries.filter((e) => qualifyingIds.has(e.jobId) && renderable(e.section));
  }

  // Never let a submission reduce a month to nothing — an empty confirm with
  // stale deletions would erase the month instead of locking it.
  if (entries.length === 0) {
    throw new Error(`Nothing to submit for ${month} — no entries on currently active jobs.`);
  }

  const inputs: { id: number; hoursWorked: number; override: number | null }[] = [];

  for (const entry of entries) {
    const rawHours = formData.get(`hoursWorked__${entry.id}`);
    if (rawHours === null || rawHours === "") {
      // A row this submission just created: no time booked to it, and its typed
      // New ETC is already on the draft. Handled before the historical branch so
      // the "Missing Hours Worked" guard below keeps its full strength for the
      // case it exists for — an entry that SHOULD have been rendered and wasn't.
      if (createdKeys.has(`${entry.jobId}::${entry.section}`)) {
        inputs.push({ id: entry.id, hoursWorked: 0, override: entry.newEtcDraft != null ? round2(Number(entry.newEtcDraft)) : null });
        continue;
      }
      // On a historical correction pass, an entry hidden from the grid (e.g.
      // its job is type-gated out of rendering) simply keeps its stored Hours
      // Worked AND its stored New ETC instead of failing the whole submission.
      if (isHistorical) {
        inputs.push({ id: entry.id, hoursWorked: Number(entry.hoursWorked), override: round2(Number(entry.newEtc)) });
        continue;
      }
      throw new Error(`Missing Hours Worked for entry ${entry.id} (section ${entry.section}).`);
    }
    const hoursWorked = Number(rawHours);
    // Negative is invalid for HOURS — nobody un-works time — but PARTS_COST
    // stores MONEY SPENT in this same column, and money spent genuinely can go
    // negative: a credit note, a returned part, an over-invoice corrected in
    // TotalETO. This guard was written for hours and applied to both, so a single
    // credit anywhere in the month made Submit ETC impossible: 2026-06 could not
    // be submitted at all because entry 50196 carried -134.99 (found 2026-08-03).
    const negativeAllowed = entry.section === PARTS_COST_SECTION;
    if (!Number.isFinite(hoursWorked) || (hoursWorked < 0 && !negativeAllowed)) {
      throw new Error(
        `Invalid Hours Worked "${rawHours}" for entry ${entry.id} (section ${entry.section}).`,
      );
    }

    const rawOverride = formData.get(`newEtcOverride__${entry.id}`);
    let override: number | null = null;
    if (rawOverride !== null && rawOverride !== "") {
      const overrideVal = Number(rawOverride);
      if (!Number.isFinite(overrideVal) || overrideVal < 0) {
        throw new Error(`Invalid New ETC override "${rawOverride}" for entry ${entry.id} (section ${entry.section}).`);
      }
      override = round2(overrideVal);
    } else if (isHistorical && entry.newEtcClearedAt == null) {
      // Historical correction pass: an untouched New ETC cell renders EMPTY
      // (the original submit consumed its draft), so "no override" here means
      // "keep the manager's confirmed value" — NOT "recompute the suggestion",
      // which would silently erase every manager override in the month on a
      // no-changes resubmit. To change a historical cell, type the new value.
      //
      // UNLESS Clear ETC blanked it deliberately. An empty box means two different
      // things on a historical month — "I didn't touch this" and "I cleared this on
      // purpose" — and newEtcClearedAt is what tells them apart. Without this check
      // the restore below would hand the old figure straight back and the clear
      // would survive only until the next submit.
      override = round2(Number(entry.newEtc));
    }

    inputs.push({ id: entry.id, hoursWorked, override });
  }

  // Prior ETC is re-read INSIDE the transaction: a concurrent Run Report can
  // rewrite priorEtc between the validation read above and the write below,
  // and the suggestion/Hours Left must be computed from what actually gets
  // locked, not a stale pre-read.
  const updates = await prisma.$transaction(
    async (tx) => {
      if (staleIds.length > 0) {
        await tx.etcEntry.deleteMany({ where: { id: { in: staleIds } } });
      }
      const fresh = await tx.etcEntry.findMany({ where: { id: { in: inputs.map((i) => i.id) } } });
      const freshById = new Map(fresh.map((e) => [e.id, e]));
      const written: { id: number; priorEtc: number; hoursWorked: number; newEtc: number }[] = [];
      for (const u of inputs) {
        const entry = freshById.get(u.id);
        if (!entry) continue; // deleted since validation — nothing to lock
        const priorEtc = Number(entry.priorEtc);
        const newEtc = u.override ?? round2(suggestNewEtc(priorEtc, u.hoursWorked));
        await tx.etcEntry.update({
          where: { id: u.id },
          data: {
            hoursWorked: u.hoursWorked,
            hoursLeftCalc: round2(calcHoursLeft(priorEtc, u.hoursWorked)),
            newEtc,
            newEtcDraft: null, // draft is consumed by the submission
            // The "deliberately blank" marker is spent too: this cell now HAS a
            // confirmed value, so on a later reopen it should seed from that value
            // like any other, not stay blank from a clear two passes ago.
            newEtcClearedAt: null,
            needsReview: false,
            submittedAt: new Date(),
            ...(userId ? { enteredById: Number(userId) } : {}),
          },
        });
        written.push({ id: u.id, priorEtc, hoursWorked: u.hoursWorked, newEtc });
      }
      return written;
    },
    { timeout: 20000 },
  );

  // Push the freshly-locked New ETC values into the months that derive their
  // Prior ETC from them. On the current month this is a no-op (nothing exists
  // after it yet); on a reopened historical month it is the whole point of
  // the correction — see cascadePriorEtcForward.
  const cascade = await cascadePriorEtcForward(month);

  const entryById = new Map(entries.map((e) => [e.id, e]));
  await logAudit({
    action: "etc.submitMonth",
    entityType: "EtcMonth",
    entityId: month,
    summary:
      `Submitted ${updates.length} ETC entr${updates.length === 1 ? "y" : "ies"} for ${month}` +
      (cascade.entriesUpdated > 0
        ? ` — carried forward into ${cascade.monthsUpdated.join(", ")} (${cascade.entriesUpdated} Prior ETC updated)`
        : "") +
      (cascade.stoppedAtLockedMonth ? ` — carry-forward stopped at locked month ${cascade.stoppedAtLockedMonth}` : ""),
    metadata: {
      staleDeleted: staleIds.length,
      cascade,
      entries: updates.map((u) => ({
        jobId: entryById.get(u.id)?.jobId,
        section: entryById.get(u.id)?.section,
        priorEtc: u.priorEtc,
        hoursWorked: u.hoursWorked,
        newEtc: u.newEtc,
      })),
    },
  });

  revalidatePath("/etc");
}

// The toolbar's Save button — the single, password-gated commit path for every
// New ETC cell in the grid (both the hour-based department cells in
// EtcSectionCells and Parts Cost in PartsCostNewEtcCell). Typing in any of them
// persists nothing on its own; everything currently typed across the whole grid
// batch-saves in one shot only when this runs. The grid is all one <form>, so
// every `newEtcOverride__<id>` field the manager has touched (or left alone)
// already lives in `formData` — this just reads them back.
//
// NOT password-gated — see the note inside. It was, and that gate lost people's work.
//
// `saved` is how many rows the click actually wrote, so the caller can SAY so.
// Reported 2026-08-03 as "Save isn't working": it was working — the audit log had
// 15 successful batches that afternoon — but nothing on screen acknowledged a
// save. There is deliberately no revalidatePath here (see the note at the end),
// so a save that wrote 11 drafts looked exactly like one that wrote none, and
// like one that failed. A count makes the three distinguishable.
export async function saveAllNewEtcDrafts(month: string, formData: FormData): Promise<{ ok: boolean; saved: number }> {
  // ── No password gate on the DRAFT save (2026-08-04) ───────────────────────
  //
  // This used to require an unlock cookie, with `newEtcSavePassword` as the fallback.
  // That gate was the direct cause of silent data loss, reported twice as "Save is not
  // working": the cookie is session-scoped on purpose ("closing the browser relocks the
  // tab"), so every new browser session re-locked it. A manager would type values, click
  // Save, get a password popover instead of a save, and lose everything on the next
  // refresh. EtcAutosave was gated on the same flag, so there was no safety net either.
  // Confirmed against the audit log: ZERO draft saves in the three hours the loss was
  // being reported.
  //
  // Gating a SAVE is backwards. A gate belongs on actions that freeze or destroy —
  // Submit ETC, Clear ETC, Reopen Month, Sync History all keep theirs, re-entered every
  // time. A draft is the opposite: it commits nothing, it is what Submit later reads,
  // and refusing to store it protects nothing while risking the manager's work.
  //
  // Nothing is weakened by removing it. A draft is not a confirmed figure: needsReview
  // stays true, the value shows as a draft, and Submit ETC — still password-gated — is
  // what turns it into history.
  const entries = await prisma.etcEntry.findMany({
    where: { month },
    select: { id: true, needsReview: true, newEtcDraft: true },
  });

  const changes: { entryId: number; from: number | null; to: number | null }[] = [];
  const writes = [];
  for (const entry of entries) {
    // Already submitted (a reopened month's untouched entries) — Save only
    // ever writes drafts, never confirmed history.
    if (!entry.needsReview) continue;

    const raw = formData.get(`newEtcOverride__${entry.id}`);
    // Not present at all means this entry wasn't rendered in the current
    // view (a department Columns filter hid it) — leave it untouched rather
    // than reading its absence as "clear the draft".
    if (raw === null) continue;

    const trimmed = String(raw).trim();
    const nextValue = trimmed === "" ? null : Number(trimmed);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) continue; // skip one bad value, don't abort the whole batch

    const nextDraft = nextValue === null ? null : round2(nextValue);
    const currentDraft = entry.newEtcDraft != null ? round2(Number(entry.newEtcDraft)) : null;
    if (nextDraft === currentDraft) continue; // unchanged — skip the write and the audit noise

    changes.push({ entryId: entry.id, from: currentDraft, to: nextDraft });
    writes.push(
      prisma.etcEntry.update({
        where: { id: entry.id },
        data: {
          newEtcDraft: nextDraft,
          // Entering a value un-clears a cell Clear ETC had blanked: the manager
          // has now answered it, so the "deliberately blank" marker is spent. Only
          // on a real value — saving an empty box over an already-empty cleared
          // cell is a no-op above and must leave the marker in place, or the cell
          // would seed straight back from its confirmed value.
          ...(nextDraft !== null ? { newEtcClearedAt: null } : {}),
        },
      }),
    );
  }

  // ── Cells that have no row yet ─────────────────────────────────────────────
  //
  // `newEtcCreate__<jobId>__<section>` comes from a cell the grid now renders for
  // a section the job was never quoted for (see EtcSectionCells). Half of July's
  // grid was cells like that, unplannable because nobody had quoted them.
  //
  // Created ONLY when a value is actually typed. An empty one is the normal state
  // of most of the grid — creating a row for each would add ~350 empty entries a
  // month, move nothing, and quietly widen what the month contains.
  const created = parseNewEtcCreateFields(formData);
  for (const { jobId: jobPk, section, value: rounded } of created) {
    // Prior ETC and Hours Worked are 0 by definition here: no prior estimate was
    // ever carried into this cell and no time has been booked to it this month.
    // needsReview stays true — this is a draft, exactly like any other unsubmitted
    // cell, and Submit is what confirms it.
    writes.push(
      prisma.etcEntry.upsert({
        where: { jobId_section_month: { jobId: jobPk, section, month } },
        update: { newEtcDraft: rounded },
        create: {
          jobId: jobPk,
          section,
          month,
          priorEtc: 0,
          hoursWorked: 0,
          hoursLeftCalc: 0,
          newEtc: 0,
          newEtcDraft: rounded,
          needsReview: true,
        },
      }),
    );
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
    await logAudit({
      action: "etc.saveAllNewEtcDrafts",
      entityType: "EtcEntry",
      entityId: month,
      summary:
        `Batch-saved ${changes.length} New ETC draft(s) for ${month}` +
        (created.length > 0 ? `, creating ${created.length} entry(ies) for previously unquoted sections` : ""),
      metadata: { changes, created },
    });
  }

  // Deliberately NO revalidatePath (2026-08-03). This is the DRAFT save — it runs
  // on every autosave pass, and revalidating made the action's response carry a
  // fresh render of the whole month: 59 jobs x 13 sections x 5 sub-columns, plus
  // Parts Cost and the Standard Fees block. That render, not the writes (a handful
  // of updates in one transaction), is what made saving feel slow.
  //
  // Nothing on screen needs it either: the drafts being saved are the values the
  // manager just typed, the client re-baselines the dirty tracker from the posted
  // FormData (rebaselineEtcFields, called by EtcAutosave and SaveEtcDraftsButton),
  // and every derived figure now recomputes live (lib/etc-live-totals.ts).
  //
  // The paths that DO change what the server would render still revalidate:
  // submitMonth, startMonth, reopenMonth, clearMonth, the sync steps, and the
  // wrong-password branch above.
  return { ok: true, saved: writes.length };
}

// ── Clear ETC ───────────────────────────────────────────────────────────────
//
// Empties every YELLOW New ETC cell in the month — the cells still waiting on a
// manager's judgement — and leaves them yellow so the grid reads as a checklist of
// what to re-enter.
//
// Which cells that is, exactly: yellow means hours were worked this month and no
// decision has been made. On a first-pass month those cells are already empty, so
// this does nothing. On a REOPENED month they arrive carrying the figure they were
// submitted with, and that is what this removes — 142 of July 2026's cells at the
// time of writing. It is scoped by lib/etc.ts's isNewEtcClearable, the same rule
// that paints the cell, so it can never clear something the manager can't see as
// yellow, or miss something they can.
//
// Never touches a DECIDED cell (a value somebody typed) and never touches confirmed
// history: `needsReview` false rows are skipped outright and a fully-submitted month
// is refused. Reopen it first if that is really the intent.
//
// ── Why it needs newEtcClearedAt ────────────────────────────────────────────
// Setting newEtcDraft to null is NOT enough. A reopened cell seeds from `newEtc`
// whenever the draft is null, so the cleared cell would come straight back with
// last submission's figure and the button would look broken. The column records
// "deliberately blank" as distinct from "no draft".
//
// Gated by the confirmation phrase EVERY time, with no session cookie — unlike Save.
// Erasing 142 entered values in one click is closer to Reopen Month than to a save,
// so it should cost a deliberate keystroke each time. The cleared values are written
// to the audit log so any single figure can be looked up and restored.
export async function clearYellowNewEtc(
  month: string,
  formData: FormData,
): Promise<{ ok: boolean; cleared: number; reason?: "password" | "locked" | "month" }> {
  if (!isValidMonth(month)) return { ok: false, cleared: 0, reason: "month" };

  const attempt = String(formData.get("clearEtcPassword") ?? "");
  if (!safeEqual(attempt, SUBMIT_LOCK_PASSWORD)) {
    return { ok: false, cleared: 0, reason: "password" };
  }

  const entries = await prisma.etcEntry.findMany({
    where: { month },
    select: {
      id: true, jobId: true, section: true, needsReview: true,
      newEtcDraft: true, newEtc: true, priorEtc: true, hoursWorked: true,
      submittedAt: true, newEtcClearedAt: true,
    },
  });
  if (entries.length === 0) return { ok: true, cleared: 0 };
  if (isMonthLocked(entries)) return { ok: false, cleared: 0, reason: "locked" };

  // Same definition the grid uses: on a historical month every cell reads as
  // confirmed even without its own submittedAt.
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  const isHistorical = latest != null && month < latest.month;

  const targets: { entryId: number; jobId: number; section: string; draft: number | null; confirmed: number | null }[] = [];
  for (const e of entries) {
    if (!e.needsReview) continue; // confirmed history — never touched
    const state: NewEtcCellState = {
      priorEtc: Number(e.priorEtc),
      hoursWorked: round2(Number(e.hoursWorked)),
      draft: e.newEtcDraft != null ? Number(e.newEtcDraft) : null,
      confirmed: isHistorical || e.submittedAt != null ? round2(Number(e.newEtc)) : null,
      cleared: e.newEtcClearedAt != null,
      // Parts Cost New ETC always shows a figure, so it is never awaiting a decision
      // and this action never touches it (2026-08-03, by request — an earlier pass
      // did clear it, and blanked all 39 of July's cells). Same two flags the cell
      // passes, so what this writes and what the manager sees as yellow are one set.
      precision: e.section === PARTS_COST_SECTION ? "exact" : "whole",
      reopenAsksAgain: e.section !== PARTS_COST_SECTION,
      locked: false, // isMonthLocked was refused above
      // Cannot change the answer: monthComplete only gates the zero-hours
      // carry-forward seed, and a zero-hours cell is decided by definition, so it
      // is never clearable either way.
      monthComplete: true,
    };
    if (!isNewEtcClearable(state)) continue;
    targets.push({ entryId: e.id, jobId: e.jobId, section: e.section, draft: state.draft, confirmed: state.confirmed });
  }

  if (targets.length === 0) return { ok: true, cleared: 0 };

  // One statement rather than N updates in a transaction: every target gets the
  // same two fields, and 142 sequential round-trips is what made other bulk paths
  // on this page feel slow.
  await prisma.etcEntry.updateMany({
    where: { id: { in: targets.map((t) => t.entryId) } },
    data: { newEtcDraft: null, newEtcClearedAt: new Date() },
  });

  await logAudit({
    action: "etc.clearYellowNewEtc",
    entityType: "EtcMonth",
    entityId: month,
    summary: `Cleared ${targets.length} unconfirmed New ETC value(s) for ${month}`,
    // The removed figures, so a manager can look up and restore any one of them.
    metadata: { cleared: targets },
  });

  revalidatePath("/etc");
  return { ok: true, cleared: targets.length };
}

// Re-opens a locked (fully-submitted) month for editing.
//
// Gated by the same confirmation phrase as Submit and Lock, entered every
// time (no session cookie): unfreezing a closed month is the single most
// consequential thing this page can do, so it should cost a deliberate
// keystroke each time rather than staying unlocked for the session the way
// Save does. This used to be role === "ADMIN" instead; the password replaced
// that check on request (2026-08-02) so a manager correcting their own month
// isn't blocked on an admin account. Same treatment as every other gate here
// — an "are you sure" gesture, not a real access boundary.
export async function reopenMonth(month: string, formData: FormData) {
  const submittedPassword = String(formData.get("reopenPassword") ?? "");
  if (!safeEqual(submittedPassword, SUBMIT_LOCK_PASSWORD)) {
    throw new Error("Incorrect password — the month was not reopened.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.etcEntry.updateMany({ where: { month }, data: { needsReview: true } });
  });

  // ── Re-derive Prior ETC on the way back in (2026-08-04) ───────────────────
  //
  // A month that was locked is a month cascadePriorEtcForward REFUSED to write
  // to, deliberately — confirmed rows are not its to revise. So a correction
  // made upstream while this month was frozen never reached it, and reopening it
  // used to hand the manager the stale opening balance to plan against.
  //
  // Proven from the audit log for July 2026: July was submitted at 16:32, June
  // was corrected and re-submitted at 16:37 (logged "carry-forward stopped at
  // locked month 2026-07"), and July was reopened at 16:38 still holding the
  // Prior ETC it had been seeded with before June moved — 16 hours cells wrong,
  // reported the next morning as "June isn't saved correctly, the Prior ETC for
  // July still isn't right".
  //
  // Reopening is exactly the moment this becomes safe: every row is needsReview
  // again, so the same rule that guards the cascade guards this. Then walk
  // forward, since months after this one may have been stranded the same way.
  const rederived = await derivePriorEtcForMonth(month);
  const cascade = await cascadePriorEtcForward(month);

  await logAudit({
    action: "etc.reopenMonth",
    entityType: "EtcMonth",
    entityId: month,
    summary:
      `Reopened ETC month ${month}` +
      (rederived.entriesUpdated > 0 ? ` — re-derived ${rederived.entriesUpdated} Prior ETC from the months before it` : "") +
      (cascade.entriesUpdated > 0 ? ` — carried forward into ${cascade.monthsUpdated.join(", ")} (${cascade.entriesUpdated} Prior ETC updated)` : ""),
    metadata: { rederived, cascade },
  });

  revalidatePath("/etc");
}

// Parity with the original sheet's "Refresh Data" button, which did everything
// in one click: added/removed job rows AND pulled the latest hours. So this
// seeds the month first if needed (seedMonth is idempotent — submitted entries
// are never touched), then pulls actual hours from Power BI. Updates the
// job-level rollup (for the dashboard/job-detail views) AND overwrites this
// month's EtcEntry.hoursWorked per section directly — Hours Worked is meant to
// always reflect Power BI, not be independently typed in. Recomputes Hours
// Left / suggested New ETC from the fresh value, but leaves needsReview
// untouched so a manager still confirms before it counts as submitted.
//
// Found 2026-07-14 (see the June data-correction incident): reopening an
// already-closed month and running this seeds/re-syncs it against TODAY's
// etcActiveJobFilter and TODAY's raw Power BI actuals — wrong on both counts
// for a month that's already closed. seedMonth's prune step deletes entries
// for jobs that have since completed (real history, gone), its re-seed step
// adds entries for jobs that only became active after that month closed (never
// really part of it), and the "actual hours" sync overwrites Hours Worked with
// today's raw system totals instead of whatever was reconciled/manager-signed
// for that month — proven by directly reopening a corrected historical month
// and running this: 42 real entries were deleted, 62 wrong ones were added,
// twice (once each on the April and June corrections; the live measure
// happily returns real-looking data for a past month, it's just the wrong
// data for it). This only ever belongs on the single currently-open month —
// historical corrections belong in "Sync History" or manual entry instead.
async function assertCurrentEtcMonth(month: string): Promise<void> {
  const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
  if (!isSafeForLiveEtcSync(month, latest?.month ?? null)) {
    throw new Error(
      `${month} is not the current ETC month (${latest!.month} is) — Run Report and Clear ETC only belong on the single currently-open month and would corrupt this one. Reopen ${month} and correct entries by hand, or use "Sync History" to refresh it from Power BI's historical archive instead.`
    );
  }
}

export async function syncPowerBiForEtc(month: string, _formData: FormData) {
  // A submitted month is a frozen snapshot — refresh must never rewrite its
  // Hours Worked/Parts Cost. Reopen it first if a genuine correction is needed.
  const entries = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (isMonthLocked(entries)) {
    throw new Error(`${month} is already submitted and locked — its numbers are frozen. Reopen it first if a correction is needed.`);
  }
  await assertCurrentEtcMonth(month);

  await seedMonth(month);
  // ONE read of the feed, shared by both hours syncs — and scoped to THIS MONTH.
  //
  // Both were load-bearing at different times. Sharing the read dates from when
  // the source was a local workbook and parsing it twice cost ~1.6s a click.
  // Scoping it to one month dates from the move to Power BI (2026-08-03), where
  // the full 18-month span is one DAX round-trip per month: this button was
  // re-pulling and re-writing every month in order to refresh one, which is what
  // made it sit on "Refreshing…" for ~15s.
  //
  // Correct as well as faster — the button refreshes ONE month. History is the
  // scheduled pass's job (auto-sync.ts), which still reads the whole span.
  const hoursExport = await fetchJobHoursRowsWithIssues({ onlyMonth: month });
  await syncActualHours(hoursExport);
  await syncHoursWorked(month, hoursExport.rows);
  await syncPartsCost(month);
  await logAudit({ action: "etc.syncPowerBiForEtc", entityType: "EtcMonth", entityId: month, summary: `Refreshed Power BI data for ETC month ${month}` });
  revalidatePath("/etc");
  revalidatePath("/");
}

export type SyncHistoryResult = {
  monthsRefreshed: number;
  reconciledMonths: string[];
  entriesReconciled: number;
  poolEntriesReconciled: number;
};

// Re-pulls every Power BI-owned historical month from the "ETC Historical *"
// measures so past months always match the source report. Months with real
// in-app work (submitted / mid-edit / in progress) are never touched — the
// app is the source of truth for those. For an app-owned month Power BI has
// since published an archive for, only its display-only fact fields (Hours
// Worked/Prior ETC on EtcEntry; Previous Pulled/New Added/Available/Worked
// on CategoryPool) are reconciled — every submitted decision (New ETC,
// hoursPulledThisMonth, rate, and the frozen dollar figures derived from
// them) is left exactly as the manager submitted it. Safe to run any time.
//
// Takes/returns the (state, formData) shape useActionState expects — see
// SyncHistoryButton, which surfaces this result as a toast instead of the
// reconciliation only being visible in the audit log.
export async function syncEtcHistory(_prevState: SyncHistoryResult | null, formData: FormData): Promise<SyncHistoryResult> {
  // Gated by the shared confirmation phrase (2026-08-02). Two reasons, and the
  // second is the important one:
  //
  //  • It replaces a `role === "ADMIN"` check that only ever hid the BUTTON.
  //  • The action itself had no guard at all, so any signed-in user could
  //    invoke it directly and re-pull every historical month. Hiding a control
  //    is not gating the thing behind it.
  if (!matchesConfirmPassword(String(formData.get("syncHistoryPassword") ?? ""))) {
    throw new Error("Incorrect password — Sync History was not run.");
  }
  const result = await syncEtcHistoryFromPowerBi();
  const reconciledMonths = [...new Set([...result.monthsOwnedWithPbiHistoryNow, ...result.poolMonthsOwnedWithPbiHistoryNow])];
  const reconciledNote =
    reconciledMonths.length > 0
      ? ` — reconciled display fields for locked month(s) now published by Power BI: ${reconciledMonths.join(", ")} (${result.entriesReconciled} EtcEntry + ${result.poolEntriesReconciled} pool fields updated; all submitted decisions/dollars untouched)`
      : "";
  await logAudit({
    action: "etc.syncEtcHistory",
    entityType: "EtcMonth",
    summary: `Refreshed ${result.monthsRefreshed.length} historical ETC months from Power BI (${result.entriesWritten} rows)${reconciledNote}`,
    metadata: result,
  });
  revalidatePath("/etc");
  revalidatePath("/");
  return {
    monthsRefreshed: result.monthsRefreshed.length,
    reconciledMonths,
    entriesReconciled: result.entriesReconciled,
    poolEntriesReconciled: result.poolEntriesReconciled,
  };
}

// Parity with the original sheet's "Clear ETC" script, which blanked only the
// New ETC columns and left Hours Worked alone: resets every entry's New ETC
// back to the system suggestion and re-flags it for review, keeping the
// Power BI-sourced Hours Worked in place. Refuses to touch a locked
// (submitted) month — reopen it first if a genuine correction is needed, so a
// clear can never silently erase confirmed history.
export async function clearMonth(month: string, _formData: FormData) {
  const entriesBefore = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (isMonthLocked(entriesBefore)) {
    throw new Error(`${month} is already submitted — reopen it before clearing.`);
  }
  // Clearing a reopened HISTORICAL month would overwrite every manager-
  // confirmed New ETC with the recomputed suggestion — erasing exactly the
  // overrides that made it history. Clear belongs to the live workflow only.
  await assertCurrentEtcMonth(month);

  let clearedCount = 0;
  await prisma.$transaction(
    async (tx) => {
      // Re-read and re-check INSIDE the transaction: a Submit and Lock can
      // commit between the check above and this write (its own transaction
      // runs up to 20s), and clearing a just-locked month would flip every
      // confirmed entry back to needsReview and wipe the manager's
      // overrides. Same pattern as seedMonth's in-tx snapshot.
      const entries = await tx.etcEntry.findMany({ where: { month } });
      if (isMonthLocked(entries)) {
        throw new Error(`${month} was submitted while the clear was running — nothing was changed.`);
      }
      clearedCount = entries.length;
      for (const entry of entries) {
        const priorEtc = Number(entry.priorEtc);
        const hoursWorked = Number(entry.hoursWorked);
        await tx.etcEntry.update({
          where: { id: entry.id },
          data: {
            hoursLeftCalc: round2(calcHoursLeft(priorEtc, hoursWorked)),
            newEtc: round2(suggestNewEtc(priorEtc, hoursWorked)),
            newEtcDraft: null, // the sheet's Clear wiped typed New ETC cells too
            needsReview: true,
          },
        });
      }
    },
    { timeout: 20000 },
  );

  await logAudit({
    action: "etc.clearMonth",
    entityType: "EtcMonth",
    entityId: month,
    summary: `Cleared New ETC on ${clearedCount} entr${clearedCount === 1 ? "y" : "ies"} for ${month}`,
  });

  revalidatePath("/etc");
}
