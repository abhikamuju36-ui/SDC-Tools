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
};

export const UNDEFINED_LABEL = "Undefined / Unmapped";

export const OPERATIONAL_GROUPING: Record<string, OperationalEntry> = {
  // ── Complete Design and Build (10) ──────────────────────────────────────────
  "10-111": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "PM", task: "Project Management" },
  "10-211": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "ME", task: "Machine Design" },
  "10-312": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "CE", task: "Design and Drawings" },
  "10-313": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "CE", task: "Software" },
  "10-515": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "HMI" },
  "10-516": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "Robot" },
  "10-517": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "Vision" },
  "10-518": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "General Engineering", task: "Database and Device" },
  "10-411": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "Shop", task: "Mechanical Build" },
  "10-412": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "Shop", task: "Panel Build" },
  "10-413": { sectionNumber: "10", sectionName: "Complete Design and Build", functionGroup: "Shop", task: "Manufacturing" },

  // ── Machine Testing (40) ─────────────────────────────────────────────────────
  "40-211": { sectionNumber: "40", sectionName: "Machine Testing", functionGroup: "Engineering", task: "ME and CE" },
  "40-411": { sectionNumber: "40", sectionName: "Machine Testing", functionGroup: "Shop", task: "Builder and Electricians" },

  // ── Teardown and Install (50) ────────────────────────────────────────────────
  "50-211": { sectionNumber: "50", sectionName: "Teardown and Install", functionGroup: "Engineering", task: "ME and CE" },
  "50-411": { sectionNumber: "50", sectionName: "Teardown and Install", functionGroup: "Shop", task: "Builder and Electricians" },

  // ── Warranty (70) ────────────────────────────────────────────────────────────
  "70-211": { sectionNumber: "70", sectionName: "Warranty", functionGroup: "Engineering", task: "ME and CE" },
  "70-411": { sectionNumber: "70", sectionName: "Warranty", functionGroup: "Shop", task: "Builder and Electricians" },

  // ── Service (80) — real codes read off the live Paylocity export, 2026-08-17 ─
  // 112/211/311/313/516 are all engineering-shaped functions with no per-function
  // breakout requested for this phase, so they roll onto one Engineering/"ME and
  // CE" task, the same many-to-one shape 10-413/10-414 already uses for
  // Manufacturing. 411/412/414 roll onto Shop/"Builder and Electricians" likewise.
  "80-112": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE" },
  "80-211": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE" },
  "80-311": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE" },
  "80-313": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE" },
  "80-516": { sectionNumber: "80", sectionName: "Service", functionGroup: "Engineering", task: "ME and CE" },
  "80-411": { sectionNumber: "80", sectionName: "Service", functionGroup: "Shop", task: "Builder and Electricians" },
  "80-412": { sectionNumber: "80", sectionName: "Service", functionGroup: "Shop", task: "Builder and Electricians" },
  "80-414": { sectionNumber: "80", sectionName: "Service", functionGroup: "Shop", task: "Builder and Electricians" },

  // ── Spare Parts (90) — kept flat, no Engineering/Shop split, per request ─────
  // Function Group mirrors the section itself; Task still distinguishes what the
  // hours actually were, using the same task vocabulary as the other phases so a
  // report reading "ME and CE" or "Manufacturing" means the same thing everywhere.
  "90-211": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "ME and CE" },
  "90-311": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "ME and CE" },
  "90-411": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "Builder and Electricians" },
  "90-412": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "Builder and Electricians" },
  "90-414": { sectionNumber: "90", sectionName: "Spare parts", functionGroup: "Spare parts", task: "Manufacturing" },
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

// ── Reverse lookups, for narrowing a group-by tree node ─────────────────────────
//
// Built once at module load. "sectionName" narrows on sectionNumber (the stable
// key — two sections could in principle share a display name; numbers can't
// collide), "functionGroup"/"task" narrow on the label itself, deliberately
// spanning every section that uses it (e.g. "Engineering" rolls up Machine
// Testing + Teardown + Warranty + Service together when picked with nothing above
// it in the group-by order) — the same flat-label rollup `department` already
// does, and exactly what lets "how many total Engineering hours across every
// phase" be answered by picking Function Group alone.
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

export function codesInSection(sectionNumber: string): string[] {
  return CODES_BY_SECTION_NUMBER.get(sectionNumber) ?? [];
}

export function codesInFunctionGroup(functionGroup: string): string[] {
  return CODES_BY_FUNCTION_GROUP.get(functionGroup) ?? [];
}

export function codesInTask(task: string): string[] {
  return CODES_BY_TASK.get(task) ?? [];
}
