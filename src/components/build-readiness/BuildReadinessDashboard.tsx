"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usd } from "@/components/ui/format";
import { useColumnSort } from "@/components/useColumnSort";
import { SortableTh } from "@/components/ui/SortableHeader";
import { sortRows, type SortColumns } from "@/lib/table-sort";
import {
  type BuildReadinessData,
  type BuildReadinessFilters,
  type JobSnapshotRow,
  type AssemblyDetail,
  readinessBand,
  type ReadinessBand,
} from "@/lib/build-readiness-types";
import { getBuildReadinessData, triggerBuildReadinessRefresh, refreshBuildReadinessProject } from "@/lib/build-readiness-actions";
import type { BuildReadinessSharedView } from "@/lib/build-readiness-views-actions";
import { BuildReadinessFilterBar } from "@/components/build-readiness/BuildReadinessFilters";
import { BuildReadinessInsights } from "@/components/build-readiness/BuildReadinessInsights";

const POLL_MS = 2000;

function num(n: number): string {
  return Math.round(n).toLocaleString();
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const BAND_DOT: Record<ReadinessBand, string> = {
  green: "bg-sdc-green",
  yellow: "bg-sdc-yellow",
  red: "bg-sdc-red",
  grey: "bg-sdc-gray-300",
};
const BAND_TEXT: Record<ReadinessBand, string> = {
  green: "text-sdc-green-text",
  yellow: "text-sdc-yellow-text",
  red: "text-sdc-red-text",
  grey: "text-sdc-gray-400",
};

function ReadinessDot({ band }: { band: ReadinessBand }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${BAND_DOT[band]}`} aria-hidden />;
}

function KpiCard({ label, value, tone, hint }: { label: string; value: string; tone?: "danger" | "warn"; hint?: string }) {
  const toneCls = tone === "danger" ? "text-sdc-red-text" : tone === "warn" ? "text-sdc-yellow-text" : "text-sdc-navy";
  return (
    <div className="flex min-w-[130px] flex-1 flex-col gap-0.5 rounded-lg border border-sdc-border bg-white px-3 py-2 shadow-sm" title={hint}>
      <span className="text-label font-semibold uppercase tracking-wide text-sdc-gray-400">{label}</span>
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

  const statusLine = (() => {
    const m = data.meta;
    if (m.status === "running") return `Live — refreshing ${m.jobsDone} of ${m.jobsTotal} projects…`;
    if (!m.completedAt) return "Not refreshed yet.";
    const secs = m.durationMs ? Math.round(m.durationMs / 1000) : null;
    const failedNote = m.jobsFailed > 0 ? ` (${m.jobsFailed} project${m.jobsFailed === 1 ? "" : "s"} failed)` : "";
    return `Live as of ${new Date(m.completedAt).toLocaleTimeString()}${secs != null ? ` — completed in ${secs}s` : ""}${failedNote}`;
  })();

  return (
    <div className="flex flex-col gap-4">
      <BuildReadinessFilterBar filters={filters} setFilters={setFilters} jobs={jobs} initialViews={initialViews} />

      {/* Live status + refresh */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-sdc-border bg-white px-4 py-2 shadow-sm">
        <span className="flex items-center gap-2 text-note text-sdc-gray-600">
          {data.meta.status === "running" && <span className="h-2 w-2 animate-pulse rounded-full bg-sdc-blue" aria-hidden />}
          {statusLine}
        </span>
        <button
          type="button"
          onClick={handleRefreshNow}
          disabled={data.meta.status === "running"}
          className="rounded-md border border-sdc-border bg-white px-3 py-1 text-xs font-semibold text-sdc-navy hover:bg-sdc-blue-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh now
        </button>
      </div>

      {/* KPI strip */}
      <div className="flex flex-wrap gap-2">
        <KpiCard label="Active Projects" value={num(kpis.activeProjects)} />
        <KpiCard label="Overall Readiness" value={`${kpis.overallPct}%`} />
        <KpiCard label="Ready Now" value={num(kpis.assembliesReady)} />
        <KpiCard label="Partially Ready" value={num(kpis.assembliesPartial)} tone={kpis.assembliesPartial > 0 ? "warn" : undefined} />
        <KpiCard label="Blocked" value={num(kpis.assembliesBlocked)} tone={kpis.assembliesBlocked > 0 ? "danger" : undefined} />
        <KpiCard label="Missing / Uncovered" value={num(kpis.partsUncovered)} tone={kpis.partsUncovered > 0 ? "danger" : undefined} />
        <KpiCard label="Parts On Order" value={num(kpis.partsOnOrder)} />
        <KpiCard label="Past Due Parts" value={num(kpis.partsPastDue)} tone={kpis.partsPastDue > 0 ? "danger" : undefined} />
        <KpiCard label="Due ≤ 7 Days" value={num(kpis.partsDueSoon7d)} />
        <KpiCard label="Material $ At Risk" value={usd(kpis.materialValueAtRisk)} tone={kpis.materialValueAtRisk > 0 ? "danger" : undefined} />
      </div>

      {/* Project Readiness table */}
      <div className="overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm">
        <table className="w-full min-w-[1100px] border-collapse text-left">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
              <SortableTh label="Job ID" sortKey="jobId" type="id" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
              <SortableTh label="Project" sortKey="project" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Customer" sortKey="customer" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Readiness %" sortKey="readiness" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Assemblies" sortKey="assemblies" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Ready" sortKey="ready" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Partial" sortKey="partial" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Blocked" sortKey="blocked" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Missing" sortKey="missing" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="On Order" sortKey="onOrder" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Past Due" sortKey="pastDue" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Due ≤7d" sortKey="dueSoon" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Material $" sortKey="material" type="currency" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Next Unlock" sortKey="nextUnlock" type="date" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {sortedJobs.map((j) => {
              const band = readinessBand(j);
              return (
                <tr
                  key={j.jobId}
                  onClick={() => setDrillJobId(j.jobId === drillJobId ? null : j.jobId)}
                  className={`cursor-pointer border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/30 ${drillJobId === j.jobId ? "bg-sdc-blue-light/40" : ""}`}
                >
                  <td className="px-3 py-1.5 font-mono text-note font-semibold text-sdc-blue">{j.jobId}</td>
                  <td className="px-2 py-1.5 text-note text-sdc-navy">{j.jobName}</td>
                  <td className="px-2 py-1.5 text-note text-sdc-gray-600">{j.customer ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5 font-mono text-note font-semibold tabular-nums">
                      <ReadinessDot band={band} />
                      <span className={BAND_TEXT[band]}>{j.status === "ok" ? `${j.overallReadinessPct}%` : j.status === "empty" ? "No BOM" : "Failed"}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600">{num(j.assembliesTotal)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-green-text">{num(j.assembliesReady)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-yellow-text">{num(j.assembliesPartial)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text">{num(j.assembliesBlocked)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600">{num(j.partsUncovered)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600">{num(j.partsOnOrder)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600">{num(j.partsPastDue)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600">{num(j.partsDueSoon7d)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums text-sdc-navy">{usd(j.materialValueTotal)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-label text-sdc-gray-600">{fmtDate(j.nextUnlockDate)}</td>
                </tr>
              );
            })}
            {sortedJobs.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-8 text-center text-sm text-sdc-gray-400">
                  No active projects match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

  return (
    <div className="rounded-xl border border-sdc-border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2.5">
        <div>
          <span className="text-sm font-bold text-sdc-navy">{job.jobId} — {job.jobName}</span>
          <span className="ml-2 text-note text-sdc-gray-500">Computed {new Date(job.computedAt).toLocaleString()}</span>
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
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[1000px] border-collapse text-left">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
              <SortableTh label="Assembly" sortKey="assembly" type="text" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
              <SortableTh label="Release Status" sortKey="release" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Required Qty" sortKey="required" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Covered Qty" sortKey="covered" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Readiness %" sortKey="readiness" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Buildable Now" sortKey="buildable" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Missing" sortKey="missing" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="On Order" sortKey="onOrder" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Past Due" sortKey="pastDue" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Next Expected" sortKey="nextDelivery" type="date" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
              <SortableTh label="Est. Buildable" sortKey="estBuildable" type="date" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.key} className="border-b border-sdc-border-soft/60 hover:bg-sdc-blue-light/20" title={a.limitingParts.length ? `Limiting: ${a.limitingParts.map((lp) => `${lp.pn} (${lp.available}/${lp.required})`).join(", ")}` : undefined}>
                <td className="px-3 py-1.5 text-note text-sdc-navy">{a.label}</td>
                <td className="px-2 py-1.5 text-note text-sdc-gray-600">{RELEASE_LABEL[a.release]}</td>
                <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(a.requiredQty)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(a.coveredQty)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{a.readinessPct}%</td>
                <td className={`px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums ${a.buildableQty == null ? "text-sdc-gray-400" : a.buildableQty >= a.requiredQty ? "text-sdc-green-text" : a.buildableQty > 0 ? "text-sdc-yellow-text" : "text-sdc-red-text"}`}>
                  {a.buildableQty == null ? "—" : `${num(a.buildableQty)} (${a.buildablePct}%)`}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text">{a.missingParts || "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{a.onOrderParts || "—"}</td>
                <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text">{a.pastDueParts || "—"}</td>
                <td className="px-2 py-1.5 whitespace-nowrap font-mono text-label text-sdc-gray-600">{fmtDate(a.nextExpectedDelivery)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap font-mono text-label text-sdc-gray-600">{fmtDate(a.estimatedBuildableDate)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-xs text-sdc-gray-400">No assemblies found for this job.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
