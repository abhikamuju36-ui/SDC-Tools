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
export const HOURS_IMPORT_CODES = new Set([...ETC_TRACKED_CODES, "10-413"]);

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

// Which pool a raw punch belongs to, by MachineSec (phase) + Function.
//
// Deliberately keyed off the RAW punch codes rather than the aliased section,
// because the aliases above exist to feed the ETC grid's fixed columns and drop
// warranty entirely ("Warranty (70-*) is deliberately NOT aliased"). The pools
// need the opposite: warranty is the whole point of two of them.
//
// The buckets follow Power BI's own measure definitions as recorded above
// SECTION_ALIASES in sharepoint-hours.ts — [PM Hours] counts function 111,
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
