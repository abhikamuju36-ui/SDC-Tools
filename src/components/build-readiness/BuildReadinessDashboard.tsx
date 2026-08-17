"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usd } from "@/components/ui/format";
import { useColumnSort } from "@/components/useColumnSort";
import { SortableTh } from "@/components/ui/SortableHeader";
import { sortRows, type SortColumns } from "@/lib/table-sort";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReadinessPill } from "@/components/build-readiness/ReadinessPill";
import {
  type BuildReadinessData,
  type BuildReadinessFilters,
  type JobSnapshotRow,
  type AssemblyDetail,
} from "@/lib/build-readiness-types";
import { getBuildReadinessData, triggerBuildReadinessRefresh, refreshBuildReadinessProject } from "@/lib/build-readiness-actions";
import type { BuildReadinessSharedView } from "@/lib/build-readiness-views-actions";
import { BuildReadinessFilterBar } from "@/components/build-readiness/BuildReadinessFilters";
import { BuildReadinessInsights } from "@/components/build-readiness/BuildReadinessInsights";

const POLL_MS = 2000;

// Frozen-column geometry for the main table (Job ID + Project stay put on
// horizontal scroll). Fixed rem widths, not measured content — a sticky
// offset has to be a constant, and rem (not px) survives the app's zoom
// control, which scales via a CSS `zoom` var rather than the root font-size.
const FROZEN_JOBID_W = "w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem]";
const FROZEN_PROJECT_LEFT = "left-[4.5rem]";
const FROZEN_PROJECT_W = "w-[13rem] min-w-[13rem] max-w-[13rem]";

function num(n: number): string {
  return Math.round(n).toLocaleString();
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Unified KPI strip — one bordered card, gap-px dividers ───────────────────
//
// Replaces 10 individually-bordered tiles (one shadow/border each) with the
// same "one outer border, tone via left-accent + tint" treatment
// EtcMonthKpiCards.tsx's MetricBlock uses, at a tile layout instead of
// MetricBlock's stacked rows — these 10 KPIs are label+value only, no second
// line, so a row-per-metric layout would waste height for no benefit.
function KpiTile({ label, value, tone, hint }: { label: string; value: string; tone?: "danger" | "warn"; hint?: string }) {
  const toneCls = tone === "danger" ? "text-sdc-red-text" : tone === "warn" ? "text-sdc-yellow-text" : "text-sdc-navy";
  return (
    <div
      className={`flex min-w-0 flex-col justify-center gap-0.5 border-l-4 px-3 py-2.5 ${
        tone === "danger" ? "border-l-sdc-red bg-sdc-red-bg/70" : tone === "warn" ? "border-l-sdc-yellow bg-sdc-yellow-bg/70" : "border-l-transparent bg-white"
      }`}
      title={hint}
    >
      <span className="truncate text-label font-semibold uppercase tracking-wide text-sdc-muted">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}

type ProjectSortKey = "jobId" | "project" | "customer" | "readiness" | "assemblies" | "ready" | "partial" | "blocked" | "missing" | "onOrder" | "pastDue" | "dueSoon" | "material" | "nextUnlock";

const PROJECT_COLUMNS: SortColumns<JobSnapshotRow, ProjectSortKey> = {
  jobId: { type: "id", value: (r) => r.jobId },
  project: { type: "text", value: (r) => r.jobName },
  customer: { type: "text", value: (r) => r.customer },
  readiness: { type: "number", value: (r) => r.overallReadinessPct },
  assemblies: { type: "number", value: (r) => r.assembliesTotal },
  ready: { type: "number", value: (r) => r.assembliesReady },
  partial: { type: "number", value: (r) => r.assembliesPartial },
  blocked: { type: "number", value: (r) => r.assembliesBlocked },
  missing: { type: "number", value: (r) => r.partsUncovered },
  onOrder: { type: "number", value: (r) => r.partsOnOrder },
  pastDue: { type: "number", value: (r) => r.partsPastDue },
  dueSoon: { type: "number", value: (r) => r.partsDueSoon7d },
  material: { type: "currency", value: (r) => r.materialValueTotal },
  nextUnlock: { type: "date", value: (r) => r.nextUnlockDate },
};

export function BuildReadinessDashboard({
  initialData,
  initialViews,
}: {
  initialData: BuildReadinessData;
  initialViews: { default: BuildReadinessSharedView | null; shared: BuildReadinessSharedView[] };
}) {
  const [data, setData] = useState(initialData);
  const [filters, setFilters] = useState<BuildReadinessFilters>({});
  const [drillJobId, setDrillJobId] = useState<string | null>(null);
  const [refreshingProject, setRefreshingProject] = useState<string | null>(null);
  const sort = useColumnSort<ProjectSortKey>({ key: "readiness", direction: "asc" });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async (f: BuildReadinessFilters) => {
    const next = await getBuildReadinessData(f);
    setData(next);
    return next;
  }, []);

  // Poll while a live pass is running, so rows populate progressively rather
  // than the page sitting blank/stale for the whole 1-2+ minute pass.
  useEffect(() => {
    if (data.meta.status !== "running") {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    if (pollTimer.current) return;
    pollTimer.current = setInterval(() => {
      void reload(filters);
    }, POLL_MS);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.meta.status]);

  // Re-fetch (no new trigger) whenever a filter changes.
  useEffect(() => {
    void reload(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function handleRefreshNow() {
    const meta = await triggerBuildReadinessRefresh(true);
    setData((d) => ({ ...d, meta }));
  }

  async function handleRefreshProject(jobId: string) {
    setRefreshingProject(jobId);
    try {
      await refreshBuildReadinessProject(jobId);
      await reload(filters);
    } finally {
      setRefreshingProject(null);
    }
  }

  const jobs = data.jobs;
  const sortedJobs = useMemo(() => sortRows(jobs, sort.sort, PROJECT_COLUMNS), [jobs, sort.sort]);

  const kpis = useMemo(() => {
    const activeProjects = jobs.length;
    const overallPct = activeProjects ? Math.round(jobs.reduce((s, j) => s + j.overallReadinessPct, 0) / activeProjects) : 0;
    const assembliesReady = jobs.reduce((s, j) => s + j.assembliesReady, 0);
    const assembliesPartial = jobs.reduce((s, j) => s + j.assembliesPartial, 0);
    const assembliesBlocked = jobs.reduce((s, j) => s + j.assembliesBlocked, 0);
    const partsUncovered = jobs.reduce((s, j) => s + j.partsUncovered, 0);
    const partsOnOrder = jobs.reduce((s, j) => s + j.partsOnOrder, 0);
    const partsPastDue = jobs.reduce((s, j) => s + j.partsPastDue, 0);
    const partsDueSoon7d = jobs.reduce((s, j) => s + j.partsDueSoon7d, 0);
    const materialValueAtRisk = jobs.reduce((s, j) => s + j.materialValueAtRisk, 0);
    return { activeProjects, overallPct, assembliesReady, assembliesPartial, assembliesBlocked, partsUncovered, partsOnOrder, partsPastDue, partsDueSoon7d, materialValueAtRisk };
  }, [jobs]);

  const drillJob = drillJobId ? jobs.find((j) => j.jobId === drillJobId) ?? null : null;

  // Group-boundary + hairline vertical separators, shared by every non-frozen
  // header/body cell so the two stay in lockstep (spec: subtle column
  // separators, stronger between logical groups — Project | Readiness |
  // Supply Risk | Financial).
  const V = "border-l border-sdc-border-soft";
  const VG = "border-l-2 border-sdc-border"; // group boundary

  return (
    <div className="flex flex-col gap-4">
      <BuildReadinessFilterBar
        filters={filters}
        setFilters={setFilters}
        jobs={jobs}
        initialViews={initialViews}
        meta={data.meta}
        onRefresh={handleRefreshNow}
      />

      {/* KPI strip — one card, gap-px dividers, tone via left-accent + tint */}
      <div className="overflow-hidden rounded-xl border border-sdc-border bg-sdc-border-soft shadow-sm">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px">
          <KpiTile label="Active Projects" value={num(kpis.activeProjects)} />
          <KpiTile label="Overall Readiness" value={`${kpis.overallPct}%`} />
          <KpiTile label="Ready Now" value={num(kpis.assembliesReady)} />
          <KpiTile label="Partially Ready" value={num(kpis.assembliesPartial)} tone={kpis.assembliesPartial > 0 ? "warn" : undefined} />
          <KpiTile label="Blocked" value={num(kpis.assembliesBlocked)} tone={kpis.assembliesBlocked > 0 ? "danger" : undefined} />
          <KpiTile label="Missing / Uncovered" value={num(kpis.partsUncovered)} tone={kpis.partsUncovered > 0 ? "danger" : undefined} />
          <KpiTile label="Parts On Order" value={num(kpis.partsOnOrder)} />
          <KpiTile label="Past Due Parts" value={num(kpis.partsPastDue)} tone={kpis.partsPastDue > 0 ? "danger" : undefined} />
          <KpiTile label="Due ≤ 7 Days" value={num(kpis.partsDueSoon7d)} />
          <KpiTile label="Material $ At Risk" value={usd(kpis.materialValueAtRisk)} tone={kpis.materialValueAtRisk > 0 ? "danger" : undefined} />
        </div>
      </div>

      {/* Project Readiness table */}
      <div className="overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm">
        {sortedJobs.length === 0 ? (
          <EmptyState
            title="No projects match the current filters."
            message="Try widening a filter, or clear them from the toolbar above."
          />
        ) : (
          <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
                <SortableTh label="Job ID" sortKey="jobId" type="id" sort={sort.sort} onSort={sort.onSort} className={`frozen-col sticky left-0 top-0 z-[3] ${FROZEN_JOBID_W} bg-sdc-navy px-3 py-2`} />
                <SortableTh label="Project" sortKey="project" type="text" sort={sort.sort} onSort={sort.onSort} className={`frozen-col frozen-col-last sticky top-0 z-[3] ${FROZEN_PROJECT_LEFT} ${FROZEN_PROJECT_W} bg-sdc-navy px-2 py-2`} />
                <SortableTh label="Customer" sortKey="customer" type="text" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Readiness %" sortKey="readiness" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${VG}`} />
                <SortableTh label="Assemblies" sortKey="assemblies" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Ready" sortKey="ready" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Partial" sortKey="partial" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Blocked" sortKey="blocked" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Missing" sortKey="missing" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${VG}`} />
                <SortableTh label="On Order" sortKey="onOrder" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Past Due" sortKey="pastDue" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Due ≤7d" sortKey="dueSoon" type="number" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
                <SortableTh label="Material $" sortKey="material" type="currency" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${VG}`} />
                <SortableTh label="Next Unlock" sortKey="nextUnlock" type="date" sort={sort.sort} onSort={sort.onSort} className={`sticky top-0 z-[2] bg-sdc-navy px-2 py-2 ${V}`} />
              </tr>
            </thead>
            <tbody>
              {sortedJobs.map((j) => {
                const selected = drillJobId === j.jobId;
                const frozenBg = selected ? "bg-sdc-blue-light/40" : "bg-white group-hover:bg-sdc-blue-light/30";
                return (
                  <tr
                    key={j.jobId}
                    onClick={() => setDrillJobId(j.jobId === drillJobId ? null : j.jobId)}
                    className={`group cursor-pointer hover:bg-sdc-blue-light/30 ${selected ? "bg-sdc-blue-light/40" : ""}`}
                  >
                    <td className={`frozen-col sticky left-0 z-[1] ${FROZEN_JOBID_W} ${frozenBg} border-b border-sdc-border-soft/60 px-3 py-1.5 font-mono text-note font-semibold text-sdc-blue ${selected ? "border-l-4 border-l-sdc-blue" : ""}`}>
                      {j.jobId}
                    </td>
                    <td className={`frozen-col frozen-col-last sticky z-[1] ${FROZEN_PROJECT_LEFT} ${FROZEN_PROJECT_W} ${frozenBg} truncate border-b border-sdc-border-soft/60 px-2 py-1.5 text-note text-sdc-navy`} title={j.jobName}>
                      {j.jobName}
                    </td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-note text-sdc-gray-600 ${V}`}>{j.customer ?? "—"}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right ${VG}`}>
                      <span className="inline-flex justify-end">
                        <ReadinessPill pct={j.overallReadinessPct} status={j.status} />
                      </span>
                    </td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600 ${V}`}>{num(j.assembliesTotal)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-green-text ${V}`}>{num(j.assembliesReady)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-yellow-text ${V}`}>{num(j.assembliesPartial)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text ${V}`}>{num(j.assembliesBlocked)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600 ${VG}`}>{num(j.partsUncovered)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600 ${V}`}>{num(j.partsOnOrder)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600 ${V}`}>{num(j.partsPastDue)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600 ${V}`}>{num(j.partsDueSoon7d)}</td>
                    <td className={`border-b border-sdc-border-soft/60 px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums text-sdc-navy ${VG}`}>{usd(j.materialValueTotal)}</td>
                    <td className={`whitespace-nowrap border-b border-sdc-border-soft/60 px-2 py-1.5 font-mono text-label text-sdc-gray-600 ${V}`}>{fmtDate(j.nextUnlockDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drillJob && (
        <ProjectDrillPanel
          job={drillJob}
          onClose={() => setDrillJobId(null)}
          onRefresh={() => handleRefreshProject(drillJob.jobId)}
          refreshing={refreshingProject === drillJob.jobId}
        />
      )}

      <BuildReadinessInsights jobs={jobs} />
    </div>
  );
}

type AsmSortKey = "assembly" | "release" | "required" | "covered" | "readiness" | "buildable" | "missing" | "onOrder" | "pastDue" | "nextDelivery" | "estBuildable";

const ASM_COLUMNS: SortColumns<AssemblyDetail, AsmSortKey> = {
  assembly: { type: "text", value: (r) => r.label },
  release: { type: "text", value: (r) => r.release },
  required: { type: "number", value: (r) => r.requiredQty },
  covered: { type: "number", value: (r) => r.coveredQty },
  readiness: { type: "number", value: (r) => r.readinessPct },
  buildable: { type: "number", value: (r) => r.buildableQty },
  missing: { type: "number", value: (r) => r.missingParts },
  onOrder: { type: "number", value: (r) => r.onOrderParts },
  pastDue: { type: "number", value: (r) => r.pastDueParts },
  nextDelivery: { type: "date", value: (r) => r.nextExpectedDelivery },
  estBuildable: { type: "date", value: (r) => r.estimatedBuildableDate },
};

const RELEASE_LABEL: Record<AssemblyDetail["release"], string> = {
  contentsOnly: "Contents Only",
  assemblyOnly: "Assembly Only",
  bothAssemblyAndContents: "Both Assembly + Contents",
};

function ProjectDrillPanel({ job, onClose, onRefresh, refreshing }: { job: JobSnapshotRow; onClose: () => void; onRefresh: () => void; refreshing: boolean }) {
  const sort = useColumnSort<AsmSortKey>();
  const rows = useMemo(() => sortRows(job.detail.assemblies, sort.sort, ASM_COLUMNS), [job.detail.assemblies, sort.sort]);
  const v = "border-l border-sdc-border-soft";

  return (
    <div className="rounded-xl border border-sdc-border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
        <div>
          <span className="text-sm font-bold text-sdc-navy">{job.jobId} — {job.jobName}</span>
          <span className="ml-2 text-note text-sdc-muted">Computed {new Date(job.computedAt).toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onRefresh} disabled={refreshing} className="rounded-md border border-sdc-border bg-white px-2.5 py-1 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light disabled:cursor-not-allowed disabled:opacity-50">
            {refreshing ? "Refreshing…" : "Refresh this project"}
          </button>
          <button type="button" onClick={onClose} className="rounded-md border border-sdc-border bg-white px-2 py-1 text-xs font-medium text-sdc-navy hover:bg-sdc-blue-light">
            Close
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No released BOM available for this project." />
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            <thead className="sticky top-0 z-[1]">
              <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
                <SortableTh label="Assembly" sortKey="assembly" type="text" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
                <SortableTh label="Release Status" sortKey="release" type="text" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Required Qty" sortKey="required" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Covered Qty" sortKey="covered" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Readiness %" sortKey="readiness" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Buildable Now" sortKey="buildable" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Missing" sortKey="missing" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="On Order" sortKey="onOrder" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Past Due" sortKey="pastDue" type="number" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Next Expected" sortKey="nextDelivery" type="date" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
                <SortableTh label="Est. Buildable" sortKey="estBuildable" type="date" sort={sort.sort} onSort={sort.onSort} className={`px-2 py-2 ${v}`} />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.key} className="border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/20" title={a.limitingParts.length ? `Limiting: ${a.limitingParts.map((lp) => `${lp.pn} (${lp.available}/${lp.required})`).join(", ")}` : undefined}>
                  <td className="px-3 py-1.5 text-note text-sdc-navy">{a.label}</td>
                  <td className={`px-2 py-1.5 text-note text-sdc-gray-600 ${v}`}>{RELEASE_LABEL[a.release]}</td>
                  <td className={`px-2 py-1.5 text-right font-mono text-note tabular-nums ${v}`}>{num(a.requiredQty)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono text-note tabular-nums ${v}`}>{num(a.coveredQty)}</td>
                  <td className={`px-2 py-1.5 text-right ${v}`}>
                    <span className="inline-flex justify-end">
                      <ReadinessPill pct={a.readinessPct} />
                    </span>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums ${v} ${a.buildableQty == null ? "text-sdc-gray-400" : a.buildableQty >= a.requiredQty ? "text-sdc-green-text" : a.buildableQty > 0 ? "text-sdc-yellow-text" : "text-sdc-red-text"}`}>
                    {a.buildableQty == null ? "—" : `${num(a.buildableQty)} (${a.buildablePct}%)`}
                  </td>
                  {/* Real counts, never null — a true 0 must print as 0, not "—" (§9). */}
                  <td className={`px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text ${v}`}>{num(a.missingParts)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono text-note tabular-nums ${v}`}>{num(a.onOrderParts)}</td>
                  <td className={`px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text ${v}`}>{num(a.pastDueParts)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 font-mono text-label text-sdc-gray-600 ${v}`}>{fmtDate(a.nextExpectedDelivery)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 font-mono text-label text-sdc-gray-600 ${v}`}>{fmtDate(a.estimatedBuildableDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
