// ── The Monthly ETC summary, as data (§37) ──────────────────────────────────
//
// Six separate KPI cards became ONE unified summary card (§37.1). This module exists
// rather than the JSX simply being rearranged, because consolidating six containers
// into one is precisely the change that quietly loses a KPI, points two blocks at the
// same drill-through, or drops a tone — and none of those show up as anything but
// "moved some divs" in a diff of a 400-line component.
//
// So the strip's CONTENT is a pure function of the figures it is handed, and
// EtcMonthKpiCards only renders what comes back. Every §37.13 criterion that is
// decidable — six blocks, each with its own value, status, tone and drill, nothing
// lost — is then a test in tests/etc-kpi-strip.test.ts rather than a claim.
//
// ── What this module is NOT allowed to do (§37.3) ───────────────────────────
//
// It computes no KPI. Every figure arrives already reconciled by reconcileEtcKpis
// (lib/etc-kpi-live.ts), which is the one place that decides whether a field's
// authority is the live cell store or the server snapshot. This file selects, labels
// and formats — nothing else. A formula here would be a second definition of a number
// the grid also shows, which is the exact failure §28 was written about.
//
// Dependency-free apart from types and the two formatters passed in, for the same
// reason lib/etc-kpi-live.ts is: a plain node:test file has to be able to reach it.

import type { EtcMonthKpis, GroupKpi } from "@/lib/etc-month-kpis";
import type { OffGridJob } from "@/lib/off-grid-hours";
import { varianceTooltip } from "@/lib/etc-kpi-live";

// Which drill-through a block opens. Lives here rather than in the component because
// the mapping from block to drill is one of the things §37.2 forbids collapsing, so it
// belongs with the tests that check it stays injective.
export type DrillScope = "Engineering" | "Shop" | "All" | "Unattributed" | "OffGrid" | "Parts";

export type KpiBlockId = "engineering" | "shop" | "parts" | "people" | "undefined" | "offGrid";

// "warn" is work to do rather than work done — deliberately not red, nothing is broken.
// "danger" is a figure about to be LOST (see the off-grid block).
export type KpiTone = "warn" | "danger";

// The second line of a block. Three treatments, because they mean three different
// things and painting one as another is how a card comes to say the opposite of the
// truth (see Unplanned's note below):
//
//   variance   ▲/▼ over-or-under against plan, green/red, or a grey "On plan"
//   unplanned  amber — nobody has planned this yet, which is neither good nor bad
//   text       a neutral factual note ("12 eng · 9 shop")
export type KpiStatusKind = "variance" | "unplanned" | "text";

// ── Flat on purpose ─────────────────────────────────────────────────────────
//
// Every field is a primitive so the component can spread a block straight into a
// React.memo'd MetricBlock and have the shallow comparison work. A nested `status`
// object would be a fresh identity on every render, so every block would re-render
// whenever any ONE figure moved — the §37.4/§37.11 requirement that only the affected
// block updates would be quietly false while looking implemented.
export type KpiBlock = {
  id: KpiBlockId;
  label: string;
  // Formatted for display, or "—" when the figure is genuinely unavailable rather than
  // zero (People booked on a month with no punch rows).
  value: string;
  // The full explanation, carried as the block's title attribute exactly as the six
  // separate cards carried it (§37.1: "any existing tooltip or explanation").
  hint: string | null;
  tone: KpiTone | null;
  // A short non-colour restatement of `tone`, for screen readers and as a visible
  // marker (§37.10: "do not communicate status through color alone"). null when the
  // block has no tone.
  toneLabel: string | null;
  drill: DrillScope | null;
  statusKind: KpiStatusKind;
  statusArrow: "▲" | "▼" | "";
  statusText: string;
  // +1 under plan, −1 over plan, 0 neutral. What colours the status line — kept
  // separate from the text so the component has no arithmetic and no sign convention
  // of its own to get backwards.
  statusSign: -1 | 0 | 1;
  statusTitle: string;
};

export type KpiFormatters = {
  hours: (n: number) => string;
  usd: (n: number) => string;
};

export type KpiStripInput = {
  // Already through reconcileEtcKpis — see the header note.
  kpis: EtcMonthKpis;
  // Time booked to something that isn't a job number.
  importIssues: { label: string; rows: number; hours: number }[];
  // Hours on jobs the grid isn't listing.
  offGridJobs: OffGridJob[];
};

// ── The two totals the strip and its drills must agree on ───────────────────
//
// Exported and used by both the block below and the drill panel that opens from it, so
// a card and its own detail cannot state two different numbers (§37.13 #6).

export function offGridTotalHours(jobs: OffGridJob[]): number {
  return jobs.reduce((s, j) => s + j.hours, 0);
}

export function undefinedHoursTotals(issues: { rows: number; hours: number }[]): {
  hours: number;
  entries: number;
} {
  return {
    hours: issues.reduce((s, i) => s + i.hours, 0),
    entries: issues.reduce((s, i) => s + i.rows, 0),
  };
}

// ── The status line ─────────────────────────────────────────────────────────

type Status = Pick<KpiBlock, "statusKind" | "statusArrow" | "statusText" | "statusSign" | "statusTitle">;

// The grid's Diff, in words. Positive = New ETC is under what's left (good), negative =
// over. Zero says "on plan" rather than "0", which reads as missing.
function variance(value: number, format: (n: number) => string, title: string): Status {
  const rounded = Math.round(value);
  if (rounded === 0) {
    return { statusKind: "variance", statusArrow: "", statusText: "On plan", statusSign: 0, statusTitle: title };
  }
  return {
    statusKind: "variance",
    statusArrow: rounded > 0 ? "▲" : "▼",
    // The UNROUNDED value is formatted, exactly as the old Variance component did — the
    // formatter is what rounds, and it rounds the same way everywhere in the app.
    statusText: `${format(Math.abs(value))} ${rounded > 0 ? "under" : "over"}`,
    statusSign: rounded > 0 ? 1 : -1,
    statusTitle: title,
  };
}

// A neutral fact, not a judgement — no arrow, no colour.
function note(text: string, title: string): Status {
  return { statusKind: "text", statusArrow: "", statusText: text, statusSign: 0, statusTitle: title };
}

// ── Engineering / Shop ──────────────────────────────────────────────────────
//
// While anything is still unplanned the block reports THAT rather than a variance. A
// blank New ETC counts as 0, so an untouched cell contributes its whole Hours Left —
// real, but calling it "under plan" would be a lie: nobody has planned it at all. As
// cells get filled in, the unplanned figure shrinks to zero and the block flips to the
// true over/under, which is the state it has to be right in at submission. Both numbers
// are always in the tooltip.
function groupStatus(g: GroupKpi, fmt: KpiFormatters): Status {
  const unplanned = g.diffUnplanned;
  if (Math.round(unplanned) === 0) {
    return variance(g.diff, fmt.hours, "Sum of (Hours Left − New ETC) over the cells a manager has confirmed");
  }
  const rest = Math.round(g.diff - unplanned);
  return {
    statusKind: "unplanned",
    statusArrow: "",
    statusText: `${fmt.hours(unplanned)} unplanned`,
    statusSign: 0,
    statusTitle:
      `${fmt.hours(unplanned)} hours sit in sections with no New ETC entered — counted in full because an empty cell plans nothing. ` +
      (rest === 0
        ? "Every cell that HAS been planned is exactly on plan."
        : `Separately, the cells already planned are ${fmt.hours(Math.abs(rest))} ${rest > 0 ? "under" : "over"}.`),
  };
}

// ── The strip ───────────────────────────────────────────────────────────────
//
// Order is the reading order (§37.10) and the one the six cards were in: the two hours
// groups, the money, the headcount, then the two "missing from every figure here"
// blocks. Off-grid is last because it is the only conditional one.
export function buildKpiBlocks(input: KpiStripInput, fmt: KpiFormatters): KpiBlock[] {
  const { kpis, importIssues, offGridJobs } = input;
  const undef = undefinedHoursTotals(importIssues);
  const offGridTotal = offGridTotalHours(offGridJobs);

  const group = (id: "engineering" | "shop", label: string, g: GroupKpi, drill: DrillScope): KpiBlock => ({
    id,
    label,
    value: fmt.hours(g.worked),
    hint: kpis.hasPunchData ? `${g.people} ${g.people === 1 ? "person" : "people"} booked time` : null,
    tone: null,
    toneLabel: null,
    // No punch rows means there is nothing behind the figure to show, which is why the
    // link is absent rather than opening an empty panel.
    drill: kpis.hasPunchData ? drill : null,
    ...groupStatus(g, fmt),
  });

  const blocks: KpiBlock[] = [
    group("engineering", "Engineering hours", kpis.engineering, "Engineering"),
    group("shop", "Shop hours", kpis.shop, "Shop"),
    {
      id: "parts",
      label: "Parts spent",
      value: fmt.usd(kpis.parts.spent),
      hint: null,
      tone: null,
      toneLabel: null,
      drill: "Parts",
      ...variance(
        kpis.parts.diff,
        fmt.usd,
        // The subtraction in this sentence produces the number beside it, exactly —
        // see varianceTooltip. Quoting the group totals instead is what made the old
        // version stop adding up (§28.15).
        varianceTooltip({
          leftLabel: "Money Left",
          plannedLeft: kpis.parts.plannedMoneyLeft,
          plannedNewEtc: kpis.parts.plannedNewEtc,
          groupLeft: kpis.parts.moneyLeft,
          groupNewEtc: kpis.parts.newEtc,
          format: fmt.usd,
        }),
      ),
    },
    {
      id: "people",
      label: "People booked",
      value: kpis.hasPunchData ? String(kpis.peopleTotal) : "—",
      hint: kpis.hasPunchData
        ? // Not eng + shop: anyone who booked to both would be double-counted.
          `${kpis.engineering.people} engineering · ${kpis.shop.people} shop (distinct overall)`
        : "No punch-level hours stored for this month yet",
      tone: null,
      toneLabel: null,
      drill: kpis.hasPunchData ? "All" : null,
      // The split is now VISIBLE rather than tooltip-only, which makes it worth saying
      // why it need not add up to the headline — it can fall either side. Someone who
      // booked to both groups is counted in both figures but once in the headline, and
      // someone whose sections belong to neither group (the pool sections the ETC grid
      // excludes) is in the headline but in neither figure. Measured live on 2026-07:
      // 49 people against 24 eng · 21 shop.
      ...note(
        kpis.hasPunchData ? `${kpis.engineering.people} eng · ${kpis.shop.people} shop` : "No punch data yet",
        kpis.hasPunchData
          ? `${kpis.engineering.people} booked engineering sections · ${kpis.shop.people} booked shop sections. These need not add up to ${kpis.peopleTotal}: somebody who booked to both is counted once in the headline, and somebody whose sections fall in neither group is counted in the headline only.`
          : "No punch-level hours stored for this month yet",
      ),
    },
    // Hours booked to something that isn't a job number. Part of the summary, not just
    // the banner above the grid, because this is the one figure here that is MISSING
    // from every other figure — it belongs beside the totals it is absent from.
    // Shown even at zero: "0 undefined hours" is a daily reassurance that the import is
    // clean, where an absent block says nothing either way.
    {
      id: "undefined",
      label: "Undefined hours",
      value: fmt.hours(undef.hours),
      hint:
        undef.hours > 0
          ? `${undef.entries} ${undef.entries === 1 ? "entry" : "entries"} · ${importIssues
              .map((i) => i.label)
              .join(", ")} — not counted in any figure here`
          : "Every punch this month has a valid job number",
      tone: undef.hours > 0 ? "warn" : null,
      toneLabel: undef.hours > 0 ? "Needs attention" : null,
      drill: undef.hours > 0 ? "Unattributed" : null,
      ...note(
        undef.hours > 0 ? `${undef.entries} ${undef.entries === 1 ? "entry" : "entries"}` : "None outstanding",
        undef.hours > 0
          ? `${importIssues.map((i) => i.label).join(", ")} — these punches reach no figure on this page`
          : "Every punch this month has a valid job number",
      ),
    },
  ];

  // The mirror image of the block before it: those hours have no job, these have a job
  // the grid has stopped showing — and both are missing from every other figure here.
  //
  // Red rather than amber: undefined-hours sit there until someone fixes Paylocity, but
  // these rows are DELETED by the next Refresh Data or Submit ETC, so the window to act
  // closes. Hidden at zero, unlike Undefined hours, because a permanent "0 off-grid"
  // block would just be dead space on the normal month.
  if (offGridJobs.length > 0) {
    const jobWord = offGridJobs.length === 1 ? "job" : "jobs";
    blocks.push({
      id: "offGrid",
      label: "Hours off the grid",
      value: fmt.hours(offGridTotal),
      hint: `${offGridJobs.length} ${jobWord} not listed below — ${offGridJobs
        .slice(0, 2)
        .map((j) => j.jobId)
        .join(", ")}${offGridJobs.length > 2 ? `, +${offGridJobs.length - 2} more` : ""} — missing from every figure here`,
      tone: "danger",
      toneLabel: "Action needed",
      drill: "OffGrid",
      ...note(
        `${offGridJobs.length} ${jobWord} not listed`,
        "These hours reach no total in the grid below, and the rows are deleted by the next Refresh Data or Submit ETC",
      ),
    });
  }

  return blocks;
}

// ── Which block is fetching, and which one failed (§37.9) ───────────────────
//
// Three fetch lanes serve six blocks: the punch detail behind Engineering / Shop /
// People, the parts detail behind Parts spent, and the hours export behind Undefined
// hours. Off-grid has no lane at all — its rows arrive with the page.
//
// The rule §37.9 asks for is that a slow or failed KPI must not affect the other five,
// and it is decidable, so it lives here rather than as a chain of ternaries in the JSX:
// a block reports a state only when ITS OWN drill is the open one. Nothing is fetched
// for a closed drill, so at most one block is ever non-idle and the other five keep
// showing their confirmed values.
export type KpiLane = {
  // A request is in flight for this lane.
  loading: boolean;
  // The last attempt failed, and nothing has replaced it yet.
  error: string | null;
  // Data is already cached, so a `loading` flag belongs to a background refresh rather
  // than to an empty panel — the block keeps its confirmed value and says nothing
  // (§37.9: "keep confirmed values visible during a background update").
  loaded: boolean;
};

export type KpiLanes = {
  punches: KpiLane;
  parts: KpiLane;
  undefinedHours: KpiLane;
};

export type KpiDetailState = "idle" | "loading" | "error";

// Which lane a drill scope reads from. Engineering, Shop and People share the punch
// detail — one request, narrowed client-side — which is why they share a lane.
export function kpiLaneFor(drill: DrillScope): keyof KpiLanes | null {
  if (drill === "Parts") return "parts";
  if (drill === "Unattributed") return "undefinedHours";
  if (drill === "OffGrid") return null;
  return "punches";
}

export function kpiDetailState(
  blockDrill: DrillScope | null,
  openDrill: DrillScope | null,
  lanes: KpiLanes,
): KpiDetailState {
  if (blockDrill == null || openDrill !== blockDrill) return "idle";
  const lane = kpiLaneFor(blockDrill);
  if (lane == null) return "idle";
  const state = lanes[lane];
  if (state.error) return "error";
  return state.loading && !state.loaded ? "loading" : "idle";
}

// ── Layout (§37.8, revised §41.13) ──────────────────────────────────────────
//
// Stacked when narrow, two up, three up, then ONE row with however many blocks there
// are. The count VARIES — off-grid only appears when something is off the grid — so a
// hardcoded grid-cols-6 would wrap the seventh block onto a line of its own and
// hardcoding 7 would leave a gap on every normal month. The column count follows the
// block count through a CSS variable instead, so both cases fill the row.
//
// ── Why these are CONTAINER queries, not breakpoints (§41.13) ───────────────
//
// The previous version reached one row at Tailwind's `xl`, which is a 1280px VIEWPORT.
// This card is not the viewport: it sits inside the page container, inset by a sidebar
// that is ~220px expanded. So a 1440px laptop gives the card ~1180px — under 1280 — and
// the card fell back to three columns and two rows on exactly the "normal desktop"
// §41.13 is about. The breakpoint was measuring the wrong box.
//
// `@container` on the section (see EtcMonthKpiCards) makes these respond to the CARD's
// own width, which is the width that actually decides whether six values fit. That also
// makes it correct for free: collapsing the sidebar widens the card and it re-lays out,
// and browser zoom changes effective width so 80%-200% is handled by the same rule
// rather than by a separate set of breakpoints.
//
// ── auto-fit, not breakpoints, and not a column count ───────────────────────
//
// `repeat(auto-fit, minmax(175px, 1fr))` fits as many blocks per row as the card can
// hold at a readable width and wraps the rest. That replaces both the breakpoint ladder
// and the `--kpi-cols` variable, and it is not a simplification for its own sake — a
// fixed threshold cannot be correct when the BLOCK COUNT VARIES. "One row from 1100px"
// is right for six blocks (183px each) and wrong for seven (157px each, which clips);
// a container query cannot read the block count in its condition, so any single
// threshold is wrong for one of the two cases. A per-block minimum is right for both.
//
// 175px is measured, not chosen. Forcing the real card to N-across and checking every
// text node for overflow: at 180px nothing clips; at 154px "24 eng · 21 shop" and
// "5 jobs not listed" both do. 175px sits just under the proven-clean width, and `1fr`
// lets each block grow past it so a row is always exactly filled and every block in it
// is the same width (§41.13).
//
// It is also self-correcting for the things §41.26 asks about: collapsing the sidebar
// widens the card and it re-lays out, and browser zoom changes the effective width, so
// 80%-200% is handled by the same rule instead of a second set of breakpoints.
//
// gap-px is what draws the dividers: the blocks are opaque and the container behind
// them is the divider colour, so the 1px gaps ARE the section boundaries (§37.7 —
// one outer border, no nested card borders). It also survives wrapping, which a
// per-block border cannot: a left border on every block leaves a stray line at the
// start of each wrapped row.
export const KPI_GRID_CLASS =
  "grid gap-px [grid-template-columns:repeat(auto-fit,minmax(175px,1fr))]";

/** The measured floor below which a block's status line clips. See KPI_GRID_CLASS. */
export const KPI_BLOCK_MIN_PX = 175;
