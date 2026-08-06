"use client";

import { useMemo } from "react";
import { EMPLOYEE_TEAMS, OTHER_THEME, teamFor, type CardTheme } from "@/lib/employee-teams";

// The employee roster, as one card per team.
//
// It was a single full-width table with a department band every dozen rows. On a
// wide screen that meant six narrow columns of text stretched across 1,900px,
// most of the row being empty — and the reading order was alphabetical by
// department, which is nobody's mental model of the place. Cards put the same
// people into a grid of uniform boxes, each in one brand color, in the order the
// work moves: PM → ME → CE → Build → Wire → MFG → Service. employee-teams.ts
// owns that order, the color each team carries, and the folding of duplicate
// Paylocity department spellings into one team.
//
// READ-ONLY. Name, discipline, supervisor and department all have upstream
// owners — discipline mirrors the SDC Scheduler's team_members, supervisors and
// the rest come from the Paylocity export — so an edit here is a local override
// the next sync may quietly undo. The roster is maintained through those imports
// and the toolbar's sync buttons instead. (If inline editing ever comes back,
// `updateEmployee` and `setEmployeeActive` are still there; it was the cells
// that were reverted, not the plumbing.)
export const DASH = "—"; // display value for "no discipline / no supervisor"

export type EmployeeRow = {
  id: number;
  name: string;
  discipline: string; // label or DASH
  supervisor: string; // supervisor name or DASH
  department: string;
  active: boolean;
  billingGroup: string;
  paylocityId: string;
};

const NO_DEPT = "No department"; // bucket for employees with no department AND no discipline

type Card = {
  key: string;
  code: string | null; // short team code; null for a plain department
  title: string;
  theme: CardTheme;
  people: EmployeeRow[];
};

// Every card is exactly this tall, whatever it holds — the brief was uniform
// cards, so the 13-person team and the 5-person one get the same box and the
// short ones simply carry space at the bottom. 24rem clears the largest team
// today (13 people) without scrolling; anything longer, which in practice means
// a card viewed with "Show inactive" on, scrolls inside its own list rather than
// stretching the row and breaking the alignment.
const CARD_HEIGHT = "h-[24rem]";

export function EmployeesTable({ rows }: { rows: EmployeeRow[] }) {
  const cards = useMemo(() => {
    // Seeded with all seven teams in work order, so they hold their positions
    // rather than appearing in whatever order the rows happen to arrive.
    const byKey = new Map<string, Card>(
      EMPLOYEE_TEAMS.map((t) => [
        t.code,
        { key: t.code, code: t.code, title: t.name, theme: t.theme, people: [] as EmployeeRow[] },
      ]),
    );
    const extras: string[] = []; // non-team departments, in first-seen order

    for (const r of rows) {
      const team = teamFor(r);
      const key = team ? team.code : r.department?.trim() && r.department !== DASH ? r.department.trim() : NO_DEPT;
      let card = byKey.get(key);
      if (!card) {
        card = { key, code: null, title: key, theme: OTHER_THEME, people: [] };
        byKey.set(key, card);
        extras.push(key);
      }
      card.people.push(r);
    }

    for (const card of byKey.values()) card.people.sort((a, b) => a.name.localeCompare(b.name));

    // Teams first, in work order; then everything else — real departments that
    // aren't delivery teams (Finance, Sales, Executive Leadership…) — A→Z, with
    // the no-department bucket last. Empty cards drop out, so a filtered view
    // doesn't leave seven headers with nothing under them.
    extras.sort((a, b) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)));
    return [...EMPLOYEE_TEAMS.map((t) => byKey.get(t.code)!), ...extras.map((k) => byKey.get(k)!)].filter(
      (c) => c.people.length > 0,
    );
  }, [rows]);

  const total = cards.reduce((s, c) => s + c.people.length, 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-sdc-border bg-white px-4 py-10 text-center text-sm text-sdc-gray-400 shadow-sm">
        No employees match.
      </div>
    );
  }

  return (
    // A plain grid, not the CSS columns this used first: columns pack tightest
    // but give every card a different height, and uniform cards were the ask.
    // Grid gives identical widths for free; CARD_HEIGHT does the rest.
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {cards.map((card) => (
        <section
          key={card.key}
          className={`flex ${CARD_HEIGHT} flex-col overflow-hidden rounded-xl border border-sdc-border bg-white shadow-sm`}
        >
          {/* The color lives here and nowhere else. Eight cards in eight brand
              colors only stay readable because the roster under them is white. */}
          <header className={`flex shrink-0 items-center justify-between gap-2 px-3 py-2 ${card.theme.band} ${card.theme.onBand}`}>
            <div className="flex min-w-0 items-center gap-2">
              {card.code && (
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-label font-bold ${card.theme.chip}`}>
                  {card.code}
                </span>
              )}
              <h3 className="truncate text-note font-bold tracking-wider uppercase">{card.title}</h3>
            </div>
            <span className="shrink-0 text-note font-semibold tabular-nums opacity-80">{card.people.length}</span>
          </header>
          {/* flex-1 + overflow-y-auto: the list takes whatever height is left in
              the fixed box and scrolls only if it runs out. */}
          <ul className="styled-scrollbar flex-1 overflow-y-auto">
            {card.people.map((p, i) => (
              <li
                key={p.id}
                className={`flex items-baseline gap-2 px-3 py-1 text-note hover:bg-sdc-blue-light/40 ${
                  i > 0 ? "border-t border-sdc-border-soft" : ""
                } ${p.active ? "" : "bg-sdc-gray-50/60"}`}
              >
                <span className="w-4 shrink-0 text-right tabular-nums text-sdc-gray-400">{i + 1}</span>
                <span className={`min-w-0 flex-1 truncate font-medium ${p.active ? "text-sdc-navy" : "text-sdc-muted"}`}>
                  {p.name}
                </span>
                {/* Supervisor, not discipline: inside a team card the discipline
                    is the card's own title repeated on every line, while who
                    someone reports to is the one thing that still varies. The
                    full record stays on the row's tooltip. */}
                <span
                  className="max-w-[45%] shrink-0 truncate text-label text-sdc-gray-400"
                  title={`${p.name} — ${p.discipline}, reports to ${p.supervisor}, ${p.department?.trim() || DASH}`}
                >
                  {p.supervisor === DASH ? "" : p.supervisor}
                </span>
                {!p.active && (
                  <span className="shrink-0 rounded bg-sdc-gray-100 px-1 text-micro font-semibold text-sdc-muted">Inactive</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
