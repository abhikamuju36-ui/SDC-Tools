"use client";

import { useMemo, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { buildDepartmentCards, type DepartmentCard } from "@/lib/employee-department-cards";
import { WORKFORCE_GROUPS, workforceGroupForCardKey, type WorkforceGroupKey } from "@/lib/employee-workforce-groups";
import type { EmployeeRow } from "@/lib/employee-row";
import type { SchedulerPlaceholder } from "@/lib/scheduler-db";
import type { HiringPosition } from "@/lib/hiring-positions";
import { employeeCapacityHours, hiringCapacityHours } from "@/lib/workforce-capacity";
import { hasYearPolicy } from "@/lib/workforce-capacity-policy";
import { hours as fmtHours } from "@/components/ui/format";
import { countOpenings, openingsFor } from "@/lib/hiring-openings";

// Level 1 of the Employees tab: one card per company department — Engineering,
// Shop, PM, Growth / Business Development, Finance, Executive Leadership and
// Operations — plus the "Hiring Positions" card (2026-08-19) rendered
// separately from them.
//
// Was three cards (Engineering / Shop / PM) and an "Other" catch-all holding
// everything else; the four back-office groups were split out of that catch-all
// on 2026-08-24 by request. "other" still exists as the destination for an
// unmapped department string, but renders no card while it is empty, which it
// is on today's roster. The grouping itself lives in
// employee-workforce-groups.ts — this component only themes and orders it. Deliberately its OWN
// small color set, not employee-teams.ts's per-team brand colors (shared
// with Hours/ETC — not this screen's to repaint) and not
// employee-card-theme.ts's per-department pastels (those stay exactly as
// they are one level down, at DepartmentCard) — this is a level ABOVE both,
// so it gets a level of its own.
//
// Built from buildDepartmentCards() — the SAME function EmployeesCards.tsx
// calls — so a group's ACTIVE headcount here is a straight sum over the
// identical cards that level 2 will go on to render for it. Hiring counts
// are a SEPARATE tally over `hiringPositions` (never merged into `people` —
// the task's own "do not treat open positions as employees") — Planned is
// the one number that adds them back together, and only for display.
const WORKFORCE_THEME: Record<WorkforceGroupKey, { band: string; onBand: string }> = {
  engineering: { band: "bg-sdc-navy", onBand: "text-white" },
  shop: { band: "bg-sdc-yellow", onBand: "text-sdc-navy" },
  // Purple (2026-08-19, by request) -- --sdc-purple (globals.css) is the dark
  // half of the EXISTING Project Management purple already defined one level
  // down, in employee-card-theme.ts's CARD_COLORS.pm (matched to Scheduler's
  // own Departments board), reused here as a solid band instead of that
  // pastel card's light-bg/dark-text style, to match this level's other
  // bold-band cards. employee-teams.ts's own PM department color stays
  // --sdc-blue, unchanged -- that's a third, separate palette (see this
  // file's header comment on why the three levels don't share one).
  pm: { band: "bg-sdc-purple", onBand: "text-white" },
  // The four back-office groups (2026-08-24). All four bands come from the
  // palette tokens already in globals.css — nothing new invented, same rule
  // the three above follow.
  //
  // `onBand` is chosen for CONTRAST, not by whether the color feels dark: as
  // employee-teams.ts already measured, white on the palette's green is 2.4:1
  // and fails outright, so green and lime take navy text exactly as the pale
  // colors do. Blue and blue-dark are dark enough to carry white.
  growth: { band: "bg-sdc-blue", onBand: "text-white" },
  finance: { band: "bg-sdc-green", onBand: "text-sdc-navy" },
  exec: { band: "bg-sdc-blue-dark", onBand: "text-white" },
  operations: { band: "bg-sdc-lime", onBand: "text-sdc-navy" },
  other: { band: "bg-sdc-gray-700", onBand: "text-white" },
};
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
const CARD_RENDER_ORDER: WorkforceGroupKey[] = [
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

function StatChip({ children }: { children: ReactNode }) {
  return <span>{children}</span>;
}

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
  onSelectGroup,
  onSelectDepartment,
  onSelectHiring,
  year,
  onSelectCapacity,
  expandedGroup,
}: {
  rows: EmployeeRow[];
  placeholders: SchedulerPlaceholder[];
  /** Already OPEN positions only — see EmployeesGrid.tsx's `openHiring` derivation off getHiringPositions(). */
  hiringPositions: HiringPosition[];
  /** Drills to "all of this workforce group's departments" (Level 2). */
  onSelectGroup: (key: WorkforceGroupKey) => void;
  /** Drills straight to one department (Level 2, pre-narrowed) — the "or one of its departments" half of the task's own click rule. */
  onSelectDepartment: (groupKey: WorkforceGroupKey, card: DepartmentCard) => void;
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
      const key = workforceGroupForCardKey(card.key);
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
  const hiringByDepartment = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of hiringPositions) {
      if (!p.department) continue;
      // openingsFor, not +1: a Quantity 2 position is two openings on this
      // department's line, not one (2026-08-24).
      m.set(p.department, (m.get(p.department) ?? 0) + openingsFor(p));
    }
    return m;
  }, [hiringPositions]);

  const hiringByGroup = useMemo(() => {
    const m = new Map<WorkforceGroupKey, number>();
    for (const p of hiringPositions) {
      if (!p.workforceGroup) continue;
      m.set(p.workforceGroup, (m.get(p.workforceGroup) ?? 0) + openingsFor(p));
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

      {/* Two regions, not one grid of four peers (2026-08-21): the real
          workforce on the left, open requisitions set apart on the right past
          a divider. Side by side from xl up; below xl the aside drops under a
          horizontal rule instead, so the separation survives every width. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:gap-5">
        <div className="min-w-0 flex-1">
          <RegionLabel>Current Workforce</RegionLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {summaries.map((group) => {
          const theme = WORKFORCE_THEME[group.key];
          const activeCount = group.cards.reduce((s, c) => s + c.people.filter((p) => p.active).length, 0);
          const inactiveCount = group.cards.reduce((s, c) => s + c.people.length, 0) - activeCount;
          const leadsCount = group.cards.reduce((s, c) => s + c.people.filter((p) => p.isLead).length, 0);
          const hiringCount = hiringByGroup.get(group.key) ?? 0;
          const plannedCount = activeCount + hiringCount;
          const groupPeople = group.cards.flatMap((c) => c.people.filter((p) => p.active));
          const groupHiring = hiringPositions.filter((p) => p.workforceGroup === group.key);
          const groupCurrentHours = hasCapacityPolicy ? employeeCapacityHours(activeCount, year) : 0;
          const groupHiringHours = hasCapacityPolicy ? hiringCapacityHours(groupHiring, year) : 0;
          const groupPlannedHours = groupCurrentHours + groupHiringHours;
          return (
            <section
              key={group.key}
              className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${
                expandedGroup === group.key ? "border-sdc-blue ring-2 ring-sdc-blue/40" : "border-sdc-border"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectGroup(group.key)}
                aria-expanded={expandedGroup === group.key}
                title={expandedGroup === group.key ? `Collapse ${group.title}` : `Show ${group.title}'s departments below`}
                className={`flex flex-col gap-1 px-4 py-3 text-left motion-interactive hover:brightness-95 ${theme.band} ${theme.onBand}`}
              >
                <h3 className="text-sm font-bold uppercase tracking-wide">{group.title}</h3>
                <div className="flex items-baseline gap-1 text-xs opacity-90">
                  <span className="text-lg font-bold tabular-nums">{activeCount}</span>
                  <span>active</span>
                  {hiringCount > 0 && (
                    <>
                      <span className="mx-0.5">·</span>
                      <span className="text-lg font-bold tabular-nums">{hiringCount}</span>
                      <span>hiring</span>
                      <span className="mx-0.5">·</span>
                      <span className="text-lg font-bold tabular-nums">{plannedCount}</span>
                      <span>planned</span>
                    </>
                  )}
                </div>
                <div className="flex items-baseline gap-2 text-xs opacity-90">
                  <StatChip>
                    {group.cards.length} department{group.cards.length === 1 ? "" : "s"}
                  </StatChip>
                  {leadsCount > 0 && <StatChip>★ {leadsCount}</StatChip>}
                  {inactiveCount > 0 && <StatChip>{inactiveCount} inactive</StatChip>}
                </div>
              </button>
              {hasCapacityPolicy && (
                <button
                  type="button"
                  onClick={() =>
                    onSelectCapacity({
                      title: `${group.title} — Capacity`,
                      employees: groupPeople,
                      hiringPositions: groupHiring,
                    })
                  }
                  title="See how this capacity total was built, by employee and open position"
                  className="flex items-baseline gap-1.5 border-b border-sdc-border-soft bg-sdc-gray-50 px-4 py-1.5 text-left text-xs text-sdc-muted hover:bg-sdc-blue-light/30"
                >
                  <span className="font-bold tabular-nums text-sdc-navy">{fmtHours(groupCurrentHours)}</span>
                  <span>current hrs/yr</span>
                  {groupHiringHours > 0 && (
                    <>
                      <span className="text-sdc-gray-400">·</span>
                      <span className="font-bold tabular-nums text-sdc-green-text">+{fmtHours(groupHiringHours)}</span>
                      <span>hiring</span>
                      <span className="text-sdc-gray-400">·</span>
                      <span className="font-bold tabular-nums text-sdc-navy">{fmtHours(groupPlannedHours)}</span>
                      <span>planned</span>
                    </>
                  )}
                </button>
              )}
              <ul className="flex-1 p-1.5">
                {group.cards.map((card) => {
                  const cardActive = card.people.filter((p) => p.active).length;
                  const cardHiring = hiringByDepartment.get(card.key) ?? 0;
                  return (
                    <li key={card.key}>
                      <button
                        type="button"
                        onClick={() => onSelectDepartment(group.key, card)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-sdc-blue-light/40"
                      >
                        <span className="min-w-0 truncate text-sdc-navy">{card.title}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-sdc-muted">
                          {cardActive}
                          {cardHiring > 0 && <span className="font-normal text-sdc-green-text"> + {cardHiring} hiring</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
          </div>
        </div>

        {openPositions > 0 && (
          <>
            {/* The divider itself: a vertical rule between the two regions on
                wide screens, a horizontal one when the aside wraps under. */}
            <div className="h-px w-full shrink-0 bg-sdc-border xl:h-auto xl:w-px xl:self-stretch" aria-hidden />
            <aside className="min-w-0 xl:w-64 xl:shrink-0">
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
                  {WORKFORCE_GROUPS.filter((g) => g.key !== "other").map((g) => {
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
