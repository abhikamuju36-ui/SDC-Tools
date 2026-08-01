// The seven delivery teams, in the order the work moves through them —
// PM → ME → CE → Build → Wire → MFG → Service. That sequence is the point: it's
// how the shop actually runs, and it's the same spine as the ETC grid's phase
// bands, so the roster now reads in the same order as everything else here.
//
// Employee.department is a Paylocity string and doesn't map one-to-one onto a
// team: PM arrives under two different names, and Build/Wire/MFG each have a
// legacy spelling still attached to people who've left. Grouping by the raw
// department produced a card per spelling — the same team twice, which is a
// filing artefact, not something anyone works with.
//
// So each team owns a list of department strings. A department NOT listed here
// keeps its own card at the end (Finance, Sales, Executive Leadership and the
// rest — real departments, just not delivery teams), rather than being swept
// into an "Other" bucket that would hide who's in them.

// One brand color per team, straight off the SDC Brand Guide's palette sheet —
// Primary Blue, Dark Navy, Light Blue, Yellow, Green, Lime, Gray, with Black
// held back for the non-delivery departments. All eight already exist as tokens
// in globals.css, so nothing new is invented here.
//
// The color rides the card's header band only; the roster itself stays on white,
// which is the one thing that keeps eight differently-coloured cards readable as
// a set. `onBand` is picked for contrast against that band, not by whether the
// color feels dark: white on #74C415 green is 2.4:1 and fails outright, so green
// and lime take navy text like the pale colors do.
export type CardTheme = {
  band: string; // header background
  onBand: string; // header text
  chip: string; // the short-code chip sitting on the band
};

export type EmployeeTeam = {
  // Short code, the vocabulary used on the floor and in the ETC grid's column
  // bands (see GROUP_FULL_NAME in quoted/page.tsx).
  code: string;
  name: string;
  departments: string[];
  // Fallback for the 28 people carrying no department at all — every one of
  // them inactive, so they only surface under "Show inactive". Without this
  // they'd all pile into a single "No department" card; their discipline still
  // says which team they were on.
  disciplines: string[];
  theme: CardTheme;
};

const ON_DARK = { onBand: "text-white", chip: "bg-white/20 text-white" };
const ON_LIGHT = { onBand: "text-sdc-navy", chip: "bg-white/70 text-sdc-navy" };

// Everything that isn't one of the seven — Finance, Sales, Executive
// Leadership… — takes the palette's Black, so the delivery teams keep the color.
export const OTHER_THEME: CardTheme = { band: "bg-sdc-gray-700", ...ON_DARK };

export const EMPLOYEE_TEAMS: EmployeeTeam[] = [
  {
    code: "PM",
    name: "Project Management",
    departments: ["Project Management", "Project Execution / Project Management"],
    disciplines: ["Project Management"],
    theme: { band: "bg-sdc-blue", ...ON_DARK }, // Primary Blue
  },
  { code: "ME", name: "Mechanical Engineering", departments: ["Mechanical Engineering"], disciplines: ["Mechanical Engineers"], theme: { band: "bg-sdc-navy", ...ON_DARK } }, // Dark Navy
  {
    code: "CE",
    name: "Controls Engineering",
    // Electrical Engineering is one departed person; controls is where that
    // work lives today.
    departments: ["Controls Engineering", "Electrical Engineering"],
    disciplines: ["Controls Engineers"],
    theme: { band: "bg-sdc-blue-100", ...ON_LIGHT }, // Light Blue
  },
  {
    code: "Build",
    name: "Mechanical Build",
    departments: ["Mechanical Build / Manufacturing", "Mechanical Build"],
    disciplines: ["Builders"],
    theme: { band: "bg-sdc-yellow", ...ON_LIGHT }, // Yellow
  },
  { code: "Wire", name: "Electrical Build", departments: ["Electrical Build", "Machine Wiring"], disciplines: ["Electricians"], theme: { band: "bg-sdc-green", ...ON_LIGHT } }, // Green
  {
    code: "MFG",
    name: "Manufacturing Operations",
    departments: ["Manufacturing Operations", "Manufacturing"],
    disciplines: ["Manufacturing Operations"],
    theme: { band: "bg-sdc-lime", ...ON_LIGHT }, // Lime Green
  },
  { code: "Service", name: "Service Engineering", departments: ["Service Engineering", "Service"], disciplines: ["Service Engineering"], theme: { band: "bg-sdc-border", ...ON_LIGHT } }, // Gray
];

// Built once from the table above rather than hand-maintained alongside it.
const TEAM_BY_DEPARTMENT = new Map<string, EmployeeTeam>();
const TEAM_BY_DISCIPLINE = new Map<string, EmployeeTeam>();
for (const team of EMPLOYEE_TEAMS) {
  for (const d of team.departments) TEAM_BY_DEPARTMENT.set(d.toLowerCase(), team);
  for (const d of team.disciplines) TEAM_BY_DISCIPLINE.set(d.toLowerCase(), team);
}

// Which team someone belongs to, or null for "not a delivery team" — the caller
// then falls back to grouping them under their own department name.
// Department wins over discipline: it's the Paylocity record of where someone
// actually sits, while discipline mirrors the Scheduler and can lag a move.
export function teamFor(employee: { department?: string | null; discipline?: string | null }): EmployeeTeam | null {
  const dept = employee.department?.trim().toLowerCase();
  if (dept) return TEAM_BY_DEPARTMENT.get(dept) ?? null;
  const discipline = employee.discipline?.trim().toLowerCase();
  if (discipline) return TEAM_BY_DISCIPLINE.get(discipline) ?? null;
  return null;
}
