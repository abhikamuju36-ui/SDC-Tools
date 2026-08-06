"use client";

import { type ReactNode } from "react";

// ── The drill-through panel, one design (§47) ────────────────────────────────
//
// Implements the "KPI Card Redesign" reference (KPI Card Redesign/KPI Summary Card.dc.html)
// for every drill-through in the app.
//
// ── Why this is a shared component and not three sets of classes ────────────
//
// Because there were three drill-throughs and three designs, and they had drifted far
// enough apart that the same table read differently depending on which KPI you clicked:
//
//                     HoursDetailPanel        UndefinedHoursPanel      DataQualityDrill
//   header row        navy fill, white text   TABLE_HEADER_ROW gray    navy fill, white text
//   row separation    zebra stripes           hairlines                zebra stripes
//   gridlines         TABLE_GRID (all cells)  none                     none
//   caret             ▶ + rotate-90           ▼/▶ glyph swap           n/a
//   total row         bg-gray-100 "Total"     border-t-2 navy "Shown"  n/a
//
// Five decisions, made three times, agreeing on none of them. So the design lives here
// and the panels supply data — which is also what makes the redesign hold: there is one
// place to change it next time.
//
// ── Grids read as spreadsheets; drills read as reports ──────────────────────
//
// The big grids (Monthly ETC, Projects) keep TABLE_GRID and GRID_SCROLLER — full
// gridlines, sharp corners, every cell bordered. That is deliberate (§41.23) and stays:
// people edit them like spreadsheets.
//
// A drill-through is the opposite thing. It is read, not edited; it is a rollup, not a
// matrix; and its columns are few and wide rather than many and narrow. The reference
// treats it that way — no cell borders at all, hairline separators between ROWS only,
// and hierarchy carried by type size, weight and colour. So these tokens are separate
// from the grid tokens on purpose, and neither should be used for the other.
//
// ── The reference's palette is NOT copied ───────────────────────────────────
//
// The mockup is drawn in a warm-gray scheme (#f4f4f2 / #e2e0d9 / #16233a / #2b5f8e) in
// Inter Tight and IBM Plex Mono. This app has a committed brand palette and one type
// scale, both test-guarded (§39), and a second palette living in one component is
// exactly the "duplicate theme definitions" §39.16 forbids — it is how the charts came
// to use a different font from everything else. So the reference's STRUCTURE, spacing,
// hierarchy and interaction are adopted; its hex values map onto the tokens that already
// mean those things:
//
//   #16233a ink        -> text-sdc-navy         #e2e0d9 panel border -> border-sdc-border
//   #22221c row name   -> text-sdc-gray-700     #eeece5 section rule -> border-sdc-border
//   #8b8b82 secondary  -> text-sdc-muted        #f3f2ec row hairline -> border-sdc-border-soft
//   #2b5f8e link       -> text-sdc-blue-dark    #f4f3ee chip tray    -> bg-sdc-gray-100
//   IBM Plex Mono      -> font-mono             Inter Tight          -> the app's font-sans
//
// Two of the reference's tiers are also dropped rather than mapped: #9a998f (2.87:1) and
// #a9a89f (2.39:1) fail WCAG AA, and this panel renders financial figures at 10–11px.
// Everything secondary uses the one AA-passing muted tone instead (see --sdc-muted).

// ── Tokens ──────────────────────────────────────────────────────────────────

/** The panel frame. Rounded, unlike the grids — a report card, not a spreadsheet. */
const PANEL = "flex flex-col overflow-hidden rounded-lg border border-sdc-border bg-white";

// ── The card is capped and its BODY scrolls (§49) ────────────────────────────
//
// A drill card sits beside the KPI summary card, and each is as tall as its own
// content — see the note in EtcMonthKpiCards for why they no longer stretch to match.
// "As tall as its own content" needs a ceiling, or a fifty-row rollup pushes the grid
// below it off the screen, which is the problem the side-by-side layout was introduced
// to solve.
//
// Two classes, used together, and used by the two hand-rolled drill cards on the
// Monthly ETC page as well as by DrillPanel — so "the drill scrolls internally" is one
// decision rather than four.

/** The height ceiling. Viewport-relative with a zoom floor — see .drill-cap. */
export const DRILL_CAP = "drill-cap";

/**
 * The ONE scrolling region inside a capped drill card. Everything else in the card
 * keeps its content height, so this is the child that absorbs the overflow.
 *
 * `basis-auto` is deliberate and `flex-1` would be wrong: `flex-1` sets
 * `flex-basis: 0`, which makes an auto-height flex column compute its content height
 * from a zero-height body — the card would collapse to its header instead of growing
 * to its content and then capping. `min-h-0` is what lets it shrink past its content
 * at all; without it a flex item refuses to go below its own min-content height and
 * the card overflows its ceiling instead of scrolling.
 */
export const DRILL_BODY = "styled-scrollbar min-h-0 shrink basis-auto overflow-y-auto";

/**
 * The column template, shared by the header, every group row and the total row so all
 * three are guaranteed to line up. A CSS grid rather than a <table>: the group rows and
 * the punch lines inside them have different column counts, and with a table that means
 * either a colspan'd nested table (what HoursDetailPanel did) or misaligned columns.
 *
 * The value column is 6.4rem — 96px at the 15px root, sized for the widest thing these
 * panels put in it, "$1,065,713" in the mono face, which the parts drill does.
 */
const VALUE_COL = "6.4rem";

/** Muted uppercase column header. 10px, the app's densest label step (§39.2). */
const HEAD =
  "border-b border-sdc-border px-4 py-1.5 text-label font-semibold uppercase tracking-[0.1em] text-sdc-muted";

/** A group row: hairline-separated, no cell borders. */
const GROUP_ROW =
  "grid w-full items-center gap-3 border-b border-sdc-border-soft px-4 py-2 text-left motion-interactive hover:bg-sdc-gray-50";

/** Numerics: mono + tabular so columns of figures align digit for digit. */
export const DRILL_NUM = "text-right font-mono tabular-nums text-sdc-navy";

// ── Panel shell ─────────────────────────────────────────────────────────────

export function DrillPanel({
  title,
  meta,
  note,
  onClose,
  controls,
  footer,
  className,
  children,
}: {
  title: string;
  /** The one-line "what this table currently is" — group count, line count. */
  meta?: ReactNode;
  /** An optional caveat, kept out of `meta` so the meta line stays scannable. */
  note?: ReactNode;
  onClose?: () => void;
  /** The GROUP tray and the filters. Rendered in their own row — see DrillControls. */
  controls?: ReactNode;
  /** "Open full report" / "Export CSV" — see DrillLink / DrillAction. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    // The ceiling is the panel's own business, not the caller's (§49): every drill in
    // the app scrolls internally at the same height, which is the point of there being
    // one panel component. Spacing and placement stay with the caller — see `className`.
    <section className={`${PANEL} ${DRILL_CAP} ${className ?? ""}`} aria-label={title}>
      {/* Header. Title and meta stacked on the left, Close as a quiet bordered pill on
          the right — not in the control row, because it is not a control that changes
          what the table shows.
          Outside the scrolling body, so Close and the title stay on screen however long
          the table is (§49). */}
      <div className="flex items-start justify-between gap-4 px-4 pt-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-[-0.01em] text-sdc-navy">{title}</h3>
          {meta && <p className="mt-0.5 text-note text-sdc-muted">{meta}</p>}
          {note && <p className="mt-1 max-w-2xl text-note leading-tight text-sdc-yellow-text">{note}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-sdc-border px-2 py-0.5 text-note text-sdc-muted motion-interactive hover:border-sdc-blue-100 hover:text-sdc-navy"
          >
            Close
          </button>
        )}
      </div>

      {controls}

      {/* The table region owns its own top rule, so it reads as a distinct block from
          the controls above it whether or not any controls were passed.
          It is also the one part of the card that scrolls (§49). The header above and the
          footer below stay put, so Close, the group tray, the filters and Export CSV are
          reachable without scrolling back up through a rollup. */}
      <div className={`${DRILL_BODY} border-t border-sdc-border`}>{children}</div>

      {footer && (
        <div className="flex flex-wrap gap-4 border-t border-sdc-border px-4 py-2 text-note">{footer}</div>
      )}
    </section>
  );
}

/**
 * The controls row: a labelled GROUP tray, then anything else (filters) filling the rest.
 *
 * Its own row, below the header, rather than sharing one wrapping flex line with the
 * title and Close — which is what the panels did, and why on a narrow window the group
 * chips, three selects and the Close button wrapped into an unreadable pile beside the
 * heading.
 */
export function DrillControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">{children}</div>;
}

/**
 * The segmented tray from the reference: an inset well, with the selected option raised
 * to white. Replaces a row of solid-blue filled chips, which read as four primary
 * buttons competing with each other and with the toolbar above.
 *
 * Deliberately NOT made single-select like the mockup. The app's grouping is
 * multi-level and click-ordered (Department › Employee), which is a real capability the
 * mockup's five radio tabs do not have — so the tray takes the reference's LOOK and
 * keeps the app's behaviour. `aria-pressed` on each option says which it is.
 */
export function DrillGroupTray({ label = "Group", children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-label font-semibold uppercase tracking-[0.04em] text-sdc-muted">{label}</span>
      <div className="flex gap-0.5 rounded-md bg-sdc-gray-100 p-0.5">{children}</div>
    </div>
  );
}

export function DrillGroupOption({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`rounded-[5px] px-2.5 py-1 text-note font-medium motion-interactive ${
        on ? "bg-white text-sdc-navy shadow-sm" : "text-sdc-muted hover:text-sdc-navy"
      }`}
    >
      {children}
    </button>
  );
}

/** The filter row beside the tray — grows to fill, wraps as one unit. */
export function DrillFilters({ children }: { children: ReactNode }) {
  return <div className="flex min-w-[14rem] flex-1 flex-wrap items-center gap-1.5">{children}</div>;
}

/**
 * A filter <select> styled as the reference's dropdown pill, and tinted when it is
 * actually filtering — so "All sections" and "10-211 ME Gen" do not look alike.
 *
 * `min-w-0 max-w-[14rem]` is load-bearing and predates this redesign: a native select
 * sizes to its widest option and as a flex item will not shrink below it, so the job
 * filter's full job names pushed a horizontal scrollbar onto the whole page (§45).
 */
export function DrillSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: ReactNode;
}) {
  const active = value !== "";
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={`h-7 min-w-0 max-w-[14rem] flex-1 rounded-md border px-1.5 text-note outline-none motion-interactive focus:border-sdc-blue ${
        active ? "border-sdc-border bg-sdc-gray-100 text-sdc-navy" : "border-sdc-border-soft bg-white text-sdc-muted"
      }`}
    >
      {children}
    </select>
  );
}

/** A footer link out of the panel — "Open full report". */
export function DrillLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-sdc-blue-dark underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/** A footer action — "Export CSV". A button, because it is one. */
export function DrillAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-sdc-blue-dark underline-offset-2 hover:underline">
      {children}
    </button>
  );
}

// ── The table ───────────────────────────────────────────────────────────────

/**
 * One row's worth of column widths. The header, the group rows and the total row all
 * take the SAME template, which is what guarantees the total lands under the figures it
 * totals — the bug a hand-counted `colSpan` produces when a column is added.
 */
function template(dimensions: number): string {
  // The last dimension takes the slack; earlier ones are content-sized with a floor, so
  // a two-level rollup does not give "Mechanical Engineering" 8 characters.
  const dims = dimensions <= 1 ? "1fr" : `${"minmax(7rem, auto) ".repeat(dimensions - 1)}minmax(7rem, 1fr)`;
  return `${dims} ${VALUE_COL}`;
}

export function DrillTable({
  columns,
  unit,
  total,
  totalLabel = "Total",
  totalTitle,
  children,
}: {
  /** The grouping dimension names, left to right. */
  columns: string[];
  /** The value column's heading — "Hours", "Amount". */
  unit: string;
  total: ReactNode;
  /** "Shown" rather than "Total" when a filter is narrowing the set. */
  totalLabel?: string;
  totalTitle?: string;
  children: ReactNode;
}) {
  const cols = template(columns.length);
  return (
    <div role="table" aria-rowcount={-1}>
      <div role="row" className={`${HEAD} grid gap-3`} style={{ gridTemplateColumns: cols }}>
        {columns.map((c) => (
          <span role="columnheader" key={c}>
            {c}
          </span>
        ))}
        <span role="columnheader" className="text-right">
          {unit}
        </span>
      </div>

      {children}

      {/* The total, on the same template. Faint fill rather than the heavy navy rule two
          of the panels used — the reference's way of closing a report block.
          Pinned to the bottom of the scrolling body (§49). Before the card had a ceiling
          this row was simply the last thing in a panel that was as tall as its content, so
          it was always on screen; once the body scrolls, a fifty-group rollup would push
          the figure the drill exists to reconcile out of sight. The fill is opaque and the
          hairline separates it from the rows travelling underneath. DrillLines' own tfoot
          has worked this way all along. */}
      <div
        role="row"
        className="sticky bottom-0 z-10 grid items-center gap-3 border-t border-sdc-border-soft bg-sdc-gray-50 px-4 py-2"
        style={{ gridTemplateColumns: cols }}
      >
        <span
          role="cell"
          className="text-label font-semibold uppercase tracking-[0.08em] text-sdc-muted"
          style={{ gridColumn: `1 / ${columns.length + 1}` }}
        >
          {totalLabel}
        </span>
        <span role="cell" className={`${DRILL_NUM} text-sm font-semibold`} title={totalTitle}>
          {total}
        </span>
      </div>
    </div>
  );
}

/**
 * A group row plus its expansion.
 *
 * The whole row is the disclosure control, not a small button inside the first cell:
 * the reference makes the row clickable, and a 4px caret is a poor target. It is a
 * <button> so it is reachable by keyboard and announces `aria-expanded`.
 */
export function DrillGroup({
  values,
  count,
  total,
  totalTitle,
  open,
  onToggle,
  columns,
  children,
}: {
  /** One label per grouping dimension. */
  values: string[];
  /** "10 punches" — the reference prints it beside the name, not in a column of its own. */
  count?: string;
  total: ReactNode;
  totalTitle?: string;
  open: boolean;
  onToggle: () => void;
  /** How many dimensions the table has, so this row matches its template. */
  columns: number;
  /** The punch lines, rendered only while open. */
  children: ReactNode;
}) {
  return (
    <div className="border-b border-sdc-border-soft last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        // The domain word comes from `count` in BOTH states now. It used to come from the
        // caller only when closed and be hardcoded to "lines" when open, so a panel that
        // called its rows punches still said "Hide these lines" the moment one was opened —
        // which is how the vocabulary drifted in the first place. The fallbacks say "rows"
        // rather than picking a domain: this is the shared design layer, and the two callers
        // that use it both pass a count.
        title={
          count ? `${open ? "Hide" : "Show"} the ${count} behind this` : open ? "Hide these rows" : "Show these rows"
        }
        className={`${GROUP_ROW} border-b-0 ${open ? "bg-sdc-gray-50" : ""}`}
        style={{ gridTemplateColumns: template(columns) }}
      >
        {values.map((v, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2 text-sm font-medium text-sdc-gray-700">
            {/* The caret sits on the FIRST dimension only, so a row has one disclosure
                cue however many levels it has. `rotate` rather than swapping ▶ for ▼:
                a glyph swap jumps, a rotation reads as the same control moving. */}
            {i === 0 && (
              <span
                aria-hidden
                className={`shrink-0 text-micro text-sdc-muted motion-interactive ${open ? "rotate-90" : ""}`}
              >
                ▶
              </span>
            )}
            <span className="truncate" title={v}>
              {v}
            </span>
            {i === values.length - 1 && count && <span className="shrink-0 text-note text-sdc-muted">{count}</span>}
          </span>
        ))}
        <span className={`${DRILL_NUM} text-note`} title={totalTitle}>
          {total}
        </span>
      </button>

      {open && (
        // Indented and tinted, with its own scroll so a 300-line group cannot push the
        // total row off the screen. min-w-max + overflow-x so the line columns can be
        // wider than the panel without the panel itself scrolling sideways.
        <div className="styled-scrollbar max-h-[18rem] overflow-auto border-t border-sdc-border-soft bg-sdc-gray-50/60 pl-6">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The punch-line table inside an expanded group. A real <table> here, unlike the group
 * rows: these ARE a uniform matrix, and a table gives them a sticky header for free.
 */
export function DrillLines({
  head,
  foot,
  children,
}: {
  head: ReactNode;
  /**
   * A total row, for when this table IS the drill rather than one group inside it —
   * the ungrouped punch list. Grouped, the total belongs to DrillTable, which owns the
   * group template; ungrouped there is no group template, and a <tfoot> inside the one
   * table cannot fall out of alignment with the columns above it.
   */
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-note">
      <thead className="sticky top-0 z-10 bg-sdc-gray-50">
        <tr className="[&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:text-label [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.08em] [&>th]:text-sdc-muted">
          {head}
        </tr>
      </thead>
      <tbody className="[&>tr]:border-t [&>tr]:border-sdc-border-soft [&>tr:hover]:bg-white [&>tr>td]:px-2 [&>tr>td]:py-1">
        {children}
      </tbody>
      {foot && (
        <tfoot className="sticky bottom-0 bg-sdc-gray-50 [&>tr>td]:border-t [&>tr>td]:border-sdc-border [&>tr>td]:px-2 [&>tr>td]:py-2">
          {foot}
        </tfoot>
      )}
    </table>
  );
}

/** The total label, so grouped and ungrouped word and weight it identically. */
export const DRILL_TOTAL_LABEL = "text-label font-semibold uppercase tracking-[0.08em] text-sdc-muted";

/** "No punches match these filters." — on the panel so every drill words it the same. */
export function DrillEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-note text-sdc-muted">{children}</p>;
}
