"use server";

import { prisma } from "@/lib/prisma";
import {
  calcHoursLeft,
  isMonthLocked,
  round2,
  nextMonth,
  isValidMonth,
  latestPriorEtcByKey,
  priorEtcForMonth,
  redrivenDraft,
  isStaleDraftWrite,
  parseNewEtcField,
  type NewEtcWriteIntent,
} from "@/lib/etc";
import { derivePriorEtcForMonth, cascadePriorEtcForward } from "@/lib/etc-prior-etc";
import { etcActiveJobFilter } from "@/lib/job-filters";
import { ETC_TRACKED_CODES, PARTS_COST_SECTION, SECTIONS } from "@/lib/sections";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { recordChanges, type CellChange } from "@/lib/change-log";
import { matchesButtonPassword } from "@/lib/button-password";

// The confirmation gate in front of the actions that freeze or unfreeze a month's
// numbers — an "are you sure" step, not a real access boundary (the whole app is
// already behind sign-in). Checked here rather than client-side so the phrase can't
// be read out of the page JS bundle.
//
// The phrase itself now comes from lib/button-password.ts, shared with every other
// protected button. It used to be a local constant here, which is how "change the
// password" became a seven-file search (2026-08-04).
// (no local helper — callers use matchesButtonPassword directly, so there is
// exactly one comparison implementation in the app.)

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

// Every well-formed `newEtcCreate__` field in the payload, with what it MEANS
// (lib/etc.ts's parseNewEtcField) rather than only the ones that carry a number.
//
// It returns clears and zeros too, because both are real instructions once a row
// exists behind the cell — and one does, as soon as a value has been saved into it
// once. The field name does not change until the page re-renders, so the browser
// keeps posting `newEtcCreate__` for a cell that now has an EtcEntry. Filtering
// empties out here (which is what this did) meant clearing such a cell within the
// same page session wrote nothing at all.
type ParsedCreateField = { jobId: number; section: string; intent: NewEtcWriteIntent };

function parseNewEtcCreateFields(formData: FormData): ParsedCreateField[] {
  const out: ParsedCreateField[] = [];
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
    out.push({ jobId, section, intent: parseNewEtcField(raw) });
  }
  return out;
}

// (typedNewCellsToCreate lived here until §15: it turned the parsed create-cells into
// rows for submitMonth to materialise before it walked the month. The submission reads
// the database now and creates nothing, so the only consumer of that shape is gone —
// saveAllNewEtcDrafts creates the row itself, when a real positive figure is typed.)

// The figure a client said it believed was stored, as a number — used to name the
// value a manager removed when the cell had no stored draft of its own (a reopened
// or carried-forward figure). null when the client declared nothing, declared
// blank, or declared something unreadable: the change log would rather say "was
// (blank)" than invent a previous value.
function believedNumberOrNull(believedStored: string | null): number | null {
  if (believedStored === null) return null;
  const trimmed = believedStored.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? round2(n) : null;
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

// ── submitMonth is GONE (§15, 2026-08-04) ────────────────────────────────────
//
// The ETC-only submission path was removed with the "Submit ETC" button. A month is
// finalised by ONE action now — submitMonthlyReport in lib/monthly-report-actions.ts —
// which freezes the ETC entries and the Standard Sheet fee rows in a single
// transaction, so a half-submitted month is no longer representable.
//
// Two things went with it, and are better for going:
//   * The submission no longer reads ~450 `hoursWorked__<id>` fields out of the posted
//     form. It reads the database, so a stale tab cannot freeze its own snapshot over
//     colleagues' saved work, and a Columns filter can no longer hide entries from it
//     (which used to make a filtered grid unsubmittable).
//   * The "did this manager type this, or is it merely what their page loaded with?"
//     baseline dance (injectEtcBaselineFields) is unnecessary for the same reason.

// ── The one write path for every New ETC cell ────────────────────────────────
//
// Called by EtcAutosave ~0.8s after the last keystroke, for the cells this user has
// actually edited. There is no Save button any more (§17, 2026-08-04): typing, editing,
// clearing and pasting all come through here on their own, and the status chip reports
// where each save got to.
//
// NOT password-gated — see the note inside. It was, and that gate lost people's work.
//
// The return value is what the client reports: how many rows were written, how many of
// those were REMOVALS, which cells were refused because somebody else wrote them first,
// and which values were invalid. A save that wrote 11 drafts must not look like one that
// wrote none, or like one that failed.
export async function saveAllNewEtcDrafts(
  month: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  saved: number;
  cleared: number;
  conflicts: number;
  conflictFields: string[];
  // Fields whose posted value is not a number this column accepts. Never written,
  // never coerced, and reported back so the cell can say so instead of the value
  // vanishing on the next reload. See parseNewEtcField.
  invalidFields: string[];
}> {
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
  // the monthly report submission, Reopen Month and Sync History all keep theirs, re-entered every
  // time. A draft is the opposite: it commits nothing, it is what Submit later reads,
  // and refusing to store it protects nothing while risking the manager's work.
  //
  // Nothing is weakened by removing it. A draft is not a confirmed figure: needsReview
  // stays true, the value shows as a draft, and Submit ETC — still password-gated — is
  // what turns it into history.
  const entries = await prisma.etcEntry.findMany({
    where: { month },
    // `section` is read for the stale-write guard's precision: Parts Cost keeps its
    // cents, hours cells are compared as whole numbers because that is how they seed.
    //
    // `newEtcClearedAt` is read because a null draft means two different things —
    // "never entered" and "deliberately emptied" — and this action both WRITES that
    // distinction (an explicit clear) and depends on it (the stale-write guard, so
    // an older page cannot restore a value somebody has just removed).
    select: { id: true, section: true, needsReview: true, newEtcDraft: true, newEtcClearedAt: true },
  });

  // `field` is the form-field name the posting client used, kept for the audit
  // metadata — it is the difference between "entry 50337 changed" and "this specific
  // input on this specific page changed", which is what a support question about a
  // save actually starts from. (The cellKey the notification carries is derived
  // canonically from the row instead, so it covers BOTH names a cell can have — see
  // keysFor below.)
  const changes: { entryId: number; from: number | null; to: number | null; field: string }[] = [];
  // Posted values this action refused to store because they are not numbers this
  // column accepts. Kept separate from `conflicts`: a conflict is somebody else's
  // edit, an invalid value is this user's own and only they can fix it.
  const invalidFields: { field: string; entryId: number | null; raw: string }[] = [];
  // Cells this save REFUSED because somebody else wrote them first — see the
  // stale-write guard below. Reported back so the client can say so and reload.
  // `field` is the posted form-field name, so the client can keep exactly those
  // cells dirty instead of re-baselining a value that was never written.
  const conflicts: { field: string; entryId: number; believedStored: string; actuallyStored: string; wanted: string }[] = [];
  const writes = [];
  for (const entry of entries) {
    // Already submitted (a reopened month's untouched entries) — Save only
    // ever writes drafts, never confirmed history.
    if (!entry.needsReview) continue;

    const field = `newEtcOverride__${entry.id}`;
    // ── What did this request actually say about this cell? ───────────────────
    //
    // Four answers, and they are all different (parseNewEtcField in lib/etc.ts):
    //
    //   absent  — not in the request. Either a department Columns filter hid the
    //             cell, or this user never touched it (the client posts only what
    //             it edited — changedEtcFormData). No opinion; leave it alone.
    //   clear   — present and empty. The user emptied the box, which is an EDIT and
    //             is persisted as one below. This is the bug fixed on 2026-08-04:
    //             an empty post used to be indistinguishable from "unchanged"
    //             whenever the stored draft was already null, so clearing a cell
    //             that showed a carried-forward or reopened figure wrote nothing at
    //             all and the value came straight back on the next reload.
    //   value   — a number, 0 included. "0" is a figure, not a blank.
    //   invalid — not a number this column takes. Refused and reported, never
    //             coerced to 0 and never quietly replaced by the previous value.
    const intent = parseNewEtcField(formData.get(field));
    if (intent.kind === "absent") continue;
    if (intent.kind === "invalid") {
      invalidFields.push({ field, entryId: entry.id, raw: intent.raw });
      continue; // one bad value must not abort the rest of the batch
    }

    const currentDraft = entry.newEtcDraft != null ? round2(Number(entry.newEtcDraft)) : null;
    const currentCleared = entry.newEtcClearedAt != null;

    // ── Stale-write guard (2026-08-04) ────────────────────────────────────────
    //
    // Optimistic concurrency, and the reason this bug cannot come back. The
    // client sends the value it believed was stored (`newEtcBase__<id>`) beside
    // the value it wants to write. If the stored draft has MOVED since, another
    // user saved this cell in between and this write would silently revert them.
    //
    // Refuse it. The client is told and reloads; the manager retypes against the
    // figure that is actually there. Losing one deliberate keystroke to a visible
    // conflict is categorically better than overwriting a colleague's saved work
    // without either of them knowing — which is what happened all morning.
    //
    // "" means "I believe nothing is stored". A stored draft of NULL is therefore
    // consistent with "", and only a real stored figure can conflict: this action
    // never touches `newEtc`, so a cell with no draft has nothing to clobber. The
    // exception is a DELIBERATE clear — a null that somebody wrote on purpose — and
    // `storedCleared` is what tells the guard the difference, so a page rendered
    // before the clear cannot put the removed figure back.
    //
    // Checked before the intent is applied, so it covers a CLEAR as well as a
    // value: two managers emptying the same cell is not a conflict (both want it
    // blank), but a manager emptying a cell whose figure has moved under them is —
    // they are removing a number that is no longer the one they were looking at.
    //
    // The client trims its payload to touched cells, which prevents almost all of
    // this on its own. This guard is what holds when the client is a tab left open
    // since before that change shipped, or a hand-posted request.
    const believed = formData.get(`newEtcBase__${entry.id}`);
    const believedStored = believed === null ? null : String(believed);
    if (
      isStaleDraftWrite({
        believedStored,
        storedDraft: currentDraft,
        storedCleared: currentCleared,
        // Same precision the cell seeds at, or a rounded hours seed would read as
        // a conflict against its own fractional stored value.
        precision: entry.section === PARTS_COST_SECTION ? "exact" : "whole",
      })
    ) {
      conflicts.push({
        field,
        entryId: entry.id,
        believedStored: believedStored ?? "",
        // Blank rather than the string "null": an empty cell is what the manager
        // will see, and this text goes into the change log verbatim.
        actuallyStored: currentDraft === null ? "" : String(currentDraft),
        wanted: intent.kind === "clear" ? "" : String(intent.value),
      });
      continue;
    }

    // ── A CLEAR is a write, not the absence of one ────────────────────────────
    //
    // Both fields move together and that is the whole fix. Nulling the draft alone
    // is not enough, because a null draft falls back through newEtcSeedText to the
    // confirmed value (a reopened month) or to the Prior ETC carry-forward (a cell
    // with no hours booked) — so the cleared figure reappeared on the next render.
    // newEtcClearedAt is what records "deliberately blank" as a state of its own,
    // and it is read by newEtcSeedText, by submitMonth's historical branch, and by
    // the stale-write guard above.
    //
    // Note what is NOT here: any condition on the draft having been non-null. The
    // cell was showing a figure — that is why the user emptied it and why the field
    // is in this payload — and whether that figure came from a draft, from last
    // submission or from the carry-forward is not something this action needs to
    // know to honour the clear.
    if (intent.kind === "clear") {
      // Already exactly what is being asked for: blank, and blank on purpose. Skip
      // the write and the audit noise rather than restamping the timestamp.
      if (currentDraft === null && currentCleared) continue;
      changes.push({
        entryId: entry.id,
        field,
        // What the manager actually removed. The stored draft when there was one,
        // otherwise the figure their page was displaying (the reopened or
        // carried-forward value they declared as their baseline) — so the audit row
        // and the notification can name it: "removed New ETC value 60 for 1165".
        from: currentDraft ?? believedNumberOrNull(believedStored),
        to: null,
      });
      writes.push(
        prisma.etcEntry.update({
          where: { id: entry.id },
          data: { newEtcDraft: null, newEtcClearedAt: new Date() },
        }),
      );
      continue;
    }

    const nextDraft = intent.value;
    // Unchanged — skip the write and the audit noise. `currentCleared` is part of
    // the comparison because the stored STATE includes it: re-entering the same
    // figure into a cleared cell has to un-clear it, or the box would keep seeding
    // blank against a draft that matches.
    if (nextDraft === currentDraft && !currentCleared) continue;

    changes.push({ entryId: entry.id, from: currentDraft, to: nextDraft, field });
    writes.push(
      prisma.etcEntry.update({
        where: { id: entry.id },
        data: {
          newEtcDraft: nextDraft,
          // Entering a value un-clears a cell that was deliberately blanked: the
          // manager has now answered it, so the marker is spent.
          newEtcClearedAt: null,
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
  // A row is created ONLY when a value is actually typed. An empty one is the
  // normal state of most of the grid — creating a row for each would add ~350 empty
  // entries a month, move nothing, and quietly widen what the month contains.
  //
  // But once a row DOES exist behind one of these cells, every intent applies to it
  // exactly as it would to any other cell — including a clear and including a 0.
  // The cell keeps posting under this field name until the page re-renders with the
  // new entry id, and that window is where "I cleared it, saved, and it came back"
  // used to live for these cells.
  const parsedCreates = parseNewEtcCreateFields(formData);
  // Same stale-write guard as above, for the cells that may have no row yet. A row
  // appearing between this user's page load and this save is exactly the case where
  // another user typed into the cell first, so it is the one remaining way one
  // manager could revert another.
  const existingForCreates =
    parsedCreates.length > 0
      ? await prisma.etcEntry.findMany({
          where: { month, OR: parsedCreates.map((c) => ({ jobId: c.jobId, section: c.section })) },
          select: { id: true, jobId: true, section: true, newEtcDraft: true, newEtcClearedAt: true, needsReview: true },
        })
      : [];
  const existingCreateByKey = new Map(existingForCreates.map((e) => [`${e.jobId}__${e.section}`, e]));
  // Rows this save BRINGS INTO EXISTENCE have no id yet, so their change-log rows
  // are resolved by job + section after the transaction. Without this the ~350
  // previously-unquoted cells were the one part of the grid whose edits were never
  // announced or recorded.
  const createdChanges: { jobId: number; section: string; to: number; field: string }[] = [];
  let createdCount = 0;

  for (const { jobId: jobPk, section, intent } of parsedCreates) {
    const key = `${jobPk}__${section}`;
    const field = `newEtcCreate__${key}`;
    if (intent.kind === "absent") continue; // unreachable — the field was in the payload
    const already = existingCreateByKey.get(key);
    if (intent.kind === "invalid") {
      invalidFields.push({ field, entryId: already?.id ?? null, raw: intent.raw });
      continue;
    }
    const believed = formData.get(`newEtcBase__${key}`);
    const believedStored = believed === null ? null : String(believed);

    if (!already) {
      // Nothing stored, so there is nothing to clear and nothing a 0 would say.
      if (intent.kind === "clear") continue;
      if (intent.value === 0) continue;
      // Prior ETC and Hours Worked are 0 by definition here: no prior estimate was
      // ever carried into this cell and no time has been booked to it this month.
      // needsReview stays true — this is a draft, exactly like any other unsubmitted
      // cell, and Submit is what confirms it.
      createdCount++;
      createdChanges.push({ jobId: jobPk, section, to: intent.value, field });
      writes.push(
        prisma.etcEntry.upsert({
          where: { jobId_section_month: { jobId: jobPk, section, month } },
          update: { newEtcDraft: intent.value, newEtcClearedAt: null },
          create: {
            jobId: jobPk,
            section,
            month,
            priorEtc: 0,
            hoursWorked: 0,
            hoursLeftCalc: 0,
            newEtc: 0,
            newEtcDraft: intent.value,
            needsReview: true,
          },
        }),
      );
      continue;
    }

    // A submitted row is confirmed history — never a draft target.
    if (!already.needsReview) continue;
    const storedDraft = already.newEtcDraft != null ? round2(Number(already.newEtcDraft)) : null;
    const storedCleared = already.newEtcClearedAt != null;
    // Create-cells are hours sections only (parseNewEtcCreateFields filters on
    // ETC_TRACKED_CODES, which excludes PARTS_COST), so whole precision is right.
    if (isStaleDraftWrite({ believedStored, storedDraft, storedCleared, precision: "whole" })) {
      conflicts.push({
        field,
        entryId: already.id,
        believedStored: believedStored ?? "",
        actuallyStored: storedDraft === null ? "" : String(storedDraft),
        wanted: intent.kind === "clear" ? "" : String(intent.value),
      });
      continue;
    }

    if (intent.kind === "clear") {
      if (storedDraft === null && storedCleared) continue;
      changes.push({
        entryId: already.id,
        field,
        from: storedDraft ?? believedNumberOrNull(believedStored),
        to: null,
      });
      writes.push(
        prisma.etcEntry.update({
          where: { id: already.id },
          data: { newEtcDraft: null, newEtcClearedAt: new Date() },
        }),
      );
      continue;
    }

    if (storedDraft === intent.value && !storedCleared) continue; // already what we would write
    changes.push({ entryId: already.id, from: storedDraft, to: intent.value, field });
    writes.push(
      prisma.etcEntry.update({
        where: { id: already.id },
        data: { newEtcDraft: intent.value, newEtcClearedAt: null },
      }),
    );
  }

  // Deliberate removals, counted separately from edits so the caller can say
  // "3 cleared" — a clear is the change a manager most wants confirmation of,
  // because there is nothing left on screen afterwards to prove it happened.
  const clearedCount = changes.filter((c) => c.to === null).length;

  if (writes.length > 0 || conflicts.length > 0 || invalidFields.length > 0) {
    if (writes.length > 0) await prisma.$transaction(writes);

    // ── Per-cell change history + the live notification (2026-08-04) ──────────
    //
    // One record per cell, with the row and column a human would name, so a change
    // is queryable ("every change to New ETC on job 1148") and announceable ("John
    // changed New ETC from 120 to 110 for 1148 in Monthly ETC"). See lib/change-log.ts.
    //
    // Read AFTER the writes so the job number and section are resolved from the
    // rows that actually exist, and outside the transaction so a slow audit write
    // cannot hold locks on the grid.
    const changedIds = changes.map((c) => c.entryId);
    if (changedIds.length > 0 || conflicts.length > 0 || createdChanges.length > 0) {
      const rows = await prisma.etcEntry.findMany({
        where: {
          OR: [
            { id: { in: [...changedIds, ...conflicts.map((c) => c.entryId)] } },
            // Rows this save just created: their ids did not exist a moment ago, so
            // they are found by the only key that did.
            ...(createdChanges.length > 0
              ? [{ month, OR: createdChanges.map((c) => ({ jobId: c.jobId, section: c.section })) }]
              : []),
          ],
        },
        select: { id: true, jobId: true, section: true, job: { select: { jobId: true } } },
      });
      const rowById = new Map(rows.map((r) => [r.id, r]));
      const rowByJobSection = new Map(rows.map((r) => [`${r.jobId}__${r.section}`, r]));
      const columnFor = (section: string) =>
        section === PARTS_COST_SECTION
          ? "Parts Cost New ETC"
          : `New ETC (${SECTIONS.find((s) => s.code === section)?.name ?? section})`;
      const asText = (v: number | null) => (v === null ? null : String(v));
      // ── Both names this cell can be addressed by ──────────────────────────
      //
      // A New ETC cell posts under its entry id once a row exists, and under
      // job+section before that. Two browsers can legitimately be holding
      // different ones for the SAME cell, depending on whether the row existed
      // when each page last rendered — so a change announces both, and a receiving
      // cell recognises whichever is its own. Without this the incremental update
      // would silently miss the ~half of the grid that is unquoted sections, and
      // those tabs would fall back to a full refetch.
      const keysFor = (entryId: number, jobPk: number, section: string) => ({
        cellKey: `newEtcOverride__${entryId}`,
        altCellKey: `newEtcCreate__${jobPk}__${section}`,
      });

      const cellChanges: CellChange[] = [];
      for (const c of changes) {
        const row = rowById.get(c.entryId);
        if (!row) continue;
        cellChanges.push({
          tab: "Monthly ETC",
          rowRef: row.job.jobId,
          columnName: columnFor(row.section),
          previousValue: asText(c.from),
          newValue: asText(c.to),
          // The three verbs the notification banner distinguishes. A draft going to
          // null is a REMOVAL, not an edit to nothing.
          changeType: c.from === null ? "added" : c.to === null ? "removed" : "edited",
          entityType: "EtcEntry",
          entityId: c.entryId,
          ...keysFor(c.entryId, row.jobId, row.section),
        });
      }
      // Cells whose row this save created. Always an "added" — there was no row, so
      // there was nothing there before by definition.
      for (const c of createdChanges) {
        const row = rowByJobSection.get(`${c.jobId}__${c.section}`);
        if (!row) continue;
        cellChanges.push({
          tab: "Monthly ETC",
          rowRef: row.job.jobId,
          columnName: columnFor(row.section),
          previousValue: null,
          newValue: String(c.to),
          changeType: "added",
          entityType: "EtcEntry",
          entityId: row.id,
          ...keysFor(row.id, row.jobId, row.section),
        });
      }
      // A refused write is recorded too — spec 6 asks for rejected updates to be
      // captured, and this is the one event where two people wanted the same cell.
      for (const c of conflicts) {
        const row = rowById.get(c.entryId);
        if (!row) continue;
        cellChanges.push({
          tab: "Monthly ETC",
          rowRef: row.job.jobId,
          columnName: columnFor(row.section),
          previousValue: c.wanted,
          newValue: c.actuallyStored,
          changeType: "rejected",
          entityType: "EtcEntry",
          entityId: c.entryId,
          // Addressed like any other change: `actuallyStored` IS the current stored
          // value, so a browser that has this cell clean can take it and skip the
          // refetch. The user whose write was refused is not affected — their cell is
          // dirty by definition, so it keeps their value (and their own client asks
          // for a full refresh anyway, which is what a conflict deserves).
          ...keysFor(c.entryId, row.jobId, row.section),
        });
      }
      await recordChanges(cellChanges, { action: "etc.saveAllNewEtcDrafts" });
    }

    await logAudit({
      action: "etc.saveAllNewEtcDrafts",
      entityType: "EtcEntry",
      entityId: month,
      summary:
        `Batch-saved ${changes.length} New ETC draft(s) for ${month}` +
        // Named separately from the edits: "cleared 3" is the thing a manager comes
        // to this log looking for when a figure has gone.
        (clearedCount > 0 ? ` (${clearedCount} cleared)` : "") +
        (createdCount > 0 ? `, creating ${createdCount} entry(ies) for previously unquoted sections` : "") +
        // Logged, not swallowed: a refused write is the one event where two people
        // were editing the same cell, and that is worth being able to look up.
        (conflicts.length > 0 ? ` — REFUSED ${conflicts.length} stale write(s) already changed by another user` : "") +
        (invalidFields.length > 0 ? ` — REJECTED ${invalidFields.length} invalid value(s)` : ""),
      metadata: { changes, created: createdChanges, conflicts, invalid: invalidFields },
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
  // FormData (rebaselineEtcFields, called by EtcAutosave),
  // and every derived figure now recomputes live (lib/etc-live-totals.ts).
  //
  // The paths that DO change what the server would render still revalidate:
  // the monthly report submission, startMonth, reopenMonth, the sync steps, and the
  // wrong-password branch above.
  //
  // Worth recording, since it was the leading theory when the multi-user bug was
  // reported: adding revalidatePath back here would NOT have made another user's
  // page fresh. Every route in this app is dynamically rendered — the (app) layout
  // awaits auth() — and nothing uses a Next server-side cache, so revalidatePath
  // has nothing to invalidate for anybody. Its only effect is to make THIS
  // action's response carry a fresh render for the caller. Cross-user freshness
  // comes from LiveRefresh (components/LiveRefresh.tsx) instead.
  return {
    ok: true,
    saved: writes.length,
    cleared: clearedCount,
    conflicts: conflicts.length,
    conflictFields: conflicts.map((c) => c.field),
    invalidFields: invalidFields.map((f) => f.field),
  };
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
  if (!matchesButtonPassword(submittedPassword, "submit")) {
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
// (assertCurrentEtcMonth lived here: it kept the month-only "Run Report" off any month
// but the current one, after a live sync corrupted two archived months in 2026-07. The
// button is gone (§25) and the scheduled pass resolves its own month — the latest OPEN
// one, never a locked or historical month — so the guard has nothing left to guard.
// lib/etc.ts's isSafeForLiveEtcSync still states the rule for anything that needs it.)


// ── syncPowerBiForEtc is GONE (§25.1, 2026-08-04) ───────────────────────────
//
// It backed the "Refresh Data (this month)" option in the Sync Data dropdown: it seeded
// the month, then pulled hours and parts for THAT month only. Two problems, and the
// second is why the whole dropdown went:
//
//   * It refreshed a SUBSET. Every other feed — the TotalETO job mirror, the Standard
//     Fees pools, the Scheduler roster — kept aging beside the part it updated, which is
//     where "which of these numbers is current?" comes from.
//   * It was password-gated, for a read-only pull from upstream systems, with the
//     password shipped to the browser to be checked there.
//
// One button now runs the whole pass (lib/refresh-service.ts). The one thing this had
// that runAllSyncs does not — seedMonth, i.e. STARTING a month — moved into that service
// and still runs on a manual refresh only.


// ── syncEtcHistory is GONE from the interface (§25.1/§25.11, 2026-08-04) ─────
//
// It backed the "Sync History" option in the Sync Data dropdown: a password box that
// rewrote HISTORICAL ETC months from Power BI's archive. That is the single most
// consequential write in the app — reopening plus a sync is the one corruption this
// codebase has actually suffered and repaired (DEVLOG §10) — and it does not belong two
// clicks from a grid, next to a routine data pull.
//
// The capability is unchanged and still available deliberately, from the command line:
//
//     npx tsx scripts/backfill-etc-history.ts
//
// which calls the same lib/sync-etc-history.ts and writes the same audit row. §25.11
// asks only that refresh ACTIVITY stay in the audit log, which it does.


