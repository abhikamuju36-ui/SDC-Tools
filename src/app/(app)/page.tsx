import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getDataQuality, getPunchExplorer } from "@/lib/data-quality";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DataQualityPanel } from "@/components/DataQualityPanel";
import { SYNC_SOURCES, SYNC_INTERVAL_MS } from "@/lib/auto-sync";
import { recentRefreshRuns } from "@/lib/refresh-service";
import { validJobTypeFilter } from "@/lib/job-filters";
import { PageTitle, SectionTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { card, BUTTON_PRIMARY } from "@/components/ui/classnames";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Relative "…ago" instead of a raw UTC timestamp — the old ISO string read as
// the viewer's local time and could misjudge freshness by hours.
function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDataThrough(d: Date | null | undefined) {
  return d ? `data thru ${d.toISOString().slice(0, 10)}` : null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; dqFrom?: string; dqTo?: string; dqEmp?: string; dqFn?: string; dqMtd?: string }>;
}) {
  const sp = await searchParams;
  // The Data Quality explorer classifies every punch in the window, so it runs
  // only when that tab is actually open. The dashboard's landing view must not
  // pay for it — which is also why the tab lives in the URL rather than in
  // client state alone.
  const onQualityTab = sp.tab === "quality";
  const explorer = onQualityTab
    ? await getPunchExplorer({ from: sp.dqFrom, to: sp.dqTo, employeeId: sp.dqEmp, functionId: sp.dqFn, monthToDate: sp.dqMtd === "1" })
    : null;

  const [
    jobCount,
    activeCount,
    employeeCount,
    needsReviewCount,
    recentJobs,
    freshnessRows,
    dataQuality,
    // The last few passes (§25.11), so the card can say who refreshed and when.
    refreshRuns,
  ] = await Promise.all([
    prisma.job.count({ where: validJobTypeFilter }),
    prisma.job.count({ where: { status: "Active", ...validJobTypeFilter } }),
    prisma.employee.count({ where: { active: true } }),
    prisma.etcEntry.count({ where: { needsReview: true } }),
    prisma.job.findMany({ where: validJobTypeFilter, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.powerBiFreshness.findMany(),
    // The Power BI report's Data Quality page, rebuilt locally — see
    // lib/data-quality.ts for where each rule comes from.
    getDataQuality(),
    recentRefreshRuns(1),
  ]);

  const stats = [
    { label: "Total Jobs", value: jobCount, href: "/jobs" },
    { label: "Active Jobs", value: activeCount, href: "/jobs" },
    { label: "Active Employees", value: employeeCount, href: "/employees" },
    { label: "ETC Entries Needing Review", value: needsReviewCount, href: "/etc", alert: needsReviewCount > 0 },
  ];

  // The scheduled feeds, straight off SYNC_SOURCES so this card cannot drift from
  // what actually runs. `checkedAt` is when the app last asked; `refreshedThrough`
  // is how current the DATA is — two different questions that were previously
  // collapsed into one "last synced" line per row.
  const freshnessBySource = new Map(freshnessRows.map((r) => [r.source, r]));
  const scheduledFeeds = SYNC_SOURCES.map((f) => {
    const row = freshnessBySource.get(f.source);
    return {
      ...f,
      checkedAt: row?.checkedAt ?? null,
      refreshedThrough: row?.refreshedThrough ?? null,
      // status is null when healthy. "Failed: …" means the last attempt broke and
      // this feed is aging; anything else is a stated WAIT — the source is fine but
      // upstream has not published the data yet (see recordSyncNote). Both are
      // shown, in different colours: a red tick for data nobody has published
      // teaches people to ignore red.
      failure: row?.status?.startsWith("Failed:") ? row.status : null,
      waiting: row?.status && !row.status.startsWith("Failed:") ? row.status : null,
      everRan: Boolean(row),
    };
  });
  const failingFeeds = scheduledFeeds.filter((f) => f.failure);
  // The most recent pass, whoever ran it — the answer to "has anybody refreshed this
  // today" without reading seven per-source rows (§25.11).
  const lastRun = refreshRuns[0] ?? null;


  const statIcons: Record<string, { bg: string; fg: string; path: React.ReactNode }> = {
    "Total Jobs": {
      bg: "bg-sdc-blue-light",
      fg: "text-sdc-blue",
      path: <path d="M20 7h-9m9 5h-9m9 5h-9M4 7h1m-1 5h1m-1 5h1" />,
    },
    "Active Jobs": {
      bg: "bg-sdc-green-bg",
      fg: "text-sdc-green-text",
      path: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
    },
    "Active Employees": {
      bg: "bg-sdc-gray-100",
      fg: "text-sdc-navy",
      path: (
        <>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      ),
    },
    "ETC Entries Needing Review": {
      bg: "bg-sdc-yellow-bg",
      fg: "text-sdc-yellow-text",
      path: (
        <>
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </>
      ),
    },
  };

  return (
    <div className="w-full max-w-[1360px] px-8 py-10 md:px-13 md:py-11">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <PageTitle>Dashboard</PageTitle>
          <p className="text-sm text-sdc-gray-600">Estimate-to-complete tracking for active SDC projects</p>
        </div>
        <p className="shrink-0 text-xs font-medium text-sdc-gray-400">
          Current ETC month · <span className="font-bold text-sdc-navy">{currentMonth()}</span>
        </p>
      </div>

      <DashboardTabs
        issueCount={
          dataQuality.future.count +
          dataQuality.afterCompletion.count +
          dataQuality.undefinedEmployees.count +
          dataQuality.nonJobHours.count
        }
        dataQuality={<DataQualityPanel dq={dataQuality} explorer={explorer} />}
        overview={
        <>
      <div className="mb-7 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => {
          const icon = statIcons[s.label];
          const cardEl = (
            <div
              className={`relative ${
                s.alert
                  // No transition-shadow here any more: card() carries
                  // `motion-interactive`, which already transitions box-shadow at the
                  // shared duration. Two transition declarations on one element means
                  // whichever Tailwind emits last wins, silently (§36.17).
                  ? `${card("p-5")} border-sdc-yellow bg-sdc-yellow-bg/40 hover:shadow-md`
                  : `${card("p-5")} hover:shadow-md`
              }`}
            >
              {icon && (
                <div className={`absolute top-5 right-5 flex h-6.5 w-6.5 items-center justify-center rounded-[7px] ${icon.bg}`}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={icon.fg}
                  >
                    {icon.path}
                  </svg>
                </div>
              )}
              <p className={`pr-8 text-xs font-semibold ${s.alert ? "text-sdc-yellow-text" : "text-sdc-gray-600"}`}>{s.label}</p>
              <p className={`mt-3.5 font-heading text-3xl font-bold tracking-tight ${s.alert ? "text-sdc-yellow-text" : "text-sdc-navy"}`}>
                {s.value}
              </p>
            </div>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>
              {cardEl}
            </Link>
          ) : (
            <div key={s.label}>{cardEl}</div>
          );
        })}
      </div>

      <div className="mb-7 flex gap-2.5">
        <Link href="/jobs" className={BUTTON_PRIMARY}>
          Manage Jobs
        </Link>
      </div>

      {/* The schedule itself — every feed that refreshes automatically, its real
          state, and one button that runs the identical pass on demand. Rendered
          from SYNC_SOURCES so a feed can't appear here without being on the
          schedule, or run on the schedule without appearing here. */}
      <div className={`${card("p-6")} mb-6`}>
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <SectionTitle>Refresh Schedule</SectionTitle>
            <p className="mt-1 text-xs text-sdc-gray-400">
              All of these refresh together every {SYNC_INTERVAL_MS / 3_600_000 === 1 ? "hour" : `${SYNC_INTERVAL_MS / 3_600_000} hours`}, in
              one pass — and “Refresh Data” in the sidebar runs that identical pass on demand. Historical months and app-owned
              figures (quoted hours, New ETC, notes) are deliberately excluded: they are never overwritten by a refresh.
            </p>
          </div>
          {/* No button here either (§25.14.6). This card is the STATUS — which feed is
              current, which failed, when the last pass ran and who started it — and the
              one control that starts a pass is "Refresh Data" in the sidebar, on every
              page. A second copy beside this status is how the app came to have five
              refresh buttons in the first place. */}
        </div>

        {lastRun && (
          <p className="mt-2 text-xs text-sdc-muted">
            Last refresh: {lastRun.completedAt ? timeAgo(lastRun.completedAt) : "still running"}
            {lastRun.userName ? ` — started by ${lastRun.userName}` : " — scheduled"}
            {lastRun.completedAt && ` · ${lastRun.sourcesOk}/${lastRun.sourcesOk + lastRun.sourcesFailed} sources ok`}
            {lastRun.sourcesFailed > 0 && (
              <span className="font-semibold text-sdc-red-text"> · {lastRun.sourcesFailed} failed</span>
            )}
            {lastRun.durationMs != null && ` · took ${Math.round(lastRun.durationMs / 100) / 10}s`}
          </p>
        )}

        {failingFeeds.length > 0 && (
          <p className="mt-3 rounded-lg border border-sdc-red-border bg-sdc-red-bg px-3.5 py-2.5 text-xs font-medium text-sdc-red-text">
            {failingFeeds.length} feed{failingFeeds.length === 1 ? "" : "s"} failed on the last attempt and{" "}
            {failingFeeds.length === 1 ? "is" : "are"} now aging. Figures drawn from{" "}
            {failingFeeds.map((f) => f.label).join(", ")} may be out of date.
          </p>
        )}

        <div className="mt-3 divide-y divide-sdc-border-soft">
          {scheduledFeeds.map((f) => (
            <div key={f.source} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`h-1.75 w-1.75 shrink-0 rounded-full ${
                      f.failure ? "bg-sdc-red" : f.waiting ? "bg-sdc-yellow" : f.everRan ? "bg-sdc-green" : "bg-sdc-gray-400"
                    }`}
                  />
                  <p className="truncate text-sm font-semibold text-sdc-navy">{f.label}</p>
                  {f.monthScoped && (
                    <span
                      className="shrink-0 rounded bg-sdc-gray-100 px-1.5 py-0.5 text-label font-medium text-sdc-gray-600"
                      title="Only the latest open ETC month — a submitted month is frozen and never touched"
                    >
                      open month only
                    </span>
                  )}
                </div>
                {f.failure && <p className="mt-1 pl-4.5 text-xs break-words text-sdc-red-text">{f.failure}</p>}
                {f.waiting && <p className="mt-1 pl-4.5 text-xs break-words text-sdc-yellow-text">{f.waiting}</p>}
              </div>
              <span className="shrink-0 text-right text-xs text-sdc-gray-400">
                {f.everRan ? `Checked ${timeAgo(f.checkedAt!)}` : "Never run"}
                {formatDataThrough(f.refreshedThrough) && (
                  <>
                    <br />
                    <span title="How current the source data itself is, not when the app last asked">
                      {formatDataThrough(f.refreshedThrough)}
                    </span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* The "Run One Source" card is gone (§25.1, 2026-08-04). It offered five
          buttons that each refreshed a SUBSET — jobs, or hours, or quoted figures — and
          every one of them left the rest of the app aging beside the part it updated,
          which is the state "which of these numbers is current?" comes from. There is
          one refresh now, it covers every source, and the per-source state above still
          shows exactly which feed is stale and why. */}

      <div className={card("p-0")}>
        <div className="border-b border-sdc-border-soft px-6 py-4">
          <SectionTitle>Recently Added Jobs</SectionTitle>
        </div>
        <div className="divide-y divide-sdc-border-soft">
          {recentJobs.length === 0 && <p className="p-5 text-sm text-sdc-gray-400">No jobs yet.</p>}
          {recentJobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="motion-interactive flex items-center justify-between px-6 py-3.5 text-sm hover:bg-sdc-blue-light/40"
            >
              <span>
                <span className="font-mono text-sdc-gray-400">#{job.jobId}</span>{" "}
                <span className="font-semibold text-sdc-navy">{job.jobName}</span>
              </span>
              <StatusBadge variant={job.status === "Complete" ? "complete" : "active"}>{job.status}</StatusBadge>
            </Link>
          ))}
        </div>
      </div>
        </>
        }
      />
    </div>
  );
}
