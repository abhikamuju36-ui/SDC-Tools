import "server-only";

// THE app's refresh schedule. Every value that needs periodic refreshing comes
// through here, on one interval, in one pass — so "how current is this number?"
// has a single answer instead of one per feed.
//
// Before this, the loop in instrumentation.ts refreshed hours and parts while the
// TotalETO job mirror and the Scheduler roster only moved when someone happened
// to press their button, which meant two ages of data on one screen and no way to
// tell which was which.
//
// ── Three rules this file exists to enforce ─────────────────────────────────
//
// 1. ONE MONTH PER PASS. The month-scoped steps are all given the same month,
//    resolved once at the top. Resolving it per step let a month roll over or get
//    locked mid-pass, leaving hours from one month beside parts from another.
//
// 2. FAILURES ARE ISOLATED. Each step gets its own try/catch. The old loop wrapped
//    hours-worked and parts in ONE try, so a hours failure silently skipped the
//    parts sync that had nothing to do with it — and parts then aged behind a
//    header reporting the hours failure only.
//
// 3. EVERY STEP STAMPS ITS OWN FRESHNESS ROW, success or failure. A step that
//    can't say when it last worked is a step whose staleness is invisible, which
//    is exactly how ~280 hours went missing for a week (DEVLOG §12).
//
// ── What is deliberately NOT on the schedule ───────────────────────────────
//
// • The ETC history and category-pool backfills. They write HISTORICAL months,
//   and unattended writes to frozen history are the one failure this app has
//   already suffered and repaired once (DEVLOG §10: a reopen plus a sync
//   corrupted archived months). They stay manual, behind a deliberate click.
// • syncQuotedFromPowerBi. Quoted hours are app-owned now — entered on the
//   Projects tab — so a periodic pull would fight the managers editing them.
// • Any locked month. A submitted month is frozen by definition; see
//   isMonthLocked. Doing nothing there is correct, and this file does NOT stamp
//   freshness for a step it skipped for that reason: claiming currency because a
//   month is frozen would be a lie by omission.

export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Every source this pass refreshes, in the order it runs them. Declared once and
// read by BOTH the runner below and the dashboard's Data Sync card, so a source
// can never be refreshed without being listed, or listed without being
// refreshed — which is how the TotalETO mirror came to be button-only while
// appearing beside feeds that were on a schedule.
//
// `monthScoped` marks the steps that only touch the latest open ETC month, since
// "last refreshed" means something different for those: they are deliberately
// idle while the month is locked.
export const SYNC_SOURCES = [
  { source: "hours_actual", label: "Actual hours (Paylocity export)", monthScoped: false },
  { source: "etc_hours_worked", label: "ETC hours worked", monthScoped: true },
  { source: "parts_cost", label: "Parts cost (TotalETO)", monthScoped: true },
  // Same wording as the dashboard's long-standing "Jobs from TotalETO" button,
  // which triggers this exact sync. Two names for one feed is precisely the
  // confusion this list exists to prevent.
  { source: "totaleto_jobs", label: "Jobs from TotalETO", monthScoped: false },
  { source: "scheduler_team", label: "Employee grouping (Scheduler)", monthScoped: false },
] as const;

function labelFor(source: string): string {
  return SYNC_SOURCES.find((s) => s.source === source)?.label ?? source;
}

export type SyncTrigger = "startup" | "interval" | "manual";

export type SyncStepResult = {
  // Matches the PowerBiFreshness.source row this step owns.
  source: string;
  label: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
};

export type SyncRunResult = {
  trigger: SyncTrigger;
  startedAt: Date;
  ms: number;
  month: string | null;
  steps: SyncStepResult[];
};

export async function runAllSyncs(trigger: SyncTrigger): Promise<SyncRunResult> {
  // Imported lazily, inside the function: this module is loaded from
  // instrumentation.ts, which also runs under the Edge runtime, where the Node
  // built-ins these pull in (mssql, msal's native cache, fs) cannot load at all.
  const { syncActualHours, syncHoursWorked, syncPartsCost, recordSyncSuccess, recordSyncFailure } = await import("@/lib/sync-powerbi");
  const { fetchJobHoursRowsWithIssues } = await import("@/lib/sharepoint-hours");
  const { syncFromTotalEto } = await import("@/lib/sync-totaleto");
  const { syncSchedulerTeam } = await import("@/lib/sync-scheduler-team");
  const { prisma } = await import("@/lib/prisma");
  const { isMonthLocked } = await import("@/lib/etc");

  const startedAt = new Date();
  const steps: SyncStepResult[] = [];

  // Rule 1: the month every month-scoped step below will use. Null means either
  // there are no ETC months at all or the latest one is locked — both of which
  // mean those steps must do nothing rather than guess at another month.
  let month: string | null = null;
  try {
    const latest = await prisma.etcEntry.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
    if (latest) {
      const entries = await prisma.etcEntry.findMany({ where: { month: latest.month }, select: { needsReview: true } });
      month = isMonthLocked(entries) ? null : latest.month;
    }
  } catch (err) {
    console.error("[auto-sync] could not resolve the target month:", err);
  }

  // Rule 2 + 3 in one place, so no step can forget either. `stamp` is what a
  // successful step does about its freshness row: hours steps pass false because
  // they record their own (source-derived) refreshedThrough — see
  // recordSyncSuccess.
  async function step(
    source: string,
    label: string,
    stamp: boolean,
    run: () => Promise<string | null>,
  ): Promise<void> {
    try {
      const detail = await run();
      if (detail === null) {
        steps.push({ source, label, status: "skipped", detail: "nothing to do" });
        return;
      }
      if (stamp) await recordSyncSuccess(source, new Date());
      steps.push({ source, label, status: "ok", detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-sync] ${label} failed:`, err);
      await recordSyncFailure(err, source);
      steps.push({ source, label, status: "failed", detail: message });
    }
  }

  // ONE parse of the ~12,600-row export for the whole pass. Both hours steps
  // read the same file, and parsing it costs ~900ms, so doing it per step threw
  // away most of a second every pass for nothing.
  //
  // Memoised rather than fetched up front, deliberately: rule 2 says a step's
  // failure must not take another step down with it. If the read throws inside
  // the first step, `cached` stays null and the second step retries it and fails
  // with its own message, exactly as when each fetched independently.
  let cached: import("@/lib/sync-powerbi").HoursExport | null = null;
  const hoursExport = async () => (cached ??= await fetchJobHoursRowsWithIssues());

  // Hours first: they're the figures the whole app is judged on, and the parts
  // and mirror steps below are independent of them.
  await step("hours_actual", labelFor("hours_actual"), false, async () => {
    const r = await syncActualHours(await hoursExport());
    return `${r.rowsUpserted} upserted, ${r.jobsNotFound} jobs not found, ${r.rowsSkippedOverridden} overridden preserved`;
  });

  await step("etc_hours_worked", labelFor("etc_hours_worked"), false, async () => {
    if (!month) return null; // no open month — see rule notes above
    const r = await syncHoursWorked(month, (await hoursExport()).rows);
    return (
      `${r.rowsUpdated} updated, ${r.rowsSkipped} skipped` +
      // Called out rather than folded into "updated": a zeroed row means the
      // source dropped hours it used to report, which is worth noticing.
      (r.rowsZeroed > 0 ? `, ${r.rowsZeroed} zeroed (no longer in the export)` : "")
    );
  });

  await step("parts_cost", labelFor("parts_cost"), true, async () => {
    if (!month) return null;
    const r = await syncPartsCost(month);
    return `${r.rowsUpserted} upserted`;
  });

  // The TotalETO job mirror (customer, estimate/actual hour totals). Was
  // button-only, which is why a job's mirrored figures could sit weeks behind the
  // hours shown beside them. Manual Customer edits survive it —
  // customerManuallyEdited — so running it unattended can't overwrite a
  // manager's correction.
  await step("totaleto_jobs", labelFor("totaleto_jobs"), true, async () => {
    const r = await syncFromTotalEto();
    return `${r.jobsUpdated} jobs updated, ${r.skippedNoType} skipped (not app-tracked)`;
  });

  // The Scheduler roster's discipline grouping. Fail-soft by design: it RETURNS
  // an unreachable-database result instead of throwing, so that case is recorded
  // as a failure here explicitly rather than passing for success.
  await step("scheduler_team", labelFor("scheduler_team"), true, async () => {
    const r = await syncSchedulerTeam();
    if (!r.ok) throw new Error(r.reason ?? "Scheduler sync reported failure.");
    return `${r.updated.length} re-grouped, ${r.unchanged} unchanged, ${r.unmatchedEtc.length} unmatched`;
  });

  const ms = Date.now() - startedAt.getTime();
  const failed = steps.filter((s) => s.status === "failed");
  // One line per pass, listing every step — a log you can read at a glance to see
  // which feeds are current, instead of five unrelated lines per tick.
  console.log(
    `[auto-sync] ${trigger} pass in ${ms}ms${month ? ` (month ${month})` : " (no open month)"}: ` +
      steps.map((s) => `${s.source}=${s.status}`).join(" "),
  );
  for (const f of failed) console.error(`[auto-sync]   ${f.source}: ${f.detail}`);

  return { trigger, startedAt, ms, month, steps };
}
