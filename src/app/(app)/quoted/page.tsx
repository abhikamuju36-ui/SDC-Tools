import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { validJobTypeFilter, VALID_JOB_TYPES, JOB_STATUSES, DEFAULT_VISIBLE_STATUSES, compareJobIds, isSdcCustomer } from "@/lib/job-filters";
import { SECTIONS, PHASE_GROUPS } from "@/lib/sections";
import { abbreviateLabel } from "@/lib/abbrev";
import { DragScroll } from "@/components/DragScroll";
import { PageTitle } from "@/components/ui/Typography";
import { TABLE_HEADER_ROW, TABLE_GRID, BUTTON_PRIMARY } from "@/components/ui/classnames";
import { ProjectViewsMenu } from "@/components/ProjectViewsMenu";
import { listSharedViews } from "@/lib/saved-views-actions";
import { ProjectsFilterMenu } from "@/components/ProjectsFilterMenu";
import { ProjectsSectionsMenu } from "@/components/ProjectsSectionsMenu";
import { ProjectsDisplayMenu } from "@/components/ProjectsDisplayMenu";
import { ProjectsShowAllSwitch } from "@/components/ProjectsShowAllSwitch";
import { SortButton } from "@/components/SortButton";
import { AddProjectButton } from "@/components/AddProjectButton";
import { NewProjectRows } from "@/components/NewProjectRows";
import { DateCell } from "@/components/DateCell";
import { MoneyCell } from "@/components/MoneyCell";
import { SaveQuotedHoursButton } from "@/components/SaveQuotedHoursButton";
import { JobCellMenu } from "@/components/JobCellMenu";
import { getSchedulerLinkContext, schedulerScheduleUrl } from "@/lib/scheduler-link";
import { saveQuotedHours } from "@/lib/quoted-actions";
import { QuotedSaveForm } from "@/components/QuotedSaveForm";
import { decodeParamList, isActualsOn } from "@/lib/quoted-display-prefs";
import { loadActualHoursBySection } from "@/lib/actual-hours";
import {
  ProjectsEditModeProvider,
  ProjectsEditModeToggle,
  ProjectsEditFieldset,
  WhenEditing,
} from "@/components/ProjectsEditMode";
import { getProjectsEditState } from "@/lib/projects-edit-mode";

// Header banding, matching the real "Estimated Hours" tab's column colors
// exactly (extracted from its theme + explicit fills) — phase row, then a
// department-band row (Function Group), then the section name.
// Re-themed to the SDC brand palette (see brand color sheet): phase banners
// use the bold brand *core* colors, group sub-bands below use lighter brand
// *tints* so the two-tier header hierarchy reads at a glance. Each value
// carries its own text color so it can win over the base cell class reliably.
const PHASE_HEADER_COLOR: Record<string, string> = {
  "Complete Design & Build": "bg-sdc-navy text-white", // #061D39 — anchor phase
  "Machine Testing": "bg-sdc-blue text-white", // #1574C4 — primary brand
  "Teardown & Install": "bg-sdc-green text-white", // #74C415
  Warranty: "bg-sdc-yellow text-sdc-navy", // #FFDE51 (dark text for contrast)
};
// Row height / column width density controls (GridZoomControls, in the
// toolbar) work by setting --quoted-row-py/--quoted-col-px on the document
// root. Row height applies to every body cell uniformly (they're already a
// consistent py-1.5 today, so nothing changes until a user clicks +/-).
// Column width only targets cells marked with the "qc" ("quoted column")
// class below — the repeated per-section header/data columns, which are
// already a consistent px-1 — deliberately excluding the sticky #/Job Id/Job/
// Cost columns (own fixed widths) and the optional metadata columns
// (Customer/Type/Status/Dates, px-2) and phase/group banner headers, whose
// padding isn't a "column width" in the same sense.
const ZOOM_CONTROLS = "[&_td]:py-[var(--quoted-row-py,6px)] [&_.qc]:px-[var(--quoted-col-px,4px)]";

// Every repeated data column — the per-section quoted/actual cells and the two
// grand-total columns — renders at ONE uniform width, so the grid reads as an
// even matrix instead of the ragged one auto-layout produced. The old
// `w-[40px] min-w-[40px]` only set a floor, so each column still stretched to
// its own content and no two matched; these three properties together pin it.
//
// The width is `content + padding`, not a flat number, because the Grid Size
// control drives this column's horizontal padding (--quoted-col-px) anywhere
// from 0 to 16px per side. A flat width would hand the same box to a 4px and a
// 16px padding and let the larger one crush the text — and, since the width is
// pinned with max-width, the column could no longer grow to absorb it the way
// the old min-width-only rule did. Folding the padding into the width instead
// keeps the CONTENT box constant at 4.7rem at every density, so raising Grid
// Size genuinely widens the column (what it says it does) rather than
// squeezing the words inside it.
//
// 4.7rem is measured against the real font, which matters more than it sounds:
// the app renders in Montserrat, where the longest header word "SOFTWARE" is
// 69.2px at the grid's 0.68rem text — 23% wider than the same string in the
// -apple-system/Segoe fallback (56.3px). Measuring in the fallback is exactly
// how this column got sized too narrow the first time, so if these names ever
// change, re-measure in Montserrat.
//
// Deliberately rem, not px: table text is 0.68rem and scales with the sidebar
// "Text size" control, so a px width would start breaking words again the
// moment anyone raised it — the same rem-vs-px trap the frozen columns hit.
// max(4.7rem, 72px), not a bare 4.7rem: the column scales with the sidebar's Text
// size control (root 12–20px) while the header LABEL is a fixed 10px, so the two
// shrink at different rates. At Text size 12 the column offered 56.4px of content
// while "SOFTWARE" needs 63.7px (measured in Montserrat in the running app) — the
// word no longer breaks, so it would simply be clipped. The px floor is that
// longest word plus room to breathe; above ~14px root the rem value wins and
// nothing changes.
const DATA_COL = "calc(max(4.7rem, 72px) + 2 * var(--quoted-col-px, 4px))";
const DATA_COL_STYLE = { width: DATA_COL, minWidth: DATA_COL, maxWidth: DATA_COL } as const;

// The two money columns (Cost Quoted / Cost Actual). Right-aligned, unlike the
// rest of the grid: these are the only figures here with a variable digit count,
// and a right edge is what lets "$8,600" and "$1,406,923" be compared at a
// glance. tabular-nums keeps the digits in columns while editing.
const EMPTY_ACTUALS: ReadonlyMap<string, number> = new Map();

const MONEY_INPUT = "w-full min-w-0 border-none bg-transparent text-right tabular-nums outline-none";

// Group sub-bands: lighter SDC brand tints, each distinct, all drawn from the
// brand palette (blue/green/yellow tints + light blue), with one bold brand
// blue for the large General Engineering block so it reads as its own zone.
const GROUP_HEADER_COLOR: Record<string, string> = {
  PM: "bg-sdc-gray-100 text-sdc-navy", // neutral brand gray
  ME: "bg-sdc-blue-light text-sdc-navy", // #e6f0fa
  CE: "bg-sdc-green-bg text-sdc-navy", // #eef7de
  "General Engineering": "bg-sdc-blue text-white", // #1574C4
  Shop: "bg-sdc-yellow-bg text-sdc-navy", // #fff6d6
  Engineering: "bg-sdc-blue-100 text-sdc-navy", // #aacee8
};
// Full names for the department abbreviations above — only defined where the
// header actually abbreviates something ("General Engineering"/"Shop"/
// "Engineering" are already spelled out).
const GROUP_FULL_NAME: Record<string, string> = {
  PM: "Project Management",
  ME: "Mechanical Engineering",
  CE: "Controls Engineering",
};

// Consecutive runs of the same group within a phase's visible sections, for
// the group-band row's colSpans (mirrors PHASE_GROUPS but re-derived per
// request since visibility is filtered live via the `cols` param).
function groupRuns(sections: { code: string; group: string }[]) {
  const runs: { group: string; count: number }[] = [];
  for (const s of sections) {
    const last = runs[runs.length - 1];
    if (last && last.group === s.group) last.count += 1;
    else runs.push({ group: s.group, count: 1 });
  }
  return runs;
}

// Schedule state, called out on the two identity columns (Job Id and Job Name)
// so a scan down the frozen columns shows which projects need a date fixed and
// which are simply still running:
//
//   RED   — no Start Date at all. The date columns can be scrolled off or hidden
//           entirely (Sections ▾), so a missing start would otherwise be
//           invisible on most people's view of this grid.
//   GREEN — started and not finished: work in flight, which is the normal state
//           for most rows here and is NOT a problem to fix.
//
// A missing start wins over a missing end, because it's the one that needs
// action.
//
// Only RED is bolded. Green covers 36 of the 50 rows on the default view (and no
// job in the database currently has both dates), so bolding it too made bold the
// norm and cost it all its meaning — weight now marks the rows that need fixing,
// and colour alone says "running". Both states also carry a title, because colour
// carries no meaning at all for a colour-blind reader.
//
// Weight and colour are returned separately rather than as one class string:
// combining `font-bold` with the Job Id column's own `font-semibold` would leave
// two competing utilities whose winner depends on stylesheet order, not on intent.
function scheduleTone(job: { startDate: Date | null; completeDate: Date | null; status: string | null }): {
  weight: string;
  color: string;
  title?: string;
} {
  // A HeadStart job has no PO yet, so having no Start Date is the normal state
  // for it — flagging that red would be crying wolf on the one status where the
  // gap is expected.
  if (job.status === "HeadStart") {
    return { weight: "", color: "", title: "HeadStart — intended, no PO yet" };
  }
  if (!job.startDate) {
    return { weight: "font-bold", color: "text-sdc-red-text", title: "No Start Date set for this project" };
  }
  if (!job.completeDate) {
    return { weight: "", color: "text-sdc-green-text", title: "In progress — started, with no Complete Date yet" };
  }
  return { weight: "", color: "" };
}

// <input type="date"> wants "" or "YYYY-MM-DD" — never "—" (formatDate's
// display placeholder), which the browser would reject as an invalid date.
function dateInputValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

// Hours display everywhere on this page is whole numbers — no decimals,
// rounded rather than truncated. Use this for any hours value added later too.
function wholeHours(n: unknown): string {
  if (n == null) return "—";
  return Math.round(Number(n)).toString();
}
// Un-rounded counterpart to wholeHours() above, for tooltips — in case a
// stored hours value ever carries a fraction.
function exactHours(n: unknown): string | undefined {
  if (n == null) return undefined;
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const SORT_KEYS = ["jobId", "status", "startDate", "completeDate"] as const;
type SortKey = (typeof SORT_KEYS)[number];

const BILLABLE_OPTIONS = ["Billable", "Non-Billable"];

// Info columns the "Columns" dropdown can show/hide. # and Job Id always
// show (row identity); phase section columns have their own phase pickers;
// the two Cost columns are the grid's whole point, so neither is toggleable.
const TOGGLE_COLUMNS = [
  { key: "job", label: "Job" },
  { key: "customer", label: "Customer" },
  { key: "type", label: "Type" },
  { key: "billable", label: "Billable" },
  { key: "status", label: "Status" },
  { key: "startDate", label: "Start Date" },
  { key: "completeDate", label: "Complete Date" },
] as const;

export default async function QuotedPage({
  searchParams,
}: {
  searchParams: Promise<{
    cols?: string;
    sort?: string;
    dir?: string;
    customers?: string;
    types?: string;
    statuses?: string;
    billables?: string;
    hide?: string;
    view?: string;
    actuals?: string;
  }>;
}) {
  const sp = await searchParams;
  const { cols, sort, dir, customers, types, statuses, billables, hide } = sp;
  // Actual hours in the cells. A view param rather than a client-side flag, so
  // the markup below is already right on arrival — see quoted-display-prefs.ts.
  const showActuals = isActualsOn({ get: (k) => sp[k as keyof typeof sp] ?? null });

  // Read-only unless the signed-in user has explicitly switched Edit Mode on
  // (projects-edit-mode.ts). The cookie's value only SEEDS the switch — from
  // there it's client state, so flipping it doesn't re-run this whole page. And
  // it only shapes the UI either way: every write re-checks the cookie
  // server-side in saveQuotedHours, since a form post doesn't care what the
  // markup said.
  const { editing: initialEditing, mayEdit } = await getProjectsEditState();
  // Saved/published grid views ("Views ▾") — loaded for everyone; the team
  // default + shared list come from the DB, personal views live in the browser.
  const { default: teamDefault, shared: sharedViews } = await listSharedViews();
  // Column show/hide — `hide` is a comma-separated list of hidden column
  // keys (absent = all shown). Drives the "Columns" dropdown.
  const hiddenCols = new Set(decodeParamList(hide ?? null));
  const show = (key: string) => !hiddenCols.has(key);
  // No `cols` param at all (first visit) defaults to every section EXCEPT the
  // ones below; an explicit (possibly empty) `cols` value means the user has
  // picked some via the phase pickers (which still list all sections).
  // Hidden by default: 10-111 (PM), 10-413 (Manufacturing), and the two
  // Warranty codes (70-211/70-411). A manager can re-enable any of them.
  const DEFAULT_HIDDEN_CODES = new Set(["10-111", "10-413", "70-211", "70-411"]);
  const visibleCodes =
    cols === undefined
      ? SECTIONS.filter((s) => !DEFAULT_HIDDEN_CODES.has(s.code)).map((s) => s.code)
      : decodeParamList(cols);
  const visibleSet = new Set(visibleCodes);

  const sortKey: SortKey = SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : "jobId";
  const sortDir = dir === "desc" ? "desc" : "asc";

  // Real job types are a fixed, known set (job-filters.ts) — no query needed.
  // Customers are open-ended, so pull the distinct list actually in use.
  const allTypes: string[] = [...VALID_JOB_TYPES];
  const distinctCustomers = await prisma.job.findMany({
    where: validJobTypeFilter,
    distinct: ["customer"],
    select: { customer: true },
  });
  const allCustomers = distinctCustomers
    .map((j) => j.customer)
    .filter((c): c is string => Boolean(c))
    .sort((a, b) => a.localeCompare(b));

  const distinctStatuses = await prisma.job.findMany({
    where: validJobTypeFilter,
    distinct: ["status"],
    select: { status: true },
  });
  // The canonical lifecycle first, then any legacy value still stored on a job so
  // nothing already in the data becomes unselectable. Ordered by JOB_STATUSES
  // rather than alphabetically — Active, HeadStart, Complete is the order the work
  // actually moves through, and it reads as a lifecycle instead of a word list.
  const storedStatuses = distinctStatuses.map((j) => j.status).filter((s): s is string => Boolean(s));
  const allStatuses = [
    ...JOB_STATUSES,
    ...storedStatuses.filter((s) => !JOB_STATUSES.includes(s as (typeof JOB_STATUSES)[number])).sort((a, b) => a.localeCompare(b)),
  ];

  // Same "undefined = everything, explicit (even empty) = user's picks" rule as `cols`.
  // decodeParamList, not split(",") — the writers escape commas inside each value
  // because customer names contain them; splitting raw would shred those names.
  const selectedTypes = types === undefined ? allTypes : decodeParamList(types);
  const selectedCustomers = customers === undefined ? allCustomers : decodeParamList(customers);
  // Default view (no explicit filter yet): only Active jobs and only Billable
  // work — the day-to-day view. The filter chips still list every option, so a
  // user can widen to Complete/Non-Billable any time.
  const selectedStatuses =
    statuses === undefined
      ? DEFAULT_VISIBLE_STATUSES.filter((s) => allStatuses.includes(s))
      : decodeParamList(statuses);
  const selectedBillables = billables === undefined ? ["Billable"] : decodeParamList(billables);
  const showBillable = selectedBillables.includes("Billable");
  const showNonBillable = selectedBillables.includes("Non-Billable");
  // Boolean columns have no Prisma `in` filter — translate the two checkboxes
  // into an equals/no-match condition instead (both checked = no filter at all).
  const billableWhere =
    showBillable && showNonBillable
      ? {}
      : showBillable
        ? { billable: true }
        : showNonBillable
          ? { billable: false }
          : { id: -1 }; // neither checked -> match nothing, same as an empty `in` elsewhere

  // Prisma `in` never matches NULL, so a plain customer `in` filter would
  // permanently hide any job with no Customer set — including one just added
  // on this very page (saveNewRows allows a blank Customer). With no filter
  // active, null-customer jobs must show; with a filter active they're
  // excluded like any other non-selected value.
  const customerWhere =
    customers === undefined
      ? {} // no filter -> all jobs, including customer = null
      : { customer: { in: selectedCustomers } };

  const jobs = await prisma.job.findMany({
    where: {
      type: { in: selectedTypes },
      ...customerWhere,
      status: { in: selectedStatuses },
      ...billableWhere,
    },
    // estimatedHours carries the quoted figures this grid edits. Actual hours
    // are NOT built from the job's etcEntries any more — that join used to ride
    // along here, and it understated every closed month, because
    // EtcEntry.hoursWorked is frozen when a month closes while people keep
    // booking late time against it. actual-hours.ts owns that rule now, for this
    // grid and the Job Hour Details dashboard alike.
    include: { estimatedHours: true },
    orderBy: { [sortKey]: sortDir },
  });
  if (sortKey === "jobId") {
    // Job Id is a string column — re-sort numerically (979 before 1020 before 10000).
    jobs.sort((a, b) => (sortDir === "desc" ? -1 : 1) * compareJobIds(a.jobId, b.jobId));
  }
  // SDC's own internal projects (customer "SDC" / "Steven Douglas Corp.")
  // always sink to the very bottom, regardless of the chosen sort. This is
  // keyed on isSdcCustomer — the SAME predicate that gives them their
  // light-blue row highlight below — so ordering and highlight always agree,
  // even if a row's stored billable flag is momentarily stale. Array#sort is
  // stable, so this only reorders across the SDC / non-SDC boundary and leaves
  // each group's existing order untouched.
  jobs.sort((a, b) => Number(isSdcCustomer(a.customer)) - Number(isSdcCustomer(b.customer)));

  // Actual hours for every job on screen, in one pass rather than a join per
  // row. Keyed by internal job id.
  const actualHours = await loadActualHoursBySection(jobs.map((j) => j.id));

  // Which of these jobs have a schedule in the SDC Scheduler (+ its base URL),
  // so each row can show an "open in Scheduler" icon only where it leads
  // somewhere. Fail-soft: empty set when the Scheduler DB isn't configured.
  const { baseUrl: schedulerBaseUrl, jobNumbers: schedulerJobNumbers, ssoEmail: schedulerSsoEmail } = await getSchedulerLinkContext();

  const visibleSectionsByPhase = new Map(
    PHASE_GROUPS.map((g) => [g.phase, SECTIONS.filter((s) => s.phase === g.phase && visibleSet.has(s.code))])
  );

  // Total visible data columns: for each phase, its visible sections (or just 1
  // collapsed column if every section in that phase is hidden), PLUS the two
  // grand-total columns (Engineering total + Shop total) that span all phases.
  const dataColumnCount =
    PHASE_GROUPS.reduce((sum, g) => {
      const visible = visibleSectionsByPhase.get(g.phase) ?? [];
      return sum + visible.length; // fully-hidden phases render no column
    }, 0) + 2;

  // Currently-visible section codes split by billing group — the two grand
  // totals sum exactly these, so they track the column pickers. Shop = the
  // sheet's "Shop" department band; everything else (PM/ME/CE/General
  // Engineering/Engineering) rolls into Engineering, matching the header bands.
  const visibleSectionsFlat = PHASE_GROUPS.flatMap((g) => visibleSectionsByPhase.get(g.phase) ?? []);
  const engCodes = visibleSectionsFlat.filter((s) => s.group !== "Shop").map((s) => s.code);
  const shopCodes = visibleSectionsFlat.filter((s) => s.group === "Shop").map((s) => s.code);

  return (
    // QuotedSaveForm (client) owns the <form> so the Save button can read what the
    // action returned — counts on success, the message on failure. The grid below
    // stays a server component, passed through as children.
    <QuotedSaveForm action={saveQuotedHours} className="w-full px-8 py-10 md:px-13 md:py-11">
      {/* Wraps the toolbar AND the grid: the switch, the Add/Save buttons and
          the fieldset that locks the cells all read the same client state, so
          they can never show three different opinions about the mode. */}
      <ProjectsEditModeProvider initialEditing={initialEditing} mayEdit={mayEdit}>
      <div className="mb-1 flex items-end justify-between gap-4">
        <PageTitle>Projects</PageTitle>
        <WhenEditing>
          <div className="flex items-center gap-2.5">
            <AddProjectButton className={BUTTON_PRIMARY} />
            <SaveQuotedHoursButton />
          </div>
        </WhenEditing>
      </div>
      <p className="mb-2 text-sm text-sdc-gray-600">
        {jobs.length} jobs — quoted hours by section, quoted vs. actual cost. Click a phase to choose which section columns to show.
      </p>
      <p className="mb-5 flex items-center gap-4 text-xs text-sdc-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-sdc-blue-dark">000</span> = Quoted hours
        </span>
        <span className="text-sdc-gray-400">/</span>
        <span className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-sdc-green-text">000</span> = Actual hours
        </span>
      </p>

      {/* Toolbar, bucketed (2026-07-30). It had twelve buttons: four row
          filters, four phase pickers, Actuals, Columns, Grid Size, Views. They
          collapse into four by what they DO — filter rows, choose columns,
          change appearance, recall a saved view — with each button carrying the
          count the individual buttons used to show, so nothing became invisible.
          Filters and Sections apply on close; Display is instant (client-only). */}
      <div className="mb-5 flex flex-wrap gap-2.5">
        {/* First in the row: whether the grid is live is the one thing a user
            shouldn't have to discover by typing into it. */}
        <ProjectsEditModeToggle />
        <ProjectsFilterMenu
          filters={[
            { key: "customers", label: "Customer", options: allCustomers, selected: selectedCustomers, searchable: true },
            { key: "types", label: "Type", options: allTypes, selected: selectedTypes },
            { key: "statuses", label: "Status", options: allStatuses, selected: selectedStatuses },
            { key: "billables", label: "Billable", options: BILLABLE_OPTIONS, selected: selectedBillables },
          ]}
        />
        <ProjectsSectionsMenu
          phases={PHASE_GROUPS.map((g) => ({
            phase: g.phase,
            sections: SECTIONS.filter((s) => s.phase === g.phase).map((s) => ({ code: s.code, name: s.name })),
          }))}
          visibleCodes={visibleCodes}
          infoColumns={[...TOGGLE_COLUMNS]}
          hiddenInfo={[...hiddenCols]}
        />
        <ProjectsDisplayMenu />
        <ProjectViewsMenu sharedViews={sharedViews} teamDefault={teamDefault} />
        {/* Show all / Reset — last, and visually a switch rather than another
            dropdown, because it's the only binary control here. */}
        <ProjectsShowAllSwitch
          allCustomers={allCustomers}
          allTypes={allTypes}
          allStatuses={allStatuses}
          allBillables={BILLABLE_OPTIONS}
          allSectionCodes={SECTIONS.map((s) => s.code)}
        />
      </div>

      <ProjectsEditFieldset>
      <DragScroll className="max-h-[calc(100vh-170px)] min-w-[480px] overflow-auto rounded-xl border border-sdc-border bg-white shadow-sm select-none styled-scrollbar">
        {/* quiet-controls: hide the per-row dropdown chevrons (Type/Billable/
            Status) and date calendar icons until the cell is hovered/focused —
            see globals.css. Scoped to this table so other grids (Employees)
            keep their always-visible affordances. Also covers the NewProjectRows
            rows, which render into this same tbody. */}
        {/* hide-actuals: server-rendered from the `actuals` view param, so the
            grid arrives in the right state instead of painting the "/ actual"
            halves and hiding them a frame later (see globals.css). It also
            widens the quoted input back out — with the suffix gone, there's a
            whole cell for it. */}
        <table className={`quiet-controls w-full text-sm ${TABLE_GRID} ${ZOOM_CONTROLS} ${showActuals ? "" : "hide-actuals"}`}>
          <thead className="sticky top-0 z-20 bg-sdc-gray-100">
            <tr className={TABLE_HEADER_ROW}>
              <th rowSpan={3} className="frozen-col sticky left-0 z-10 w-8 min-w-8 bg-sdc-gray-100 px-1 py-2 text-center align-bottom">
                #
              </th>
              <th rowSpan={3} className="frozen-col sticky left-8 z-10 w-20 min-w-20 max-w-20 overflow-hidden truncate bg-sdc-gray-100 px-2 py-2 align-bottom">
                <SortButton sortKey="jobId" label="Job Id" currentSort={sortKey} currentDir={sortDir} />
              </th>
              {show("job") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--job-col-width, 280px)", minWidth: "var(--job-col-width, 280px)" }}
                  className="frozen-col frozen-col-last sticky left-[7rem] z-10 border-l border-r border-sdc-border bg-sdc-gray-100 px-2 py-2 align-bottom"
                >
                  Job
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--job-col-width"
                    data-resize-min="160"
                    data-resize-max="640"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("customer") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--customer-col-width, 120px)", minWidth: "var(--customer-col-width, 120px)" }}
                  className="relative px-2 py-2 align-bottom"
                >
                  Customer
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--customer-col-width"
                    data-resize-min="80"
                    data-resize-max="400"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("type") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--type-col-width, 90px)", minWidth: "var(--type-col-width, 90px)" }}
                  className="relative px-1 py-2 align-bottom"
                >
                  Type
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--type-col-width"
                    data-resize-min="60"
                    data-resize-max="300"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("billable") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--billable-col-width, 110px)", minWidth: "var(--billable-col-width, 110px)" }}
                  className="relative px-1 py-2 align-bottom"
                >
                  Billable
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--billable-col-width"
                    data-resize-min="70"
                    data-resize-max="300"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("status") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--status-col-width, 100px)", minWidth: "var(--status-col-width, 100px)" }}
                  className="relative px-1 py-2 align-bottom"
                >
                  <SortButton sortKey="status" label="Status" currentSort={sortKey} currentDir={sortDir} />
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--status-col-width"
                    data-resize-min="70"
                    data-resize-max="300"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("startDate") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--startdate-col-width, 92px)", minWidth: "var(--startdate-col-width, 92px)" }}
                  className="relative px-1 py-2 align-bottom"
                >
                  <SortButton sortKey="startDate" label={"Start\nDate"} currentSort={sortKey} currentDir={sortDir} />
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--startdate-col-width"
                    data-resize-min="65"
                    data-resize-max="300"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {show("completeDate") && (
                <th
                  rowSpan={3}
                  style={{ width: "var(--completedate-col-width, 92px)", minWidth: "var(--completedate-col-width, 92px)" }}
                  className="relative px-1 py-2 align-bottom"
                >
                  <SortButton sortKey="completeDate" label={"Complete\nDate"} currentSort={sortKey} currentDir={sortDir} />
                  <div
                    className="col-resize-handle absolute right-0 inset-y-0 z-10 w-3"
                    data-resize-var="--completedate-col-width"
                    data-resize-min="65"
                    data-resize-max="300"
                    title="Drag to resize"
                    style={{ touchAction: "none" }}
                  />
                </th>
              )}
              {PHASE_GROUPS.map((g) => {
                const visible = visibleSectionsByPhase.get(g.phase) ?? [];
                const color = PHASE_HEADER_COLOR[g.phase] ?? "bg-sdc-blue-light";
                // A phase with no visible sections renders no column at all
                // (e.g. Warranty, hidden by default) — re-enable a section via
                // its phase picker to bring the column back.
                return visible.length ? (
                  <th
                    key={g.phase}
                    colSpan={visible.length}
                    className={`border-l border-sdc-border px-2 py-2 text-center italic ${color}`}
                  >
                    {g.phase}
                  </th>
                ) : null;
              })}
              <th
                rowSpan={3}
                style={DATA_COL_STYLE}
                className="border-l border-sdc-border bg-sdc-blue-light px-2 py-2 text-center align-bottom text-[11px] leading-tight text-sdc-blue-dark"
              >
                ENG
                <span className="block font-semibold">TOTAL</span>
              </th>
              <th
                rowSpan={3}
                style={DATA_COL_STYLE}
                className="border-l border-sdc-border bg-sdc-blue-light px-2 py-2 text-center align-bottom text-[11px] leading-tight text-sdc-blue-dark"
              >
                SHOP
                <span className="block font-semibold">TOTAL</span>
              </th>
              <th rowSpan={3} className="min-w-[90px] border-l border-sdc-border bg-sdc-green-bg px-2 py-2 text-center align-bottom text-sdc-green-text">
                Cost Quoted
              </th>
              <th rowSpan={3} className="min-w-[90px] bg-sdc-green-bg px-2 py-2 text-center align-bottom text-sdc-green-text">
                Cost Actual Historical
              </th>
            </tr>
            <tr className={TABLE_HEADER_ROW}>
              {PHASE_GROUPS.flatMap((g) => {
                const sections = visibleSectionsByPhase.get(g.phase) ?? [];
                if (!sections.length) return [];
                const groupHeaders = groupRuns(sections).map((run, i) => (
                  <th
                    key={`${g.phase}-group-${i}`}
                    colSpan={run.count}
                    title={GROUP_FULL_NAME[run.group]}
                    className={`qc border-l border-sdc-border px-1 py-1.5 text-center text-[10px] italic ${
                      GROUP_HEADER_COLOR[run.group] ?? ""
                    }`}
                  >
                    {abbreviateLabel(run.group)}
                  </th>
                ));
                return groupHeaders;
              })}
            </tr>
            <tr className={TABLE_HEADER_ROW}>
              {PHASE_GROUPS.flatMap((g) => {
                const sections = visibleSectionsByPhase.get(g.phase) ?? [];
                // break-word, NOT the `anywhere` this used to use: `anywhere`
                // breaks a word the moment it would help, which is what
                // shattered these headers into "DR AWI NGS". `break-word` only
                // ever breaks a word that has no line of its own, so it sits
                // dormant at the width above and just guards against a future
                // section name longer than any of today's.
                return sections.map((s) => (
                  <th key={s.code} title={s.code} style={DATA_COL_STYLE} className="qc break-normal border-l border-sdc-border px-1 py-2 text-center text-[10px] leading-tight">
                    {s.name}
                    <span className="block font-mono text-[10px] font-normal normal-case tracking-normal text-sdc-gray-400">
                      {s.code}
                    </span>
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            <WhenEditing>
            <NewProjectRows
              hidden={[...hiddenCols]}
              phaseGroups={PHASE_GROUPS.map((g) => ({ phase: g.phase, sections: visibleSectionsByPhase.get(g.phase) ?? [] }))}
              allStatuses={allStatuses}
            />
            </WhenEditing>
            {jobs.length === 0 && (
              <tr>
                {/* 2 always-on (# + Job Id) + visible toggle columns + phase cols + 2 cost cols */}
                <td colSpan={2 + TOGGLE_COLUMNS.filter((c) => show(c.key)).length + dataColumnCount + 2} className="px-4 py-5 text-center text-sdc-gray-400">
                  No jobs found.
                </td>
              </tr>
            )}
            {jobs.map((job, i) => {
              const hoursBySection = new Map(job.estimatedHours.map((eh) => [eh.section, eh.quotedHours]));
              // Actual hours to date, per section — one shared definition, see
              // actual-hours.ts. Empty map for a job with no hours at all.
              const actualBySection = actualHours.get(job.id) ?? EMPTY_ACTUALS;
              // SDC's own internal projects are always non-billable and get a
              // permanent light-blue highlight so they stand out from customer
              // work at a glance — this is driven by Customer, not the stored
              // billable flag, so it's correct even before the next save.
              const isSdc = isSdcCustomer(job.customer);
              const tone = scheduleTone(job);
              const zebra = isSdc ? "bg-[#caedfb]" : i % 2 === 1 ? "bg-sdc-gray-50/60" : "";
              const zebraSticky = isSdc ? "bg-[#caedfb]" : i % 2 === 1 ? "bg-sdc-gray-50" : "bg-white";
              return (
                <tr key={job.id} className={`hover:bg-sdc-blue-light/40 ${zebra}`}>
                  <td className={`frozen-col sticky left-0 z-10 w-8 min-w-8 overflow-hidden px-1 py-1.5 text-center align-middle text-[10px] whitespace-nowrap text-sdc-gray-400 ${zebraSticky}`}>
                    {i + 1}
                  </td>
                  {/* Left-click keeps its direct Job Hour Details link (this
                      column's long-standing behavior); right-click adds the same
                      menu the Job cell has, so the Scheduler is reachable here
                      too. */}
                  <JobCellMenu
                    jobId={job.jobId}
                    jobName={job.jobName}
                    schedulerUrl={schedulerJobNumbers.has(job.jobId) ? schedulerScheduleUrl(schedulerBaseUrl, job.jobId, schedulerSsoEmail) : null}
                    title={`Open ${job.jobId} in Job Hour Details — right-click for more`}
                    className={`frozen-col sticky left-8 z-10 w-20 min-w-20 max-w-20 overflow-hidden truncate px-2 py-1.5 text-center font-mono text-[10px] ${zebraSticky}`}
                  >
                    <Link
                      href={`/job-hours?jobs=${encodeURIComponent(job.jobId)}`}
                      title={tone.title}
                      className={`hover:underline ${tone.weight || "font-semibold"} ${tone.color || "text-sdc-blue-dark"}`}
                    >
                      {job.jobId}
                    </Link>
                  </JobCellMenu>
                  {show("job") && (
                    // The Job Hour Details / Scheduler icon-links that used to
                    // sit here moved into JobCellMenu's right-click menu — same
                    // two destinations, without an icon pair on every row.
                    <JobCellMenu
                      jobId={job.jobId}
                      jobName={job.jobName}
                      schedulerUrl={
                        schedulerJobNumbers.has(job.jobId) ? schedulerScheduleUrl(schedulerBaseUrl, job.jobId, schedulerSsoEmail) : null
                      }
                      style={{ width: "var(--job-col-width, 280px)", minWidth: "var(--job-col-width, 280px)" }}
                      className={`frozen-col frozen-col-last sticky left-[7rem] z-10 overflow-hidden border-l border-r border-sdc-border px-2 py-1.5 text-left align-middle text-[10px] font-medium whitespace-nowrap text-sdc-navy ${zebraSticky}`}
                    >
                      <div className="flex min-h-[14px] min-w-0 items-center gap-1">
                        <input
                          type="text"
                          name={`jobField__${job.id}__jobName`}
                          defaultValue={job.jobName}
                          data-baseline={job.jobName}
                          aria-label={`Job Name, ${job.jobName}`}
                          title={tone.title}
                          className={`w-full min-w-0 flex-1 text-left ${tone.weight} ${tone.color}`}
                        />
                      </div>
                    </JobCellMenu>
                  )}
                  {show("customer") && (
                    <td
                      style={{ width: "var(--customer-col-width, 120px)", minWidth: "var(--customer-col-width, 120px)", maxWidth: "var(--customer-col-width, 120px)" }}
                      className="overflow-hidden whitespace-nowrap px-2 py-1.5 text-left align-middle text-[10px] text-sdc-gray-600"
                      title={job.customer ?? ""}
                    >
                      <input
                        type="text"
                        name={`jobField__${job.id}__customer`}
                        defaultValue={job.customer ?? ""}
                        data-baseline={job.customer ?? ""}
                        placeholder="—"
                        aria-label={`Customer, ${job.jobName}`}
                        className="w-full text-left"
                      />
                    </td>
                  )}
                  {show("type") && (
                    <td
                      style={{ width: "var(--type-col-width, 90px)", minWidth: "var(--type-col-width, 90px)", maxWidth: "var(--type-col-width, 90px)" }}
                      className="overflow-hidden whitespace-nowrap px-1 py-1.5 text-center align-middle text-[10px] text-sdc-gray-600"
                    >
                      <select
                        name={`jobField__${job.id}__type`}
                        defaultValue={job.type ?? ""}
                        data-baseline={job.type ?? ""}
                        aria-label={`Type, ${job.jobName}`}
                        className="text-center"
                      >
                        {job.type == null && <option value="">—</option>}
                        {VALID_JOB_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {show("billable") && (
                    <td
                      style={{ width: "var(--billable-col-width, 110px)", minWidth: "var(--billable-col-width, 110px)", maxWidth: "var(--billable-col-width, 110px)" }}
                      className="overflow-hidden whitespace-nowrap px-1 py-1.5 text-center align-middle text-[10px]"
                    >
                      {isSdc ? (
                        <span className="text-sdc-gray-500" aria-label={`Billable, ${job.jobName}`} title="SDC's own projects are always non-billable">
                          Non-Billable
                        </span>
                      ) : (
                        <select
                          name={`jobField__${job.id}__billable`}
                          defaultValue={job.billable ? "Billable" : "Non-Billable"}
                          data-baseline={job.billable ? "Billable" : "Non-Billable"}
                          aria-label={`Billable, ${job.jobName}`}
                          className={`text-center ${job.billable ? "text-sdc-green-text" : "text-sdc-gray-500"}`}
                        >
                          <option value="Billable">Billable</option>
                          <option value="Non-Billable">Non-Billable</option>
                        </select>
                      )}
                    </td>
                  )}
                  {show("status") && (
                    <td
                      style={{ width: "var(--status-col-width, 100px)", minWidth: "var(--status-col-width, 100px)", maxWidth: "var(--status-col-width, 100px)" }}
                      className={`overflow-hidden whitespace-nowrap px-1 py-1.5 text-center align-middle text-[10px] font-medium ${
                        job.status === "Complete"
                          ? "text-sdc-green-text"
                          : job.status === "HeadStart"
                            ? // Amber: intent to start, nothing authorised yet.
                              "text-sdc-yellow-text"
                            : "text-sdc-blue-dark"
                      }`}
                    >
                      <select
                        name={`jobField__${job.id}__status`}
                        defaultValue={job.status}
                        data-baseline={job.status}
                        aria-label={`Status, ${job.jobName}`}
                        className="text-center"
                      >
                        {allStatuses.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {show("startDate") && (
                    <td
                      style={{ width: "var(--startdate-col-width, 92px)", minWidth: "var(--startdate-col-width, 92px)", maxWidth: "var(--startdate-col-width, 92px)" }}
                      className="overflow-hidden whitespace-nowrap px-1 py-1.5 text-left align-middle text-[10px] text-sdc-gray-500"
                    >
                      <DateCell
                        name={`jobField__${job.id}__startDate`}
                        defaultValue={dateInputValue(job.startDate)}
                        ariaLabel={`Start Date, ${job.jobName}`}
                      />
                    </td>
                  )}
                  {show("completeDate") && (
                    <td
                      style={{ width: "var(--completedate-col-width, 92px)", minWidth: "var(--completedate-col-width, 92px)", maxWidth: "var(--completedate-col-width, 92px)" }}
                      className="overflow-hidden whitespace-nowrap px-1 py-1.5 text-left align-middle text-[10px] text-sdc-gray-500"
                    >
                      <DateCell
                        name={`jobField__${job.id}__completeDate`}
                        defaultValue={dateInputValue(job.completeDate)}
                        ariaLabel={`Complete Date, ${job.jobName}`}
                      />
                    </td>
                  )}
                  {PHASE_GROUPS.map((g) => {
                    const visibleSections = visibleSectionsByPhase.get(g.phase) ?? [];
                    // Fully-hidden phase (e.g. Warranty) renders no column.
                    if (!visibleSections.length) return null;
                    return (
                      <Fragment key={g.phase}>
                        {visibleSections.map((s) => {
                          const hours = hoursBySection.get(s.code);
                          const actual = actualBySection.get(s.code) ?? 0;
                          // Over/under coloring vs quoted, gated by job status:
                          //  actual > quoted -> red (over); else completed -> green;
                          //  else (active, at/under quoted) -> yellow. Cells with
                          //  neither a quote nor an actual stay neutral.
                          const q = hours != null ? Number(hours) : 0;
                          const jobDone = job.status === "Complete";
                          const tone =
                            q <= 0 && actual <= 0
                              ? ""
                              : actual > q
                                ? "bg-red-100"
                                : jobDone
                                  ? "bg-sdc-green-bg/60"
                                  : "bg-sdc-yellow-bg/50";
                          return (
                            <td
                              key={s.code}
                              style={DATA_COL_STYLE}
                              className={`qc quoted-actual-cell overflow-hidden border-l border-sdc-border px-1 py-1.5 text-center align-middle font-mono text-[10px] whitespace-nowrap text-sdc-gray-600 ${tone}`}
                              title={`Quoted ${exactHours(hours) ?? "0"} / Actual ${exactHours(actual) ?? "0"}`}
                            >
                              <input
                                type="number"
                                step="1"
                                min="0"
                                name={`quoted__${job.id}__${s.code}`}
                                defaultValue={hours != null ? Math.round(Number(hours)).toString() : ""}
                                data-baseline={hours != null ? Math.round(Number(hours)).toString() : ""}
                                placeholder="—"
                                aria-label={`Quoted hours, ${job.jobName}, ${s.name}`}
                                className="text-center font-semibold text-sdc-blue-dark"
                              />
                              <span className="actual-suffix text-sdc-gray-400">
                                /<span className="font-semibold text-sdc-green-text">{wholeHours(actual)}</span>
                              </span>
                            </td>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {(() => {
                    // Two grand totals — Engineering and Shop — each summing the
                    // currently-visible sections in that billing group. The
                    // "/ actual" half uses the same .actual-suffix hook as the
                    // section cells, so it hides when Actuals is toggled off.
                    const sumQ = (codes: string[]) => codes.reduce((s, c) => s + Number(hoursBySection.get(c) ?? 0), 0);
                    const sumA = (codes: string[]) => codes.reduce((s, c) => s + (actualBySection.get(c) ?? 0), 0);
                    const cell = (label: string, codes: string[]) => {
                      const q = sumQ(codes);
                      const a = sumA(codes);
                      return (
                        <td
                          style={DATA_COL_STYLE}
                          className="overflow-hidden whitespace-nowrap border-l border-sdc-border bg-sdc-blue-light px-1 py-1.5 text-center align-middle font-mono text-[10px] font-medium"
                          title={`${label} — Quoted ${exactHours(q) ?? "0"} / Actual ${exactHours(a) ?? "0"}`}
                        >
                          <span className="font-semibold text-sdc-blue-dark">{wholeHours(q)}</span>
                          <span className="actual-suffix text-sdc-gray-400"> /<span className="font-semibold text-sdc-green-text"> {wholeHours(a)}</span></span>
                        </td>
                      );
                    };
                    return (
                      <>
                        {cell("Engineering", engCodes)}
                        {cell("Shop", shopCodes)}
                      </>
                    );
                  })()}
                  <td className={`overflow-hidden whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-center align-middle text-[10px] font-medium text-sdc-navy ${zebra}`}>
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-sdc-gray-400">$</span>
                      <MoneyCell
                        name={`jobField__${job.id}__costQuoted`}
                        defaultValue={job.costQuoted != null ? Number(job.costQuoted).toString() : ""}
                        ariaLabel={`Cost Quoted, ${job.jobName}`}
                        className={MONEY_INPUT}
                      />
                    </div>
                  </td>
                  <td className={`overflow-hidden whitespace-nowrap border-l border-sdc-border px-2 py-1.5 text-center align-middle text-[10px] text-sdc-gray-600 ${zebra}`}>
                    <div className="flex items-center justify-center gap-0.5">
                      <span className="text-sdc-gray-400">$</span>
                      <MoneyCell
                        name={`jobField__${job.id}__costActualHistorical`}
                        defaultValue={job.costActualHistorical != null ? Number(job.costActualHistorical).toString() : ""}
                        ariaLabel={`Cost Actual, ${job.jobName}`}
                        className={MONEY_INPUT}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DragScroll>
      </ProjectsEditFieldset>
      </ProjectsEditModeProvider>
    </QuotedSaveForm>
  );
}
