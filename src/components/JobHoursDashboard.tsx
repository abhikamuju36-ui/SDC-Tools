"use client";

import { useEffect, useMemo, useState } from "react";
import { card } from "@/components/ui/classnames";
import { abbreviateLabel } from "@/lib/abbrev";
import { EChart } from "@/components/charts/EChart";
import { groupedBarOption, SERIES } from "@/components/charts/theme";
import type { JobHoursDashboard as DashData, HoursType } from "@/lib/job-hours-dashboard";
import type { JobHoursDetail as JobHoursDetailData } from "@/lib/job-hours-detail";
import { HoursDetailPanel } from "@/components/HoursDetailPanel";
import { PartsCostSummary } from "@/components/PartsCostSummary";
import type { PartsBudgetProjection } from "@/lib/parts-budget-projection";

// The Parts Cost bullet bar (§52) joins the two hours charts in one row, so
// its inputs travel as one prop rather than a second top-level component the
// page has to lay out itself. Null when Parts Cost has nothing to show
// (Total ETO unreachable, or the selection is capped) — the row then falls
// back to its original two-column ratio instead of leaving an empty third cell.
export type JobHoursDashboardParts = {
  purchased: number;
  paid: number;
  estimated: number | null;
  budgetProjection: PartsBudgetProjection | null;
  jobCount: number;
  failedJobs: number;
};

// Web recreation of the Power BI "Job Detail" dashboard (hours half). The Hours
// Type toggle (Quoted / ETC) swaps the planned-basis series across the matrix
// and both charts, mirroring the report's field-parameter slicer.

// The fixed section template the chart/matrix always show (even at zero hours),
// matching the Power BI report: Complete Design & Build (excluding PM) +
// Machine Testing, in canonical order.
const TEMPLATE_PHASES = ["Complete Design & Build", "Machine Testing"];

// Divider color for the tiered category axis — darker than the default border
// so the dashed group dividers read clearly.
const TIER_DIVIDER = "#94a3b8";

const fmt = (n: number) => Math.round(n).toLocaleString();

// Consecutive runs of a key, with counts — for the tiered dept/phase headers.
function groupRuns<T>(rows: T[], keyOf: (r: T) => string, labelOf: (r: T) => string) {
  const out: { label: string; count: number }[] = [];
  let lastKey: string | null = null;
  for (const r of rows) {
    const k = keyOf(r);
    if (k === lastKey) out[out.length - 1].count++;
    else { out.push({ label: labelOf(r), count: 1 }); lastKey = k; }
  }
  return out;
}

export function JobHoursDashboard({
  data,
  hoursDetail,
  parts = null,
}: {
  data: DashData;
  hoursDetail: JobHoursDetailData;
  parts?: JobHoursDashboardParts | null;
}) {
  const [hoursType, setHoursType] = useState<HoursType>("Quoted");
  const planned = (s: { quoted: number; etc: number }) => (hoursType === "Quoted" ? s.quoted : s.etc);
  const plannedLabel = hoursType === "Quoted" ? "Quoted" : "ETC";

  // Fixed template — always show these phases/sections, even at zero hours.
  const [activePhases, setActivePhases] = useState<Set<string>>(() => new Set(TEMPLATE_PHASES));

  // Drill-through target: the section code whose monthly detail is open, or null.
  // Parts already had a drill (JobProcurement's drillToPart); the hours charts
  // had no click behaviour at all, so a section 680 hours over told you nothing
  // about WHEN that happened. Stored as a code rather than the row object so it
  // survives a Quoted/ETC toggle re-deriving `hierRows`.
  const [drillCode, setDrillCode] = useState<string | null>(null);

  const templateSections = useMemo(
    () => data.sections.filter((s) => TEMPLATE_PHASES.includes(s.phase) && s.code !== "10-111"),
    [data.sections],
  );
  const visible = useMemo(
    () => templateSections.filter((s) => activePhases.has(s.phase)),
    [templateSections, activePhases],
  );

  const hierRows = visible.map((s) => ({ code: s.code, name: s.name, group: s.group, phase: s.phase, planned: planned(s), actual: s.actual }));
  const bgChart = data.billingGroups
    .filter((g) => g.quoted || g.etc || g.actual)
    .map((g) => ({ name: g.group, planned: hoursType === "Quoted" ? g.quoted : g.etc, actual: g.actual }));

  // Resolved against the CURRENT rows, so hiding the drilled section's phase (or
  // it dropping out of the template) closes the panel rather than leaving it
  // showing a section that's no longer on the chart.
  const drillRow = drillCode ? (hierRows.find((r) => r.code === drillCode) ?? null) : null;
  // Every section, not just the visible ones: the punch table below is
  // unfiltered, so the figure it's compared against has to be too.
  const jobActualTotal = data.sections.reduce((sum, s) => sum + s.actual, 0);

  const togglePhase = (p: string) =>
    setActivePhases((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* The KPI indicator cards (Active Jobs, Hours Refreshed Thru, Latest ETC
          Month) moved up into the page's header row (§57), where they sit
          beside the project-title card on one line. The "Eng Design-to-Debug
          Ratio" card was removed there. */}

      {/* Controls: Hours Type + phase filter */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="inline-flex rounded-lg bg-sdc-gray-100 p-1">
          {(["Quoted", "ETC"] as HoursType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setHoursType(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium motion-interactive ${
                hoursType === t ? "bg-white text-sdc-blue-dark shadow-sm" : "text-sdc-gray-600 hover:text-sdc-navy"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_PHASES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePhase(p)}
              className={`rounded-full border px-3 py-1 text-xs motion-interactive ${
                activePhases.has(p)
                  ? "border-sdc-blue bg-sdc-blue-light text-sdc-blue-dark"
                  : "border-sdc-border-soft text-sdc-muted hover:text-sdc-navy"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className={card("p-8")}>
          <p className="text-center text-sdc-muted">No hours recorded for this job yet.</p>
        </div>
      ) : (
      <>
      {/* Charts — all three (Estimate to Complete vs Actual, {plannedLabel} and
          Actual by Billing Group, Parts Cost) in one row on normal desktop
          screens, uniform height and aligned top/bottom (§54.3-54.5). Stretch
          is the DEFAULT — `items-stretch` — so idle, all three cards match the
          tallest one exactly. The one exception is while chart 1's
          drill-through is open: that content is "absolutely required" per
          §54.5, so `items-start` takes over for that state only rather than
          stretching the other two cards to match a much taller one and
          reopening the empty-space problem §33 fixed for the KPI summary card
          (see drill-cap-scroll-ceiling in the memory notes / DEVLOG §33).

          §55: the first card is the WIDEST (2fr against 1fr each), because it
          holds the most content — the tiered section chart — and had been the
          one forced to scroll internally at three equal columns. The extra
          width plus the now-responsive chart (see SectionHierarchyChart) lets
          it show every section in full with no internal scroll, while the
          billing-group and Parts Cost cards are comfortable at 1fr. Falls back
          to the original 2-column ratio when there's no Parts Cost to show,
          rather than leaving an empty cell. */}
      <div
        className={`grid grid-cols-1 gap-5 ${drillRow ? "items-start" : "items-stretch"} ${
          parts ? "lg:grid-cols-[2fr_1fr_1fr]" : "lg:grid-cols-[2fr_1fr]"
        }`}
      >
        <div className={`${card("p-4")} flex h-full min-w-0 flex-col`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-heading text-base font-bold tracking-tight text-sdc-navy">Estimate to Complete vs Actual</p>
            <p className="text-note text-sdc-gray-400">Click a section for its month-by-month detail</p>
          </div>
          <SectionHierarchyChart rows={hierRows} plannedLabel={plannedLabel} onDrill={setDrillCode} drillCode={drillCode} />
          {drillRow && (
            <>
              <SectionDrill
                row={drillRow}
                plannedLabel={plannedLabel}
                monthly={data.monthlyBySection[drillRow.code] ?? []}
                onClose={() => setDrillCode(null)}
              />
              {/* The punch-level table, preselected to the section just clicked
                  — the report's drillthrough page, one level further down than
                  the monthly summary above it. */}
              <HoursDetailPanel
                detail={hoursDetail}
                // The panel's own `mt-4` moved out to its callers when the Monthly ETC
                // card started rendering it side by side. Here it still sits BELOW the
                // chart above it, so it still wants the gap.
                className="mt-4"
                initialSection={drillRow.code}
                // The Actual bar above covers the job's whole life; this table
                // only holds punches from the window the Paylocity export
                // reaches back to. On an older job the two legitimately differ,
                // and saying so beats leaving someone to find the gap and
                // conclude the page is broken — which is how this whole thread
                // started.
                // Whole-job figures on both sides: this table lists every
                // section, not just the one drilled into.
                note={
                  jobActualTotal - hoursDetail.total > 1
                    ? `Actual for this job is ${Math.round(jobActualTotal).toLocaleString()}h; the punch records below reach back only as far as the payroll export, so they total ${Math.round(hoursDetail.total).toLocaleString()}h. Earlier hours are carried as period totals.`
                    : undefined
                }
                onClose={() => setDrillCode(null)}
              />
            </>
          )}
        </div>
        <div className={`${card("p-4")} flex h-full flex-col`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-heading text-base font-bold tracking-tight text-sdc-navy">{plannedLabel} and Actual by Billing Group</p>
          </div>
          <EChart
            height={400}
            option={groupedBarOption({
              categories: bgChart.map((g) => g.name),
              planned: bgChart.map((g) => g.planned),
              actual: bgChart.map((g) => g.actual),
              plannedLabel,
              diffs: bgChart.map((g) => g.planned - g.actual),
            })}
          />
        </div>
        {parts && (
          <PartsCostSummary
            purchased={parts.purchased}
            paid={parts.paid}
            estimated={parts.estimated}
            budgetProjection={parts.budgetProjection}
            jobCount={parts.jobCount}
            failedJobs={parts.failedJobs}
          />
        )}
      </div>
      </>
      )}
    </div>
  );
}


type HierRow = { code: string; name: string; group: string; phase: string; planned: number; actual: number };

// Custom grouped-column chart with the Power BI tiered category axis:
// Section names → Department → Phase, with dashed dividers between groups. Shows
// every template section, even at zero. Grid columns = sections so the tiers
// line up by construction (no pixel math).
function SectionHierarchyChart({
  rows,
  plannedLabel,
  onDrill,
  drillCode,
}: {
  rows: HierRow[];
  plannedLabel: string;
  onDrill: (code: string | null) => void;
  drillCode: string | null;
}) {
  const BAR_H = 300;
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned, r.actual]));
  const deptRuns = groupRuns(rows, (r) => `${r.phase}|${r.group}`, (r) => r.group);
  const phaseRuns = groupRuns(rows, (r) => r.phase, (r) => r.phase);
  // §55: `minmax(0, 1fr)`, not `minmax(60px, 1fr)`, so the columns SHRINK to
  // fit the card instead of forcing a 640px floor that had to scroll. Equal
  // fractions keep the tiers (section / dept / phase) lined up by construction.
  // The bars inside are responsive too (capped at their old width), so a
  // narrower column narrows the bars rather than clipping them.
  const colStyle = { gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` } as const;

  // Hovered section index + cursor position, for the floating tooltip.
  const [hover, setHover] = useState<{ row: HierRow; x: number; y: number } | null>(null);
  // Entrance animation — bars grow up from 0 on mount / when the data changes,
  // mirroring the ECharts chart beside it. Two rAFs so the 0-height paints first.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    setGrown(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(id);
  }, [rows]);

  const Bar = ({ value, color }: { value: number; color: string }) => (
    // §55: `flex-1 min-w-0 max-w-5` — the bar fills the space its column gives
    // it, up to its old 20px width, and shrinks below that on a narrow column
    // rather than overflowing. `w-5` was a fixed width that forced the 640px
    // chart floor; the cap keeps wide columns looking exactly as before.
    <div className="flex h-full min-w-0 max-w-5 flex-1 flex-col items-center justify-end">
      <span className="mb-0.5 text-micro leading-none text-sdc-muted">{value ? fmt(value) : ""}</span>
      {/* ── scaleY, not height (§36.2, §36.14, §36.15) ──────────────────────────
          This was `transition-[height] duration-500`, which broke three of §36's
          rules at once on a chart that can hold twenty bars:
            * 500ms is well past the ~300ms ceiling for anything an interaction or a
              data change triggers (§36.2);
            * `height` is a layout property, so every frame relaid out the whole
              chart grid — twenty bars × 30 frames of layout (§36.15);
            * and because each bar grew from 0, the value LABEL above it (a sibling
              in this flex column) travelled up with it for half a second, so the
              numbers were unreadable while they moved (§36.14).
          The bar now takes its final height immediately — which is what fixes the
          label — and scales up from the baseline on the compositor. Same growing
          gesture, one property, no layout. */}
      <div
        className="w-full origin-bottom rounded-t-sm"
        style={{
          height: `${(value / max) * 100}%`,
          background: color,
          transform: grown ? "scaleY(1)" : "scaleY(0)",
          transitionProperty: "transform",
          transitionDuration: "var(--motion-panel)",
          transitionTimingFunction: "var(--ease-out)",
        }}
      />
    </div>
  );

  return (
    // §55: `w-full`, not `min-w-[640px]` — the chart fits its card exactly and
    // never forces the card to scroll horizontally. `min-w-0` lets it shrink
    // inside the flex column above it.
    <div className="relative w-full min-w-0" onMouseLeave={() => setHover(null)}>
      <div className="mb-2 flex items-center gap-4 text-xs text-sdc-gray-600">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.planned }} /> {plannedLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.actual }} /> Actual</span>
      </div>
      {/* Bars — with the Quoted−Actual variance called out on top of each group
          (green when Actual is under Quoted, red when over). */}
      <div className="grid items-end gap-x-1" style={{ ...colStyle, height: BAR_H }}>
        {rows.map((r) => {
          const diff = r.planned - r.actual; // Quoted − Actual: + = under Quoted (green), − = over (red)
          const has = r.planned !== 0 || r.actual !== 0;
          return (
            <div
              key={r.code}
              // A real button: the whole column is the drill target, and it's
              // keyboard-reachable. Clicking the open section closes it again.
              role="button"
              tabIndex={0}
              aria-pressed={drillCode === r.code}
              title={`${r.name} — click for month-by-month detail`}
              onClick={() => onDrill(drillCode === r.code ? null : r.code)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onDrill(drillCode === r.code ? null : r.code);
              }}
              className={`flex h-full cursor-pointer flex-col rounded-sm motion-interactive hover:bg-sdc-blue-light/30 ${
                drillCode === r.code ? "bg-sdc-blue-light/60 ring-1 ring-sdc-blue" : ""
              } ${hover && hover.row.code !== r.code ? "opacity-40" : "opacity-100"}`}
              onMouseMove={(e) => {
                const box = e.currentTarget.parentElement!.getBoundingClientRect();
                setHover({ row: r, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <div className={`h-4 text-center text-note font-bold leading-none ${!has ? "text-transparent" : diff > 0 ? "text-sdc-green-text" : diff < 0 ? "text-red-600" : "text-sdc-gray-400"}`}>
                {has ? `${diff > 0 ? "+" : ""}${fmt(diff)}` : ""}
              </div>
              <div className="flex flex-1 items-end justify-center gap-1.5">
                <Bar value={r.planned} color={SERIES.planned} />
                <Bar value={r.actual} color={SERIES.actual} />
              </div>
            </div>
          );
        })}
      </div>
      {hover && (() => {
        const diff = hover.row.actual - hover.row.planned;
        return (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-sdc-border bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: hover.x, top: hover.y - 12 }}
          >
            <div className="mb-1 font-semibold text-sdc-navy">{hover.row.name}</div>
            <div className="text-label text-sdc-muted">{hover.row.phase} · {hover.row.group}</div>
            <div className="mt-1 flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.planned }} /><span className="text-sdc-gray-600">{plannedLabel}:</span> <span className="font-medium tabular-nums">{fmt(hover.row.planned)}</span></div>
            <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.actual }} /><span className="text-sdc-gray-600">Actual:</span> <span className="font-medium tabular-nums">{fmt(hover.row.actual)}</span></div>
            <div className={`mt-0.5 font-semibold tabular-nums ${diff > 0 ? "text-red-600" : diff < 0 ? "text-sdc-green-text" : "text-sdc-gray-400"}`}>
              Diff: {diff > 0 ? "+" : ""}{fmt(diff)}
            </div>
          </div>
        );
      })()}
      {/* Tier 1 — section names (variance is shown on top of the bars above) */}
      <div className="grid gap-x-1 border-t pt-1" style={{ ...colStyle, borderTopColor: TIER_DIVIDER }}>
        {rows.map((r) => (
          <div key={r.code} className="px-0.5 text-center leading-tight">
            <div className="text-label text-sdc-navy">{r.name}</div>
          </div>
        ))}
      </div>
      {/* Tier 2 — department, spanning its sections */}
      <div className="mt-1 grid" style={colStyle}>
        {deptRuns.map((g, i) => (
          <div key={i} style={{ gridColumn: `span ${g.count}`, borderLeftColor: TIER_DIVIDER }} className="border-l border-dashed py-0.5 text-center text-label font-medium text-sdc-gray-600 first:border-l-0">
            {abbreviateLabel(g.label)}
          </div>
        ))}
      </div>
      {/* Tier 3 — phase, spanning its departments */}
      <div className="mt-0.5 grid" style={colStyle}>
        {phaseRuns.map((p, i) => (
          <div key={i} style={{ gridColumn: `span ${p.count}`, borderLeftColor: TIER_DIVIDER, borderTopColor: TIER_DIVIDER }} className="border-l border-t border-dashed py-1 text-center text-note font-semibold text-sdc-navy first:border-l-0">
            {abbreviateLabel(p.label)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Drill-through detail for one section, opened by clicking its column above.
//
// The charts answer "how much" and "how far off"; this answers "when". Actual
// hours arrive one ETC month at a time, so a section 680 hours over is either a
// steady overrun or one bad month, and those call for different conversations.
// Everything here comes from EtcEntry rows the page already loads — no extra
// query, which is why the panel opens instantly.
function SectionDrill({
  row,
  plannedLabel,
  monthly,
  onClose,
}: {
  row: HierRow;
  plannedLabel: string;
  monthly: { month: string; worked: number }[];
  onClose: () => void;
}) {
  const diff = row.planned - row.actual; // + = under plan
  const peak = Math.max(1, ...monthly.map((m) => m.worked));
  // Running total, so you can see where the plan was crossed rather than
  // inferring it from the monthly bars. Built with an explicit loop rather than
  // a map() closing over a mutable accumulator — the latter reassigns during
  // render, which the react-hooks/immutability rule (correctly) rejects.
  const rowsWithRunning: { month: string; worked: number; running: number }[] = [];
  for (const m of monthly) {
    const prev = rowsWithRunning[rowsWithRunning.length - 1]?.running ?? 0;
    rowsWithRunning.push({ ...m, running: prev + m.worked });
  }

  return (
    <div className="mt-4 rounded-lg border border-sdc-blue-100 bg-sdc-blue-light/30 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-sdc-navy">{row.name}</p>
          <p className="text-note text-sdc-muted">
            {row.phase} · {row.group} · {row.code}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-sdc-border bg-white px-2 py-1 text-note font-medium text-sdc-navy hover:bg-sdc-blue-light"
        >
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="text-sdc-gray-600">
          {plannedLabel}: <span className="font-semibold tabular-nums text-sdc-navy">{fmt(row.planned)}</span>
        </span>
        <span className="text-sdc-gray-600">
          Actual: <span className="font-semibold tabular-nums text-sdc-navy">{fmt(row.actual)}</span>
        </span>
        <span className={`font-semibold tabular-nums ${diff > 0 ? "text-sdc-green-text" : diff < 0 ? "text-red-600" : "text-sdc-gray-400"}`}>
          {diff > 0 ? "Under" : diff < 0 ? "Over" : "On"} {plannedLabel} by {fmt(Math.abs(diff))}
        </span>
      </div>

      {rowsWithRunning.length === 0 ? (
        // Distinct from "0 hours": a section can carry a quote and a historical
        // Excel actual with no month-by-month ETC history behind it at all.
        <p className="text-xs text-sdc-muted">
          No month-by-month history for this section — its actual comes from the migrated Excel total, not from ETC tracking.
        </p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[5rem_1fr_4rem_4.5rem] gap-2 text-label font-semibold uppercase tracking-wide text-sdc-gray-400">
            <span>Month</span>
            <span />
            <span className="text-right">Hours</span>
            <span className="text-right">Running</span>
          </div>
          {rowsWithRunning.map((m) => (
            <div key={m.month} className="grid grid-cols-[5rem_1fr_4rem_4.5rem] items-center gap-2">
              <span className="font-mono text-note text-sdc-navy">{m.month}</span>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full" style={{ width: `${(m.worked / peak) * 100}%`, background: SERIES.actual }} />
              </div>
              <span className="text-right text-note font-semibold tabular-nums text-sdc-navy">{fmt(m.worked)}</span>
              {/* Running total turns red once it passes the plan — the month the
                  section went over, which is the whole point of the panel. */}
              <span
                className={`text-right text-note tabular-nums ${
                  row.planned > 0 && m.running > row.planned ? "font-semibold text-red-600" : "text-sdc-muted"
                }`}
              >
                {fmt(m.running)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
