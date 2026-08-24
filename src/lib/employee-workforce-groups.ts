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

export type WorkforceGroupKey =
  | "engineering"
  | "shop"
  | "pm"
  | "growth"
  | "finance"
  | "exec"
  | "operations"
  | "other";

export type WorkforceGroupDef = {
  key: WorkforceGroupKey;
  title: string;
  /** Spelled-out name, for the in-place group header only ("PM" the card, "Project Management" the heading above its departments). Defaults to `title`. */
  longTitle?: string;
  // employee-teams.ts's `schedulerCode` values that belong to this group.
  // "other" has none listed — it is whatever no other group claims.
  teamCodes: string[];
  /**
   * Card keys that are NOT delivery-team scheduler codes (2026-08-24).
   *
   * The four groups added below are back-office departments, which by
   * definition have no `schedulerCode` — Scheduler doesn't schedule work
   * through them, so employee-teams.ts has no entry for them and
   * resolveEmployeeGroup() gives their cards a raw key instead
   * ("growth", "sales", "finance", "exec", "operations"). Kept as a separate
   * field from `teamCodes` so the existing "no team code is claimed by two
   * groups" invariant still means what it says, and so it stays obvious which
   * keys are Scheduler's vocabulary and which are this app's own.
   */
  cardKeys?: string[];
};

// ── The company's departments, as seven cards (2026-08-24, by request) ──────
//
// Was Engineering / Shop / PM + an "Other" catch-all that swept Growth,
// Sales, Finance and Executive Leadership together, and hid Operations
// entirely (employee-card-theme.ts's HIDDEN_DEPARTMENT_CARDS returned null for
// it, so that person appeared on no card at all). Every real department now has
// its own card, and the mapping below is the requested one exactly.
//
// Two rules from the request worth stating here, because both are the opposite
// of what the department names suggest:
//   * Service Engineering does NOT get its own card — it counts under
//     Engineering (team code "service").
//   * Manufacturing Operations does NOT get its own card, and is NOT the same
//     thing as Operations — it counts under Shop (team code "mfgops"), while
//     "Operations" is a separate one-person back-office department with its
//     own card.
//
// Sales is likewise not a card at this level: it is a DEPARTMENT card one level
// down, inside Growth / Business Development, which is where the request puts
// it. So Growth's card claims two card keys, "growth" (which
// employee-card-theme.ts already folds "Growth / Business Development" and
// "Business Development" into) and "sales".
//
// Counts these produce against the roster of 2026-08-24 — asserted in
// tests/employee-workforce-groups.test.ts so a mapping change that moves
// somebody fails there rather than silently on screen:
//   Engineering 27 · Shop 29 · PM 4 · Growth 9 · Finance 4 · Exec 5 · Operations 1
export const WORKFORCE_GROUPS: WorkforceGroupDef[] = [
  { key: "engineering", title: "Engineering", teamCodes: ["mech", "controls", "service"] },
  { key: "shop", title: "Shop", teamCodes: ["build", "wire", "mfgops"] },
  { key: "pm", title: "PM", longTitle: "Project Management", teamCodes: ["pm"] },
  { key: "growth", title: "Growth / Business Development", teamCodes: [], cardKeys: ["growth", "sales"] },
  { key: "finance", title: "Finance", teamCodes: [], cardKeys: ["finance"] },
  { key: "exec", title: "Executive Leadership", teamCodes: [], cardKeys: ["exec"] },
  { key: "operations", title: "Operations", teamCodes: [], cardKeys: ["operations"] },
  // Still last, and still a real destination: a department string nobody has
  // mapped yet (a new Paylocity department, say) must land SOMEWHERE, or the
  // people in it would vanish from the tab. It renders no card when empty —
  // see WorkforceSummaryCards' own filter — so on today's data it is invisible.
  { key: "other", title: "Other", teamCodes: [] },
];

const GROUP_BY_CARD_KEY = new Map<string, WorkforceGroupKey>();
for (const g of WORKFORCE_GROUPS) {
  for (const code of g.teamCodes) GROUP_BY_CARD_KEY.set(code, g.key);
  for (const code of g.cardKeys ?? []) GROUP_BY_CARD_KEY.set(code.toLowerCase(), g.key);
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
  // Team codes are already lowercase by construction; the non-team card keys
  // are matched case-insensitively for the same reason employee-teams.ts
  // matches its department strings that way — they originate in Paylocity
  // data, not in code.
  return GROUP_BY_CARD_KEY.get(cardKey) ?? GROUP_BY_CARD_KEY.get(cardKey.toLowerCase()) ?? "other";
}

export function workforceGroupTitle(key: WorkforceGroupKey): string {
  return WORKFORCE_GROUPS.find((g) => g.key === key)?.title ?? "Other";
}

/**
 * The group heading shown above its departments once a workforce card is
 * opened in place. Same string as workforceGroupTitle() for every group but
 * PM, whose card abbreviation reads oddly as a section heading.
 */
export function workforceGroupLongTitle(key: WorkforceGroupKey): string {
  const def = WORKFORCE_GROUPS.find((g) => g.key === key);
  return def?.longTitle ?? def?.title ?? "Other";
}
