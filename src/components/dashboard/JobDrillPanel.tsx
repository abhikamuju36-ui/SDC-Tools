"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { DrillPanel } from "@/components/ui/Drill";
import { SortableTh } from "@/components/ui/SortableHeader";
import { cycleSortState, sortRows, type SortColumns, type SortState } from "@/lib/table-sort";
import { loadActiveJobDrill } from "@/lib/dashboard-drill-actions";
import type { JobDrillFilter, JobDrillResult, JobDrillRow } from "@/lib/dashboard-job-drill";

// ── The inline drill-through under the Dashboard's two charts ───────────────
//
// Clicking a bar used to be a <Link> to /jobs?status=Active&customer=… — it left
// the Dashboard, so you lost the chart you were reading and had to come back to
// compare the next customer. The panel opens in place instead, directly under
// the charts, with the charts still on screen above it.
//
// State lives here, in ONE panel shared by both charts, rather than a panel per
// chart: clicking a customer and then a type has to REPLACE what is shown, not
// leave two tables open contradicting each other about what the page is
// currently about.
//
// ── Caching ─────────────────────────────────────────────────────────────────
//
// Results are memoised per filter for the life of the component, so re-opening
// a bar you already looked at is instant and issues no request. Deliberately
// NOT persisted beyond that: the job book changes under you, and a drill served
// from yesterday's cache disagreeing with today's bar is the exact defect this
// whole design is trying to avoid.
//
// A request that is superseded before it lands is dropped rather than rendered —
// clicking three customers quickly must not leave the third bar selected with
// the first customer's rows under it.

type SortKey = "jobId" | "jobName" | "customer" | "type" | "startDate" | "fatDate" | "owners" | "quotedHours" | "actualHours" | "etcHours";

const COLUMNS: SortColumns<JobDrillRow, SortKey> = {
  jobId: { type: "id", value: (r) => r.jobId },
  jobName: { type: "text", value: (r) => r.jobName },
  customer: { type: "text", value: (r) => r.customer },
  type: { type: "text", value: (r) => r.type },
  startDate: { type: "date", value: (r) => r.startDate },
  fatDate: { type: "date", value: (r) => r.fatDate },
  owners: { type: "text", value: (r) => [...r.meOwners, ...r.ceOwners].join(", ") },
  quotedHours: { type: "hours", value: (r) => r.quotedHours },
  actualHours: { type: "hours", value: (r) => r.actualHours },
  etcHours: { type: "hours", value: (r) => r.etcHours },
};

const HEADERS: { key: SortKey; label: string; align?: "right"; width: string }[] = [
  { key: "jobId", label: "Job #", width: "w-[5.5rem]" },
  { key: "jobName", label: "Project Name", width: "min-w-[16rem]" },
  { key: "customer", label: "Customer", width: "min-w-[11rem]" },
  { key: "type", label: "Type", width: "w-[6rem]" },
  { key: "startDate", label: "Start", width: "w-[6.5rem]" },
  { key: "fatDate", label: "FAT", width: "w-[6.5rem]" },
  { key: "owners", label: "ME / CE", width: "min-w-[12rem]" },
  { key: "quotedHours", label: "Quoted", align: "right", width: "w-[6rem]" },
  { key: "actualHours", label: "Actual", align: "right", width: "w-[6rem]" },
  { key: "etcHours", label: "ETC", align: "right", width: "w-[6rem]" },
];

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
function dateLabel(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return DATE.format(new Date(Date.UTC(y, m - 1, d)));
}
const hrs = (n: number | null): string => (n === null ? "—" : Math.round(n).toLocaleString("en-US"));

export function useJobDrill() {
  const [filter, setFilter] = useState<JobDrillFilter | null>(null);
  const [result, setResult] = useState<JobDrillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, JobDrillResult>());
  // Which request is current. A stale response compares unequal and is dropped.
  const latest = useRef(0);

  /**
   * Open the drill for a bar — or close it, if that same bar is already open.
   *
   * The fetch is kicked off HERE, in the event handler, rather than from a
   * useEffect watching `filter`. An effect would have to setState synchronously
   * on both the close path and the cache-hit path, which is the cascading-render
   * pattern the lint rule (and React's own "You Might Not Need an Effect") warns
   * about. Loading a drill is a reaction to a click, not a synchronisation with
   * an external system, so the click is where it belongs.
   */
  const close = useCallback(() => {
    // Bump the ticket so a response still in flight cannot land afterwards and
    // reopen a panel the user just closed.
    latest.current++;
    setFilter(null);
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  /**
   * Open the drill for a bar — or close it, if that same bar is already open.
   *
   * The fetch is kicked off HERE, in the event handler, rather than from a
   * useEffect watching `filter`. An effect would have to setState synchronously
   * on both the close path and the cache-hit path, which is the cascading-render
   * pattern React's "You Might Not Need an Effect" (and this repo's lint rule)
   * warns about. Loading a drill is a reaction to a click, not a synchronisation
   * with an external system, so the click is where it belongs.
   *
   * Note `setFilter` is called with a plain value, never an updater that also
   * fires other setState calls: an updater must be pure, and React invokes it
   * twice under StrictMode, which would have double-fired those side effects.
   */
  const toggle = useCallback(
    (next: JobDrillFilter) => {
      if (filter !== null && filter.kind === next.kind && filter.value === next.value) {
        close();
        return;
      }

      setFilter(next);

      const key = `${next.kind}::${next.value}`;
      const cached = cache.current.get(key);
      if (cached) {
        latest.current++;
        setResult(cached);
        setError(null);
        setLoading(false);
        return;
      }

      const ticket = ++latest.current;
      setLoading(true);
      setError(null);
      // The previous filter's rows are cleared immediately rather than left on
      // screen under the new heading, where they would read as the new bar's data.
      setResult(null);
      loadActiveJobDrill(next)
        .then((r) => {
          if (ticket !== latest.current) return;
          cache.current.set(key, r);
          setResult(r);
        })
        .catch((e: unknown) => {
          if (ticket !== latest.current) return;
          setError(e instanceof Error ? e.message : "Could not load these jobs.");
        })
        .finally(() => {
          if (ticket === latest.current) setLoading(false);
        });
    },
    [filter, close],
  );

  return {
    filter,
    result,
    loading,
    error,
    toggle,
    close,
    isOpen: (f: JobDrillFilter) => filter?.kind === f.kind && filter.value === f.value,
  };
}

export function JobDrillPanel({
  filter,
  result,
  loading,
  error,
  onClose,
  expectedCount,
}: {
  filter: JobDrillFilter;
  result: JobDrillResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  /** What the bar said. Rendered beside the row count so a mismatch is visible rather than silent. */
  expectedCount: number;
}) {
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "jobId", direction: "asc" });
  const rows = result ? sortRows(result.rows, sort, COLUMNS) : [];
  const reconciles = result === null || result.rows.length === expectedCount;

  return (
    <DrillPanel
      title={`Active Jobs — ${filter.value}`}
      meta={
        loading
          ? "Loading…"
          : result
            ? `${result.rows.length} job${result.rows.length === 1 ? "" : "s"}${
                reconciles ? "" : ` · chart says ${expectedCount}`
              }${result.schedulerAvailable ? "" : " · Scheduler unavailable, FAT dates omitted"}`
            : undefined
      }
      // Only ever shown when the drill and the bar disagree — which should be
      // impossible (both run ACTIVE_JOB_WHERE), so if it ever appears it is a
      // real defect and needs to be loud rather than quietly wrong.
      note={reconciles ? undefined : "This table and the chart disagree — please report it."}
      onClose={onClose}
      className="mt-3"
    >
      {error ? (
        <p className="px-4 py-6 text-sm text-sdc-red-text">{error}</p>
      ) : loading ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-sdc-muted">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-sdc-border border-t-sdc-blue" aria-hidden />
          Loading jobs…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-sdc-muted">No active jobs match.</p>
      ) : (
        // The TABLE scrolls sideways, not the Dashboard. DrillPanel already caps
        // the height and scrolls vertically (DRILL_CAP / DRILL_BODY), so this
        // only has to add the horizontal axis.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[70rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-sdc-border bg-white text-xs uppercase tracking-wide text-sdc-muted">
                {HEADERS.map((h) => (
                  <SortableTh
                    key={h.key}
                    label={h.label}
                    sortKey={h.key}
                    type={COLUMNS[h.key].type}
                    sort={sort}
                    onSort={(k) => setSort((s) => cycleSortState(s, k))}
                    className={`${h.width} whitespace-nowrap px-3 py-2 font-semibold`}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.jobId} className="border-b border-sdc-border-soft hover:bg-sdc-blue-light/25">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {/* The one link that still leaves the page — and it is a
                        deliberate destination the user asked for by clicking a
                        job number, not a side effect of opening the drill. */}
                    <Link href={`/jobs/${encodeURIComponent(r.jobId)}`} className="font-medium text-sdc-blue hover:underline">
                      {r.jobId}
                    </Link>
                  </td>
                  <td className="max-w-[22rem] truncate px-3 py-1.5 text-sdc-navy" title={r.jobName}>
                    {r.jobName}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-1.5 text-sdc-gray-700" title={r.customer}>
                    {r.customer}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-sdc-gray-700">{r.type}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-sdc-gray-700">{dateLabel(r.startDate)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-sdc-gray-700">{dateLabel(r.fatDate)}</td>
                  <td
                    className="max-w-[16rem] truncate px-3 py-1.5 text-sdc-gray-700"
                    title={[...r.meOwners, ...r.ceOwners].join(", ") || undefined}
                  >
                    {r.meOwners.length + r.ceOwners.length === 0 ? (
                      <span className="text-sdc-gray-400">—</span>
                    ) : (
                      [...r.meOwners, ...r.ceOwners].join(", ")
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-sdc-gray-700">{hrs(r.quotedHours)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-sdc-gray-700">{hrs(r.actualHours)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-sdc-gray-700">{hrs(r.etcHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DrillPanel>
  );
}
