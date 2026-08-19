// The Employees tab's top-level grouping (2026-08-19, by request): three
// workforce categories sitting ABOVE the existing seven delivery-team
// department cards — Engineering / Shop / PM — plus a catch-all "Other" for
// everything a department card already covers today that isn't one of those
// three (Growth, Finance, Sales, Executive Leadership, and any raw department
// string with no team at all). Nothing here reads an employee directly: it
// only classifies a department CARD's own key (employee-card-theme.ts's
// `EmployeeGroup.key` — a team's `schedulerCode`, or a raw department/"Other"
// key for anything else) into one of the four buckets, so there is exactly
// one department→card resolution in the app (resolveEmployeeGroup) and this
// is purely a second, coarser tier over its output — never a second
// classification of the same employee.

export type WorkforceGroupKey = "engineering" | "shop" | "pm" | "other";

export type WorkforceGroupDef = {
  key: WorkforceGroupKey;
  title: string;
  // employee-teams.ts's `schedulerCode` values that belong to this group.
  // "other" has none listed — it is whatever no other group claims.
  teamCodes: string[];
};

export const WORKFORCE_GROUPS: WorkforceGroupDef[] = [
  { key: "engineering", title: "Engineering", teamCodes: ["mech", "controls", "service"] },
  { key: "shop", title: "Shop", teamCodes: ["build", "wire", "mfgops"] },
  { key: "pm", title: "PM", teamCodes: ["pm"] },
  { key: "other", title: "Other", teamCodes: [] },
];

const GROUP_BY_TEAM_CODE = new Map<string, WorkforceGroupKey>();
for (const g of WORKFORCE_GROUPS) {
  for (const code of g.teamCodes) GROUP_BY_TEAM_CODE.set(code, g.key);
}

/**
 * Which workforce group a department CARD belongs to, by the card's own key
 * (resolveEmployeeGroup()'s output — a team's schedulerCode for one of the
 * seven delivery teams, or a raw department/"growth"/"finance"/... key for
 * everything else). Anything not one of the nine listed team codes falls to
 * "other" — this is the one place that catch-all is decided, so a department
 * newly added to employee-teams.ts automatically lands in the right
 * workforce group the moment its schedulerCode is added to WORKFORCE_GROUPS
 * above, with no second lookup table to keep in sync.
 */
export function workforceGroupForCardKey(cardKey: string): WorkforceGroupKey {
  return GROUP_BY_TEAM_CODE.get(cardKey) ?? "other";
}

export function workforceGroupTitle(key: WorkforceGroupKey): string {
  return WORKFORCE_GROUPS.find((g) => g.key === key)?.title ?? "Other";
}
