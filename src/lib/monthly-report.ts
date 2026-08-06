import { prisma } from "@/lib/prisma";
import { APP_VERSION } from "@/lib/app-version";
import { createHash, randomUUID } from "crypto";
import { calcHoursLeft, isMonthLocked, isValidMonth, newEtcSeedText, round2, suggestNewEtc, type NewEtcCellState } from "@/lib/etc";
import { PARTS_COST_SECTION, SECTIONS } from "@/lib/sections";
import { getEtcMonthJobWhere } from "@/lib/etc-month-jobs";
import { getExecutionEtcByJob, isInStandardFeesAllocation } from "@/lib/execution-etc";
import { loadEffectivePools } from "@/lib/standard-sheet-actions";
import {
  calcTotalEtcDollars,
  calcPercentOfTotal,
  calcStandardFeeEngineering,
  calcStandardFeeShop,
  calcTotalStandardFees,
} from "@/lib/standard-fees";

// ── ONE monthly submission ──────────────────────────────────────────────────
//
// Until 2026-08-04 the month was finalised by TWO independent buttons: "Submit ETC"
// (froze EtcEntry) and "Submit Standard Sheet" (froze StandardSheetSnapshot). Nothing
// tied them together, so the normal state of a month was half-submitted — July 2026
// was exactly that when somebody asked why there were two buttons. The ETC figures
// could be locked while the fees derived FROM them were still live and moving, which
// makes "what did we sign off for July" a question with two answers.
//
// This module is the one answer. `Submit {Month} Report` validates the whole package,
// writes every section inside ONE transaction, and records what it did.
//
// Three properties it exists to guarantee:
//   * ATOMIC — every section or none. A failure anywhere leaves the month exactly as
//     it was, rather than ETC-locked-but-fees-open.
//   * VALIDATED FIRST, in detail. "Submission failed" is not an acceptable answer to
//     a manager with 450 cells; every issue names the section, the job, the
//     department and the column, and says what is wrong with it.
//   * IDEMPOTENT. The client generates a submission id; a retry (or a double-click
//     that beat the disabled state) carries the same id and returns the first
//     result instead of submitting twice.
//
// The whole package is read from the DATABASE, never from the posted form. That is
// the other half of the fix: the old path read ~450 `hoursWorked__<id>` fields out of
// the DOM, so a stale tab could freeze its own snapshot over colleagues' saved work,
// and a Columns filter — which removes those inputs — made the month unsubmittable.
// Autosave already persists every edit (DEVLOG §16/§17), so the freshest truth is in
// MySQL and that is what gets frozen.

// The validation TYPES live in lib/monthly-report-flow.ts, not here. They cross the
// server/client boundary in both directions — the readiness line in the Standard Fees
// card is computed from them (§26.4) and so is the dialog's blocked list — and that
// module is dependency-free, so a client component importing them cannot drag Prisma
// into the browser bundle. Re-exported so every existing importer is unaffected.
export type { ReportSection, ValidationIssue, MonthlyReportValidation } from "@/lib/monthly-report-flow";
import type { ReportSection, ValidationIssue, MonthlyReportValidation } from "@/lib/monthly-report-flow";
import { MAX_REPORTED_ISSUES } from "@/lib/monthly-report-flow";
import { departmentIssues } from "@/lib/etc-departments";
import { readIncompleteDepartments } from "@/lib/etc-department-status";

const sectionLabel = (code: string) =>
  code === PARTS_COST_SECTION ? "Parts Cost" : (SECTIONS.find((s) => s.code === code)?.name ?? code);

// ── Validation ──────────────────────────────────────────────────────────────
//
// Reads only. Safe to call from a render (the button asks for it before enabling
// itself) and called again inside the submission for real.
export async function validateMonthlyReport(month: string): Promise<MonthlyReportValidation> {
  const empty: MonthlyReportValidation = {
    ok: false,
    issues: [],
    totalIssues: 0,
    sections: [],
    counts: { entries: 0, jobs: 0, missingNewEtc: 0, standardJobs: 0 },
    incompleteDepartments: [],
  };
  if (!isValidMonth(month)) {
    return { ...empty, issues: [{ section: "Monthly ETC", rowRef: month, reason: `"${month}" is not a valid month.` }], totalIssues: 1 };
  }

  const issues: ValidationIssue[] = [];
  const entries = await prisma.etcEntry.findMany({
    where: { month },
    select: {
      id: true, section: true, priorEtc: true, hoursWorked: true, newEtc: true, newEtcDraft: true,
      newEtcClearedAt: true, needsReview: true, submittedAt: true,
      job: { select: { id: true, jobId: true, jobName: true } },
    },
  });

  if (entries.length === 0) {
    return {
      ...empty,
      issues: [{ section: "Monthly ETC", rowRef: month, reason: `${month} has not been started — run "Refresh Data" for it first.` }],
      totalIssues: 1,
    };
  }
  if (isMonthLocked(entries)) {
    return {
      ...empty,
      issues: [{ section: "Monthly ETC", rowRef: month, reason: `${month} is already submitted and locked. Reopen it first if a correction is needed.` }],
      totalIssues: 1,
    };
  }

  // ── The manager-entered New ETC values the month is waiting on ────────────
  //
  // "Required" is exactly what the grid paints yellow: hours (or money) were booked
  // to this cell this month, so the next figure is a judgement call, and the box is
  // empty. The rule comes from lib/etc.ts so the checklist on screen and the thing
  // blocking submission can never be two different sets — a manager who has cleared
  // every yellow cell must be able to submit, and one who has not must be told
  // precisely which cells are left.
  //
  // A DELIBERATELY cleared cell counts as missing too. It is blank and hours were
  // booked; "I removed the old number" is not the same as "I have decided", and the
  // reason says so rather than pretending the cell was never touched.
  let missingNewEtc = 0;
  for (const e of entries) {
    if (!e.needsReview) continue; // already confirmed (a partially-submitted month)
    const worked = round2(Number(e.hoursWorked));
    const state: NewEtcCellState = {
      priorEtc: Number(e.priorEtc),
      hoursWorked: worked,
      draft: e.newEtcDraft != null ? Number(e.newEtcDraft) : null,
      confirmed: e.submittedAt != null ? round2(Number(e.newEtc)) : null,
      cleared: e.newEtcClearedAt != null,
      locked: false,
      monthComplete: true,
      precision: e.section === PARTS_COST_SECTION ? "exact" : "whole",
    };
    // Same expression the cell uses for its background: blank + a decision required.
    if (worked === 0) continue;
    if (newEtcSeedText(state).trim() !== "") continue;
    missingNewEtc++;
    if (issues.length < MAX_REPORTED_ISSUES) {
      issues.push({
        section: "Monthly ETC",
        rowRef: `${e.job.jobId} — ${e.job.jobName}`,
        department: sectionLabel(e.section),
        column: "New ETC",
        reason:
          e.newEtcClearedAt != null
            ? `Cleared and not re-entered. ${e.section === PARTS_COST_SECTION ? "Money was spent" : "Hours were booked"} here this month, so a New ETC figure is required.`
            : `No New ETC entered. ${e.section === PARTS_COST_SECTION ? `$${Math.round(Number(e.hoursWorked)).toLocaleString()} was spent` : `${Math.round(worked)} hours were booked`} here this month, so a figure is required.`,
      });
    }
  }

  // Hours can never be negative; PARTS_COST stores MONEY in the same column and
  // genuinely can (a credit note, a returned part) — the same asymmetry submitMonth
  // has always had, which is why 2026-06 was once unsubmittable over one credit.
  for (const e of entries) {
    const value = Number(e.hoursWorked);
    if (!Number.isFinite(value) || (value < 0 && e.section !== PARTS_COST_SECTION)) {
      if (issues.length < MAX_REPORTED_ISSUES) {
        issues.push({
          section: "Monthly ETC",
          rowRef: `${e.job.jobId} — ${e.job.jobName}`,
          department: sectionLabel(e.section),
          column: "Hours Worked Month",
          reason: `Stored Hours Worked is "${String(e.hoursWorked)}", which is not a valid number of hours. Run "Refresh Data" to re-pull it.`,
        });
      }
    }
  }

  // ── Standard Sheet / Standard Card ────────────────────────────────────────
  //
  // The fees are computed from this month's pools, so a month whose pools were never
  // refreshed would freeze LAST month's balances as if they were this month's — the
  // check the old Standard-Sheet submission already made, now stated as a validation issue on
  // the one submission instead of an exception from a second button.
  const jobsForStandard = (
    await prisma.job.findMany({
      where: (await getEtcMonthJobWhere(month)).where,
      select: { id: true, executionRate: true, billable: true, excludedFromStandardFees: true },
    })
  ).filter(isInStandardFeesAllocation);
  const pools = await loadEffectivePools(month);
  if (pools.pools.length === 0) {
    issues.push({
      section: "Standard Card",
      rowRef: month,
      column: "Department pools",
      // Named for the ONE refresh control (§26.11): the Standard Fees panel's own
      // "Refresh" button was removed because the application-wide "Refresh Data" runs
      // the identical pool computation (auto-sync.ts's standard_pools step). Telling a
      // manager to click a button that no longer exists is worse than not telling them.
      reason: `No department pools exist for ${month}. Click "Refresh Data" in the toolbar before submitting.`,
    });
  } else if (pools.carriedFrom) {
    issues.push({
      section: "Standard Card",
      rowRef: month,
      column: "Department pools",
      reason: `The pools on screen are ${pools.carriedFrom}'s, shown as an estimate because ${month} was never refreshed. Click "Refresh Data" in the toolbar so the submission freezes ${month}'s real balances.`,
    });
  }

  // ── Department sign-off (§50) ─────────────────────────────────────────────
  //
  // Six checkboxes above the KPI card; the month cannot be submitted until all six are
  // ticked. Added as real validation issues so the confirmation dialog's blocked list
  // shows them beside the missing cells rather than in a second place with its own rules.
  //
  // §50 is explicit that this is an ADDITIONAL gate, not a substitute: "do not treat the
  // checkbox alone as proof that all cells are valid. Continue validating required ETC
  // cells, formulas, pending saves, and conflicts." Nothing above this line changed — a
  // month with all six ticked and a missing New ETC is still refused, by the same rule
  // it always was.
  //
  // Two lines, and both halves are tested without a database: readIncompleteDepartments
  // over the real table, and departmentIssues as a pure function. This function itself
  // can only run inside Next, so keeping the judgement out of it is what makes the
  // judgement checkable.
  const incompleteDepartments = await readIncompleteDepartments(month);
  issues.push(...departmentIssues(month, incompleteDepartments));

  const totalIssues =
    missingNewEtc +
    issues.filter((i) => i.column !== "New ETC").length;

  return {
    ok: issues.length === 0,
    issues,
    totalIssues,
    sections: ["Monthly ETC", "Standard Sheet", "Standard Card"],
    counts: {
      entries: entries.length,
      jobs: new Set(entries.map((e) => e.job.id)).size,
      missingNewEtc,
      standardJobs: jobsForStandard.length,
    },
    // Carried out separately as well as being issues, because `issues` is capped at
    // MAX_REPORTED_ISSUES — see the note on the field. The readiness line names these
    // even on a month with 200 unfilled cells.
    incompleteDepartments,
  };
}

// ── "Has anything moved since the dialog opened?" (§26.6, §26.13) ───────────
//
// The confirmation dialog can sit open indefinitely, and this app is genuinely
// multi-user — a colleague's autosave, a Refresh Data pass, or an ETC Rates change
// can all land underneath it. Freezing the month against figures the user last saw
// ten minutes ago is exactly the "stale confirmation submits outdated data" failure
// §26.16 #16 forbids.
//
// So the readiness check hands the browser a fingerprint of the month, and the
// browser hands it back when the user confirms. A different fingerprint stops the
// submission and asks them to look again.
//
// Deliberately ONE aggregate query, not a read of 450 rows: this runs on every
// realtime change event, for every tab with the panel open. The weighted sums
// (`id * value`) are what make two offsetting edits in different rows — one cell
// +5, another −5 — change the digest, which plain SUMs would not.
//
// It is a courtesy check, not the safety property. What actually makes a stale
// submission impossible is that submitMonthlyReport re-validates and re-reads the
// month inside its own transaction, and submitEtcEntriesInTx refuses a month that
// is already locked. This just turns "your submission was refused" into "look at
// this first".
export async function monthDataFingerprint(month: string): Promise<string | null> {
  if (!isValidMonth(month)) return null;
  try {
    const [etc] = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) AS n,
             COALESCE(SUM(id * hoursWorked), 0)  AS hw,
             COALESCE(SUM(id * priorEtc), 0)     AS pe,
             COALESCE(SUM(id * newEtc), 0)       AS ne,
             COALESCE(SUM(id * COALESCE(newEtcDraft, -1)), 0) AS nd,
             COALESCE(SUM(CASE WHEN needsReview THEN id ELSE 0 END), 0)          AS nr,
             COALESCE(SUM(CASE WHEN newEtcClearedAt IS NULL THEN 0 ELSE id END), 0) AS cl
      FROM EtcEntry WHERE month = ${month}`;
    const [pool] = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) AS n,
             COALESCE(SUM(id * hoursPulledThisMonth), 0) AS hp,
             COALESCE(SUM(id * hoursAvailable), 0)       AS ha,
             COALESCE(SUM(id * hoursWorkedThisMonth), 0) AS hw,
             COALESCE(SUM(id * rate), 0)                 AS rt,
             COALESCE(SUM(id * standardFee), 0)          AS sf
      FROM CategoryPool WHERE month = ${month}`;
    // The global rates multiply every fee row, so a change to them changes what the
    // submission would freeze without touching a single ETC or pool row.
    const setting = await prisma.standardSheetSetting.findUnique({ where: { id: 1 } });
    // A frozen month must fingerprint differently from the same month unfrozen.
    const [snap] = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) AS n FROM StandardSheetSnapshot WHERE month = ${month}`;

    const parts = [
      month,
      ...Object.values(etc ?? {}).map(String),
      ...Object.values(pool ?? {}).map(String),
      ...Object.values(snap ?? {}).map(String),
      String(setting?.engrRate ?? ""),
      String(setting?.shopRate ?? ""),
      String(setting?.partsMarkup ?? ""),
      String(setting?.contingencyRate ?? ""),
    ];
    return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
  } catch (err) {
    // Unreadable is NOT "unchanged". Returning null makes isMonthDataStale() treat
    // the confirmation as stale, which costs a click; pretending it matched would
    // cost a wrong submission.
    console.error("[monthly-report] could not fingerprint", month, err);
    return null;
  }
}

// ── The submission record ───────────────────────────────────────────────────
//
// Raw SQL rather than the generated Prisma client, for the same reason lib/change-log.ts
// writes its audit rows that way: `prisma generate` cannot run while a server process
// holds node_modules/.prisma open (EPERM), so a new model would otherwise block on a
// deploy window. The table is in schema.prisma and has a migration; only the ACCESS is
// raw. Values go through Prisma's tagged template, which parameterises them.
export type SubmissionStatus = "submitted" | "failed";

export type SubmissionRecord = {
  submissionId: string;
  month: string;
  year: number;
  status: SubmissionStatus;
  userName: string;
  at: string;
  sections: ReportSection[];
  failureReason: string | null;
};

function toRecord(r: Record<string, unknown>): SubmissionRecord {
  return {
    submissionId: String(r.submissionId),
    month: String(r.month),
    year: Number(r.year),
    status: String(r.status) as SubmissionStatus,
    userName: String(r.userName ?? ""),
    at: ((r.completedAt as Date | null) ?? (r.createdAt as Date)).toISOString(),
    sections: JSON.parse(String(r.sections ?? "[]")) as ReportSection[],
    failureReason: r.failureReason == null ? null : String(r.failureReason),
  };
}

const SUBMISSION_COLUMNS = `submissionId, month, year, status, userName, createdAt, completedAt, sections, failureReason`;

export async function readSubmission(submissionId: string): Promise<SubmissionRecord | null> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${SUBMISSION_COLUMNS} FROM MonthlyReportSubmission WHERE submissionId = ? LIMIT 1`,
    submissionId,
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

// The submission this month is CURRENTLY frozen under, if any. Two callers, both §26:
//
//   * the Standard Fees card, so a frozen month shows the receipt — who submitted
//     it, when, and under which id — instead of a dead button (§26.8);
//   * the submission itself, so a month somebody else finalised while this dialog
//     was open fails as "already submitted" with their name on it, rather than as
//     an opaque transaction error (§26.6, §26.13).
//
// The lock check is the load-bearing half. A REOPENED month still has its old
// `status = 'submitted'` row — that row is history and must stay — so keying off the
// record alone would refuse every correction the reopen exists to allow, which is
// precisely the workflow DEVLOG §13 was about. What makes a month closed is that its
// entries are frozen; the record only says who closed it.
export async function readLatestSubmissionForMonth(month: string): Promise<SubmissionRecord | null> {
  if (!isValidMonth(month)) return null;
  const entries = await prisma.etcEntry.findMany({ where: { month }, select: { needsReview: true } });
  if (entries.length === 0 || !isMonthLocked(entries)) return null;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${SUBMISSION_COLUMNS} FROM MonthlyReportSubmission
      WHERE month = ? AND status = 'submitted' ORDER BY id DESC LIMIT 1`,
    month,
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function recordSubmission(input: {
  submissionId: string;
  month: string;
  userId: number | null;
  userName: string;
  status: SubmissionStatus;
  sections: ReportSection[];
  validation: MonthlyReportValidation;
  failureReason: string | null;
  // The three moments §26.15 asks to be recorded. `confirmedAt` comes from the
  // browser — it is when the user pressed "Yes, Submit Report", which is the only
  // clock that can answer "how long did they sit on the dialog"; the other two are
  // measured here. All nullable, because a record written before the columns
  // existed (or by a caller that does not time itself) is still a valid record.
  confirmedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}): Promise<void> {
  const [year, monthNumber] = input.month.split("-").map(Number);
  // The validation result is stored WITH the attempt, successful or not: "why was
  // this refused at 4pm" is the question the record exists to answer, and it cannot
  // be reconstructed later once the data has moved on.
  const validation = JSON.stringify({
    ok: input.validation.ok,
    totalIssues: input.validation.totalIssues,
    counts: input.validation.counts,
    issues: input.validation.issues.slice(0, MAX_REPORTED_ISSUES),
  });
  // A retried attempt carries the SAME submissionId, which is UNIQUE — that is what
  // makes the retry idempotent. Its record has to be updated rather than inserted, or
  // the second attempt would die on a duplicate-key error before it did any work.
  await prisma.$executeRaw`
    INSERT INTO MonthlyReportSubmission
      (submissionId, month, year, monthNumber, userId, userName, status, appVersion, sections, validation,
       failureReason, confirmedAt, startedAt, completedAt, createdAt)
    VALUES
      (${input.submissionId}, ${input.month}, ${year}, ${monthNumber}, ${input.userId}, ${input.userName},
       ${input.status}, ${APP_VERSION}, ${JSON.stringify(input.sections)}, ${validation}, ${input.failureReason},
       ${input.confirmedAt ?? null}, ${input.startedAt ?? null}, ${input.completedAt ?? null}, NOW())
    ON DUPLICATE KEY UPDATE
      status = VALUES(status), validation = VALUES(validation), failureReason = VALUES(failureReason),
      appVersion = VALUES(appVersion), sections = VALUES(sections), userId = VALUES(userId),
      userName = VALUES(userName), confirmedAt = VALUES(confirmedAt), startedAt = VALUES(startedAt),
      completedAt = VALUES(completedAt)`;
}

export function newSubmissionId(): string {
  return randomUUID();
}

// ── The writes, both sections, one transaction ───────────────────────────────
//
// Split out of the action so the transaction body is readable and so each section's
// rules stay where they were rather than being reinvented inline.

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// EtcEntry: freeze Hours Worked + New ETC for every entry the month contains.
//
// Reads the month INSIDE the transaction, and takes the New ETC from the stored draft
// (falling back to the suggestion for a cell with no draft — the documented rule for
// an unplanned section, unchanged). A cell that was already confirmed keeps its value:
// that is what makes a partially-submitted month finish correctly rather than being
// recomputed from scratch.
export async function submitEtcEntriesInTx(tx: Tx, month: string, userId: number | null): Promise<number> {
  const entries = await tx.etcEntry.findMany({ where: { month } });
  if (entries.length === 0) throw new Error(`${month} has no entries to submit.`);
  if (isMonthLocked(entries)) throw new Error(`${month} is already submitted and locked.`);

  let written = 0;
  for (const entry of entries) {
    const priorEtc = Number(entry.priorEtc);
    const hoursWorked = Number(entry.hoursWorked);
    // An already-confirmed row is history; leave it exactly as it is.
    if (!entry.needsReview) continue;
    const draft = entry.newEtcDraft != null ? round2(Number(entry.newEtcDraft)) : null;
    const newEtc = draft ?? round2(suggestNewEtc(priorEtc, hoursWorked));
    await tx.etcEntry.update({
      where: { id: entry.id },
      data: {
        hoursLeftCalc: round2(calcHoursLeft(priorEtc, hoursWorked)),
        newEtc,
        newEtcDraft: null, // consumed by the submission
        // The "deliberately blank" marker is spent: this cell now HAS a confirmed
        // value, so a later reopen should seed from it like any other.
        newEtcClearedAt: null,
        needsReview: false,
        submittedAt: new Date(),
        ...(userId ? { enteredById: userId } : {}),
      },
    });
    written++;
  }
  return written;
}

// StandardSheetSnapshot: freeze each job's fee row, computed exactly as the live
// Standard view computes it. Reads happen before the transaction (they are pure
// reads); only the delete+create pair is inside it.
export async function loadStandardSheetRows(month: string) {
  const jobs = (
    await prisma.job.findMany({
      where: (await getEtcMonthJobWhere(month)).where,
      select: { id: true, executionRate: true, billable: true, excludedFromStandardFees: true },
    })
  ).filter(isInStandardFeesAllocation);

  const [etcByJob, effective, setting] = await Promise.all([
    getExecutionEtcByJob(jobs.map((j) => j.id), month),
    loadEffectivePools(month),
    prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
  ]);
  if (effective.carriedFrom) {
    // Validation already refuses this; the guard stays because this function is the
    // thing that would silently freeze the wrong month's balances.
    throw new Error(`${month}'s department pools were never refreshed — refresh them before submitting.`);
  }
  const rate = {
    engrRate: setting ? Number(setting.engrRate) : 170,
    shopRate: setting ? Number(setting.shopRate) : 140,
    partsMarkup: setting ? Number(setting.partsMarkup) : 1.2,
  };
  const contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;
  const poolTotals = {
    engineeringPM: Number(effective.pools.find((p) => p.category === "ENGINEERING_PM")?.standardFee ?? 0),
    engineeringWarranty: Number(effective.pools.find((p) => p.category === "ENGINEERING_WARRANTY")?.standardFee ?? 0),
    shopManufacturing: Number(effective.pools.find((p) => p.category === "SHOP_MANUFACTURING")?.standardFee ?? 0),
    shopWarranty: Number(effective.pools.find((p) => p.category === "SHOP_WARRANTY")?.standardFee ?? 0),
  };
  const rows = jobs.map((job) => {
    const etc = etcByJob.get(job.id) ?? { engineering: 0, shop: 0, parts: 0 };
    return { job, etc, totalEtcDollars: calcTotalEtcDollars(etc, rate) };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.totalEtcDollars, 0);

  return rows.map(({ job, etc, totalEtcDollars }) => {
    const percentOfTotal = calcPercentOfTotal(totalEtcDollars, grandTotal);
    const standardFeeEngineering = calcStandardFeeEngineering(percentOfTotal, poolTotals);
    const standardFeeShop = calcStandardFeeShop(percentOfTotal, poolTotals);
    const contingencyAmount = job.executionRate ? Number(job.executionRate.contingencyAmount) : 0;
    return {
      jobId: job.id,
      month,
      engrRate: rate.engrRate,
      shopRate: rate.shopRate,
      partsMarkup: rate.partsMarkup,
      etcEngineering: etc.engineering,
      etcShop: etc.shop,
      etcParts: etc.parts,
      totalEtcDollars,
      percentOfTotal,
      standardFeeEngineering,
      standardFeeShop,
      contingencyAmount,
      contingencyRate,
      totalStandardFees: calcTotalStandardFees(totalEtcDollars, standardFeeEngineering, standardFeeShop, contingencyAmount, contingencyRate),
      notes: job.executionRate?.notes ?? null,
    };
  });
}
