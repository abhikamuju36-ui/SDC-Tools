// ── The standard Section Name -> Function Group -> Task hierarchy ──────────────
//
// A second, presentation-facing classification of the same codes `sections.ts`
// already owns (SECTIONS/HOURS_IMPORT_CODES) — but that file's `SECTIONS` table
// exists to drive the Quoted/ETC grid's actual columns, and adding phase 80/90 or
// PM/Warranty rows to it would add real columns to those grids. This module is
// the Hours tab's own reporting hierarchy, kept as a separate no-I/O table so
// touching it can never move a Quoted/ETC column, and so any Hours-adjacent
// component that later wants the same hierarchy (the ETC page's KPI drills, the
// Job Hour Details dashboard drill, Data Quality) has exactly one place to import
// it from instead of re-deriving it.
//
// One entry per code the app can now import (sections.ts's expanded
// HOURS_IMPORT_CODES, 30 codes as of 2026-08-17). A code missing from this table
// resolves to UNDEFINED_LABEL at every tier — the defensive fallback the Hours
// tab's grouping needs so a future code drift lands somewhere visible instead of
// silently joining another group's total.

export type OperationalEntry = {
  sectionNumber: string;
  sectionName: string;
  functionGroup: string;
  task: string;
  // The Hours tab's "Group By: Department" tier (2026-08-17, fix — see the
  // module header's "Department means operational" note). Deliberately its
  // OWN naming, not a re-render of `functionGroup`: for Section 10 it splits
  // Shop into Mechanical Build / Electrical Build / Manufacturing Operations
  // (functionGroup collapses all three into one "Shop"), and for Sections
  // 40/50/70/80/90 it's "<Section Name> — <Engineering|Shop>" rather than the
  // bare "Engineering"/"Shop" functionGroup uses — a different, coarser-in-
  // some-places/finer-in-others cut of the same 30 codes, by request.
  department: string;
};

export const UNDEFINED_LABEL = "Undefined / Unmapped";

export const OPERATIONAL_GROUPING: Record<string, OperationalEntry> = {
  // ── Complete Design and Build (10) ──────────────────────────────────────────
  "10-111": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "PM", task: "Project Management", department: "Project Management" },
  "10-211": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "ME", task: "Machine Design", department: "Mechanical Engineering" },
  "10-312": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "CE", task: "Design and Drawings", department: "Controls Engineering" },
  "10-313": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "CE", task: "Software", department: "Controls Engineering" },
  "10-515": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "HMI", department: "General Engineering" },
  "10-516": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "Robot", department: "General Engineering" },
  "10-517": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "Vision", department: "General Engineering" },
  "10-518": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "Database and Device", department: "General Engineering" },
  "10-411": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "Shop", task: "Mechanical Build", department: "Mechanical Build" },
  "10-412": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "Shop", task: "Panel Build", department: "Electrical Build" },
  "10-413": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "Shop", task: "Manufacturing", department: "Manufacturing Operations" },

  // ── Machine Testing (40) ─────────────────────────────────────────────────────
  "40-211": { sectionNumber: "40", sectionName: "Machine Testing", functionGroup: "Engineering", task: "ME and CE", department: "Machine Testing — Engineering" },
  "40-411": { sectionNumber: "40", sectionName: "Machine Testing", functionGroup: "Shop", task: "Builder and Electricians", department: "Machine Testing — Shop" },

  // ── Teardown and Install (50) ────────────────────────────────────────────────
  "50-211": { sectionNumber: "50", sectionName: "Teardown and Install", functionGroup: "Engineering", task: "ME and CE", department: "Teardown & Install — Engineering" },
  "50-411": { sectionNumber: "50", sectionName: "Teardown and Install", functionGroup: "Shop", task: "Builder and Electricians", department: "Teardown & Install — Shop" },

  // ── Warranty (70) ────────────────────────────────────────────────────────────
  "70-211": { sectionNumber: "70", sectionName: "Warranty", functionGroup: "Engineering", task: "ME and CE", department: "Warranty — Engineering" },
  "70-411": { sectionNumber: "70", sectionName: "Warranty", functionGroup: "Shop", task: "Builder and Electricians", department: "Warranty — Shop" },

  // ── Service (80) — real codes read off the live Paylocity export, 2026-08-17 ─
  // 112/211/311/313/516 are all engineering-shaped functions with no per-function
  // breakout requested for this phase, so they roll onto one Engineering/"ME and
  // CE" task, the same many-to-one shape 10-413/10-414 already uses for
  // Manufacturing. 411/412/414 roll onto Shop/"Builder and Electricians" likewise.
  "80-112": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE", department: "Service — Engineering" },
  "80-211": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE", department: "Service — Engineering" },
  "80-311": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE", department: "Service — Engineering" },
  "80-313": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE", department: "Service — Engineering" },
  "80-516": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE", department: "Service — Engineering" },
  "80-411": { sectionNumber: "80", sectionName: "Service", functionGroup: "Shop", task: "Builder and Electricians", department: "Service — Shop" },
  "80-412": { sectionNumber: "80", sectionName: "Service", functionGroup: "Shop", task: "Builder and Electricians", department: "Service — Shop" },
  "80-414": { sectionNumber: "80", sectionName: "Service", functionGroup: "Shop", task: "Builder and Electricians", department: "Service — Shop" },

  // ── Spare Parts (90) ─────────────────────────────────────────────────────────
  // sectionName/functionGroup stay flat here (no Engineering/Shop split), per
  // the original request for this section. `department` DOES split it —
  // 2026-08-17, by explicit request ("apply the same standard structure for
  // Sections 70, 80 and 90") — so this is the one tier where Spare Parts reads
  // differently depending on which dimension you picked; that's intentional,
  // not a drift between the two.
  "90-211": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "ME and CE", department: "Spare Parts — Engineering" },
  "90-311": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "ME and CE", department: "Spare Parts — Engineering" },
  "90-411": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "Builder and Electricians", department: "Spare Parts — Shop" },
  "90-412": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "Builder and Electricians", department: "Spare Parts — Shop" },
  "90-414": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "Manufacturing", department: "Spare Parts — Shop" },
};

export function sectionNumberAndName(code: string): { sectionNumber: string; sectionName: string } {
  const e = OPERATIONAL_GROUPING[code];
  return e ? { sectionNumber: e.sectionNumber, sectionName: e.sectionName } : { sectionNumber: UNDEFINED_LABEL, sectionName: UNDEFINED_LABEL };
}

export function functionGroupFor(code: string): string {
  return OPERATIONAL_GROUPING[code]?.functionGroup ?? UNDEFINED_LABEL;
}

export function taskFor(code: string): string {
  return OPERATIONAL_GROUPING[code]?.task ?? UNDEFINED_LABEL;
}

// The Hours tab's "Group By: Department" — see OperationalEntry.department's
// own comment for why this is a distinct tier from `functionGroup`, not an
// alias for it. This is the ONLY thing "Department" is allowed to mean for
// that Group By dimension — never `Employee.department` (the HR/Paylocity
// field), which stays available as its own, separate FILTER
// (HoursFilters.departments / getHoursFilterOptions) and nothing else. A
// second grouping path built on that field is exactly how this regressed
// once already (2026-08-17).
export function departmentFor(code: string): string {
  return OPERATIONAL_GROUPING[code]?.department ?? UNDEFINED_LABEL;
}

// ── Reverse lookups, for narrowing a group-by tree node ─────────────────────────
//
// Built once at module load. "sectionName" narrows on sectionNumber (the stable
// key — two sections could in principle share a display name; numbers can't
// collide), "functionGroup"/"task"/"department" narrow on the label itself,
// deliberately spanning every section that uses it (e.g. "Engineering" rolls up
// Machine Testing + Teardown + Warranty + Service together when Function Group
// is picked with nothing narrower above it) — which is exactly what lets "how
// many total Engineering hours across every phase" be answered by picking one
// dimension alone.
function buildReverseIndex<K extends keyof OperationalEntry>(key: K): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [code, entry] of Object.entries(OPERATIONAL_GROUPING)) {
    const value = entry[key];
    const codes = index.get(value) ?? [];
    codes.push(code);
    index.set(value, codes);
  }
  return index;
}

const CODES_BY_SECTION_NUMBER = buildReverseIndex("sectionNumber");
const CODES_BY_FUNCTION_GROUP = buildReverseIndex("functionGroup");
const CODES_BY_TASK = buildReverseIndex("task");
const CODES_BY_DEPARTMENT = buildReverseIndex("department");

export function codesInSection(sectionNumber: string): string[] {
  return CODES_BY_SECTION_NUMBER.get(sectionNumber) ?? [];
}

export function codesInFunctionGroup(functionGroup: string): string[] {
  return CODES_BY_FUNCTION_GROUP.get(functionGroup) ?? [];
}

export function codesInTask(task: string): string[] {
  return CODES_BY_TASK.get(task) ?? [];
}

export function codesInDepartment(department: string): string[] {
  return CODES_BY_DEPARTMENT.get(department) ?? [];
}

// ── Fixed business order for "Group By: Department" (2026-08-17) ───────────
//
// Not sorted by hours, not alphabetical — the same left-to-right reading
// order as the "Estimate to Complete" reference sheet's own layout: each
// Section 10 function group in its column order (PM, ME, CE, General
// Engineering, then Shop split into its three trades), then each later
// phase in sequence, Engineering before Shop within a phase, ending with
// Spare Parts. `UNDEFINED_LABEL` is deliberately absent from this list — see
// `departmentOrderRank` below — so it always sorts after every real
// department, never accidentally slotted in the middle by an edit here.
export const DEPARTMENT_ORDER: string[] = [
  "Project Management",
  "Mechanical Engineering",
  "Controls Engineering",
  "General Engineering",
  "Mechanical Build",
  "Electrical Build",
  "Manufacturing Operations",
  "Machine Testing — Engineering",
  "Machine Testing — Shop",
  "Teardown & Install — Engineering",
  "Teardown & Install — Shop",
  "Warranty — Engineering",
  "Warranty — Shop",
  "Service — Engineering",
  "Service — Shop",
  "Spare Parts — Engineering",
  "Spare Parts — Shop",
];

const DEPARTMENT_RANK = new Map(DEPARTMENT_ORDER.map((d, i) => [d, i]));

// A department NOT in the fixed list — today that's only `UNDEFINED_LABEL`,
// since every real code the app imports resolves to one of the 17 above —
// ranks after all of them, so it reads at the bottom of any department-
// ordered list without needing its own special-cased position in the array.
export function departmentOrderRank(department: string): number {
  return DEPARTMENT_RANK.get(department) ?? Number.MAX_SAFE_INTEGER;
}
