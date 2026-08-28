"use client";

import { useMemo, useState } from "react";
import { card } from "@/components/ui/classnames";
import { SectionTitle } from "@/components/ui/Typography";
import type { CalendarEvent, CalendarEventType, ExecutionCalendar as CalendarData } from "@/lib/dashboard-calendar";

// ── Execution Calendar — FATs & Customer Visits (2026-08-28) ────────────────
//
// Replaces the "Execution — FATs" list and the separate "Planning — Customer
// Visits" panel with one month grid. Both were lists of the same shape of thing
// on the same page, and neither answered "what is happening the week of the
// 14th" without counting rows.
//
// Calendar and Upcoming are two renderings of ONE filtered array — see
// `shown` below. There is no second query and no second filter path, so the two
// views cannot disagree and the type filters apply identically to both.
//
// ── Colours are the EVENT TYPE, never the machine ───────────────────────────
//
// Blue = FAT, amber = Pre-FAT, purple = Customer Visit. Deliberately not the
// machine palette (lib/job-type-colors.ts and the Scheduler's own M1/M2 colours
// both mean something else): on this grid a colour answers "what kind of event
// is this", and the machine is a text chip inside the event.

const TYPE_META: Record<CalendarEventType, { label: string; dot: string; chip: string; bar: string }> = {
  fat: { label: "FAT", dot: "bg-sdc-blue", chip: "bg-sdc-blue-light text-sdc-blue-dark", bar: "bg-sdc-blue" },
  pre: { label: "Pre-FAT", dot: "bg-sdc-yellow", chip: "bg-sdc-yellow-bg text-sdc-yellow-text", bar: "bg-sdc-yellow" },
  visit: { label: "Customer Visit", dot: "bg-sdc-purple", chip: "bg-sdc-purple/15 text-sdc-purple", bar: "bg-sdc-purple" },
};

const ORDER: CalendarEventType[] = ["fat", "pre", "visit"];

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** Local calendar date as "YYYY-MM-DD" — compared as strings, never as Dates across zones. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The grid's cells: whole weeks, Monday-first, covering the month and padded
 * with the neighbouring months' days so every row has seven.
 */
function monthGrid(month: string): { iso: string; day: number; inMonth: boolean }[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  // getUTCDay is Sunday-0; shift so Monday is 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(y, m - 1, 1 - lead));
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    cells.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: d.getUTCFullYear() === y && d.getUTCMonth() === m - 1,
    });
    // Stop after the week that contains the last day — a 6th row only when needed.
    if (i >= 27 && (i + 1) % 7 === 0) {
      const next = new Date(start.getTime() + (i + 1) * 86_400_000);
      if (next.getUTCFullYear() !== y || next.getUTCMonth() !== m - 1) break;
    }
  }
  return cells;
}

/** "FAT · 1150 · M2 · USEC Heat Shield" — the compact form the cell shows. */
function compactLabel(e: CalendarEvent): string {
  const parts = [TYPE_META[e.eventType].label];
  if (e.jobNumber) parts.push(e.jobNumber);
  if (e.machine) parts.push(e.machine);
  const name = e.jobName ?? (e.eventType === "visit" ? e.customer : e.title);
  if (name) parts.push(name);
  return parts.filter(Boolean).join(" · ");
}

function EventChip({ e, onClick, selected }: { e: CalendarEvent; onClick: () => void; selected: boolean }) {
  const meta = TYPE_META[e.eventType];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={compactLabel(e)}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[0.68rem] leading-tight motion-interactive ${meta.chip} ${
        selected ? "ring-1 ring-sdc-navy" : "hover:brightness-95"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
      <span className="truncate">
        {e.jobNumber ?? ""}
        {e.machine ? ` · ${e.machine}` : ""}
        {e.jobNumber || e.machine ? " " : ""}
        <span className="opacity-80">{e.jobName ?? e.customer ?? e.title}</span>
      </span>
    </button>
  );
}

// Declared at module scope, not inside EventDetails: a component created during
// render is a NEW component type on every render, so React remounts it and it
// loses any state it ever gains. Harmless while it is this simple, and exactly
// the kind of thing that stops being harmless later.
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-0.5">
      <dt className="text-label text-sdc-gray-400">{label}</dt>
      <dd className="min-w-0 text-sm text-sdc-navy">{value}</dd>
    </div>
  );
}

/** The full detail for one event — the popover the compact chip opens. */
function EventDetails({ e, onClose }: { e: CalendarEvent; onClose: () => void }) {
  const meta = TYPE_META[e.eventType];
  const names = (list: string[], empty: string) =>
    list.length === 0 ? <span className="text-sdc-gray-400">{empty}</span> : list.join(", ");

  return (
    <div className="border-t border-sdc-border bg-sdc-gray-50 px-4 py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-label font-semibold ${meta.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
            {meta.label}
          </span>
          <h4 className="mt-1 truncate text-sm font-semibold text-sdc-navy">
            {e.jobNumber ? `${e.jobNumber} · ` : ""}
            {e.jobName ?? e.customer ?? e.title}
          </h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-sdc-border bg-white px-2 py-0.5 text-note text-sdc-muted motion-interactive hover:text-sdc-navy"
        >
          Close
        </button>
      </div>

      <dl className="grid gap-x-8 sm:grid-cols-2">
        <Row label="Date" value={LONG_DATE.format(new Date(`${e.date}T00:00:00Z`))} />
        <Row label="Customer" value={e.customer ?? <span className="text-sdc-gray-400">—</span>} />
        {e.eventType === "visit" ? (
          <>
            <Row label="Job" value={e.jobNumber ? `${e.jobNumber} · ${e.jobName ?? ""}` : <span className="text-sdc-gray-400">—</span>} />
            <Row label="Owner" value={e.visitOwner ?? <span className="text-sdc-gray-400">—</span>} />
            <Row label="Purpose" value={e.visitNote ?? <span className="text-sdc-gray-400">—</span>} />
          </>
        ) : (
          <>
            {/* A FAT with no machine is not missing data — the Scheduler leaves
                tasks.machine unset when the FAT covers the whole project, so it
                is labelled as such rather than shown as a blank. */}
            <Row
              label="Machine"
              value={e.machine ?? <span className="font-medium text-sdc-gray-600">Project-level FAT</span>}
            />
            <Row label="Schedule" value={e.projectName ?? <span className="text-sdc-gray-400">—</span>} />
            <Row label="Task" value={e.title} />
            <Row label="ME" value={names(e.meOwners, "No named ME")} />
            <Row label="CE" value={names(e.ceOwners, "No named CE")} />
            <Row
              label="Debug Lead"
              value={e.debugLead ?? <span className="text-sdc-gray-400">No Debug Lead</span>}
            />
            <Row label="PM" value={e.pm ?? <span className="text-sdc-gray-400">—</span>} />
          </>
        )}
      </dl>
    </div>
  );
}

const MAX_PER_CELL = 3;

export function ExecutionCalendarSection({
  data,
  monthLabel,
  kpis,
}: {
  data: CalendarData;
  monthLabel: string;
  /** The existing FAT KPI cards, rendered beside the calendar rather than above a second list. */
  kpis: React.ReactNode;
}) {
  const [enabled, setEnabled] = useState<Set<CalendarEventType>>(new Set(ORDER));
  const [view, setView] = useState<"calendar" | "upcoming">("calendar");
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // THE filtered set. Both views render this and nothing else.
  const shown = useMemo(() => data.events.filter((e) => enabled.has(e.eventType)), [data.events, enabled]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of shown) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [shown]);

  const cells = useMemo(() => monthGrid(data.month), [data.month]);
  const today = todayIso();
  const selectedEvent = shown.find((e) => e.eventId === selected) ?? null;

  const counts = useMemo(() => {
    const c: Record<CalendarEventType, number> = { fat: 0, pre: 0, visit: 0 };
    for (const e of data.events) c[e.eventType]++;
    return c;
  }, [data.events]);

  const toggleType = (t: CalendarEventType) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      // Never allow all three off — an empty grid with no explanation reads as
      // "nothing is scheduled" rather than "you filtered everything out".
      return next.size === 0 ? new Set(ORDER) : next;
    });

  return (
    <section aria-label="Execution calendar">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <SectionTitle>Execution Calendar — FATs &amp; Customer Visits</SectionTitle>
          <p className="mt-0.5 text-label text-sdc-gray-400">
            {monthLabel} · {shown.length} event{shown.length === 1 ? "" : "s"}
            {data.schedulerAvailable ? "" : " · Scheduler unavailable, FATs not shown"}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-sdc-border bg-white p-0.5">
          {(["calendar", "upcoming"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`rounded-md px-2.5 py-1 text-label font-semibold capitalize motion-interactive ${
                view === v ? "bg-sdc-blue text-white" : "text-sdc-gray-600 hover:bg-sdc-blue-light"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(240px,0.8fr)]">
        <div className={`${card("p-0")} min-w-0 overflow-hidden`}>
          {/* Filters. The month itself comes from the Dashboard's own selector —
              this section deliberately has no second month control. */}
          <div className="flex flex-wrap items-center gap-2 border-b border-sdc-border px-3 py-2">
            {ORDER.map((t) => {
              const on = enabled.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-label font-medium motion-interactive ${
                    on ? "border-sdc-border bg-white text-sdc-navy" : "border-transparent bg-sdc-gray-50 text-sdc-gray-400"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${on ? TYPE_META[t].dot : "bg-sdc-gray-400"}`} aria-hidden />
                  {TYPE_META[t].label}
                  <span className="tabular-nums opacity-70">{counts[t]}</span>
                </button>
              );
            })}
            {!data.visitsConfigured && (
              // Compact, inside the filter row — replaces the full-width
              // "No data source yet" explainer panel that used to occupy a
              // section of its own.
              <span className="ml-auto text-label text-sdc-gray-400">
                No customer visits recorded for {monthLabel}
              </span>
            )}
          </div>

          {view === "calendar" ? (
            <div className="overflow-x-auto">
              <div className="min-w-[44rem]">
                <div className="grid grid-cols-7 border-b border-sdc-border bg-sdc-gray-50">
                  {DOW.map((d) => (
                    <div key={d} className="px-2 py-1 text-center text-label font-semibold uppercase tracking-wide text-sdc-muted">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {cells.map((c) => {
                    const events = byDay.get(c.iso) ?? [];
                    const isToday = c.iso === today;
                    const open = expandedDay === c.iso;
                    const visible = open ? events : events.slice(0, MAX_PER_CELL);
                    const hidden = events.length - visible.length;
                    return (
                      <div
                        key={c.iso}
                        className={`min-h-[5.4rem] border-r border-b border-sdc-border-soft p-1 last:border-r-0 ${
                          c.inMonth ? "bg-white" : "bg-sdc-gray-50/60"
                        }`}
                      >
                        <div className="mb-0.5 flex items-center justify-between px-0.5">
                          <span
                            className={`text-label tabular-nums ${
                              isToday
                                ? "rounded bg-sdc-navy px-1.5 py-0.5 font-bold text-white"
                                : c.inMonth
                                  ? "text-sdc-gray-600"
                                  : "text-sdc-gray-400"
                            }`}
                          >
                            {c.day}
                          </span>
                          {isToday && <span className="text-[0.6rem] font-semibold uppercase text-sdc-navy">Today</span>}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          {visible.map((e) => (
                            <EventChip
                              key={e.eventId}
                              e={e}
                              selected={selected === e.eventId}
                              onClick={() => setSelected((prev) => (prev === e.eventId ? null : e.eventId))}
                            />
                          ))}
                          {hidden > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedDay(c.iso)}
                              className="px-1 text-left text-[0.65rem] font-semibold text-sdc-blue hover:underline"
                            >
                              +{hidden} more
                            </button>
                          )}
                          {open && events.length > MAX_PER_CELL && (
                            <button
                              type="button"
                              onClick={() => setExpandedDay(null)}
                              className="px-1 text-left text-[0.65rem] text-sdc-gray-400 hover:underline"
                            >
                              show less
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-h-[30rem] divide-y divide-sdc-border-soft overflow-y-auto">
              {shown.length === 0 ? (
                <p className="px-4 py-6 text-sm text-sdc-gray-400">No events in {monthLabel} for the selected types.</p>
              ) : (
                shown.map((e) => {
                  const meta = TYPE_META[e.eventType];
                  return (
                    <button
                      key={e.eventId}
                      type="button"
                      onClick={() => setSelected((prev) => (prev === e.eventId ? null : e.eventId))}
                      aria-pressed={selected === e.eventId}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left motion-interactive ${
                        selected === e.eventId ? "bg-sdc-blue-light" : "hover:bg-sdc-blue-light/25"
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                      <span className="w-20 shrink-0 text-label tabular-nums text-sdc-gray-600">{e.date.slice(5)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-sdc-navy">{compactLabel(e)}</span>
                      <span className="shrink-0 text-label text-sdc-gray-400">{e.customer ?? ""}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Details open in place, under whichever view is showing — no
              navigation and no second page. */}
          {selectedEvent && <EventDetails e={selectedEvent} onClose={() => setSelected(null)} />}
        </div>

        <div className="min-w-0">{kpis}</div>
      </div>
    </section>
  );
}
