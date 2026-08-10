"use client";

import { TOOLBAR_BTN, TOOLBAR_BTN_ACTIVE, TOOLBAR_BTN_NEUTRAL, INPUT, BUTTON_MENU_LINK } from "@/components/ui/classnames";
import { useDraftParamsMenu } from "@/components/useDraftParamMenu";
import { MenuStatus, MenuApplyHint } from "@/components/MenuStatus";

// "Dates ▾" — filter the Hours table to punches whose work date falls in a range.
// Simplified from ProjectsDateFilter.tsx: Hours has exactly one date dimension (the work
// date), so there's no field-to-filter-on toggle to carry.

type Key = "from" | "to";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Formats a "YYYY-MM-DD" string for display WITHOUT going through `Date` — the same
// discipline table-sort.ts's compareByType uses for the same reason: parsing into a
// Date and re-formatting can shift the displayed day across a UTC/local boundary.
function formatIsoDateShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

function formatRangeLabel(from: string, to: string): string {
  if (from && to) return `${formatIsoDateShort(from)} – ${formatIsoDateShort(to)}`;
  if (from) return `From ${formatIsoDateShort(from)}`;
  if (to) return `Until ${formatIsoDateShort(to)}`;
  return "Dates";
}

// Local-calendar-day arithmetic for the presets — deliberately NOT `toISOString()`,
// which converts to UTC and can land on the wrong side of midnight depending on the
// browser's timezone.
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

type Preset = { label: string; range: () => { from: string; to: string } };

const PRESETS: Preset[] = [
  { label: "Today", range: () => ({ from: toIsoDate(new Date()), to: toIsoDate(new Date()) }) },
  {
    label: "This Week",
    range: () => {
      const today = new Date();
      const day = today.getDay(); // 0=Sun..6=Sat
      const monday = addDays(today, day === 0 ? -6 : 1 - day);
      return { from: toIsoDate(monday), to: toIsoDate(addDays(monday, 6)) };
    },
  },
  {
    label: "This Month",
    range: () => {
      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: toIsoDate(first), to: toIsoDate(last) };
    },
  },
  {
    label: "Last 30 Days",
    range: () => {
      const today = new Date();
      return { from: toIsoDate(addDays(today, -29)), to: toIsoDate(today) };
    },
  },
];

export function HoursDateFilter({ from, to }: { from: string; to: string }) {
  const committed: Record<Key, string[]> = { from: from ? [from] : [], to: to ? [to] : [] };

  const { draft, setValues, dirty, pending, detailsRef, detailsProps } = useDraftParamsMenu<Key>({
    committed,
    debounceMs: 700, // a date is typed, not clicked — see ProjectsDateFilter's note
    buildParams: (d, qs) => {
      const f = d.from[0] ?? "";
      const t = d.to[0] ?? "";
      if (f) qs.set("from", f);
      else qs.delete("from");
      if (t) qs.set("to", t);
      else qs.delete("to");
      qs.delete("page");
    },
  });

  const draftFrom = draft.from[0] ?? "";
  const draftTo = draft.to[0] ?? "";
  const active = Boolean(from || to);
  const backwards = Boolean(draftFrom && draftTo && draftFrom > draftTo);

  function applyPreset(range: { from: string; to: string }) {
    setValues("from", [range.from]);
    setValues("to", [range.to]);
  }

  return (
    <details ref={detailsRef} {...detailsProps} className="group relative inline-block">
      <summary className={`${TOOLBAR_BTN} ${active ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN_NEUTRAL} ${pending ? "opacity-60" : ""}`}>
        {active ? formatRangeLabel(from, to) : "Dates"}
        <MenuStatus pending={pending} />
      </summary>
      {/* right-0/left-auto: this button sits near the right edge of the toolbar (Filters,
          Dates, Group By, Views, Export in a row) — anchoring from the left, like the other
          menus, pushed the panel off the right edge of the viewport. Opening leftward from
          the button's right edge keeps it on-screen regardless of viewport width. */}
      <div className="motion-menu-panel absolute right-0 left-auto top-full z-30 mt-2 w-56 rounded-lg border border-sdc-border bg-white p-2.5 shadow-lg">
        <div className="grid grid-cols-[2.5rem_1fr] items-center gap-x-2 gap-y-1.5">
          <span className="text-note text-sdc-gray-600">From</span>
          <input
            type="date"
            value={draftFrom}
            onChange={(e) => setValues("from", e.target.value ? [e.target.value] : [])}
            className={`${INPUT} w-full text-xs`}
            aria-label="Work date from"
          />
          <span className="text-note text-sdc-gray-600">To</span>
          <input
            type="date"
            value={draftTo}
            onChange={(e) => setValues("to", e.target.value ? [e.target.value] : [])}
            className={`${INPUT} w-full text-xs`}
            aria-label="Work date to"
          />
        </div>

        {backwards && <p className="mt-2 text-note font-medium text-sdc-red-text">&quot;From&quot; is after &quot;To&quot; — no punch can match.</p>}

        <div className="mt-2 flex flex-wrap gap-1 border-t border-sdc-border-soft pt-2">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => applyPreset(p.range())} className={BUTTON_MENU_LINK}>
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setValues("from", []);
              setValues("to", []);
            }}
            disabled={!draftFrom && !draftTo}
            className={BUTTON_MENU_LINK}
          >
            Clear
          </button>
        </div>

        <MenuApplyHint dirty={dirty} />
      </div>
    </details>
  );
}
