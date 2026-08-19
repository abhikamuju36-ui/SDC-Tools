"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddEmployeeButton } from "@/components/AddEmployeeButton";
import type { SchedulerPlaceholder } from "@/lib/scheduler-db";
import { DISCIPLINE_LABEL } from "@/lib/disciplines";
import { buildDepartmentCards, type DepartmentCard } from "@/lib/employee-department-cards";
import { DASH, type EmployeeRow } from "@/lib/employee-row";
import type { HiringPosition } from "@/lib/hiring-positions";

export { DASH };
export type { EmployeeRow };

// The employee roster as one department card per team, matching the SDC
// Scheduler's own Departments board as closely as the two apps' data allows
// (2026-08-18, by request, third pass): colored header band, headcount strip,
// a lead star + specialty pulled LIVE and read-only from Scheduler's own
// team_members table (src/lib/employee-scheduler-overlay.ts — real columns,
// not decoration), a Placeholders section for Scheduler's own unfilled-seat
// stand-ins, and a working Add Member control that writes to BOTH apps (see
// employee-actions.ts's addTeamMember + scheduler-push.ts).
//
// Explicitly NOT reproduced: Scheduler's "N people · N hrs · N wks @ 90%"
// capacity line. That's Scheduler's own scheduling-engine forecast — nothing
// in Reports computes or stores it, and faking a number would be worse than
// not showing one. The header keeps Reports' own real "{N} active" count.
//
// Cards have no internal scroll — a card grows to whatever height its own
// roster needs, and the PAGE scrolls past a tall one. Uneven card heights
// (5-person Growth vs. 17-person Mechanical Engineering) are laid out with a
// CSS multi-column flow, not a grid: a plain grid sizes every ROW to its
// tallest card, which stranded short cards under a large dead gap whenever
// they shared a row with a much taller one (found live, 2026-08-18). Columns
// fill top-to-bottom and wrap independently, so that gap can't happen.
//
// `DASH`/`EmployeeRow` live in lib/employee-row.ts and the card-building
// itself in lib/employee-department-cards.ts (2026-08-19) — both pulled out
// of this file once the new workforce-group summary level needed the exact
// same row shape and the exact same card list (for its department line items
// and counts) without a second, driftable copy of either. Re-exported below
// so every existing `from "@/components/EmployeesCards"` import keeps working.

// Title/discipline, whichever adds information — showing the card's own
// department name again under every row inside it would just repeat the
// header, so a person's discipline is only printed when it says something
// their card doesn't already.
function roleOf(r: EmployeeRow, cardTitle: string): string {
  if (r.positionTitle !== DASH) return r.positionTitle;
  if (r.discipline !== DASH && r.discipline !== cardTitle) return r.discipline;
  return DASH;
}

export function EmployeesCards({
  rows,
  placeholders,
  canAddEmployees,
  onSelectEmployee,
  onSelectDepartment,
  hiringPositions,
  onSelectHiringPosition,
}: {
  rows: EmployeeRow[];
  placeholders: SchedulerPlaceholder[];
  canAddEmployees: boolean;
  /** Opens the Level 3 employee-detail drawer. Omitted entirely, the roster renders read-only exactly as before. */
  onSelectEmployee?: (row: EmployeeRow) => void;
  /** Drills from "all of this workforce group's departments" down to just this one card's department — see WorkforceSummaryCards.tsx for the level above this. */
  onSelectDepartment?: (card: DepartmentCard) => void;
  /** Open positions (2026-08-19) — matched to a card by `position.department === card.key`. Omitted entirely, cards render exactly as before hiring existed. */
  hiringPositions?: HiringPosition[];
  onSelectHiringPosition?: (position: HiringPosition) => void;
}) {
  const cards = useMemo(() => buildDepartmentCards(rows, placeholders), [rows, placeholders]);
  const hiringByDepartment = useMemo(() => {
    const m = new Map<string, HiringPosition[]>();
    for (const p of hiringPositions ?? []) {
      if (!p.department) continue;
      const list = m.get(p.department);
      if (list) list.push(p);
      else m.set(p.department, [p]);
    }
    return m;
  }, [hiringPositions]);

  const total = cards.reduce((s, c) => s + c.people.length, 0);

  if (total === 0) {
    return <EmptyState title="No employees match" message="Try clearing a filter or search term." />;
  }

  return (
    <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
      {cards.map((card) => {
        const activeCount = card.people.filter((p) => p.active).length;
        const inactiveCount = card.people.length - activeCount;
        const cardHiring = hiringByDepartment.get(card.key) ?? [];
        const plannedCount = activeCount + cardHiring.length;
        return (
          <section key={card.key} className="mb-4 flex flex-col overflow-hidden rounded-xl border border-sdc-border bg-white shadow-sm break-inside-avoid-column">
            {onSelectDepartment ? (
              <button
                type="button"
                onClick={() => onSelectDepartment(card)}
                title={`Show only ${card.title}`}
                className="px-3.5 py-2.5 text-left motion-interactive hover:brightness-95"
                style={{ background: card.colors.bg, color: card.colors.text }}
              >
                <h3 className="truncate text-sm font-bold">{card.title}</h3>
              </button>
            ) : (
              <header className="px-3.5 py-2.5" style={{ background: card.colors.bg, color: card.colors.text }}>
                <h3 className="truncate text-sm font-bold">{card.title}</h3>
              </header>
            )}
            <div className="flex items-baseline gap-1.5 border-b border-sdc-border bg-sdc-gray-50 px-3.5 py-1.5 text-xs text-sdc-muted">
              <span className="font-bold tabular-nums text-sdc-navy">{activeCount}</span>
              <span>active</span>
              {inactiveCount > 0 && (
                <>
                  <span className="text-sdc-gray-400">·</span>
                  <span className="font-bold tabular-nums text-sdc-navy">{inactiveCount}</span>
                  <span>inactive</span>
                </>
              )}
              {cardHiring.length > 0 && (
                <>
                  <span className="text-sdc-gray-400">·</span>
                  <span className="font-bold tabular-nums text-sdc-green-text">{cardHiring.length}</span>
                  <span>hiring</span>
                  <span className="text-sdc-gray-400">·</span>
                  <span className="font-bold tabular-nums text-sdc-navy">{plannedCount}</span>
                  <span>planned</span>
                </>
              )}
            </div>
            <ul className="min-h-[72px] p-1.5">
              {card.people.map((p) => {
                const role = roleOf(p, card.title);
                return (
                  <li
                    key={p.id}
                    title={`${p.name} — ${role === DASH ? "no title/discipline on file" : role}, reports to ${p.supervisor}, ${p.department?.trim() || DASH}`}
                    onClick={onSelectEmployee ? () => onSelectEmployee(p) : undefined}
                    onKeyDown={
                      onSelectEmployee
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectEmployee(p);
                            }
                          }
                        : undefined
                    }
                    role={onSelectEmployee ? "button" : undefined}
                    tabIndex={onSelectEmployee ? 0 : undefined}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-sdc-blue-light/40 ${onSelectEmployee ? "cursor-pointer" : ""} ${p.active ? "" : "opacity-70"}`}
                  >
                    {p.isLead && (
                      <span className="shrink-0 text-sm text-sdc-yellow" title="Department lead" aria-hidden>
                        ★
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm font-medium ${p.isLead ? "font-bold" : ""} ${p.active ? "text-sdc-navy" : "text-sdc-muted"}`}>{p.name}</div>
                      {role !== DASH && <div className="truncate text-xs text-sdc-muted">{role}</div>}
                    </div>
                    {p.specialty && (
                      <span className="shrink-0 truncate rounded-full border border-sdc-border px-2 py-0.5 text-label text-sdc-muted" title={`Level / specialty: ${p.specialty}`}>
                        {p.specialty}
                      </span>
                    )}
                    {!p.active && (
                      <span className="shrink-0 rounded-full bg-sdc-gray-100 px-1.5 py-0.5 text-label font-semibold uppercase tracking-wide text-sdc-muted">
                        Inactive
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Hiring — open positions from the Excel workbook, assigned to
                this exact department (hiring-positions.ts). Deliberately its
                own section, never merged into the `<ul>` of real people
                above — the task's own "do not mix open positions into the
                actual employee list as if they are employees". */}
            {cardHiring.length > 0 && (
              <>
                <div className="border-t border-dashed border-sdc-border px-3 pt-1.5 text-label font-bold uppercase tracking-wider text-sdc-green-text">
                  Hiring
                </div>
                <ul className="px-1.5 pb-1">
                  {cardHiring.map((p) => (
                    <li key={p.sourceId}>
                      <button
                        type="button"
                        onClick={onSelectHiringPosition ? () => onSelectHiringPosition(p) : undefined}
                        disabled={!onSelectHiringPosition}
                        className="w-full truncate rounded-md border-l-2 border-sdc-green px-2 py-1.5 text-left text-sm text-sdc-navy hover:bg-sdc-blue-light/40 disabled:cursor-default disabled:hover:bg-transparent"
                        title={p.title}
                      >
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {/* Placeholders — Scheduler's own unfilled-seat stand-ins, shown
                read-only exactly where Scheduler shows them: a labeled
                stripe below the real members, dashed/italic so they read as
                a role marker rather than a person. */}
            {card.placeholders.length > 0 && (
              <>
                <div className="border-t border-dashed border-sdc-border px-3 pt-1.5 text-label font-bold uppercase tracking-wider text-sdc-muted">
                  Placeholders
                </div>
                <ul className="px-1.5 pb-1">
                  {card.placeholders.map((ph, i) => (
                    <li
                      key={`${ph.name}-${i}`}
                      className="truncate rounded-md border-l-2 border-dashed border-sdc-border-soft bg-sdc-gray-50 px-2 py-1.5 text-sm italic text-sdc-muted"
                    >
                      {ph.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {/* Only offered where it can actually work — a card whose key
                isn't a real Scheduler discipline code (a raw department
                string, or the "No department" catch-all) has nowhere valid
                to add a team_members row, so addTeamMember would just refuse
                it. Same set Scheduler's own board can add to. */}
            {canAddEmployees && card.key in DISCIPLINE_LABEL && <AddEmployeeButton disciplineCode={card.key} />}
          </section>
        );
      })}
    </div>
  );
}
