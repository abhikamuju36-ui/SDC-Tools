"use client";

// "Standard Fees By Department" side panel for the Monthly ETC grid's unlocked
// Standard view — mirrors the Excel sheet's department pool block (rows 71-108)
// and hosts the Standard Sheet workflow (Refresh from Power BI, edit the
// manual pulled-hours cell, Submit/Lock the month, Reopen). Replaces the
// retired /standard-sheet tab. Collapsible via the header title button.
//
// Excel parity: "Hours being pulled" (D76…) is the one manual cell surfaced
// here; "New ETC Hours" (=Available−Pulled, D77) is a formula. Rate (D78) and
// Standard Fee (D79) still live in StandardRatesProvider/CategoryPool.rate —
// just no longer shown or editable per-department here, since rates are set
// globally via the "ETC Rates" toolbar button instead. The pulled cell lives
// in StandardRatesProvider, so editing it here recomputes this block AND
// every job row's Standard Fee on the grid live — the sheet's cross-linked
// formulas.

import { useState } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/classnames";
import { ReopenMonthButton } from "@/components/ReopenMonthButton";
import { useStandardPoolCell, useStandardPoolTotals, useStandardPoolDirty } from "@/components/EtcStandardColumns";

export type PoolPanelRow = {
  category: string;
  group: string; // "Engineering" | "Shop"
  dept: string; // "PM" | "Warranty" | "Manufacturing"
  previousMonthPulledHours: number;
  newHoursAddedThisMonth: number;
  hoursAvailable: number;
  hoursWorkedThisMonth: number;
  hoursPulledThisMonth: number;
  rate: number;
  newEtcHours: number;
  standardFee: number;
  hasData: boolean;
};

// One project behind the "New Hours Added this Month" figures above. Mirrors
// NewPoolProject in standard-pool-local.ts, which is where these are computed.
export type NewProjectRow = {
  jobId: string;
  jobName: string;
  startDate: string;
  hours: Record<string, number>;
  total: number;
};

// The four pool columns of the new-projects table, in display order: the two
// standalone departments first, then the two warranty pools under a shared
// "War" header with Eng/Shop beneath it. Grouping them that way (rather than
// four flat columns in the department blocks' own order) puts the two figures
// people compare side by side and buys back the width that "War E"/"War S"
// spent repeating the word.
//
// `head` is abbreviated hard because five columns have to fit a 320px panel;
// `full` carries the real name into each header's tooltip.
type PoolColumn = { category: string; head: string; full: string; group?: string };
const POOL_COLUMNS: PoolColumn[] = [
  { category: "ENGINEERING_PM", head: "PM", full: "Engineering — PM" },
  { category: "SHOP_MANUFACTURING", head: "Mfg", full: "Shop — Manufacturing" },
  { category: "ENGINEERING_WARRANTY", head: "Eng", full: "Warranty — Engineering", group: "War" },
  { category: "SHOP_WARRANTY", head: "Shop", full: "Warranty — Shop", group: "War" },
];
// Split once, so the two header rows and the body can't fall out of step with
// each other or with the order above.
const PLAIN_COLUMNS = POOL_COLUMNS.filter((c) => !c.group);
const WAR_COLUMNS = POOL_COLUMNS.filter((c) => c.group);
const POOL_ORDER = POOL_COLUMNS.map((c) => c.category);
// A rule down the left of the warranty pair, so the span above it reads as a
// group rather than as a stray label.
const groupEdge = (c: PoolColumn) => (c.category === WAR_COLUMNS[0]?.category ? "border-l border-sdc-border" : "");

function whole(n: number): string {
  return Math.round(n).toLocaleString();
}
function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
// Cents-precision counterpart to currency() above, for tooltips.
function currencyExact(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
// whole() rounds to the nearest hour for display — the tooltip shows the
// exact figure in case a pool value carries a fraction (e.g. synced from
// Power BI).
function exactHours(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const GROUP_TINT: Record<string, string> = {
  Engineering: "bg-[#DCE6F1]",
  Shop: "bg-[#F2DDD3]",
};
const INPUT = "w-20 rounded border border-sdc-border px-1.5 py-0.5 text-right text-xs outline-none focus:border-sdc-blue";

export function StandardPoolPanel({
  month,
  carriedFrom,
  upstreamNote,
  rows,
  newProjects,
  isSubmitted,
  poolsEditable,
  savePoolsAction,
  refreshPoolsAction,
  submitMonthAction,
  reopenMonthAction,
}: {
  month: string;
  carriedFrom: string | null;
  // Why this month has no pools of its own, when the sync knows. Written by the
  // 6-hour pass onto the standard_pools freshness row — normally "Power BI has no
  // ETC period for <month> yet".
  upstreamNote?: string | null;
  rows: PoolPanelRow[];
  // The jobs behind this month's "New Hours Added" — see NewProjects below.
  newProjects: NewProjectRow[];
  isSubmitted: boolean;
  // No isAdmin any more — Reopen is password-gated, not role-gated. See the
  // footer.
  poolsEditable: boolean;
  savePoolsAction: (formData: FormData) => Promise<void>;
  refreshPoolsAction: () => Promise<void>;
  submitMonthAction: () => Promise<void>;
  reopenMonthAction: (formData: FormData) => Promise<void>;
}) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const [open, setOpen] = useState(true);
  // Unsaved pulled/rate edits: Submit Standard Sheet freezes from the SAVED pool values,
  // so it must be blocked until "Save Pool Cells" persists what's on screen —
  // otherwise the frozen fees silently differ from the live grid.
  const poolsDirty = useStandardPoolDirty();

  if (!open) {
    // Collapsed: fold sideways into a thin vertical rail instead of up.
    return (
      <aside className="w-9 shrink-0 self-start overflow-hidden border border-sdc-border border-t-[#808080] bg-[#D6E4F0] shadow-sm transition-[width] duration-200">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          title="Expand Standard Fees panel"
          className="flex h-full min-h-[120px] w-full flex-col items-center gap-2 py-2 text-sm font-semibold text-sdc-blue-dark hover:bg-[#c9dcef]"
        >
          <span className="text-xs">◀</span>
          <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">Standard Fees — {month}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[320px] shrink-0 self-start overflow-hidden border border-sdc-border border-t-[#808080] bg-white shadow-sm transition-[width] duration-200">
      <div className="flex items-center justify-between gap-2 border-b border-sdc-border bg-[#D6E4F0] px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-sdc-blue-dark"
        >
          <span className="inline-block rotate-90 text-xs">▶</span>
          <span className="truncate">Standard Fees — {month}</span>
        </button>
        {isSubmitted ? (
          <span className="rounded bg-sdc-navy px-2 py-0.5 text-[10px] font-semibold text-white">Locked</span>
        ) : (
          <form action={refreshPoolsAction}>
            <button type="submit" className="rounded border border-sdc-border bg-white px-2 py-0.5 text-[11px] font-medium text-sdc-navy hover:bg-sdc-blue-light" title="Recompute this month's category pools now. Your pulled-hours and rate edits are kept.">

              Refresh
            </button>
          </form>
        )}
      </div>

      {open && (
        <>
          {carriedFrom && !isSubmitted && (
            <p className="border-b border-sdc-border bg-sdc-yellow-bg/60 px-3 py-2 text-[11px] text-sdc-gray-600">
              No pool figures computed for {month} yet — showing {carriedFrom}&apos;s as an estimate.{" "}
              {/* Refresh is worth offering again now that the drivers are computed
                  from the app's own data. It used to be the opposite: the figures
                  came from a Power BI ETC period published roughly two months
                  behind, so for the in-progress month Refresh could only report
                  success having written nothing. When the sync has recorded a
                  reason of its own, that wins over this generic line. */}
              {upstreamNote ?? `Refresh computes ${month} now; the 6-hour sync does the same on its own.`}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="px-3 py-4 text-xs text-sdc-gray-400">No department pool data available. Click Refresh to compute this month.</p>
          ) : (
            <form action={savePoolsAction}>
              <div className="max-h-[calc(100vh-330px)] overflow-auto styled-scrollbar">
                {groups.map((group) => (
                  <div key={group}>
                    <div className={`${GROUP_TINT[group] ?? "bg-sdc-gray-100"} border-b border-sdc-border px-3 py-1.5 text-xs font-semibold text-sdc-navy`}>
                      {group}
                    </div>
                    {rows
                      .filter((r) => r.group === group)
                      .map((r) => (
                        <PoolDeptRow key={r.category} row={r} poolsEditable={poolsEditable} />
                      ))}
                  </div>
                ))}
                <PoolTotals />
                <NewProjects
                  month={month}
                  projects={newProjects}
                  storedByCategory={Object.fromEntries(rows.map((r) => [r.category, r.newHoursAddedThisMonth]))}
                  isSubmitted={isSubmitted}
                />
              </div>
              {poolsEditable && (
                <div className="border-t border-sdc-border px-3 py-2">
                  <button type="submit" className="w-full rounded-md border border-sdc-border bg-white px-3 py-1.5 text-xs font-semibold text-sdc-navy hover:bg-sdc-blue-light">
                    Save Pool Cells
                  </button>
                  <p className="mt-1 text-center text-[10px] text-sdc-gray-400">Grid Standard Fees update live; Save persists them.</p>
                </div>
              )}
            </form>
          )}

          <div className="flex flex-col gap-2 border-t border-sdc-border bg-sdc-gray-50 px-3 py-3">
            {isSubmitted ? (
              <>
                <p className="text-[11px] text-sdc-gray-600">
                  This month&apos;s Standard Sheet is submitted and frozen. Reopen it to refresh the pools or re-submit.
                </p>
                {/* Password-gated, not admin-only (2026-08-02). The button used
                    to render only for role === "ADMIN", so the manager who owns
                    the sheet couldn't see it — which is why June 2026's pools
                    sat 36h out of date until it was corrected by hand. */}
                <ReopenMonthButton
                  action={reopenMonthAction}
                  month={month}
                  label="Reopen Month"
                  align="right"
                  hint="Unfreezes this month's Standard Sheet so its pools can be refreshed and the sheet re-submitted. Per-job Standard Fees are recalculated when you submit again."
                  className={`${BUTTON_SECONDARY} w-full !py-1.5 !text-xs`}
                />
              </>
            ) : (
              <form action={submitMonthAction}>
                <button
                  type="submit"
                  disabled={poolsDirty}
                  className={`${BUTTON_PRIMARY} w-full !py-2 !text-xs disabled:cursor-not-allowed disabled:opacity-50`}
                  title={poolsDirty ? "Save Pool Cells first — the freeze uses the saved pool values." : "Freeze this month's Standard Sheet."}
                >
                  Submit Standard Sheet
                </button>
                {poolsDirty && (
                  <p className="mt-1 text-center text-[10px] font-medium text-sdc-yellow-text">
                    Unsaved pool edits — click “Save Pool Cells” first so the frozen fees match the grid.
                  </p>
                )}
              </form>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

// One department block. Reads/writes the live pulled/rate cell from the shared
// provider so New ETC Hours, Standard Fee, and the grid's job fees all move
// together as you type.
function PoolDeptRow({ row, poolsEditable }: { row: PoolPanelRow; poolsEditable: boolean }) {
  const cell = useStandardPoolCell(row.category);
  const editable = poolsEditable && row.hasData && !!cell;

  // Rounded here too, for the no-provider fallback path — the live cell is
  // already seeded rounded (see StandardRatesProvider), and the two must agree
  // or the same month would show 669 with the provider and 669.02 without.
  const pulledStr = cell?.pulled ?? String(Math.round(row.hoursPulledThisMonth));
  const newEtcHours = cell?.newEtcHours ?? row.newEtcHours;

  return (
    <div className="border-b border-sdc-border px-3 py-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sdc-gray-500">{row.dept}</p>
      <dl className="space-y-0.5 text-xs">
        <Line label="Previous Month Pulled Hours" value={whole(row.previousMonthPulledHours)} title={exactHours(row.previousMonthPulledHours)} />
        <Line label="New Hours Added this Month" value={whole(row.newHoursAddedThisMonth)} title={exactHours(row.newHoursAddedThisMonth)} />
        <Line label="Hours Available" value={whole(row.hoursAvailable)} title={exactHours(row.hoursAvailable)} />
        <Line label="Hours Worked this Month" value={whole(row.hoursWorkedThisMonth)} title={exactHours(row.hoursWorkedThisMonth)} />
        <div className="flex items-center justify-between gap-2 rounded bg-sdc-yellow-bg/60 px-1">
          <dt className="text-sdc-gray-600">Hours being pulled this month</dt>
          <dd>
            {editable ? (
              <input type="number" step="1" min="0" name={`pulled__${row.category}`} value={pulledStr} onChange={(e) => cell!.setPulled(e.target.value)} className={INPUT} aria-label={`Hours pulled, ${row.dept}`} />
            ) : (
              <span className="tabular-nums text-sdc-gray-700" title={exactHours(num(pulledStr))}>{whole(num(pulledStr))}</span>
            )}
          </dd>
        </div>
        <Line
          label="New ETC Hours"
          value={whole(newEtcHours)}
          title={`${exactHours(newEtcHours)} = Hours Available (${exactHours(row.hoursAvailable)}) − Hours Pulled (${exactHours(num(pulledStr))})`}
          strong
        />
      </dl>
    </div>
  );
}

// The jobs behind "New Hours Added this Month", itemised.
//
// Every department block above shows a single New Hours Added number with no
// way to ask what it is. That was survivable while the Projects page carried
// the new-project view; it no longer does, so this is the only place the
// question gets answered and it belongs next to the figure it explains.
//
// Computed by newProjectsEnteringMonth() — the SAME function the pool figures
// sum from, so this list always adds up to them. A job is here when its Start
// Date falls in the month (the verified upstream rule) and it quoted hours
// into at least one of the four pool sections.
function NewProjects({
  month,
  projects,
  storedByCategory,
  isSubmitted,
}: {
  month: string;
  projects: NewProjectRow[];
  // Each department block's "New Hours Added this Month", keyed by pool
  // category. The footer column under each department is supposed to equal
  // its entry here — see the reconciliation note below.
  storedByCategory: Record<string, number>;
  isSubmitted: boolean;
}) {
  const total = projects.reduce((s, p) => s + p.total, 0);
  const storedNewHours = POOL_ORDER.reduce((s, c) => s + (storedByCategory[c] ?? 0), 0);
  // Column totals — the whole point of the footer row: each one should match
  // the department block of the same name higher up the panel.
  const columnTotals = Object.fromEntries(
    POOL_ORDER.map((c) => [c, projects.reduce((s, p) => s + (p.hours[c] ?? 0), 0)]),
  ) as Record<string, number>;
  // This list is computed LIVE from job data; the figures above are whatever
  // was stored on the pool rows, which for older months came from Power BI's
  // archived period and for a frozen month can never be recomputed. When a
  // job's quoted hours or Start Date changes after that, the two drift.
  //
  // Seen live on 2026-06: the pool rows are source="power_bi", written
  // 2026-07-08, totalling 726h; the same two jobs now quote 762h. Saying so is
  // the whole reason this reconciliation exists — a list that visibly doesn't
  // add up to the number above it, with no explanation, is worse than no list.
  // Half an hour of slack because both sides round for display.
  const drift = total - storedNewHours;
  const reconciles = Math.abs(drift) < 0.5;

  return (
    <div className="border-t border-sdc-border">
      <div className="flex items-baseline justify-between gap-2 bg-sdc-gray-50 px-3 py-1.5">
        <p className="text-xs font-semibold text-sdc-navy">New projects this month</p>
        <p className="shrink-0 text-[11px] tabular-nums text-sdc-gray-500">
          {projects.length === 0 ? "none" : `${projects.length} · ${whole(total)} h`}
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="px-3 py-2.5 text-[11px] leading-relaxed text-sdc-gray-400">
          No job has a Start Date in {month}, so nothing was added to the pools — every department&apos;s New Hours Added above is
          zero.
        </p>
      ) : (
        <>
          {/* Says the order out loud: the table has no date column (five
              columns already fill 320px), so sorted-by-start-date would
              otherwise look like no order at all. The exact date is on each
              row's tooltip. */}
          <p className="px-3 pt-2 text-[10px] leading-relaxed text-sdc-gray-400">
            Jobs whose Start Date falls in {month}, earliest first. Their quoted hours are what &quot;New Hours Added this
            Month&quot; is made of.
          </p>
          {!reconciles && (
            <p className="mx-3 mt-1.5 rounded border border-sdc-yellow bg-sdc-yellow-bg/60 px-2 py-1.5 text-[10px] leading-relaxed text-sdc-gray-600">
              These add to <strong>{whole(total)} h</strong>, but the New Hours Added figures above total{" "}
              <strong>{whole(storedNewHours)} h</strong>.{" "}
              {isSubmitted
                ? "The pool figures were frozen when this month was submitted; this list is live, so a quoted-hours change since then shows up here and not above."
                : "The pool figures are from the last Refresh — click Refresh to recompute them from these jobs."}
            </p>
          )}
          {/* One row per job, one column per department, and a footer that
              totals each column. The footer is the useful part: each figure
              there should equal the "New Hours Added this Month" line in the
              department block of the same name above, so the panel now shows
              its own working.

              The job NAME isn't a column — five columns already fill a 320px
              panel — so it rides on the row's tooltip instead. */}
          <table className="mt-1.5 w-full border-collapse text-[10px]">
            {/* Two header rows: Job/PM/Mfg span both, and "War" spans the two
                warranty columns named beneath it. */}
            <thead>
              <tr className="border-t border-sdc-border bg-sdc-gray-50">
                {/* sdc-gray-600, not the sdc-gray-500 used elsewhere in this
                    file: only 50/100/400/600/700 are defined in globals.css's
                    @theme block, so `text-sdc-gray-500` generates no class at
                    all and silently inherits. */}
                <th rowSpan={2} className="px-1.5 py-1 text-left align-bottom font-semibold text-sdc-gray-600">
                  Job
                </th>
                {PLAIN_COLUMNS.map((c) => (
                  <th
                    key={c.category}
                    rowSpan={2}
                    className="px-1 py-1 text-right align-bottom font-semibold text-sdc-gray-600"
                    title={c.full}
                  >
                    {c.head}
                  </th>
                ))}
                <th
                  colSpan={WAR_COLUMNS.length}
                  className="border-l border-sdc-border px-1 pt-1 text-center font-semibold text-sdc-gray-600"
                  title="Warranty"
                >
                  War
                </th>
              </tr>
              <tr className="border-b border-sdc-border bg-sdc-gray-50">
                {WAR_COLUMNS.map((c) => (
                  <th
                    key={c.category}
                    className={`px-1 pb-1 text-right font-normal text-sdc-gray-600 ${groupEdge(c)}`}
                    title={c.full}
                  >
                    {c.head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.jobId} className="border-b border-sdc-border-soft/60" title={`${p.jobId} — ${p.jobName} · started ${p.startDate}`}>
                  <td className="px-1.5 py-1 text-left font-mono text-sdc-navy">{p.jobId}</td>
                  {POOL_COLUMNS.map((c) => {
                    const h = p.hours[c.category] ?? 0;
                    return (
                      <td
                        key={c.category}
                        className={`px-1 py-1 text-right tabular-nums ${groupEdge(c)} ${h > 0 ? "text-sdc-navy" : "text-sdc-navy/25"}`}
                        title={h > 0 ? exactHours(h) : undefined}
                      >
                        {/* An em dash, not "0" — a job that quoted nothing into
                            a pool contributed nothing, and a column of zeroes
                            reads as data when it's absence. */}
                        {h > 0 ? whole(h) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-sdc-border bg-sdc-gray-50">
                <td className="px-1.5 py-1 text-left font-semibold text-sdc-gray-600">Total</td>
                {POOL_COLUMNS.map((c) => {
                  const sum = columnTotals[c.category] ?? 0;
                  const stored = storedByCategory[c.category] ?? 0;
                  // Flag the specific department that doesn't reconcile rather
                  // than only saying the grand totals differ — with a column
                  // per pool, "which one" is now answerable at a glance.
                  const off = Math.abs(sum - stored) >= 0.5;
                  return (
                    <td
                      key={c.category}
                      className={`px-1 py-1 text-right font-semibold tabular-nums ${groupEdge(c)} ${off ? "text-sdc-yellow-text" : "text-sdc-navy"}`}
                      title={
                        off
                          ? `${exactHours(sum)} here vs ${exactHours(stored)} in the ${c.full} block above`
                          : `${exactHours(sum)} — matches the ${c.full} block above`
                      }
                    >
                      {whole(sum)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </div>
  );
}

function Line({ label, value, title, strong }: { label: string; value: string; title?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <dt className="text-sdc-gray-600">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-sdc-navy" : "text-sdc-gray-700"}`} title={title}>
        {value}
      </dd>
    </div>
  );
}

// Engineering Total / Shop Total / grand total, matching the Excel sheet's
// own rows at the bottom of the department pool block — same live per-
// category Standard Fee math as each PoolDeptRow, just summed by group.
function PoolTotals() {
  const t = useStandardPoolTotals();
  const engineeringTotal = t.engineeringPM + t.engineeringWarranty;
  const shopTotal = t.shopManufacturing + t.shopWarranty;
  const grandTotal = engineeringTotal + shopTotal;

  return (
    <div className="border-t border-sdc-border">
      <div className={`${GROUP_TINT.Engineering} flex items-center justify-between gap-2 px-3 py-1.5 text-xs`}>
        <dt className="font-semibold text-sdc-navy underline">Engineering Total</dt>
        <dd className="font-semibold tabular-nums text-sdc-navy" title={`${currencyExact(engineeringTotal)} = PM Pool Fee + Warranty Pool Fee`}>
          {currency(engineeringTotal)}
        </dd>
      </div>
      <div className={`${GROUP_TINT.Shop} flex items-center justify-between gap-2 px-3 py-1.5 text-xs`}>
        <dt className="font-semibold text-sdc-navy underline">Shop Total</dt>
        <dd className="font-semibold tabular-nums text-sdc-navy" title={`${currencyExact(shopTotal)} = Manufacturing Pool Fee + Warranty Pool Fee`}>
          {currency(shopTotal)}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <dt className="font-semibold text-sdc-navy underline">Grand Total</dt>
        <dd className="font-semibold tabular-nums text-sdc-blue-dark" title={`${currencyExact(grandTotal)} = Engineering Total + Shop Total`}>
          {currency(grandTotal)}
        </dd>
      </div>
    </div>
  );
}
