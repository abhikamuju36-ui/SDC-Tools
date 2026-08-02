import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { compareJobIds, isSdcCustomer } from "@/lib/job-filters";
import { EtcViewMenu } from "@/components/EtcViewMenu";
import { EtcSyncMenu } from "@/components/EtcSyncMenu";
import { SyncHistoryButton } from "@/components/SyncHistoryButton";
import { getEtcMonthJobWhere } from "@/lib/etc-month-jobs";
import { getEtcMonthKpis } from "@/lib/etc-month-kpis";
import { getEtcMonthHoursDetail } from "@/lib/job-hours-detail";
import { EtcMonthKpiCards } from "@/components/EtcMonthKpiCards";
import { PartsCostNewEtcCell } from "@/components/PartsCostNewEtcCell";
import { EtcSectionCells } from "@/components/EtcSectionCells";
import { StandardRatesProvider, EtcStandardCells, StandardGrandCells } from "@/components/EtcStandardColumns";
import type { StandardJobBase, StandardRates, FrozenStandardRow, PoolRowInput } from "@/components/EtcStandardColumns";
import { EtcRatesButton } from "@/components/EtcRatesButton";
import { StandardPoolPanel } from "@/components/StandardPoolPanel";
import type { PoolPanelRow, NewProjectRow } from "@/components/StandardPoolPanel";
import { newProjectsEnteringMonth } from "@/lib/standard-pool-local";
import {
  refreshPools,
  savePools,
  submitStandardSheetMonth,
  reopenStandardSheetMonth,
} from "@/lib/standard-sheet-actions";
import { ETC_SECTIONS, PARTS_COST_SECTION } from "@/lib/sections";
import { calcHoursLeft, suggestNewEtc, isMonthLocked, isValidMonth, nextMonth, round2, workingDaysInMonth, effectiveNewEtc, newEtcDiff } from "@/lib/etc";
import { submitMonth, reopenMonth, syncPowerBiForEtc } from "@/lib/etc-actions";
import { RunReportButton } from "@/components/RunReportButton";
import { SubmitAndLockButton } from "@/components/SubmitAndLockButton";
import { ReopenMonthButton } from "@/components/ReopenMonthButton";
import { SaveEtcDraftsButton } from "@/components/SaveEtcDraftsButton";
import { EtcAutosave } from "@/components/EtcAutosave";
import { isStandardSheetUnlocked, hadWrongPassword, unlockStandardSheet, lockStandardSheet } from "@/lib/standard-sheet-gate";
import { isEtcEditUnlocked, hadEtcEditWrongPassword, lockEtcEdit } from "@/lib/etc-edit-gate";
import { getExecutionEtcByJob, isInStandardFeesAllocation } from "@/lib/execution-etc";
import { PageTitle } from "@/components/ui/Typography";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { hours as formatHours } from "@/components/ui/format";
import { MonthYearSelect } from "@/components/MonthYearSelect";
import { JobCellMenu } from "@/components/JobCellMenu";
import { getSchedulerLinkContext, schedulerScheduleUrl } from "@/lib/scheduler-link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, TABLE_HEADER_ROW, TABLE_GRID, ETC_COL_W } from "@/components/ui/classnames";
import { abbreviateLabel } from "@/lib/abbrev";
import { DragScroll } from "@/components/DragScroll";

// Matches the real "Managers Fill Out" sheet's column shape exactly — every
// department block has these same 5 columns; Parts Cost and the Total rollup
// use the sheet's own label variants.
const SUB_COLUMNS = ["Prior ETC", "Hours Worked Month", "Hours Left", "New ETC", "Diff"] as const;
const PARTS_COST_SUB_COLUMNS = ["Prior ETC", "Money Spent Month", "Money Left", "New ETC", "Diff"] as const;
const TOTAL_SUB_COLUMNS = ["Prior ETC", "Hours Worked", "Hours Left", "Total New ETC", "Diff"] as const;


// The sheet's 5-level header above the column labels: Phase -> billing group
// (Engineering/Shop) -> sub-group (ME / CE / General Engineering / dept
// abbreviations) -> colored section cell. Rather than hardcode column counts
// (which break the moment the Engineering/Shop filter hides some), the header
// rows are derived at render time from the visible column list by run-length
// grouping consecutive columns that share a label. Display-only — internal
// section names/phases in sections.ts are unchanged.
const PHASE_DISPLAY: Record<string, string> = {
  "Complete Design & Build": "Complete Design and Build",
  "Machine Testing": "Testing",
  "Teardown & Install": "Teardown and Install",
};
const SUBGROUP_DISPLAY: Record<string, string> = {
  "10-211": "ME",
  "10-312": "CE",
  "10-313": "CE",
  "10-515": "General Engineering",
  "10-516": "General Engineering",
  "10-517": "General Engineering",
  "10-518": "General Engineering",
  "10-411": "Shop",
  "10-412": "Shop",
  "40-211": "ME & CE & GE",
  "40-411": "MB & EB",
  "50-211": "ME & CE & GE",
  "50-411": "MB & EB",
};

type EtcCol = {
  code: string;
  name: string;
  billingGroup: "Engineering" | "Shop";
  phaseLabel: string;
  groupLabel: string;
  subgroupLabel: string;
  sectionDisplay: string;
};

// Consecutive columns sharing keyOf(col) collapse into one header cell whose
// colSpan is count × 5 (the sub-columns per section). Used for the phase,
// billing-group, and sub-group header rows.
function headerRuns(cols: EtcCol[], keyOf: (c: EtcCol) => string, labelOf: (c: EtcCol) => string) {
  const runs: { key: string; label: string; count: number }[] = [];
  for (const c of cols) {
    const key = keyOf(c);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.count += 1;
    else runs.push({ key, label: labelOf(c), count: 1 });
  }
  return runs;
}

const DEPT_GROUPS = ["Engineering", "Shop"] as const;

// Colored section-cell labels, exactly as the sheet prints them (no "CE"
// prefixes; Testing/Teardown show "All"/"Total" rather than section names).
const ETC_SECTION_DISPLAY: Record<string, string> = {
  "10-211": "ME Gen",
  "10-312": "Design and Drawings",
  "10-313": "Software",
  "10-515": "HMI",
  "10-516": "Robot",
  "10-517": "Vision",
  "10-518": "Database and Device",
  "10-411": "Mech Build",
  "10-412": "Elec Build",
  "40-211": "All",
  "40-411": "Total",
  "50-211": "All",
  "50-411": "Total",
};

// Department header colors, matching the real "Managers Fill Out" sheet's
// column banding (ME = blue, CE = green, general engineering = teal, shop =
// tan). Machine Testing/Teardown & Install swap in their own Engineering/Shop
// tint (40-211/50-211 = Engineering, 40-411/50-411 = Shop) since those phases
// have no per-department breakdown, just the two billing groups.
// Re-themed to the SDC brand palette, matching the Projects tab's group bands
// so the two grids read as one system: ME = light blue, CE = green tint,
// General Engineering = bold brand blue, Shop = yellow tint, Engineering
// (40/50-211) = light blue #aacee8. Bold blue carries white text.
const SECTION_HEADER_COLOR: Record<string, string> = {
  "10-211": "bg-sdc-blue-light text-sdc-navy", // ME
  "10-312": "bg-sdc-green-bg text-sdc-navy", // CE — Design & Drawings
  "10-313": "bg-sdc-green-bg text-sdc-navy", // CE — Software
  "10-515": "bg-sdc-blue text-white", // General Engineering
  "10-516": "bg-sdc-blue text-white",
  "10-517": "bg-sdc-blue text-white",
  "10-518": "bg-sdc-blue text-white",
  "10-411": "bg-sdc-yellow-bg text-sdc-navy", // Shop — Mechanical Build
  "10-412": "bg-sdc-yellow-bg text-sdc-navy", // Shop — Electrical Build
  "40-211": "bg-sdc-blue-100 text-sdc-navy", // Engineering ME & CE
  "50-211": "bg-sdc-blue-100 text-sdc-navy",
  "40-411": "bg-sdc-yellow-bg text-sdc-navy", // Shop MB & EB
  "50-411": "bg-sdc-yellow-bg text-sdc-navy",
};

// Faint column wash (used on the DIFF sub-column header, which has no function
// color of its own) — the same brand hues at low opacity.
const SECTION_HEADER_COLOR_LIGHT: Record<string, string> = {
  "10-211": "bg-sdc-blue-light/60",
  "10-312": "bg-sdc-green-bg/60",
  "10-313": "bg-sdc-green-bg/60",
  "10-515": "bg-sdc-blue/10",
  "10-516": "bg-sdc-blue/10",
  "10-517": "bg-sdc-blue/10",
  "10-518": "bg-sdc-blue/10",
  "10-411": "bg-sdc-yellow-bg/60",
  "10-412": "bg-sdc-yellow-bg/60",
  "40-211": "bg-sdc-blue-100/25",
  "50-211": "bg-sdc-blue-100/25",
  "40-411": "bg-sdc-yellow-bg/60",
  "50-411": "bg-sdc-yellow-bg/60",
};

// The full ETC column list with all its header-row labels resolved once, so
// filtering is just `.filter(...)` on this and the header derives from it.
const ALL_ETC_COLS: EtcCol[] = ETC_SECTIONS.map((s) => ({
  code: s.code,
  name: s.name,
  billingGroup: s.billingGroup,
  phaseLabel: PHASE_DISPLAY[s.phase] ?? s.phase,
  groupLabel: s.billingGroup,
  subgroupLabel: SUBGROUP_DISPLAY[s.code] ?? s.name,
  sectionDisplay: ETC_SECTION_DISPLAY[s.code] ?? s.name,
}));

// Column-identity backgrounds for the 5-column block shared by every
// department/Parts Cost/Engineering/Shop group, matching the real sheet.
const HOURS_WORKED_BG = "bg-[#C7DAF7]";
const HOURS_LEFT_BG = "bg-[#F1F6FD]";
// New ETC cells always use the plain neutral background now — the old yellow
// "unconfirmed suggestion" wash was removed at the managers' request so the
// column reads clean for lookup like every other column. The pending count in
// the toolbar still tracks what's unconfirmed (needsReview), so nothing is lost
// operationally. Arg kept so callers don't all need editing.
function newEtcBg(_hasValue: boolean) {
  return "bg-[#F2F2F2]";
}
function diffBg(diff: number) {
  // Epsilon, not ===: hour sums carry float residue (1e-13) that would tint
  // the cell red/green while wholeNum displays a plain 0.
  if (Math.abs(diff) < 0.005) return "bg-white";
  return diff < 0 ? "bg-[#EEADAC]" : "bg-[#9FCE62]";
}

// Hours display on this page is whole numbers with thousands separators — no
// decimals, rounded rather than truncated. Delegates to the shared formatter so
// this grid can't drift from the KPI cards above it, the Projects grid or the
// charts: a four-figure hour total was printing as "21993" here while the card
// directly above it read "2,198", which is the same number type formatted two
// ways on one screen. Use this for any value added here later too.
//
// Display-only, and it must stay that way — every form field on this page carries
// its raw value (String(worked), the New ETC input's own text state), because a
// comma would break the Number() parse in submitMonth.
function wholeNum(n: number): string {
  return formatHours(n);
}

// Header cells have no row value, so "New ETC"/"Diff" fall back to a neutral
// flat shade rather than the value-conditional colors used in the body.
function subColHeaderBg(col: string): string {
  if (col === "Prior ETC") return "bg-[#5E91D3] text-sdc-gray-700";
  if (col === "Hours Worked Month" || col === "Hours Worked" || col === "Money Spent Month") return HOURS_WORKED_BG;
  if (col === "Hours Left" || col === "Money Left") return HOURS_LEFT_BG;
  if (col === "New ETC" || col === "Total New ETC") return "bg-[#F2F2F2]";
  return "";
}

// Column-level "this is editable" marker — replaces the old per-cell dashed
// underline, which got noisy across a grid this dense. Only "New ETC" is
// actually manager-editable (Hours Worked Month auto-syncs from Power BI and
// is read-only display now; Money Spent Month is likewise a read-only
// actual; the Total/Standard columns are pure rollups), so the pencil only
// appears on that column-label header cell.
const EDITABLE_COL_LABELS = new Set(["New ETC"]);
function colHeaderLabel(col: string) {
  if (!EDITABLE_COL_LABELS.has(col)) return col;
  return (
    <>
      {col} <span className="text-sdc-blue" title="Editable column">✎</span>
    </>
  );
}

// Same column-identity backgrounds, without a text-color opinion — for cells
// (like the "—" empty-section placeholder) that set their own text color.
function subColBodyBg(col: string): string {
  if (col === "Hours Worked Month" || col === "Hours Worked" || col === "Money Spent Month") return HOURS_WORKED_BG;
  if (col === "Hours Left" || col === "Money Left") return HOURS_LEFT_BG;
  if (col === "New ETC" || col === "Total New ETC") return "bg-[#F2F2F2]";
  if (col === "Diff") return "bg-white";
  return "";
}

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
// Cents-precision counterpart to currency() above, for tooltips — Parts Cost
// display rounds to whole dollars, but the underlying values (Power BI
// actuals, manager overrides) carry cents.
function currencyExact(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Full names for the department abbreviations printed in the sub-group header
// row (SUBGROUP_DISPLAY) — only defined for labels that are actually
// abbreviated; "General Engineering"/"Shop" are already spelled out.
const SUBGROUP_FULL_NAME: Record<string, string> = {
  ME: "Mechanical Engineering",
  CE: "Controls Engineering",
  "ME & CE & GE": "Mechanical Engineering & Controls Engineering & General Engineering",
  "MB & EB": "Mechanical Build & Electrical Build",
};

// The Standard Sheet columns appended to the grid once unlocked, in the order
// they print on that page — Execution Rates, Execution ETC (New ETC), Total
// ETC, the merged Standard Fees (Engineering + Shop as one), Contingency,
// Total Standard Fees, Notes. Display-only here (editing lives on /standard-sheet).
const STANDARD_LEAF_COLUMNS = [
  "Total ETC", "% Total",
  "Standard Fees",
  "Contingency",
  "Total Std Fees",
  "Notes",
] as const;

// Category → billing group / department, in the sheet's print order — drives
// the read-only "Standard Fees By Department" side panel.
const POOL_PANEL_META = [
  { category: "ENGINEERING_PM", group: "Engineering", dept: "PM" },
  { category: "ENGINEERING_WARRANTY", group: "Engineering", dept: "Warranty" },
  { category: "SHOP_MANUFACTURING", group: "Shop", dept: "Mfg" },
  { category: "SHOP_WARRANTY", group: "Shop", dept: "Warranty" },
] as const;

// The department pools for `month`, or — if that month was never refreshed —
// the most recent PRIOR month's pools as a labeled fallback (so Standard Fees
// never silently collapse to $0). Mirrors the same-named helper on the
// /standard-sheet tab, keeping the two views in lockstep on which figures show.
async function loadEffectivePools(month: string) {
  const own = await prisma.categoryPool.findMany({ where: { month } });
  if (own.length > 0) return { pools: own, carriedFrom: null as string | null };
  const prior = await prisma.categoryPool.findFirst({
    where: { month: { lt: month } },
    orderBy: { month: "desc" },
    select: { month: true },
  });
  if (!prior) return { pools: own, carriedFrom: null as string | null };
  return { pools: await prisma.categoryPool.findMany({ where: { month: prior.month } }), carriedFrom: prior.month };
}
// Marks the left edge of the whole Standard block, every phase/Parts-Cost/
// Total block boundary, and the billing-group/sub-group boundaries nested
// inside a phase — all unified at one heavier weight (8px) than the grid's
// normal thin gridline, so every structural section break reads the same.
// `!` forces these to win over TABLE_GRID's blanket `[&_th]:border-l`/
// `[&_td]:border-l` rules, which — being a class+element selector —
// otherwise out-specificity a plain utility class and silently reset the
// border back to the grid's thin default. Matches TABLE_GRID's own gridline
// color (#808080, a mid gray) exactly — same color on both the wide
// border-left and the thin border-bottom means their mitered corner is
// invisible, instead of the jagged two-tone seam a mismatched divider color
// made.
const STD_EDGE = "border-l-8! border-l-[#808080]!";
const PHASE_EDGE = "border-l-8! border-l-[#808080]!";
const GROUP_EDGE = "border-l-8! border-l-[#808080]!";
const SUBGROUP_EDGE = "border-l-8! border-l-[#808080]!";

// Row height / column width density controls (GridZoomControls, in the
// toolbar) work by setting --etc-row-py/--etc-col-px on the document root;
// these two blanket rules are what actually consume them. Same specificity
// trick as TABLE_GRID (a class+element descendant selector beats a plain
// utility class on the cell itself) so no `!` is needed here — the fallback
// (4px) reproduces the grid's current py-1/px-1 exactly, so nothing changes
// until a user clicks +/-. `:not sticky` keeps the frozen #/Job Id/Job Name
// columns — which own their own fixed widths — out of the column control.
// Row height also scales the in-cell inputs' vertical padding + collapses line
// height, so at the minimum the rows shrink right down to the gridlines instead
// of bottoming out at the inputs' own py-1. Column width scales cell + input
// horizontal padding.
//
// --etc-font-size (Text size stepper) drives the data-cell font on the same
// class+element descendant-selector trick, so it beats each cell's hardcoded
// text-[10px] with no `!`. The Text size stepper also bumps --etc-row-py /
// --etc-col-px in step, so rows and columns grow to fit the larger text rather
// than clipping it. Fallback 10px reproduces the current text-[10px] exactly.
// Body data cells (td), their inputs, and inner spans scale; the sticky label
// columns and section headers keep their fixed sizing.
// Row height is scoped to TBODY on purpose. It used to hit every `td`, which
// included the grand-total row — so that row's own py-2.5 was overridden down to
// 4px and it read as a hairline strip under the data (reported 2026-07-30:
// "bottom header too thin"). Horizontal padding and font size stay grid-wide,
// because the totals must keep column alignment with the rows above them.
const ZOOM_CONTROLS =
  "[&_tbody_td]:py-[var(--etc-row-py,4px)] [&_tbody_td]:leading-none [&_td_input]:py-[var(--etc-row-py,4px)] [&_td_input]:leading-none [&_td:not([class*='sticky'])]:px-[var(--etc-col-px,4px)] [&_th:not([class*='sticky'])]:px-[var(--etc-col-px,4px)] [&_td_input:not([class*='sticky'])]:px-[var(--etc-col-px,4px)] [&_td:not([class*='sticky'])]:text-[length:var(--etc-font-size,10px)] [&_td_input]:text-[length:var(--etc-font-size,10px)] [&_td_span]:text-[length:var(--etc-font-size,10px)]";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function MonthlyEtcPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; dept?: string; standards?: string; jobname?: string; billables?: string }>;
}) {
  const { month: monthParam, dept: deptParam, standards: standardsParam, jobname: jobnameParam, billables: billablesParam } = await searchParams;

  // Billable / Non-Billable row filter (same pattern as the Projects tab).
  // Absent => both shown. SDC's own projects read as Non-Billable regardless of
  // the stored flag (isSdcCustomer), matching how they display everywhere else.
  const BILLABLE_OPTIONS = ["Billable", "Non-Billable"];
  const selectedBillables = billablesParam === undefined ? BILLABLE_OPTIONS : billablesParam.split(",").filter(Boolean);
  const showBillable = selectedBillables.includes("Billable");
  const showNonBillable = selectedBillables.includes("Non-Billable");
  const billableFilterActive = !(showBillable && showNonBillable);
  // Job Name column toggle (Columns dropdown) — shown unless ?jobname=0.
  const showJobName = jobnameParam !== "0";
  // The Standard Sheet entry point is hidden by design (only a few people know
  // it exists). The password box renders only when this secret flag is present
  // — reached by right-clicking the "Monthly ETC" sidebar item. It never shows
  // on the plain /etc URL, so it's not discoverable by browsing the page.
  const standardsRevealRequested = standardsParam === "1";

  // Engineering / Shop column filter. Empty or absent => show both (the full
  // grid); the grid can never collapse to zero section columns.
  const selectedGroups = (() => {
    const raw = (deptParam ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((g): g is (typeof DEPT_GROUPS)[number] => g === "Engineering" || g === "Shop");
    return new Set(raw.length ? raw : DEPT_GROUPS);
  })();
  const visibleCols = ALL_ETC_COLS.filter((c) => selectedGroups.has(c.billingGroup));
  const visibleGroups = DEPT_GROUPS.filter((g) => selectedGroups.has(g));

  // Every section that starts a new phase (Complete Design & Build / Testing /
  // Teardown & Install) gets a heavier divider — like the sheet's solid black
  // rules between phase blocks — instead of the grid's usual thin gridline.
  const phaseStartCodes = new Set<string>();
  {
    let lastPhase: string | undefined;
    for (const c of visibleCols) {
      if (c.phaseLabel !== lastPhase) {
        phaseStartCodes.add(c.code);
        lastPhase = c.phaseLabel;
      }
    }
  }

  // Same idea, one level down: billing-group (Engineering/Shop) boundaries
  // within a phase, and sub-group (ME/CE/GE/dept) boundaries within a billing
  // group — each gets its own divider weight, lighter than the phase divider
  // above it but still heavier than the grid's default gridline.
  const groupStartCodes = new Set<string>();
  const subgroupStartCodes = new Set<string>();
  {
    let lastGroup: string | undefined;
    let lastSubgroup: string | undefined;
    for (const c of visibleCols) {
      const groupKey = `${c.phaseLabel}|${c.groupLabel}`;
      if (groupKey !== lastGroup) {
        groupStartCodes.add(c.code);
        lastGroup = groupKey;
      }
      const subgroupKey = `${groupKey}|${c.subgroupLabel}`;
      if (subgroupKey !== lastSubgroup) {
        subgroupStartCodes.add(c.code);
        lastSubgroup = subgroupKey;
      }
    }
  }

  // Priority: phase > billing-group > sub-group > the grid's normal thin
  // gridline. Every boundary set above a given level also implies the ones
  // below it (a new phase is also a new group and sub-group), so checking in
  // this order and returning on the first match is enough.
  function edgeFor(code: string, index: number): string {
    if (index === 0) return "border-l border-sdc-border";
    if (phaseStartCodes.has(code)) return PHASE_EDGE;
    if (groupStartCodes.has(code)) return GROUP_EDGE;
    if (subgroupStartCodes.has(code)) return SUBGROUP_EDGE;
    return "border-l border-sdc-border";
  }

  const distinctMonths = await prisma.etcEntry.findMany({
    distinct: ["month"],
    select: { month: true },
    orderBy: { month: "desc" },
  });
  // A malformed ?month= (typo'd URL) must not flow into queries/date math —
  // fall back to the default month instead of rendering a nonsense view.
  const month = (monthParam && isValidMonth(monthParam) ? monthParam : undefined) || distinctMonths[0]?.month || currentMonth();

  // A month is locked when it has entries and none still need review — months
  // with any pending entry are "in progress"; the rest of the history is locked.
  const inProgressMonths = await prisma.etcEntry.groupBy({
    by: ["month"],
    where: { needsReview: true },
  });
  const inProgressSet = new Set(inProgressMonths.map((m) => m.month));
  const lockedMonthList = distinctMonths.map((m) => m.month).filter((m) => !inProgressSet.has(m));

  // Once the latest month is locked, the only seedable month is the next one —
  // surface it in the picker so it can actually be started.
  const latestMonth = distinctMonths[0]?.month;
  const nextStartable = latestMonth && !inProgressSet.has(latestMonth) ? nextMonth(latestMonth) : undefined;

  // A reopened HISTORICAL month is a correction pass: every stored newEtc is a
  // previously-confirmed value the grid must seed its inputs from, so a
  // no-changes resubmit is a true no-op. Detected by month position rather
  // than per-entry submittedAt, because Excel restores and the Power BI
  // history backfill both leave submittedAt null on confirmed history.
  const isHistoricalMonth = latestMonth != null && month < latestMonth;

  // Which jobs the grid shows depends on whether the month is history:
  // - A locked month is a frozen snapshot — show exactly the jobs that have
  //   entries in it (Power BI parity), regardless of what their status is
  //   TODAY. Filtering by current status hides every job completed since,
  //   which made historical months show far fewer jobs than the source report.
  // - An in-progress (or not-yet-started) month keeps etcActiveJobFilter —
  //   the same universe seeding/pruning/submission operate on, which must
  //   stay in lockstep with the grid.
  // Single source of truth for the month's job universe — the Standard Sheet
  // reads from the exact same helper, so the two pages can never drift on which
  // projects a month contains.
  const { where: monthJobWhere, monthIsLocked } = await getEtcMonthJobWhere(month);

  const [jobs, lastPowerBiSync, hoursActualFreshness, etcHoursFreshness, importIssues] = await Promise.all([
    prisma.job.findMany({
      where: monthJobWhere,
      include: { etcEntries: { where: { month } }, executionRate: true },
    }),
    prisma.jobMonthlyActualHours.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
    prisma.powerBiFreshness.findUnique({ where: { source: "hours_actual" }, select: { refreshedThrough: true, status: true, checkedAt: true } }),
    // The ETC grid's own hours sync, tracked separately: syncActualHours can
    // succeed (leaving "hours_actual" looking healthy) while this one fails,
    // which is exactly how the grid went stale behind a reassuring header.
    prisma.powerBiFreshness.findUnique({ where: { source: "etc_hours_worked" }, select: { status: true, checkedAt: true } }),
    // Time the importer could not attribute to any job — booked against
    // "Not Defined" and similar. Absent from every figure on this page, so it
    // is stated rather than left as an unexplained shortfall.
    prisma.hoursImportIssue.findMany({ where: { month }, orderBy: { hours: "desc" } }),
  ]);
  // No `role` read here any more: every control on this page that used to be
  // admin-only (Reopen, Sync History) is password-gated instead, checked
  // server-side in the action rather than by hiding a button. 2026-08-02.

  // Numeric Job Id order like the sheet (979 before 1020 before 10000) — the
  // column is a string, so the DB's own sort is lexicographic.
  jobs.sort((a, b) => compareJobIds(a.jobId, b.jobId));

  // Rows the grid actually renders after the Billable filter. The FULL `jobs`
  // set still drives month status (started/locked/pending) and submission —
  // this filter is a display-only view, so it never changes what a Submit &
  // Lock would persist (which is why submitting is blocked while it's active).
  const visibleJobs = billableFilterActive
    ? jobs.filter((j) => {
        const effectiveBillable = j.billable && !isSdcCustomer(j.customer);
        return (effectiveBillable && showBillable) || (!effectiveBillable && showNonBillable);
      })
    : jobs;

  // KPI cards above the grid, built from `visibleJobs` — the same rows the grid
  // renders and the same rows its grand-total row sums, so the strip at the top
  // and the total at the bottom can never disagree. The punch detail behind the
  // drill is scoped to those jobs for the same reason. Cheap: the KPIs reuse the
  // etcEntries already loaded above, and the detail is one indexed query.
  const [monthKpis, monthHoursDetail] = await Promise.all([
    getEtcMonthKpis(month, visibleJobs),
    getEtcMonthHoursDetail(
      month,
      visibleJobs.map((j) => j.id),
    ),
  ]);

  // "Open in Scheduler" icon target + which of these jobs actually have a
  // Scheduler project (fail-soft empty set when its DB isn't configured).
  const { baseUrl: schedulerBaseUrl, jobNumbers: schedulerJobNumbers, ssoEmail: schedulerSsoEmail } = await getSchedulerLinkContext();

  // Standard Sheet columns, shown inline only once the password gate is
  // unlocked (same cookie the /standard-sheet tab uses). Numbers mirror that
  // page exactly for this month, scoped to the jobs this grid renders — the
  // % Total denominator is the grand Total ETC $ across those same rows.
  const showStandards = await isStandardSheetUnlocked();
  const standardWrongPassword = showStandards ? false : await hadWrongPassword();
  // Toolbar Save button's edit gate for the hour-based New ETC cells — see
  // etc-edit-gate.ts. Separate cookie/password from the Standard Sheet gate
  // above, even though both currently use the same "sdcautomation" phrase.
  const etcEditUnlocked = await isEtcEditUnlocked();
  const etcEditWrongPassword = etcEditUnlocked ? false : await hadEtcEditWrongPassword();
  // Rates are shared with /standard-sheet's own ExecutionRate rows — once
  // that tab has submitted+frozen this month's snapshot, rates must stop
  // changing here too (matches that tab's own editable/frozen rule).
  const standardSheetSubmitted = showStandards
    ? !!(await prisma.standardSheetSnapshot.findFirst({ where: { month }, select: { id: true } }))
    : false;

  // Fixed inputs only — Total ETC $/% Total/Standard Fees/Total Standard
  // Fees are all cross-linked (a rate edit shifts every job's % Total) and
  // computed live client-side by StandardRatesProvider/EtcStandardCells.
  const standardByJob = new Map<number, StandardJobBase>();
  // Per-category pool inputs the provider derives live poolTotals from.
  let poolRowsForProvider: PoolRowInput[] = [];
  let contingencyRate = 1.2;
  // Global execution rates applied to every job in this grid's Standard view —
  // set via the "ETC Rates" button, stored on the StandardSheetSetting row.
  let standardRates: StandardRates = { engrRate: 170, shopRate: 140, partsMarkup: 1.2 };
  let poolPanelRows: PoolPanelRow[] = [];
  // The jobs behind this month's "New Hours Added" — itemised under the pool
  // block, since the Projects page no longer carries a new-project view.
  let poolNewProjects: NewProjectRow[] = [];
  let poolsCarriedFrom: string | null = null;
  let poolsUpstreamNote: string | null = null;
  // Frozen snapshot rows for a submitted month — the grid renders these instead
  // of live math so a later rate/pool edit can't mutate a locked month.
  let frozenStandardRows: FrozenStandardRow[] | undefined;

  if (showStandards) {
    const [execEtcByJob, effective, setting, newProjects] = await Promise.all([
      getExecutionEtcByJob(jobs.map((j) => j.id), month),
      // Same carry-forward fallback the /standard-sheet tab uses, so the inline
      // Standard fees and the pool panel never silently collapse to $0 for a
      // month whose pools were never pulled.
      loadEffectivePools(month),
      prisma.standardSheetSetting.findUnique({ where: { id: 1 } }),
      // Always for THIS month, never the carried-from one: the list explains
      // which jobs started in the month you are looking at. When the pools are
      // a carry-forward estimate the panel already says so on its own banner.
      newProjectsEnteringMonth(month),
    ]);
    const pools = effective.pools;
    poolNewProjects = newProjects;
    poolsCarriedFrom = effective.carriedFrom;
    // The pools sync records WHY a month has no figures of its own (normally:
    // Power BI has not published the period yet). Read here so the panel can say
    // it, rather than telling people to click a Refresh that cannot help.
    const poolsFreshness = await prisma.powerBiFreshness.findUnique({
      where: { source: "standard_pools" },
      select: { status: true },
    });
    poolsUpstreamNote = poolsFreshness?.status?.startsWith("Waiting: ")
      ? poolsFreshness.status.slice("Waiting: ".length)
      : null;
    contingencyRate = setting ? Number(setting.contingencyRate) : 1.2;
    standardRates = {
      engrRate: setting ? Number(setting.engrRate) : 170,
      shopRate: setting ? Number(setting.shopRate) : 140,
      partsMarkup: setting ? Number(setting.partsMarkup) : 1.2,
    };
    poolRowsForProvider = POOL_PANEL_META.map(({ category }) => {
      const p = pools.find((x) => x.category === category);
      return {
        category,
        hoursAvailable: p ? Number(p.hoursAvailable) : 0,
        hoursPulled: p ? Number(p.hoursPulledThisMonth) : 0,
        rate: p ? Number(p.rate) : 0,
      };
    });

    poolPanelRows = POOL_PANEL_META.map(({ category, group, dept }) => {
      const p = pools.find((x) => x.category === category);
      return {
        category,
        group,
        dept,
        previousMonthPulledHours: p ? Number(p.previousMonthPulledHours) : 0,
        newHoursAddedThisMonth: p ? Number(p.newHoursAddedThisMonth) : 0,
        hoursAvailable: p ? Number(p.hoursAvailable) : 0,
        hoursWorkedThisMonth: p ? Number(p.hoursWorkedThisMonth) : 0,
        hoursPulledThisMonth: p ? Number(p.hoursPulledThisMonth) : 0,
        rate: p ? Number(p.rate) : 0,
        newEtcHours: p ? Number(p.newEtcHours) : 0,
        standardFee: p ? Number(p.standardFee) : 0,
        hasData: !!p,
      };
    });

    if (standardSheetSubmitted) {
      // Frozen month: render exactly the snapshot rows (contingency/notes and
      // every derived figure come from the freeze, immune to later edits).
      const snapshots = await prisma.standardSheetSnapshot.findMany({ where: { month } });
      frozenStandardRows = [];
      for (const s of snapshots) {
        standardByJob.set(s.jobId, {
          jobId: s.jobId,
          jobName: jobs.find((j) => j.id === s.jobId)?.jobName ?? "",
          etcEngineering: Number(s.etcEngineering),
          etcShop: Number(s.etcShop),
          etcParts: Number(s.etcParts),
          contingencyAmount: Number(s.contingencyAmount),
          notes: s.notes ?? "",
        });
        frozenStandardRows.push({
          jobId: s.jobId,
          totalEtcDollars: Number(s.totalEtcDollars),
          percentOfTotal: Number(s.percentOfTotal),
          standardFees: Number(s.standardFeeEngineering) + Number(s.standardFeeShop),
          totalStandardFees: Number(s.totalStandardFees),
        });
      }
    } else {
      for (const job of jobs) {
        // Same membership rule as the sheet's fee job list: non-billable /
        // flag-excluded jobs stay on the grid but get no Standard Fees row
        // and don't enter the % of total base.
        if (!isInStandardFeesAllocation(job)) continue;
        const etc = execEtcByJob.get(job.id) ?? { engineering: 0, shop: 0, parts: 0 };
        standardByJob.set(job.id, {
          jobId: job.id,
          jobName: job.jobName,
          etcEngineering: etc.engineering,
          etcShop: etc.shop,
          etcParts: etc.parts,
          contingencyAmount: job.executionRate ? Number(job.executionRate.contingencyAmount) : 0,
          notes: job.executionRate?.notes ?? "",
        });
      }
    }
  }

  const allEntries = jobs.flatMap((j) => j.etcEntries);
  const started = allEntries.length > 0;
  const locked = isMonthLocked(allEntries);
  const needsReviewCount = allEntries.filter((e) => e.needsReview).length;

  // A month's live actuals are only "complete" once the Paylocity hours are
  // refreshed through its final calendar day. Until then — for the current,
  // in-progress month — Money Spent, Parts Cost, and the auto-suggested New ETC
  // stay blank, so partial mid-month figures don't masquerade as final. Locked
  // (submitted) and historical months are always complete. This is display-only:
  // stored values and the submit path are untouched.
  const [completeYear, completeMonthNum] = month.split("-").map(Number);
  const monthEndDate = new Date(Date.UTC(completeYear, completeMonthNum, 0)); // last day of the month
  const hoursRefreshedThrough = hoursActualFreshness?.refreshedThrough ?? null;
  const monthComplete =
    locked || isHistoricalMonth || (hoursRefreshedThrough != null && hoursRefreshedThrough >= monthEndDate);

  // Grand totals footer, matching the real sheet's row 63 — accumulated as
  // each job row below computes its own values, then rendered once after.
  // `diff`/`decided` on every accumulator, for the same reason as the per-job
  // totals: a variance is only meaningful over cells a manager actually decided.
  const sectionGrandTotals = new Map(
    ETC_SECTIONS.map((s) => [s.code, { prior: 0, worked: 0, newEtc: 0, diff: 0, decided: 0 }]),
  );
  const groupGrandTotals = {
    Engineering: { prior: 0, worked: 0, newEtc: 0, diff: 0, decided: 0 },
    Shop: { prior: 0, worked: 0, newEtc: 0, diff: 0, decided: 0 },
  };
  const partsCostGrandTotal = { prior: 0, worked: 0, newEtc: 0 };

  return (
    <div className="w-full p-8">
      <PageTitle className="mb-1">Monthly ETC</PageTitle>
      <p className="mb-4 text-sm text-sdc-gray-600">
        {`${visibleJobs.length}${billableFilterActive ? ` of ${jobs.length}` : ""} ${monthIsLocked ? "job" : "active job"}${visibleJobs.length === 1 ? "" : "s"} — replaces the "Managers Fill Out" sheet.`}
      </p>

      {/* One toolbar: pick the month/year, Refresh Data pulls everything from
          Power BI for it, then enter/confirm and Submit and Lock. */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-sdc-gray-500">Report for:</span>
        <MonthYearSelect
          months={distinctMonths.map((m) => m.month)}
          current={month}
          lockedMonths={lockedMonthList}
          nextStartable={nextStartable}
        />
        <EtcViewMenu selectedGroups={visibleGroups} showJobName={showJobName} selectedBillables={selectedBillables} />
        {/* Sync menu merges the two upstream data-pull actions: Refresh Data
            (current month) and Sync History (past months, password-gated).
            Always rendered now — Sync History is no longer admin-only, so the
            menu always has at least one thing in it. */}
        <EtcSyncMenu>
          {!locked && (
            <form action={syncPowerBiForEtc.bind(null, month)}>
              <RunReportButton className={`${BUTTON_PRIMARY} w-full`}>Refresh Data (this month)</RunReportButton>
            </form>
          )}
          <SyncHistoryButton className={`${BUTTON_SECONDARY} w-full`} />
        </EtcSyncMenu>
        {/* Batch-saves every currently-typed New ETC override on the grid —
            typing alone doesn't persist anything (see EtcSectionCells).
            Password-gated the first time each session (a separate cookie/
            gate from the Standard Sheet one below, though both currently
            share the "sdcautomation" confirmation phrase with Submit and
            Lock); later Save clicks this session skip the prompt. */}
        {!locked && (
          <SaveEtcDraftsButton formId="etc-month-form" month={month} unlocked={etcEditUnlocked} wrongPassword={etcEditWrongPassword} className={BUTTON_PRIMARY} />
        )}
        {/* Autosaves New ETC cells ~1.5s after typing stops — but only once
            Save has been clicked with the password this session, so autosave
            can never be the thing that gets past the gate. */}
        <EtcAutosave formId="etc-month-form" month={month} unlocked={etcEditUnlocked} locked={locked} />
        {!locked && etcEditUnlocked && (
          <form action={lockEtcEdit}>
            <button type="submit" className={BUTTON_SECONDARY} title="Relock Save for this session.">
              Lock Editing
            </button>
          </form>
        )}
        {/* Submitting is only offered on the FULL grid: with a department
            column filter active, the hidden sections' hoursWorked inputs
            aren't in the form at all — on the current month submitMonth
            rejects the post ("Missing Hours Worked"), and on a reopened
            month it would lock in a sheet the manager only half-saw. */}
        {started && !locked && jobs.length > 0 &&
          (selectedGroups.size === DEPT_GROUPS.length && !billableFilterActive ? (
            <SubmitAndLockButton formId="etc-month-form" className={BUTTON_SECONDARY} />
          ) : (
            // Keep the control in place but disabled with a reason, instead of
            // replacing it with loose text (a control vanishing reads as a bug).
            <button
              type="button"
              disabled
              title="Clear the Columns and Billable filters first — a filtered view doesn't show every entry that Submit & Lock ETC would freeze."
              className={`${BUTTON_SECONDARY} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Submit & Lock ETC
            </button>
          ))}
        {/* Password-gated rather than admin-only (changed 2026-08-02): the
            person who needs to correct a closed month is the manager who
            filled it in, and requiring an ADMIN account for that just meant
            corrections didn't happen. Same confirmation phrase as Submit and
            Lock; the check itself is server-side in reopenMonth. */}
        {locked && <ReopenMonthButton action={reopenMonth.bind(null, month)} month={month} className={BUTTON_SECONDARY} />}
        {/* Sync History now lives inside the merged "Sync Data" menu above. */}
        {/* Password-gated Standard Sheet columns (Dan/Lisa only) — same
            unlock cookie as the /standard-sheet tab. */}
        {showStandards ? (
          <>
            <form action={lockStandardSheet}>
              <button type="submit" className={BUTTON_SECONDARY}>
                Hide Standards
              </button>
            </form>
            <EtcRatesButton
              engrRate={standardRates.engrRate}
              shopRate={standardRates.shopRate}
              partsMarkup={standardRates.partsMarkup}
              contingencyRate={contingencyRate}
              disabled={standardSheetSubmitted}
            />
          </>
        ) : standardsRevealRequested ? (
          <form action={unlockStandardSheet} className="flex items-center gap-2">
            <input
              type="password"
              name="password"
              placeholder="Password"
              aria-label="Standard Sheet password"
              className="w-32 rounded-md border border-sdc-border px-2 py-1.5 text-sm outline-none focus:border-sdc-blue"
            />
            <button type="submit" className={BUTTON_SECONDARY} title="Show the Standard Sheet columns for this month (requires password).">
              Show Standards
            </button>
            {standardWrongPassword && <span className="text-xs text-red-600">Wrong password</span>}
          </form>
        ) : null}
        <StatusBadge variant={!started ? "notStarted" : locked ? "locked" : "needsReview"}>
          {!started ? "Not started" : locked ? "Locked (submitted)" : `In progress — ${needsReviewCount} pending`}
        </StatusBadge>
        <span className="text-xs text-sdc-gray-400">
          {lastPowerBiSync?.syncedAt
            ? `Last synced: ${lastPowerBiSync.syncedAt.toISOString().slice(0, 16).replace("T", " ")}`
            : "Never synced"}
          {hoursActualFreshness?.refreshedThrough && (
            <> · Hours Refreshed Thru: {hoursActualFreshness.refreshedThrough.toISOString().slice(0, 10)}</>
          )}
          {/* Same figure as the report's Working Days card — weekday count
              for the selected work month. */}
          <> · {`Working Days: ${workingDaysInMonth(month)}`}</>
          {distinctMonths.length === 0 && <> · no ETC history yet</>}
        </span>
      </div>

      {/* A failing hours feed used to be invisible here: the "Hours Refreshed
          Thru" date above just stopped advancing while every number on the page
          quietly aged. Say so plainly instead — these are the hours managers
          submit a month against. */}
      {hoursActualFreshness?.status?.startsWith("Failed") && (
        <p className="mb-4 rounded-lg border border-sdc-red-border bg-sdc-red-bg px-3 py-2 text-xs text-sdc-red-text">
          <strong>Hours data may be stale.</strong> The last sync from Paylocity/SharePoint failed
          {hoursActualFreshness.checkedAt ? ` (${hoursActualFreshness.checkedAt.toISOString().slice(0, 16).replace("T", " ")})` : ""}
          , so Hours Worked below may not reflect recent time entries. {hoursActualFreshness.status.replace(/^Failed:\s*/, "")}
        </p>
      )}

      {/* The grid's OWN hours sync, reported separately. The feed above can be
          perfectly healthy while this step fails, and then every Hours Worked
          cell is stale behind a header that says the data is current — which is
          what happened through 2026-07-30. Only shown when the feed itself is
          fine, so a single outage does not stack two banners saying the same
          thing. */}
      {etcHoursFreshness?.status?.startsWith("Failed") && !hoursActualFreshness?.status?.startsWith("Failed") && (
        <p className="mb-4 rounded-lg border border-sdc-red-border bg-sdc-red-bg px-3 py-2 text-xs text-sdc-red-text">
          <strong>Hours Worked below may be out of date.</strong> The hours feed is healthy, but writing it into this
          month&apos;s ETC rows last failed
          {etcHoursFreshness.checkedAt ? ` (${etcHoursFreshness.checkedAt.toISOString().slice(0, 16).replace("T", " ")})` : ""}
          . {etcHoursFreshness.status.replace(/^Failed:\s*/, "")}
        </p>
      )}

      {/* Time booked without a valid job number. It cannot appear anywhere on
          this page — there is no job to put it against — so the shortfall is
          stated rather than left for someone to notice as a gap between these
          totals and payroll. */}
      {importIssues.length > 0 && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>
            {wholeNum(importIssues.reduce((s, i) => s + Number(i.hours), 0))} hours this month were booked without a
            valid job number
          </strong>{" "}
          and are not counted in any figure below:{" "}
          {importIssues
            .map((i) => `"${i.label}" — ${wholeNum(Number(i.hours))}h across ${i.rows} entries`)
            .join("; ")}
          . These need correcting in Paylocity before the month is submitted.
        </p>
      )}

      <p className="mb-4 text-xs text-sdc-gray-400">
        {!started
          ? `"Refresh Data" starts ${month}: it seeds the job rows and pulls the latest hours (Paylocity) and parts costs (TotalETO), just like the sheet.`
          : locked
            ? `${month} is submitted and locked — these numbers are frozen exactly as submitted. Pick a month above to view any past submission, or "Reopen for editing" to correct this one (the corrected New ETC carries forward into the next month's Prior ETC when you re-submit).`
            : `"Refresh Data" pulls the latest hours (Paylocity) and parts costs (TotalETO) for the selected month. Enter Hours Worked, confirm or override each New ETC (suggestion shown in yellow), then Submit & Lock ETC. That freezes the hours; the Standard Fees panel submits its Standard Sheet separately.`}
      </p>

      {/* KPI strip. Computed from the same rows the grid's grand-total row sums
          (see getEtcMonthKpis), so the cards and the bottom of the table can't
          disagree. "Detail" opens the punch-level drill: who booked what, on
          which date, against which job. */}
      {started && (
        <EtcMonthKpiCards
          month={month}
          kpis={monthKpis}
          detail={monthHoursDetail}
          // Same rows the amber banner below is built from, so the card and the
          // banner state one number rather than two that could drift.
          importIssues={importIssues.map((i) => ({ label: i.label, rows: i.rows, hours: Number(i.hours) }))}
        />
      )}

      {started && (
        /* key={month}: the month picker soft-navigates (router.push), which
           reconciles this subtree in place — rows are keyed by job/section, so
           without a remount every client cell (EtcSectionCells, the Standard
           rate inputs) keeps the PREVIOUS month's typed state and renders it
           under the new month's numbers. Remounting per month guarantees each
           month's grid seeds fresh from its own server data. */
        <StandardRatesProvider
          key={month}
          jobs={[...standardByJob.values()]}
          rates={standardRates}
          poolRows={poolRowsForProvider}
          contingencyRate={contingencyRate}
          frozenRows={frozenStandardRows}
          editable={showStandards && !standardSheetSubmitted}
        >
        <div className="flex items-start gap-3">
          {/* The ETC month form wraps ONLY the grid — the pool panel has its own
              Save/Refresh/Submit forms and must not be nested inside it. The
              provider wraps both so the panel's live pulled/rate edits flow into
              the grid's job Standard Fees. */}
          <form key={month} id="etc-month-form" action={submitMonth.bind(null, month)} className="min-w-0 flex-1">
          <DragScroll className="max-h-[calc(100vh-215px)] overflow-auto border border-sdc-border border-t-[#808080] bg-white shadow-sm select-none styled-scrollbar">
            <table className={`w-full text-sm ${TABLE_GRID} ${ZOOM_CONTROLS}`}>
              <thead className="sticky top-0 z-20 bg-sdc-gray-100">
                <tr className={TABLE_HEADER_ROW}>
                  <th rowSpan={5} className="sticky left-0 z-10 w-10 min-w-10 bg-sdc-gray-100 px-2 py-3 text-center align-bottom">
                    #
                  </th>
                  {/* When Job Name is hidden, the heavy grey divider before
                      the section blocks moves onto Job Id instead. */}
                  {/* text-left overrides TABLE_HEADER_ROW's text-center on the
                      <tr>, so these two headers line up with their now
                      left-aligned values. */}
                  <th rowSpan={5} className={`sticky left-10 z-10 w-20 min-w-20 bg-sdc-gray-100 px-3 py-3 text-left align-bottom ${showJobName ? "" : "border-r-8 border-[#808080]"}`}>
                    Job Id
                  </th>
                  {showJobName && (
                    <th
                      rowSpan={5}
                      style={{ width: "var(--etc-job-col-width, 260px)", minWidth: "var(--etc-job-col-width, 260px)" }}
                      className="sticky left-[7.5rem] z-10 border-r-8 border-[#808080] bg-sdc-gray-100 px-3 py-3 text-left align-bottom"
                    >
                      Job Name
                      <div
                        className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                        data-resize-var="--etc-job-col-width"
                        data-resize-min="150"
                        data-resize-max="600"
                        title="Drag to resize"
                        style={{ touchAction: "none" }}
                      />
                    </th>
                  )}
                  {headerRuns(visibleCols, (c) => c.phaseLabel, (c) => c.phaseLabel).map((p, i) => (
                    <th key={p.key + i} colSpan={p.count * SUB_COLUMNS.length} className={`${i === 0 ? "border-l border-sdc-border" : PHASE_EDGE} px-3 py-1.5 text-center`}>
                      {p.label}
                    </th>
                  ))}
                  <th colSpan={visibleGroups.length * TOTAL_SUB_COLUMNS.length} className={`${PHASE_EDGE} bg-sdc-yellow-bg px-3 py-1.5 text-center text-sdc-navy`}>
                    Total (New ETC)
                  </th>
                  <th colSpan={PARTS_COST_SUB_COLUMNS.length} className={`${PHASE_EDGE} bg-sdc-gray-100 px-3 py-1.5 text-center text-sdc-gray-700`}>
                    Parts Cost
                  </th>
                  {showStandards && (
                    <th
                      rowSpan={4}
                      colSpan={STANDARD_LEAF_COLUMNS.length}
                      className={`${STD_EDGE} bg-sdc-blue-light px-3 py-1.5 text-center align-middle text-sdc-blue-dark`}
                    >
                      Standard Sheet
                    </th>
                  )}
                </tr>
                {/* Billing-group row: Engineering / Shop per phase, like the sheet. */}
                <tr className={TABLE_HEADER_ROW}>
                  {(() => {
                    let colIdx = 0;
                    return headerRuns(visibleCols, (c) => `${c.phaseLabel}|${c.groupLabel}`, (c) => c.groupLabel).map((g, i) => {
                      const startCode = visibleCols[colIdx].code;
                      colIdx += g.count;
                      return (
                        <th key={g.key + i} colSpan={g.count * SUB_COLUMNS.length} className={`${edgeFor(startCode, i)} px-2 py-1 text-center font-medium`}>
                          {abbreviateLabel(g.label)}
                        </th>
                      );
                    });
                  })()}
                  {visibleGroups.map((group, i) => (
                    <th key={group} colSpan={TOTAL_SUB_COLUMNS.length} className={`${i === 0 ? PHASE_EDGE : "border-l border-sdc-border"} bg-sdc-yellow-bg px-2 py-1 text-center font-medium text-sdc-navy`}>
                      {abbreviateLabel(group)}
                    </th>
                  ))}
                  {/* Parts Cost has no Engineering/Shop split — one green Total
                      block spanning down to the column-label row, as printed. */}
                  <th rowSpan={3} colSpan={PARTS_COST_SUB_COLUMNS.length} className={`${PHASE_EDGE} bg-sdc-green px-2 py-1 text-center text-white`}>
                    Total
                  </th>
                </tr>
                {/* Sub-group row: ME / CE / General Engineering / dept abbreviations. */}
                <tr className={TABLE_HEADER_ROW}>
                  {(() => {
                    let colIdx = 0;
                    return headerRuns(
                      visibleCols,
                      (c) => `${c.phaseLabel}|${c.groupLabel}|${c.subgroupLabel}`,
                      (c) => c.subgroupLabel,
                    ).map((g, i) => {
                      const startCode = visibleCols[colIdx].code;
                      colIdx += g.count;
                      return (
                        <th
                          key={g.key + i}
                          title={SUBGROUP_FULL_NAME[g.label]}
                          colSpan={g.count * SUB_COLUMNS.length}
                          className={`${edgeFor(startCode, i)} px-2 py-1 text-center font-medium`}
                        >
                          {abbreviateLabel(g.label)}
                        </th>
                      );
                    });
                  })()}
                  {visibleGroups.map((group, i) => {
                    const label = group === "Engineering" ? "ME & CE & GE" : "MB & EB";
                    return (
                      <th
                        key={group}
                        title={SUBGROUP_FULL_NAME[label]}
                        colSpan={TOTAL_SUB_COLUMNS.length}
                        className={`${i === 0 ? PHASE_EDGE : "border-l border-sdc-border"} bg-sdc-yellow-bg px-2 py-1 text-center font-medium text-sdc-navy`}
                      >
                        {label}
                      </th>
                    );
                  })}
                </tr>
                {/* Colored section row, labels exactly as the sheet prints them. */}
                <tr className={TABLE_HEADER_ROW}>
                  {visibleCols.map((s, i) => {
                    const color = SECTION_HEADER_COLOR[s.code];
                    return (
                      <th
                        key={s.code}
                        title={`${s.name} (${s.code})`}
                        colSpan={SUB_COLUMNS.length}
                        className={`${edgeFor(s.code, i)} break-normal px-2 py-1 text-center ${color ?? ""}`}
                      >
                        {s.sectionDisplay}
                      </th>
                    );
                  })}
                  {visibleGroups.map((group, i) => (
                    <th
                      key={group}
                      colSpan={TOTAL_SUB_COLUMNS.length}
                      className={`${i === 0 ? PHASE_EDGE : "border-l border-sdc-border"} px-2 py-1 text-center text-sdc-navy ${group === "Engineering" ? "bg-sdc-blue-100" : "bg-sdc-yellow-bg"}`}
                    >
                      All
                    </th>
                  ))}
                </tr>
                <tr className={TABLE_HEADER_ROW}>
                  {visibleCols.map((s, i) =>
                    SUB_COLUMNS.map((col, ci) => (
                      <th
                        key={`${s.code}-${col}`}
                        className={`${ci === 0 ? edgeFor(s.code, i) : "border-l border-sdc-border"} ${ETC_COL_W} break-normal px-1 py-1.5 text-center text-[10px] ${
                          subColHeaderBg(col) || SECTION_HEADER_COLOR_LIGHT[s.code] || ""
                        }`}
                      >
                        {colHeaderLabel(col)}
                      </th>
                    ))
                  )}
                  {visibleGroups.map((group, gi) =>
                    TOTAL_SUB_COLUMNS.map((col, ci) => (
                      <th
                        key={`${group}-${col}`}
                        className={`${ci === 0 && gi === 0 ? PHASE_EDGE : "border-l border-sdc-border"} ${ETC_COL_W} break-normal px-1 py-1.5 text-center text-[10px] ${
                          subColHeaderBg(col) || "bg-sdc-yellow-bg text-sdc-navy"
                        }`}
                      >
                        {col}
                      </th>
                    ))
                  )}
                  {PARTS_COST_SUB_COLUMNS.map((col, i) => (
                    <th
                      key={`parts-cost-${col}`}
                      className={`${i === 0 ? PHASE_EDGE : "border-l border-sdc-border"} px-1 py-1.5 text-center text-[10px] ${
                        subColHeaderBg(col) || "bg-sdc-gray-100 text-sdc-gray-700"
                      }`}
                    >
                      {colHeaderLabel(col)}
                    </th>
                  ))}
                  {showStandards &&
                    STANDARD_LEAF_COLUMNS.map((col) => (
                      <th
                        key={`std-${col}`}
                        // Heavy divider before each Standard block; "% Total"
                        // stays thin as it shares the Total ETC block.
                        className={`${col === "% Total" ? "border-l border-sdc-border" : STD_EDGE} bg-sdc-blue-light/60 px-1 py-1.5 text-center text-[10px] text-sdc-blue-dark`}
                      >
                        {col}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job, jobIndex) => {
                  const entryByCode = new Map(job.etcEntries.map((e) => [e.section, e]));
                  const zebra = jobIndex % 2 === 1 ? "bg-sdc-gray-50/60" : "";
                  // Sticky columns need a fully opaque background — the translucent
                  // zebra tint above lets scrolled-under columns bleed through them.
                  const zebraSticky = jobIndex % 2 === 1 ? "bg-sdc-gray-50" : "bg-white";

                  // "Total (New ETC)" — a pure rollup, confirmed from the real sheet's
                  // formulas (SUM of the Engineering blocks' Prior/Worked/New ETC,
                  // separately for Shop) — not a manager-entered value.
                  //
                  // Diff is summed PER CELL and only over cells a manager has
                  // decided (see newEtcDiff), not derived from the group totals.
                  // Deriving it counted the suggestion standing in for every
                  // unfilled cell, and since that suggestion clamps at 0 while
                  // Hours Left can be negative, an overspent cell nobody had
                  // touched surfaced as an overrun. `decided` carries the count so
                  // the cell can say "no decisions yet" instead of "on plan".
                  const totals = {
                    Engineering: { prior: 0, worked: 0, newEtc: 0, diff: 0, decided: 0 },
                    Shop: { prior: 0, worked: 0, newEtc: 0, diff: 0, decided: 0 },
                  };
                  for (const s of ETC_SECTIONS) {
                    const entry = entryByCode.get(s.code);
                    if (!entry) continue;
                    const t = totals[s.billingGroup];
                    t.prior += Number(entry.priorEtc);
                    t.worked += Number(entry.hoursWorked);
                    t.newEtc += effectiveNewEtc(entry);
                    const d = newEtcDiff(entry);
                    if (d !== null) { t.diff += d; t.decided++; }
                  }

                  // No row-level hover:bg on the <tr> below — the hover wash is
                  // the `tbody tr:hover > td` rule in globals.css, which paints
                  // an inset shadow OVER each cell's own fill. A background on
                  // the <tr> paints BEHIND the cells, so it only ever showed on
                  // the handful of plain-white ones, tinting those twice while
                  // the coloured cells (Prior ETC, Diff, New ETC) got nothing.
                  return (
                    <tr key={job.id} className={zebra}>
                      <td className={`sticky left-0 z-10 w-10 min-w-10 overflow-hidden px-2 py-1 text-center align-middle text-[10px] leading-none whitespace-nowrap text-sdc-gray-400 ${zebraSticky}`}>{jobIndex + 1}</td>
                      {/* Job Id and Job Name both carry the right-click menu
                          (Job Hour Details / Project Schedule) — the same one the
                          Projects grid uses. It replaced the inline Scheduler
                          gantt icon that used to sit beside the job name. */}
                      <JobCellMenu
                        jobId={job.jobId}
                        jobName={job.jobName}
                        schedulerUrl={schedulerJobNumbers.has(job.jobId) ? schedulerScheduleUrl(schedulerBaseUrl, job.jobId, schedulerSsoEmail) : null}
                        title={`${job.jobId} — right-click for options`}
                        className={`sticky left-10 z-10 w-20 min-w-20 overflow-hidden px-3 py-1 text-left align-middle font-mono text-[10px] leading-none whitespace-nowrap text-sdc-gray-400 ${showJobName ? "" : "border-r-8 border-[#808080]"} ${zebraSticky}`}
                      >
                        {job.jobId}
                      </JobCellMenu>
                      {showJobName && (
                        <JobCellMenu
                          jobId={job.jobId}
                          jobName={job.jobName}
                          schedulerUrl={schedulerJobNumbers.has(job.jobId) ? schedulerScheduleUrl(schedulerBaseUrl, job.jobId, schedulerSsoEmail) : null}
                          style={{ width: "var(--etc-job-col-width, 260px)", minWidth: "var(--etc-job-col-width, 260px)" }}
                          className={`sticky left-[7.5rem] z-10 overflow-hidden border-r-8 border-[#808080] px-3 py-1 text-left align-middle text-[10px] font-medium leading-none whitespace-nowrap text-sdc-navy ${zebraSticky}`}
                        >
                          {/* min-h keeps row heights identical to the Projects
                              grid now that no icon pads this cell (c51cd42).
                              justify-start so the truncated name starts at the
                              cell's left edge, matching text-left above. */}
                          <div className="flex min-h-[14px] min-w-0 items-center justify-start gap-1.5">
                            <span className="min-w-0 truncate">{job.jobName}</span>
                          </div>
                        </JobCellMenu>
                      )}
                      {visibleCols.map((s, sIdx) => {
                        const edge = edgeFor(s.code, sIdx);
                        const entry = entryByCode.get(s.code);
                        if (!entry) {
                          return SUB_COLUMNS.map((col, ci) => (
                            <td
                              key={`${s.code}-${col}`}
                              className={`${ci === 0 ? edge : "border-l border-sdc-border"} ${ETC_COL_W} overflow-hidden px-2 py-1 text-center align-middle whitespace-nowrap ${
                                col === "Prior ETC" ? "bg-[#5E91D3] text-sdc-gray-700" : `${subColBodyBg(col)} text-sdc-gray-400`
                              }`}
                            >
                              —
                            </td>
                          ));
                        }
                        const prior = Number(entry.priorEtc);
                        const worked = Number(entry.hoursWorked);
                        const draft = entry.newEtcDraft != null ? Number(entry.newEtcDraft) : null;
                        const effective = effectiveNewEtc(entry);

                        const sectionTotal = sectionGrandTotals.get(s.code)!;
                        sectionTotal.prior += prior;
                        sectionTotal.worked += worked;
                        sectionTotal.newEtc += effective;
                        const sd = newEtcDiff(entry);
                        if (sd !== null) { sectionTotal.diff += sd; sectionTotal.decided++; }

                        return (
                          <Fragment key={s.code}>
                            <EtcSectionCells
                              entryId={entry.id}
                              edge={edge}
                              jobName={job.jobName}
                              sectionName={s.name}
                              priorEtc={prior}
                              initialWorked={round2(worked)}
                              initialDraft={draft}
                              initialConfirmed={isHistoricalMonth || entry.submittedAt != null ? round2(Number(entry.newEtc)) : null}
                              locked={locked}
                              monthComplete={monthComplete}
                            />
                          </Fragment>
                        );
                      })}
                      {visibleGroups.map((group, gi) => {
                        const hoursLeft = totals[group].prior - totals[group].worked;
                        const diff = totals[group].diff;
                        const anyDecided = totals[group].decided > 0;
                        groupGrandTotals[group].prior += totals[group].prior;
                        groupGrandTotals[group].worked += totals[group].worked;
                        groupGrandTotals[group].newEtc += totals[group].newEtc;
                        groupGrandTotals[group].diff += totals[group].diff;
                        groupGrandTotals[group].decided += totals[group].decided;
                        return (
                          <Fragment key={group}>
                            <td className={`${gi === 0 ? PHASE_EDGE : "border-l border-sdc-border"} ${ETC_COL_W} overflow-hidden bg-[#5E91D3] px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`} title={String(round2(totals[group].prior))}>
                              {wholeNum(totals[group].prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_WORKED_BG} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-500`} title={String(round2(totals[group].worked))}>
                              {wholeNum(totals[group].worked)}
                            </td>
                            <td
                              className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_LEFT_BG} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-500`}
                              title={`${round2(hoursLeft)} = Prior ETC (${round2(totals[group].prior)}) − Hours Worked (${round2(totals[group].worked)})`}
                            >
                              {wholeNum(hoursLeft)}
                            </td>
                            <td className={`border-l border-sdc-border ${ETC_COL_W} ${newEtcBg(true)} overflow-hidden px-1 py-1 text-center align-middle text-[10px] font-bold whitespace-nowrap text-sdc-navy`} title={String(round2(totals[group].newEtc))}>
                              {monthComplete ? wholeNum(totals[group].newEtc) : "—"}
                            </td>
                            <td
                              className={`border-l border-sdc-border ${ETC_COL_W} ${anyDecided ? diffBg(diff) : "bg-white"} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
                              title={
                                anyDecided
                                  ? `${round2(diff)} = the sum of (Hours Left − New ETC) over the ${totals[group].decided} ${
                                      group === "Engineering" ? "Engineering" : "Shop"
                                    } cell${totals[group].decided === 1 ? "" : "s"} a manager has confirmed`
                                  : "No New ETC confirmed for this job yet — nothing to compare against Hours Left"
                              }
                            >
                              {/* "—" not 0: with nothing decided there is no variance,
                                  and printing 0 would read as "on plan". */}
                              {anyDecided ? wholeNum(diff) : "—"}
                            </td>
                          </Fragment>
                        );
                      })}
                      {(() => {
                        const partsCostEntry = entryByCode.get(PARTS_COST_SECTION);
                        if (!partsCostEntry) {
                          return PARTS_COST_SUB_COLUMNS.map((col, ci) => (
                            <td
                              key={`parts-cost-${col}`}
                              className={`${ci === 0 ? PHASE_EDGE : "border-l border-sdc-border"} overflow-hidden px-2 py-1 text-center align-middle whitespace-nowrap text-sdc-gray-400 ${
                                col === "Prior ETC" ? "bg-[#5E91D3] text-sdc-gray-700" : subColBodyBg(col) || "bg-sdc-gray-50"
                              }`}
                            >
                              —
                            </td>
                          ));
                        }
                        const prior = Number(partsCostEntry.priorEtc);
                        const spent = Number(partsCostEntry.hoursWorked);
                        const moneyLeft = calcHoursLeft(prior, spent);
                        const suggestedCost = suggestNewEtc(prior, spent);
                        const draftCost = partsCostEntry.newEtcDraft != null ? Number(partsCostEntry.newEtcDraft) : null;
                        const effectiveNewEtcCost = effectiveNewEtc(partsCostEntry);
                        const diffCost = moneyLeft - effectiveNewEtcCost;
                        // Parallels the per-section-hours rule (see EtcSectionCells):
                        // Parts Cost New ETC needs manager attention (yellow) only
                        // when money was actually spent this month (spent > 0) and no
                        // value has been decided yet. $0-spent, drafted, or already
                        // submitted/historical cells stay neutral.
                        const decidedCost =
                          spent === 0 || draftCost != null || isHistoricalMonth || partsCostEntry.submittedAt != null;

                        partsCostGrandTotal.prior += prior;
                        partsCostGrandTotal.worked += spent;
                        partsCostGrandTotal.newEtc += effectiveNewEtcCost;

                        return (
                          <Fragment key="parts-cost">
                            <td className={`${PHASE_EDGE} overflow-hidden bg-[#5E91D3] px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`} title={currencyExact(prior)}>
                              {currency(prior)}
                            </td>
                            <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} overflow-hidden px-1 py-1 text-center align-middle whitespace-nowrap`}>
                              {/* Not manager-editable — always Power BI's actual, passed through as a
                                  hidden field so submitMonth's generic per-entry loop still works. */}
                              <input type="hidden" name={`hoursWorked__${partsCostEntry.id}`} value={spent} />
                              <span className="block w-16 truncate text-center text-[10px] text-sdc-gray-600" title={currencyExact(spent)}>
                                {currency(spent)}
                              </span>
                            </td>
                            <td
                              className={`border-l border-sdc-border ${HOURS_LEFT_BG} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-500`}
                              title={`${currencyExact(moneyLeft)} = Prior ETC (${currencyExact(prior)}) − Money Spent (${currencyExact(spent)})`}
                            >
                              {currency(moneyLeft)}
                            </td>
                            <PartsCostNewEtcCell
                              name={`newEtcOverride__${partsCostEntry.id}`}
                              jobName={job.jobName}
                              initialValue={
                                draftCost != null
                                  ? String(draftCost)
                                  : // Reopened month: seed with the confirmed value so a
                                    // no-changes resubmit can't replace it with the suggestion.
                                    isHistoricalMonth || partsCostEntry.submittedAt != null
                                    ? String(round2(Number(partsCostEntry.newEtc)))
                                    : // Don't auto-fill until the month's actuals are complete.
                                      monthComplete && spent === 0
                                      ? String(round2(suggestedCost))
                                      : ""
                              }
                              // Deliberately NOT `!decidedCost`: that counts a
                              // saved draft as decided forever, so clearing a
                              // drafted cell would leave it neutral. The cell
                              // judges presence from its own value.
                              attentionWhenBlank={spent !== 0 && !isHistoricalMonth && partsCostEntry.submittedAt == null}
                              // NO placeholder hint, matching the per-section
                              // hours cells (see EtcSectionCells). It used to
                              // show the suggestion — and the placeholder is
                              // styled bold in the same grey as a real value, so
                              // a cell nobody had touched was indistinguishable
                              // from a decided one. Every Parts Cost row with
                              // money spent this month looked filled in when in
                              // fact none of them were. Money spent means the
                              // new figure is a manager's judgment call, so the
                              // cell now reads as genuinely blank until one is
                              // typed; the suggestion stays on the tooltip.
                              hint={
                                spent === 0 || draftCost != null
                                  ? undefined
                                  : `Nothing decided yet. Money Left is ${currencyExact(moneyLeft)} — carrying that forward would give ${currencyExact(suggestedCost)}.`
                              }
                              locked={locked}
                            />
                            <td
                              className={`border-l border-sdc-border ${decidedCost ? diffBg(diffCost) : ""} overflow-hidden px-1 py-1 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
                              title={
                                decidedCost
                                  ? `${currencyExact(diffCost)} = Money Left (${currencyExact(moneyLeft)}) − New ETC (${currencyExact(effectiveNewEtcCost)})`
                                  : "No New ETC decided yet, so there is no variance to report."
                              }
                            >
                              {/* "—" not $0, the same rule the section-hours DIFF
                                  follows: with nothing decided there is no
                                  variance, and printing $0 reads as "on plan". */}
                              {decidedCost ? currency(diffCost) : "—"}
                            </td>
                          </Fragment>
                        );
                      })()}
                      {showStandards &&
                        (() => {
                          const std = standardByJob.get(job.id);
                          if (!std) return null;
                          return (
                            <Fragment key="standards">
                              <EtcStandardCells job={std} />
                            </Fragment>
                          );
                        })()}
                    </tr>
                  );
                })}
                {visibleJobs.length === 0 && (
                  <tr>
                    <td
                      colSpan={
                        3 +
                        (visibleCols.length + visibleGroups.length) * SUB_COLUMNS.length +
                        PARTS_COST_SUB_COLUMNS.length +
                        (showStandards ? STANDARD_LEAF_COLUMNS.length : 0)
                      }
                      className="px-4 py-5 text-center text-sdc-gray-400"
                    >
                      {jobs.length === 0 ? "No active jobs found." : "No jobs match the Billable filter."}
                    </td>
                  </tr>
                )}
              </tbody>
              {/* tfoot, not the last row of tbody: it's what takes the totals out
                  of the row-height variable's reach (see ZOOM_CONTROLS), and it
                  lets the row pin to the bottom of the scroller so the grand
                  totals stay on screen while scrolling a 59-job month. */}
              <tfoot className="sticky bottom-0 z-20">
                {visibleJobs.length > 0 && (
                  <tr className="border-t-2 border-sdc-navy bg-sdc-gray-100 font-medium">
                    {/* Mirror the body's THREE separate frozen cells (same widths
                        + sticky offsets) rather than one colSpan cell, so the
                        section totals after them line up exactly with the rows. */}
                    <td className="sticky left-0 z-10 w-10 min-w-10 overflow-hidden bg-sdc-gray-100 px-2 py-2.5 text-center align-middle whitespace-nowrap" />
                    <td className={`sticky left-10 z-10 w-20 min-w-20 overflow-hidden bg-sdc-gray-100 px-3 py-2.5 text-right align-middle font-bold whitespace-nowrap text-sdc-navy ${showJobName ? "" : "border-r-8 border-[#808080]"}`}>
                      {showJobName ? "" : "Total"}
                    </td>
                    {showJobName && (
                      <td
                        style={{ width: "var(--etc-job-col-width, 260px)", minWidth: "var(--etc-job-col-width, 260px)" }}
                        className="sticky left-[7.5rem] z-10 overflow-hidden border-r-8 border-[#808080] bg-sdc-gray-100 px-3 py-2.5 text-right align-middle font-bold whitespace-nowrap text-sdc-navy"
                      >
                        Total
                      </td>
                    )}
                    {visibleCols.map((s, sIdx) => {
                      const t = sectionGrandTotals.get(s.code)!;
                      const hoursLeft = t.prior - t.worked;
                      const diff = t.diff;
                      const anyDecided = t.decided > 0;
                      return (
                        <Fragment key={s.code}>
                          <td className={`${edgeFor(s.code, sIdx)} ${ETC_COL_W} overflow-hidden bg-[#5E91D3] px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`} title={String(round2(t.prior))}>{wholeNum(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_WORKED_BG} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-navy`} title={String(round2(t.worked))}>{wholeNum(t.worked)}</td>
                          <td
                            className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_LEFT_BG} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-navy`}
                            title={`${round2(hoursLeft)} = Prior ETC (${round2(t.prior)}) − Hours Worked (${round2(t.worked)})`}
                          >
                            {wholeNum(hoursLeft)}
                          </td>
                          <td className={`border-l border-sdc-border ${ETC_COL_W} ${newEtcBg(true)} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] font-bold whitespace-nowrap text-sdc-navy`} title={String(round2(t.newEtc))}>{monthComplete ? wholeNum(t.newEtc) : "—"}</td>
                          <td
                            className={`border-l border-sdc-border ${ETC_COL_W} ${anyDecided ? diffBg(diff) : "bg-white"} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
                            title={
                              anyDecided
                                ? `${round2(diff)} = the sum of (Hours Left − New ETC) over the ${t.decided} confirmed cell${t.decided === 1 ? "" : "s"}`
                                : "Nothing confirmed in this column yet — no variance to report"
                            }
                          >
                            {anyDecided ? wholeNum(diff) : "—"}
                          </td>
                        </Fragment>
                      );
                    })}
                    {visibleGroups.map((group, gi) => {
                      const t = groupGrandTotals[group];
                      const hoursLeft = t.prior - t.worked;
                      const diff = t.diff;
                      const anyDecided = t.decided > 0;
                      return (
                        <Fragment key={group}>
                          <td className={`${gi === 0 ? PHASE_EDGE : "border-l border-sdc-border"} ${ETC_COL_W} overflow-hidden bg-[#5E91D3] px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`} title={String(round2(t.prior))}>{wholeNum(t.prior)}</td>
                          <td className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_WORKED_BG} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-blue-dark`} title={String(round2(t.worked))}>{wholeNum(t.worked)}</td>
                          <td
                            className={`border-l border-sdc-border ${ETC_COL_W} ${HOURS_LEFT_BG} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-blue-dark`}
                            title={`${round2(hoursLeft)} = Prior ETC (${round2(t.prior)}) − Hours Worked (${round2(t.worked)})`}
                          >
                            {wholeNum(hoursLeft)}
                          </td>
                          <td className={`border-l border-sdc-border ${ETC_COL_W} ${newEtcBg(true)} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] font-bold whitespace-nowrap text-sdc-blue-dark`} title={String(round2(t.newEtc))}>{monthComplete ? wholeNum(t.newEtc) : "—"}</td>
                          <td
                            className={`border-l border-sdc-border ${ETC_COL_W} ${anyDecided ? diffBg(diff) : "bg-white"} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
                            title={
                              anyDecided
                                ? `${round2(diff)} = the sum of (Hours Left − New ETC) over the ${t.decided} confirmed cell${t.decided === 1 ? "" : "s"}`
                                : "Nothing confirmed in this column yet — no variance to report"
                            }
                          >
                            {anyDecided ? wholeNum(diff) : "—"}
                          </td>
                        </Fragment>
                      );
                    })}
                    {(() => {
                      const t = partsCostGrandTotal;
                      const moneyLeft = t.prior - t.worked;
                      const diffCost = moneyLeft - t.newEtc;
                      return (
                        <Fragment key="parts-cost-total">
                          <td className={`${PHASE_EDGE} overflow-hidden bg-[#5E91D3] px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`} title={currencyExact(t.prior)}>{currency(t.prior)}</td>
                          {/* Total Money Spent is ALWAYS the live month-to-date
                              total, even while per-job cells are blanked pending
                              month completion. */}
                          <td className={`border-l border-sdc-border ${HOURS_WORKED_BG} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-navy`} title={`${currencyExact(t.worked)} — live month-to-date total`}>{currency(t.worked)}</td>
                          <td
                            className={`border-l border-sdc-border ${HOURS_LEFT_BG} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-navy`}
                            title={`${currencyExact(moneyLeft)} = Prior ETC (${currencyExact(t.prior)}) − Money Spent (${currencyExact(t.worked)})`}
                          >
                            {currency(moneyLeft)}
                          </td>
                          <td className={`border-l border-sdc-border ${newEtcBg(true)} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] font-bold whitespace-nowrap text-sdc-navy`} title={currencyExact(t.newEtc)}>{monthComplete ? currency(t.newEtc) : "—"}</td>
                          <td
                            className={`border-l border-sdc-border ${diffBg(diffCost)} overflow-hidden px-1 py-2.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-700`}
                            title={`${currencyExact(diffCost)} = Money Left (${currencyExact(moneyLeft)}) − New ETC (${currencyExact(t.newEtc)})`}
                          >
                            {currency(diffCost)}
                          </td>
                        </Fragment>
                      );
                    })()}
                    {showStandards && (
                      <Fragment key="standards-total">
                        <StandardGrandCells />
                      </Fragment>
                    )}
                  </tr>
                )}
              </tfoot>
            </table>
          </DragScroll>
          </form>
          {showStandards && (
            <StandardPoolPanel
              month={month}
              carriedFrom={poolsCarriedFrom}
              upstreamNote={poolsUpstreamNote}
              rows={poolPanelRows}
              newProjects={poolNewProjects}
              isSubmitted={standardSheetSubmitted}
              poolsEditable={!standardSheetSubmitted && !poolsCarriedFrom}
              savePoolsAction={savePools.bind(null, month)}
              refreshPoolsAction={refreshPools.bind(null, month)}
              submitMonthAction={submitStandardSheetMonth.bind(null, month)}
              reopenMonthAction={reopenStandardSheetMonth.bind(null, month)}
            />
          )}
        </div>
        </StandardRatesProvider>
      )}
    </div>
  );
}
