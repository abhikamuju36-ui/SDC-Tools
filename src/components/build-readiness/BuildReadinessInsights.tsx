"use client";

import { useMemo, useState } from "react";
import { usd } from "@/components/ui/format";
import { useColumnSort } from "@/components/useColumnSort";
import { SortableTh } from "@/components/ui/SortableHeader";
import { sortRows, type SortColumns } from "@/lib/table-sort";
import { type JobSnapshotRow, type BlockerReason, type SupplierRiskRow, BLOCKER_REASON_LABEL } from "@/lib/build-readiness-types";
import { computeUpcomingUnlocks, computeSupplierRisk, computeReadinessForecast } from "@/lib/build-readiness-forecast";

function num(n: number): string {
  return Math.round(n).toLocaleString();
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-sdc-border bg-white shadow-sm">
      <div className="border-b border-sdc-border-soft bg-sdc-gray-100 px-4 py-2">
        <span className="text-sm font-bold text-sdc-navy">{title}</span>
        {subtitle && <span className="ml-2 text-note text-sdc-gray-500">{subtitle}</span>}
      </div>
      <div className="max-h-[360px] overflow-auto">{children}</div>
    </div>
  );
}

// ── What Can We Build Now ────────────────────────────────────────────────────

type BuildableRow = { jobId: string; jobName: string; assemblyKey: string; label: string; buildableQty: number; requiredQty: number; readinessPct: number; materialValue: number; riskCount: number };
type BuildableSortKey = "job" | "assembly" | "buildable" | "required" | "readiness" | "material" | "risk";
const BUILDABLE_COLUMNS: SortColumns<BuildableRow, BuildableSortKey> = {
  job: { type: "id", value: (r) => r.jobId },
  assembly: { type: "text", value: (r) => r.label },
  buildable: { type: "number", value: (r) => r.buildableQty },
  required: { type: "number", value: (r) => r.requiredQty },
  readiness: { type: "number", value: (r) => r.readinessPct },
  material: { type: "currency", value: (r) => r.materialValue },
  risk: { type: "number", value: (r) => r.riskCount },
};

function WhatCanWeBuildNow({ jobs }: { jobs: JobSnapshotRow[] }) {
  const sort = useColumnSort<BuildableSortKey>({ key: "material", direction: "desc" });
  const rows = useMemo<BuildableRow[]>(() => {
    const out: BuildableRow[] = [];
    for (const j of jobs) {
      const blockersByAsm = new Map<string, number>();
      for (const b of j.detail.blockers) blockersByAsm.set(b.assemblyKey, (blockersByAsm.get(b.assemblyKey) ?? 0) + 1);
      for (const a of j.detail.assemblies) {
        if (a.buildableQty == null || a.buildableQty <= 0) continue;
        out.push({
          jobId: j.jobId,
          jobName: j.jobName,
          assemblyKey: a.key,
          label: a.label,
          buildableQty: a.buildableQty,
          requiredQty: a.requiredQty,
          readinessPct: a.readinessPct,
          materialValue: a.materialValue,
          riskCount: blockersByAsm.get(a.key) ?? 0,
        });
      }
    }
    return out;
  }, [jobs]);
  const sorted = useMemo(() => sortRows(rows, sort.sort, BUILDABLE_COLUMNS), [rows, sort.sort]);

  return (
    <SectionCard title="What Can We Build Now" subtitle={`${rows.length} assemblies`}>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
            <SortableTh label="Job" sortKey="job" type="id" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
            <SortableTh label="Assembly" sortKey="assembly" type="text" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Buildable" sortKey="buildable" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Required" sortKey="required" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Readiness" sortKey="readiness" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Material $" sortKey="material" type="currency" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Risk" sortKey="risk" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.jobId}-${r.assemblyKey}`} className="border-b border-sdc-border-soft/60">
              <td className="px-3 py-1.5 font-mono text-note font-semibold text-sdc-blue">{r.jobId}</td>
              <td className="px-2 py-1.5 text-note text-sdc-navy">{r.label}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums text-sdc-green-text">{num(r.buildableQty)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-600">{num(r.requiredQty)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{r.readinessPct}%</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{usd(r.materialValue)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-gray-500">{r.riskCount || "—"}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-sdc-gray-400">Nothing is buildable right now.</td></tr>
          )}
        </tbody>
      </table>
    </SectionCard>
  );
}

// ── Top Blockers ─────────────────────────────────────────────────────────────

type BlockerGroupRow = { reason: BlockerReason; projects: number; assemblies: number; parts: number; materialValue: number; avgDaysLate: number | null };
type BlockerSortKey = "reason" | "projects" | "assemblies" | "parts" | "material" | "daysLate";
const BLOCKER_COLUMNS: SortColumns<BlockerGroupRow, BlockerSortKey> = {
  reason: { type: "text", value: (r) => BLOCKER_REASON_LABEL[r.reason] },
  projects: { type: "number", value: (r) => r.projects },
  assemblies: { type: "number", value: (r) => r.assemblies },
  parts: { type: "number", value: (r) => r.parts },
  material: { type: "currency", value: (r) => r.materialValue },
  daysLate: { type: "number", value: (r) => r.avgDaysLate },
};

function TopBlockers({ jobs }: { jobs: JobSnapshotRow[] }) {
  const sort = useColumnSort<BlockerSortKey>({ key: "material", direction: "desc" });
  const rows = useMemo<BlockerGroupRow[]>(() => {
    const byReason = new Map<BlockerReason, { projects: Set<string>; assemblies: Set<string>; parts: number; materialValue: number; daysLateSum: number; daysLateCount: number }>();
    for (const j of jobs) {
      for (const b of j.detail.blockers) {
        let g = byReason.get(b.reason);
        if (!g) {
          g = { projects: new Set(), assemblies: new Set(), parts: 0, materialValue: 0, daysLateSum: 0, daysLateCount: 0 };
          byReason.set(b.reason, g);
        }
        g.projects.add(j.jobId);
        g.assemblies.add(`${j.jobId}:${b.assemblyKey}`);
        g.parts++;
        g.materialValue += b.materialValue;
        if (b.daysLate != null) {
          g.daysLateSum += b.daysLate;
          g.daysLateCount++;
        }
      }
    }
    return [...byReason.entries()].map(([reason, g]) => ({
      reason,
      projects: g.projects.size,
      assemblies: g.assemblies.size,
      parts: g.parts,
      materialValue: g.materialValue,
      avgDaysLate: g.daysLateCount ? Math.round(g.daysLateSum / g.daysLateCount) : null,
    }));
  }, [jobs]);
  const sorted = useMemo(() => sortRows(rows, sort.sort, BLOCKER_COLUMNS), [rows, sort.sort]);

  return (
    <SectionCard title="Top Blockers" subtitle={`${rows.reduce((s, r) => s + r.parts, 0)} parts blocked`}>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
            <SortableTh label="Reason" sortKey="reason" type="text" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
            <SortableTh label="Projects" sortKey="projects" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Assemblies" sortKey="assemblies" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Parts" sortKey="parts" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Material $" sortKey="material" type="currency" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Avg Days Late" sortKey="daysLate" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.reason} className="border-b border-sdc-border-soft/60">
              <td className="px-3 py-1.5 text-note font-semibold text-sdc-navy">{BLOCKER_REASON_LABEL[r.reason]}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(r.projects)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(r.assemblies)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums text-sdc-red-text">{num(r.parts)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{usd(r.materialValue)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{r.avgDaysLate != null ? `${r.avgDaysLate}d` : "—"}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-sdc-gray-400">No blockers across active projects.</td></tr>
          )}
        </tbody>
      </table>
    </SectionCard>
  );
}

// ── Upcoming Unlocks ─────────────────────────────────────────────────────────

function UpcomingUnlocks({ jobs, now }: { jobs: JobSnapshotRow[]; now: number }) {
  const [week, setWeek] = useState(1);
  const rows = useMemo(() => computeUpcomingUnlocks(jobs, week, now), [jobs, week, now]);

  return (
    <SectionCard
      title="Upcoming Unlocks"
      subtitle={
        <span className="ml-2 inline-flex gap-0.5 align-middle">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((w) => (
            <button key={w} type="button" onClick={() => setWeek(w)} className={`rounded px-1.5 py-0.5 text-note font-semibold ${w === week ? "bg-sdc-blue text-white" : "bg-sdc-blue-light text-sdc-blue-dark hover:bg-sdc-blue-100"}`}>
              {w}W
            </button>
          ))}
        </span>
      }
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
            <th className="px-3 py-2">Expected</th>
            <th className="px-2 py-2">PO</th>
            <th className="px-2 py-2">Supplier</th>
            <th className="px-2 py-2">Job</th>
            <th className="px-2 py-2">Incoming</th>
            <th className="px-2 py-2">Assembly</th>
            <th className="px-2 py-2">Buildable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.jobId}-${r.assemblyKey}-${i}`} className="border-b border-sdc-border-soft/60">
              <td className="px-3 py-1.5 whitespace-nowrap font-mono text-label text-sdc-gray-600">{fmtDate(r.expectedDate)}</td>
              <td className="px-2 py-1.5 font-mono text-note font-semibold text-sdc-blue">{r.poNumber ?? "No PO"}</td>
              <td className="px-2 py-1.5 text-note text-sdc-navy">{r.supplier ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono text-note text-sdc-gray-600">{r.jobId}</td>
              <td className="px-2 py-1.5 text-note text-sdc-gray-600">{r.incomingParts.map((p) => `+${p.qty} ${p.pn}`).join(", ")}</td>
              <td className="px-2 py-1.5 text-note text-sdc-navy">{r.assemblyLabel}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note font-semibold tabular-nums">
                {r.buildableBefore ?? "—"} → <span className="text-sdc-green-text">{r.buildableAfter ?? "—"}</span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-sdc-gray-400">No parts expected in week {week}.</td></tr>
          )}
        </tbody>
      </table>
    </SectionCard>
  );
}

// ── Supplier Risk ────────────────────────────────────────────────────────────

type SupplierSortKey = "supplier" | "openPOs" | "outstanding" | "pastDue" | "avgDaysLate" | "assemblies" | "projects" | "material";
const SUPPLIER_COLUMNS: SortColumns<SupplierRiskRow, SupplierSortKey> = {
  supplier: { type: "text", value: (r) => r.supplier },
  openPOs: { type: "number", value: (r) => r.openPOs },
  outstanding: { type: "number", value: (r) => r.partsOutstanding },
  pastDue: { type: "number", value: (r) => r.pastDue },
  avgDaysLate: { type: "number", value: (r) => r.avgDaysLate },
  assemblies: { type: "number", value: (r) => r.assembliesBlocked },
  projects: { type: "number", value: (r) => r.projectsAffected },
  material: { type: "currency", value: (r) => r.materialValue },
};

function SupplierRisk({ jobs }: { jobs: JobSnapshotRow[] }) {
  const sort = useColumnSort<SupplierSortKey>({ key: "material", direction: "desc" });
  const rows = useMemo(() => computeSupplierRisk(jobs), [jobs]);
  const sorted = useMemo(() => sortRows(rows, sort.sort, SUPPLIER_COLUMNS), [rows, sort.sort]);

  return (
    <SectionCard title="Supplier Risk" subtitle={`${rows.length} suppliers`}>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
            <SortableTh label="Supplier" sortKey="supplier" type="text" sort={sort.sort} onSort={sort.onSort} className="px-3 py-2" />
            <SortableTh label="Open POs" sortKey="openPOs" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Outstanding" sortKey="outstanding" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Past Due" sortKey="pastDue" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Avg Days Late" sortKey="avgDaysLate" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Assemblies Blocked" sortKey="assemblies" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Projects" sortKey="projects" type="number" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
            <SortableTh label="Material $" sortKey="material" type="currency" sort={sort.sort} onSort={sort.onSort} className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.supplier} className="border-b border-sdc-border-soft/60">
              <td className="px-3 py-1.5 text-note font-semibold text-sdc-navy">{r.supplier}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(r.openPOs)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(r.partsOutstanding)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-red-text">{r.pastDue || "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{r.avgDaysLate != null ? `${r.avgDaysLate}d` : "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{r.assembliesBlocked || "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{r.projectsAffected}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{usd(r.materialValue)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-sdc-gray-400">No supplier data yet.</td></tr>
          )}
        </tbody>
      </table>
    </SectionCard>
  );
}

// ── 8-Week Readiness Forecast ────────────────────────────────────────────────

function ReadinessForecast({ jobs, now }: { jobs: JobSnapshotRow[]; now: number }) {
  const weeks = useMemo(() => computeReadinessForecast(jobs, now), [jobs, now]);
  return (
    <SectionCard title="8-Week Readiness Forecast">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-sdc-navy text-micro font-bold uppercase tracking-wider text-white">
            <th className="px-3 py-2">Week</th>
            <th className="px-2 py-2">Assemblies Buildable</th>
            <th className="px-2 py-2">Cumulative %</th>
            <th className="px-2 py-2">Parts Arriving</th>
            <th className="px-2 py-2">Unlocked</th>
            <th className="px-2 py-2">Projects → 100%</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week} className="border-b border-sdc-border-soft/60">
              <td className="px-3 py-1.5 font-semibold text-sdc-navy">{w.week}W</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(w.assembliesBuildableCumulative)}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sdc-gray-100">
                    <div className="h-full rounded-full bg-sdc-green" style={{ width: `${w.cumulativeBuildablePct}%` }} />
                  </div>
                  <span className="font-mono text-note tabular-nums">{w.cumulativeBuildablePct}%</span>
                </div>
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{num(w.partsArriving)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums text-sdc-green-text">{w.assembliesUnlocked || "—"}</td>
              <td className="px-2 py-1.5 text-right font-mono text-note tabular-nums">{w.projectsReaching100 || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}

export function BuildReadinessInsights({ jobs }: { jobs: JobSnapshotRow[] }) {
  const now = useMemo(() => Date.now(), []);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <WhatCanWeBuildNow jobs={jobs} />
        <TopBlockers jobs={jobs} />
      </div>
      <UpcomingUnlocks jobs={jobs} now={now} />
      <SupplierRisk jobs={jobs} />
      <ReadinessForecast jobs={jobs} now={now} />
    </div>
  );
}
