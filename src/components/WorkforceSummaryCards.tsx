"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildDepartmentCards, type DepartmentCard } from "@/lib/employee-department-cards";
import { WORKFORCE_GROUPS, workforceGroupForCardKey, rollupGroup, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import type { EmployeeRow } from "@/lib/employee-row";
import type { SchedulerPlaceholder } from "@/lib/scheduler-db";
import type { HiringPosition } from "@/lib/hiring-positions";
import { employeeCapacityHours, hiringCapacityHours } from "@/lib/workforce-capacity";
import { hasYearPolicy } from "@/lib/workforce-capacity-policy";
import { hours as fmtHours } from "@/components/ui/format";
import { countOpenings, openingsFor } from "@/lib/hiring-openings";
// Hiring is deliberately NOT given a solid color band like the workforce
// groups (2026-08-21): it isn't a group of people, it's a list of open
// requisitions, and a fourth solid band read as a fourth department. It uses
// this app's existing "open seat" language instead -- a DASHED border and
// green accents, the same visual grammar EmployeesCards already uses for its
// per-department Hiring and Placeholders sections.
const HIRING_ACCENT = "text-sdc-green-text";

// Card render order (2026-08-19, by request): PM, Engineering, Shop, then
// whatever's left (just "other," if it has any cards) -- Hiring Positions is
// rendered separately, always last, unaffected by this list. Deliberately
// NOT a reorder of WORKFORCE_GROUPS itself (employee-workforce-groups.ts) --
// that array also drives dropdown option order in HiringMoveToControl.tsx/
// CreateHiringPositionDrawer.tsx/HiringPositionDetailDrawer.tsx and the
// Hiring Positions card's own internal breakdown list, none of which this
// request asked to change. This is a display-order concern local to this
// component only.
// Delivery teams first, in the order the request listed them, then the
// back-office departments, then "other" (which renders nothing unless an
// unmapped department turns up — see the filter in `summaries`).
// "genEng" is deliberately ABSENT (2026-08-24): General Engineering rolls up
// into Engineering, whose card therefore already includes it
// ("Engineering Total = Engineering + General Engineering"). Giving it a card
// here as well would both fragment the Engineering view and double-count it in
// Open Positions / Planned Headcount. It stays visibly separate where the
// request asks for that — its own section in the Hiring Positions list, and its
// own option in the Create/Edit Position form.
export const CARD_RENDER_ORDER: WorkforceGroupKey[] = [
  "pm",
  "engineering",
  "shop",
  "growth",
  "finance",
  "exec",
  "operations",
  "other",
];

type WorkforceSummary = {
  key: WorkforceGroupKey;
  title: string;
  cards: DepartmentCard[];
};


// The small caps label over each region. Quiet on purpose -- it is there to
// say "these two things are different kinds of thing", not to compete with
// the cards' own headers.
function RegionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-label font-bold uppercase tracking-wider text-sdc-muted">{children}</div>;
}

export type CapacityDrillTarget = { title: string; subtitle?: string; employees: EmployeeRow[]; hiringPositions: HiringPosition[] };

export function WorkforceSummaryCards({
  rows,
  placeholders,
  hiringPositions,
  onSelectHiring,
  year,
  onSelectCapacity,
  expandedGroup,
}: {
  rows: EmployeeRow[];
  placeholders: SchedulerPlaceholder[];
  /** Already OPEN positions only — see EmployeesGrid.tsx's `openHiring` derivation off getHiringPositions(). */
  hiringPositions: HiringPosition[];
  /** Drills into the Hiring Positions list (Level 2 equivalent for that card). */
  onSelectHiring: () => void;
  /** For workforce-capacity-policy.ts/workforce-capacity.ts. */
  year: number;
  /** Opens the "how was this total built" drill (Level 3, a different question from onSelectGroup/onSelectDepartment's "who"). */
  onSelectCapacity: (target: CapacityDrillTarget) => void;
  /**
   * Which card is currently EXPANDED below this grid (2026-08-21) — a group
   * key, "hiring", or null. Purely the pressed/ringed state of the card that
   * opened the expansion; these cards render identically either way, since
   * the overview deliberately stays on screen while a group is open.
   */
  expandedGroup?: WorkforceGroupKey | "hiring" | null;
}) {
  const summaries = useMemo<WorkforceSummary[]>(() => {
    const cards = buildDepartmentCards(rows, placeholders);
    const byGroup = new Map<WorkforceGroupKey, DepartmentCard[]>();
    for (const card of cards) {
      // rollupGroup: a General Engineering department card belongs under the
      // Engineering card, not a card of its own.
      const key = rollupGroup(workforceGroupForCardKey(card.key));
      const list = byGroup.get(key);
      if (list) list.push(card);
      else byGroup.set(key, [card]);
    }
    const byKey = new Map(WORKFORCE_GROUPS.map((def) => [def.key, def]));
    return CARD_RENDER_ORDER.map((key) => {
      const def = byKey.get(key)!;
      return { key: def.key, title: def.title, cards: byGroup.get(def.key) ?? [] };
    }).filter(
      // An empty workforce group (everyone filtered out, or genuinely nobody
      // on it) shows nothing rather than a "0 employees" card with nowhere
      // useful to drill — matches EmployeesCards' own "no card for an empty
      // bucket" behavior one level down.
      (g) => g.cards.length > 0,
    );
  }, [rows, placeholders]);

  // Hiring counts, by department key and by group-only (assigned to a group
  // but no specific department yet — a valid, expected intermediate state
  // per the task's own two-step "group, then optionally deeper" assignment).

  const hiringByGroup = useMemo(() => {
    const m = new Map<WorkforceGroupKey, number>();
    for (const p of hiringPositions) {
      if (!p.workforceGroup) continue;
      // Credited to the ROLLUP group: a General Engineering opening counts
      // toward the Engineering card's hiring total.
      const key = rollupGroup(p.workforceGroup);
      m.set(key, (m.get(key) ?? 0) + openingsFor(p));
    }
    return m;
  }, [hiringPositions]);

  const unassignedHiring = countOpenings(hiringPositions.filter((p) => !p.workforceGroup));

  const activeHeadcount = summaries.reduce((s, g) => s + g.cards.reduce((s2, c) => s2 + c.people.filter((p) => p.active).length, 0), 0);
  // Openings, not rows — one Quantity 2 requisition is 2 open positions and
  // contributes 2 to Planned Headcount below.
  const openPositions = countOpenings(hiringPositions);
  const plannedHeadcount = activeHeadcount + openPositions;

  const total = activeHeadcount + summaries.reduce((s, g) => s + g.cards.reduce((s2, c) => s2 + c.people.filter((p) => !p.active).length, 0), 0);

  if (total === 0 && openPositions === 0) {
    return <EmptyState title="No employees match" message="Try clearing a filter or search term." />;
  }

  // Capacity hours (2026-08-19) — a SEPARATE figure from headcount above,
  // always labeled and never blended into it. Company-wide Current/Hiring
  // both include EVERY active employee/open position across every group, so
  // the drill-through for the header strip hands over the full flat lists,
  // not one card's.
  const hasCapacityPolicy = hasYearPolicy(year);
  const allActivePeople = summaries.flatMap((g) => g.cards.flatMap((c) => c.people.filter((p) => p.active)));
  const currentCapacityHours = hasCapacityPolicy ? employeeCapacityHours(activeHeadcount, year) : 0;
  const hiringCapacityHoursTotal = hasCapacityPolicy ? hiringCapacityHours(hiringPositions, year) : 0;
  const plannedCapacityHours = currentCapacityHours + hiringCapacityHoursTotal;

  return (
    <div className="flex flex-col gap-4">
      {/* Workforce-planning summary strip — company-wide, not affected by the
          Employees toolbar's own filters (those narrow WHO you're looking at;
          this answers "how big is the org, planned"). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-sdc-border bg-sdc-gray-50 px-4 py-2.5 text-sm">
        <span>
          <span className="font-bold tabular-nums text-sdc-navy">{activeHeadcount}</span>{" "}
          <span className="text-sdc-muted">Active Headcount</span>
        </span>
        <span>
          <span className="font-bold tabular-nums text-sdc-navy">{openPositions}</span> <span className="text-sdc-muted">Open Positions</span>
        </span>
        <span>
          <span className="font-bold tabular-nums text-sdc-navy">{plannedHeadcount}</span>{" "}
          <span className="text-sdc-muted">Planned Headcount</span>
        </span>
        {unassignedHiring > 0 && (
          <span>
            <span className="font-bold tabular-nums text-sdc-navy">{unassignedHiring}</span>{" "}
            <span className="text-sdc-muted">Unassigned Openings</span>
          </span>
        )}
        {hasCapacityPolicy && (
          <button
            type="button"
            onClick={() =>
              onSelectCapacity({
                title: "Company-Wide Capacity",
                employees: allActivePeople,
                hiringPositions,
              })
            }
            title="See how this capacity total was built, by employee and open position"
            className="flex items-baseline gap-x-2 rounded-md px-1 -mx-1 hover:bg-white"
          >
            <span className="font-bold tabular-nums text-sdc-navy">{fmtHours(currentCapacityHours)}</span>{" "}
            <span className="text-sdc-muted">current hrs/yr</span>
            {hiringCapacityHoursTotal > 0 && (
              <>
                <span className="text-sdc-gray-400">·</span>
                <span className="font-bold tabular-nums text-sdc-green-text">+{fmtHours(hiringCapacityHoursTotal)}</span>{" "}
                <span className="text-sdc-muted">hiring hrs/yr</span>
                <span className="text-sdc-gray-400">·</span>
                <span className="font-bold tabular-nums text-sdc-navy">{fmtHours(plannedCapacityHours)}</span>{" "}
                <span className="text-sdc-muted">planned hrs/yr</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* The per-group summary cards that used to sit here are gone (2026-08-24,
          by request): the fully expanded department cards below now show every
          group with its people, so a card per group above them was the same
          information twice.

          What is deliberately KEPT is everything those cards were not: the
          company-wide KPI strip above (headcount / open positions / planned /
          hrs-per-year, with its capacity drill-through) and the Planned aside
          below, neither of which the expanded sections carry.

          The aside is no longer half of a two-region row, so it is a plain block
          rather than a flex sibling — and it keeps its own width cap so it does
          not stretch across the page now that nothing sits beside it. */}
      <div>        {openPositions > 0 && (
          <>
            {/* No divider any more — it separated this aside from the summary
                cards that used to sit to its left. */}
            <aside className="min-w-0 max-w-xs">
              <RegionLabel>Planned</RegionLabel>
              <section
                className={`flex flex-col overflow-hidden rounded-xl border border-dashed bg-white ${
                  expandedGroup === "hiring" ? "border-sdc-blue ring-2 ring-sdc-blue/40" : "border-sdc-green"
                }`}
              >
                <button
                  type="button"
                  onClick={onSelectHiring}
                  aria-expanded={expandedGroup === "hiring"}
                  title={expandedGroup === "hiring" ? "Collapse hiring positions" : "Show all open hiring positions below"}
                  className={`flex flex-col gap-1 border-b border-dashed border-sdc-green bg-sdc-green-bg/50 px-4 py-3 text-left motion-interactive hover:brightness-95 ${HIRING_ACCENT}`}
                >
                  <h3 className="text-sm font-bold uppercase tracking-wide">Hiring Positions</h3>
                  <div className="flex items-baseline gap-1 text-xs">
                    <span className="text-lg font-bold tabular-nums">{openPositions}</span>
                    <span>open</span>
                  </div>
                  <span className="text-label text-sdc-muted">Not yet people — open requisitions</span>
                </button>
                {hasCapacityPolicy && (
                  <button
                    type="button"
                    onClick={() => onSelectCapacity({ title: "Hiring Positions — Capacity", employees: [], hiringPositions })}
                    title="See how this capacity total was built, by open position"
                    className="flex items-baseline gap-1.5 border-b border-dashed border-sdc-border bg-sdc-gray-50 px-4 py-1.5 text-left text-xs text-sdc-muted hover:bg-sdc-blue-light/30"
                  >
                    <span className="font-bold tabular-nums text-sdc-green-text">+{fmtHours(hiringCapacityHoursTotal)}</span>
                    <span>hiring hrs/yr</span>
                  </button>
                )}
                <ul className="flex-1 p-1.5">
                  {/* Rolled-up groups are skipped: their openings are credited
                      to the group they roll into, so a General Engineering row
                      here would always read 0 and imply there were none. */}
                  {WORKFORCE_GROUPS.filter((g) => g.key !== "other" && !g.rollsUpTo).map((g) => {
                    const count = hiringByGroup.get(g.key) ?? 0;
                    if (count === 0) return null;
                    return (
                      <li key={g.key} className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm">
                        <span className="min-w-0 truncate text-sdc-navy">{g.title}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-sdc-muted">{count}</span>
                      </li>
                    );
                  })}
                  {unassignedHiring > 0 && (
                    <li className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-sdc-navy">Unassigned</span>
                      <span className="shrink-0 font-semibold tabular-nums text-sdc-muted">{unassignedHiring}</span>
                    </li>
                  )}
                </ul>
              </section>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
