import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDataQuality, getPunchExplorer } from "@/lib/data-quality";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DataQualityPanel } from "@/components/DataQualityPanel";
import { recentRefreshRuns } from "@/lib/refresh-service";
import { PageTitle } from "@/components/ui/Typography";
import { BUTTON_PRIMARY } from "@/components/ui/classnames";
import { requirePagePermission } from "@/lib/require-permission";
import { getDashboardOverview, dashboardMonth } from "@/lib/dashboard-overview";
import { DashboardOverviewPanel, monthLabel } from "@/components/dashboard/DashboardOverview";
import { DashboardMonthSelect } from "@/components/dashboard/DashboardMonthSelect";
import { RefreshScheduleCard } from "@/components/dashboard/RefreshScheduleCard";
import { UtilizationPanel } from "@/components/dashboard/UtilizationPanel";
import { getSchedulerBaseUrl } from "@/lib/scheduler-link";
import { fetchSchedulerProjectJobNumbers } from "@/lib/scheduler-db";

// ── The Dashboard (redesigned 2026-08-27) ───────────────────────────────────
//
// Was four count KPIs, a "Manage Jobs" button and a refresh-status card, on a
// page wide enough for far more — a landing page that told a manager the number
// of jobs and nothing about the work. It now answers the questions the ETC
// process actually opens with: what is active and for whom, what is being tested
// this month and by which discipline, and what capacity the two execution
// departments have in that month.
//
// Two structural rules hold this together:
//
//   1. ONE data pass. Every figure comes from getDashboardOverview(month) — a
//      single parallel batch of five reads (jobs, employees, punch hours,
//      Scheduler FATs, Scheduler discipline owners). No card fetches anything of
//      its own, so adding a card costs nothing and the numbers on two cards
//      cannot disagree.
//   2. ONE month. The month selector sets `?m=YYYY-MM` and the server rebuilds
//      the page from it, so the FAT count, the ME/CE split, Engineering hours and
//      Shop hours move together by construction rather than by four controls
//      being kept in step.
//
// Active Jobs is deliberately NOT month-scoped. There is no historical
// active-job model in this app — `Job.status` is the current state and nothing
// records what it was in March — so a month-scoped active count would be a
// number about today wearing a label about the past. It says "current status" on
// the section instead.
//
// Preserved from the old page, unchanged in behaviour: the Data Quality tab and
// its issue badge, the Manage Jobs button, and the refresh-status card (moved to
// the bottom — it is a caveat on the figures, not one of them).

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    m?: string;
    dqFrom?: string;
    dqTo?: string;
    dqEmp?: string;
    dqFn?: string;
    dqMtd?: string;
  }>;
}) {
  await requirePagePermission("dashboard:view");
  const sp = await searchParams;
  const month = dashboardMonth(sp.m);
  // The Data Quality explorer classifies every punch in the window, so it runs
  // only when that tab is actually open. The dashboard's landing view must not
  // pay for it — which is also why the tab lives in the URL rather than in
  // client state alone.
  const onQualityTab = sp.tab === "quality";

  const [overview, dataQuality, explorer, freshnessRows, refreshRuns, schedulerJobNumbers] = await Promise.all([
    getDashboardOverview(month),
    // The Power BI report's Data Quality page, rebuilt locally — see
    // lib/data-quality.ts for where each rule comes from.
    getDataQuality(),
    onQualityTab
      ? getPunchExplorer({ from: sp.dqFrom, to: sp.dqTo, employeeId: sp.dqEmp, functionId: sp.dqFn, monthToDate: sp.dqMtd === "1" })
      : null,
    prisma.powerBiFreshness.findMany(),
    // The last pass (§25.11), so the card can say who refreshed and when.
    recentRefreshRuns(1),
    // Which jobs actually have a Scheduler project, so a FAT row is never a dead
    // link. Fail-soft: an unreachable Scheduler yields an empty set (no links).
    fetchSchedulerProjectJobNumbers(),
  ]);

  return (
    <div className="w-full max-w-[1600px] px-8 py-9 md:px-13 md:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <PageTitle>Dashboard</PageTitle>
          <p className="text-sm text-sdc-gray-600">
            Active work, execution and capacity — month-scoped figures are for{" "}
            <span className="font-semibold text-sdc-navy">{monthLabel(month)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <DashboardMonthSelect month={month} />
          <Link href="/jobs" className={BUTTON_PRIMARY}>
            Manage Jobs
          </Link>
        </div>
      </div>

      <DashboardTabs
        issueCount={dataQuality.future.count + dataQuality.afterCompletion.count + dataQuality.undefinedEmployees.count}
        dataQuality={<DataQualityPanel dq={dataQuality} explorer={explorer} />}
        overview={
          <div className="flex flex-col gap-7">
            <DashboardOverviewPanel
              data={overview}
              schedulerBaseUrl={getSchedulerBaseUrl()}
              schedulerJobNumbers={schedulerJobNumbers}
            />
            {/* Below the overview, above the refresh card: it is the page's most
                detailed table and reads as the "and here is the detail" answer to
                the workforce capacity cards immediately above it. Same `overview`
                object, same month — no second month state, no second fetch. */}
            <UtilizationPanel result={overview.utilization} monthLabel={monthLabel(month)} />
            <RefreshScheduleCard freshnessRows={freshnessRows} lastRun={refreshRuns[0] ?? null} />
          </div>
        }
      />
    </div>
  );
}
