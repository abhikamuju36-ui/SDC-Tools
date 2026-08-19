import type { Permission } from "@/lib/permissions";

// Fixed section-code column order and names, confirmed directly against the
// "Estimated Hours" tab of Project Planner Data Control.xlsx (rows 2-7: phase,
// section id, Function Group, Function Name, function id, full code). `group`
// is that sheet's "Function Group" department band — a header level between
// phase and section name (PM / ME / CE / General Engineering / Shop, and
// Engineering / Shop again for the Machine Testing/Teardown/Warranty blocks,
// which have no per-department breakdown). Shared by the Quoted page and the
// Monthly ETC grid so both use the identical column layout.
export const SECTIONS: { code: string; name: string; phase: string; group: string }[] = [
  { code: "10-111", name: "PM", phase: "Complete Design & Build", group: "PM" },
  { code: "10-211", name: "ME Gen", phase: "Complete Design & Build", group: "ME" },
  { code: "10-312", name: "Design & Drawings", phase: "Complete Design & Build", group: "CE" },
  { code: "10-313", name: "Software", phase: "Complete Design & Build", group: "CE" },
  { code: "10-515", name: "HMI", phase: "Complete Design & Build", group: "General Engineering" },
  { code: "10-516", name: "Robot", phase: "Complete Design & Build", group: "General Engineering" },
  { code: "10-517", name: "Vision", phase: "Complete Design & Build", group: "General Engineering" },
  { code: "10-518", name: "Database & Device", phase: "Complete Design & Build", group: "General Engineering" },
  { code: "10-411", name: "Mech Build", phase: "Complete Design & Build", group: "Shop" },
  { code: "10-412", name: "Elec Build", phase: "Complete Design & Build", group: "Shop" },
  { code: "10-413", name: "Mfg", phase: "Complete Design & Build", group: "Shop" },
  { code: "40-211", name: "ME & CE", phase: "Machine Testing", group: "Engineering" },
  { code: "40-411", name: "MB & EB", phase: "Machine Testing", group: "Shop" },
  { code: "50-211", name: "ME & CE", phase: "Teardown & Install", group: "Engineering" },
  { code: "50-411", name: "MB & EB", phase: "Teardown & Install", group: "Shop" },
  { code: "70-211", name: "ME & CE", phase: "Warranty", group: "Engineering" },
  { code: "70-411", name: "MB & EB", phase: "Warranty", group: "Shop" },
];

// Consecutive runs of the same phase, for a grouped header row's colSpans.
export const PHASE_GROUPS = SECTIONS.reduce<{ phase: string; count: number }[]>((groups, s) => {
  const last = groups[groups.length - 1];
  if (last && last.phase === s.phase) {
    last.count += 1;
  } else {
    groups.push({ phase: s.phase, count: 1 });
  }
  return groups;
}, []);

// The Monthly ETC grid tracks a narrower set than Quoted/Estimated Hours —
// confirmed by decoding the real "Managers Fill Out" sheet's header rows
// (End Of Month ETC Sheet.xlsx): it has no PM (10-111) or Manufacturing
// (10-413) column, and no Warranty phase at all. Quoted/EstimatedHours keep
// using the full SECTIONS/PHASE_GROUPS above; only the ETC page uses this.
const ETC_EXCLUDED_CODES = new Set(["10-111", "10-413", "70-211", "70-411"]);

// Billing group per section — matches the sheet's own "Total (New ETC)"
// rollup, which is a pure formula (SUM of the Engineering blocks' columns,
// separately SUM of the Shop blocks') rather than a manager-entered value.
const ENGINEERING_CODES = new Set(["10-211", "10-312", "10-313", "10-515", "10-516", "10-517", "10-518", "40-211", "50-211"]);

export const ETC_SECTIONS: { code: string; name: string; phase: string; billingGroup: "Engineering" | "Shop" }[] =
  SECTIONS.filter((s) => !ETC_EXCLUDED_CODES.has(s.code)).map((s) => ({
    ...s,
    billingGroup: ENGINEERING_CODES.has(s.code) ? "Engineering" : "Shop",
  }));

export const ETC_TRACKED_CODES = new Set(ETC_SECTIONS.map((s) => s.code));

// Codes whose PUNCHES the app imports — a wider set than the ETC grid displays.
//
// The two were the same set until 2026-07-31, which meant manufacturing time
// (function 414, ~834h in July) was not merely absent from the ETC grid, where it
// belongs by design, but discarded at the door: it reached no job's actual hours,
// no punch drill, nothing. A section being off the ETC sheet is a statement about
// that sheet, not about whether the hours happened.
//
// Kept OUT of ETC_TRACKED_CODES on purpose, so the Monthly ETC grid, its totals
// and its KPI cards are untouched — those are the fixed 9-code / 4-code formulas
// the team confirmed.
//
// ── PM (10-111) and Warranty (70-211/70-411) joined 2026-08-17, same reasoning ──
//
// These three were the other outstanding gap of the same shape as Manufacturing above:
// dropped at the door, present only as a company-wide Standard Fees pool figure
// (poolCategoryForPunch below), invisible to JobHoursDetail/the Hours tab and to
// JobMonthlyActualHours (Job detail's "Actual Hours by Month", the Job Hour Details
// dashboard's Engineering/Shop totals, and the Projects grid's PM/Warranty column
// coloring when unlocked). By explicit request, this mirrors the Manufacturing fix
// exactly rather than adding new isolation machinery: these three now flow into every
// place actual hours already show up, the same as 10-413 already does. The pools are
// unaffected — poolCategoryForPunch is keyed off the raw punch code independently of
// this set, so PM/Warranty keep being pool-tracked exactly as before, in addition to
// now also being per-job attributed.
export const PM_AND_WARRANTY_CODES = new Set(["10-111", "70-211", "70-411"]);

// ── Service (80-*) and Spare Parts (90-*), 2026-08-17 ───────────────────────────
//
// The two phases `mapPunchToColumns`'s own comment already named as "phases the app
// doesn't model" — no SECTIONS entry, no ETC/Quoted column, no pool, nothing. Real
// codes below are read directly off the live Current_Job_Hours.xlsx (not guessed —
// guessing risks under- or over-counting real hours), covering every MachineSec-
// Function combination actually observed under phase 80/90:
//   80: 112, 211, 311, 313, 411, 412, 414, 516
//   90: 211, 311, 411, 412, 414
//
// Kept OUT of PM_AND_WARRANTY_CODES's "everywhere" treatment on purpose. Unlike PM/
// Warranty/Manufacturing, these have no existing SECTIONS row, so JobMonthlyActualHours
// (a raw sum over every captured code) would grow while the Job Hour Details dashboard
// and Projects grid — which only ever iterate the 17 SECTIONS codes — stayed blind to
// why, a NEW reconciliation gap this app has no tolerance for. sync-powerbi.ts
// excludes this exact set from the JobMonthlyActualHours rollup so only JobHoursDetail
// (and therefore the Hours tab) sees them. No aliasing/folding: each stays its own
// column here, and hours-operational-grouping.ts is what rolls several of them into
// one Function Group/Task label for display.
export const SERVICE_AND_SPARE_PARTS_CODES = new Set([
  "80-112",
  "80-211",
  "80-311",
  "80-313",
  "80-411",
  "80-412",
  "80-414",
  "80-516",
  "90-211",
  "90-311",
  "90-411",
  "90-412",
  "90-414",
]);

export const HOURS_IMPORT_CODES = new Set([
  ...ETC_TRACKED_CODES,
  "10-413",
  ...PM_AND_WARRANTY_CODES,
  ...SERVICE_AND_SPARE_PARTS_CODES,
]);

// ── Punch code -> app column ────────────────────────────────────────────────
//
// Punch codes the ETC grid has no column for, mapped onto the column they belong
// to. Derived from Power BI's OWN bucketing, probed measure by measure against
// every code in the July export (2026-07-31) rather than assumed:
//
//   [Engineering Hours]   counts functions 211, 311, 312, 313, 515-518
//   [Shop Hours]          counts functions 411, 412
//   [Manufacturing Hours] counts function  414
//   [PM Hours]            counts function  111
//
// Power BI buckets by FUNCTION regardless of phase; this app has a fixed column
// per MachineSec-Function pair. So an engineering punch in the Testing phase
// (40-311) matched no column and silently vanished — 795h in July alone, on top
// of 834h of manufacturing time booked to 10-414 while the app's Mfg column is
// coded 10-413, a code that appears nowhere in the punch data at all.
//
// Verified against the report job by job: for 1101 in July, Power BI shows
// Engineering 91 = the app's 73.62 + 40-311 (12.50) + 70-311 (5.00, warranty),
// and Manufacturing 18 = 10-414 (17.90).
//
// Warranty (70-*) is deliberately NOT aliased. Power BI folds it into
// Engineering/Shop, but the ETC grid's totals are a fixed formula over 9
// engineering and 4 shop codes that excludes the Warranty phase entirely —
// confirmed with the team 2026-07-31. Aliasing it in would silently change a
// total whose definition they had just signed off.
//
// Lives here rather than in the reader that used to own it (the now-deleted
// sharepoint-hours.ts), because it is not a property of any one FILE or feed —
// it is how a Paylocity function code becomes an app column, and every reader
// must get the same answer. A second copy is how two sources drift, which is
// exactly what happened on 2026-08-03 when a Power BI backfill wrote raw codes
// and left 27,553h stored but columnless.
export const SECTION_ALIASES: Record<string, string> = {
  // Manufacturing: the punch data uses 414, the app's column is 413.
  "10-414": "10-413",
  // Defensive-only (2026-08-17): no confirmed occurrence of 315 in real data, but the
  // Database & Device row's own function list (315, 518) named it, so it's aliased here
  // rather than left to silently drop if it ever does appear — zero cost while it never
  // occurs, captures it under Database & Device the moment it does.
  "10-315": "10-518",
  // Engineering functions inside a phase whose engineering column is the -211
  // one. (10-311 is NOT here: it keeps its documented 30/70 split into
  // 10-312/10-313, which exist as their own columns.)
  "40-311": "40-211",
  "40-312": "40-211",
  "40-313": "40-211",
  "50-311": "50-211",
  "50-312": "50-211",
  "50-313": "50-211",
  // Shop functions likewise, onto the phase's -411 column.
  "40-412": "40-411",
  "50-412": "50-411",
};

// One punch's hours, resolved to the app column(s) that should carry them.
//
// Returns [] when the code reaches no column at all — phases the app doesn't
// model (80/90), function 417 (Power BI drops it too, so it is not a gap between
// the two systems), odd MachineSec values. The caller decides whether to report
// that; this only decides where hours belong.
//
// Splitting returns a LIST because 10-311 becomes two rows: design (312) takes
// 30% and software (313) 70%, per Power BI. Both halves keep the punch's
// employee, so the Hours Detail drill shows one punch as two attributed lines
// that still sum to what was booked.
// `resolve` — the model-derived code->column map (buildColumnResolver in
// job-hours-source.ts). When given, it WINS over SECTION_ALIASES below, because it
// is read from the model's own Function Hierarchy rather than reverse-engineered
// from its measures. SECTION_ALIASES stays as the fallback for when the hierarchy
// can't be fetched, and as the record of what was known before it was.
//
// The nine aliases and the resolver agree everywhere the aliases had an opinion;
// the resolver simply knows about many more codes (the 11-211..20-211 band above
// all). Verified 2026-08-03 against job 1101, where the aliases produced 149h of ME
// Gen and the report showed 634h.
export function mapPunchToColumns(
  rawSection: string,
  hours: number,
  resolve?: (rawSection: string) => string | null,
): { section: string; hours: number }[] {
  const [machineSec, fn] = rawSection.split("-");
  if (fn === "417") return [];
  const section = resolve?.(rawSection) ?? SECTION_ALIASES[rawSection] ?? rawSection;
  if (section === "10-311") {
    return [
      { section: "10-312", hours: hours * 0.3 },
      { section: "10-313", hours: hours * 0.7 },
    ];
  }
  if (!HOURS_IMPORT_CODES.has(section)) return [];
  // machineSec is read only to keep the signature honest about what a raw code
  // is; the alias table already encodes the phase rules.
  void machineSec;
  return [{ section, hours }];
}

// ── The four company-wide Standard Fees pools ──────────────────────────────
//
// The pools are not a separate universe from the sections above: they ARE the
// four sections ETC_EXCLUDED_CODES leaves off the Monthly ETC grid. PM,
// Manufacturing and both Warranty phases are planned company-wide in one pot
// rather than job by job, which is exactly why the grid has no column for them.
export type PoolCategory = "ENGINEERING_PM" | "ENGINEERING_WARRANTY" | "SHOP_MANUFACTURING" | "SHOP_WARRANTY";

export const POOL_CATEGORIES: PoolCategory[] = [
  "ENGINEERING_PM",
  "ENGINEERING_WARRANTY",
  "SHOP_MANUFACTURING",
  "SHOP_WARRANTY",
];

// The quoted-hours section each pool draws its "New Hours Added" from.
export const POOL_QUOTED_SECTION: Record<PoolCategory, string> = {
  ENGINEERING_PM: "10-111",
  ENGINEERING_WARRANTY: "70-211",
  SHOP_MANUFACTURING: "10-413",
  SHOP_WARRANTY: "70-411",
};

// The sections the Projects grid hides from anyone without the matching
// Standard Fees permission: PM, Manufacturing, Warranty Engineering and
// Warranty Shop. They appear neither as columns nor in the Sections picker
// for a role that lacks them.
//
// DERIVED from POOL_QUOTED_SECTION rather than listed again, because these are
// the same four sections that drive the Standard Fees pools — that is precisely
// why they're restricted, and a second hand-written list of the same codes is
// one that eventually disagrees with the first.
export const RESTRICTED_SECTION_CODES: ReadonlySet<string> = new Set(Object.values(POOL_QUOTED_SECTION));

// Which permission (lib/permissions.ts) governs a restricted pool's columns.
// Engineering Warranty and Shop Warranty share one permission — the spec
// names exactly three category grants (PM, Mfg, Warranty), not four — while
// PM and Manufacturing each get their own, so a future role could be given
// one without the others.
export const POOL_PERMISSION: Record<PoolCategory, Permission> = {
  ENGINEERING_PM: "standards:pm",
  SHOP_MANUFACTURING: "standards:mfg",
  ENGINEERING_WARRANTY: "standards:warranty",
  SHOP_WARRANTY: "standards:warranty",
};

const CATEGORY_BY_SECTION_CODE = new Map<string, PoolCategory>(
  Object.entries(POOL_QUOTED_SECTION).map(([category, code]) => [code, category as PoolCategory]),
);

/** The permission that gates a restricted section code, or null for a code that isn't restricted. */
export function restrictedSectionPermission(code: string): Permission | null {
  const category = CATEGORY_BY_SECTION_CODE.get(code);
  return category ? POOL_PERMISSION[category] : null;
}

// Which pool a raw punch belongs to, by MachineSec (phase) + Function.
//
// Deliberately keyed off the RAW punch codes rather than the aliased section,
// because the aliases above exist to feed the ETC grid's fixed columns and drop
// warranty entirely ("Warranty (70-*) is deliberately NOT aliased"). The pools
// need the opposite: warranty is the whole point of two of them.
//
// The buckets follow Power BI's own measure definitions as recorded above
// SECTION_ALIASES just above — [PM Hours] counts function 111,
// [Manufacturing Hours] counts 414, [Engineering Hours] counts 211/311/312/313
// and [Shop Hours] counts 411/412 — with the last two restricted to the
// Warranty phase, since that is the only phase the pools cover.
export function poolCategoryForPunch(machineSec: string, fn: string): PoolCategory | null {
  // Phase 10 only, for the two Design & Build pools. Counting function 414 in
  // every phase ran ~40h/month above the archived Manufacturing figure (measured
  // 2026-07-31 across 2026-02..2026-05), and matches the app's existing alias,
  // which maps "10-414" -> "10-413" and no other phase's 414.
  if (machineSec === "10") {
    if (fn === "111") return "ENGINEERING_PM";
    // The punch data books manufacturing to 414; 413 is the app's own column code.
    if (fn === "413" || fn === "414") return "SHOP_MANUFACTURING";
  }
  if (machineSec === "70") {
    if (fn === "211" || fn === "311" || fn === "312" || fn === "313") return "ENGINEERING_WARRANTY";
    if (fn === "411" || fn === "412") return "SHOP_WARRANTY";
  }
  return null;
}

// "Parts Cost" is a real block in the real sheet — same 5-column shape
// (Prior ETC / Money Spent Month / Money Left / New ETC / Diff) as every
// department, just in dollars instead of hours, and with no Engineering/Shop
// split (a single "Total"). Modeled as an EtcEntry row with this sentinel
// section value rather than a new table, since the shape is identical.
export const PARTS_COST_SECTION = "PARTS_COST";
