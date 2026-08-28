"use client";

import { useMemo, useState } from "react";
import type { CustomerSummary } from "@/lib/dashboard-overview";
import { jobTypeColor, JOB_TYPE_LEGEND } from "@/lib/job-type-colors";

// ── Active Jobs by Customer, as a ranked bar chart (2026-08-28) ─────────────
//
// Replaces the card grid. Cards put every customer in a box of the same size,
// so a 9-job customer and a 1-job customer looked equally important and the
// only way to rank them was to read all 24 numbers. A ranked bar answers "who
// has the most active work" before you read anything.
//
// The type mix is not lost with the cards' chips — it IS the bar now. Each bar
// is segmented by project type, so a customer's mix is visible in the default
// view without a hover, and the segment colours are the same ones the Project
// Type chart above uses (lib/job-type-colors.ts). Exact per-type counts stay one
// hover away on each segment, and the expand row lists the job numbers.
//
// ── Why bars scale to the LARGEST customer, not to the active total ─────────
//
// Scaling to the total made every bar tiny (the biggest customer is ~15% of the
// book, so the longest bar filled a seventh of the track and the rest were
// slivers) — the exact "not enough width contrast to compare counts quickly"
// problem. Scaling to the largest customer uses the full track and makes the
// comparison the chart exists for legible. The percentage label is still
// percent-of-total, so nothing about the numbers changes; only the bar's scale
// is relative, and the header says so.

const TOP_CHOICES = [10, 15] as const;
type Scope = (typeof TOP_CHOICES)[number] | "all";

function CustomerRow({
  c,
  activeTotal,
  max,
  open,
  onOpen,
}: {
  c: CustomerSummary;
  activeTotal: number;
  max: number;
  /** True when THIS customer's drill-through is the one currently open below the charts. */
  open: boolean;
  onOpen: () => void;
}) {
  const pct = activeTotal === 0 ? 0 : Math.round((c.activeCount / activeTotal) * 1000) / 10;
  // Bar track width relative to the biggest customer; segments then divide THAT
  // width by type, so the segments always sum to exactly the bar.
  const trackPct = max === 0 ? 0 : (c.activeCount / max) * 100;

  return (
    // The WHOLE row is one control that opens this customer's jobs in the panel
    // below the charts. It was a <Link> to /jobs, which left the Dashboard and
    // lost the chart you were reading; a <button> both keeps you here and stops
    // the row being middle-clicked into a new tab.
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={open}
      aria-label={`Show the ${c.activeCount} active job${c.activeCount === 1 ? "" : "s"} for ${c.name}`}
      className={`block w-full text-left motion-interactive ${open ? "bg-sdc-blue-light" : "bg-white hover:bg-sdc-blue-light/25"}`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span title={c.name} className="w-40 shrink-0 truncate text-sm font-medium text-sdc-navy sm:w-48">
          {c.name}
          {c.internal && (
            <span
              className="ml-1.5 rounded bg-sdc-blue-light px-1 py-0.5 text-[0.6rem] font-semibold uppercase text-sdc-blue-dark"
              title="SDC's own internal work, not a customer relationship — counted because these are real active jobs"
            >
              Int
            </span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-sdc-gray-100">
            <span className="flex h-full" style={{ width: `${trackPct}%` }}>
              {c.byType.map((t) => (
                <span
                  key={t.type}
                  className={jobTypeColor(t.type).bar}
                  style={{ width: `${(t.count / c.activeCount) * 100}%` }}
                  title={`${c.name} — ${t.type}: ${t.count} active job${t.count === 1 ? "" : "s"}`}
                />
              ))}
            </span>
          </span>
          <span className="w-7 shrink-0 text-right font-heading text-sm font-bold tabular-nums text-sdc-navy">
            {c.activeCount}
          </span>
          <span className="w-11 shrink-0 text-right text-label tabular-nums text-sdc-gray-400">{pct}%</span>
        </span>
      </div>
    </button>
  );
}

export function CustomerBars({
  customers,
  activeTotal,
  onOpen,
  isOpen,
}: {
  customers: CustomerSummary[];
  activeTotal: number;
  onOpen: (customerName: string) => void;
  isOpen: (customerName: string) => boolean;
}) {
  const [scope, setScope] = useState<Scope>(10);

  // `customers` already arrives sorted by active count descending from
  // dashboard-overview.ts — the same order the cards used. Not re-sorted here,
  // so there is one ranking definition, not two.
  const shown = useMemo(() => (scope === "all" ? customers : customers.slice(0, scope)), [customers, scope]);
  const max = customers[0]?.activeCount ?? 0;
  const shownJobs = shown.reduce((s, c) => s + c.activeCount, 0);

  if (customers.length === 0) {
    return (
      <div className="rounded-xl border border-sdc-border bg-white p-5 text-sm text-sdc-gray-400 shadow-sm">
        No active jobs, so no customers to show.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-sdc-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-sdc-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {JOB_TYPE_LEGEND.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-label text-sdc-gray-600">
              <span className={`inline-block h-2 w-2 rounded-sm ${jobTypeColor(t).swatch}`} aria-hidden />
              {t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="How many customers to show">
          {TOP_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScope(n)}
              aria-pressed={scope === n}
              disabled={customers.length <= n}
              className={`rounded-md px-2 py-0.5 text-label font-semibold motion-interactive disabled:opacity-40 ${
                scope === n ? "bg-sdc-blue text-white" : "text-sdc-gray-600 hover:bg-sdc-blue-light"
              }`}
            >
              Top {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setScope("all")}
            aria-pressed={scope === "all"}
            className={`rounded-md px-2 py-0.5 text-label font-semibold motion-interactive ${
              scope === "all" ? "bg-sdc-blue text-white" : "text-sdc-gray-600 hover:bg-sdc-blue-light"
            }`}
          >
            All {customers.length}
          </button>
        </div>
      </div>

      {/* Capped height with its own scroll — "show all" must not be able to make
          the Dashboard several screens tall. ~24 customers today, so Top 10 fits
          without scrolling and only "All" engages it. */}
      <div className="max-h-[26rem] divide-y divide-sdc-border-soft overflow-y-auto">
        {shown.map((c) => (
          <CustomerRow
            key={c.name}
            c={c}
            activeTotal={activeTotal}
            max={max}
            open={isOpen(c.name)}
            onOpen={() => onOpen(c.name)}
          />
        ))}
      </div>

      <p className="border-t border-sdc-border px-3 py-1.5 text-label text-sdc-gray-400">
        {scope === "all"
          ? `All ${customers.length} customers · ${shownJobs} of ${activeTotal} active jobs`
          : `Top ${shown.length} of ${customers.length} customers · ${shownJobs} of ${activeTotal} active jobs`}
        {" · bar length is relative to the largest customer; % is of the active book"}
      </p>
    </div>
  );
}
