// Shared types for the Build Readiness dashboard — no I/O, no React. Both the
// write path (build-readiness-sync.ts, which computes these from a live
// getJobBom() using job-bom-rules.ts's canonical functions) and the read path
// (build-readiness-actions.ts, build-readiness-forecast.ts) import from here so
// the two sides can never quietly disagree about shape.

import type { ReleaseStatus, Vendor } from "./job-bom";

export type BlockerReason =
  | "no_po"
  | "past_due"
  | "on_hold"
  | "inventory_shortage"
  | "supplier_delay"
  | "missing_expected_date"
  | "awaiting_release";

export const BLOCKER_REASON_LABEL: Record<BlockerReason, string> = {
  no_po: "No PO / uncovered",
  past_due: "Past due",
  on_hold: "On hold",
  inventory_shortage: "Inventory shortage",
  supplier_delay: "Supplier delay",
  missing_expected_date: "Missing expected date",
  awaiting_release: "Awaiting release / assembly release issue",
};

export type BlockerEntry = {
  reason: BlockerReason;
  jobId: string;
  jobName: string;
  assemblyKey: string;
  assemblyLabel: string;
  partPn: string;
  partDesc: string;
  supplier: string | null;
  materialValue: number;
  daysLate: number | null;
  expectedDate: string | null;
};

// One row per BOM node (assembly, or a section's synthetic "Loose parts"
// bucket) — the drill-down table's own row shape, and what "What Can We Build
// Now" filters down to `buildableQty > 0`.
export type AssemblyDetail = {
  key: string;
  pn: string;
  label: string;
  release: ReleaseStatus;
  requiredQty: number;
  coveredQty: number;
  readinessPct: number;
  buildableQty: number | null; // null = no own buildable "unit" concept (see job-bom-rules.ts's buildableQtyFor)
  buildablePct: number | null;
  limitingParts: { pn: string; available: number; required: number }[];
  missingParts: number;
  onOrderParts: number;
  pastDueParts: number;
  materialValue: number;
  nextExpectedDelivery: string | null;
  // Earliest date by which every current limiting part is expected — a
  // best-effort "when does this stop being the bottleneck" answer, null when
  // there's nothing left limiting it (already fully buildable) or no expected
  // date exists for a limiting part yet.
  estimatedBuildableDate: string | null;
};

export type UpcomingDeliveryEntry = {
  jobId: string;
  jobName: string;
  poNumber: string | null;
  supplier: string | null;
  expectedDate: string;
  assemblyKey: string;
  assemblyLabel: string;
  incomingParts: { pn: string; qty: number }[];
  buildableBefore: number | null;
  buildableAfter: number | null;
};

export type JobDetail = {
  assemblies: AssemblyDetail[];
  vendors: Vendor[];
  blockers: BlockerEntry[];
  upcoming: UpcomingDeliveryEntry[];
};

// The full row this dashboard reads per job — mirrors BuildReadinessJobSnapshot
// 1:1 (detailJson parsed back into JobDetail).
export type JobSnapshotRow = {
  jobId: string;
  jobName: string;
  customer: string | null;
  status: "ok" | "failed" | "empty";
  overallReadinessPct: number;
  assembliesTotal: number;
  assembliesReady: number;
  assembliesPartial: number;
  assembliesBlocked: number;
  partsUncovered: number;
  partsOnOrder: number;
  partsPastDue: number;
  partsDueSoon7d: number;
  materialValueTotal: number;
  materialValueAtRisk: number;
  nextUnlockDate: string | null;
  detail: JobDetail;
  computedAt: string;
};

export type RefreshMetaRow = {
  status: "idle" | "running" | "ok" | "partial";
  startedAt: string | null;
  completedAt: string | null;
  jobsTotal: number;
  jobsDone: number;
  jobsFailed: number;
  triggeredByName: string | null;
  durationMs: number | null;
};

export type BuildReadinessFilters = {
  query?: string; // free-text match against job id/name
  customers?: string[];
  statuses?: string[]; // readiness band: "green" | "yellow" | "red" | "grey"
  suppliers?: string[];
  assemblyQuery?: string; // free-text match against assembly pn/label
};

export type BuildReadinessData = {
  meta: RefreshMetaRow;
  jobs: JobSnapshotRow[]; // already filtered
};

export type ReadinessBand = "green" | "yellow" | "red" | "grey";

// Same thresholds JobProcurement.tsx's own `barClasses` already uses (>=90
// green, >=60 yellow, else red) — grey is this dashboard's own addition for
// "not applicable": a job with no released BOM at all (nothing to explode) or
// whose last live refresh failed, neither of which barClasses ever has to
// represent since JobProcurement always has SOME bom result once it renders.
export function readinessBand(j: Pick<JobSnapshotRow, "status" | "overallReadinessPct">): ReadinessBand {
  if (j.status !== "ok") return "grey";
  if (j.overallReadinessPct >= 90) return "green";
  if (j.overallReadinessPct >= 60) return "yellow";
  return "red";
}

export type SupplierRiskRow = {
  supplier: string;
  openPOs: number;
  partsOutstanding: number;
  pastDue: number;
  avgDaysLate: number | null;
  assembliesBlocked: number;
  projectsAffected: number;
  materialValue: number;
};

export type ForecastWeek = {
  week: number; // 1-8
  assembliesBuildableCumulative: number;
  cumulativeBuildablePct: number; // 0-100
  partsArriving: number;
  assembliesUnlocked: number; // newly crossed to fully-buildable in THIS week
  projectsReaching100: number; // newly all-ready in THIS week
};
