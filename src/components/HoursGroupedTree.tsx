"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRealtimeChanges } from "@/components/RealtimeProvider";
import { sequenced } from "@/lib/request-sequence";
import { loadHoursGroupChildren } from "@/lib/hours-actions";
import { narrowFiltersForGroupValue, type HoursFilters, type HoursGroupBy } from "@/lib/hours-filters";
import type { HoursGroupRow } from "@/lib/hours-explorer";
import { useColumnSort } from "@/components/useColumnSort";
import { sortRows, type SortColumns } from "@/lib/table-sort";
import { SortableTh } from "@/components/ui/SortableHeader";

// A nested, expandable rollup — Excel PivotTable "compact form", not Drill.tsx's flat
// N-side-by-side-columns shape (that shape assumes every row fills all N dimensions,
// which a variable-depth tree never does). One "Group" column (caret + label, indented
// by depth) + Punches + Hours, rendered as flat sibling <tr>s under one <tbody> — real
// nested <table>s inside cells would work but aren't semantic and complicate styling
// for no benefit here.
//
// Every row's numbers come from its OWN independent server aggregate query
// (queryHoursGrouped, via loadHoursGroupChildren) — never a client-side re-sum of
// children — so a parent's total is correct regardless of whether or how much of its
// subtree has been fetched. Level 0 is computed server-side in page.tsx exactly like
// the old single-dimension view; every deeper level is fetched lazily, on expand.
//
// ── The realtime-refresh interaction ─────────────────────────────────────────
//
// (app)/layout.tsx mounts <LiveRefresh/> app-wide, which re-renders this page (fresh
// `rootRows`) on tab focus and on a background interval whenever ANYONE changes
// ANYTHING. Two things follow:
//   - page.tsx remounts this component (via a content-derived `key`) only when
//     `filters`/`groupByLevels` themselves change — a routine refresh must NOT
//     collapse every open node, which a naive remount-on-every-render would do.
//   - This component must still notice that its OWN `children` cache can go stale
//     under an open node when nothing about `filters`/`groupByLevels` changed. Simply
//     excluding `children` from the refetch effect's deps (as EtcMonthKpiCards' single-
//     slot "Parts" drill cache first looked like it did) turns out not to generalize
//     here: that effect's OWN dependency list includes its cache variable (`parts`)
//     precisely so clearing it retriggers the fetch. This effect does the same —
///    depends on `children` as well as `expanded`, guarded so it only ever fetches
//     what's actually missing.

type GroupStep = { groupBy: HoursGroupBy; value: string };
type GroupPath = GroupStep[];

// JSON, not a joined string — a job id, employee id or section code could in
// principle collide across a plain separator.
function pathKey(path: GroupPath): string {
  return JSON.stringify(path.map((s) => [s.groupBy, s.value]));
}

type SortKey = "group" | "punches" | "hours";

const SORT_COLUMNS: SortColumns<HoursGroupRow, SortKey> = {
  group: { type: "text", value: (r) => r.label },
  punches: { type: "number", value: (r) => r.punchCount },
  hours: { type: "hours", value: (r) => r.hours },
};

const TD = "border-b border-sdc-border-soft px-3 py-1.5 text-sm text-sdc-navy";
const TD_NUM = "border-b border-sdc-border-soft px-3 py-1.5 text-right font-mono text-sm tabular-nums text-sdc-navy";

function fmtHours(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="9"
      height="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden
      className={`shrink-0 opacity-60 motion-interactive ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 3.5 L10.5 8 L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HoursGroupedTree({
  rootRows,
  groupByLevels,
  filters,
}: {
  rootRows: HoursGroupRow[];
  groupByLevels: HoursGroupBy[];
  filters: HoursFilters;
}) {
  const sortState = useColumnSort<SortKey>();
  // `expanded` maps a node's pathKey -> the actual path, so a node's ancestor chain
  // never needs reverse-parsing out of its own serialized key.
  const [expanded, setExpanded] = useState<Map<string, GroupPath>>(new Map());
  const [children, setChildren] = useState<Map<string, HoursGroupRow[]>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  // Its `isPending` is unused — this exists purely so the auto-refetch effect below can
  // hand its fetch off through `startTransition`, which is the sanctioned way to defer
  // a state update out of an effect's own synchronous call stack (the same device
  // EtcMonthKpiCards' drills use for the identical shape of fetch-on-open effect).
  const [, startFetchTransition] = useTransition();
  // Deliberately no separate `loading` state: "this row is loading" is fully derived —
  // open, no cached children yet, no error yet (see renderLevel) — rather than tracked,
  // so fetchChildren has nothing to set synchronously before its first `await`. Calling
  // setState synchronously inside the effect below (via a function that sets loading
  // BEFORE awaiting) is exactly what react-hooks/set-state-in-effect flags; the fix
  // mirrors EtcMonthKpiCards' own drills, which get their pending flag from
  // useTransition rather than a hand-rolled pre-await setState.

  async function fetchChildren(path: GroupPath, key: string) {
    let narrowed = filters;
    for (const step of path) narrowed = narrowFiltersForGroupValue(narrowed, step.groupBy, step.value);
    const nextDim = groupByLevels[path.length];
    const out = await sequenced(`hours-group:${key}`, key, () => loadHoursGroupChildren(narrowed, nextDim));
    if (out.ok) {
      setChildren((prev) => new Map(prev).set(key, out.value));
      setErrors((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } else if (out.reason === "error") {
      setErrors((prev) => new Map(prev).set(key, out.error instanceof Error ? out.error.message : "Could not load this group."));
    }
  }

  function toggle(path: GroupPath, key: string) {
    const willOpen = !expanded.has(key);
    setExpanded((prev) => {
      const next = new Map(prev);
      if (willOpen) next.set(key, path);
      else next.delete(key);
      return next;
    });
    if (willOpen && !children.has(key)) void fetchChildren(path, key);
  }

  // Routine background refresh (LiveRefresh, any colleague's change) invalidates the
  // fetched-children cache — NOT `expanded` (an open node must stay open) — so stale
  // numbers under an open node can't linger after the top-level rootRows prop moves on.
  const changes = useRealtimeChanges();
  const seenChanges = useRef(changes.length);
  useEffect(() => {
    if (changes.length === seenChanges.current) return;
    seenChanges.current = changes.length;
    setChildren(new Map());
    setErrors(new Map());
  }, [changes.length]);

  // Refetches whatever's open but missing its cache entry — on a fresh expand AND
  // after the invalidation above clears it. Depends on `children` as well as
  // `expanded`: excluding it would mean the effect above clearing the cache never
  // retriggers a refetch, since clearing `children` alone doesn't touch `expanded`.
  // Guarded so this can't loop: each key is excluded from the sweep the instant it's
  // cached or errored. A key already in flight gets called again on a re-run (there's
  // no separate loading flag to skip it on) — harmless: sequenced() joins an identical
  // in-flight request rather than issuing a second one.
  useEffect(() => {
    for (const [key, path] of expanded) {
      if (children.has(key) || errors.has(key)) continue;
      startFetchTransition(() => {
        void fetchChildren(path, key);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, children]);

  function renderLevel(rows: HoursGroupRow[], path: GroupPath, depth: number): React.ReactNode[] {
    const levelDim = groupByLevels[depth];
    const canExpand = depth + 1 < groupByLevels.length;
    const sorted = sortRows(rows, sortState.sort, SORT_COLUMNS);
    return sorted.flatMap((row) => {
      const nodePath = [...path, { groupBy: levelDim, value: row.key }];
      const key = pathKey(nodePath);
      const isOpen = expanded.has(key);
      const out: React.ReactNode[] = [
        <tr key={key} className="hover:bg-sdc-gray-50">
          <td className={TD} style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
            {canExpand ? (
              <button
                type="button"
                onClick={() => toggle(nodePath, key)}
                aria-expanded={isOpen}
                className="inline-flex items-center gap-1.5 text-left motion-interactive hover:opacity-70"
              >
                <Caret open={isOpen} />
                <span>{row.label}</span>
              </button>
            ) : (
              row.label
            )}
          </td>
          <td className={TD_NUM}>{row.punchCount.toLocaleString()}</td>
          <td className={TD_NUM}>{fmtHours(row.hours)}</td>
        </tr>,
      ];
      if (canExpand && isOpen) {
        if (errors.has(key)) {
          out.push(
            <tr key={`${key}:error`}>
              <td colSpan={3} className="px-3 py-1.5 text-xs" style={{ paddingLeft: `${0.75 + (depth + 1) * 1.25}rem` }}>
                <span className="font-medium text-sdc-red-text">{errors.get(key)}</span>{" "}
                <button type="button" onClick={() => void fetchChildren(nodePath, key)} className="font-medium text-sdc-blue hover:underline">
                  Retry
                </button>
              </td>
            </tr>,
          );
        } else if (!children.has(key)) {
          // Open, no cached children, no error — the fetch is in flight (or about to
          // be, via the effect above). See the state note in the component body for
          // why this is derived rather than a separate `loading` state.
          out.push(
            <tr key={`${key}:loading`}>
              <td colSpan={3} className="px-3 py-1.5 text-xs text-sdc-muted" style={{ paddingLeft: `${0.75 + (depth + 1) * 1.25}rem` }}>
                Loading…
              </td>
            </tr>,
          );
        } else {
          const kids = children.get(key);
          if (kids) out.push(...renderLevel(kids, nodePath, depth + 1));
        }
      }
      return out;
    });
  }

  const rootTotal = rootRows.reduce((s, r) => s + r.hours, 0);
  const rootPunches = rootRows.reduce((s, r) => s + r.punchCount, 0);

  return (
    <div className="styled-scrollbar overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <SortableTh label="Group" sortKey="group" type="text" sort={sortState.sort} onSort={sortState.onSort} className="border-b border-sdc-border px-3 py-1.5 text-label font-semibold uppercase tracking-[0.08em] text-sdc-muted" />
            <SortableTh label="Punches" sortKey="punches" type="number" sort={sortState.sort} onSort={sortState.onSort} className="border-b border-sdc-border px-3 py-1.5 text-label font-semibold uppercase tracking-[0.08em] text-sdc-muted" />
            <SortableTh label="Hours" sortKey="hours" type="hours" sort={sortState.sort} onSort={sortState.onSort} className="border-b border-sdc-border px-3 py-1.5 text-label font-semibold uppercase tracking-[0.08em] text-sdc-muted" />
          </tr>
        </thead>
        <tbody>{renderLevel(rootRows, [], 0)}</tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="px-3 py-1.5 text-sm text-sdc-navy">{`TOTAL (${rootRows.length})`}</td>
            <td className={TD_NUM}>{rootPunches.toLocaleString()}</td>
            <td className={TD_NUM}>{fmtHours(rootTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
